import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { CHARACTERS, type CharacterId } from '../agents/characters.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../cli/index.js';
import { continueAfterHandResult, getCurrentPacket, openGameSession, submitSessionCommand } from '../game/game-session.js';
import { createCharacterParticipant, selectNpcRoster } from '../game/roster.js';
import type { GameSessionHandle, SessionCommand } from '../game/session-types.js';
import type { SeatIdentity, WebTable } from './protocol.js';
import { advanceTableView } from './view.js';

const STYLES: Record<CharacterId, string> = {
  rock: '少入局 · 守住筹码', hunter: '重视位置 · 主动施压', maniac: '宽范围 · 大胆进攻',
  'calling-station': '跟得多 · 很少主动加注', 'small-ball': '小底池 · 轻量施压',
  trapper: '选择慢打 · 等待反击', 'value-bettor': '价值下注 · 尺寸偏大',
};

function rosterFor(players: number): SeatIdentity[] {
  return [{ seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', style: '由你决定', characterId: 'hero' },
    ...selectNpcRoster(players).map((id, index) => {
      const character = CHARACTERS[id];
      return { seatIndex: index + 1, playerId: `${character.displayName}“${character.nickname}”`,
        name: character.displayName, nickname: character.nickname, style: STYLES[id], characterId: id };
    })];
}

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

interface LocalSession { handle: GameSessionHandle; table: WebTable; touched: number; busy: boolean }

export function createLocalServer() {
  const sessions = new Map<string, LocalSession>();
  const rosters = Object.fromEntries([2, 3, 4, 5, 6].map((count) => [count, rosterFor(count)]));
  const staticFiles: Record<string, [URL, string]> = {
    '/': [new URL('../../src/web/index.html', import.meta.url), 'text/html; charset=utf-8'],
    '/style.css': [new URL('../../src/web/style.css', import.meta.url), 'text/css; charset=utf-8'],
    '/client.js': [new URL('../../dist/web/client.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/playback.js': [new URL('../../dist/web/playback.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/render.js': [new URL('../../dist/web/render.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/view.js': [new URL('../../dist/web/view.js', import.meta.url), 'text/javascript; charset=utf-8'],
    '/agent-tools.js': [new URL('../../dist/web/agent-tools.js', import.meta.url), 'text/javascript; charset=utf-8'],
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
      const token = req.headers.cookie?.split(';').map((value) => value.trim())
        .find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const now = Date.now();
      for (const [key, session] of sessions) {
        if (!session.busy && now - session.touched > 7_200_000) sessions.delete(key);
      }
      let session = token ? sessions.get(token) : undefined;
      if (session) session.touched = now;
      if (req.method === 'GET') {
        if (path === '/api/bootstrap') { json(res, 200, { rosters, table: session?.table ?? null }); return; }
        const file = staticFiles[path];
        if (!file) throw new HttpError(404, '没有这个页面。');
        const content = await readFile(file[0]);
        res.writeHead(200, { 'Content-Type': file[1] }); res.end(content); return;
      }
      if (req.method !== 'POST') throw new HttpError(405, '不支持此请求方式。');
      if (!['/api/table', '/api/action', '/api/continue'].includes(path)) throw new HttpError(404, '没有这个操作。');
      const body = await readBody(req);
      // A different tab may replace the table while this request body is arriving.
      session = token ? sessions.get(token) : undefined;
      if (session?.busy) { json(res, 409, { error: '正在处理上一步，请稍后同步。', table: session.table }); return; }
      if (path === '/api/table') {
        const players = body.players;
        const mode = body.mode === undefined ? 'classic' : body.mode;
        if (mode !== 'classic' && mode !== 'ability-lab') throw new HttpError(400, '请选择经典德州或能力实验。');
        if (typeof players !== 'number' || !Number.isSafeInteger(players) || players < 2 || players > 6) {
          throw new HttpError(400, '请选择 2–6 人。');
        }
        if (!session && sessions.size >= 32) throw new HttpError(503, '本地牌桌已满，请关闭闲置会话后重试。');
        if (session) session.busy = true;
        try {
          const roster = rosterFor(players);
          const participants = [null, ...selectNpcRoster(players).map((id) => createCharacterParticipant(id))];
          const step = await openGameSession({ mode, config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: players },
            seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })), participants,
            humanSeatIndex: 0, runSeed: randomUUID(), invalidAgentActionMode: 'fallback' });
          const table: WebTable = { id: randomUUID(), mode, roster, packet: step.packet,
            view: advanceTableView(null, step.packet, roster) };
          const newToken = token && session ? token : randomUUID();
          sessions.set(newToken, { handle: step.handle, table, touched: now, busy: false });
          res.setHeader('Set-Cookie', `${cookieName}=${newToken}; HttpOnly; SameSite=Strict; Path=/`);
          json(res, 200, { table }); return;
        } finally { if (session) session.busy = false; }
      }
      if (!session) throw new HttpError(401, '牌桌已关闭或过期，请重新开桌。');
      if (body.tableId !== session.table.id) { json(res, 409, { error: '牌桌已更新，已同步当前牌桌。', table: session.table }); return; }
      session.busy = true;
      try {
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
        const packet = getCurrentPacket(session.handle);
        session.table = { ...session.table, packet, view: advanceTableView(session.table.view, packet, session.table.roster) };
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
  const server = createLocalServer();
  const port = Number(process.env.HOLDEM_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HOLDEM_PORT must be 1–65535');
  server.on('error', (error: NodeJS.ErrnoException) => {
    process.stderr.write(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可用 HOLDEM_PORT 指定其他端口。\n` : '本地牌桌启动失败。\n');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => { process.stdout.write(`Local: http://127.0.0.1:${port}\n`); });
}
