import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import type { HandResultSummary } from '../../src/game/hand-result.js';
import type { ClassicDecisionPacket, HandResultPacket, TurnPacket } from '../../src/game/turn-packet.js';
import { renderSessionRejection, renderTurnPacket } from '../../src/cli/turn-renderer.js';

function decisionPacket(events: readonly PublicGameEvent[] = []): ClassicDecisionPacket {
  return {
    schemaVersion: 1,
    kind: 'decision',
    packetIndex: 8,
    decisionKey: 'hand/3/seat/0/decision/5',
    coreEventRange: { fromVersionInclusive: 20, toVersionExclusive: 24 },
    viewerEventsSinceLastPacket: events,
    privateEventsSinceLastPacket: [],
    observation: {
      schemaVersion: 1,
      handId: 'AUTHORITY-HAND-ID-SENTINEL',
      handNumber: 3,
      decisionIndex: 5,
      actorSeatIndex: 0,
      street: 'turn',
      holeCards: [parseCard('Ah'), parseCard('Kd')],
      board: ['7s', '3h', '2h', 'Qc'].map(parseCard),
      buttonPosition: 1,
      smallBlindSeat: 2,
      bigBlindSeat: 3,
      smallBlind: 2,
      bigBlind: 4,
      potTotal: 999_999,
      sidePots: [{ amount: 123_456, eligibleSeatIndexes: [0, 2] }],
      seats: [
        { playerId: '你', seatIndex: 0, stack: 100, status: 'active', committedStreet: 0, committedHand: 0, revealedHoleCards: null },
        { playerId: '林岚', seatIndex: 1, stack: 0, status: 'eliminated', committedStreet: 0, committedHand: 0, revealedHoleCards: null },
        { playerId: '阿凯', seatIndex: 2, stack: 96, status: 'active', committedStreet: 0, committedHand: 4, revealedHoleCards: null },
        { playerId: '莫叔', seatIndex: 3, stack: 98, status: 'active', committedStreet: 0, committedHand: 2, revealedHoleCards: null },
      ],
      actionHistory: [],
      legalActions: {
        fold: false,
        check: true,
        call: null,
        raiseTo: { min: 4, max: 100 },
        allIn: { to: 100, mode: 'fullBet' },
      },
    },
    actionPanel: {
      currentBetTo: 0,
      facingBet: false,
      tableCommittedTotal: 6,
      heroContestableTotal: 6,
      commands: [
        { kind: 'fixed', inputs: ['x', 'c'], label: '过牌', intent: { type: 'check' } },
        { kind: 'raise-range', inputPattern: 'r <金额>', label: '下注到', minimum: 4, maximum: 100 },
        { kind: 'fixed', inputs: ['a'], label: '全下 100', intent: { type: 'allIn' } },
      ],
    },
    abilities: null,
  };
}

function resultPacket(
  handResult: HandResultSummary,
  events: readonly PublicGameEvent[] = [],
): HandResultPacket {
  return {
    schemaVersion: 1,
    kind: 'hand-result',
    packetIndex: 9,
    handNumber: handResult.handNumber,
    handResult,
    coreEventRange: { fromVersionInclusive: 24, toVersionExclusive: 40 },
    viewerEventsSinceLastPacket: events,
    privateEventsSinceLastPacket: [],
  };
}

const twoPotResult: HandResultSummary = {
  handNumber: 4,
  seats: [
    {
      seatIndex: 0,
      playerId: '你',
      holeCards: [parseCard('Ks'), parseCard('3c')],
      category: 'one-pair',
      bestFive: ['Ks', '7s', '3h', '3c', 'Qc'].map(parseCard),
      potWon: 1755,
      invested: 585,
      returned: 0,
      net: 1170,
      finalStack: 2340,
    },
    {
      seatIndex: 1,
      playerId: 'Morgan',
      holeCards: [parseCard('9c'), parseCard('2s')],
      category: 'one-pair',
      bestFive: ['9c', '7s', '3h', '2s', 'Qc'].map(parseCard),
      potWon: 466,
      invested: 818,
      returned: 0,
      net: -352,
      finalStack: 466,
    },
  ],
  pots: [
    { potId: 'main', label: '主池', amount: 1755, eligibleSeatIndexes: [0, 1], winnerSeatIndexes: [0], awards: [1755] },
    { potId: 'side-1', label: '边池 1', amount: 466, eligibleSeatIndexes: [1], winnerSeatIndexes: [1], awards: [466] },
  ],
};

