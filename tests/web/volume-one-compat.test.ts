import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js', () => ({ loadProxyDetector: () => () => false }));
import { createBrowserApi } from '../../src/web/browser-api.js';
import { createLocalServer } from '../../src/web/server.js';
import { validCheckpoint, type Checkpoint, type CheckpointStore } from '../../src/web/checkpoint-data.js';
import type { BrowserStore, SaveSlot } from '../../src/web/browser-store.js';
import type { Bootstrap, WebTable } from '../../src/web/protocol.js';
import { compatibleStorySave, VOLUME_ONE_RELEASE_BUILDS } from '../../src/web/story-compat.js';

type Fixture = { checkpoint: Checkpoint; campaign: NonNullable<WebTable['campaign']> };
const fixtures = JSON.parse(await readFile(new URL('../fixtures/volume-one-release.json', import.meta.url), 'utf8')) as {
  opening: Fixture; complete: Fixture; practiceLoss: Fixture;
};
class Store implements BrowserStore {
  value: Checkpoint;
  writes = 0;
  constructor(saved: Checkpoint) { this.value = structuredClone(saved); }
  async read(slot?: SaveSlot) { return slot === 'journey' ? structuredClone(this.value) : null; }
  async write(value: Checkpoint, previous: string | null, slot?: SaveSlot) {
    expect(slot).toBe('journey');
    expect(previous).toBe(this.value.summary.id);
    expect(validCheckpoint(value)).toBe(true);
    this.value = structuredClone(value); this.writes++;
  }
}

