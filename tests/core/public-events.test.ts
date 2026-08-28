import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import type { DomainEvent } from '../../src/core/events.js';
import {
  projectEventsForViewer,
  type PublicGameEvent,
} from '../../src/core/public-events.js';

const hand = {
  schemaVersion: 1 as const,
  eventIndex: 1,
  handId: 'MASTER-SEED-SENTINEL/hand/1',
};

const ah = parseCard('Ah');
const ad = parseCard('Ad');
const kc = parseCard('Kc');
const kd = parseCard('Kd');
const flop = [parseCard('2c'), parseCard('3d'), parseCard('4h')] as const;
const bestFive = [ah, ad, kc, kd, flop[0]] as const;
const SAFE_CARD_ERROR = 'Invalid public card data';

function throwingCard(property: 'code' | 'rank' | 'suit') {
  const card: Record<string, unknown> = { code: 'Ah', rank: 14, suit: 'h' };
  Object.defineProperty(card, property, {
    enumerable: true,
    get: () => { throw new Error(`PUBLIC-${property.toUpperCase()}-GETTER-SEED-SENTINEL`); },
  });
  return card as unknown as ReturnType<typeof parseCard>;
}

function expectSafeCardError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(SAFE_CARD_ERROR);
  expect((caught as Error).message).not.toMatch(/SEED-SENTINEL|PUBLIC-CARD/);
}

const EVENTS_BY_TYPE = {
  GameStarted: {
    type: 'GameStarted',
    schemaVersion: 1,
    eventIndex: 0,
    config: {
      maxSeats: 2,
      startingStack: 100,
      handsPerLevel: 8,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
      initialButtonSeat: 0,
    },
    seats: [
      { playerId: 'hero', seatIndex: 0 },
      { playerId: 'villain', seatIndex: 1 },
    ],
    runSeed: 'MASTER-SEED-SENTINEL',
    rulesVersion: 'holdem-v1',
    rngVersion: 'mulberry32-v1',
    shuffleVersion: 'fisher-yates-v1',
    strategyVersion: 'parametric-v1',
  },
  HandStarted: {
    ...hand,
    type: 'HandStarted',
    handNumber: 1,
    logicalBlindLevel: 99,
    smallBlind: 1,
    bigBlind: 2,
  },
  PositionsAssigned: {
    ...hand,
    type: 'PositionsAssigned',
    buttonPosition: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 1,
  },
  BlindPosted: {
    ...hand,
    type: 'BlindPosted',
    seat: 0,
    kind: 'small',
    amount: 1,
    allIn: false,
  },
  DeckPrepared: {
    ...hand,
    type: 'DeckPrepared',
    fullOrderedDeck: [ah, ad, kc, kd],
    shuffleVersion: 'fisher-yates-v1',
  },
  HoleCardsDealt: {
    ...hand,
    type: 'HoleCardsDealt',
    orderedDeals: [
      { seat: 0, card: ah, round: 1 },
      { seat: 1, card: kc, round: 1 },
      { seat: 0, card: ad, round: 2 },
      { seat: 1, card: kd, round: 2 },
    ],
  },
  BettingRoundStarted: {
    ...hand,
    type: 'BettingRoundStarted',
    street: 'preflop',
    actor: 0,
    currentBetTo: 2,
    lastFullRaiseSize: 2,
  },
  PlayerActed: {
    ...hand,
    type: 'PlayerActed',
    seat: 0,
    normalizedKind: 'call',
    paid: 1,
    betToBefore: 2,
    betToAfter: 2,
    allIn: false,
    fullRaise: false,
    raiseReopened: false,
  },
  BettingRoundClosed: {
    ...hand,
    type: 'BettingRoundClosed',
    street: 'preflop',
  },
  CardBurned: {
    ...hand,
    type: 'CardBurned',
    street: 'flop',
    card: parseCard('5s'),
  },
  CommunityCardsDealt: {
    ...hand,
    type: 'CommunityCardsDealt',
    street: 'flop',
    cards: flop,
  },
  HoleCardsRevealed: {
    ...hand,
    type: 'HoleCardsRevealed',
    seat: 1,
    cards: [kc, kd],
    reason: 'showdown',
  },
  UncalledBetReturned: {
    ...hand,
    type: 'UncalledBetReturned',
    seat: 0,
    amount: 7,
  },
  ShowdownStarted: {
    ...hand,
    type: 'ShowdownStarted',
    revealOrder: [1, 0],
  },
  PotConstructed: {
    ...hand,
    type: 'PotConstructed',
    potId: 'pot-0',
    amount: 13,
    cap: 99,
    eligibleSeats: [0, 1],
  },
  HandEvaluated: {
    ...hand,
    type: 'HandEvaluated',
    seat: 0,
    rank: { category: 'one-pair', vector: [1, 14, 13, 4, 3], bestFive },
  },
  PotAwarded: {
    ...hand,
    type: 'PotAwarded',
    potId: 'pot-0',
    winners: [0, 1],
    amounts: [7, 6],
    oddChipRecipients: [0],
  },
  PlayerEliminated: {
    ...hand,
    type: 'PlayerEliminated',
    seat: 1,
  },
  HandCompleted: {
    ...hand,
    type: 'HandCompleted',
    finalStacks: [{ seat: 0, stack: 200 }, { seat: 1, stack: 0 }],
  },
  GameCompleted: {
    ...hand,
    type: 'GameCompleted',
    winnerSeat: 0,
  },
} satisfies Record<DomainEvent['type'], DomainEvent>;

