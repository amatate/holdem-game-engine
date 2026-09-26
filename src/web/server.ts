import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { continueAfterHandResult, submitSessionCommand } from '../game/game-session.js';
import type { SessionCommand } from '../game/session-types.js';
import type { SaveStatus } from './protocol.js';
import { FileCheckpointStore, engineFingerprint, tableDigest, MAX_COMMANDS,
  type Checkpoint, type CheckpointStore } from './checkpoints.js';
import { answerTutorial, tutorialAllows, tutorialView } from '../game/tutorial.js';
import { rosterFor, openLocalTable, refreshPresentation, advanceSession, type LocalSession } from './table-session.js';



class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, '请发送 JSON 请求。');
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 4096) throw new HttpError(413, '请求内容过长。');
  }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, '请求格式无效。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求格式无效。');
  return body as Record<string, unknown>;
}



async function restoreCheckpoint(checkpoint: Checkpoint): Promise<LocalSession> {
  const setup = checkpoint.setup;
  const deadline = Date.now() + 30_000;
  const session = await openLocalTable(setup.players, setup.mode, setup.experience, setup.lesson, setup.socialEnabled, setup.runSeed);
  for (const entry of checkpoint.journal) {
    if (Date.now() > deadline) throw new Error('Restore time limit');
    if (entry.type === 'command' || entry.type === 'continue') {
      const result = entry.type === 'command' ? await submitSessionCommand(session.handle, entry.command)
        : await continueAfterHandResult(session.handle, entry.packetIndex);
      if (!result.accepted) throw new Error('Rejected checkpoint command');
      advanceSession(session);
    } else if (entry.type === 'reply') {
      if (!session.living?.reply(entry.promptId, entry.choice, entry.revision)) throw new Error('Invalid saved reply');
      refreshPresentation(session);
    } else if (entry.type === 'answer') {
      if (!session.tutorial || !answerTutorial(session.tutorial, session.table.packet, entry.answer)) throw new Error('Invalid saved answer');
      refreshPresentation(session);
    } else throw new Error('Invalid journal entry');
  }
  if (session.table.packet.kind === 'decision' || tableDigest(session.table) !== checkpoint.digest) throw new Error('Checkpoint mismatch');
  session.journal = checkpoint.journal;
  return session;
}

