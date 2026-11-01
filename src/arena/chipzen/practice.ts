import { RetryPolicy, runExternalBot, type RunExternalBotOptions } from '@chipzen-ai/bot';
import type { HoldemChipzenBot, Audit } from './bot.js';
import { record, textId } from './adapter.js';

type Transport = NonNullable<RunExternalBotOptions['transport']>;
type Connection = Awaited<ReturnType<Transport>>;
export interface PracticeConfig { botId: string; token: string; origin: string }

export function practiceConfig(env: NodeJS.ProcessEnv): PracticeConfig {
  const botId = env.CHIPZEN_BOT_ID ?? '', token = env.CHIPZEN_BOT_TOKEN ?? '';
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(botId)
    || !/^cz_extbot_[A-Za-z0-9]{32}$/.test(token)) {
    throw new Error('Set CHIPZEN_BOT_ID and CHIPZEN_BOT_TOKEN locally; do not paste secrets into chat.');
  }
  const target = env.CHIPZEN_ENV ?? 'prod';
  if (target !== 'prod' && target !== 'staging') throw new Error('CHIPZEN_ENV must be prod or staging');
  return { botId, token, origin: target === 'prod' ? 'https://chipzen.ai' : 'https://staging.chipzen.ai' };
}

/** Do not serialize transport credentials or the post-hand full deck into evaluation logs. */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/cz_extbot_[A-Za-z0-9]+/g, '[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|password|authorization|deck_reveal|deck_commitment/i.test(key))
    .map(([key, v]) => [key, redact(v)]));
  return value;
}

/** One HTTP dispatch only. A lost response is ambiguous and MUST NOT be retried automatically. */
export class PracticeGate {
  private requested = false;
  private allowedMatch: string | undefined;
  constructor(private readonly config: PracticeConfig, private readonly request: typeof fetch = fetch, resumeMatchId?: string) {
    if (resumeMatchId !== undefined) {
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(resumeMatchId)) throw new Error('Resume requires an exact match UUID');
      this.allowedMatch = resumeMatchId;
      this.requested = true;
    }
  }
  async dispatch(signal: AbortSignal): Promise<string | undefined> {
    if (this.requested) return this.allowedMatch;
    this.requested = true;
    const response = await this.request(`${this.config.origin}/api/external-api/challenges/house-bot`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_id: this.config.botId }),
    });
    if (!response.ok) throw new Error(`Practice dispatch HTTP ${response.status}; no automatic retry or paid upgrade.`);
    const body = record(await response.json());
    if (body.rated !== false) throw new Error('Expected an unrated practice match');
    this.allowedMatch = textId(body.match_id);
    return this.allowedMatch;
  }
  accepts(message: Record<string, unknown>): boolean {
    if (this.allowedMatch === undefined || message.rated !== false || message.match_id !== this.allowedMatch) return false;
    if (typeof message.gateway_ws_url !== 'string') return false;
    try {
      const origin = this.config.origin.replace('https:', 'wss:');
      const gateway = new URL(message.gateway_ws_url, origin);
      return gateway.origin === origin && !gateway.search && !gateway.hash && !gateway.username && !gateway.password
        && gateway.pathname.startsWith(`/ws/external/match/${encodeURIComponent(this.allowedMatch)}/`);
    } catch { return false; }
  }
}

