import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_TOURNAMENT_CONFIG } from '../../src/cli/index.js';
import { openGameSession, submitSessionCommand } from '../../src/game/game-session.js';
import type { SessionCommand } from '../../src/game/session-types.js';
import type { WebTable, SeatIdentity } from '../../src/web/protocol.js';
import { advanceTableView } from '../../src/web/view.js';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** Browser IO only: track controls emitted by the real renderer, not layout or poker state. */
function installBrowserIO() {
  class Input {
    value: string;
    disabled = false;
    constructor(value: string) { this.value = value; }
    focus() { documentIO.activeElement = this; }
  }
  class Details {
    dataset: { panel: string };
    open: boolean;
    isConnected = true;
    constructor(panel: string, open: boolean) { this.dataset = { panel }; this.open = open; }
  }
  class Surface extends EventTarget {
    #html = '';
    #raise: Input | null = null;
    #panels: Details[] = [];
    textContent = ''; hidden = false; action = '';
    returnValue = ''; open = false;
    actionData: Record<string, string> = {};
    get innerHTML() { return this.#html; }
    set innerHTML(html: string) {
      this.#panels.forEach((panel) => { panel.isConnected = false; });
      this.#html = html;
      const input = html.match(/<input\b[^>]*\bid="raise-amount"[^>]*>/)?.[0];
      this.#raise = input ? new Input(input.match(/\bvalue="([^"]*)"/)?.[1] ?? '') : null;
      this.#panels = [...html.matchAll(/<details\b[^>]*\bdata-panel="([^"]+)"[^>]*>/g)]
        .map(([tag, panel]) => new Details(panel!, /\sopen(?=\s|>)/.test(tag)));
    }
    showModal() { this.open = true; }
    setAttribute() {}
    querySelector(selector: string) { return selector === '#raise-amount' ? this.#raise : null; }
    querySelectorAll(selector: string) {
      if (selector === 'details[data-panel]') return this.#panels;
      if (selector === 'button,input,select') return this.#raise ? [this.#raise] : [];
      return [];
    }
    panel(name: string): Details {
      const panel = this.#panels.find((item) => item.dataset.panel === name);
      if (!panel) throw new Error(`Real renderer did not emit panel ${name}`);
      return panel;
    }
    togglePanel(name: string, open: boolean): Details {
      const panel = this.panel(name);
      panel.open = open;
      // Node EventTarget has no DOM parent tree; deliver the browser's captured target.
      const event = new Event('toggle');
      Object.defineProperty(event, 'target', { value: panel });
      this.dispatchEvent(event);
      return panel;
    }
    closest() { return { dataset: { action: this.action, ...this.actionData } }; }
  }
  const app = new Surface();
  const dialog = new Surface();
  const sync = new Surface();
  const surfaces: Record<string, Surface> = { '#app': app, '#notice': new Surface(), '#connection': new Surface(),
    '#sync': sync, '#replace-table-dialog': dialog };
  const documentIO = {
    querySelector: (selector: string) => surfaces[selector],
    activeElement: null as Input | null,
    body: { classList: { toggle: vi.fn() } },
  };
  const windowIO = Object.assign(new EventTarget(), { scrollTo: vi.fn() });
  vi.stubGlobal('document', documentIO);
  vi.stubGlobal('window', windowIO);
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
  vi.stubGlobal('HTMLDetailsElement', Details);
  return { app, dialog, sync, documentIO, windowIO };
}

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
  const { app, dialog } = installBrowserIO();
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
  const { app } = installBrowserIO();
  app.action = ability;
  app.actionData = { targetSeat: '1', holeIndex: '0' };
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

async function openPresentationTable() {
  const roster: SeatIdentity[] = [
    { seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', characterId: 'hero', style: '' },
    { seatIndex: 1, playerId: '林岚', name: '林岚', nickname: '猎手', characterId: 'hunter', style: '' },
  ];
  const opened = await openGameSession({ mode: 'classic', config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 2 },
    runSeed: 'client-presentation', humanSeatIndex: 0, seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
    participants: [null, { playerId: '林岚', decide: async ({ observation }) => ({
      action: { type: observation.legalActions.check ? 'check' : 'call' },
    }) }],
  });
  const table: WebTable = { id: 'presentation', mode: 'classic', roster, packet: opened.packet,
    view: advanceTableView(null, opened.packet, roster) };
  return { ...opened, table };
}

it.each([false, true])('restores from the home ticket once without advancing or replaying animations (lost response: %s)', async (lostResponse) => {
  const first = await openPresentationTable();
  if (first.packet.kind !== 'decision') throw new Error('Expected decision');
  const result = await submitSessionCommand(first.handle, { type: 'act', intent: { type: 'fold' },
    decisionKey: first.packet.decisionKey, expectedPacketIndex: first.packet.packetIndex });
  if (!result.accepted || result.step.packet.kind !== 'hand-result') throw new Error('Expected result');
  const save = { enabled: true, current: true, saved: { id: 'checkpoint-1', savedAt: '2026-09-22T10:00:00.000Z',
    hand: 1, heroStack: 99, players: 2, mode: 'classic' as const, experience: 'free' as const, lesson: null, ended: false }, error: null };
  const restored: WebTable = { ...first.table, id: 'restored', packet: result.step.packet,
    view: advanceTableView(first.table.view, result.step.packet, first.table.roster), save };
  let current: WebTable | null = null;
  const posts: string[] = [];
  const { app } = installBrowserIO();
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(path);
      expect(path).toBe('/api/resume');
      expect(JSON.parse(init.body as string)).toEqual({ checkpointId: 'checkpoint-1' });
      current = restored;
      if (lostResponse) throw new TypeError('lost response after restore');
      return Response.json({ table: current });
    }
    return Response.json({ table: current, rosters: { 2: first.table.roster }, save });
  });
  await import('../../src/web/client.js');
  await vi.waitFor(() => expect(app.innerHTML).toContain('data-action="restore"'));
  app.action = 'restore'; app.dispatchEvent(new Event('click')); app.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(app.innerHTML).toContain('本手结算'));
  expect(app.innerHTML).toContain('已保存到第 1 手结算');
  expect(app.innerHTML).not.toContain('正在播放');
  expect(posts).toEqual(['/api/resume']);
});

