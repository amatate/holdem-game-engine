import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Exercise the Pages worker's explicit JSON-only build boundary, without Node's Proxy detector.
vi.mock('../../src/game/proxy-detection.js', () => ({ loadProxyDetector: () => () => false }));
import { createBrowserApi } from '../../src/web/browser-api.js';
import type { BrowserStore } from '../../src/web/browser-store.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';
import type { WebTable } from '../../src/web/protocol.js';

class MemoryStore implements BrowserStore {
  value: Checkpoint | null = null;
  fail = false;
  async read() { if (this.fail) throw new Error('Storage denied'); return structuredClone(this.value); }
  async write(value: Checkpoint, expectedId: string | null) {
    if (this.fail || (this.value?.summary.id ?? null) !== expectedId) throw new Error('Storage changed');
    this.value = structuredClone(value);
  }
}
type Api = ReturnType<typeof createBrowserApi>;
const post = (api: Api, path: string, body: unknown) => api(path, JSON.stringify(body));
function action(table: WebTable, intent: unknown) {
  if (table.packet.kind !== 'decision') throw new Error('Expected decision');
  return { tableId: table.id, command: { type: 'act', intent, decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } };
}
async function finish(api: Api, table: WebTable) {
  for (let n = 0; table.packet.kind === 'decision' && n < 30; n++) {
    const intent = table.tutorial?.recommended ?? { type: table.packet.observation.legalActions.fold ? 'fold' : 'check' };
    const result = await post(api, '/api/action', action(table, intent));
    expect(result.status, result.body.error).toBe(200); table = result.body.table!;
  }
  expect(table.packet.kind).toBe('hand-result'); return table;
}
beforeEach(() => {
  let sequence = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
});
afterEach(() => vi.restoreAllMocks());

