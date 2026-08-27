import { describe, expect, it } from 'vitest';

import type { TournamentConfig } from '../../src/core/config.js';
import { getLegalActions } from '../../src/core/legal-actions.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  type TournamentState,
} from '../../src/core/state.js';

interface FixtureOptions {
  readonly committed: readonly number[];
  readonly stacks: readonly number[];
  readonly actor: number;
  readonly pending: readonly number[];
  readonly currentBetTo: number;
  readonly lastFullRaiseSize: number;
  readonly lastAggressorSeat?: number | null;
  readonly lastActed?: readonly (number | null)[];
  readonly bigBlind?: number;
}

function expectConserved(state: TournamentState): void {
  expect(state.seats.every((seat) => Number.isSafeInteger(seat.stack)
    && seat.stack >= 0
    && Number.isSafeInteger(seat.committedHand)
    && seat.committedHand >= 0)).toBe(true);
  const total = state.seats.reduce(
    (sum, seat) => sum + seat.stack + seat.committedHand,
    0,
  );
  expect(Number.isSafeInteger(total)).toBe(true);
  expect(total).toBe(state.initialChipTotal);
  expect(state.initialChipTotal).toBe(state.config.startingStack * state.config.maxSeats);
}

function bettingState(options: FixtureOptions): TournamentState {
  const maxSeats = options.stacks.length;
  const bigBlind = options.bigBlind ?? options.lastFullRaiseSize;
  const initialChipTotal = options.stacks.reduce(
    (sum, stack, seatIndex) => sum + stack + options.committed[seatIndex]!,
    0,
  );
  const startingStack = initialChipTotal / maxSeats;
  expect(Number.isSafeInteger(startingStack)).toBe(true);
  const tableConfig: TournamentConfig = {
    maxSeats,
    startingStack,
    handsPerLevel: 10,
    blindLevels: [{ smallBlind: Math.max(1, Math.floor(bigBlind / 2)), bigBlind }],
    initialButtonSeat: 0,
  };
  const base = createTournament(
    tableConfig,
    Array.from({ length: maxSeats }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
    'betting-fixture',
  ).state;
  const state: TournamentState = {
    ...base,
    seats: base.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: options.stacks[seatIndex]!,
      status: options.stacks[seatIndex] === 0 ? 'all-in' as const : 'active' as const,
      committedStreet: options.committed[seatIndex]!,
      committedHand: options.committed[seatIndex]!,
      lastActedAtBetTo: options.lastActed?.[seatIndex] ?? null,
    })),
    activeHand: {
      handId: 'betting-fixture/hand/1',
      phase: 'preflop',
      street: 'preflop',
      board: [],
      burnedCards: [],
      deck: [],
      dealCursor: 0,
      revealedHoleCardSeats: [],
      positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 % maxSeats },
      currentActorSeat: options.actor,
      currentBetTo: options.currentBetTo,
      lastFullRaiseSize: options.lastFullRaiseSize,
      lastAggressorSeat: options.lastAggressorSeat ?? null,
      pendingActors: options.pending,
    },
  };
  expectConserved(state);
  return state;
}

function acceptedAction(
  state: TournamentState,
  seat: number,
  intent: Parameters<typeof applyIntent>[2],
): Extract<ReturnType<typeof applyIntent>, { readonly accepted: true }> {
  expectConserved(state);
  const snapshot = structuredClone(state);
  const result = applyIntent(state, seat, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) {
    throw new Error(`expected accepted action, received ${result.rejection.code}`);
  }
  expect(result.events).toHaveLength(1);
  expect(result.state).toEqual(reduceDomainEvent(state, result.events[0]!));
  expect(state).toEqual(snapshot);
  expectConserved(result.state);
  return result;
}

function act(state: TournamentState, seat: number, intent: Parameters<typeof applyIntent>[2]): TournamentState {
  return acceptedAction(state, seat, intent).state;
}

function expectBettingState(
  state: TournamentState,
  expected: {
    currentBetTo: number;
    lastFullRaiseSize: number;
    lastAggressorSeat: number | null;
    pendingActors: readonly number[];
    lastActed: readonly (number | null)[];
    actorCanRaise: boolean;
  },
): void {
  expect(state.activeHand).toMatchObject({
    currentBetTo: expected.currentBetTo,
    lastFullRaiseSize: expected.lastFullRaiseSize,
    lastAggressorSeat: expected.lastAggressorSeat,
    pendingActors: expected.pendingActors,
  });
  expect(state.seats.map((seat) => seat.lastActedAtBetTo)).toEqual(expected.lastActed);
  const actor = state.activeHand?.currentActorSeat;
  expect(actor).toBe(expected.pendingActors[0] ?? null);
  expect(actor === null || actor === undefined ? false : getLegalActions(state, actor).raiseTo !== null)
    .toBe(expected.actorCanRaise);
}

