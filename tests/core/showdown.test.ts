import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import * as evaluator from '../../src/core/hand-evaluator.js';
import { applyIntent } from '../../src/core/reducer.js';
import { reduceDomainEvent, createTournament, startHand, type TournamentState } from '../../src/core/state.js';
import { settleShowdown } from '../../src/core/settlement.js';

const CONFIG: TournamentConfig = {
  maxSeats: 4,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};

function cards(...codes: string[]) {
  return codes.map(parseCard);
}

function showdownState(options: {
  readonly board: readonly string[];
  readonly holes: readonly (readonly [string, string])[];
  readonly committed?: readonly number[];
  readonly folded?: readonly number[];
  readonly button?: number;
  readonly lastAggressor?: number | null;
}): TournamentState {
  const committed = options.committed ?? [25, 25, 25, 25];
  const base = createTournament(
    CONFIG,
    Array.from({ length: 4 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
    'showdown-fixture',
  ).state;
  return {
    ...base,
    seats: base.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: 100 - committed[seatIndex]!,
      status: options.folded?.includes(seatIndex)
        ? 'folded' as const
        : committed[seatIndex] === 100 ? 'all-in' as const : 'active' as const,
      holeCards: cards(...options.holes[seatIndex]!) as unknown as readonly [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>],
      committedStreet: committed[seatIndex]!,
      committedHand: committed[seatIndex]!,
    })),
    activeHand: {
      handId: 'showdown-fixture/hand/1',
      phase: 'showdown',
      street: 'river',
      board: cards(...options.board),
      burnedCards: [],
      deck: [],
      dealCursor: 0,
      revealedHoleCardSeats: [],
      positions: { buttonPosition: options.button ?? 0, smallBlindSeat: 1, bigBlindSeat: 2 },
      currentActorSeat: null,
      currentBetTo: 0,
      lastFullRaiseSize: 2,
      lastAggressorSeat: options.lastAggressor ?? null,
      pendingActors: [],
    },
  };
}

function chipAuthority(state: TournamentState): number {
  return state.seats.reduce((sum, seat) => sum + seat.stack + seat.committedHand, 0)
    + (state.activeHand?.pendingPots ?? []).reduce((sum, pot) => sum + pot.amount, 0);
}

function settleAndReplay(state: TournamentState) {
  const snapshot = structuredClone(state);
  const result = settleShowdown(state);
  let replayed = state;
  for (const event of result.events) {
    replayed = reduceDomainEvent(replayed, event);
    expect(chipAuthority(replayed)).toBe(replayed.initialChipTotal);
  }
  expect(result.state).toEqual(replayed);
  expect(state).toEqual(snapshot);
  return result;
}

