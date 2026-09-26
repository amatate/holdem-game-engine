import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createLocalServer } from '../../src/web/server.js';
import { FileCheckpointStore, tableDigest, type Checkpoint } from '../../src/web/checkpoints.js';
import type { Bootstrap, WebTable } from '../../src/web/protocol.js';
import { renderLobby, renderTable } from '../../src/web/render.js';

let server: Server | undefined;
let directory = '';
let store: FileCheckpointStore;
let port = 0;
let origin = '';
let cookie = '';

async function stop() {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
}
async function start() {
  server = createLocalServer({ checkpointStore: store });
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  port = address.port; origin = `http://127.0.0.1:${port}`;
}
async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'holdem-checkpoint-test-'));
  store = new FileCheckpointStore(directory); cookie = ''; port = 0;
  await start();
}
async function post(path: string, body: unknown) {
  const response = await fetch(origin + path, { method: 'POST', headers: { origin, cookie, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const nextCookie = response.headers.get('set-cookie');
  if (nextCookie) { expect(nextCookie).toContain('Max-Age=15552000'); cookie = nextCookie.split(';')[0]!; }
  return { status: response.status, ...await response.json() as { table: WebTable; error?: string } };
}
async function bootstrap(identity = cookie): Promise<Bootstrap> {
  return await (await fetch(origin + '/api/bootstrap', { headers: { cookie: identity, connection: 'close' } })).json() as Bootstrap;
}
function actionBody(table: WebTable, intent: unknown) {
  if (table.packet.kind !== 'decision') throw new Error('Expected decision');
  return { tableId: table.id, command: { type: 'act', intent, decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } };
}
async function finish(table: WebTable): Promise<WebTable> {
  for (let i = 0; table.packet.kind === 'decision' && i < 20; i++) {
    const intent = table.tutorial?.recommended ?? { type: table.packet.observation.legalActions.fold ? 'fold' : 'check' };
    const response = await post('/api/action', actionBody(table, intent));
    expect(response.status, response.error).toBe(200); table = response.table;
  }
  expect(table.packet.kind).toBe('hand-result');
  return table;
}
async function next(table: WebTable): Promise<WebTable> {
  const response = await post('/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
  expect(response.status, response.error).toBe(200); return response.table;
}
async function checkpointFile() { return join(directory, (await readdir(directory)).find((name) => name.endsWith('.json'))!); }

afterEach(async () => {
  await stop();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

describe('settlement checkpoints across real HTTP server restarts', () => {
  it.each(['classic', 'ability-lab'] as const)('restores %s chips, public memory and deterministic next decisions without double awards', async (mode) => {
    await setup();
    let { table } = await post('/api/table', { players: 2, mode, socialEnabled: true });
    expect((await bootstrap()).save?.saved).toBeNull();
    for (const ability of ['peek', 'swap', 'read'] as const) {
      if (mode === 'ability-lab') {
        // A NPC may win a preflop hand before the hero acts. Advance only settled hands.
        for (let i = 0; table.packet.kind === 'hand-result' && i < 10; i++) table = await next(table);
        if (table.packet.kind !== 'decision') throw new Error('Expected human decision');
        const command = table.packet.abilities!.availableCommands.find((command) => command.ability === ability)!;
        const response = await post('/api/action', { tableId: table.id, command: { type: 'useAbility', ...command,
          decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } });
        expect(response.status, response.error).toBe(200); table = response.table;
      }
      table = await finish(table);
      if (ability !== 'read') table = await next(table);
    }
    let boundary = table;
    expect(boundary.recentHands!.length).toBeGreaterThanOrEqual(3);
    let future = await next(table); // This half-hand must NOT replace the checkpoint.
    for (let i = 0; future.packet.kind === 'hand-result' && i < 10; i++) {
      boundary = future; future = await next(future);
    }
    const checkpointId = boundary.save!.saved!.id;
    expect(future.packet.kind).toBe('decision');
    if (future.packet.kind === 'decision' && mode === 'ability-lab') expect(future.packet.abilities!.charges).toEqual({ peek: 0, read: 0, swap: 0 });
    expect((await bootstrap()).save?.saved?.id).toBe(checkpointId);
    const oldCommand = actionBody(future, { type: 'fold' });
    await stop(); await start();
    const home = await bootstrap();
    expect(home.table).toBeNull(); expect(home.save!.saved!.id).toBe(checkpointId);
    expect(JSON.stringify(home)).not.toMatch(/runSeed|journal|seedHash|decisionKey/);
    const lobby = renderLobby(home.rosters, 4, 'classic', true, home.save);
    expect(lobby).toContain('data-action="restore"'); expect(lobby).toContain('未完成的一手不保存');
    expect((await bootstrap('')).save?.saved).toBeNull();
    const restored = await post('/api/resume', { checkpointId });
    expect(restored.status, restored.error).toBe(200);
    expect(restored.table.id).not.toBe(boundary.id);
    expect(tableDigest(restored.table)).toBe(tableDigest(boundary));
    expect(restored.table.living).toEqual(boundary.living);
    expect((await post('/api/action', oldCommand)).status).toBe(409);
    const repeated = await post('/api/resume', { checkpointId });
    expect(repeated.status).toBe(409); expect(repeated.table).toEqual(restored.table);
    const resumedFuture = await next(restored.table);
    expect(tableDigest(resumedFuture)).toBe(tableDigest(future));
    expect(renderTable(restored.table)).toContain(`最近 ${boundary.recentHands!.length} 手交锋`);
    const file = await checkpointFile();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).not.toContain('privateEventsSinceLastPacket');
  }, 30_000);

  it('preserves story replies at result and the final prologue boundary', async () => {
    await setup();
    let { table } = await post('/api/table', { experience: 'living', mode: 'ability-lab' });
    table = await finish(table);
    let response = await post('/api/reply', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex,
      revision: table.living!.revision, promptId: table.living!.prompt!.id, choice: 'warm' });
    expect(response.status).toBe(200); table = response.table;
    const opening = table;
    await stop(); await start();
    response = await post('/api/resume', { checkpointId: opening.save!.saved!.id });
    expect(response.status, response.error).toBe(200); table = response.table;
    expect(tableDigest(table)).toBe(tableDigest(opening));
    expect(table.living!.notes.find((note) => note.name === '莫叔')?.relationship).toBe('愿意多说一点');
    for (let i = 0; !table.living!.ended && i < 6; i++) table = await finish(await next(table));
    expect(table.living!.ended).toBe(true);
    const ending = table;
    await stop(); await start();
    response = await post('/api/resume', { checkpointId: ending.save!.saved!.id });
    expect(response.status, response.error).toBe(200);
    expect(tableDigest(response.table)).toBe(tableDigest(ending));
    expect((await post('/api/continue', { tableId: response.table.id, expectedPacketIndex: response.table.packet.packetIndex })).status).toBe(409);
  }, 30_000);

  it('restores a solved lesson, not a half-finished next lesson', async () => {
    await setup();
    let { table } = await post('/api/table', { experience: 'tutorial' });
    table = await finish(table);
    const answer = await post('/api/lesson', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex,
      revision: table.tutorial!.revision, operation: 'answer', answer: '0' });
    expect(answer.status).toBe(200); table = answer.table;
    expect(table.tutorial!.solved).toBe(true);
    const completed = table;
    const second = await post('/api/lesson', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex,
      revision: table.tutorial!.revision, operation: 'next' });
    expect(second.status).toBe(200); expect(second.table.tutorial!.lesson).toBe(1);
    expect(second.table.save!.saved).toEqual(completed.save!.saved);
    await stop(); await start();
    const restored = await post('/api/resume', { checkpointId: completed.save!.saved!.id });
    expect(restored.status, restored.error).toBe(200);
    expect(tableDigest(restored.table)).toBe(tableDigest(completed));
  });

  it('keeps the previous save until a replacement table settles; rejects a stale restore selection', async () => {
    await setup();
    const first = await finish((await post('/api/table', { players: 2 })).table);
    const second = (await post('/api/table', { experience: 'tutorial' })).table;
    expect(second.save!.saved).toEqual(first.save!.saved);
    expect(second.save!.current).toBeFalsy();
    const replacement = await finish(second);
    expect(replacement.save!.saved!.id).not.toBe(first.save!.saved!.id);
    await stop(); await start();
    expect((await post('/api/resume', { checkpointId: first.save!.saved!.id })).status).toBe(409);
    expect((await bootstrap()).table).toBeNull();
  });

  it('reports write failure after a successful wager and leaves the prior checkpoint untouched', async () => {
    await setup();
    const first = await finish((await post('/api/table', { players: 2 })).table);
    const bytes = await readFile(await checkpointFile(), 'utf8');
    store.write = async () => { throw new Error('Disk full'); };
    const failed = await finish(await next(first));
    expect(failed.save!.saved).toEqual(first.save!.saved);
    expect(failed.save!.error).toContain('牌局已生效');
    expect((await bootstrap()).table!.save).toEqual(failed.save);
    expect(await readFile(await checkpointFile(), 'utf8')).toBe(bytes);
  });

  it.each(['broken-json', 'changed-engine', 'changed-digest'] as const)('fails closed for %s and never removes the original file', async (fault) => {
    await setup();
    const table = await finish((await post('/api/table', { players: 2 })).table);
    const path = await checkpointFile();
    const record = JSON.parse(await readFile(path, 'utf8')) as Checkpoint;
    const text = fault === 'broken-json' ? '{broken' : JSON.stringify({ ...record,
      ...(fault === 'changed-engine' ? { engine: 'old-version' } : { digest: '0'.repeat(64) }) });
    await writeFile(path, text);
    await stop(); await start();
    const restored = await post('/api/resume', { checkpointId: table.save!.saved!.id });
    expect(restored.status).toBe(409);
    expect((await bootstrap()).table).toBeNull();
    expect(await readFile(path, 'utf8')).toBe(text);
  });
});
