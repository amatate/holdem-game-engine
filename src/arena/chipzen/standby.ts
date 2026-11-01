import type { Audit } from './bot.js';
import { record } from './adapter.js';
import { redact, socketConnection, type PracticeConfig } from './practice.js';

export type StandbyState = 'connecting' | 'authenticating' | 'online' | 'retrying' | 'stopped' | 'error';
export interface StandbyStatus {
  mode: 'presence-only'; botId: string; origin: string; pid: number;
  state: StandbyState; startedAt: string; updatedAt: string;
  connectedAt: string | null; lastPongAt: string | null; lastError: string | null;
  nextRetryAt: string | null; attempts: number; heartbeats: number; ignoredMatches: number;
}

export function standbyStatusFresh(status: StandbyStatus, now = Date.now()): boolean {
  const last = Date.parse(status.lastPongAt ?? status.connectedAt ?? '');
  return status.state === 'online' && now >= last && now - last < 45_000;
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Presence ONLY: no HTTP dispatch, SDK match runner, gateway dial, or action worker. */
export async function runStandby(config: PracticeConfig, audit: Audit, signal: AbortSignal,
  onStatus: (status: StandbyStatus) => void): Promise<void> {
  if (!['https://chipzen.ai', 'https://staging.chipzen.ai'].includes(config.origin)
    || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(config.botId)) throw new Error('Invalid standby endpoint');
  const status: StandbyStatus = { mode: 'presence-only', botId: config.botId, origin: config.origin, pid: process.pid,
    state: 'connecting', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    connectedAt: null, lastPongAt: null, lastError: null, nextRetryAt: null,
    attempts: 0, heartbeats: 0, ignoredMatches: 0 };
  const publish = (state: StandbyState) => {
    status.state = state; status.updatedAt = new Date().toISOString();
    onStatus({ ...status });
  };
  let failures = 0;
  try {
    while (!signal.aborted) {
      status.attempts++; status.nextRetryAt = null; status.connectedAt = null; status.lastPongAt = null;
      publish('connecting');
      const controller = new AbortController();
      const combined = AbortSignal.any([signal, controller.signal]);
      let connection: Awaited<ReturnType<typeof socketConnection>> | undefined;
      let active = true, fatal = false, reason = 'Lobby disconnected';
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const watchdog = (ms: number, description: string) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { reason = description; controller.abort(); }, ms);
      };
      const transportAudit: Audit = (type, data) => {
        audit(type, data);
        if (!active || combined.aborted) return; // Preserve watchdog cause; ignore an older socket's late close.
        if (type === 'heartbeat-sent' && status.state === 'online') {
          status.lastPongAt = new Date().toISOString(); status.heartbeats++;
          // Reset exponential backoff only after a real heartbeat, not a flapping handshake.
          failures = 0; publish('online'); watchdog(45_000, 'No lobby heartbeat for 45 seconds');
        }
        if (type === 'connection-close') {
          reason = `Lobby closed (${String(data.code)}): ${String(redact(data.reason ?? 'no reason'))}`;
          fatal = [1008, 4001, 4002].includes(Number(data.code)) || /replaced|evict/i.test(String(data.reason));
        }
        if (type === 'connection-error' && data.message) reason = String(redact(data.message));
        if (type === 'connection-timeout') reason = 'Lobby connection timed out';
      };
      try {
        connection = await socketConnection(`${config.origin.replace('https:', 'wss:')}/ws/external/bot/${config.botId}`,
          [], combined, async () => true, transportAudit);
        if (combined.aborted) break;
        publish('authenticating'); watchdog(15_000, 'Lobby authentication timed out');
        connection.send(JSON.stringify({ type: 'authenticate', token: config.token }));
        while (!combined.aborted) {
          const raw = await connection.reader.next();
          if (raw === null) break;
          const frame = record(JSON.parse(raw));
          if (frame.type === 'hello') {
            if (frame.endpoint !== 'lobby' || (frame.match_id !== undefined && frame.match_id !== config.botId)) {
              fatal = true; reason = 'Unexpected lobby identity'; break;
            }
            status.connectedAt = new Date().toISOString();
            publish('online'); audit('lobby-connected', { mode: 'presence-only' });
            watchdog(45_000, 'No lobby heartbeat for 45 seconds');
          } else if (frame.type === 'matched') {
            status.ignoredMatches++;
            audit('ignored-match', { matchId: frame.match_id, rated: frame.rated, reason: 'presence-only: not authorized to play' });
            publish(status.state);
          } else if (frame.type === 'evict' || frame.type === 'error') {
            fatal = true; reason = `Lobby ${String(frame.type)}: ${String(redact(frame.code ?? frame.reason ?? frame.message ?? 'server rejected session'))}`;
            break; // Auth/quota/policy problems require attention, never endless retries or paid upgrades.
          }
        }
      } catch (error) {
        if (reason === 'Lobby disconnected') reason = String(redact(error instanceof Error ? error.message : 'Connection failed'));
      } finally {
        active = false; clearTimeout(timeout); controller.abort(); connection?.close();
      }
      if (signal.aborted) break;
      status.lastError = reason;
      if (fatal) throw new Error(reason);
      const backoffMs = Math.min(30_000, 2_000 * 2 ** Math.min(failures++, 4)) + Math.floor(Math.random() * 500);
      status.nextRetryAt = new Date(Date.now() + backoffMs).toISOString(); publish('retrying');
      audit('standby-retry', { reason, backoffMs });
      await waitForRetry(backoffMs, signal);
    }
    status.nextRetryAt = null; publish('stopped');
  } catch (error) {
    status.lastError = String(redact(error instanceof Error ? error.message : 'Standby failed'));
    status.nextRetryAt = null; publish('error'); throw error;
  }
}
