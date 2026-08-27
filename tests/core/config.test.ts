import { describe, expect, it } from 'vitest';

import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import {
  DeckValidationError,
  TournamentConfigurationError,
  type TournamentConfig,
} from '../../src/core/config.js';
import {
  createTournament,
  startHand,
  type TournamentSeatInput,
} from '../../src/core/state.js';
import type { Card } from '../../src/core/types.js';

function configFor(maxSeats: number, startingStack = 100): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: 0,
  };
}

function seatsFor(count: number): TournamentSeatInput[] {
  return Array.from({ length: count }, (_, seatIndex) => ({
    playerId: `player-${seatIndex}`,
    seatIndex,
  }));
}

describe('tournament configuration', () => {
  it('accepts the exact safe total-chip boundary for every supported table size', () => {
    for (let maxSeats = 2; maxSeats <= 6; maxSeats += 1) {
      const startingStack = Math.floor(Number.MAX_SAFE_INTEGER / maxSeats);

      const result = createTournament(
        configFor(maxSeats, startingStack),
        seatsFor(maxSeats),
        `safe-${maxSeats}`,
      );

      expect(result.state.initialChipTotal).toBe(startingStack * maxSeats);
    }
  });

  it('rejects one chip above the safe per-seat boundary for every supported table size', () => {
    for (let maxSeats = 2; maxSeats <= 6; maxSeats += 1) {
      const startingStack = Math.floor(Number.MAX_SAFE_INTEGER / maxSeats) + 1;

      expect(() => createTournament(
        configFor(maxSeats, startingStack),
        seatsFor(maxSeats),
        `unsafe-${maxSeats}`,
      )).toThrow(TournamentConfigurationError);
    }
  });

  it.each([1, 7, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxSeats %s',
    (maxSeats) => {
      expect(() => createTournament(configFor(maxSeats), seatsFor(2), 'run'))
        .toThrow(TournamentConfigurationError);
    },
  );

  it('requires exactly one unique participant in each contiguous physical seat', () => {
    const config = configFor(4);
    const invalidSeatSets: readonly TournamentSeatInput[][] = [
      seatsFor(3),
      [...seatsFor(4), { playerId: 'extra', seatIndex: 4 }],
      [
        { playerId: 'same', seatIndex: 0 },
        { playerId: 'same', seatIndex: 1 },
        { playerId: 'p2', seatIndex: 2 },
        { playerId: 'p3', seatIndex: 3 },
      ],
      [
        { playerId: 'p0', seatIndex: 0 },
        { playerId: 'p1', seatIndex: 0 },
        { playerId: 'p2', seatIndex: 2 },
        { playerId: 'p3', seatIndex: 3 },
      ],
      [
        { playerId: 'p0', seatIndex: 0 },
        { playerId: 'p1', seatIndex: 1 },
        { playerId: 'p3', seatIndex: 3 },
        { playerId: 'p4', seatIndex: 4 },
      ],
      [
        { playerId: 'p0', seatIndex: -1 },
        { playerId: 'p1', seatIndex: 1 },
        { playerId: 'p2', seatIndex: 2 },
        { playerId: 'p3', seatIndex: 3 },
      ],
    ];

    for (const seats of invalidSeatSets) {
      expect(() => createTournament(config, seats, 'run'))
        .toThrow(TournamentConfigurationError);
    }
  });

  it('rejects invalid button, stack, level duration, and blind schedule values', () => {
    const valid = configFor(4);
    const invalidConfigs: TournamentConfig[] = [
      { ...valid, initialButtonSeat: -1 },
      { ...valid, initialButtonSeat: 4 },
      { ...valid, initialButtonSeat: 0.5 },
      { ...valid, startingStack: 0 },
      { ...valid, startingStack: -1 },
      { ...valid, startingStack: 1.5 },
      { ...valid, startingStack: Number.POSITIVE_INFINITY },
      { ...valid, handsPerLevel: 0 },
      { ...valid, handsPerLevel: -1 },
      { ...valid, handsPerLevel: 1.5 },
      { ...valid, handsPerLevel: Number.NaN },
      { ...valid, blindLevels: [] },
      { ...valid, blindLevels: [{ smallBlind: 0, bigBlind: 2 }] },
      { ...valid, blindLevels: [{ smallBlind: 2, bigBlind: 2 }] },
      { ...valid, blindLevels: [{ smallBlind: 3, bigBlind: 2 }] },
      { ...valid, blindLevels: [{ smallBlind: 1.5, bigBlind: 2 }] },
      { ...valid, blindLevels: [{ smallBlind: 1, bigBlind: 2.5 }] },
      { ...valid, blindLevels: [{ smallBlind: 1, bigBlind: Number.MAX_VALUE }] },
    ];

    for (const invalidConfig of invalidConfigs) {
      expect(() => createTournament(invalidConfig, seatsFor(4), 'run'))
        .toThrow(TournamentConfigurationError);
    }
  });
});

describe('fixed deck validation', () => {
  it('accepts exactly 52 unique valid cards without mutating their order', () => {
    const tournament = createTournament(configFor(2), seatsFor(2), 'run').state;
    const fixedDeck = createStandardDeck().reverse();
    const originalCodes = fixedDeck.map((card) => card.code);

    const result = startHand(tournament, { fixedDeck });
    const deckEvent = result.events.find((event) => event.type === 'DeckPrepared');

    expect(deckEvent?.type === 'DeckPrepared' && deckEvent.fullOrderedDeck.map((card) => card.code))
      .toEqual(originalCodes);
    expect(fixedDeck.map((card) => card.code)).toEqual(originalCodes);
  });

  it('rejects fixed decks that are not exactly 52 unique valid cards', () => {
    const tournament = createTournament(configFor(2), seatsFor(2), 'run').state;
    const valid = createStandardDeck();
    const duplicate = [...valid.slice(0, 51), valid[0]!];
    const inconsistent = [...valid];
    inconsistent[0] = { ...parseCard('2c'), rank: 14 } as Card;

    for (const fixedDeck of [valid.slice(0, 51), [...valid, parseCard('As')], duplicate, inconsistent]) {
      expect(() => startHand(tournament, { fixedDeck })).toThrow(DeckValidationError);
    }
  });
});
