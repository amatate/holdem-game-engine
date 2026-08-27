import { describe, expect, it } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import type { DomainEvent } from '../../src/core/events.js';
import { getLegalActions } from '../../src/core/legal-actions.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';

function headsUpConfig(startingStack: number, smallBlind: number, bigBlind: number): TournamentConfig {
  return {
    maxSeats: 2,
    startingStack,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind, bigBlind }],
    initialButtonSeat: 0,
  };
}

function tournament(tableConfig: TournamentConfig): TournamentState {
  return createTournament(
    tableConfig,
    [{ playerId: 'button', seatIndex: 0 }, { playerId: 'big-blind', seatIndex: 1 }],
    'automatic-runout',
  ).state;
}

function withStacks(state: TournamentState, stacks: readonly [number, number]): TournamentState {
  expect(stacks[0] + stacks[1]).toBe(state.initialChipTotal);
  return {
    ...state,
    seats: state.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: stacks[seatIndex]!,
      status: 'active' as const,
    })),
  };
}

function act(
  state: TournamentState,
  seat: number,
  intent: Parameters<typeof applyIntent>[2],
): TournamentState {
  const result = applyIntent(state, seat, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) {
    throw new Error(result.rejection.message);
  }
  return result.state;
}

function advanceAndProveReplay(state: TournamentState): ReturnType<typeof advanceAutomaticPhases> {
  const snapshot = structuredClone(state);
  const result = advanceAutomaticPhases(state);
  let replayed = state;
  for (const event of result.events) {
    replayed = reduceDomainEvent(replayed, event);
  }
  expect(result.state).toEqual(replayed);
  expect(state).toEqual(snapshot);
  return result;
}

function expectRevealsBeforeRunout(
  events: ReturnType<typeof advanceAutomaticPhases>['events'],
  expectedSeats: readonly number[],
): void {
  const reveals = events.filter((event) => event.type === 'HoleCardsRevealed');
  expect(reveals.map((event) => event.seat).sort((left, right) => left - right)).toEqual(expectedSeats);
  const firstBoardEvent = events.find((event) => event.type === 'CardBurned'
    || event.type === 'CommunityCardsDealt');
  expect(firstBoardEvent).toBeDefined();
  expect(reveals.every((event) => event.eventIndex < firstBoardEvent!.eventIndex)).toBe(true);
}

function revealEvent(
  state: TournamentState,
  seatIndex: number,
  reason: 'all-in' | 'showdown',
): DomainEvent {
  const seat = state.seats[seatIndex]!;
  return {
    type: 'HoleCardsRevealed',
    schemaVersion: 1,
    eventIndex: state.version,
    handId: state.activeHand!.handId,
    seat: seatIndex,
    cards: [seat.holeCards![0], seat.holeCards![1]],
    reason,
  };
}

function riverShortAllInDecision(): TournamentState {
  let state = startHand(
    withStacks(tournament(headsUpConfig(10, 2, 4)), [9, 11]),
    { fixedDeck: createStandardDeck() },
  ).state;

  state = act(state, 0, { type: 'call' });
  state = act(state, 1, { type: 'check' });
  state = advanceAndProveReplay(state).state;
  state = act(state, 1, { type: 'check' });
  state = act(state, 0, { type: 'raiseTo', amount: 4 });
  state = act(state, 1, { type: 'call' });
  state = advanceAndProveReplay(state).state;
  state = act(state, 1, { type: 'check' });
  state = act(state, 0, { type: 'check' });
  state = advanceAndProveReplay(state).state;
  state = act(state, 1, { type: 'check' });
  return act(state, 0, { type: 'allIn' });
}

