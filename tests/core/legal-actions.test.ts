import { describe, expect, it } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { getLegalActions } from '../../src/core/legal-actions.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';

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
  it('exposes fold/call while facing a bet and rejects check without changing authority', () => {
    const state = startHand(createState(), { fixedDeck: createStandardDeck() }).state;

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
    const started = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    const state: TournamentState = {
      ...started,
      activeHand: {
        ...started.activeHand!,
        currentActorSeat: 2,
        pendingActors: [2],
      },
    };

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

  it('automatically pays only the small blind difference and consumes a short caller stack', () => {
    const started = startHand(createState(), { fixedDeck: createStandardDeck() }).state;
    const smallBlindTurn: TournamentState = {
      ...started,
      activeHand: { ...started.activeHand!, currentActorSeat: 1, pendingActors: [1, 2] },
    };
    const called = applyIntent(smallBlindTurn, 1, { type: 'call' });

    expect(called.accepted).toBe(true);
    expect(called.events).toHaveLength(1);
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

    const short: TournamentState = {
      ...started,
      seats: started.seats.map((seat) => seat.seatIndex === 3
        ? { ...seat, stack: 1, status: 'active' as const }
        : seat),
    };
    expect(getLegalActions(short, 3).call).toEqual({ pay: 1, to: 1, isAllIn: true });
    const shortCall = applyIntent(short, 3, { type: 'call' });
    expect(shortCall.accepted).toBe(true);
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

  it('rejects a non-actor and a seat that cannot act with typed pure failures', () => {
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

    expect(getLegalActions(state, 3).call).toEqual({ pay: 2, to: 2, isAllIn: false });
  });

  it('offers only fold or the one-chip call in HU when no funded opponent can respond', () => {
    const before = withStacks(createState(config(2, 200, 2, 4)), [197, 3]);
    const state = startHand(before, { fixedDeck: createStandardDeck() }).state;

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
