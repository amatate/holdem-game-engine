import { describe, expect, it } from 'vitest';

import * as publicApi from '../../src/index.js';
import type { ActionRejectionCode } from '../../src/index.js';
import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { getLegalActions } from '../../src/core/legal-actions.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';

const ROOT_REJECTION_CODE: ActionRejectionCode = 'action-not-legal';

function config(
  maxSeats = 4,
  startingStack = 100,
  smallBlind = 1,
  bigBlind = 2,
): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel: 10,
    blindLevels: [{ smallBlind, bigBlind }],
    initialButtonSeat: 0,
  };
}

function createState(tableConfig = config()): TournamentState {
  return createTournament(
    tableConfig,
    Array.from({ length: tableConfig.maxSeats }, (_, seatIndex) => ({
      playerId: `player-${seatIndex}`,
      seatIndex,
    })),
    'legal-actions',
  ).state;
}

function withStacks(state: TournamentState, stacks: readonly number[]): TournamentState {
  return {
    ...state,
    seats: state.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: stacks[seatIndex]!,
      status: stacks[seatIndex] === 0 ? 'eliminated' as const : 'active' as const,
    })),
  };
}

function expectConserved(state: TournamentState): void {
  expect(state.seats.every((seat) => Number.isSafeInteger(seat.stack)
    && seat.stack >= 0
    && Number.isSafeInteger(seat.committedStreet)
    && seat.committedStreet >= 0
    && Number.isSafeInteger(seat.committedHand)
    && seat.committedHand >= 0
    && seat.committedStreet <= seat.committedHand)).toBe(true);
  const total = state.seats.reduce(
    (sum, seat) => sum + seat.stack + seat.committedHand,
    0,
  );
  expect(Number.isSafeInteger(total)).toBe(true);
  expect(total).toBe(state.initialChipTotal);
  expect(state.initialChipTotal).toBe(state.config.startingStack * state.config.maxSeats);
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

function assertPureRejection(
  before: TournamentState,
  result: ReturnType<typeof applyIntent>,
  code: string,
): void {
  expect(result.accepted).toBe(false);
  expect(result.state).toBe(before);
  expect(result.events).toEqual([]);
  expect(result.state.version).toBe(before.version);
  if (!result.accepted) {
    expect(result.rejection.code).toBe(code);
  }
}

describe('legal action derivation and rejection purity', () => {
  it('keeps internal betting helpers out of the package root API', () => {
    expect(publicApi).not.toHaveProperty('hasRaiseRights');
    expect(publicApi).not.toHaveProperty('hasFundedResponder');
    expect(publicApi).toHaveProperty('getLegalActions');
    expect(publicApi).toHaveProperty('applyIntent');
    expect(ROOT_REJECTION_CODE).toBe('action-not-legal');
  });

  it('exposes fold/call while facing a bet and rejects check without changing authority', () => {
    const state = startHand(createState(), { fixedDeck: createStandardDeck() }).state;

    expectConserved(state);
    expect(getLegalActions(state, 3)).toEqual({
      fold: true,
      check: false,
      call: { pay: 2, to: 2, isAllIn: false },
      raiseTo: { min: 4, max: 100 },
      allIn: { to: 100, mode: 'fullRaise' },
    });
    assertPureRejection(state, applyIntent(state, 3, { type: 'check' }), 'action-not-legal');
  });

  it('exposes check at zero debt and rejects both open-fold and call as V1 non-actions', () => {
    let state = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    state = acceptedAction(state, 3, { type: 'fold' }).state;
    state = acceptedAction(state, 0, { type: 'fold' }).state;
    state = acceptedAction(state, 1, { type: 'call' }).state;
    expectConserved(state);
    expect(state.eventLog.filter((event) => event.type === 'PlayerActed')).toHaveLength(3);

    expect(getLegalActions(state, 2)).toEqual({
      fold: false,
      check: true,
      call: null,
      raiseTo: { min: 4, max: 100 },
      allIn: { to: 100, mode: 'fullRaise' },
    });
    assertPureRejection(state, applyIntent(state, 2, { type: 'fold' }), 'action-not-legal');
    assertPureRejection(state, applyIntent(state, 2, { type: 'call' }), 'action-not-legal');
  });

  it('reaches the small blind naturally and automatically pays only the difference', () => {
    let smallBlindTurn = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    smallBlindTurn = acceptedAction(smallBlindTurn, 3, { type: 'fold' }).state;
    smallBlindTurn = acceptedAction(smallBlindTurn, 0, { type: 'fold' }).state;
    expectConserved(smallBlindTurn);
    expect(smallBlindTurn.eventLog.filter((event) => event.type === 'PlayerActed')).toHaveLength(2);
    const called = acceptedAction(smallBlindTurn, 1, { type: 'call' });

    expect(called.events[0]).toMatchObject({
      type: 'PlayerActed',
      seat: 1,
      normalizedKind: 'call',
      paid: 1,
      betToBefore: 2,
      betToAfter: 2,
      allIn: false,
      fullRaise: false,
      raiseReopened: false,
    });
    expect(called.state.seats[1]).toMatchObject({ stack: 98, committedStreet: 2, committedHand: 2 });
  });

  it('starts from a conserved short-stack tournament and consumes an insufficient caller stack', () => {
    const before = withStacks(createState(), [199, 100, 100, 1]);
    expectConserved(before);
    const short = startHand(before, { fixedDeck: createStandardDeck() }).state;
    expectConserved(short);
    expect(getLegalActions(short, 3).call).toEqual({ pay: 1, to: 1, isAllIn: true });
    const shortCall = acceptedAction(short, 3, { type: 'call' });
    expect(shortCall.events[0]).toMatchObject({ normalizedKind: 'call', paid: 1, betToAfter: 2, allIn: true });
    expect(shortCall.state.seats[3]).toMatchObject({ stack: 0, committedStreet: 1, status: 'all-in' });
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    3.5,
    0,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid raiseTo amount %s with the identical state reference', (amount) => {
    const state = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    assertPureRejection(state, applyIntent(state, 3, { type: 'raiseTo', amount }), 'invalid-amount');
  });

  it.each([3, 101])('rejects out-of-range raiseTo %s without an event or version change', (amount) => {
    const state = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    assertPureRejection(state, applyIntent(state, 3, { type: 'raiseTo', amount }), 'raise-out-of-range');
  });

  it('defensively rejects a non-actor and a fabricated impossible current-actor status', () => {
    const state = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    assertPureRejection(state, applyIntent(state, 0, { type: 'call' }), 'not-current-actor');
    const cannotAct: TournamentState = {
      ...state,
      seats: state.seats.map((seat) => seat.seatIndex === 3
        ? { ...seat, status: 'folded' as const }
        : seat),
    };
    assertPureRejection(cannotAct, applyIntent(cannotAct, 3, { type: 'call' }), 'seat-cannot-act');
  });
});

describe('short blind action surfaces', () => {
  it('keeps the full multiway big-blind target for funded opponents', () => {
    const before = withStacks(createState(), [199, 100, 1, 100]);
    const state = startHand(before, { fixedDeck: createStandardDeck() }).state;

    expectConserved(state);
    expect(getLegalActions(state, 3).call).toEqual({ pay: 2, to: 2, isAllIn: false });
  });

  it('offers only fold or the one-chip call in HU when no funded opponent can respond', () => {
    const before = withStacks(createState(config(2, 100, 2, 4)), [197, 3]);
    expectConserved(before);
    const state = startHand(before, { fixedDeck: createStandardDeck() }).state;

    expectConserved(state);
    expect(getLegalActions(state, 0)).toEqual({
      fold: true,
      check: false,
      call: { pay: 1, to: 3, isAllIn: false },
      raiseTo: null,
      allIn: null,
    });
  });

  it('exposes no decision when both HU players actually post one chip', () => {
    const state = startHand(createState(config(2, 1, 1, 2)), {
      fixedDeck: createStandardDeck(),
    }).state;

    expectConserved(state);
    expect(state.activeHand?.currentActorSeat).toBeNull();
    expect(getLegalActions(state, 0)).toEqual({
      fold: false,
      check: false,
      call: null,
      raiseTo: null,
      allIn: null,
    });
  });
});