describe('automatic all-in runout', () => {
  it('reveals all live hands and runs all-all-in players through river without a decision', () => {
    const state = startHand(
      tournament(headsUpConfig(1, 1, 2)),
      { fixedDeck: createStandardDeck() },
    ).state;

    expect(state.seats.map((seat) => seat.status)).toEqual(['all-in', 'all-in']);
    const result = advanceAndProveReplay(state);

    expect(result.state.activeHand).toMatchObject({
      phase: 'showdown',
      board: createStandardDeck().slice(5, 8).concat(createStandardDeck()[9]!, createStandardDeck()[11]!),
      burnedCards: [createStandardDeck()[4], createStandardDeck()[8], createStandardDeck()[10]],
      dealCursor: 12,
      currentActorSeat: null,
      pendingActors: [],
    });
    expect(result.state.activeHand?.revealedHoleCardSeats.slice().sort()).toEqual([0, 1]);
    expectRevealsBeforeRunout(result.events, [0, 1]);
  });

  it('runs out when one funded player owes zero against an all-in opponent', () => {
    const state = startHand(
      withStacks(tournament(headsUpConfig(100, 1, 2)), [199, 1]),
      { fixedDeck: createStandardDeck() },
    ).state;

    expect(state.activeHand).toMatchObject({ currentBetTo: 1, currentActorSeat: null, pendingActors: [] });
    expect(state.seats.map((seat) => seat.status)).toEqual(['active', 'all-in']);

    const result = advanceAndProveReplay(state);
    expect(result.state.activeHand?.phase).toBe('showdown');
    expectRevealsBeforeRunout(result.events, [0, 1]);
  });

  it('awaits the lone funded player who owes chips, then reveals before the short-BB runout', () => {
    let state = startHand(
      withStacks(tournament(headsUpConfig(100, 2, 4)), [197, 3]),
      { fixedDeck: createStandardDeck() },
    ).state;
    const snapshot = structuredClone(state);

    expect(getLegalActions(state, 0)).toEqual({
      fold: true,
      check: false,
      call: { pay: 1, to: 3, isAllIn: false },
      raiseTo: null,
      allIn: null,
    });
    const waiting = advanceAutomaticPhases(state);
    expect(waiting).toEqual({ state, events: [] });
    expect(waiting.state).toBe(state);
    expect(state).toEqual(snapshot);

    state = act(state, 0, { type: 'call' });
    const result = advanceAndProveReplay(state);
    expect(result.state.activeHand?.phase).toBe('showdown');
    expectRevealsBeforeRunout(result.events, [0, 1]);
  });
});

describe('river all-in boundary', () => {
  it('retains a short opening all-in as final aggressor and reveals before returning showdown', () => {
    let state = riverShortAllInDecision();
    expect(state.activeHand?.lastAggressorSeat).toBe(0);
    expect(getLegalActions(state, 1).raiseTo).toBeNull();
    state = act(state, 1, { type: 'call' });

    const result = advanceAndProveReplay(state);
    expect(result.events.map((event) => event.type)).toEqual([
      'HoleCardsRevealed',
      'HoleCardsRevealed',
      'BettingRoundClosed',
    ]);
    expect(result.events.slice(0, 2).every((event) => event.type === 'HoleCardsRevealed'
      && event.eventIndex < result.events[2]!.eventIndex)).toBe(true);
    expect(result.state.activeHand).toMatchObject({
      phase: 'showdown',
      lastAggressorSeat: 0,
      revealedHoleCardSeats: [0, 1],
    });
  });
});

describe('hole-card reveal reducer boundaries', () => {
  it('rejects an all-in reveal during ordinary preflop betting with no live all-in seat', () => {
    const state = startHand(
      tournament(headsUpConfig(100, 1, 2)),
      { fixedDeck: createStandardDeck() },
    ).state;

    expect(() => reduceDomainEvent(state, revealEvent(state, 0, 'all-in')))
      .toThrow(/all-in|reveal/i);
  });

  it('rejects a showdown reveal before showdown phase', () => {
    const state = startHand(
      tournament(headsUpConfig(100, 1, 2)),
      { fixedDeck: createStandardDeck() },
    ).state;

    expect(() => reduceDomainEvent(state, revealEvent(state, 0, 'showdown')))
      .toThrow(/showdown|reveal/i);
  });

  it('rejects revealing a fold winner', () => {
    const tableConfig: TournamentConfig = {
      maxSeats: 3,
      startingStack: 100,
      handsPerLevel: 8,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
      initialButtonSeat: 0,
    };
    let state = startHand(createTournament(
      tableConfig,
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'fold-winner-reveal',
    ).state, { fixedDeck: createStandardDeck() }).state;
    state = act(state, 0, { type: 'fold' });
    state = act(state, 1, { type: 'fold' });

    expect(() => reduceDomainEvent(state, revealEvent(state, 2, 'all-in')))
      .toThrow(/live|all-in|reveal/i);
  });

  it('rejects an all-in reveal on river while a funded opponent still owes a call', () => {
    const state = riverShortAllInDecision();

    expect(state.activeHand).toMatchObject({ phase: 'river', currentActorSeat: 1, currentBetTo: 1 });
    expect(() => reduceDomainEvent(state, revealEvent(state, 0, 'all-in')))
      .toThrow(/decision|reveal/i);
  });

  it('rejects a duplicate reveal after the legitimate one-funded-plus-all-in runout', () => {
    const before = startHand(
      withStacks(tournament(headsUpConfig(100, 1, 2)), [199, 1]),
      { fixedDeck: createStandardDeck() },
    ).state;
    const state = advanceAutomaticPhases(before).state;

    expect(state.activeHand).toMatchObject({ phase: 'showdown', revealedHoleCardSeats: [0, 1] });
    expect(() => reduceDomainEvent(state, revealEvent(state, 0, 'showdown')))
      .toThrow(/duplicate|already|reveal/i);
  });
});