describe('canonical no-limit raises', () => {
  it('uses the previous full increment rather than the new total for minRaiseTo', () => {
    let state = bettingState({
      committed: [10, 10, 10],
      stacks: [90, 90, 90],
      actor: 0,
      pending: [0, 1, 2],
      currentBetTo: 10,
      lastFullRaiseSize: 10,
      lastAggressorSeat: 2,
      bigBlind: 10,
    });

    state = act(state, 0, { type: 'raiseTo', amount: 30 });
    expectBettingState(state, {
      currentBetTo: 30,
      lastFullRaiseSize: 20,
      lastAggressorSeat: 0,
      pendingActors: [1, 2],
      lastActed: [30, null, null],
      actorCanRaise: true,
    });
    expect(getLegalActions(state, 1).raiseTo).toEqual({ min: 50, max: 100 });
  });

  it('updates every authoritative betting field and conserves chips on a full raise', () => {
    const before = bettingState({
      committed: [100, 100, 100, 100],
      stacks: [900, 900, 900, 900],
      actor: 0,
      pending: [0, 1, 2, 3],
      currentBetTo: 100,
      lastFullRaiseSize: 100,
      lastAggressorSeat: 3,
      bigBlind: 100,
    });
    const beforeTotal = before.seats.reduce((sum, seat) => sum + seat.stack + seat.committedHand, 0);
    const result = acceptedAction(before, 0, { type: 'raiseTo', amount: 300 });

    expect(result.accepted).toBe(true);
    expect(result.events[0]).toMatchObject({
      type: 'PlayerActed',
      seat: 0,
      normalizedKind: 'raise',
      paid: 200,
      betToBefore: 100,
      betToAfter: 300,
      allIn: false,
      fullRaise: true,
      raiseReopened: true,
    });
    expectBettingState(result.state, {
      currentBetTo: 300,
      lastFullRaiseSize: 200,
      lastAggressorSeat: 0,
      pendingActors: [1, 2, 3],
      lastActed: [300, null, null, null],
      actorCanRaise: true,
    });
    expect(result.state.seats[0]).toMatchObject({ stack: 700, committedStreet: 300, committedHand: 300 });
    expect(result.state.seats.reduce((sum, seat) => sum + seat.stack + seat.committedHand, 0))
      .toBe(beforeTotal);
    expect(result.state.seats.every((seat) => seat.stack >= 0)).toBe(true);
  });

  it('keeps the big blind option pending after every earlier player only calls', () => {
    let state = bettingState({
      committed: [0, 50, 100, 0],
      stacks: [1_000, 950, 900, 1_000],
      actor: 3,
      pending: [3, 0, 1, 2],
      currentBetTo: 100,
      lastFullRaiseSize: 100,
      lastAggressorSeat: 2,
      bigBlind: 100,
    });

    state = act(state, 3, { type: 'call' });
    expectBettingState(state, {
      currentBetTo: 100,
      lastFullRaiseSize: 100,
      lastAggressorSeat: 2,
      pendingActors: [0, 1, 2],
      lastActed: [null, null, null, 100],
      actorCanRaise: true,
    });
    state = act(state, 0, { type: 'call' });
    expectBettingState(state, {
      currentBetTo: 100,
      lastFullRaiseSize: 100,
      lastAggressorSeat: 2,
      pendingActors: [1, 2],
      lastActed: [100, null, null, 100],
      actorCanRaise: true,
    });
    state = act(state, 1, { type: 'call' });
    expectBettingState(state, {
      currentBetTo: 100,
      lastFullRaiseSize: 100,
      lastAggressorSeat: 2,
      pendingActors: [2],
      lastActed: [100, 100, null, 100],
      actorCanRaise: true,
    });
    expect(getLegalActions(state, 2).check).toBe(true);
  });
});

describe('unacted blind rights and a full reopening raise', () => {
  it('lets the unacted BB raise over a short all-in, then distinguishes call from full-raise reopening', () => {
    const initial = bettingState({
      committed: [0, 4_000, 4_000],
      stacks: [15_500, 3_500, 12_000],
      actor: 0,
      pending: [0, 1, 2],
      currentBetTo: 4_000,
      lastFullRaiseSize: 4_000,
      lastAggressorSeat: 2,
      bigBlind: 4_000,
    });
    const afterA = act(initial, 0, { type: 'call' });
    expectBettingState(afterA, {
      currentBetTo: 4_000,
      lastFullRaiseSize: 4_000,
      lastAggressorSeat: 2,
      pendingActors: [1, 2],
      lastActed: [4_000, null, null],
      actorCanRaise: false,
    });
    const afterC = act(afterA, 1, { type: 'allIn' });
    expectBettingState(afterC, {
      currentBetTo: 7_500,
      lastFullRaiseSize: 4_000,
      lastAggressorSeat: 1,
      pendingActors: [2, 0],
      lastActed: [4_000, 7_500, null],
      actorCanRaise: true,
    });
    expect(getLegalActions(afterC, 2).raiseTo).toEqual({ min: 11_500, max: 16_000 });

    const afterBbCall = act(afterC, 2, { type: 'call' });
    expectBettingState(afterBbCall, {
      currentBetTo: 7_500,
      lastFullRaiseSize: 4_000,
      lastAggressorSeat: 1,
      pendingActors: [0],
      lastActed: [4_000, 7_500, 7_500],
      actorCanRaise: false,
    });

    const afterBbRaise = act(afterC, 2, { type: 'raiseTo', amount: 11_500 });
    expectBettingState(afterBbRaise, {
      currentBetTo: 11_500,
      lastFullRaiseSize: 4_000,
      lastAggressorSeat: 2,
      pendingActors: [0],
      lastActed: [4_000, 7_500, 11_500],
      actorCanRaise: true,
    });
  });
});
