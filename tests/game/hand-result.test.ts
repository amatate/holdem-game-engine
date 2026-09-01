import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import type { TournamentSeatInput } from '../../src/core/state.js';
import { buildHandResultSummary } from '../../src/game/hand-result.js';

const seats: readonly TournamentSeatInput[] = [
  { playerId: 'hero', seatIndex: 0 },
  { playerId: 'villain-1', seatIndex: 1 },
  { playerId: 'villain-2', seatIndex: 2 },
];

function mainAndSidePotEvents(): PublicGameEvent[] {
  return [
    { type: 'handStarted', handNumber: 4, smallBlind: 25, bigBlind: 50 },
    { type: 'blindPosted', seatIndex: 0, kind: 'small', amount: 50, allIn: false },
    { type: 'blindPosted', seatIndex: 1, kind: 'big', amount: 50, allIn: false },
    { type: 'blindPosted', seatIndex: 2, kind: 'big', amount: 100, allIn: false },
    { type: 'ownHoleCardsDealt', cards: [parseCard('Ah'), parseCard('Kd')] },
    { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 50, betTo: 100, allIn: true },
    { type: 'playerActed', seatIndex: 1, kind: 'raise', paid: 150, betTo: 200, allIn: true },
    { type: 'playerActed', seatIndex: 2, kind: 'call', paid: 100, betTo: 200, allIn: true },
    {
      type: 'holeCardsRevealed', seatIndex: 1,
      cards: [parseCard('Qc'), parseCard('Qd')], reason: 'showdown',
    },
    {
      type: 'holeCardsRevealed', seatIndex: 2,
      cards: [parseCard('Js'), parseCard('Jd')], reason: 'showdown',
    },
    { type: 'uncalledBetReturned', seatIndex: 1, amount: 50 },
    { type: 'potConstructed', potId: 'pot-0', amount: 150, eligibleSeats: [0, 1, 2] },
    { type: 'potConstructed', potId: 'pot-1', amount: 300, eligibleSeats: [1, 2] },
    {
      type: 'handEvaluated', seatIndex: 1, category: 'one-pair',
      bestFive: ['Qc', 'Qd', 'As', '9c', '7h'].map(parseCard) as [
        ReturnType<typeof parseCard>, ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
        ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
      ],
    },
    {
      type: 'handEvaluated', seatIndex: 2, category: 'three-of-a-kind',
      bestFive: ['Js', 'Jd', 'Jh', 'As', '9c'].map(parseCard) as [
        ReturnType<typeof parseCard>, ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
        ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
      ],
    },
    { type: 'potAwarded', potId: 'pot-0', winners: [0], amounts: [150], oddChipRecipients: [] },
    { type: 'potAwarded', potId: 'pot-1', winners: [2], amounts: [300], oddChipRecipients: [] },
    {
      type: 'handCompleted',
      finalStacks: [
        { seatIndex: 0, stack: 1_050 },
        { seatIndex: 1, stack: 850 },
        { seatIndex: 2, stack: 1_100 },
      ],
    },
  ];
}

function expectSafeHandResultError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe('Invalid hand result data');
  expect((caught as Error).message).not.toMatch(/SEED-SENTINEL|GETTER|PROXY/);
}

function poisonArrayMethods<T>(values: readonly T[]): T[] {
  const clone: T[] = [];
  for (let index = 0; index < values.length; index += 1) clone.push(values[index]!);
  const poison = () => { throw new Error('ARRAY-METHOD-SEED-SENTINEL'); };
  Object.defineProperties(clone, {
    map: { value: poison },
    filter: { value: poison },
    values: { value: poison },
    [Symbol.iterator]: { value: poison },
  });
  return clone;
}

function isRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((child) => isRecursivelyFrozen(child, seen));
}

