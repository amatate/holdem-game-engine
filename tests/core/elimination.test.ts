import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import * as evaluator from '../../src/core/hand-evaluator.js';
import { applyIntent } from '../../src/core/reducer.js';
import { settleFoldWin, settleShowdown } from '../../src/core/settlement.js';
import { createTournament, reduceDomainEvent, startHand, type TournamentState } from '../../src/core/state.js';

function config(maxSeats: number, startingStack = 100): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: 0,
  };
}

function apply(state: TournamentState, seat: number, intent: Parameters<typeof applyIntent>[2]) {
  const result = applyIntent(state, seat, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

function expectReplay(input: TournamentState, result: ReturnType<typeof settleShowdown>) {
  let replayed = input;
  for (const event of result.events) {
    replayed = reduceDomainEvent(replayed, event);
    expect(replayed.seats.reduce((sum, seat) => sum + seat.stack + seat.committedHand, 0)
      + (replayed.activeHand?.pendingPots ?? []).reduce((sum, pot) => sum + pot.amount, 0))
      .toBe(replayed.initialChipTotal);
  }
  expect(result.state).toEqual(replayed);
}

afterEach(() => vi.restoreAllMocks());

describe('settlement timing', () => {
  it('rejects refunds during betting', () => {
    const normal = startHand(createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'premature-refund',
    ).state, { fixedDeck: createStandardDeck() }).state;
    expect(normal.seats.map((seat) => seat.committedHand)).toEqual([0, 1, 2]);
    expect(() => reduceDomainEvent(normal, {
      type: 'UncalledBetReturned', schemaVersion: 1, eventIndex: normal.version,
      handId: normal.activeHand!.handId, seat: 2, amount: 1,
    })).toThrow(/phase|chronology|settlement|showdown/i);
  });

  it('rejects a showdown refund before ShowdownStarted and required reveals', () => {
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'showdown-refund-order',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [40, 0, 100][seatIndex]!,
        status: (['active', 'all-in', 'active'] as const)[seatIndex]!,
        holeCards: [
          parseCard((['Ah', 'Kh', 'Qh'] as const)[seatIndex]!),
          parseCard((['Ad', 'Kd', 'Qd'] as const)[seatIndex]!),
        ],
        committedStreet: [60, 100, 0][seatIndex]!,
        committedHand: [60, 100, 0][seatIndex]!,
      })),
      activeHand: {
        handId: 'showdown-refund-order/hand/1', phase: 'showdown', street: 'river',
        board: ['2c', '3d', '7h', '9s', 'Jc'].map(parseCard),
        burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
        lastAggressorSeat: null, pendingActors: [],
      },
    };
    const valid = settleShowdown(input);
    const refund = valid.events.find((event) => event.type === 'UncalledBetReturned')!;
    const started = valid.events.find((event) => event.type === 'ShowdownStarted')!;
    const reveals = valid.events.filter((event) => event.type === 'HoleCardsRevealed');
    expect(() => reduceDomainEvent(input, { ...refund, eventIndex: input.version }))
      .toThrow(/chronology|showdown|reveal/i);
    let prefix = reduceDomainEvent(input, started);
    expect(() => reduceDomainEvent(prefix, { ...refund, eventIndex: prefix.version }))
      .toThrow(/chronology|showdown|reveal/i);
    for (const reveal of reveals) prefix = reduceDomainEvent(prefix, reveal);
    expect(() => reduceDomainEvent(prefix, { ...refund, eventIndex: prefix.version })).not.toThrow();
  });

  it('rejects pot construction before a required refund', () => {
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'construct-before-refund',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [40, 0, 100][seatIndex]!,
        status: (['active', 'folded', 'folded'] as const)[seatIndex]!,
        committedStreet: [60, 100, 0][seatIndex]!,
        committedHand: [60, 100, 0][seatIndex]!,
      })),
      activeHand: {
        handId: 'construct-before-refund/hand/1', phase: 'settlement', street: 'preflop',
        board: [], burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 100, lastFullRaiseSize: 2,
        lastAggressorSeat: 1, pendingActors: [],
      },
    };
    const valid = settleFoldWin(input);
    const firstPot = valid.events.find((event) => event.type === 'PotConstructed')!;
    expect(() => reduceDomainEvent(input, { ...firstPot, eventIndex: input.version }))
      .toThrow(/refund|layer|chronology/i);
  });

  it('rejects construction of a sole-contributor refund layer', () => {
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'sole-refund-layer',
    ).state;
    const soleLayer: TournamentState = {
      ...base,
      activeHand: {
        handId: 'sole-refund-layer/hand/1', phase: 'settlement', street: 'river',
        board: [], burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
        lastAggressorSeat: null, pendingActors: [],
      },
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [100, 100, 0][seatIndex]!,
        status: (['folded', 'folded', 'active'] as const)[seatIndex]!,
        committedStreet: [0, 0, 100][seatIndex]!,
        committedHand: [0, 0, 100][seatIndex]!,
      })),
    };
    expect(() => reduceDomainEvent(soleLayer, {
      type: 'PotConstructed', schemaVersion: 1, eventIndex: soleLayer.version,
      handId: soleLayer.activeHand!.handId, potId: 'pot-0', amount: 100, cap: 100,
      eligibleSeats: [2],
    })).toThrow(/refund|sole|contributor|layer/i);
  });

  it('rejects awarding a constructed fold pot while contribution layers remain', () => {
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'partial-layer-award',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [0, 0, 50][seatIndex]!,
        status: (['all-in', 'folded', 'folded'] as const)[seatIndex]!,
        committedStreet: [100, 100, 50][seatIndex]!,
        committedHand: [100, 100, 50][seatIndex]!,
      })),
      activeHand: {
        handId: 'partial-layer-award/hand/1', phase: 'settlement', street: 'river',
        board: [], burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
        lastAggressorSeat: null, pendingActors: [],
      },
    };
    const valid = settleFoldWin(input);
    const firstPot = valid.events.find((event) => event.type === 'PotConstructed')!;
    const firstAward = valid.events.find((event) => event.type === 'PotAwarded')!;
    const prefix = reduceDomainEvent(input, firstPot);
    expect(prefix.seats.map((seat) => seat.committedHand)).toEqual([50, 50, 0]);
    expect(() => reduceDomainEvent(prefix, { ...firstAward, eventIndex: prefix.version }))
      .toThrow(/remaining|layer|chronology|commit/i);
  });

  it('does not restart pot caps after an earlier pot id was consumed', () => {
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'pot-cap-restart',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [150, 0, 50][seatIndex]!,
        status: (['all-in', 'folded', 'folded'] as const)[seatIndex]!,
        committedStreet: [50, 50, 0][seatIndex]!,
        committedHand: [50, 50, 0][seatIndex]!,
      })),
      activeHand: {
        handId: 'pot-cap-restart/hand/1', phase: 'settlement', street: 'river',
        board: [], burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
        lastAggressorSeat: null, pendingActors: [], pendingPots: [], constructedPotCount: 1,
        lastConstructedCap: 50,
      },
    };
    expect(() => reduceDomainEvent(input, {
      type: 'PotConstructed', schemaVersion: 1, eventIndex: input.version,
      handId: input.activeHand!.handId, potId: 'pot-1', amount: 100, cap: 50,
      eligibleSeats: [0],
    })).toThrow(/cap|restart|order|layer/i);
  });

  it('keeps zero-stack all-ins eligible through every award, then eliminates once before completion', () => {
    const base = createTournament(
      { ...config(3), initialButtonSeat: 1 },
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'elimination-order',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [0, 50, 0][seatIndex]!,
        status: seatIndex === 1 ? 'active' as const : 'all-in' as const,
        holeCards: [
          parseCard((['2c', 'Ah', 'Kh'] as const)[seatIndex]!),
          parseCard((['3d', 'Ad', 'Kd'] as const)[seatIndex]!),
        ],
        committedStreet: [100, 50, 100][seatIndex]!,
        committedHand: [100, 50, 100][seatIndex]!,
      })),
      activeHand: {
        handId: 'elimination-order/hand/1',
        phase: 'showdown',
        street: 'river',
        board: ['4c', '5d', '7h', '9s', 'Jc'].map(parseCard),
        burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
        lastAggressorSeat: null, pendingActors: [],
      },
    };

    const result = settleShowdown(input);
    expectReplay(input, result);
    const awards = result.events.filter((event) => event.type === 'PotAwarded');
    const eliminated = result.events.filter((event) => event.type === 'PlayerEliminated');
    const completed = result.events.find((event) => event.type === 'HandCompleted')!;

    expect(awards).toHaveLength(2);
    expect(eliminated.map((event) => event.seat)).toEqual([0]);
    expect(Math.max(...awards.map((event) => event.eventIndex))).toBeLessThan(eliminated[0]!.eventIndex);
    expect(eliminated[0]!.eventIndex).toBeLessThan(completed.eventIndex);
    expect(result.state.seats[0]).toMatchObject({ stack: 0, status: 'eliminated' });
    expect(result.events.filter((event) => event.type === 'HandCompleted')[0]).toMatchObject({
      finalStacks: result.state.seats.map((seat) => ({ seat: seat.seatIndex, stack: seat.stack })),
    });
  });

  it('refunds before a fold award and never reveals or evaluates', () => {
    const evaluateBest = vi.spyOn(evaluator, 'evaluateBest');
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'fold-refund',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [40, 0, 100][seatIndex]!,
        status: (['active', 'folded', 'folded'] as const)[seatIndex]!,
        committedStreet: [60, 100, 0][seatIndex]!,
        committedHand: [60, 100, 0][seatIndex]!,
      })),
      activeHand: {
        handId: 'fold-refund/hand/1', phase: 'settlement', street: 'preflop', board: [],
        burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 100, lastFullRaiseSize: 2,
        lastAggressorSeat: 1, pendingActors: [],
      },
    };

    const result = settleFoldWin(input);
    const types = result.events.map((event) => event.type);
    expectReplay(input, result);
    expect(types).toEqual([
      'UncalledBetReturned', 'PotConstructed', 'PotAwarded', 'HandCompleted',
    ]);
    expect(result.events[0]).toMatchObject({ seat: 1, amount: 40 });
    expect(types).not.toContain('HoleCardsRevealed');
    expect(types).not.toContain('HandEvaluated');
    expect(evaluateBest).not.toHaveBeenCalled();
  });

  it('rejects award winners outside the pending pot and amounts that do not sum to it', () => {
    const base = createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'invalid-award',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [40, 0, 100][seatIndex]!,
        status: (['active', 'folded', 'folded'] as const)[seatIndex]!,
        committedStreet: [60, 100, 0][seatIndex]!,
        committedHand: [60, 100, 0][seatIndex]!,
      })),
      activeHand: {
        handId: 'invalid-award/hand/1', phase: 'settlement', street: 'preflop', board: [],
        burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
        currentActorSeat: null, currentBetTo: 100, lastFullRaiseSize: 2,
        lastAggressorSeat: 1, pendingActors: [],
      },
    };
    const valid = settleFoldWin(input);
    expect(() => reduceDomainEvent(input, {
      type: 'UncalledBetReturned', schemaVersion: 1, eventIndex: input.version,
      handId: input.activeHand!.handId, seat: 0, amount: 1,
    })).toThrow(/refund|uncalled/i);
    let prefix = input;
    const award = valid.events.find((event) => event.type === 'PotAwarded')!;
    for (const event of valid.events) {
      if (event === award) break;
      prefix = reduceDomainEvent(prefix, event);
    }
    expect(() => reduceDomainEvent(prefix, { ...award, winners: [1], amounts: [120] }))
      .toThrow(/pending pot|award/i);
    expect(() => reduceDomainEvent(prefix, { ...award, amounts: [119] }))
      .toThrow(/pending pot|award/i);
  });

  it('rejects a new hand before elimination is finalized and preserves finalized elimination', () => {
    const base = createTournament(
      { ...config(3), initialButtonSeat: 1 },
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'sole-elimination-owner',
    ).state;
    const input: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: [0, 150, 150][seatIndex]!,
        status: seatIndex === 0 ? 'all-in' as const : 'active' as const,
      })),
    };
    expect(() => startHand(input, { fixedDeck: createStandardDeck() }))
      .toThrow(/elimination|settlement/i);
    const finalized: TournamentState = {
      ...input,
      seats: input.seats.map((seat, seatIndex) => seatIndex === 0
        ? { ...seat, status: 'eliminated' as const }
        : seat),
    };
    const result = startHand(finalized, { fixedDeck: createStandardDeck() });
    expect(result.events.some((event) => event.type === 'PlayerEliminated')).toBe(false);
    expect(result.state.seats[0]).toMatchObject({ status: 'eliminated', holeCards: null, stack: 0 });
  });

  it('rejects elimination before all chip buffers settle and completion before elimination', () => {
    const base = createTournament(
      config(2),
      [{ playerId: 'p0', seatIndex: 0 }, { playerId: 'p1', seatIndex: 1 }],
      'elimination-gates',
    ).state;
    const unsettled: TournamentState = {
      ...base,
      seats: base.seats.map((seat, seatIndex) => ({
        ...seat,
        stack: seatIndex === 0 ? 0 : 100,
        status: seatIndex === 0 ? 'all-in' as const : 'active' as const,
        committedStreet: 50,
        committedHand: 50,
      })),
      activeHand: {
        handId: 'elimination-gates/hand/1', phase: 'settlement', street: 'river', board: [],
        burnedCards: [], deck: [], dealCursor: 0, revealedHoleCardSeats: [],
        positions: { buttonPosition: 0, smallBlindSeat: 0, bigBlindSeat: 1 },
        currentActorSeat: null, currentBetTo: 0, lastFullRaiseSize: 2,
        lastAggressorSeat: null, pendingActors: [],
      },
    };
    expect(() => reduceDomainEvent(unsettled, {
      type: 'PlayerEliminated', schemaVersion: 1, eventIndex: unsettled.version,
      handId: unsettled.activeHand!.handId, seat: 0,
    })).toThrow(/settle|pending|commit/i);

    const ready: TournamentState = {
      ...unsettled,
      seats: unsettled.seats.map((seat) => ({ ...seat, committedStreet: 0, committedHand: 0 })),
    };
    expect(() => reduceDomainEvent(ready, {
      type: 'HandCompleted', schemaVersion: 1, eventIndex: ready.version,
      handId: ready.activeHand!.handId,
      finalStacks: ready.seats.map((seat) => ({ seat: seat.seatIndex, stack: seat.stack })),
    })).toThrow(/eliminat|zero/i);
  });
});