describe('turn packet renderer', () => {
  it('renders a complete public decision snapshot in physical-seat order', () => {
    const blocks = renderTurnPacket(decisionPacket());

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'decision', delayBeforeMs: 0 });
    const output = blocks[0]!.text;
    for (const visible of [
      '第 3 手｜转牌',
      '你的手牌：A♥ K♦',
      '公共牌：7♠ 3♥ 2♥ Q♣',
      '位置：按钮 座位 1｜小盲 座位 2｜大盲 座位 3',
      '盲注：2/4',
      '座位 0 你',
      '座位 1 林岚',
      '座位 2 阿凯',
      '座位 3 莫叔',
      '筹码 100',
      '已淘汰',
      '本轮下注 0',
      '本手累计投入 4',
      '当前桌面投入 6；你当前可争夺 6。',
      '操作：x/c 过牌 | r 4-100 下注到 | a 全下 100',
    ]) expect(output).toContain(visible);
    expect(output.indexOf('\n> 座位 0')).toBeLessThan(output.indexOf('\n座位 1'));
    expect(output.indexOf('\n座位 1')).toBeLessThan(output.indexOf('\n座位 2'));
  });

  it('never leaks hidden cards or authority-only identifiers and never names an unsettled pot', () => {
    const packet = decisionPacket() as ClassicDecisionPacket & Record<string, unknown>;
    packet.runSeed = 'RUN-SEED-SENTINEL';
    packet.deck = ['HIDDEN-CARD-SENTINEL'];
    packet.burnedCards = ['BURN-SENTINEL'];

    const output = renderTurnPacket(packet)[0]!.text;

    for (const hidden of [
      'AUTHORITY-HAND-ID-SENTINEL', 'RUN-SEED-SENTINEL', 'HIDDEN-CARD-SENTINEL', 'BURN-SENTINEL',
      '底池', '主池', '边池', '999999', '123456',
    ]) expect(output).not.toContain(hidden);
  });

  it('groups ordinary actions, each street, showdown, settlement, then the decision by semantics', () => {
    const events: PublicGameEvent[] = [
      { type: 'playerActed', seatIndex: 1, kind: 'check', paid: 0, betTo: 0, allIn: false },
      { type: 'playerActed', seatIndex: 2, kind: 'check', paid: 0, betTo: 0, allIn: false },
      { type: 'communityCardsDealt', street: 'flop', cards: ['7s', '3h', '2h'].map(parseCard) },
      { type: 'communityCardsDealt', street: 'turn', cards: [parseCard('Qc')] },
      { type: 'communityCardsDealt', street: 'river', cards: [parseCard('9d')] },
      { type: 'showdownStarted', revealOrder: [0, 2] },
      { type: 'holeCardsRevealed', seatIndex: 2, cards: [parseCard('Js'), parseCard('Jd')], reason: 'showdown' },
    ];

    const blocks = renderTurnPacket(decisionPacket(events));

    expect(blocks.map(({ kind, delayBeforeMs }) => ({ kind, delayBeforeMs }))).toEqual([
      { kind: 'ordinary-actions', delayBeforeMs: 0 },
      { kind: 'street-reveal', delayBeforeMs: 1000 },
      { kind: 'street-reveal', delayBeforeMs: 1000 },
      { kind: 'street-reveal', delayBeforeMs: 1000 },
      { kind: 'showdown', delayBeforeMs: 1000 },
      { kind: 'decision', delayBeforeMs: 0 },
    ]);
    expect(blocks[0]!.text).toBe('座位 1 过牌。\n座位 2 过牌。');
    expect(blocks[4]!.text).toContain('开始摊牌');
    expect(blocks[4]!.text).toContain('座位 2 亮牌');
  });

  it('locks the complete two-pot settlement as the only ledger', () => {
    const rawSettlement: PublicGameEvent[] = [
      { type: 'showdownStarted', revealOrder: [0, 1] },
      { type: 'potConstructed', potId: 'main', amount: 1755, eligibleSeats: [0, 1] },
      { type: 'potAwarded', potId: 'main', winners: [0], amounts: [1755], oddChipRecipients: [] },
      { type: 'handCompleted', finalStacks: [{ seatIndex: 0, stack: 2340 }, { seatIndex: 1, stack: 466 }] },
    ];

    const blocks = renderTurnPacket(resultPacket(twoPotResult, rawSettlement));

    expect(blocks.at(-1)).toEqual({
      kind: 'settlement',
      delayBeforeMs: 1000,
      text: [
        '第 4 手结算',
        '玩家 | 手牌 | 牌型 | 赢得底池 | 本手投入 | 退回 | 净结果',
        '你 | K♠ 3♣ | 一对3（K♠ 7♠ 3♥ 3♣ Q♣） | 1755 | 585 | 0 | +1170',
        'Morgan | 9♣ 2♠ | 一对2（9♣ 7♠ 3♥ 2♠ Q♣） | 466 | 818 | 0 | -352',
        '主池 1755：你 1755',
        '边池 1 466：Morgan 466',
        '结论：你赢得 1755；Morgan 赢得 466。',
      ].join('\n'),
    });
    const output = blocks.map((block) => block.text).join('\n');
    for (const duplicate of ['形成底池', '底池 main 发给', '本手结束']) {
      expect(output).not.toContain(duplicate);
    }
  });

  it('renders exactly one row per summary seat and preserves split-pot award pairing', () => {
    const summary: HandResultSummary = {
      handNumber: 5,
      seats: [
        { seatIndex: 0, playerId: '你', holeCards: [parseCard('As'), parseCard('Kd')], category: null, bestFive: null, potWon: 6, invested: 10, returned: 4, net: 0, finalStack: 100 },
        { seatIndex: 1, playerId: '林岚', holeCards: null, category: null, bestFive: null, potWon: 5, invested: 5, returned: 0, net: 0, finalStack: 100 },
        { seatIndex: 2, playerId: '阿凯', holeCards: null, category: null, bestFive: null, potWon: 0, invested: 1, returned: 0, net: -1, finalStack: 99 },
      ],
      pots: [
        { potId: 'pot-0', label: '底池', amount: 11, eligibleSeatIndexes: [0, 1, 2], winnerSeatIndexes: [1, 0], awards: [5, 6] },
      ],
    };

    const text = renderTurnPacket(resultPacket(summary))[0]!.text;
    const tableRows = text.split('\n').filter((line) => line.includes(' | '));

    expect(tableRows).toHaveLength(summary.seats.length + 1);
    expect(text).toContain('林岚 | — | — | 5 | 5 | 0 | 0');
    expect(text).toContain('底池 11：林岚 5；你 6');
    expect(text).toContain('结论：你赢得 6；林岚赢得 5。');
    expect(text).not.toContain('最佳五张');
  });

  it('renders a game result as one immediate ordinary block', () => {
    const packet: TurnPacket = {
      schemaVersion: 1,
      kind: 'game-result',
      packetIndex: 10,
      winnerSeatIndex: 0,
      finalStacks: [{ seatIndex: 0, stack: 200 }, { seatIndex: 1, stack: 0 }],
      coreEventRange: { fromVersionInclusive: 40, toVersionExclusive: 42 },
      viewerEventsSinceLastPacket: [{ type: 'gameCompleted', winnerSeat: 0 }],
      privateEventsSinceLastPacket: [],
    };

    expect(renderTurnPacket(packet)).toEqual([{
      kind: 'ordinary-actions',
      delayBeforeMs: 0,
      text: '比赛结束，座位 0 成为冠军！',
    }]);
  });

  it('maps every rejection to explicit safe Chinese text', () => {
    expect(renderSessionRejection('wrong-mode')).toBe('经典模式不能使用能力。');
    for (const rejection of [
      'not-human-turn', 'stale-decision', 'stale-packet', 'ability-spent',
      'ability-already-used-this-decision', 'invalid-target', 'target-cards-public',
      'invalid-hole-card-index', 'deck-exhausted', 'malformed-command', 'not-current-actor',
      'seat-cannot-act', 'action-not-legal', 'invalid-amount', 'raise-out-of-range', 'raise-not-reopened',
    ] as const) {
      const message = renderSessionRejection(rejection);
      expect(message).toMatch(/[。！]$/);
      expect(message).not.toContain(rejection);
    }
  });
});
