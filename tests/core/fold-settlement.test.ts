import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import * as evaluator from '../../src/core/hand-evaluator.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';

const CONFIG: TournamentConfig = {
  maxSeats: 3,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};

function act(state: TournamentState, seat: number, type: 'fold'): TournamentState {
  const result = applyIntent(state, seat, { type });
  expect(result.accepted).toBe(true);
  if (!result.accepted) {
    throw new Error(result.rejection.message);
  }
  return result.state;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fold-to-one settlement boundary', () => {
  it('enters settlement without growing the board, revealing cards, or evaluating a hand', () => {
    const evaluateBest = vi.spyOn(evaluator, 'evaluateBest');
    let state = startHand(createTournament(
      CONFIG,
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'fold-settlement',
    ).state, { fixedDeck: createStandardDeck() }).state;

    state = act(state, 0, 'fold');
    state = act(state, 1, 'fold');
    const snapshot = structuredClone(state);
    const originalBoard = state.activeHand?.board;

    const result = advanceAutomaticPhases(state);
    let replayed = state;
    for (const event of result.events) {
      replayed = reduceDomainEvent(replayed, event);
    }

    expect(result.events.map((event) => event.type)).toEqual([
      'BettingRoundClosed',
      'UncalledBetReturned',
      'PotConstructed',
      'PotAwarded',
      'HandCompleted',
    ]);
    expect(result.events.some((event) => event.type === 'HoleCardsRevealed')).toBe(false);
    expect(result.state).toEqual(replayed);
    expect(result.state.activeHand).toMatchObject({
      phase: 'hand-complete',
      board: [],
      burnedCards: [],
      currentActorSeat: null,
      pendingActors: [],
    });
    expect(result.state.activeHand?.board).toEqual(originalBoard);
    expect(state).toEqual(snapshot);
    expect(evaluateBest).not.toHaveBeenCalled();
  });
});
