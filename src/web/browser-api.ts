import { continueAfterHandResult, submitSessionCommand } from '../game/game-session.js';
import { answerTutorial, tutorialAllows, tutorialView } from '../game/tutorial.js';
import type { SessionCommand } from '../game/session-types.js';
import type { WebTable, SaveStatus } from './protocol.js';
import { MAX_BYTES, MAX_COMMANDS, validCheckpoint, type Checkpoint } from './checkpoint-data.js';
import { openLocalTable, rosterFor, advanceSession, refreshPresentation, type LocalSession } from './table-session.js';
import type { BrowserStore } from './browser-store.js';

export interface BrowserReply { status: number; body: { table?: WebTable | null; save?: SaveStatus; error?: string; rosters?: Record<number, ReturnType<typeof rosterFor>> } }
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function digest(table: WebTable): Promise<string> {
  const { id: _id, save: _save, ...state } = table;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Same GameSession/roster/view as Node, with a tab-local host and browser persistence. */
export function createBrowserApi(store: BrowserStore, version: string) {
  let session: LocalSession | null = null, busy = false;
  const rosters = Object.fromEntries([2, 3, 4, 5, 6].map((n) => [n, rosterFor(n)]));
  async function savedStatus(): Promise<SaveStatus> {
    try {
      const saved = await store.read();
      if (saved === null) return { enabled: true, saved: null, error: null };
      if (!validCheckpoint(saved)) throw new Error('Invalid checkpoint');
      return { enabled: true, saved: saved.summary,
        error: saved.engine === version ? null : '存档来自其他版本，暂不能恢复；仍保留在浏览器中。新开桌结算后将替换。' };
    } catch { return { enabled: true, saved: null, error: '浏览器存档不可用或数据损坏；仍可打牌，旧记录不会被自动删除。' }; }
  }
  async function checkpoint(current: LocalSession): Promise<void> {
    if (current.table.packet.kind === 'decision') return;
    try {
      if (current.journal.length > MAX_COMMANDS) throw new Error('Command limit');
      const saved: Checkpoint = {
        format: 1, engine: version, setup: current.setup, journal: current.journal,
        digest: await digest(current.table),
        summary: { id: crypto.randomUUID(), savedAt: new Date().toISOString(), hand: current.table.view.handNumber,
          heroStack: current.table.view.seats.find((seat) => seat.seatIndex === 0)!.stack,
          players: current.setup.players, mode: current.setup.mode, experience: current.setup.experience,
          lesson: current.tutorial?.lesson ?? null,
          ended: current.table.packet.kind === 'game-result' || current.table.living?.ended === true || current.tutorial?.complete === true },
      };
      if (new TextEncoder().encode(JSON.stringify(saved)).length > MAX_BYTES) throw new Error('Size limit');
      await store.write(saved, current.table.save?.saved?.id ?? null);
      current.table.save = { enabled: true, saved: saved.summary, error: null, current: true };
    } catch {
      current.table.save = { enabled: true, saved: current.table.save?.saved ?? null, current: false,
        error: '本次结算未保存：存储被禁用、达到上限，或另一标签页已更新存档。牌局已生效，未覆盖旧记录。' };
    }
  }
  async function restore(id: unknown): Promise<LocalSession> {
    const saved = await store.read();
    if (!validCheckpoint(saved) || saved.summary.id !== id || saved.engine !== version) throw new ApiError(409, '存档已变化或版本不兼容；旧记录保留。');
    if (new TextEncoder().encode(JSON.stringify(saved)).length > MAX_BYTES) throw new ApiError(409, '存档过大。');
    const s = saved.setup, deadline = Date.now() + 30_000;
    const restored = await openLocalTable(s.players, s.mode, s.experience, s.lesson, s.socialEnabled, s.runSeed);
    for (const entry of saved.journal) {
      if (Date.now() > deadline) throw new Error('Restore deadline');
      if (entry.type === 'command' || entry.type === 'continue') {
        const result = entry.type === 'command' ? await submitSessionCommand(restored.handle, entry.command)
          : await continueAfterHandResult(restored.handle, entry.packetIndex);
        if (!result.accepted) throw new Error('Rejected journal entry');
        advanceSession(restored);
      } else if (entry.type === 'reply') {
        if (!restored.living?.reply(entry.promptId, entry.choice, entry.revision)) throw new Error('Invalid reply');
        refreshPresentation(restored);
      } else if (entry.type === 'answer') {
        if (!restored.tutorial || !answerTutorial(restored.tutorial, restored.table.packet, entry.answer)) throw new Error('Invalid lesson');
        refreshPresentation(restored);
      } else throw new Error('Invalid journal');
    }
    if (restored.table.packet.kind === 'decision' || await digest(restored.table) !== saved.digest) throw new Error('Digest mismatch');
    restored.journal = saved.journal;
    restored.table.save = { enabled: true, saved: saved.summary, error: null, current: true };
    return restored;
  }
  return async (path: string, input: string | null = null): Promise<BrowserReply> => {
    if (busy) return { status: 409, body: { error: '正在处理上一步，请稍后同步。' } };
    busy = true;
    const ok = (table: WebTable): BrowserReply => ({ status: 200, body: { table } });
    try {
      if (path === '/api/bootstrap') return { status: 200, body: { rosters, table: session?.table ?? null, save: session?.table.save ?? await savedStatus() } };
      if (!['/api/table', '/api/resume', '/api/action', '/api/continue', '/api/reply', '/api/lesson'].includes(path)) throw new ApiError(404, '没有这个操作。');
      if (typeof input !== 'string' || input.length > 4096) throw new ApiError(400, '请求格式无效。');
      const body: Record<string, unknown> = JSON.parse(input);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '请求格式无效。');
      if (path === '/api/resume') {
        if (session) throw new ApiError(409, '当前已有牌桌，未重复恢复。');
        session = await restore(body.checkpointId); return ok(session.table);
      }
      if (path === '/api/table') {
        const experience = body.experience ?? 'free', mode = body.mode ?? 'classic';
        const players = experience === 'tutorial' ? 2 : experience === 'living' ? 4 : body.players;
        if (!['free', 'living', 'tutorial'].includes(String(experience)) || typeof experience !== 'string') throw new ApiError(400, '请选择有效玩法。');
        if (mode !== 'classic' && mode !== 'ability-lab') throw new ApiError(400, '请选择经典或能力模式。');
        if (experience === 'tutorial' && mode !== 'classic') throw new ApiError(400, '教学使用经典规则。');
        if (typeof players !== 'number' || !Number.isInteger(players) || players < 2 || players > 6) throw new ApiError(400, '请选择 2–6 人。');
        if (body.socialEnabled !== undefined && typeof body.socialEnabled !== 'boolean') throw new ApiError(400, '人物互动选项无效。');
        const opened = await openLocalTable(players, mode, experience as 'free' | 'living' | 'tutorial', 0, body.socialEnabled === true);
        opened.table.save = { ...await savedStatus(), current: false };
        await checkpoint(opened); session = opened; return ok(session.table);
      }
      if (!session) return { status: 401, body: { error: '请从主页开桌或恢复上次结算。', save: await savedStatus() } };
      if (body.tableId !== session.table.id) throw new ApiError(409, '牌桌已更新，请同步。');
      if (path === '/api/reply' || path === '/api/lesson') {
        const revision = path === '/api/reply' ? session.table.living?.revision : session.tutorial?.revision;
        if (revision === undefined || revision !== body.revision || body.expectedPacketIndex !== session.table.packet.packetIndex) throw new ApiError(409, '提示已更新，请同步。');
        if (path === '/api/reply') {
          if (typeof body.promptId !== 'string' || typeof body.choice !== 'string' || !session.living?.reply(body.promptId, body.choice, revision)) throw new ApiError(409, '回应无效。');
          session.journal.push({ type: 'reply', promptId: body.promptId, choice: body.choice, revision });
        } else if (body.operation === 'answer') {
          if (typeof body.answer !== 'string' || !answerTutorial(session.tutorial!, session.table.packet, body.answer)) throw new ApiError(409, '请完成本关后回答。');
          session.journal.push({ type: 'answer', answer: body.answer });
        } else if (body.operation === 'restart' || (body.operation === 'next' && session.tutorial!.solved && !session.tutorial!.complete)) {
          const next = await openLocalTable(2, 'classic', 'tutorial', session.tutorial!.lesson + (body.operation === 'next' ? 1 : 0));
          next.table.save = { ...session.table.save!, current: false }; session = next;
        } else throw new ApiError(409, '先完成课后问题。');
        refreshPresentation(session);
      } else {
        if (session.living?.view().ended) throw new ApiError(409, '序章已结束，请回应或返回主页。');
        const command = body.command as SessionCommand | undefined;
        if (session.tutorial && (path === '/api/continue' || command?.type !== 'act' || !tutorialAllows(session.tutorial, session.table.packet, command.intent))) {
          throw new ApiError(409, `这是引导练习，未扣筹码。${tutorialView(session.tutorial, session.table.packet).hint}`);
        }
        const result = path === '/api/action' ? await submitSessionCommand(session.handle, command as SessionCommand)
          : await continueAfterHandResult(session.handle, body.expectedPacketIndex as number);
        if (!result.accepted) throw new ApiError(409, '操作已过期或不合法，未重复下注或消耗能力。');
        session.journal.push(path === '/api/action' ? { type: 'command', command: command! } : { type: 'continue', packetIndex: body.expectedPacketIndex as number });
        advanceSession(session);
      }
      await checkpoint(session); return ok(session.table);
    } catch (error) {
      return { status: error instanceof ApiError ? error.status : 400,
        body: { ...(session ? { table: session.table } : {}), error: error instanceof ApiError ? error.message : '操作或存档校验未通过，旧记录保留，请同步或重新开桌。' } };
    } finally { busy = false; }
  };
}
