import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  MAX_EQUITY_SAMPLES,
  estimateEquity,
} from '../../src/agents/equity.js';
import type { PlayerObservationV1, PublicSeatState } from '../../src/agents/types.js';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';
import type { PlayerHandStatus, Street } from '../../src/core/state.js';
import type { Card, RandomSource } from '../../src/core/types.js';
import * as publicApi from '../../src/index.js';

const EMPTY_LEGAL_ACTIONS = {
  fold: false,
  check: true,
  call: null,
  raiseTo: null,
  allIn: null,
} as const;

function cards(codes: readonly string[]): Card[] {
  return codes.map((code) => parseCard(code));
}

function fixtureObservation(options: Readonly<{
  holeCards?: readonly string[];
  board?: readonly string[];
  street?: Street;
  statuses?: readonly PlayerHandStatus[];
  actorSeatIndex?: number;
}> = {}): PlayerObservationV1 {
  const holeCodes = options.holeCards ?? ['Ah', 'Kd'];
  const boardCodes = options.board ?? [];
  const statuses = options.statuses ?? ['active', 'active'];
  const inferredStreet: Street = boardCodes.length === 0
    ? 'preflop'
    : boardCodes.length === 3
      ? 'flop'
      : boardCodes.length === 4
        ? 'turn'
        : 'river';
  const seats: PublicSeatState[] = statuses.map((status, seatIndex) => ({
    playerId: `player-${seatIndex}`,
    seatIndex,
    stack: status === 'eliminated' ? 0 : 100,
    status,
    committedStreet: 0,
    committedHand: 0,
    revealedHoleCards: null,
  }));

  return {
    schemaVersion: 1,
    handId: 'hand/1',
    handNumber: 1,
    decisionIndex: 0,
    actorSeatIndex: options.actorSeatIndex ?? 0,
    street: options.street ?? inferredStreet,
    holeCards: cards(holeCodes) as unknown as readonly [Card, Card],
    board: cards(boardCodes),
    buttonPosition: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 1,
    smallBlind: 1,
    bigBlind: 2,
    potTotal: 3,
    sidePots: [],
    seats,
    actionHistory: [],
    legalActions: EMPTY_LEGAL_ACTIONS,
  };
}

function replaceSeat(
  observation: PlayerObservationV1,
  index: number,
  changes: Partial<PublicSeatState>,
): PlayerObservationV1 {
  return {
    ...observation,
    seats: observation.seats.map((seat, seatIndex) => seatIndex === index
      ? { ...seat, ...changes }
      : seat),
  };
}

function trackedRandom(seed = 'tracked'): Readonly<{
  random: RandomSource;
  calls: { nextFloat: number; nextUint32: number; fork: number };
}> {
  const source = createSeededRandom(seed);
  const calls = { nextFloat: 0, nextUint32: 0, fork: 0 };
  const random: RandomSource = {
    algorithm: source.algorithm,
    seedHash: source.seedHash,
    nextFloat: () => {
      calls.nextFloat += 1;
      return source.nextFloat();
    },
    nextUint32: () => {
      calls.nextUint32 += 1;
      return source.nextUint32();
    },
    fork: (label) => {
      calls.fork += 1;
      return source.fork(label);
    },
  };
  return { random, calls };
}

function expectPreflightRejection(
  observation: PlayerObservationV1,
  samples: number = 1,
): void {
  const tracked = trackedRandom('preflight');
  expect(() => estimateEquity(observation, samples, tracked.random)).toThrow();
  expect(tracked.calls).toEqual({ nextFloat: 0, nextUint32: 0, fork: 0 });
}

