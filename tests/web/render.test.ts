import { describe, expect, it } from 'vitest';
import { DEFAULT_TOURNAMENT_CONFIG } from '../../src/cli/index.js';
import { openGameSession } from '../../src/game/game-session.js';
import { renderLobby, renderTable } from '../../src/web/render.js';
import { advanceTableView } from '../../src/web/view.js';
import type { SeatIdentity, WebTable } from '../../src/web/protocol.js';

const roster: SeatIdentity[] = [
  { seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', style: '自己决定', characterId: 'hero' },
  { seatIndex: 1, playerId: '林岚', name: '林岚', nickname: '猎手', style: '主动施压', characterId: 'hunter' },
];

describe('browser table rendering', () => {
  it('exposes only current legal commands and renders opponent cards face down', async () => {
    const { packet } = await openGameSession({ mode: 'classic', runSeed: 'web-render', humanSeatIndex: 0,
      config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 2 }, seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
      participants: [null, { playerId: '林岚', decide: async () => ({ action: { type: 'fold' } }) }],
    });
    const html = renderTable({ id: 'table', mode: 'classic', roster, packet, view: advanceTableView(null, packet, roster) });
    expect(html).toContain('data-intent="call"');
    expect(html).not.toContain('data-intent="check"');
    expect(html).toContain('加注到');
    expect(html).toContain('aria-label="未公开的底牌"');
    expect(html).toContain('小盲');
    expect(html).toContain('大盲');
    expect(html).not.toContain('web-render');
    expect(html).toContain('class="action-dock"');
    expect(html).toContain('class="call-due">待跟 1');
    expect(html.indexOf('aria-label="你的操作"')).toBeLessThan(html.indexOf('data-panel="notebook"'));
    expect(html).not.toContain('data-panel="notebook" open');
    expect(html.match(/id="raise-form"/g)).toHaveLength(1);
    expect(html).toContain('aria-describedby="raise-help"');
  });
  it('shows each actual pot winner, best five and net result without offering poker actions', () => {
    const cards = [{ code: 'Js', rank: 11, suit: 's' }, { code: 'Jh', rank: 11, suit: 'h' },
      { code: 'Ac', rank: 14, suit: 'c' }, { code: 'Kh', rank: 13, suit: 'h' }, { code: 'Qs', rank: 12, suit: 's' }] as const;
    const packet: WebTable['packet'] = { schemaVersion: 1, packetIndex: 3, kind: 'hand-result', handNumber: 1,
      coreEventRange: { fromVersionInclusive: 1, toVersionExclusive: 2 }, viewerEventsSinceLastPacket: [], privateEventsSinceLastPacket: [],
      handResult: { handNumber: 1, seats: [
        { seatIndex: 0, playerId: '你', holeCards: [cards[0], cards[2]], category: 'one-pair', bestFive: cards,
          potWon: 20, invested: 10, returned: 3, net: 10, finalStack: 110 },
        { seatIndex: 1, playerId: '林岚', holeCards: null, category: null, bestFive: null,
          potWon: 0, invested: 10, returned: 0, net: -10, finalStack: 90 },
      ], pots: [{ potId: 'pot-0', label: '底池', amount: 20, eligibleSeatIndexes: [0, 1], winnerSeatIndexes: [0], awards: [20] }] } };
    const html = renderTable({ id: 'table', mode: 'classic', roster, packet, view: advanceTableView(null, packet, roster) });
    expect(html).toContain('一对');
    expect(html).toContain('最佳五张');
    expect(html).toContain('+10');
    expect(html).toContain('退回');
    expect(html).toContain('data-action="continue"');
    expect(html).not.toContain('data-intent=');
    expect(html).toContain('你 获得 20');
    expect(html).toContain('data-panel="settlement-1"');
    expect(html).not.toContain('data-panel="settlement-1" open');
  });
  it('escapes names and offers each allowed player count', () => {
    const unsafe = { ...roster[1]!, name: '<img src=x onerror=alert(1)>' };
    const html = renderLobby({ 2: [roster[0]!, unsafe] }, 2);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    for (const count of [2, 3, 4, 5, 6]) expect(html).toContain(`value="${count}"`);
  });
  it('uses the newest public event in the collapsed notebook, with its hand number', async () => {
    const { packet } = await openGameSession({ mode: 'classic', runSeed: 'notebook', humanSeatIndex: 0,
      config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 2 }, seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
      participants: [null, { playerId: '林岚', decide: async () => ({ action: { type: 'fold' } }) }],
    });
    const table: WebTable = { id: 'table', mode: 'classic', roster, packet, view: advanceTableView(null, packet, roster),
      living: { revision: 1, hand: 2, limit: null, ended: false, story: false, chapter: '', protagonist: '',
        notes: [], prompt: null, ending: null,
        lines: [{ id: 2, packetIndex: 5, eventIndex: 3, hand: 2, speaker: '林岚', seatIndex: 1, kind: 'observation', text: '全下 <公开动作>' }],
        memories: [{ id: 1, packetIndex: 4, eventIndex: 8, hand: 1, speaker: '林岚', seatIndex: 1, title: '旧记忆', fact: '', inference: '' }],
      } };
    const summary = (html: string) => html.split('data-panel="notebook"><summary>')[1]!.split('</summary>')[0]!;
    expect(summary(renderTable(table))).toContain('第 2 手 · 林岚 · 观察：全下 &lt;公开动作&gt;');
    expect(summary(renderTable(table, true))).not.toContain('旧记忆');
    table.living!.memories[0]!.packetIndex = 5;
    table.living!.memories[0]!.eventIndex = 4;
    expect(summary(renderTable(table))).toContain('第 1 手 · 旧记忆');
  });
});
