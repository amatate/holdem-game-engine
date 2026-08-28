import { describe, expect, it } from 'vitest';

import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import type { PlayerEliminatedEvent } from '../../src/core/events.js';
import { applyIntent } from '../../src/core/reducer.js';
import { settleShowdown } from '../../src/core/settlement.js';
import {
  createTournament,
  reduceDomainEvent,
  startNextHand,
  type PositionState,
  type TournamentState,
} from '../../src/core/state.js';

function config(maxSeats = 4): TournamentConfig {
  return {
    maxSeats,
    startingStack: 100,
    handsPerLevel: 1,
    blindLevels: [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
    ],
    initialButtonSeat: 0,
  };
}

function completedState(
  tableConfig: TournamentConfig,
  handNumber: number,
  stacks: readonly number[] = Array.from({ length: tableConfig.maxSeats }, () => tableConfig.startingStack),
  positions: PositionState = { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
): TournamentState {
  const base = createTournament(
    tableConfig,
    Array.from({ length: tableConfig.maxSeats }, (_, seatIndex) => ({
      playerId: `p${seatIndex}`,
      seatIndex,
    })),
    `lifecycle-${tableConfig.maxSeats}-${handNumber}`,
  ).state;
  const eliminatedSeats = stacks
    .map((stack, seatIndex) => ({ stack, seatIndex }))
    .filter(({ stack }) => stack === 0)
    .map(({ seatIndex }, index): PlayerEliminatedEvent => ({
      type: 'PlayerEliminated',
      schemaVersion: 1,
      eventIndex: base.version + index,
      handId: `${base.runSeed}/hand/${handNumber}`,
      seat: seatIndex,
    }));

  return {
    ...base,
    handNumber,
    seats: base.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: stacks[seatIndex]!,
      status: stacks[seatIndex] === 0 ? 'eliminated' as const : 'active' as const,
    })),
    activeHand: {
      handId: `${base.runSeed}/hand/${handNumber}`,
      phase: 'hand-complete',
      street: 'river',
      board: [],
      burnedCards: [],
      deck: [],
      dealCursor: 0,
      revealedHoleCardSeats: [],
      positions,
      currentActorSeat: null,
      currentBetTo: 0,
      lastFullRaiseSize: 2,
      lastAggressorSeat: null,
      pendingActors: [],
      pendingPots: [],
      constructedPotCount: 0,
      lastConstructedCap: 0,
    },
    eventLog: [...base.eventLog, ...eliminatedSeats],
    version: base.version + eliminatedSeats.length,
  };
}

describe('blind level lifecycle', () => {
  it.each([
    { priorHand: 1, logicalLevel: 1, smallBlind: 2, bigBlind: 4 },
    { priorHand: 2, logicalLevel: 2, smallBlind: 4, bigBlind: 8 },
    { priorHand: 3, logicalLevel: 3, smallBlind: 8, bigBlind: 16 },
    { priorHand: 60, logicalLevel: 60, smallBlind: 400, bigBlind: 400 },
  ])(
    'uses logical level $logicalLevel with safe extrapolation',
    ({ priorHand, logicalLevel, smallBlind, bigBlind }) => {
      const result = startNextHand(completedState(config(), priorHand), {
        fixedDeck: createStandardDeck(),
      });
      const started = result.events.find((event) => event.type === 'HandStarted');

      expect(started).toMatchObject({ logicalBlindLevel: logicalLevel, smallBlind, bigBlind });
      expect(result.state.logicalBlindLevel).toBe(logicalLevel);
      expect(Number.isSafeInteger(smallBlind)).toBe(true);
      expect(Number.isSafeInteger(bigBlind)).toBe(true);
    },
  );

  it('uses an extrapolated big blind during postflop automatic runout', () => {
    let state = startNextHand(completedState(config(2), 2), {
      fixedDeck: createStandardDeck(),
    }).state;
    const buttonAllIn = applyIntent(state, state.activeHand!.currentActorSeat!, { type: 'allIn' });
    expect(buttonAllIn.accepted).toBe(true);
    if (!buttonAllIn.accepted) throw new Error(buttonAllIn.rejection.message);
    state = buttonAllIn.state;
    const call = applyIntent(state, state.activeHand!.currentActorSeat!, { type: 'call' });
    expect(call.accepted).toBe(true);
    if (!call.accepted) throw new Error(call.rejection.message);

    const completed = advanceAutomaticPhases(call.state).state;
    expect(completed.activeHand).toMatchObject({ phase: 'hand-complete', lastFullRaiseSize: 8 });
  });
});

