import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalServer } from '../../src/web/server.js';
import type { WebTable } from '../../src/web/protocol.js';
import type { ActionIntent } from '../../src/core/legal-actions.js';
import { renderLobby, renderTable } from '../../src/web/render.js';

describe('tutorial and living HTTP experiences', () => {
  const server = createLocalServer();
  let origin: string; let cookie = '';
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  async function post(path: string, body: unknown) {
    const response = await fetch(origin + path, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const nextCookie = response.headers.get('set-cookie'); if (nextCookie) cookie = nextCookie.split(';')[0]!;
    const result = await response.json() as { table: WebTable; error?: string };
    return { status: response.status, ...result };
  }
  function actionBody(table: WebTable, intent: ActionIntent) {
    if (table.packet.kind !== 'decision') throw new Error('No decision');
    return { tableId: table.id, command: { type: 'act', decisionKey: table.packet.decisionKey,
      expectedPacketIndex: table.packet.packetIndex, intent } };
  }
  function lessonBody(table: WebTable, operation: string, answer?: string) {
    return { tableId: table.id, expectedPacketIndex: table.packet.packetIndex,
      revision: table.tutorial!.revision, operation, answer };
  }
  async function restored() { return (await (await fetch(origin + '/api/bootstrap', { headers: { cookie } })).json() as { table: WebTable }).table; }
  async function finishLesson(table: WebTable): Promise<WebTable> {
    let steps = 0;
    while (table.packet.kind === 'decision' && steps++ < 20) {
      const intent = table.tutorial!.recommended ?? (table.packet.observation.legalActions.check ? { type: 'check' } : { type: 'call' });
      const response = await post('/api/action', actionBody(table, intent));
      expect(response.status).toBe(200); table = response.table;
    }
    expect(table.packet.kind).toBe('hand-result');
    if (table.packet.kind === 'hand-result') expect(table.packet.handResult.seats.reduce((sum, seat) => sum + seat.finalStack, 0)).toBe(200);
    return table;
  }

  it('has two homepage entries, preserves free mode and validates experience selection', async () => {
    const html = renderLobby({}, 4);
    expect(html).toContain('开始新手教学'); expect(html).toContain('留一张椅子'); expect(html).toContain('game-mode');
    expect((await post('/api/table', { players: 4, experience: 'invalid' })).status).toBe(400);
    expect((await post('/api/table', { experience: 'tutorial', mode: 'ability-lab' })).status).toBe(400);
    const { table } = await post('/api/table', { players: 2 });
    expect(table.experience).toBe('free'); expect(table.living).toBeNull(); expect(table.tutorial).toBeNull();
  });
  it('teaches all three real-engine lessons, rejects mistakes and recovers refreshes', async () => {
    let { table } = await post('/api/table', { experience: 'tutorial' });
    expect(table.mode).toBe('classic'); expect(table.roster).toHaveLength(2);
    expect(table.tutorial?.recommended).toEqual({ type: 'call' });
    const wrong = await post('/api/action', actionBody(table, { type: 'allIn' }));
    expect(wrong.status).toBe(409); expect(wrong.table).toEqual(table);
    expect((await post('/api/lesson', lessonBody(table, 'answer', '0'))).status).toBe(409);
    expect((await post('/api/lesson', lessonBody(table, 'next'))).status).toBe(409);
    for (let lesson = 0; lesson < 3; lesson++) {
      expect(table.tutorial?.lesson).toBe(lesson);
      expect(await restored()).toEqual(table);
      table = await finishLesson(table);
      expect(renderTable(table)).not.toContain('data-action="continue"');
      expect((await post('/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex })).status).toBe(409);
      const badAnswer = ['1', '0', '0'][lesson]!;
      table = (await post('/api/lesson', lessonBody(table, 'answer', badAnswer))).table;
      expect(table.tutorial?.solved).toBe(false); expect(table.tutorial?.feedback).toContain('再想一想');
      const answer = lessonBody(table, 'answer', ['0', '2', '1'][lesson]);
      const solved = await post('/api/lesson', answer); expect(solved.status).toBe(200); table = solved.table;
      expect(table.tutorial?.solved).toBe(true);
      expect((await post('/api/lesson', answer)).status).toBe(409);
      expect(await restored()).toEqual(table);
      if (lesson < 2) {
        const old = table;
        const next = await post('/api/lesson', lessonBody(table, 'next')); expect(next.status).toBe(200); table = next.table;
        expect(table.id).not.toBe(old.id);
        expect((await post('/api/lesson', lessonBody(old, 'restart'))).status).toBe(409);
      }
    }
    expect(table.tutorial?.complete).toBe(true);
    expect(renderTable(table)).toContain('学完了，开一桌经典德州');
    const free = await post('/api/table', { players: 4 });
    expect(free.table.experience).toBe('free'); expect(free.table.tutorial).toBeNull();
  });
  it('restarts a lesson with the same cards but a new id and rejects old poker commands', async () => {
    let { table } = await post('/api/table', { experience: 'tutorial' });
    const old = table; const oldAction = actionBody(table, { type: 'call' });
    table = (await post('/api/lesson', lessonBody(table, 'restart'))).table;
    expect(table.id).not.toBe(old.id); expect(table.view.holeCards).toEqual(old.view.holeCards);
    expect((await post('/api/action', oldAction)).status).toBe(409);
  });
  it('keeps reply independent from poker, private abilities and refresh', async () => {
    let { table } = await post('/api/table', { experience: 'living', mode: 'ability-lab' });
    expect(table.roster.map((person) => person.name)).toEqual(['你', '林岚', '阿凯', '莫叔']);
    const before = table;
    const reply = { tableId: table.id, expectedPacketIndex: table.packet.packetIndex, revision: table.living!.revision,
      promptId: 'opening', choice: 'warm' };
    const result = await post('/api/reply', reply); expect(result.status).toBe(200); table = result.table;
    expect(table.packet).toEqual(before.packet); expect(table.view).toEqual(before.view);
    expect((await post('/api/reply', reply)).status).toBe(409);
    const social = table.living!;
    if (table.packet.kind !== 'decision' || !table.packet.abilities) throw new Error('Expected ability decision');
    const peek = table.packet.abilities.availableCommands.find((command) => command.ability === 'peek');
    if (!peek) throw new Error('Expected target');
    const ability = await post('/api/action', { tableId: table.id, command: { ...peek, type: 'useAbility',
      decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } });
    expect(ability.status).toBe(200); table = ability.table;
    expect(table.living!.notes).toEqual(social.notes); expect(table.living!.lines).toEqual(social.lines);
    expect(table.view.seats.filter((seat) => seat.seatIndex > 0).every((seat) => seat.cards === null)).toBe(true);
    expect(await restored()).toEqual(table);
    const muted = renderTable(table, true);
    expect(muted).toContain('闲聊已收起'); expect(muted).toContain('本场人物观察'); expect(muted).toContain('你的操作');
  });
  it('ends the prologue after at most six hands without reallocating chips', async () => {
    let { table } = await post('/api/table', { experience: 'living' });
    let steps = 0;
    while (!table.living!.ended && steps++ < 35) {
      const response = table.packet.kind === 'decision' ? await post('/api/action', actionBody(table,
        table.packet.observation.legalActions.fold ? { type: 'fold' } : { type: 'check' }))
        : await post('/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
      expect(response.status, response.error).toBe(200);
      table = response.table;
    }
    expect(table.living!.ended).toBe(true); expect(table.view.handNumber).toBeLessThanOrEqual(6);
    expect(table.view.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(400);
    expect(renderTable(table)).toContain('这一夜，先到这里');
    const refused = await post('/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
    expect(refused.status).toBe(409); expect(refused.table).toEqual(table);
  });
});
