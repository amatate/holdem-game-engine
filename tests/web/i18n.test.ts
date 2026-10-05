import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../src/game/proxy-detection.js', () => ({ loadProxyDetector: () => () => false }));
import { EN_MESSAGES, EN_TEMPLATES } from '../../src/web/i18n-catalog.js';
import { chooseLocale, projectSlot, translateText } from '../../src/web/i18n.js';
import { createBrowserApi } from '../../src/web/browser-api.js';
import { renderLobby, renderTable, renderPlaybackFrame } from '../../src/web/render.js';
import { buildPlaybackFrames } from '../../src/web/playback.js';
import type { WebTable } from '../../src/web/protocol.js';
import type { Checkpoint } from '../../src/web/checkpoint-data.js';

afterEach(() => vi.restoreAllMocks());
const han = /[\p{Script=Han}]/u;
function assertEnglish(html: string) {
  // Inspect text nodes and human-readable labels, never command values or machine IDs.
  const texts = [...html.matchAll(/>([^<>]*)</g)].map(match => match[1]!)
    .concat([...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map(match => match[1]!));
  const untranslated = texts.map(source => ({ source, en: translateText(source, 'en') }))
    .filter(item => han.test(item.en));
  expect(untranslated).toEqual([]);
}
function host() {
  let value: Checkpoint | null = null;
  let sequence = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  return createBrowserApi({
    async read() { return structuredClone(value); },
    async write(next, expected) {
      if ((value?.summary.id ?? null) !== expected) throw new Error('Save conflict');
      value = structuredClone(next);
    },
  }, 'i18n-test');
}
type Api = ReturnType<typeof host>;
async function post(api: Api, path: string, body: unknown): Promise<WebTable> {
  const response = await api(path, JSON.stringify(body));
  expect(response.status, response.body.error).toBe(200);
  return response.body.table!;
}
function inspect(table: WebTable, previous: WebTable | null) {
  const before = JSON.stringify(table);
  assertEnglish(renderTable(table));
  for (const frame of buildPlaybackFrames(previous?.view ?? null, table.packet.viewerEventsSinceLastPacket, table.roster,
    table.living ? { packetIndex: table.packet.packetIndex, lines: table.living.lines, memories: table.living.memories } : undefined)) {
    assertEnglish(renderPlaybackFrame(frame, table.roster, 1, 1, table.mode));
  }
  expect(JSON.stringify(table)).toBe(before);
}
async function finish(api: Api, table: WebTable, fold = false) {
  for (let step = 0; table.packet.kind === 'decision' && step < 50; step++) {
    const legal = table.packet.observation.legalActions;
    const intent = table.tutorial?.recommended ?? { type: fold && legal.fold ? 'fold' : legal.check ? 'check' : legal.call ? 'call' : 'fold' };
    const next = await post(api, '/api/action', { tableId: table.id, command: {
      type:'act', intent, decisionKey:table.packet.decisionKey, expectedPacketIndex:table.packet.packetIndex,
    } });
    inspect(next, table); table = next;
  }
  expect(table.packet.kind).not.toBe('decision');
  return table;
}

it('has unique, complete translations, including numeric messages', () => {
  expect(new Set(EN_MESSAGES.map(([key]) => key)).size).toBe(EN_MESSAGES.length);
  for (const [source, expected] of [...EN_MESSAGES, ...EN_TEMPLATES]) {
    const materialize = (s: string) => s.replace(/\{\d+\}/g, '12');
    expect(translateText(materialize(source), 'en').trim(), source).toBe(materialize(expected).trim());
    expect(translateText(source, 'zh-CN')).toBe(source);
  }
});
it('chooses a share-link override, then the saved preference, then the browser language', () => {
  expect(chooseLocale('en', 'zh-CN', 'zh-TW')).toBe('en');
  expect(chooseLocale('zh', 'en', 'en-US')).toBe('zh-CN');
  expect(chooseLocale(null, 'en', 'zh-CN')).toBe('en');
  expect(chooseLocale('invalid', null, 'zh-HK')).toBe('zh-CN');
  expect(chooseLocale(null, null, 'fr-FR')).toBe('en');
});
it('round-trips exact text and accepts new rendered amounts without translating identifiers', () => {
  let slot = projectSlot(' 跟注 1,234（全下） ', undefined, 'en');
  expect(slot.rendered).toBe(' Call 1,234 (All-in) ');
  slot = projectSlot(slot.rendered, slot, 'zh-CN');
  expect(slot.rendered).toBe(' 跟注 1,234（全下） ');
  slot = projectSlot('跟注 2', slot, 'en');
  expect(slot.rendered).toBe('Call 2');
  expect(translateText('A♠ T♥ /api/action table-123 ability-lab', 'en')).toBe('A♠ T♥ /api/action table-123 ability-lab');
});
it.each([2,3,4,5,6])('translates classic %i-player play, public notes and settlement without mutating state', async players => {
  const api = host();
  const bootstrap = await api('/api/bootstrap');
  assertEnglish(renderLobby(bootstrap.body.rosters!, players, 'classic', true, bootstrap.body.save));
  let table = await post(api, '/api/table', { players, mode:'classic', socialEnabled:true });
  inspect(table, null);
  table = await finish(api, table);
  assertEnglish(renderLobby(bootstrap.body.rosters!, players, 'classic', true, table.save));
});
it.each(['peek','read','swap'] as const)('translates %s ability results and keeps opponent cards hidden', async ability => {
  const api = host();
  let table = await post(api, '/api/table', { players:4, mode:'ability-lab', socialEnabled:true });
  if (table.packet.kind !== 'decision') throw new Error('Decision expected');
  const selected = table.packet.abilities!.availableCommands.find(command => command.ability === ability)!;
  const next = await post(api, '/api/action', { tableId:table.id, command:{ type:'useAbility', ...selected,
    decisionKey:table.packet.decisionKey, expectedPacketIndex:table.packet.packetIndex } });
  inspect(next, table); table = next;
  expect(table.view.seats.filter(seat => seat.seatIndex !== 0).every(seat => seat.cards === null)).toBe(true);
  await finish(api, table);
});
it('translates all three tutorial lessons, questions, feedback and guided errors', async () => {
  const api = host();
  let table = await post(api, '/api/table', { players:2, mode:'classic', experience:'tutorial' });
  if (table.packet.kind !== 'decision') throw new Error('Decision expected');
  const wrongAction = await api('/api/action', JSON.stringify({ tableId:table.id, command:{
    type:'act', intent:{type:'fold'}, decisionKey:table.packet.decisionKey, expectedPacketIndex:table.packet.packetIndex,
  } }));
  expect(wrongAction.status).toBe(409);
  expect(wrongAction.body.error).toBeTruthy();
  expect(translateText(wrongAction.body.error!, 'en')).not.toMatch(han);
  expect((await api('/api/bootstrap')).body.table).toEqual(table);
  for (const answer of ['0','2','1']) {
    inspect(table, null);
    table = await finish(api, table);
    table = await post(api, '/api/lesson', { tableId:table.id, expectedPacketIndex:table.packet.packetIndex,
      revision:table.tutorial!.revision, operation:'answer', answer });
    inspect(table, null);
    if (!table.tutorial!.complete) table = await post(api, '/api/lesson', {
      tableId:table.id, expectedPacketIndex:table.packet.packetIndex, revision:table.tutorial!.revision, operation:'next' });
  }
  expect(table.tutorial?.complete).toBe(true);
});
it.each(['quiet','warm','direct'])('translates a six-hand story and the %s dialogue branch', async choice => {
  const api = host();
  let table = await post(api, '/api/table', { players:4, mode:'classic', experience:'living' });
  for (let hand = 0; hand < 7; hand++) {
    inspect(table, null);
    if (table.living?.prompt) {
      table = await post(api, '/api/reply', { tableId:table.id, expectedPacketIndex:table.packet.packetIndex,
        revision:table.living.revision, promptId:table.living.prompt.id, choice });
      inspect(table, null);
    }
    if (table.living?.ended) break;
    table = await finish(api, table, true);
    if (!table.living?.ended) table = await post(api, '/api/continue', { tableId:table.id, expectedPacketIndex:table.packet.packetIndex });
  }
  expect(table.living?.ended).toBe(true);
}, 15_000); // Full six-hand simulations now include public-range inference.
