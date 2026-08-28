import { describe, expect, it } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';

function config(maxSeats: number, startingStack = 100): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: 0,
  };
}

function act(
  state: TournamentState,
  seat: number,
  intent: Parameters<typeof applyIntent>[2],
): TournamentState {
  const result = applyIntent(state, seat, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

function replayAndCheckEveryPrefix(events: TournamentState['eventLog']): TournamentState {
  let state: TournamentState | null = null;
  for (const event of events) {
    state = reduceDomainEvent(state, event);
    expect(() => assertTournamentInvariants(state!)).not.toThrow();
  }
  return state!;
}

function completedAllInHand(): TournamentState {
  let state = createTournament(
    config(2, 4),
    [{ playerId: 'p0', seatIndex: 0 }, { playerId: 'p1', seatIndex: 1 }],
    'invariant-all-in',
  ).state;
  state = startHand(state, { fixedDeck: createStandardDeck() }).state;
  state = act(state, 0, { type: 'allIn' });
  state = act(state, 1, { type: 'call' });
  return advanceAutomaticPhases(state).state;
}

describe('phase-aware tournament invariants', () => {
  it('accepts every event prefix through all-in reveal, runout, pending pots, payout, and completion', () => {
    const completed = completedAllInHand();
    const replayed = replayAndCheckEveryPrefix(completed.eventLog);

    expect(replayed).toEqual(completed);
    expect(completed.eventLog.some((event) => event.type === 'PotConstructed')).toBe(true);
    expect(completed.eventLog.some((event) => event.type === 'PotAwarded')).toBe(true);
  });

  it('accepts every refund and fold-settlement prefix', () => {
    const tableConfig = config(3);
    let state = createTournament(
      tableConfig,
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'invariant-refund',
    ).state;
    state = startHand(state, { fixedDeck: createStandardDeck() }).state;
    state = act(state, 0, { type: 'raiseTo', amount: 10 });
    state = act(state, 1, { type: 'fold' });
    state = act(state, 2, { type: 'fold' });
    state = advanceAutomaticPhases(state).state;

    expect(state.eventLog.some((event) => event.type === 'UncalledBetReturned')).toBe(true);
    expect(() => replayAndCheckEveryPrefix(state.eventLog)).not.toThrow();
  });

  it.each([
    ['negative stack', (state: TournamentState): TournamentState => ({
      ...state,
      seats: state.seats.map((seat, index) => index === 0 ? { ...seat, stack: -1 } : seat),
    })],
    ['unsafe commitment', (state: TournamentState): TournamentState => ({
      ...state,
      seats: state.seats.map((seat, index) => index === 0
        ? { ...seat, committedHand: Number.MAX_SAFE_INTEGER + 1 }
        : seat),
    })],
    ['invalid current actor', (state: TournamentState): TournamentState => ({
      ...state,
      seats: state.seats.map((seat) => seat.seatIndex === state.activeHand?.currentActorSeat
        ? { ...seat, status: 'folded' as const }
        : seat),
    })],
  ] as const)('rejects %s', (_name, mutate) => {
    const state = startHand(createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'invalid-scalars',
    ).state, { fixedDeck: createStandardDeck() }).state;

    expect(() => assertTournamentInvariants(mutate(state))).toThrow();
  });

  it('rejects a betting state stranded with a null actor and a funded pending decision', () => {
    const state = startHand(createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'stranded-actor',
    ).state, { fixedDeck: createStandardDeck() }).state;
    const stranded: TournamentState = {
      ...state,
      activeHand: { ...state.activeHand!, currentActorSeat: null },
    };

    expect(stranded.activeHand?.pendingActors.length).toBeGreaterThan(0);
    expect(() => assertTournamentInvariants(stranded)).toThrow(/actor|pending|decision/i);
  });

  it.each([
    ['negative current bet', (state: TournamentState): TournamentState => ({
      ...state, activeHand: { ...state.activeHand!, currentBetTo: -1 },
    })],
    ['unsafe full raise size', (state: TournamentState): TournamentState => ({
      ...state, activeHand: { ...state.activeHand!, lastFullRaiseSize: Number.MAX_SAFE_INTEGER + 1 },
    })],
    ['negative deal cursor', (state: TournamentState): TournamentState => ({
      ...state, activeHand: { ...state.activeHand!, dealCursor: -1 },
    })],
    ['negative constructed pot count', (state: TournamentState): TournamentState => ({
      ...state, activeHand: { ...state.activeHand!, constructedPotCount: -1 },
    })],
    ['unsafe last constructed cap', (state: TournamentState): TournamentState => ({
      ...state, activeHand: { ...state.activeHand!, lastConstructedCap: Number.MAX_SAFE_INTEGER + 1 },
    })],
    ['unsupported event schema', (state: TournamentState): TournamentState => ({
      ...state,
      eventLog: state.eventLog.map((event, index) => index === 0
        ? { ...event, schemaVersion: 2 as 1 }
        : event),
    })],
    ['out-of-range physical position', (state: TournamentState): TournamentState => ({
      ...state,
      activeHand: {
        ...state.activeHand!,
        positions: { ...state.activeHand!.positions, buttonPosition: state.config.maxSeats },
      },
    })],
  ] as const)('rejects omitted scalar authority: %s', (_name, mutate) => {
    const state = startHand(createTournament(
      config(3),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'invalid-hand-scalars',
    ).state, { fixedDeck: createStandardDeck() }).state;

    expect(() => assertTournamentInvariants(mutate(state))).toThrow();
  });

  it('rejects deck/destination order mismatch, duplicate destinations, cursor drift, and invalid board growth', () => {
    let state = createTournament(
      config(2, 10),
      [{ playerId: 'p0', seatIndex: 0 }, { playerId: 'p1', seatIndex: 1 }],
      'invalid-cards',
    ).state;
    state = startHand(state, { fixedDeck: createStandardDeck() }).state;
    const swapped: TournamentState = {
      ...state,
      seats: state.seats.map((seat, index) => index === 0
        ? { ...seat, holeCards: state.seats[1]!.holeCards }
        : index === 1 ? { ...seat, holeCards: state.seats[0]!.holeCards } : seat),
    };
    const duplicate: TournamentState = {
      ...state,
      seats: state.seats.map((seat, index) => index === 1
        ? { ...seat, holeCards: state.seats[0]!.holeCards }
        : seat),
    };
    const cursorDrift: TournamentState = {
      ...state,
      activeHand: { ...state.activeHand!, dealCursor: state.activeHand!.dealCursor + 1 },
    };
    const invalidBoard: TournamentState = {
      ...state,
      activeHand: { ...state.activeHand!, board: state.activeHand!.deck.slice(4, 6) },
    };
    const shortDeck: TournamentState = {
      ...state,
      activeHand: { ...state.activeHand!, deck: state.activeHand!.deck.slice(0, 51) },
    };
    const duplicateDeck: TournamentState = {
      ...state,
      activeHand: {
        ...state.activeHand!,
        deck: [...state.activeHand!.deck.slice(0, 51), state.activeHand!.deck[0]!],
      },
    };

    for (const invalid of [swapped, duplicate, cursorDrift, invalidBoard, shortDeck, duplicateDeck]) {
      expect(() => assertTournamentInvariants(invalid)).toThrow();
    }
  });

  it('rejects adversarial hole-deal payloads before they can create an invalid replay prefix', () => {
    const created = createTournament(
      config(3, 10),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'invalid-hole-payload',
    ).state;
    const transition = startHand(created, { fixedDeck: createStandardDeck() });
    let beforeDeal = created;
    for (const event of transition.events) {
      if (event.type === 'HoleCardsDealt') break;
      beforeDeal = reduceDomainEvent(beforeDeal, event);
    }
    const valid = transition.events.find((event) => event.type === 'HoleCardsDealt')!;
    expect(valid.type).toBe('HoleCardsDealt');
    if (valid.type !== 'HoleCardsDealt') throw new Error('missing hole deal');
    const swappedCards = [...valid.orderedDeals];
    swappedCards[0] = { ...swappedCards[0]!, card: valid.orderedDeals[1]!.card };
    swappedCards[1] = { ...swappedCards[1]!, card: valid.orderedDeals[0]!.card };
    const duplicateSeatRound = [...valid.orderedDeals];
    duplicateSeatRound[1] = { ...duplicateSeatRound[0]! };
    const outsideSurvivors = [...valid.orderedDeals];
    outsideSurvivors[0] = { ...outsideSurvivors[0]!, seat: 9 };
    const wrongRound = [...valid.orderedDeals];
    wrongRound[0] = { ...wrongRound[0]!, round: 2 };
    const driftedCursor: TournamentState = {
      ...beforeDeal,
      activeHand: { ...beforeDeal.activeHand!, dealCursor: 1 },
    };

    for (const orderedDeals of [swappedCards, duplicateSeatRound, outsideSurvivors, wrongRound]) {
      expect(() => reduceDomainEvent(beforeDeal, { ...valid, orderedDeals })).toThrow();
    }
    expect(() => reduceDomainEvent(driftedCursor, valid)).toThrow();
  });

  it('requires state deck identity to equal the single DeckPrepared payload exactly', () => {
    const state = startHand(createTournament(
      config(3, 10),
      Array.from({ length: 3 }, (_, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex })),
      'deck-identity',
    ).state, { fixedDeck: createStandardDeck() }).state;
    const driftedDeck = [...state.activeHand!.deck];
    [driftedDeck[50], driftedDeck[51]] = [driftedDeck[51]!, driftedDeck[50]!];
    const drifted: TournamentState = {
      ...state,
      activeHand: { ...state.activeHand!, deck: driftedDeck },
    };
    const duplicatePrepared = {
      type: 'DeckPrepared' as const,
      schemaVersion: 1 as const,
      eventIndex: state.version,
      handId: state.activeHand!.handId,
      fullOrderedDeck: state.activeHand!.deck,
      shuffleVersion: 'fisher-yates-v1' as const,
    };
    const duplicated: TournamentState = {
      ...state,
      eventLog: [...state.eventLog, duplicatePrepared],
      version: state.version + 1,
    };

    expect(() => assertTournamentInvariants(drifted)).toThrow(/deck|prepared|identity/i);
    expect(() => assertTournamentInvariants(duplicated)).toThrow(/deck|prepared|single|duplicate/i);
  });

  it('rejects corrupt pending payout accounting and a folded recorded winner', () => {
    const completed = completedAllInHand();
    let prefix: TournamentState | null = null;
    let withPendingPot: TournamentState | null = null;
    let afterAward: TournamentState | null = null;
    for (const event of completed.eventLog) {
      prefix = reduceDomainEvent(prefix, event);
      if (event.type === 'PotConstructed') withPendingPot = prefix;
      if (event.type === 'PotAwarded') afterAward = prefix;
    }
    expect(withPendingPot).not.toBeNull();
    expect(afterAward).not.toBeNull();

    const corruptPot: TournamentState = {
      ...withPendingPot!,
      activeHand: {
        ...withPendingPot!.activeHand!,
        pendingPots: withPendingPot!.activeHand!.pendingPots!.map((pot, index) => index === 0
          ? { ...pot, amount: pot.amount + 1 }
          : pot),
      },
    };
    const awarded = afterAward!.eventLog.findLast((event) => event.type === 'PotAwarded')!;
    const foldedWinner: TournamentState = {
      ...afterAward!,
      seats: afterAward!.seats.map((seat) => awarded.type === 'PotAwarded'
        && awarded.winners.includes(seat.seatIndex)
        ? { ...seat, status: 'folded' as const }
        : seat),
    };

    expect(() => assertTournamentInvariants(corruptPot)).toThrow();
    expect(() => assertTournamentInvariants(foldedWinner)).toThrow();
  });

  it('requires hand completion to clear street/hand commitments and all pending pots', () => {
    const completed = completedAllInHand();
    const winner = completed.seats.find((seat) => seat.stack > 0)!;
    const dirty: TournamentState = {
      ...completed,
      seats: completed.seats.map((seat) => seat.seatIndex === winner.seatIndex
        ? { ...seat, stack: seat.stack - 1, committedStreet: 1, committedHand: 1 }
        : seat),
    };

    expect(() => assertTournamentInvariants(dirty)).toThrow();
  });
});