describe('buildHandResultSummary', () => {
  it('summarizes authoritative main-pot, side-pot and refund events', () => {
    const summary = buildHandResultSummary(seats, mainAndSidePotEvents());

    expect(summary.handNumber).toBe(4);
    expect(summary.seats).toEqual([
      expect.objectContaining({
        seatIndex: 0, invested: 100, returned: 0, potWon: 150, net: 50,
        finalStack: 1_050,
      }),
      expect.objectContaining({
        seatIndex: 1, invested: 200, returned: 50, potWon: 0, net: -150,
        finalStack: 850,
      }),
      expect.objectContaining({
        seatIndex: 2, invested: 200, returned: 0, potWon: 300, net: 100,
        finalStack: 1_100,
      }),
    ]);
    expect(summary.pots.map(({ label, amount }) => ({ label, amount }))).toEqual([
      { label: '主池', amount: 150 },
      { label: '边池 1', amount: 300 },
    ]);
    expect(summary.pots).toMatchObject([
      {
        potId: 'pot-0', eligibleSeatIndexes: [0, 1, 2],
        winnerSeatIndexes: [0], awards: [150],
      },
      {
        potId: 'pot-1', eligibleSeatIndexes: [1, 2],
        winnerSeatIndexes: [2], awards: [300],
      },
    ]);
  });

  it('labels an independently settled single pot as 底池', () => {
    const onePotEvents: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 5, smallBlind: 25, bigBlind: 50 },
      { type: 'blindPosted', seatIndex: 0, kind: 'small', amount: 25, allIn: false },
      { type: 'blindPosted', seatIndex: 1, kind: 'big', amount: 50, allIn: false },
      { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 25, betTo: 50, allIn: false },
      { type: 'potConstructed', potId: 'only-pot', amount: 100, eligibleSeats: [0, 1] },
      {
        type: 'potAwarded', potId: 'only-pot', winners: [1], amounts: [100],
        oddChipRecipients: [],
      },
      {
        type: 'handCompleted',
        finalStacks: [{ seatIndex: 0, stack: 950 }, { seatIndex: 1, stack: 1_050 }],
      },
    ];

    expect(buildHandResultSummary(seats.slice(0, 2), onePotEvents).pots).toEqual([
      expect.objectContaining({ potId: 'only-pot', label: '底池', amount: 100 }),
    ]);
  });

  it('keeps folded own cards and revealed evaluations visible without exposing a hidden NPC', () => {
    const visibilityEvents: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 6, smallBlind: 10, bigBlind: 20 },
      { type: 'ownHoleCardsDealt', cards: [parseCard('Ah'), parseCard('Kd')] },
      { type: 'playerActed', seatIndex: 0, kind: 'fold', paid: 0, betTo: 0, allIn: false },
      {
        type: 'holeCardsRevealed', seatIndex: 1,
        cards: [parseCard('Qc'), parseCard('Qd')], reason: 'showdown',
      },
      {
        type: 'handEvaluated', seatIndex: 1, category: 'one-pair',
        bestFive: ['Qc', 'Qd', 'As', '9c', '7h'].map(parseCard) as [
          ReturnType<typeof parseCard>, ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
          ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
        ],
      },
      {
        type: 'handEvaluated', seatIndex: 2, category: 'straight-flush',
        bestFive: ['9s', '8s', '7s', '6s', '5s'].map(parseCard) as [
          ReturnType<typeof parseCard>, ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
          ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
        ],
      },
      { type: 'potConstructed', potId: 'pot-0', amount: 60, eligibleSeats: [1, 2] },
      { type: 'potAwarded', potId: 'pot-0', winners: [1], amounts: [60], oddChipRecipients: [] },
      {
        type: 'handCompleted', finalStacks: [
          { seatIndex: 0, stack: 980 },
          { seatIndex: 1, stack: 1_040 },
          { seatIndex: 2, stack: 980 },
        ],
      },
    ];

    const result = buildHandResultSummary(seats, visibilityEvents);

    expect(result.seats[0]).toMatchObject({
      holeCards: [parseCard('Ah'), parseCard('Kd')],
    });
    expect(result.seats[1]).toMatchObject({
      holeCards: [parseCard('Qc'), parseCard('Qd')],
      category: 'one-pair',
      bestFive: ['Qc', 'Qd', 'As', '9c', '7h'].map(parseCard),
    });
    expect(result.seats[1]!.bestFive).toHaveLength(5);
    expect(result.seats[2]).toMatchObject({
      holeCards: null,
      category: null,
      bestFive: null,
    });
  });

  it('rejects a duplicate pot identifier with a fixed safe error', () => {
    const events = mainAndSidePotEvents();
    events.splice(events.length - 1, 0, {
      type: 'potConstructed', potId: 'pot-0', amount: 1, eligibleSeats: [0, 1],
    });

    expectSafeHandResultError(() => buildHandResultSummary(seats, events));
  });

  it('rejects an award that appears before its pot is constructed', () => {
    const events: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 7, smallBlind: 10, bigBlind: 20 },
      { type: 'potAwarded', potId: 'future-pot', winners: [0], amounts: [40], oddChipRecipients: [] },
      {
        type: 'handCompleted', finalStacks: [
          { seatIndex: 0, stack: 1_020 },
          { seatIndex: 1, stack: 980 },
        ],
      },
    ];

    expectSafeHandResultError(() => buildHandResultSummary(seats.slice(0, 2), events));
  });

  it('rejects mismatched parallel winner and award arrays', () => {
    const events: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 8, smallBlind: 10, bigBlind: 20 },
      { type: 'potConstructed', potId: 'pot-0', amount: 41, eligibleSeats: [0, 1] },
      {
        type: 'potAwarded', potId: 'pot-0', winners: [0, 1], amounts: [41],
        oddChipRecipients: [],
      },
      {
        type: 'handCompleted', finalStacks: [
          { seatIndex: 0, stack: 1_021 },
          { seatIndex: 1, stack: 979 },
        ],
      },
    ];

    expectSafeHandResultError(() => buildHandResultSummary(seats.slice(0, 2), events));
  });

  it('rejects a stream without handCompleted', () => {
    const events = mainAndSidePotEvents();
    events.pop();

    expectSafeHandResultError(() => buildHandResultSummary(seats, events));
  });

  it('rejects unsafe integer arithmetic', () => {
    const events: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 9, smallBlind: 1, bigBlind: 2 },
      {
        type: 'blindPosted', seatIndex: 0, kind: 'small',
        amount: Number.MAX_SAFE_INTEGER, allIn: false,
      },
      { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 1, betTo: 1, allIn: false },
      {
        type: 'handCompleted', finalStacks: [
          { seatIndex: 0, stack: 0 },
          { seatIndex: 1, stack: 0 },
        ],
      },
    ];

    expectSafeHandResultError(() => buildHandResultSummary(seats.slice(0, 2), events));
  });

  it('rejects a sparse nested event array', () => {
    const sparseEligibleSeats = new Array(2) as number[];
    sparseEligibleSeats[0] = 0;
    const events: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 10, smallBlind: 10, bigBlind: 20 },
      {
        type: 'potConstructed', potId: 'pot-0', amount: 40,
        eligibleSeats: sparseEligibleSeats,
      },
      { type: 'potAwarded', potId: 'pot-0', winners: [0], amounts: [40], oddChipRecipients: [] },
      {
        type: 'handCompleted', finalStacks: [
          { seatIndex: 0, stack: 1_020 },
          { seatIndex: 1, stack: 980 },
        ],
      },
    ];

    expectSafeHandResultError(() => buildHandResultSummary(seats.slice(0, 2), events));
  });

  it('rejects an evaluated hand whose bestFive is not exactly five cards', () => {
    const events: PublicGameEvent[] = [
      { type: 'handStarted', handNumber: 11, smallBlind: 10, bigBlind: 20 },
      { type: 'ownHoleCardsDealt', cards: [parseCard('Ah'), parseCard('Kd')] },
      {
        type: 'handEvaluated', seatIndex: 0, category: 'one-pair',
        bestFive: ['Ah', 'Ad', 'Ks', 'Qc'].map(parseCard) as unknown as [
          ReturnType<typeof parseCard>, ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
          ReturnType<typeof parseCard>, ReturnType<typeof parseCard>,
        ],
      },
      {
        type: 'handCompleted', finalStacks: [
          { seatIndex: 0, stack: 1_000 },
          { seatIndex: 1, stack: 1_000 },
        ],
      },
    ];

    expectSafeHandResultError(() => buildHandResultSummary(seats.slice(0, 2), events));
  });

  it('copies poisoned dense inputs without mutating or freezing them and deep-freezes the result', () => {
    const original = mainAndSidePotEvents();
    const semanticSnapshot = JSON.stringify(original);
    const poisonedEvents = poisonArrayMethods(original);
    const constructed = poisonedEvents[11];
    const awarded = poisonedEvents[15];
    if (constructed?.type !== 'potConstructed' || awarded?.type !== 'potAwarded') {
      throw new Error('fixture event indexes changed');
    }
    const poisonedEligibleSeats = poisonArrayMethods(constructed.eligibleSeats);
    poisonedEvents[11] = {
      ...constructed,
      eligibleSeats: poisonedEligibleSeats,
    };
    poisonedEvents[15] = {
      ...awarded,
      winners: poisonArrayMethods(awarded.winners),
      amounts: poisonArrayMethods(awarded.amounts),
    };
    const poisonedSeats = poisonArrayMethods(seats);

    const result = buildHandResultSummary(poisonedSeats, poisonedEvents);

    expect(JSON.stringify(poisonedEvents)).toBe(semanticSnapshot);
    expect(Object.isFrozen(poisonedSeats)).toBe(false);
    expect(Object.isFrozen(poisonedEvents)).toBe(false);
    expect(Object.isFrozen(poisonedEligibleSeats)).toBe(false);
    expect(result.pots[0]!.eligibleSeatIndexes).not.toBe(poisonedEligibleSeats);
    expect(result.seats[0]!.holeCards).not.toBe(original[4]!.type === 'ownHoleCardsDealt'
      ? original[4].cards
      : null);
    expect(isRecursivelyFrozen(result)).toBe(true);
  });
});