export function createLocalServer(options: { checkpointStore?: CheckpointStore } = {}) {
  const sessions = new Map<string, LocalSession>();
  const pending = new Set<string>();
  const store = options.checkpointStore;
  const fingerprint = store ? engineFingerprint() : Promise.resolve('');
  // Keep startup failures contained; the UI reports persistence errors without rejecting wagers.
  void fingerprint.catch(() => {});
  async function savedStatus(token: string | undefined): Promise<SaveStatus> {
    if (!store || !token) return { enabled: !!store, saved: null, error: null };
    try {
      const saved = await store.read(token);
      if (saved && saved.engine !== await fingerprint) return { enabled: true, saved: null, error: '存档来自不同规则版本，暂不能恢复；原文件已保留。' };
      return { enabled: true, saved: saved?.summary ?? null, error: null };
    } catch { return { enabled: true, saved: null, error: '无法读取本地存档；原文件未删除，请检查服务目录和权限。' }; }
  }
  async function checkpoint(session: LocalSession, token: string): Promise<void> {
    if (!store || session.table.packet.kind === 'decision') return;
    try {
      if (session.journal.length > MAX_COMMANDS) throw new Error('Checkpoint limit');
      const summary = { id: randomUUID(), savedAt: new Date().toISOString(), hand: session.table.view.handNumber,
        heroStack: session.table.view.seats.find((seat) => seat.seatIndex === 0)!.stack,
        players: session.setup.players, mode: session.setup.mode, experience: session.setup.experience,
        lesson: session.tutorial?.lesson ?? null,
        ended: session.table.packet.kind === 'game-result' || session.table.living?.ended === true || session.tutorial?.complete === true };
      await store.write(token, { format: 1, engine: await fingerprint, setup: session.setup, journal: session.journal,
        summary, digest: tableDigest(session.table) });
      session.table.save = { enabled: true, saved: summary, error: null, current: true };
    } catch {
      session.table.save = { enabled: true, saved: session.table.save?.saved ?? null, current: session.table.save?.current ?? false,
        error: session.journal.length > MAX_COMMANDS ? '本场操作超过存档上限，未覆盖上一次存档；可继续打牌，但新进度不再保存。'
          : '本次结算未能保存；牌局已生效，上一次存档未覆盖。请检查磁盘和目录权限。' };
    }
  }
  const rosters = Object.fromEntries([2, 3, 4, 5, 6].map((count) => [count, rosterFor(count)]));
  const staticFiles: Record<string, [URL, string]> = {
    '/': [new URL('../../src/web/index.html', import.meta.url), 'text/html; charset=utf-8'],
    '/style.css': [new URL('../../src/web/style.css', import.meta.url), 'text/css; charset=utf-8'],
    '/pixel-table.css': [new URL('../../src/web/pixel-table.css', import.meta.url), 'text/css; charset=utf-8'],
    '/art/room-v1.png': [new URL('../../src/web/art/room-v1.png', import.meta.url), 'image/png'],
    '/art/hunter-v1.png': [new URL('../../src/web/art/hunter-v1.png', import.meta.url), 'image/png'],
    '/art/maniac-v1.png': [new URL('../../src/web/art/maniac-v1.png', import.meta.url), 'image/png'],
    '/art/calling-station-v1.png': [new URL('../../src/web/art/calling-station-v1.png', import.meta.url), 'image/png'],
    '/client.js': [new URL('../../dist/web/client.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/transport.js': [new URL('../../dist/web/transport.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/playback.js': [new URL('../../dist/web/playback.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/render.js': [new URL('../../dist/web/render.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/view.js': [new URL('../../dist/web/view.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/agent-tools.js': [new URL('../../dist/web/agent-tools.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/experience-render.js': [new URL('../../dist/web/experience-render.js', import.meta.url), 'text/javascript; charset=utf-8'],
  };
  const server = createServer((req, res) => { void handleRequest(req, res); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
        throw new HttpError(403, '只允许从本机牌桌访问。');
      }
      const origin = `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== origin)
        || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '请在本机牌桌页面操作。');
      const path = new URL(req.url ?? '/', origin).pathname;
      // Cookies are not isolated by TCP port. Keep parallel local servers independent.
      const cookieName = `holdem_session_${port}`;
      const rawToken = req.headers.cookie?.split(';').map((value) => value.trim())
        .find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const token = rawToken && /^[a-f0-9-]{36}$/.test(rawToken) ? rawToken : undefined;
      const now = Date.now();
      for (const [key, session] of sessions) {
        if (!session.busy && now - session.touched > 7_200_000) sessions.delete(key);
      }
      let session = token ? sessions.get(token) : undefined;
      if (session) session.touched = now;
      if (req.method === 'GET') {
        if (path === '/api/bootstrap') { json(res, 200, { rosters, table: session?.table ?? null,
          save: session?.table.save ?? await savedStatus(token) }); return; }
        const file = staticFiles[path];
        if (!file) throw new HttpError(404, '没有这个页面。');
        const content = await readFile(file[0]);
        // These fixed, versioned art files are public and reused on every playback frame.
        // Keep pages, scripts and all private game responses uncached.
        if (path.startsWith('/art/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.writeHead(200, { 'Content-Type': file[1] }); res.end(content); return;
      }
      if (req.method !== 'POST') throw new HttpError(405, '不支持此请求方式。');
      if (!['/api/table', '/api/resume', '/api/action', '/api/continue', '/api/reply', '/api/lesson'].includes(path)) throw new HttpError(404, '没有这个操作。');
      const body = await readBody(req);
      // A different tab may replace the table while this request body is arriving.
      session = token ? sessions.get(token) : undefined;
      if (session?.busy || (token && pending.has(token))) { json(res, 409, { error: '正在处理上一步，请稍后同步。', table: session?.table }); return; }
      if (path === '/api/resume') {
        if (session) { json(res, 409, { error: '已有正在进行的牌桌，已返回当前进度。', table: session.table }); return; }
        if (!store || !token) throw new HttpError(404, '没有可恢复的本地存档。');
        if (sessions.size >= 32) throw new HttpError(503, '本地牌桌已满。');
        pending.add(token);
        try {
          const saved = await store.read(token);
          if (!saved || saved.summary.id !== body.checkpointId) throw new HttpError(409, '存档已变化，请同步后再继续。');
          if (saved.engine !== await fingerprint) throw new HttpError(409, '规则版本已变化，不能恢复此存档；原文件已保留。');
          const restored = await restoreCheckpoint(saved);
          restored.table.save = { enabled: true, saved: saved.summary, error: null, current: true };
          sessions.set(token, restored);
          res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=15552000`);
          json(res, 200, { table: restored.table }); return;
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(409, '存档恢复校验未通过，未开桌、未修改原存档；请检查版本或同步后重试。');
        } finally { pending.delete(token); }
      }
      if (path === '/api/table') {
        const experience = body.experience ?? 'free';
        if (experience !== 'free' && experience !== 'living' && experience !== 'tutorial') throw new HttpError(400, '请选择自由牌桌、活牌桌或教学。');
        const players = experience === 'tutorial' ? 2 : experience === 'living' ? 4 : body.players;
        const mode = body.mode === undefined ? 'classic' : body.mode;
        if (mode !== 'classic' && mode !== 'ability-lab') throw new HttpError(400, '请选择经典德州或能力实验。');
        if (experience === 'tutorial' && mode !== 'classic') throw new HttpError(400, '新手教学使用经典规则，不启用能力。');
        if (body.socialEnabled !== undefined && typeof body.socialEnabled !== 'boolean') throw new HttpError(400, '人物互动选项必须为开启或关闭。');
        if (typeof players !== 'number' || !Number.isSafeInteger(players) || players < 2 || players > 6) {
          throw new HttpError(400, '请选择 2–6 人。');
        }
        if (!session && sessions.size >= 32) throw new HttpError(503, '本地牌桌已满，请关闭闲置会话后重试。');
        if (session) session.busy = true;
        const newToken = token ?? randomUUID();
        pending.add(newToken);
        try {
          const opened = await openLocalTable(players, mode, experience, 0, body.socialEnabled === true);
          opened.table.save = await savedStatus(newToken);
          await checkpoint(opened, newToken);
          sessions.set(newToken, opened);
          res.setHeader('Set-Cookie', `${cookieName}=${newToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=15552000`);
          json(res, 200, { table: opened.table }); return;
        } finally { pending.delete(newToken); if (session) session.busy = false; }
      }
      if (!session) { json(res, 401, { error: '牌桌已关闭或过期；可从主页恢复上次结算，未完成的一手不保存。', save: await savedStatus(token) }); return; }
      if (body.tableId !== session.table.id) { json(res, 409, { error: '牌桌已更新，已同步当前牌桌。', table: session.table }); return; }
      session.busy = true;
      try {
        if (path === '/api/reply' || path === '/api/lesson') {
          const revision = path === '/api/reply' ? session.table.living?.revision : session.tutorial?.revision;
          if (revision === undefined || body.revision !== revision || body.expectedPacketIndex !== session.table.packet.packetIndex) {
            json(res, 409, { error: '这个提示已经变化，已同步当前进度。', table: session.table }); return;
          }
          if (path === '/api/reply') {
            if (typeof body.promptId !== 'string' || typeof body.choice !== 'string'
              || !session.living?.reply(body.promptId, body.choice, body.revision as number)) {
              json(res, 409, { error: '这段对话已回答或选项无效。', table: session.table }); return;
            }
            session.journal.push({ type: 'reply', promptId: body.promptId, choice: body.choice, revision: body.revision as number });
          } else {
            const tutorial = session.tutorial!;
            if (body.operation === 'answer') {
              if (typeof body.answer !== 'string' || !answerTutorial(tutorial, session.table.packet, body.answer)) {
                json(res, 409, { error: '请先完成这一手，再回答当前问题。', table: session.table }); return;
              }
              session.journal.push({ type: 'answer', answer: body.answer });
            } else if (body.operation === 'restart' || (body.operation === 'next' && tutorial.solved && !tutorial.complete)) {
              const opened = await openLocalTable(2, 'classic', 'tutorial', tutorial.lesson + (body.operation === 'next' ? 1 : 0));
              opened.table.save = { ...(session.table.save ?? await savedStatus(token)), current: false };
              await checkpoint(opened, token!);
              sessions.set(token!, opened);
              json(res, 200, { table: opened.table }); return;
            } else {
              json(res, 409, { error: '先回答本关问题，再进入下一关。', table: session.table }); return;
            }
          }
          refreshPresentation(session);
          await checkpoint(session, token!);
          json(res, 200, { table: session.table }); return;
        }
        if (session.living?.view().ended) {
          json(res, 409, { error: '序章已结束，可以回应离桌对话或返回主页。', table: session.table }); return;
        }
        if (session.tutorial) {
          const command = body.command as SessionCommand | undefined;
          if (path === '/api/continue' || command?.type !== 'act'
            || !tutorialAllows(session.tutorial, session.table.packet, command.intent)) {
            json(res, 409, { error: session.table.packet.kind === 'decision'
              ? `这是引导练习，未扣筹码。${tutorialView(session.tutorial, session.table.packet).hint}`
              : '这一手已结束，请完成课后问题；也可以重试本关。', table: session.table }); return;
          }
        }
        const result = path === '/api/action'
          ? await submitSessionCommand(session.handle, body.command as SessionCommand)
          : await continueAfterHandResult(session.handle, body.expectedPacketIndex as number);
        if (!result.accepted) {
          const messages: Record<string, string> = {
            'wrong-mode': '经典模式不能使用能力。',
            'ability-unavailable': '当前无法使用这项能力。',
            'ability-spent': '这项能力本场已用完；开始新的一桌才会恢复。',
            'ability-already-used-this-decision': '本次已使用一种能力，请先完成正常打牌操作。',
            'invalid-target': '只能选择仍未弃牌、未淘汰的其他对手。',
            'target-cards-public': '目标底牌已经公开，不能使用这项能力。',
            'invalid-hole-card-index': '请选择自己的第一张或第二张底牌。',
            'deck-exhausted': '没有可供更换的未发出牌；未消耗能力次数。',
            'not-human-turn': '请等到轮到你行动时再使用能力。',
          };
          json(res, 409, { error: messages[result.rejection] ?? '操作已过期或不合法，已同步当前牌桌。',
            rejection: result.rejection, table: session.table }); return;
        }
        session.journal.push(path === '/api/action' ? { type: 'command', command: body.command as SessionCommand }
          : { type: 'continue', packetIndex: body.expectedPacketIndex as number });
        advanceSession(session);
        await checkpoint(session, token!);
        json(res, 200, { table: session.table });
      } finally { session.busy = false; }
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 500,
        { error: error instanceof HttpError ? error.message : '本次操作未完成，请同步牌桌后重试。' });
    }
  }
  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env.HOLDEM_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HOLDEM_PORT must be 1–65535');
  const server = createLocalServer({ checkpointStore: new FileCheckpointStore(`.holdem-data/${port}`) });
  server.on('error', (error: NodeJS.ErrnoException) => {
    process.stderr.write(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可用 HOLDEM_PORT 指定其他端口。\n` : '本地牌桌启动失败。\n');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => { process.stdout.write(`Local: http://127.0.0.1:${port}\n`); });
}
