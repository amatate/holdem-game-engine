import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js', () => ({ loadProxyDetector: () => () => false }));
import { createBrowserApi } from '../../src/web/browser-api.js';
import { validCheckpoint, type Checkpoint } from '../../src/web/checkpoint-data.js';
import type { WebTable } from '../../src/web/protocol.js';
import { openLocalTable } from '../../src/web/table-session.js';
import { renderLobby, renderTable, renderPlaybackFrame } from '../../src/web/render.js';
import { buildPlaybackFrames } from '../../src/web/playback.js';
import { translateText } from '../../src/web/i18n.js';
import { competitiveParticipant, COMPETITIVE_CONFIG } from '../../src/game/competitive-practice.js';
import { arenaAgent } from '../../src/arena/agents.js';
import { createSeededRandom } from '../../src/core/random.js';

afterEach(() => vi.restoreAllMocks());

function host() {
  let saved: Checkpoint | null = null;
  let sequence = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  const store = {
    async read() { return structuredClone(saved); },
    async write(next: Checkpoint, expected: string | null) {
      if ((saved?.summary.id ?? null) !== expected) throw new Error('Conflict');
      saved = structuredClone(next);
    },
  };
  const api = createBrowserApi(store, 'competitive-v1');
  return { api, store, checkpoint: () => saved };
}
type Api = ReturnType<typeof host>['api'];
async function post(api: Api, path: string, body: unknown): Promise<WebTable> {
  const response = await api(path, JSON.stringify(body));
  expect(response.status, response.body.error).toBe(200);
  return response.body.table!;
}
function command(table: WebTable, intent: { type: 'fold' | 'check' | 'call' }) {
  if (table.packet.kind !== 'decision') throw new Error('No decision');
  return { tableId: table.id, command: { type: 'act', intent, decisionKey: table.packet.decisionKey,
    expectedPacketIndex: table.packet.packetIndex } };
}
function english(html: string) {
  // Match the browser projection for reviewed bilingual dialogue and entry labels.
  html=html.replace(/<(span|option)\b(?=[^>]*data-no-i18n)(?=[^>]*data-en="([^"]*)")[^>]*>[^<]*<\/\1>/g,(_all,_tag,en:string)=>`>${en}<`);
  const texts = [...html.matchAll(/>([^<>]*)</g), ...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map(m => m[1]!);
  expect(texts.map(text => translateText(text, 'en')).filter(text => /[\p{Script=Han}]/u.test(text))).toEqual([]);
}

describe('playable competitive baseline', () => {
  it('normalizes settings, isolates abilities/social memory, and preserves classic defaults', async () => {
    const { api } = host();
    const table = await post(api, '/api/table', { experience: 'competitive', players: 6, socialEnabled: true, difficulty: 'casual' });
    expect(table).toMatchObject({ mode: 'classic', experience: 'competitive', difficulty: 'challenging', living: null, tutorial: null });
    expect(table.roster).toHaveLength(2);
    expect(table.roster[1]?.nickname).toBe('竞技基线 v0');
    expect(table.view.seats.reduce((n, seat) => n + seat.stack + seat.committedHand, 0)).toBe(400);
    expect(table.view.seats[1]?.cards).toBeNull();
    expect(table.packet.kind).toBe('decision');
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    expect(table.packet.abilities).toBeNull();
    expect(JSON.stringify(table.packet)).not.toMatch(/runSeed|privateTrace|deckOrder/);
    const denied = await api('/api/action', JSON.stringify({ tableId: table.id, command: {
      type: 'useAbility', ability: 'peek', targetSeatIndex: 1,
      decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex,
    } }));
    expect(denied.status).toBe(409);
    expect(denied.body.table?.packet).toEqual(table.packet);
    expect((await api('/api/table', JSON.stringify({ experience: 'competitive', mode: 'ability-lab' }))).status).toBe(400);
    await expect(openLocalTable(2, 'ability-lab', 'competitive')).rejects.toThrow('经典规则');
    const classic = await post(api, '/api/table', { players: 2, difficulty: 'casual', socialEnabled: true });
    expect(classic.difficulty).toBe('casual');
    expect(classic.living).not.toBeNull();
    expect(classic.view.seats.reduce((n, seat) => n + seat.stack + seat.committedHand, 0)).toBe(200);
  });

  it('uses the same 600-sample arena policy given identical public information and RNG', async () => {
    const { table } = await openLocalTable(2, 'classic', 'competitive', 0, false, 'policy-parity');
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    const observation = table.packet.observation;
    const actual = await competitiveParticipant('test').decide({ observation, random: createSeededRandom('same-policy') });
    const expected = await arenaAgent('hunter-challenge', 600).create().decide({ observation, random: createSeededRandom('same-policy') });
    expect(actual).toEqual(expected);
    expect(actual.privateTrace).toBeUndefined();
    expect(COMPETITIVE_CONFIG.handsPerLevel).toBe(8);
  });

  it('saves, restores and continues the same competitive match without enabling other modes', async () => {
    const { api, store, checkpoint } = host();
    let table = await post(api, '/api/table', { experience: 'competitive' });
    // Check/call exercises real opponent decisions and postflop play, not just lobby setup.
    for (let steps = 0; table.packet.kind === 'decision' && steps < 40; steps++) {
      const legal = table.packet.observation.legalActions;
      table = await post(api, '/api/action', command(table, { type: legal.check ? 'check' : legal.call ? 'call' : 'fold' }));
    }
    expect(table.packet.kind).toBe('hand-result');
    expect(table.view.seats.reduce((n, seat) => n + seat.stack, 0)).toBe(400);
    const saved = checkpoint()!;
    expect(validCheckpoint(saved)).toBe(true);
    expect(saved.setup).toMatchObject({ players: 2, mode: 'classic', experience: 'competitive', difficulty: 'challenging', socialEnabled: false });
    expect(validCheckpoint({ ...saved, setup: { ...saved.setup, mode: 'ability-lab' } })).toBe(false);
    const restoredApi = createBrowserApi(store, 'competitive-v1');
    const restored = await post(restoredApi, '/api/resume', { checkpointId: saved.summary.id });
    expect(restored.packet).toEqual(table.packet);
    expect(restored.experience).toBe('competitive');
    const nextA = await post(api, '/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
    const nextB = await post(restoredApi, '/api/continue', { tableId: restored.id, expectedPacketIndex: restored.packet.packetIndex });
    expect(nextB.packet).toEqual(nextA.packet);
  });

  it('labels the lobby, table, playback and saved entry honestly in both languages', async () => {
    const { api } = host();
    let table = await post(api, '/api/table', { experience: 'competitive' });
    const lobby = renderLobby({}, 2);
    expect(lobby).toContain('data-action="competitive-start"');
    expect(lobby).toContain('非 GTO 求解器');
    english(lobby); english(renderTable(table));
    const frames = buildPlaybackFrames(null, table.packet.viewerEventsSinceLastPacket, table.roster);
    for (const frame of frames) {
      const html = renderPlaybackFrame(frame, table.roster, 1, 1, table.mode, table.experience);
      expect(html).toContain('competitive-banner'); english(html);
    }
    table = await post(api, '/api/action', command(table, { type: 'fold' }));
    expect(table.packet.kind).toBe('hand-result');
    expect(renderLobby({}, 2, 'classic', false, table.save)).toContain('竞技练习 · 实验版 v0');
    english(renderLobby({}, 2, 'classic', false, table.save));
  });
});