describe('deterministic visible-state equity', () => {
  it('exports the locked public API and gives an unbeatable private royal full equity', () => {
    expect(MAX_EQUITY_SAMPLES).toBe(1_000_000);
    expect(publicApi.estimateEquity).toBe(estimateEquity);
    expect(publicApi.MAX_EQUITY_SAMPLES).toBe(MAX_EQUITY_SAMPLES);

    const observation = fixtureObservation({
      holeCards: ['As', 'Ks'],
      board: ['Qs', 'Js', 'Ts', '2d', '3c'],
      statuses: ['active', 'active'],
    });
    expect(estimateEquity(observation, 50, createSeededRandom('eq'))).toEqual({
      equity: 1,
      wins: 50,
      ties: 0,
      losses: 0,
      samples: 50,
    });
  });

  it.each([1, 2, 3, 4, 5])(
    'splits a board royal exactly across hero and %i live opponents',
    (opponents) => {
      const observation = fixtureObservation({
        holeCards: ['2c', '3d'],
        board: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
        statuses: Array.from({ length: opponents + 1 }, () => 'active'),
      });
      const samples = opponents === 2 ? 50 : 7;
      expect(estimateEquity(observation, samples, createSeededRandom(`board-${opponents}`)))
        .toEqual({
          equity: 1 / (opponents + 1),
          wins: 0,
          ties: samples,
          losses: 0,
          samples,
        });
    },
  );

  it('always loses the legal six-player quads-board fixture', () => {
    const observation = fixtureObservation({
      holeCards: ['4c', '5d'],
      board: ['2c', '2d', '2h', '2s', '3c'],
      statuses: Array.from({ length: 6 }, () => 'active'),
    });
    expect(estimateEquity(observation, 25, createSeededRandom('all-loss'))).toEqual({
      equity: 0,
      wins: 0,
      ties: 0,
      losses: 25,
      samples: 25,
    });
  });

  it('credits only the globally best partial tie winners', () => {
    const observation = fixtureObservation({
      holeCards: ['Tc', '3d'],
      board: ['As', 'Kd', 'Qc', 'Jh', '2s'],
      statuses: ['active', 'active', 'active'],
    });
    expect(estimateEquity(observation, 1, createSeededRandom('partial-tie-5'))).toEqual({
      equity: 1 / 2,
      wins: 0,
      ties: 1,
      losses: 0,
      samples: 1,
    });
  });

  it('counts a local tie as a loss when another opponent is strictly better', () => {
    const observation = fixtureObservation({
      holeCards: ['6c', 'Ac'],
      board: ['2d', '3h', '4s', '5c', '9d'],
      statuses: ['active', 'active', 'active'],
    });
    expect(estimateEquity(observation, 1, createSeededRandom('tie-and-lose-174'))).toEqual({
      equity: 0,
      wins: 0,
      ties: 0,
      losses: 1,
      samples: 1,
    });
  });

  it('ignores folded/eliminated seats while active and all-in seats count', () => {
    const base = fixtureObservation({ holeCards: ['2c', '7d'], statuses: ['active', 'active'] });
    const ignored = fixtureObservation({
      holeCards: ['2c', '7d'],
      statuses: ['active', 'active', 'folded', 'eliminated'],
    });
    const baseRandom = trackedRandom('ignored-seats');
    const ignoredRandom = trackedRandom('ignored-seats');
    expect(estimateEquity(ignored, 10, ignoredRandom.random))
      .toEqual(estimateEquity(base, 10, baseRandom.random));
    expect(ignoredRandom.calls).toEqual(baseRandom.calls);

    const counted = fixtureObservation({
      holeCards: ['2c', '3d'],
      board: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
      statuses: ['active', 'active', 'all-in', 'folded', 'eliminated'],
    });
    expect(estimateEquity(counted, 50, createSeededRandom('counted'))).toEqual({
      equity: 1 / 3,
      wins: 0,
      ties: 50,
      losses: 0,
      samples: 50,
    });
  });

  it('is reproducible for equal seeds and locks the required different-seed vector', () => {
    const observation = fixtureObservation({ holeCards: ['2c', '7d'] });
    expect(estimateEquity(observation, 40, createSeededRandom('same')))
      .toEqual(estimateEquity(observation, 40, createSeededRandom('same')));
    expect(estimateEquity(observation, 1, createSeededRandom('eq-a'))).toEqual({
      equity: 1, wins: 1, ties: 0, losses: 0, samples: 1,
    });
    expect(estimateEquity(observation, 1, createSeededRandom('eq-b'))).toEqual({
      equity: 0, wins: 0, ties: 0, losses: 1, samples: 1,
    });
  });

  it('does not read or serialize cast-only private authority fields', () => {
    const base = fixtureObservation({ holeCards: ['2c', '7d'] });
    const withPrivateA = Object.assign({}, base, {
      opponentHoleCards: ['MASTER-SEED-SENTINEL-A'],
      burnedCards: ['BURN-SENTINEL-A'],
      futureDeck: ['DECK-SENTINEL-A'],
      authorityHandId: 'AUTHORITY-HAND-A',
      masterSeed: 'MASTER-SEED-SENTINEL-A',
    }) as PlayerObservationV1;
    const withPrivateB = Object.assign({}, base, {
      opponentHoleCards: ['MASTER-SEED-SENTINEL-B'],
      burnedCards: ['BURN-SENTINEL-B'],
      futureDeck: ['DECK-SENTINEL-B'],
      authorityHandId: 'AUTHORITY-HAND-B',
      masterSeed: 'MASTER-SEED-SENTINEL-B',
    }) as PlayerObservationV1;
    const resultA = estimateEquity(withPrivateA, 5, createSeededRandom('private-world'));
    const resultB = estimateEquity(withPrivateB, 5, createSeededRandom('private-world'));
    expect(resultA).toEqual(resultB);
    expect(JSON.stringify(resultA)).not.toMatch(/SENTINEL|AUTHORITY/);

    const throwing = { ...base } as PlayerObservationV1 & Record<string, unknown>;
    for (const name of ['opponentHoleCards', 'burnedCards', 'futureDeck', 'authorityHandId', 'masterSeed']) {
      Object.defineProperty(throwing, name, {
        enumerable: true,
        get: () => { throw new Error(`${name}-GETTER-SENTINEL`); },
      });
    }
    expect(() => estimateEquity(throwing, 1, createSeededRandom('throwing-private')))
      .not.toThrow();
  });
});

