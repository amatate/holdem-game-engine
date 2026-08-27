import { describe, expect, it } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases, isBettingRoundClosed } from '../../src/core/dealing.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';

function config(maxSeats: number): TournamentConfig {
  return {
    maxSeats,
    startingStack: 100,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: 0,
  };
}

function tournament(tableConfig: TournamentConfig): TournamentState {
  return createTournament(
    tableConfig,
    Array.from({ length: tableConfig.maxSeats }, (_, seatIndex) => ({
      playerId: `p${seatIndex}`,
      seatIndex,
    })),
    'street-progression',
  ).state;
}

function withStacks(state: TournamentState, stacks: readonly number[]): TournamentState {
  expect(stacks.reduce((sum, stack) => sum + stack, 0)).toBe(state.initialChipTotal);
  return {
    ...state,
    seats: state.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: stacks[seatIndex]!,
      status: stacks[seatIndex] === 0 ? 'eliminated' as const : 'active' as const,
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
  expect(result.state.eventLog.slice(-result.events.length)).toEqual(result.events);
  return result;
}

describe('betting-round closure', () => {
  it('keeps the unraised big-blind option open even after every commitment is equal', () => {
    let state = startHand(tournament(config(4)), { fixedDeck: createStandardDeck() }).state;

    state = act(state, 3, { type: 'call' });
    state = act(state, 0, { type: 'call' });
    state = act(state, 1, { type: 'call' });

    expect(state.seats.map((seat) => seat.committedStreet)).toEqual([2, 2, 2, 2]);
    expect(state.activeHand?.pendingActors).toEqual([2]);
    expect(isBettingRoundClosed(state.activeHand!, state.seats)).toBe(false);

    state = act(state, 2, { type: 'check' });
    expect(isBettingRoundClosed(state.activeHand!, state.seats)).toBe(true);

    const advanced = advanceAndProveReplay(state);
    expect(advanced.events.map((event) => event.type)).toEqual([
      'BettingRoundClosed',
      'CardBurned',
      'CommunityCardsDealt',
      'BettingRoundStarted',
    ]);
    expect(advanced.state.activeHand).toMatchObject({
      phase: 'flop',
      street: 'flop',
      board: createStandardDeck().slice(9, 12),
      burnedCards: [createStandardDeck()[8]],
      dealCursor: 12,
      currentActorSeat: 1,
      pendingActors: [1, 2, 3, 0],
    });

    const noDoubleAdvance = advanceAutomaticPhases(advanced.state);
    expect(noDoubleAdvance.events).toEqual([]);
    expect(noDoubleAdvance.state).toBe(advanced.state);
  });
});

describe('street dealing and reset', () => {
  it('deals 3/1/1 with burns and rebuilds only funded active postflop actors', () => {
    const tableConfig = config(5);
    let state = startHand(
      withStacks(tournament(tableConfig), [100, 100, 2, 298, 0]),
      { fixedDeck: createStandardDeck() },
    ).state;

    state = act(state, 3, { type: 'fold' });
    state = act(state, 0, { type: 'call' });
    state = act(state, 1, { type: 'call' });

    const flop = advanceAndProveReplay(state);
    state = flop.state;
    expect(state.seats.map((seat) => seat.status)).toEqual([
      'active', 'active', 'all-in', 'folded', 'eliminated',
    ]);
    expect(state.seats.map((seat) => seat.committedStreet)).toEqual([0, 0, 0, 0, 0]);
    expect(state.seats.map((seat) => seat.lastActedAtBetTo)).toEqual([null, null, null, null, null]);
    expect(state.activeHand).toMatchObject({
      currentBetTo: 0,
      lastFullRaiseSize: 2,
      lastAggressorSeat: null,
      currentActorSeat: 1,
      pendingActors: [1, 0],
    });

    state = act(state, 1, { type: 'check' });
    state = act(state, 0, { type: 'check' });
    state = advanceAndProveReplay(state).state;
    expect(state.activeHand).toMatchObject({
      phase: 'turn',
      currentBetTo: 0,
      lastFullRaiseSize: 2,
      lastAggressorSeat: null,
      currentActorSeat: 1,
      pendingActors: [1, 0],
    });
    expect(state.seats.map((seat) => seat.committedStreet)).toEqual([0, 0, 0, 0, 0]);
    expect(state.seats.map((seat) => seat.lastActedAtBetTo)).toEqual([null, null, null, null, null]);

    state = act(state, 1, { type: 'check' });
    state = act(state, 0, { type: 'check' });
    state = advanceAndProveReplay(state).state;
    expect(state.activeHand).toMatchObject({
      phase: 'river',
      currentActorSeat: 1,
      pendingActors: [1, 0],
    });

    const hand = state.activeHand!;
    expect(hand.board).toHaveLength(5);
    expect(hand.burnedCards).toHaveLength(3);
    expect(hand.dealCursor).toBe(16);
    const physicalCards = [
      ...state.seats.flatMap((seat) => seat.holeCards ?? []),
      ...hand.board,
      ...hand.burnedCards,
    ];
    expect(new Set(physicalCards.map((card) => card.code)).size).toBe(physicalCards.length);
  });

  it('does not leak preflop aggression or flop acted markers into later streets', () => {
    let state = startHand(tournament(config(3)), { fixedDeck: createStandardDeck() }).state;

    state = act(state, 0, { type: 'raiseTo', amount: 6 });
    state = act(state, 1, { type: 'call' });
    state = act(state, 2, { type: 'call' });
    expect(state.activeHand?.lastAggressorSeat).toBe(0);

    state = advanceAndProveReplay(state).state;
    expect(state.activeHand?.lastAggressorSeat).toBeNull();
    expect(state.seats.map((seat) => seat.lastActedAtBetTo)).toEqual([null, null, null]);

    state = act(state, 1, { type: 'check' });
    state = act(state, 2, { type: 'check' });
    state = act(state, 0, { type: 'check' });
    state = advanceAndProveReplay(state).state;

    expect(state.activeHand).toMatchObject({
      phase: 'turn',
      lastAggressorSeat: null,
      currentBetTo: 0,
    });
    expect(state.seats.map((seat) => seat.lastActedAtBetTo)).toEqual([null, null, null]);
  });
});
