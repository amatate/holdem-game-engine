import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_TOURNAMENT_CONFIG } from '../../src/cli/index.js';
import { openGameSession } from '../../src/game/game-session.js';
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
  let current: WebTable = { id: 'old', roster, packet, view: advanceTableView(null, packet, roster) };
  // The only doubles are browser IO and a lost network response; the client and renderer are real.
  class Surface extends EventTarget {
    innerHTML = ''; textContent = ''; hidden = false; action = '';
    setAttribute() {}
    querySelectorAll() { return []; }
    closest() { return { dataset: { action: this.action } }; }
  }
  const app = new Surface();
  const surfaces: Record<string, Surface> = { '#app': app, '#notice': new Surface(), '#connection': new Surface(), '#sync': new Surface() };
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
  expect(app.innerHTML).toContain('今晚，几个人');
  app.action = 'start'; app.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(app.innerHTML).toContain('第 27 手'));
  expect(app.innerHTML).not.toContain('今晚，几个人');
  expect(posts).toBe(1);
});
