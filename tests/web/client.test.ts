import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_TOURNAMENT_CONFIG } from '../../src/cli/index.js';
import { openGameSession, submitSessionCommand } from '../../src/game/game-session.js';
import type { SessionCommand } from '../../src/game/session-types.js';
import type { WebTable, SeatIdentity } from '../../src/web/protocol.js';
import { advanceTableView } from '../../src/web/view.js';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('shows the recovered replacement table when the create response is lost, without posting again', async () => {
  const roster: SeatIdentity[] = [
    { seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', characterId: 'hero', style: '' },
    { seatIndex: 1, playerId: '林岚', name: '林岚', nickname: '猎手', characterId: 'hunter', style: '' },
  ];
  const { packet } = await openGameSession({ mode: 'classic', config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 2 },
    runSeed: 'client-recovery', humanSeatIndex: 0, seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
    participants: [null, { playerId: '林岚', decide: async () => ({ action: { type: 'fold' } }) }],
  });
  let current: WebTable = { id: 'old', mode: 'classic', roster, packet, view: advanceTableView(null, packet, roster) };
  // The only doubles are browser IO and a lost network response; the client and renderer are real.
  class Surface extends EventTarget {
    innerHTML = ''; textContent = ''; hidden = false; action = '';
    returnValue = ''; open = false;
    showModal() { this.open = true; }
    setAttribute() {}
    querySelectorAll() { return []; }
    closest() { return { dataset: { action: this.action } }; }
  }
  const app = new Surface();
  const dialog = new Surface();
  const surfaces: Record<string, Surface> = { '#app': app, '#notice': new Surface(), '#connection': new Surface(), '#sync': new Surface(), '#replace-table-dialog': dialog };
  vi.stubGlobal('document', { querySelector: (selector: string) => surfaces[selector] });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { confirm: () => true }));
  let posts = 0;
  vi.stubGlobal('fetch', async (path: string) => {
    if (path === '/api/table') {
      posts++;
      current = { ...current, id: 'replacement', view: { ...current.view, handNumber: 27 } };
      throw new TypeError('response lost after commit');
    }
    return Response.json({ table: current, rosters: { 2: roster, 4: roster } });
  });
  await import('../../src/web/client.js');
  await vi.waitFor(() => expect(app.innerHTML).toContain('data-action="new"'));
  app.action = 'new'; app.dispatchEvent(new Event('click'));
  expect(dialog.open).toBe(true);
  expect(app.innerHTML).not.toContain('今晚，几个人');
  dialog.returnValue = 'cancel'; dialog.dispatchEvent(new Event('close'));
  expect(app.innerHTML).not.toContain('今晚，几个人');
  app.action = 'new'; app.dispatchEvent(new Event('click'));
  dialog.returnValue = 'choose'; dialog.dispatchEvent(new Event('close'));
  expect(app.innerHTML).toContain('今晚，几个人');
  app.action = 'start'; app.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(app.innerHTML).toContain('第 27 手'));
  expect(app.innerHTML).not.toContain('今晚，几个人');
  expect(posts).toBe(1);
});

it.each(['peek', 'read', 'swap'] as const)('recovers a lost %s response without reusing the ability or submitting a poker action', async (ability) => {
  const roster: SeatIdentity[] = [
    { seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', characterId: 'hero', style: '' },
    { seatIndex: 1, playerId: '林岚', name: '林岚', nickname: '猎手', characterId: 'hunter', style: '' },
  ];
  const first = await openGameSession({ mode: 'ability-lab', config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 2 },
    runSeed: 'peek-client-recovery', humanSeatIndex: 0, seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
    participants: [null, { playerId: '林岚', decide: async () => ({ action: { type: 'fold' } }) }],
  });
  let current: WebTable = { id: 'lab', mode: 'ability-lab', roster, packet: first.packet,
    view: advanceTableView(null, first.packet, roster) };
  class Surface extends EventTarget {
    innerHTML = ''; textContent = ''; hidden = false;
    setAttribute() {}
    querySelectorAll() { return []; }
    closest() { return { dataset: { action: ability, targetSeat: '1', holeIndex: '0' } }; }
  }
  const app = new Surface();
  const surfaces: Record<string, Surface> = { '#app': app, '#notice': new Surface(), '#connection': new Surface(), '#sync': new Surface() };
  vi.stubGlobal('document', { querySelector: (selector: string) => surfaces[selector] });
  vi.stubGlobal('window', new EventTarget());
  const commands: SessionCommand[] = [];
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === '/api/action') {
      const body = JSON.parse(init!.body as string) as { command: SessionCommand };
      commands.push(body.command);
      const result = await submitSessionCommand(first.handle, body.command);
      if (!result.accepted) throw new Error('Expected successful peek');
      current = { ...current, packet: result.step.packet,
        view: advanceTableView(current.view, result.step.packet, roster) };
      throw new TypeError('response lost after ability committed');
    }
    return Response.json({ table: current, rosters: { 2: roster } });
  });
  await import('../../src/web/client.js');
  await vi.waitFor(() => expect(app.innerHTML).toContain('偷看 林岚'));
  app.dispatchEvent(new Event('click'));
  app.dispatchEvent(new Event('click')); // A fast second click must not become another request.
  await vi.waitFor(() => expect(app.innerHTML).toContain('本手私有情报'));
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ type: 'useAbility', ability });
  expect(app.innerHTML).toContain('本场剩余 0 / 1');
  expect(app.innerHTML).not.toContain(`data-action="${ability}"`);
  expect(current.packet.kind === 'decision' && current.packet.decisionKey)
    .toBe(first.packet.kind === 'decision' && first.packet.decisionKey);
});