/** Native socket with bounded inbox; the official SDK still owns all protocol/session handling. */
export function socketConnection(url: string, protocols: string[], signal: AbortSignal,
  filter: (frame: Record<string, unknown>, received: number) => Promise<boolean>, audit: Audit): Promise<Connection> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Session stopped')); return; }
    const socket = new WebSocket(url, protocols);
    const endpoint = new URL(url).pathname.includes('/match/') ? 'match' : 'lobby';
    audit('connection-start', { endpoint });
    const queue: { raw: string; received: number }[] = [];
    let closed = false, failed = false, wake: (() => void) | undefined;
    const openTimer = setTimeout(() => {
      audit('connection-timeout', { endpoint });
      failed = true; socket.close(); reject(new Error('Connection timeout'));
    }, 15_000);
    const stop = () => {
      failed = true; clearTimeout(openTimer); socket.close(); wake?.();
      reject(new Error('Transport stopped'));
    };
    signal.addEventListener('abort', stop, { once: true });
    const send = (raw: string) => {
      const msg = record(JSON.parse(raw));
      if (msg.type === 'turn_action') audit('sent-action', msg);
      socket.send(raw);
    };
    socket.addEventListener('message', event => {
      if (failed || closed || signal.aborted) return;
      if (typeof event.data !== 'string' || event.data.length > 1_000_000 || queue.length >= 256) { stop(); return; }
      try {
        const frame = record(JSON.parse(event.data));
        // Heartbeats must stay responsive while a worker is calculating or HTTP dispatch is pending.
        if (frame.type === 'ping') {
          const heartbeatReceivedAt = performance.now();
          // Match the official SDK: lobby pong has no game-envelope fields.
          const pong = { type: 'pong', ...(endpoint === 'match' && frame.match_id ? { match_id: frame.match_id } : {}) };
          socket.send(JSON.stringify(pong));
          const handlerElapsedMs = performance.now() - heartbeatReceivedAt;
          // Send before synchronous disk audit so slow storage cannot hold up pong.
          audit('heartbeat-received', { endpoint, frame });
          audit('heartbeat-sent', { endpoint, frame: pong, handlerElapsedMs }); return;
        }
        queue.push({ raw: event.data, received: performance.now() }); wake?.();
      } catch { stop(); }
    });
    socket.addEventListener('close', event => {
      audit('connection-close', { endpoint, code: event.code, reason: event.reason });
      closed = true; clearTimeout(openTimer); signal.removeEventListener('abort', stop); wake?.();
      reject(new Error('Connection closed before opening'));
    });
    socket.addEventListener('error', event => {
      const detail = (event as Event & { error?: Error }).error;
      audit('connection-error', { endpoint, message: detail?.message,
        cause: detail?.cause instanceof Error ? detail.cause.message : undefined });
      failed = true; clearTimeout(openTimer); socket.close(); wake?.(); reject(new Error('WebSocket transport failed'));
    });
    // Share a pending read: SDK lobby polling must not leave abandoned read promises behind.
    let pending: Promise<string | null> | undefined;
    const read = async (): Promise<string | null> => {
      for (;;) {
        if (failed || signal.aborted) throw new Error('Transport stopped');
        const item = queue.shift();
        if (item) {
          if (await filter(record(JSON.parse(item.raw)), item.received)) return item.raw;
        } else {
          if (closed) return null;
          await new Promise<void>(r => { wake = r; }); wake = undefined;
        }
      }
    };
    socket.addEventListener('open', () => {
      if (failed || signal.aborted) { socket.close(); return; }
      audit('connection-open', { endpoint });
      clearTimeout(openTimer);
      resolve({ send, close: stop, reader: {
        next: () => { pending ??= read().finally(() => { pending = undefined; }); return pending; },
      } });
    });
  });
}

export async function runHousePractice(config: PracticeConfig, createBot: () => HoldemChipzenBot,
  audit: Audit, signal: AbortSignal, resumeMatchId?: string): Promise<unknown> {
  const gate = new PracticeGate(config, fetch, resumeMatchId), connections = new Set<Connection>();
  const lobbyUrl = `${config.origin.replace('https:', 'wss:')}/ws/external/bot/${config.botId}`;
  let currentBot: HoldemChipzenBot | undefined, fatal: Error | undefined;
  const accepted = new Set<string>();
  const transport: Transport = async (url, options) => {
    if (fatal || signal.aborted) throw new Error('Practice session stopped');
    if (new URL(url).origin !== new URL(lobbyUrl).origin) throw new Error('Cross-origin connection refused');
    const lobby = url === lobbyUrl;
    const bot = currentBot;
    const connection = await socketConnection(url, options.subprotocols ?? [], signal, async (frame, received) => {
      try {
        if (lobby && frame.type === 'hello') {
          audit('lobby-connected', {});
          audit(resumeMatchId ? 'practice-resume' : 'practice-dispatch-requested', { matchId: resumeMatchId });
          // Live HTTPS requests can exceed 15s on this network. This is a single
          // dispatch deadline, not the per-decision clock; never retry the POST.
          const matchId = await gate.dispatch(AbortSignal.any([signal, AbortSignal.timeout(45_000)]));
          if (!resumeMatchId) audit('practice-dispatched', { matchId });
        }
        if (lobby && frame.type === 'matched') {
          audit('match-notification', frame);
          if (!gate.accepts(frame) || accepted.has(String(frame.match_id))) {
            audit('ignored-match', { matchId: frame.match_id, rated: frame.rated }); return false;
          }
          accepted.add(String(frame.match_id));
        }
        if (!lobby) {
          audit('frame', frame);
          if (!bot) throw new Error('Missing per-match bot');
          await bot.prepare(frame, received);
        }
        return true;
      } catch (error) {
        fatal = error instanceof Error ? error : new Error('Protocol failure');
        audit('session-error', { message: fatal.message,
          cause: fatal.cause instanceof Error ? fatal.cause.message : undefined });
        throw fatal;
      }
    }, audit);
    connections.add(connection); return connection;
  };
  try {
    const result = await runExternalBot(() => { currentBot = createBot(); return currentBot; }, {
      url: lobbyUrl, token: config.token, config: null, transport, maxMatches: 1, safeMode: false,
      retryPolicy: new RetryPolicy({ maxReconnectAttempts: 2, initialBackoffMs: 500, maxBackoffMs: 1000 }),
      clientName: 'holdem-engine-practice', clientVersion: '0.1.0',
    });
    audit('sdk-results', { results: result });
    if (fatal) throw fatal;
    if (signal.aborted || result.length !== 1 || result[0]?.end?.reason !== 'complete') throw new Error('Practice incomplete/cancelled/forfeited; inspect local journal');
    return redact(result);
  } catch (error) {
    // The SDK may retry transport after a fatal filter error. Preserve the original
    // dispatch/protocol failure instead of masking it as "Practice session stopped".
    throw fatal ?? error;
  } finally { for (const connection of connections) connection.close(); }
}