describe('equity preflight validation', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['cap plus one', MAX_EQUITY_SAMPLES + 1],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s samples without consuming RNG', (_name, samples) => {
    expectPreflightRejection(fixtureObservation(), samples);
  });

  it.each([
    ['duplicate hero cards', { holeCards: [parseCard('Ah'), parseCard('Ah')] }],
    ['hero-board collision', { board: [parseCard('Ah'), parseCard('2c'), parseCard('3d')], street: 'flop' }],
    ['duplicate board card', { board: [parseCard('2c'), parseCard('2c'), parseCard('3d')], street: 'flop' }],
    ['forged rank', { holeCards: [{ code: 'Ah', rank: 13, suit: 'h' }, parseCard('Kd')] }],
    ['forged suit', { holeCards: [{ code: 'Ah', rank: 14, suit: 's' }, parseCard('Kd')] }],
    ['invalid runtime card code', { holeCards: [{ code: 'ZZ', rank: 14, suit: 's' }, parseCard('Kd')] }],
    ['one-card hero tuple', { holeCards: [parseCard('Ah')] }],
    ['three-card hero tuple', { holeCards: [parseCard('Ah'), parseCard('Kd'), parseCard('Qc')] }],
  ] as const)('rejects %s before consuming RNG', (_name, changes) => {
    expectPreflightRejection({ ...fixtureObservation(), ...changes } as unknown as PlayerObservationV1);
  });

  it.each([
    ['one board card', ['2c'], 'preflop'],
    ['two board cards', ['2c', '3d'], 'preflop'],
    ['six board cards', ['2c', '3d', '4h', '5s', '6c', '7d'], 'river'],
    ['flop-sized board on turn', ['2c', '3d', '4h'], 'turn'],
    ['empty board on river', [], 'river'],
  ] as const)('rejects %s and street mismatch before consuming RNG', (_name, board, street) => {
    expectPreflightRejection(fixtureObservation({ board, street }));
  });

  it('rejects malformed schema, street, seat state, actor, and identities before RNG', () => {
    const base = fixtureObservation();
    const invalid: PlayerObservationV1[] = [
      { ...base, schemaVersion: 2 as 1 },
      { ...base, street: 'showdown' as Street },
      replaceSeat(base, 1, { status: 'watching' as PlayerHandStatus }),
      { ...base, actorSeatIndex: 5 },
      replaceSeat(base, 0, { status: 'folded' }),
      replaceSeat(base, 1, { seatIndex: 0 }),
      replaceSeat(base, 1, { seatIndex: 2 }),
      replaceSeat(base, 1, { seatIndex: Number.MAX_SAFE_INTEGER + 1 }),
      replaceSeat(base, 1, { playerId: '' }),
      replaceSeat(base, 1, { playerId: 'player-0' }),
      fixtureObservation({ statuses: ['active'] }),
      fixtureObservation({ statuses: ['active', 'folded'] }),
      fixtureObservation({ statuses: Array.from({ length: 7 }, () => 'active') }),
    ];
    for (const observation of invalid) expectPreflightRejection(observation);
  });

  it('accepts the maximum valid six-seat preflop boundary', () => {
    const observation = fixtureObservation({
      holeCards: ['2c', '7d'],
      statuses: ['active', 'active', 'active', 'active', 'active', 'all-in'],
    });
    const result = estimateEquity(observation, 1, createSeededRandom('six-seat-boundary'));
    expect(result.wins + result.ties + result.losses).toBe(1);
  });

  it('rejects any reveal marker without reading revealed card values or RNG', () => {
    let cardReads = 0;
    const revealed: unknown[] = [];
    for (const index of [0, 1]) {
      Object.defineProperty(revealed, index, {
        enumerable: true,
        get: () => {
          cardReads += 1;
          throw new Error('REVEALED-CARD-GETTER-SENTINEL');
        },
      });
    }
    const observation = replaceSeat(fixtureObservation(), 1, {
      revealedHoleCards: revealed as unknown as readonly [Card, Card],
    });
    expectPreflightRejection(observation);
    expect(cardReads).toBe(0);
  });
});