function act(state: TournamentState, seat: number, intent: Parameters<typeof applyIntent>[2]): TournamentState {
  const result = applyIntent(state, seat, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

afterEach(() => vi.restoreAllMocks());

describe('showdown ranks and independent pots', () => {
  it('lets the board play and treats different hole-card suits as a complete tie', () => {
    const result = settleAndReplay(showdownState({
      board: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
      holes: [['2c', '3d'], ['2d', '3c'], ['4h', '5d'], ['6h', '7d']],
    }));

    const evaluated = result.events.filter((event) => event.type === 'HandEvaluated');
    expect(evaluated.map((event) => event.rank.vector)).toEqual([
      [8, 14], [8, 14], [8, 14], [8, 14],
    ]);
    expect(result.events.filter((event) => event.type === 'PotConstructed')[0]).toMatchObject({
      potId: 'pot-0', amount: 100, cap: 25,
    });
    expect(result.events.filter((event) => event.type === 'PotAwarded')[0]).toMatchObject({
      potId: 'pot-0',
      winners: [0, 1, 2, 3],
      amounts: [25, 25, 25, 25],
      oddChipRecipients: [],
    });
  });

  it('uses the complete kicker vector to choose a winner', () => {
    const result = settleAndReplay(showdownState({
      board: ['Ah', 'Ad', '7c', '5s', '2d'],
      holes: [['Kc', 'Qc'], ['Kh', 'Jd'], ['Tc', '9c'], ['8h', '6h']],
      folded: [2, 3],
    }));

    expect(result.events.filter((event) => event.type === 'PotAwarded')[0]).toMatchObject({
      winners: [0],
    });
  });

  it('chooses main and side-pot winners independently', () => {
    const result = settleAndReplay(showdownState({
      board: ['2c', '3d', '7h', '9s', 'Jc'],
      holes: [['Jh', 'Jd'], ['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']],
      committed: [25, 50, 50, 50],
    }));

    expect(result.events.filter((event) => event.type === 'PotAwarded')).toMatchObject([
      { potId: 'pot-0', winners: [0], amounts: [100], oddChipRecipients: [] },
      { potId: 'pot-1', winners: [1], amounts: [75], oddChipRecipients: [] },
    ]);
  });

  it('evaluates each seat in the eligible union exactly once across multiple pots', () => {
    const evaluateBest = vi.spyOn(evaluator, 'evaluateBest');
    settleShowdown(showdownState({
      board: ['2c', '3d', '7h', '9s', 'Jc'],
      holes: [['Jh', 'Jd'], ['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']],
      committed: [25, 50, 50, 0],
    }));
    expect(evaluateBest).toHaveBeenCalledTimes(3);
  });

  it('deducts each contribution layer exactly and rejects forged settlement authority', () => {
    const input = showdownState({
      board: ['2c', '3d', '7h', '9s', 'Jc'],
      holes: [['Jh', 'Jd'], ['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']],
      committed: [25, 50, 100, 100],
      lastAggressor: 2,
    });
    const result = settleShowdown(input);
    const started = result.events.find((event) => event.type === 'ShowdownStarted')!;
    expect(() => reduceDomainEvent(input, { ...started, revealOrder: [3, 2, 1, 0] }))
      .toThrow(/reveal order|showdown/i);

    let prefix = input;
    const residuals: number[][] = [];
    for (const event of result.events) {
      if (event.type === 'PotConstructed') {
        expect(() => reduceDomainEvent(prefix, { ...event, cap: event.cap + 1 }))
          .toThrow(/contribution layer|pot/i);
      }
      if (event.type === 'HandEvaluated') {
        expect(() => reduceDomainEvent(prefix, {
          ...event,
          rank: { ...event.rank, vector: [0, 2] },
        })).toThrow(/evaluated|rank|hand/i);
      }
      if (event.type === 'PotAwarded') {
        const total = event.amounts.reduce((sum, amount) => sum + amount, 0);
        expect(() => reduceDomainEvent(prefix, {
          ...event,
          winners: [3],
          amounts: [total],
          oddChipRecipients: [],
        })).toThrow(/winner|award|pot/i);
      }
      prefix = reduceDomainEvent(prefix, event);
      if (event.type === 'PotConstructed') {
        residuals.push(prefix.seats.map((seat) => seat.committedHand));
      }
    }
    expect(residuals).toEqual([
      [0, 25, 75, 75],
      [0, 0, 50, 50],
      [0, 0, 0, 0],
    ]);
  });
});

describe('showdown reveal ordering and visibility', () => {
  const board = ['2c', '3d', '7h', '9s', 'Jc'] as const;
  const holes = [['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd'], ['Th', 'Td']] as const;

  it('reveals a called river short all-in aggressor first', () => {
    const result = settleAndReplay(showdownState({ board, holes, lastAggressor: 2 }));
    expect(result.events.find((event) => event.type === 'ShowdownStarted')).toMatchObject({
      revealOrder: [2, 3, 0, 1],
    });
    expect(result.events.filter((event) => event.type === 'HoleCardsRevealed').map((event) => event.seat))
      .toEqual([2, 3, 0, 1]);
  });

  it('starts left of the physical button when river had no aggressor, including dead seats', () => {
    const result = settleAndReplay(showdownState({
      board,
      holes,
      button: 1,
      lastAggressor: null,
      folded: [2],
    }));
    expect(result.events.filter((event) => event.type === 'HoleCardsRevealed').map((event) => event.seat))
      .toEqual([3, 0, 1]);
  });

  it('orders reachable Task 5 all-in reveals before the final close and ShowdownStarted', () => {
    let state = createTournament(
      { ...CONFIG, maxSeats: 3, startingStack: 4 },
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'reachable-pre-reveal',
    ).state;
    state = startHand(state, { fixedDeck: createStandardDeck() }).state;
    state = act(state, 0, { type: 'allIn' });
    state = act(state, 1, { type: 'fold' });
    state = act(state, 2, { type: 'call' });
    const result = advanceAutomaticPhases(state);
    const events = result.events;
    const reveals = events.filter((event) => event.type === 'HoleCardsRevealed');
    const closes = events.filter((event) => event.type === 'BettingRoundClosed');
    const started = events.find((event) => event.type === 'ShowdownStarted')!;

    expect(reveals.map((event) => event.seat)).toEqual([2, 0]);
    expect(events.some((event) => event.type === 'HoleCardsRevealed' && event.seat === 1)).toBe(false);
    expect(reveals.every((event) => event.eventIndex < closes.at(-1)!.eventIndex)).toBe(true);
    expect(closes.at(-1)!.eventIndex).toBeLessThan(started.eventIndex);
    expect(started).toMatchObject({ revealOrder: [2, 0] });
  });

  it('pre-reveals a non-lowest called river aggressor first without duplicates', () => {
    let state = createTournament(
      { ...CONFIG, maxSeats: 2, startingStack: 10, initialButtonSeat: 0 },
      [{ playerId: 'button', seatIndex: 0 }, { playerId: 'bb', seatIndex: 1 }],
      'river-order',
    ).state;
    state = {
      ...state,
      seats: state.seats.map((seat, index) => ({ ...seat, stack: [11, 9][index]! })),
    };
    state = startHand(state, { fixedDeck: createStandardDeck() }).state;
    state = act(state, 0, { type: 'call' });
    state = act(state, 1, { type: 'check' });
    state = advanceAutomaticPhases(state).state;
    state = act(state, 1, { type: 'check' });
    state = act(state, 0, { type: 'raiseTo', amount: 4 });
    state = act(state, 1, { type: 'call' });
    state = advanceAutomaticPhases(state).state;
    state = act(state, 1, { type: 'check' });
    state = act(state, 0, { type: 'check' });
    state = advanceAutomaticPhases(state).state;
    state = act(state, 1, { type: 'allIn' });
    state = act(state, 0, { type: 'call' });
    const result = advanceAutomaticPhases(state);
    const events = result.events;

    expect(events.filter((event) => event.type === 'HoleCardsRevealed').map((event) => event.seat))
      .toEqual([1, 0]);
    expect(events.find((event) => event.type === 'ShowdownStarted')).toMatchObject({
      revealOrder: [1, 0],
    });
  });
});