it('preserves the raise draft and focus only while the same table and decision remain visible', async () => {
  const first = await openPresentationTable();
  let current = first.table;
  const { app, sync, documentIO, windowIO } = installBrowserIO();
  vi.stubGlobal('fetch', async () => Response.json({ table: current, rosters: { 2: current.roster } }));
  await import('../../src/web/client.js');
  await vi.waitFor(() => expect(app.querySelector('#raise-amount')).not.toBeNull());
  const original = app.querySelector('#raise-amount')!;
  original.value = '37';
  original.focus();
  app.action = 'toggle-talk'; app.dispatchEvent(new Event('click'));
  const retained = app.querySelector('#raise-amount')!;
  expect(retained).not.toBe(original);
  expect(retained.value).toBe('37');
  expect(documentIO.activeElement).toBe(retained);
  expect(windowIO.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0);

  if (first.packet.kind !== 'decision') throw new Error('Expected initial decision');
  const result = await submitSessionCommand(first.handle, { type: 'act', intent: { type: 'call' },
    decisionKey: first.packet.decisionKey, expectedPacketIndex: first.packet.packetIndex });
  if (!result.accepted || result.step.packet.kind !== 'decision') throw new Error('Expected next decision');
  expect(result.step.packet.decisionKey).not.toBe(first.packet.decisionKey);
  current = { ...current, packet: result.step.packet, view: advanceTableView(current.view, result.step.packet, current.roster) };
  const nextMinimum = result.step.packet.actionPanel.commands.find((command) => command.kind === 'raise-range');
  if (!nextMinimum) throw new Error('Expected next legal raise range');
  sync.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(app.querySelector('#raise-amount')).not.toBe(retained));
  expect(app.querySelector('#raise-amount')?.value).toBe(String(nextMinimum.minimum));
  expect(windowIO.scrollTo).toHaveBeenCalledTimes(1);
});

it('does not carry a raise draft to a replacement table with the same decision key', async () => {
  const first = await openPresentationTable();
  let current = first.table;
  const { app, sync, windowIO } = installBrowserIO();
  vi.stubGlobal('fetch', async () => Response.json({ table: current, rosters: { 2: current.roster } }));
  await import('../../src/web/client.js');
  await vi.waitFor(() => expect(app.querySelector('#raise-amount')).not.toBeNull());
  const original = app.querySelector('#raise-amount')!;
  const initialMinimum = original.value;
  original.value = '37';
  current = { ...current, id: 'replacement' };
  expect(current.packet).toBe(first.packet); // The hand/seat/decision key is deliberately identical.
  sync.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(app.querySelector('#raise-amount')).not.toBe(original));
  expect(app.querySelector('#raise-amount')?.value).toBe(initialMinimum);
  expect(windowIO.scrollTo).toHaveBeenCalledTimes(2);
});

it('retains outer and inner panel choices across redraws and clears them for a replacement table', async () => {
  const first = await openPresentationTable();
  let current = first.table;
  const { app, sync } = installBrowserIO();
  vi.stubGlobal('fetch', async () => Response.json({ table: current, rosters: { 2: current.roster } }));
  await import('../../src/web/client.js');
  await vi.waitFor(() => expect(app.innerHTML).toContain('data-panel="notebook"'));
  const oldNotebook = app.togglePanel('notebook', true);
  const oldHistory = app.togglePanel('history', true);
  app.action = 'toggle-talk'; app.dispatchEvent(new Event('click'));
  expect(app.panel('notebook')).not.toBe(oldNotebook);
  expect(app.panel('notebook').open).toBe(true);
  expect(app.panel('history')).not.toBe(oldHistory);
  expect(app.panel('history').open).toBe(true);
  app.togglePanel('history', false);
  app.dispatchEvent(new Event('click'));
  expect(app.panel('notebook').open).toBe(true);
  expect(app.panel('history').open).toBe(false);

  const retainedNotebook = app.panel('notebook');
  current = { ...current, id: 'replacement' };
  sync.dispatchEvent(new Event('click'));
  await vi.waitFor(() => expect(app.panel('notebook')).not.toBe(retainedNotebook));
  expect(app.panel('notebook').open).toBe(false);
  expect(app.panel('history').open).toBe(false);
});