describe('Pages JSON host', () => {
  it.each(['casual', 'standard', 'challenging'])('persists and restores %s strength in both social and quiet play', async difficulty => {
    for (const socialEnabled of [true, false]) {
      const store = new MemoryStore(), api = createBrowserApi(store, 'difficulty-v1');
      const opened = await post(api, '/api/table', { players: 2, difficulty, socialEnabled });
      expect(opened.status, opened.body.error).toBe(200);
      expect(opened.body.table?.difficulty).toBe(difficulty);
      const table = await finish(api, opened.body.table!);
      expect(store.value?.setup.difficulty).toBe(difficulty);
      const restored = await post(createBrowserApi(store, 'difficulty-v1'), '/api/resume', { checkpointId: store.value!.summary.id });
      expect(restored.status, restored.body.error).toBe(200);
      expect(restored.body.table?.difficulty).toBe(difficulty);
      expect(restored.body.table?.packet).toEqual(table.packet);
    }
  });
  it('rejects invalid difficulty and keeps tutorial scripting independent', async () => {
    const api = createBrowserApi(new MemoryStore(), 'v1');
    for (const difficulty of ['extreme', 3, {}, false, null]) expect((await post(api, '/api/table', { players: 2, difficulty })).status).toBe(400);
    const reply = await post(api, '/api/table', { players: 2, difficulty: 'challenging', experience: 'tutorial' });
    expect(reply.status).toBe(200); expect(reply.body.table?.difficulty).toBe('standard');
  });
  it.each([2, 3, 4, 5, 6])('opens %i seats without Node proxy APIs or hidden data in replies', async (players) => {
    const store = new MemoryStore(), api = createBrowserApi(store, 'test-v1');
    const reply = await post(api, '/api/table', { players, socialEnabled: true });
    expect(reply.status, reply.body.error).toBe(200);
    expect(reply.body.table!.roster).toHaveLength(players);
    expect(JSON.stringify(reply.body)).not.toContain('runSeed');
    expect(reply.body.table!.view.seats.filter((s) => s.seatIndex !== 0).every((s) => s.cards === null)).toBe(true);
    expect(store.value).toBeNull();
  });
  it.each(['classic', 'ability-lab'] as const)('restores %s settled state, rejects stale actions and resumes deterministically', async (mode) => {
    const store = new MemoryStore(), api = createBrowserApi(store, 'test-v1');
    let table = (await post(api, '/api/table', { players: 2, mode, socialEnabled: true })).body.table!;
    expect(table.packet.kind).toBe('decision');
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    if (mode === 'ability-lab') {
      const choice = table.packet.abilities!.availableCommands.find((c) => c.ability === 'peek')!;
      const body = { tableId: table.id, command: { type: 'useAbility', ...choice,
        decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } };
      const peeked = await post(api, '/api/action', body);
      expect(peeked.status).toBe(200); table = peeked.body.table!;
      expect(table.view.seats[1]!.cards).toBeNull();
      expect((await post(api, '/api/action', body)).status).toBe(409);
    }
    table = await finish(api, table);
    expect(store.value?.summary.hand).toBe(1);
    const restoredApi = createBrowserApi(store, 'test-v1');
    expect((await restoredApi('/api/bootstrap')).body.table).toBeNull();
    const restored = await post(restoredApi, '/api/resume', { checkpointId: store.value!.summary.id });
    expect(restored.status, restored.body.error).toBe(200);
    expect(restored.body.table!.view).toEqual(table.view);
    expect(restored.body.table!.living).toEqual(table.living);
    const one = await post(api, '/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
    const two = await post(restoredApi, '/api/continue', { tableId: restored.body.table!.id, expectedPacketIndex: table.packet.packetIndex });
    expect(one.status).toBe(200); expect(two.status).toBe(200);
    expect(two.body.table!.packet).toEqual(one.body.table!.packet);
    expect(store.value!.summary.hand).toBe(1); // no save for an unfinished hand
  });
  it('guards teaching, persists its answer and refuses incompatible or tampered saves', async () => {
    const store = new MemoryStore(), api = createBrowserApi(store, 'test-v1');
    let table = (await post(api, '/api/table', { players: 2, experience: 'tutorial' })).body.table!;
    expect((await post(api, '/api/action', action(table, { type: 'fold' }))).status).toBe(409);
    table = await finish(api, table);
    table = (await post(api, '/api/lesson', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex,
      revision: table.tutorial!.revision, operation: 'answer', answer: '0' })).body.table!;
    expect(table.tutorial?.solved).toBe(true);
    const completedSave = structuredClone(store.value);
    expect((await post(api, '/api/lesson', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex,
      revision: table.tutorial!.revision, operation: 'next' })).body.table!.tutorial!.lesson).toBe(1);
    expect(store.value).toEqual(completedSave);
    const restoredApi = createBrowserApi(store, 'test-v1');
    const restored = await post(restoredApi, '/api/resume', { checkpointId: store.value!.summary.id });
    expect(restored.status).toBe(200); expect(restored.body.table!.tutorial).toEqual(table.tutorial);
    expect((await post(createBrowserApi(store, 'test-v2'), '/api/resume', { checkpointId: store.value!.summary.id })).status).toBe(409);
    store.value!.digest = '0'.repeat(64);
    const original = structuredClone(store.value);
    expect((await post(createBrowserApi(store, 'test-v1'), '/api/resume', { checkpointId: store.value!.summary.id })).status).not.toBe(200);
    expect(store.value).toEqual(original);
  });
  it('keeps play working when storage is denied; new or other-tab saves are not overwritten early', async () => {
    const store = new MemoryStore(), api = createBrowserApi(store, 'v1');
    let table = (await post(api, '/api/table', { players: 2 })).body.table!;
    table = await finish(api, table); const original = structuredClone(store.value);
    await post(api, '/api/table', { players: 4 });
    expect(store.value).toEqual(original);
    store.fail = true;
    const offline = createBrowserApi(store, 'v1');
    const opened = (await post(offline, '/api/table', { players: 2 })).body.table!;
    expect(opened.save?.error).toBeTruthy();
    const ended = await finish(offline, opened);
    expect(ended.save?.error).toBeTruthy(); expect(store.value).toEqual(original);
  });
  it('rejects malformed routes and payloads without creating a table', async () => {
    const api = createBrowserApi(new MemoryStore(), 'v1');
    for (const input of ['null', '[]', '{', '"hi"', 'x'.repeat(5000)]) expect((await api('/api/table', input)).status).toBe(400);
    expect((await post(api, '/api/table', { players: 9 })).status).toBe(400);
    expect((await post(api, '/api/table', { players: 2, experience: 'tutorial', mode: 'ability-lab' })).status).toBe(400);
    expect((await api('/bad', '{}')).status).toBe(404);
    expect((await api('/api/bootstrap')).body.table).toBeNull();
  });
});
