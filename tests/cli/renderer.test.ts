import { describe, expect, it } from 'vitest';

import type { PlayerObservationV1 } from '../../src/agents/types.js';
import { parseCard } from '../../src/core/cards.js';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import { renderPublicEvents, renderTable } from '../../src/cli/renderer.js';

const observation: PlayerObservationV1 = {
  schemaVersion: 1,
  handId: 'hand/3',
  handNumber: 3,
  decisionIndex: 4,
  actorSeatIndex: 0,
  street: 'turn',
  holeCards: [parseCard('Ah'), parseCard('Kd')],
  board: ['2c', '7d', 'Ts', 'Jh'].map(parseCard),
  buttonPosition: 1,
  smallBlindSeat: 2,
  bigBlindSeat: 3,
  smallBlind: 2,
  bigBlind: 4,
  potTotal: 24,
  sidePots: [{ amount: 6, eligibleSeatIndexes: [0, 2] }],
  seats: [
    { playerId: '你', seatIndex: 0, stack: 76, status: 'active', committedStreet: 4, committedHand: 8, revealedHoleCards: null },
    { playerId: '林岚', seatIndex: 1, stack: 0, status: 'eliminated', committedStreet: 0, committedHand: 0, revealedHoleCards: null },
    { playerId: '阿凯', seatIndex: 2, stack: 64, status: 'active', committedStreet: 8, committedHand: 12, revealedHoleCards: null },
    { playerId: '莫叔', seatIndex: 3, stack: 0, status: 'all-in', committedStreet: 4, committedHand: 4, revealedHoleCards: null },
  ],
  actionHistory: [],
  legalActions: {
    fold: true,
    check: false,
    call: { pay: 4, to: 8, isAllIn: false },
    raiseTo: { min: 12, max: 80 },
    allIn: { to: 80, mode: 'fullRaise' },
  },
};

describe('Chinese terminal renderer', () => {
  it('shows only the observation-facing table, stacks, positions, pots, cards, and legal commands', () => {
    const output = renderTable(observation);

    for (const visible of ['第 3 手', '转牌', 'A♥', 'K♦', '底池 24', '边池', '按钮', '小盲', '大盲', '你', '林岚', '阿凯', '莫叔', 'f', 'c', 'r 12-80', 'a']) {
      expect(output).toContain(visible);
    }
    for (const privateSentinel of ['DeckPrepared', 'CardBurned', 'fullOrderedDeck', 'runSeed', 'privateTrace']) {
      expect(output).not.toContain(privateSentinel);
    }
  });

  it('renders public actions, streets, legal reveals, awards, eliminations, and champion', () => {
    const events: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 3, smallBlind: 2, bigBlind: 4 },
      { type: 'playerActed', seatIndex: 2, kind: 'raise', paid: 8, betTo: 12, allIn: false },
      { type: 'communityCardsDealt', street: 'flop', cards: ['2c', '7d', 'Ts'].map(parseCard) },
      { type: 'holeCardsRevealed', seatIndex: 3, cards: [parseCard('Qc'), parseCard('Qd')], reason: 'showdown' },
      { type: 'potAwarded', potId: 'main', winners: [0], amounts: [30], oddChipRecipients: [] },
      { type: 'playerEliminated', seatIndex: 1 },
      { type: 'gameCompleted', winnerSeat: 0 },
    ];
    const output = renderPublicEvents(events);

    for (const visible of ['第 3 手', '座位 2', '加注', '翻牌', '座位 3', '亮牌', '30', '淘汰', '冠军']) {
      expect(output).toContain(visible);
    }
  });

  it('shows the caller actual total and does not claim a folded seat matched the bet', () => {
    const output = renderPublicEvents([
      { type: 'playerActed', seatIndex: 0, kind: 'fold', paid: 0, betTo: 2, allIn: false },
      { type: 'playerActed', seatIndex: 3, kind: 'call', paid: 98, betTo: 100, allIn: true },
    ]);

    expect(output).toBe([
      '座位 0 弃牌。',
      '座位 3 跟注 98，到 100（全下）。',
    ].join('\n'));
  });
});