const ALL_EVENTS = Object.values(EVENTS_BY_TYPE) as readonly DomainEvent[];

const expectedWithoutOwnCards: readonly PublicGameEvent[] = [
  { type: 'gameStarted', maxSeats: 2, startingStack: 100 },
  { type: 'handStarted', handNumber: 1, smallBlind: 1, bigBlind: 2 },
  { type: 'positionsAssigned', buttonPosition: 0, smallBlindSeat: 0, bigBlindSeat: 1 },
  { type: 'blindPosted', seatIndex: 0, kind: 'small', amount: 1, allIn: false },
  { type: 'bettingRoundStarted', street: 'preflop', actor: 0, currentBetTo: 2 },
  { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 1, betTo: 2, allIn: false },
  { type: 'bettingRoundClosed', street: 'preflop' },
  { type: 'communityCardsDealt', street: 'flop', cards: flop },
  { type: 'holeCardsRevealed', seatIndex: 1, cards: [kc, kd], reason: 'showdown' },
  { type: 'uncalledBetReturned', seatIndex: 0, amount: 7 },
  { type: 'showdownStarted', revealOrder: [1, 0] },
  { type: 'potConstructed', potId: 'pot-0', amount: 13, eligibleSeats: [0, 1] },
  {
    type: 'potAwarded',
    potId: 'pot-0',
    winners: [0, 1],
    amounts: [7, 6],
    oddChipRecipients: [0],
  },
  { type: 'playerEliminated', seatIndex: 1 },
  { type: 'handCompleted', finalStacks: [{ seatIndex: 0, stack: 200 }, { seatIndex: 1, stack: 0 }] },
  { type: 'gameCompleted', winnerSeat: 0 },
];

