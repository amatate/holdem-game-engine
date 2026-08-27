import { describe, expect, it } from 'vitest';

import type { TournamentConfig } from '../../src/core/config.js';
import type { PlayerActedEvent } from '../../src/core/events.js';
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

function fixture(options: FixtureOptions): TournamentState {
  const maxSeats = options.stacks.length;
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
    blindLevels: [{ smallBlind: 50, bigBlind: 100 }],
    initialButtonSeat: 0,
  };
  const base = createTournament(
    tableConfig,
    Array.from({ length: maxSeats }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
    'short-all-in-fixture',
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
      handId: 'short-all-in-fixture/hand/1',
      phase: 'flop',
      street: 'flop',
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

function apply(state: TournamentState, seat: number, intent: Parameters<typeof applyIntent>[2]): TournamentState {
  return acceptedAction(state, seat, intent).state;
}

function playerActed(state: TournamentState, seat: number, intent: Parameters<typeof applyIntent>[2]): PlayerActedEvent {
  const result = acceptedAction(state, seat, intent);
  const event = result.events[0];
  expect(event?.type).toBe('PlayerActed');
  return event as PlayerActedEvent;
}

function expectFields(
  state: TournamentState,
  currentBetTo: number,
  lastFullRaiseSize: number,
  lastAggressorSeat: number | null,
  pendingActors: readonly number[],
  lastActed: readonly (number | null)[],
  canRaise: boolean,
): void {
  expect(state.activeHand).toMatchObject({
    currentBetTo,
    lastFullRaiseSize,
    lastAggressorSeat,
    pendingActors,
  });
  expect(state.seats.map((seat) => seat.lastActedAtBetTo)).toEqual(lastActed);
  const actor = state.activeHand?.currentActorSeat;
  expect(actor).toBe(pendingActors[0] ?? null);
  expect(actor === null || actor === undefined ? false : getLegalActions(state, actor).raiseTo !== null)
    .toBe(canRaise);
}

describe('all-in normalization', () => {
  it.each([
    { stack: 20, mode: 'shortBet', fullRaise: false },
    { stack: 100, mode: 'fullBet', fullRaise: true },
  ] as const)('normalizes opening $mode all-ins as bets and makes max raiseTo equivalent', ({ stack, mode, fullRaise }) => {
    const state = fixture({
      committed: [0, 0, 0],
      stacks: stack === 20 ? [stack, 999, 1_000] : [stack, 1_000, 1_000],
      actor: 0,
      pending: [0, 1, 2],
      currentBetTo: 0,
      lastFullRaiseSize: 100,
    });

    expect(getLegalActions(state, 0).allIn).toEqual({ to: stack, mode });
    const convenience = playerActed(state, 0, { type: 'allIn' });
    const explicit = playerActed(state, 0, { type: 'raiseTo', amount: stack });
    expect(convenience).toMatchObject({
      normalizedKind: 'bet',
      paid: stack,
      betToBefore: 0,
      betToAfter: stack,
      allIn: true,
      fullRaise,
    });
    expect(explicit).toEqual(convenience);
  });

  it.each([
    { stack: 50, mode: 'shortRaise', fullRaise: false },
    { stack: 100, mode: 'fullRaise', fullRaise: true },
  ] as const)('normalizes $mode all-ins and makes max raiseTo equivalent', ({ stack, mode, fullRaise }) => {
    const state = fixture({
      committed: [100, 100, 100],
      stacks: stack === 50 ? [stack, 999, 1_000] : [stack, 1_000, 1_000],
      actor: 0,
      pending: [0, 1, 2],
      currentBetTo: 100,
      lastFullRaiseSize: 100,
    });
    const target = 100 + stack;

    expect(getLegalActions(state, 0).allIn).toEqual({ to: target, mode });
    const convenience = playerActed(state, 0, { type: 'allIn' });
    const explicit = playerActed(state, 0, { type: 'raiseTo', amount: target });
    expect(convenience).toMatchObject({
      normalizedKind: 'raise',
      paid: stack,
      betToBefore: 100,
      betToAfter: target,
      allIn: true,
      fullRaise,
    });
    expect(explicit).toEqual(convenience);
  });
});

describe('short all-in raise reopening', () => {
  it('does not reopen an already acting bettor after one short raise', () => {
    let state = fixture({
      committed: [0, 0, 0],
      stacks: [1_000, 150, 1_001],
      actor: 0,
      pending: [0, 1, 2],
      currentBetTo: 0,
      lastFullRaiseSize: 100,
    });
    state = apply(state, 0, { type: 'raiseTo', amount: 100 });
    expectFields(state, 100, 100, 0, [1, 2], [100, null, null], false);
    state = apply(state, 1, { type: 'allIn' });
    expectFields(state, 150, 100, 1, [2, 0], [100, 150, null], true);
    state = apply(state, 2, { type: 'call' });
    expectFields(state, 150, 100, 1, [0], [100, 150, 150], false);
    expect(getLegalActions(state, 0)).toMatchObject({ fold: true, call: { pay: 50, to: 150 }, raiseTo: null });
    const rejectedRaise = applyIntent(state, 0, { type: 'raiseTo', amount: 250 });
    expect(rejectedRaise.accepted).toBe(false);
    expect(rejectedRaise.state).toBe(state);
    expect(rejectedRaise.events).toEqual([]);
    expect(rejectedRaise.state.version).toBe(state.version);
    if (!rejectedRaise.accepted) {
      expect(rejectedRaise.rejection.code).toBe('raise-not-reopened');
    }
  });

  it('partially reopens cumulative short raises according to each player lastActedAtBetTo', () => {
    let state = fixture({
      committed: [0, 0, 0, 0, 0],
      stacks: [1_000, 125, 1_000, 200, 1_000],
      actor: 0,
      pending: [0, 1, 2, 3, 4],
      currentBetTo: 0,
      lastFullRaiseSize: 100,
    });
    state = apply(state, 0, { type: 'raiseTo', amount: 100 });
    expectFields(state, 100, 100, 0, [1, 2, 3, 4], [100, null, null, null, null], false);
    state = apply(state, 1, { type: 'allIn' });
    expectFields(state, 125, 100, 1, [2, 3, 4, 0], [100, 125, null, null, null], true);
    state = apply(state, 2, { type: 'call' });
    expectFields(state, 125, 100, 1, [3, 4, 0], [100, 125, 125, null, null], false);
    state = apply(state, 3, { type: 'allIn' });
    expectFields(state, 200, 100, 3, [4, 0, 2], [100, 125, 125, 200, null], true);
    state = apply(state, 4, { type: 'call' });
    expectFields(state, 200, 100, 3, [0, 2], [100, 125, 125, 200, 200], true);
    state = apply(state, 0, { type: 'call' });
    expectFields(state, 200, 100, 3, [2], [200, 125, 125, 200, 200], false);
    expect(getLegalActions(state, 2).raiseTo).toBeNull();
  });

  it('keeps raise rights for an unacted player after a short opening bet but not for the prior checker', () => {
    let state = fixture({
      committed: [0, 0, 0],
      stacks: [999, 20, 1_000],
      actor: 0,
      pending: [0, 1, 2],
      currentBetTo: 0,
      lastFullRaiseSize: 100,
    });
    state = apply(state, 0, { type: 'check' });
    expectFields(state, 0, 100, null, [1, 2], [0, null, null], false);
    state = apply(state, 1, { type: 'allIn' });
    expectFields(state, 20, 100, 1, [2, 0], [0, 20, null], true);
    expect(getLegalActions(state, 2)).toEqual({
      fold: true,
      check: false,
      call: { pay: 20, to: 20, isAllIn: false },
      raiseTo: { min: 120, max: 1_000 },
      allIn: { to: 1_000, mode: 'fullRaise' },
    });
    state = apply(state, 2, { type: 'call' });
    expectFields(state, 20, 100, 1, [0], [0, 20, 20], false);
    expect(getLegalActions(state, 0)).toEqual({
      fold: true,
      check: false,
      call: { pay: 20, to: 20, isAllIn: false },
      raiseTo: null,
      allIn: null,
    });
    const rejectedRaise = applyIntent(state, 0, { type: 'raiseTo', amount: 120 });
    expect(rejectedRaise.accepted).toBe(false);
    expect(rejectedRaise.state).toBe(state);
    expect(rejectedRaise.events).toEqual([]);
    expect(rejectedRaise.state.version).toBe(state.version);
    if (!rejectedRaise.accepted) {
      expect(rejectedRaise.rejection.code).toBe('raise-not-reopened');
    }
  });

  it('preserves the original full increment across three short raises and gives an unacted player min 1100', () => {
    let state = fixture({
      committed: [0, 0, 0, 0, 0],
      stacks: [2_000, 500, 650, 800, 2_000],
      actor: 0,
      pending: [0, 1, 2, 3, 4],
      currentBetTo: 0,
      lastFullRaiseSize: 100,
    });
    state = apply(state, 0, { type: 'raiseTo', amount: 300 });
    expectFields(state, 300, 300, 0, [1, 2, 3, 4], [300, null, null, null, null], false);
    state = apply(state, 1, { type: 'allIn' });
    expectFields(state, 500, 300, 1, [2, 3, 4, 0], [300, 500, null, null, null], false);
    state = apply(state, 2, { type: 'allIn' });
    expectFields(state, 650, 300, 2, [3, 4, 0], [300, 500, 650, null, null], false);
    state = apply(state, 3, { type: 'allIn' });
    expectFields(state, 800, 300, 3, [4, 0], [300, 500, 650, 800, null], true);
    expect(getLegalActions(state, 4).raiseTo).toEqual({ min: 1_100, max: 2_000 });
  });
});