describe('equity input and RNG integrity', () => {
  it('leaves the complete observation and cards unchanged and unfrozen', () => {
    const observation = fixtureObservation({
      holeCards: ['Ah', 'Kd'],
      board: ['2c', '3d', '4h'],
    });
    const before = structuredClone(observation);
    const watched = [observation, observation.holeCards, ...observation.holeCards,
      observation.board, ...observation.board, observation.seats, ...observation.seats];
    expect(watched.every((value) => !Object.isFrozen(value))).toBe(true);

    estimateEquity(observation, 3, createSeededRandom('integrity'));

    expect(observation).toEqual(before);
    expect(watched.every((value) => !Object.isFrozen(value))).toBe(true);
  });

  it('returns a fresh exact-schema result and consumes only the expected nextFloat values', () => {
    const observation = fixtureObservation({
      holeCards: ['Ah', 'Kd'],
      board: ['2c', '3d', '4h'],
      statuses: ['active', 'active', 'all-in'],
    });
    const tracked = trackedRandom('rng-integrity');
    const descriptors = Object.getOwnPropertyDescriptors(tracked.random);
    const keys = Reflect.ownKeys(tracked.random);
    const samples = 4;
    const unknownDeckLength = createStandardDeck().length
      - observation.holeCards.length - observation.board.length;

    const first = estimateEquity(observation, samples, tracked.random);
    const second = estimateEquity(observation, samples, createSeededRandom('rng-integrity'));

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.keys(first).sort()).toEqual(['equity', 'losses', 'samples', 'ties', 'wins']);
    expect(first.wins + first.ties + first.losses).toBe(samples);
    expect(tracked.calls).toEqual({
      nextFloat: samples * (unknownDeckLength - 1),
      nextUint32: 0,
      fork: 0,
    });
    expect(Object.isFrozen(tracked.random)).toBe(false);
    expect(Reflect.ownKeys(tracked.random)).toEqual(keys);
    expect(Object.getOwnPropertyDescriptors(tracked.random)).toEqual(descriptors);
  });

  it('keeps the implementation on visible-state imports and supplied randomness only', () => {
    const source = readFileSync(new URL('../../src/agents/equity.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /from\s+['"][^'"]*(?:state|events|replay|dealing|reducer|settlement|simulation)[^'"]*['"]/,
    );
    expect(source).not.toMatch(/Math\.random|Date\.now/);
  });
});