describe('published Volume One save continuity', () => {
  for (const name of ['opening', 'complete', 'practiceLoss'] as const) {
    it(`replays the actual release ${name} checkpoint with the exact old digest and view`, async () => {
      const fixture = fixtures[name], store = new Store(fixture.checkpoint);
      const api = createBrowserApi(store, 'volume-two-test');
      const response = await api('/api/resume', JSON.stringify({ slot: 'journey', checkpointId: store.value.summary.id }));
      expect(response.status, response.body.error).toBe(200);
      expect(response.body.table?.campaign).toEqual(fixture.campaign);
      expect(store.writes).toBe(0); // Reading the old ending never rewrites it.
    });
  }

  it('accepts only the verified release source, Node and Pages fingerprints', async () => {
    for (const engine of VOLUME_ONE_RELEASE_BUILDS) {
      const saved = { ...structuredClone(fixtures.opening.checkpoint), engine };
      const api = createBrowserApi(new Store(saved), 'volume-two-test');
      const r = await api('/api/resume', JSON.stringify({ slot: 'journey', checkpointId: saved.summary.id }));
      expect(r.status, r.body.error).toBe(200);
    }
    expect(compatibleStorySave({ ...fixtures.opening.checkpoint, engine: 'unknown-build' }, 'volume-two-test')).toBe(false);
    expect(compatibleStorySave({ ...fixtures.opening.checkpoint, setup: { ...fixtures.opening.checkpoint.setup, experience: 'free' } }, 'volume-two-test')).toBe(false);
  });

  for (const corruption of ['unknown-engine', 'digest', 'journal'] as const) {
    it(`refuses ${corruption} without replacing the old save`, async () => {
      const saved = structuredClone(fixtures.opening.checkpoint);
      if (corruption === 'unknown-engine') saved.engine = 'unknown-build';
      if (corruption === 'digest') saved.digest = '0'.repeat(64);
      if (corruption === 'journal') saved.journal = [];
      const store = new Store(saved), before = structuredClone(store.value);
      const r = await createBrowserApi(store, 'volume-two-test')('/api/resume', JSON.stringify({ slot: 'journey', checkpointId: saved.summary.id }));
      expect(r.status).not.toBe(200);
      expect(store.value).toEqual(before); expect(store.writes).toBe(0);
    });
  }

  it('continues a released ending into the sequel and restores the new checkpoint', async () => {
    const store = new Store(fixtures.complete.checkpoint);
    let api = createBrowserApi(store, 'volume-two-test');
    const resumed = await api('/api/resume', JSON.stringify({ slot: 'journey', checkpointId: store.value.summary.id }));
    expect(resumed.status, resumed.body.error).toBe(200);
    const t = resumed.body.table!, old = structuredClone(t.campaign!);
    const request = { tableId: t.id, expectedPacketIndex: t.packet.packetIndex,
      input: { operation: 'choose', revision: old.revision, choice: 'continue-volume-two' } };
    const next = await api('/api/story', JSON.stringify(request));
    expect(next.status, next.body.error).toBe(200);
    const s = next.body.table!.campaign!;
    expect(s.night).toBe(7); expect(s.scene).toBe('w-door'); expect(s.phase).toBe('scene');
    expect(s.wallet).toBe(old.wallet); expect(s.ledger).toEqual(old.ledger); expect(s.facts).toEqual(old.facts);
    expect(s.history.slice(0, old.history.length)).toEqual(old.history);
    expect(store.value.summary.storyNight).toBe(7); expect(store.value.summary.ended).toBe(false);
    expect(store.value.engine).toBe('volume-two-test');
    expect((await api('/api/story', JSON.stringify(request))).status).toBe(409);
    api = createBrowserApi(store, 'volume-two-test');
    const again = await api('/api/resume', JSON.stringify({ slot: 'journey', checkpointId: store.value.summary.id }));
    expect(again.status, again.body.error).toBe(200); expect(again.body.table!.campaign).toEqual(s);
  });

  it('validates sequel checkpoint nights without accepting out-of-range chapters', () => {
    const saved = structuredClone(fixtures.complete.checkpoint);
    for (const night of [7, 8, 9, 10, 11, 12]) {
      saved.summary.storyNight = night; expect(validCheckpoint(saved), String(night)).toBe(true);
    }
    for (const night of [0, 13, 7.5, Number.NaN]) {
      saved.summary.storyNight = night; expect(validCheckpoint(saved), String(night)).toBe(false);
    }
  });

  it('restores the released ending on Node, saves the sequel and restarts at the same line', async () => {
    const token = '00000000-0000-4000-8000-000000000107';
    const saves = new Map<string, Checkpoint>([[`${token}:second-night`, structuredClone(fixtures.complete.checkpoint)]]);
    const store: CheckpointStore = {
      async read(k) { return structuredClone(saves.get(k) ?? null); },
      async write(k, v) { expect(validCheckpoint(v)).toBe(true); saves.set(k, structuredClone(v)); },
    };
    let server = createLocalServer({ checkpointStore: store }), origin = '', cookie = '';
    const start = async () => {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const a = server.address(); if (!a || typeof a === 'string') throw new Error('No address');
      origin = `http://127.0.0.1:${a.port}`; cookie = `holdem_session_${a.port}=${token}`;
    };
    const close = async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); };
    const post = async (path: string, body: unknown) => {
      const r = await fetch(origin + path, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() as { table: WebTable; error?: string } };
    };
    await start();
    try {
      const bootstrap = await (await fetch(origin + '/api/bootstrap', { headers: { cookie } })).json() as Bootstrap;
      expect(bootstrap.journeySave?.error).toBeNull();
      let r = await post('/api/resume', { slot: 'journey', checkpointId: fixtures.complete.checkpoint.summary.id });
      expect(r.status, r.body.error).toBe(200); expect(r.body.table.campaign).toEqual(fixtures.complete.campaign);
      let t = r.body.table;
      r = await post('/api/story', { tableId: t.id, expectedPacketIndex: t.packet.packetIndex,
        input: { operation: 'choose', revision: t.campaign!.revision, choice: 'continue-volume-two' } });
      expect(r.status, r.body.error).toBe(200); t = r.body.table;
      r = await post('/api/story', { tableId: t.id, expectedPacketIndex: t.packet.packetIndex,
        input: { operation: 'next', revision: t.campaign!.revision } });
      expect(r.status, r.body.error).toBe(200);
      const expected = r.body.table.campaign, saved = structuredClone(saves.get(`${token}:second-night`)!);
      expect(saved.summary.storyNight).toBe(7);
      await close(); server = createLocalServer({ checkpointStore: store }); await start();
      r = await post('/api/resume', { slot: 'journey', checkpointId: saved.summary.id });
      expect(r.status, r.body.error).toBe(200); expect(r.body.table.campaign).toEqual(expected);
    } finally { if (server.listening) await close(); }
  });
});