describe('physical seats, finalized elimination, and HU continuity', () => {
  const huCases = [
    [3, [0, 1], 0], [3, [0, 2], 0], [3, [1, 2], 1],
    [4, [0, 1], 0], [4, [0, 2], 0], [4, [0, 3], 3], [4, [1, 2], 1],
    [4, [1, 3], 3], [4, [2, 3], 3],
    [5, [0, 1], 0], [5, [0, 2], 0], [5, [0, 3], 3], [5, [0, 4], 4],
    [5, [1, 2], 1], [5, [1, 3], 3], [5, [1, 4], 4], [5, [2, 3], 3],
    [5, [2, 4], 4], [5, [3, 4], 3],
    [6, [0, 1], 0], [6, [0, 2], 0], [6, [0, 3], 3], [6, [0, 4], 4],
    [6, [0, 5], 5], [6, [1, 2], 1], [6, [1, 3], 3], [6, [1, 4], 4],
    [6, [1, 5], 5], [6, [2, 3], 3], [6, [2, 4], 4], [6, [2, 5], 5],
    [6, [3, 4], 3], [6, [3, 5], 3], [6, [4, 5], 4],
  ] as const;

  it.each(huCases)(
    'preserves former-BB continuity for %i-to-HU survivors %j',
    (maxSeats, survivors, expectedBigBlind) => {
      const tableConfig = config(maxSeats);
      const survivorSet = new Set<number>(survivors);
      const stacks = Array.from({ length: maxSeats }, (_, seat) => {
        if (seat === survivors[0]) return 100;
        if (seat === survivors[1]) return tableConfig.startingStack * maxSeats - 100;
        return 0;
      });
      const before = completedState(
        tableConfig,
        1,
        stacks,
        { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
      );
      const beforeEliminations = before.eventLog.filter((event) => event.type === 'PlayerEliminated');
      const result = startNextHand(before, { fixedDeck: createStandardDeck() });
      const blinds = result.events.filter((event) => event.type === 'BlindPosted');
      const dealtSeats = new Set(result.events
        .filter((event) => event.type === 'HoleCardsDealt')
        .flatMap((event) => event.orderedDeals.map((deal) => deal.seat)));

      expect(result.state.seats.map((seat) => seat.seatIndex))
        .toEqual(Array.from({ length: maxSeats }, (_, seat) => seat));
      expect(result.state.activeHand?.positions).toEqual({
        buttonPosition: survivors.find((seat) => seat !== expectedBigBlind),
        smallBlindSeat: survivors.find((seat) => seat !== expectedBigBlind),
        bigBlindSeat: expectedBigBlind,
      });
      expect(blinds.map((event) => event.seat).every((seat) => survivorSet.has(seat))).toBe(true);
      expect([...dealtSeats].sort((left, right) => left - right)).toEqual([...survivors]);
      expect(result.state.seats
        .filter((seat) => !survivorSet.has(seat.seatIndex))
        .every((seat) => seat.status === 'eliminated' && seat.stack === 0 && seat.holeCards === null))
        .toBe(true);
      expect(result.events.some((event) => event.type === 'PlayerEliminated')).toBe(false);
      expect(result.state.eventLog.filter((event) => event.type === 'PlayerEliminated'))
        .toEqual(beforeEliminations);
    },
  );

  it.each([3, 4, 5, 6])(
    'flows from real %i-player showdown elimination into an HU hand without re-elimination',
    (maxSeats) => {
      const tableConfig = config(maxSeats);
      const base = createTournament(
        tableConfig,
        Array.from({ length: maxSeats }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
        `e2e-hu-${maxSeats}`,
      ).state;
      const holeCodes = [
        ['Ah', 'Ad'], ['Kh', 'Kd'], ['4c', '5c'], ['6d', '8d'], ['Tc', 'Qc'], ['3s', '4s'],
      ] as const;
      const showdown: TournamentState = {
        ...base,
        handNumber: 1,
        seats: base.seats.map((seat, seatIndex) => ({
          ...seat,
          stack: seatIndex < 2 ? 45 * maxSeats : 0,
          status: seatIndex < 2 ? 'active' as const : 'all-in' as const,
          holeCards: holeCodes[seatIndex]!.map(parseCard) as unknown as NonNullable<typeof seat.holeCards>,
          committedStreet: 10,
          committedHand: 10,
        })),
        activeHand: {
          handId: `${base.runSeed}/hand/1`,
          phase: 'showdown',
          street: 'river',
          board: ['2c', '3d', '7h', '9s', 'Jc'].map(parseCard),
          burnedCards: [],
          deck: [],
          dealCursor: 0,
          revealedHoleCardSeats: [],
          positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
          currentActorSeat: null,
          currentBetTo: 0,
          lastFullRaiseSize: 2,
          lastAggressorSeat: null,
          pendingActors: [],
        },
      };
      const settled = settleShowdown(showdown);
      const eliminated = settled.events.filter((event) => event.type === 'PlayerEliminated');
      expect(eliminated.map((event) => event.seat)).toEqual(
        Array.from({ length: maxSeats - 2 }, (_, index) => index + 2),
      );
      const next = startNextHand(settled.state, { fixedDeck: createStandardDeck() });

      expect(next.state.activeHand?.positions).toEqual({
        buttonPosition: 1,
        smallBlindSeat: 1,
        bigBlindSeat: 0,
      });
      expect(next.events.some((event) => event.type === 'PlayerEliminated')).toBe(false);
      expect(next.state.eventLog.filter((event) => event.type === 'PlayerEliminated')).toEqual(eliminated);
    },
  );

  it('emits GameCompleted instead of starting another hand when exactly one survivor remains', () => {
    const before = completedState(config(4), 7, [0, 0, 400, 0]);
    const result = startNextHand(before, { fixedDeck: createStandardDeck() });

    expect(result.events).toEqual([expect.objectContaining({
      type: 'GameCompleted',
      winnerSeat: 2,
      eventIndex: before.version,
    })]);
    expect(result.events.some((event) => event.type === 'HandStarted')).toBe(false);
    expect(result.state.activeHand).toMatchObject({ phase: 'game-complete', currentActorSeat: null });
    expect(result.state.eventLog.filter((event) => event.type === 'GameCompleted')).toHaveLength(1);

    const again = startNextHand(result.state, { fixedDeck: createStandardDeck() });
    expect(again).toEqual({ state: result.state, events: [] });
    expect(again.state.eventLog.filter((event) => event.type === 'GameCompleted')).toHaveLength(1);
  });

  it('rejects GameCompleted for a hand id other than the completed hand', () => {
    const before = completedState(config(4), 7, [0, 0, 400, 0]);

    expect(() => reduceDomainEvent(before, {
      type: 'GameCompleted',
      schemaVersion: 1,
      eventIndex: before.version,
      handId: 'different/hand/7',
      winnerSeat: 2,
    })).toThrow(/matching|hand|complete/i);
  });
});