describe('public automatic completion', () => {
  it('finishes fold settlement through HandCompleted without a manual settlement call', () => {
    let state = startHand(createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'automatic-fold',
    ).state, { fixedDeck: createStandardDeck() }).state;
    state = apply(state, 0, { type: 'fold' });
    state = apply(state, 1, { type: 'fold' });

    const result = advanceAutomaticPhases(state);
    const types = result.events.map((event) => event.type);
    expect(types).toContain('PotAwarded');
    expect(types.at(-1)).toBe('HandCompleted');
    expect(result.state.activeHand).toMatchObject({ phase: 'hand-complete', currentActorSeat: null });
  });

  it('finishes all-in call, reveal, runout, award, and completion automatically', () => {
    let state = startHand(createTournament(
      config(2, 4),
      [{ playerId: 'button', seatIndex: 0 }, { playerId: 'bb', seatIndex: 1 }],
      'automatic-showdown',
    ).state, { fixedDeck: createStandardDeck() }).state;
    state = apply(state, 0, { type: 'allIn' });
    state = apply(state, 1, { type: 'call' });

    const result = advanceAutomaticPhases(state);
    const types = result.events.map((event) => event.type);
    expect(types).toContain('HoleCardsRevealed');
    expect(types).toContain('ShowdownStarted');
    expect(types).toContain('PotAwarded');
    expect(types.at(-1)).toBe('HandCompleted');
    expect(result.state.activeHand).toMatchObject({ phase: 'hand-complete', currentActorSeat: null });
    expect(advanceAutomaticPhases(result.state)).toEqual({ state: result.state, events: [] });
  });
});