describe('public domain-event whitelist', () => {
  it('maps every authority variant explicitly for each viewer and suppresses private variants', () => {
    const own0 = projectEventsForViewer(ALL_EVENTS, 0);
    const own1 = projectEventsForViewer(ALL_EVENTS, 1);
    const spectator = projectEventsForViewer(ALL_EVENTS, null);

    expect(own0).toEqual([
      ...expectedWithoutOwnCards.slice(0, 4),
      { type: 'ownHoleCardsDealt', cards: [ah, ad] },
      ...expectedWithoutOwnCards.slice(4),
    ]);
    expect(own1).toEqual([
      ...expectedWithoutOwnCards.slice(0, 4),
      { type: 'ownHoleCardsDealt', cards: [kc, kd] },
      ...expectedWithoutOwnCards.slice(4),
    ]);
    expect(spectator).toEqual(expectedWithoutOwnCards);
  });

  it('drops extra runtime authority fields instead of spreading them', () => {
    const secretGame = {
      ...EVENTS_BY_TYPE.GameStarted,
      config: { ...EVENTS_BY_TYPE.GameStarted.config, deckSecret: 'DECK-SENTINEL' },
      privateTrace: { equity: 1 },
      authorityRef: { runSeed: 'MASTER-SEED-SENTINEL' },
    } as unknown as DomainEvent;
    const secretAction = {
      ...EVENTS_BY_TYPE.PlayerActed,
      privateTrace: 'TRACE-SENTINEL',
      authorityRef: EVENTS_BY_TYPE.DeckPrepared,
    } as unknown as DomainEvent;

    const projected = projectEventsForViewer(
      [secretGame, EVENTS_BY_TYPE.DeckPrepared, secretAction],
      0,
    );

    expect(projected).toEqual([
      { type: 'gameStarted', maxSeats: 2, startingStack: 100 },
      { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 1, betTo: 2, allIn: false },
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/MASTER-SEED|DECK-SENTINEL|TRACE-SENTINEL|authorityRef/);
  });

  it('fails closed for malformed own-card batches', () => {
    const base = EVENTS_BY_TYPE.HoleCardsDealt;
    const oneOwnCard = { ...base, orderedDeals: base.orderedDeals.slice(0, 2) };
    const duplicateRound = {
      ...base,
      orderedDeals: base.orderedDeals.map((deal) => deal.seat === 0
        ? { ...deal, round: 1 as const }
        : deal),
    };
    const threeOwnCards = {
      ...base,
      orderedDeals: [...base.orderedDeals, { seat: 0, card: parseCard('Qs'), round: 2 as const }],
    };

    expect(() => projectEventsForViewer([oneOwnCard], 0)).toThrow(/hole|card|deal/i);
    expect(() => projectEventsForViewer([duplicateRound], 0)).toThrow(/hole|card|round/i);
    expect(() => projectEventsForViewer([threeOwnCards], 0)).toThrow(/hole|card|deal/i);
    expect(projectEventsForViewer([{ ...base, orderedDeals: base.orderedDeals.filter((deal) => deal.seat === 1) }], 0)).toEqual([]);
  });

  it('uses a fixed non-reflective error for an unknown event variant', () => {
    const unknown = {
      type: 'FutureAuthorityEvent',
      schemaVersion: 1,
      eventIndex: 2,
      runSeed: 'UNKNOWN-EVENT-SEED-SENTINEL',
      fullOrderedDeck: [parseCard('Ah'), parseCard('Ad')],
      authorityPayload: { privateCard: 'Ks' },
    } as unknown as DomainEvent;

    let caught: unknown;
    try {
      projectEventsForViewer([unknown], 0);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Unhandled domain event variant');
    expect((caught as Error).message).not.toMatch(/UNKNOWN-EVENT-SEED-SENTINEL|fullOrderedDeck|Ks/);
  });

  it('rejects duplicate own cards and noncanonical public cards with one safe error', () => {
    const invalidCard = {
      code: 'PUBLIC-CARD-SEED-SENTINEL',
      rank: 14,
      suit: 'h',
    } as unknown as ReturnType<typeof parseCard>;
    const duplicateOwn = {
      ...EVENTS_BY_TYPE.HoleCardsDealt,
      orderedDeals: [
        { seat: 0, card: ah, round: 1 as const },
        { seat: 0, card: ah, round: 2 as const },
      ],
    };
    const invalidOwn = {
      ...EVENTS_BY_TYPE.HoleCardsDealt,
      orderedDeals: [
        { seat: 0, card: invalidCard, round: 1 as const },
        { seat: 0, card: ad, round: 2 as const },
      ],
    };
    const invalidCommunity = {
      ...EVENTS_BY_TYPE.CommunityCardsDealt,
      cards: [invalidCard],
    };
    const invalidReveal = {
      ...EVENTS_BY_TYPE.HoleCardsRevealed,
      cards: [invalidCard, kd] as const,
    };

    for (const event of [duplicateOwn, invalidOwn, invalidCommunity, invalidReveal]) {
      let caught: unknown;
      try {
        projectEventsForViewer([event], 0);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Invalid public card data');
      expect((caught as Error).message).not.toContain('PUBLIC-CARD-SEED-SENTINEL');
    }

    const inconsistentRank = {
      ...ah,
      rank: 13,
    } as unknown as ReturnType<typeof parseCard>;
    expect(() => projectEventsForViewer([{
      ...EVENTS_BY_TYPE.CommunityCardsDealt,
      cards: [inconsistentRank],
    }], 0)).toThrow('Invalid public card data');
  });

  it('normalizes every malformed Card value and throwing getter to the same safe error', () => {
    const invalidValues: readonly unknown[] = [
      undefined,
      null,
      7,
      'PUBLIC-CARD-STRING-SEED-SENTINEL',
      throwingCard('code'),
      throwingCard('rank'),
      throwingCard('suit'),
      { ...ah, rank: 13 },
      { ...ah, suit: 's' },
    ];

    for (const value of invalidValues) {
      const event = {
        ...EVENTS_BY_TYPE.CommunityCardsDealt,
        cards: [value, parseCard('6c'), parseCard('7d')],
      } as unknown as DomainEvent;
      expectSafeCardError(() => projectEventsForViewer([event], 0));
    }
  });

  it('does not touch a hidden opponent Card getter while projecting the viewer own deal', () => {
    const hidden = throwingCard('code');
    const event = {
      ...EVENTS_BY_TYPE.HoleCardsDealt,
      orderedDeals: [
        { seat: 0, card: ah, round: 1 as const },
        { seat: 1, card: hidden, round: 1 as const },
        { seat: 0, card: ad, round: 2 as const },
        { seat: 1, card: hidden, round: 2 as const },
      ],
    };

    expect(projectEventsForViewer([event], 0)).toEqual([
      { type: 'ownHoleCardsDealt', cards: [ah, ad] },
    ]);
    expect(projectEventsForViewer([event], null)).toEqual([]);
  });

  it('rejects malformed community and reveal batches with the fixed safe error', () => {
    const cases: readonly DomainEvent[] = [
      {
        ...EVENTS_BY_TYPE.CommunityCardsDealt,
        street: 'flop',
        cards: [parseCard('2c')],
      },
      {
        ...EVENTS_BY_TYPE.CommunityCardsDealt,
        street: 'turn',
        cards: [parseCard('2c'), parseCard('3d'), parseCard('4h')],
      },
      {
        ...EVENTS_BY_TYPE.CommunityCardsDealt,
        street: 'flop',
        cards: [parseCard('2c'), parseCard('2c'), parseCard('4h')],
      },
      {
        ...EVENTS_BY_TYPE.HoleCardsRevealed,
        cards: [ah] as unknown as readonly [typeof ah, typeof ad],
      },
      {
        ...EVENTS_BY_TYPE.HoleCardsRevealed,
        cards: [ah, ah],
      },
    ];

    for (const event of cases) {
      expectSafeCardError(() => projectEventsForViewer([event], 0));
    }
  });

  it('returns a fresh recursively frozen public graph without freezing authority input', () => {
    const projected = projectEventsForViewer(ALL_EVENTS, 0);
    const own = projected.find((event) => event.type === 'ownHoleCardsDealt');
    const community = projected.find((event) => event.type === 'communityCardsDealt');
    const reveal = projected.find((event) => event.type === 'holeCardsRevealed');
    const showdown = projected.find((event) => event.type === 'showdownStarted');
    const constructed = projected.find((event) => event.type === 'potConstructed');
    const award = projected.find((event) => event.type === 'potAwarded');
    const completed = projected.find((event) => event.type === 'handCompleted');

    expect(own?.type).toBe('ownHoleCardsDealt');
    expect(community?.type).toBe('communityCardsDealt');
    expect(reveal?.type).toBe('holeCardsRevealed');
    expect(showdown?.type).toBe('showdownStarted');
    expect(constructed?.type).toBe('potConstructed');
    expect(award?.type).toBe('potAwarded');
    expect(completed?.type).toBe('handCompleted');
    if (own?.type !== 'ownHoleCardsDealt'
      || community?.type !== 'communityCardsDealt'
      || reveal?.type !== 'holeCardsRevealed'
      || showdown?.type !== 'showdownStarted'
      || constructed?.type !== 'potConstructed'
      || award?.type !== 'potAwarded'
      || completed?.type !== 'handCompleted') throw new Error('missing projected fixture');

    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(own.cards)).toBe(true);
    expect(Object.isFrozen(own.cards[0])).toBe(true);
    expect(Object.isFrozen(community.cards)).toBe(true);
    expect(Object.isFrozen(community.cards[0])).toBe(true);
    expect(Object.isFrozen(reveal.cards)).toBe(true);
    expect(Object.isFrozen(reveal.cards[0])).toBe(true);
    expect(Object.isFrozen(showdown.revealOrder)).toBe(true);
    expect(Object.isFrozen(constructed.eligibleSeats)).toBe(true);
    expect(Object.isFrozen(award.winners)).toBe(true);
    expect(Object.isFrozen(award.amounts)).toBe(true);
    expect(Object.isFrozen(award.oddChipRecipients)).toBe(true);
    expect(Object.isFrozen(completed.finalStacks)).toBe(true);
    expect(completed.finalStacks.every(Object.isFrozen)).toBe(true);
    expect(own.cards).not.toBe(EVENTS_BY_TYPE.HoleCardsDealt.orderedDeals);
    expect(own.cards[0]).not.toBe(ah);
    expect(community.cards).not.toBe(EVENTS_BY_TYPE.CommunityCardsDealt.cards);
    expect(community.cards[0]).not.toBe(EVENTS_BY_TYPE.CommunityCardsDealt.cards[0]);
    expect(reveal.cards).not.toBe(EVENTS_BY_TYPE.HoleCardsRevealed.cards);
    expect(showdown.revealOrder).not.toBe(EVENTS_BY_TYPE.ShowdownStarted.revealOrder);
    expect(constructed.eligibleSeats).not.toBe(EVENTS_BY_TYPE.PotConstructed.eligibleSeats);
    expect(award.winners).not.toBe(EVENTS_BY_TYPE.PotAwarded.winners);
    expect(completed.finalStacks).not.toBe(EVENTS_BY_TYPE.HandCompleted.finalStacks);
    expect(completed.finalStacks[0]).not.toBe(EVENTS_BY_TYPE.HandCompleted.finalStacks[0]);
    expect(Object.isFrozen(ah)).toBe(false);
    expect(Object.isFrozen(EVENTS_BY_TYPE.HoleCardsRevealed)).toBe(false);

    const frozenWrites: readonly [string, () => void][] = [
      ['public array', () => { (projected as unknown as unknown[]).push({}); }],
      ['public event', () => { (community as unknown as { street: string }).street = 'turn'; }],
      ['community cards', () => { (community.cards as unknown as unknown[]).push(parseCard('6c')); }],
      ['community card', () => { (community.cards[0] as unknown as { rank: number }).rank = 14; }],
      ['reveal order', () => { (showdown.revealOrder as unknown as number[]).push(2); }],
      ['pot eligibility', () => { (constructed.eligibleSeats as unknown as number[]).push(2); }],
    ];
    for (const [name, write] of frozenWrites) {
      expect(write, name).toThrow(TypeError);
    }
  });
});
