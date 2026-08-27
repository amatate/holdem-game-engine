import { describe, expect, it } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import type { DomainEvent } from '../../src/core/events.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentSeatInput,
  type TournamentState,
} from '../../src/core/state.js';

const FOUR_HANDED_CONFIG: TournamentConfig = {
  maxSeats: 4,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: [
    { smallBlind: 1, bigBlind: 2 },
    { smallBlind: 2, bigBlind: 4 },
    { smallBlind: 3, bigBlind: 6 },
    { smallBlind: 5, bigBlind: 10 },
    { smallBlind: 10, bigBlind: 20 },
    { smallBlind: 20, bigBlind: 40 },
    { smallBlind: 40, bigBlind: 80 },
    { smallBlind: 80, bigBlind: 160 },
  ],
  initialButtonSeat: 0,
};

function seatsFor(count: number): TournamentSeatInput[] {
  return Array.from({ length: count }, (_, seatIndex) => ({
    playerId: `player-${seatIndex}`,
    seatIndex,
  }));
}

function createState(config = FOUR_HANDED_CONFIG, seed = 'run-seed'): TournamentState {
  return createTournament(config, seatsFor(config.maxSeats), seed).state;
}

function withStacks(state: TournamentState, stacks: readonly number[]): TournamentState {
  return {
    ...state,
    seats: state.seats.map((seat, seatIndex) => ({
      ...seat,
      stack: stacks[seatIndex]!,
      status: stacks[seatIndex] === 0 ? 'eliminated' : 'active',
    })),
  };
}

describe('tournament creation and event reduction', () => {
  it('creates all authoritative state solely by reducing one GameStarted event', () => {
    const participants = seatsFor(4);
    const result = createTournament(FOUR_HANDED_CONFIG, participants, 'run-seed');

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'GameStarted',
      schemaVersion: 1,
      eventIndex: 0,
      config: FOUR_HANDED_CONFIG,
      seats: participants,
      runSeed: 'run-seed',
      rulesVersion: 'holdem-v1',
      rngVersion: 'mulberry32-v1',
      shuffleVersion: 'fisher-yates-v1',
      strategyVersion: 'parametric-v1',
    });
    expect(result.state).toEqual(reduceDomainEvent(null, result.events[0]!));
    expect(result.state).toMatchObject({
      handNumber: 0,
      logicalBlindLevel: 0,
      activeHand: null,
      version: 1,
      initialChipTotal: 400,
    });
    expect(result.state.seats.map((seat) => seat.seatIndex)).toEqual([0, 1, 2, 3]);
    expect(result.state.seats.every((seat) => seat.stack === 100 && seat.status === 'active')).toBe(true);
    expect(result.state.eventLog).toEqual(result.events);
  });

  it('allows only GameStarted to reduce from null and requires contiguous event indices', () => {
    const state = createState();
    const handStarted: DomainEvent = {
      type: 'HandStarted',
      schemaVersion: 1,
      eventIndex: state.version,
      handId: 'run-seed/hand/1',
      handNumber: 1,
      logicalBlindLevel: 0,
      smallBlind: 1,
      bigBlind: 2,
    };

    expect(() => reduceDomainEvent(null, handStarted)).toThrow(/GameStarted/);
    expect(() => reduceDomainEvent(state, { ...handStarted, eventIndex: state.version + 1 }))
      .toThrow(/contiguous|index/i);
    expect(() => reduceDomainEvent(state, state.eventLog[0]!)).toThrow(/GameStarted|initialized/i);
  });
});

describe('starting a hand', () => {
  it('posts blinds, prepares the complete private deck, and deals four-handed hole cards in two rounds', () => {
    const before = createState();
    const fixedDeck = createStandardDeck();
    const beforeSnapshot = structuredClone(before);

    const result = startHand(before, { fixedDeck });
    const hand = result.state.activeHand!;

    expect(before).toEqual(beforeSnapshot);
    expect(result.events.map((event) => event.type)).toEqual([
      'HandStarted',
      'PositionsAssigned',
      'BlindPosted',
      'BlindPosted',
      'DeckPrepared',
      'HoleCardsDealt',
      'BettingRoundStarted',
    ]);
    expect(result.events.map((event) => event.eventIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.events.every((event) => event.type === 'GameStarted' || event.handId === hand.handId)).toBe(true);
    expect(result.events
      .filter((event) => event.type === 'BlindPosted')
      .map(({ kind, amount, allIn }) => ({ kind, amount, allIn })))
      .toEqual([
        { kind: 'small', amount: 1, allIn: false },
        { kind: 'big', amount: 2, allIn: false },
      ]);
    expect(hand.positions).toEqual({ buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 });
    expect(hand).toMatchObject({
      phase: 'preflop',
      street: 'preflop',
      dealCursor: 8,
      currentActorSeat: 3,
      currentBetTo: 2,
      lastFullRaiseSize: 2,
      lastAggressorSeat: 2,
      pendingActors: [3, 0, 1, 2],
    });
    expect(result.state.seats.map((seat) => ({
      seat: seat.seatIndex,
      stack: seat.stack,
      committedStreet: seat.committedStreet,
      cards: seat.holeCards?.map((card) => card.code),
    }))).toEqual([
      { seat: 0, stack: 100, committedStreet: 0, cards: [fixedDeck[3]!.code, fixedDeck[7]!.code] },
      { seat: 1, stack: 99, committedStreet: 1, cards: [fixedDeck[0]!.code, fixedDeck[4]!.code] },
      { seat: 2, stack: 98, committedStreet: 2, cards: [fixedDeck[1]!.code, fixedDeck[5]!.code] },
      { seat: 3, stack: 100, committedStreet: 0, cards: [fixedDeck[2]!.code, fixedDeck[6]!.code] },
    ]);

    const deckPrepared = result.events.find((event) => event.type === 'DeckPrepared');
    expect(deckPrepared?.type === 'DeckPrepared' && deckPrepared.fullOrderedDeck).toEqual(fixedDeck);
    const dealt = result.events.find((event) => event.type === 'HoleCardsDealt');
    expect(dealt?.type === 'HoleCardsDealt' && dealt.orderedDeals.map(({ seat, card, round }) => ({
      seat,
      card: card.code,
      round,
    }))).toEqual([
      { seat: 1, card: fixedDeck[0]!.code, round: 1 },
      { seat: 2, card: fixedDeck[1]!.code, round: 1 },
      { seat: 3, card: fixedDeck[2]!.code, round: 1 },
      { seat: 0, card: fixedDeck[3]!.code, round: 1 },
      { seat: 1, card: fixedDeck[4]!.code, round: 2 },
      { seat: 2, card: fixedDeck[5]!.code, round: 2 },
      { seat: 3, card: fixedDeck[6]!.code, round: 2 },
      { seat: 0, card: fixedDeck[7]!.code, round: 2 },
    ]);
  });

  it('reconstructs the exact result from every emitted event without randomness or direct state patching', () => {
    const before = createState();
    const result = startHand(before, { fixedDeck: createStandardDeck().reverse() });
    let replayed = before;

    for (const event of result.events) {
      replayed = reduceDomainEvent(replayed, event);
    }

    expect(replayed).toEqual(result.state);
    expect(result.state.eventLog.slice(-result.events.length)).toEqual(result.events);
    expect(result.state.version).toBe(before.version + result.events.length);
  });

  it('shuffles deterministically by run seed and hand number when no fixed deck is supplied', () => {
    const first = startHand(createState(FOUR_HANDED_CONFIG, 'same-seed'));
    const second = startHand(createState(FOUR_HANDED_CONFIG, 'same-seed'));
    const different = startHand(createState(FOUR_HANDED_CONFIG, 'different-seed'));

    expect(first.state.activeHand?.deck.map((card) => card.code))
      .toEqual(second.state.activeHand?.deck.map((card) => card.code));
    expect(first.state.activeHand?.deck.map((card) => card.code))
      .not.toEqual(different.state.activeHand?.deck.map((card) => card.code));
  });

  it('uses heads-up blind, deal, and preflop action order', () => {
    const config: TournamentConfig = {
      ...FOUR_HANDED_CONFIG,
      maxSeats: 2,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    };
    const result = startHand(createState(config), { fixedDeck: createStandardDeck() });
    const dealt = result.events.find((event) => event.type === 'HoleCardsDealt');

    expect(result.state.activeHand?.positions).toEqual({
      buttonPosition: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
    });
    expect(result.state.activeHand?.currentActorSeat).toBe(0);
    expect(result.state.activeHand?.pendingActors).toEqual([0, 1]);
    expect(dealt?.type === 'HoleCardsDealt' && dealt.orderedDeals.map((deal) => deal.seat))
      .toEqual([1, 0, 1, 0]);
  });

  it('keeps the full multiway bring-in when the big blind can post only one chip', () => {
    const before = withStacks(createState(), [199, 100, 1, 100]);
    const fixedDeck = createStandardDeck();
    const result = startHand(before, { fixedDeck });
    const dealt = result.events.find((event) => event.type === 'HoleCardsDealt');

    expect(result.state.seats.map((seat) => seat.stack)).toEqual([199, 99, 0, 100]);
    expect(result.state.seats[2]?.status).toBe('all-in');
    expect(result.state.seats[2]?.holeCards?.map((card) => card.code))
      .toEqual([fixedDeck[1]!.code, fixedDeck[5]!.code]);
    expect(dealt?.type === 'HoleCardsDealt' && dealt.orderedDeals
      .filter((deal) => deal.seat === 2)
      .map(({ card, round }) => ({ card: card.code, round })))
      .toEqual([
        { card: fixedDeck[1]!.code, round: 1 },
        { card: fixedDeck[5]!.code, round: 2 },
      ]);
    expect(result.state.activeHand).toMatchObject({
      dealCursor: 8,
      currentBetTo: 2,
      currentActorSeat: 3,
      pendingActors: [3, 0, 1],
    });
    expect(result.state.seats.every((seat) => seat.stack >= 0)).toBe(true);
  });

  it('has no pending actor when the funded HU small blind already matches a one-chip all-in BB', () => {
    const config: TournamentConfig = {
      ...FOUR_HANDED_CONFIG,
      maxSeats: 2,
      startingStack: 100,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    };
    const before = withStacks(createState(config), [100, 1]);
    const result = startHand(before, { fixedDeck: createStandardDeck() });

    expect(result.state.seats.map((seat) => ({
      stack: seat.stack,
      committed: seat.committedStreet,
      status: seat.status,
    }))).toEqual([
      { stack: 99, committed: 1, status: 'active' },
      { stack: 0, committed: 1, status: 'all-in' },
    ]);
    expect(result.state.activeHand).toMatchObject({
      currentBetTo: 1,
      currentActorSeat: null,
      pendingActors: [],
    });
  });

  it('limits heads-up debt to the short big blind actual post', () => {
    const config: TournamentConfig = {
      ...FOUR_HANDED_CONFIG,
      maxSeats: 2,
      startingStack: 100,
      blindLevels: [{ smallBlind: 2, bigBlind: 4 }],
    };
    const before = withStacks(createState(config), [197, 3]);
    const result = startHand(before, { fixedDeck: createStandardDeck() });

    expect(result.state.seats.map((seat) => ({ stack: seat.stack, committed: seat.committedStreet })))
      .toEqual([{ stack: 195, committed: 2 }, { stack: 0, committed: 3 }]);
    expect(result.state.activeHand).toMatchObject({
      currentBetTo: 3,
      currentActorSeat: 0,
      pendingActors: [0],
    });
    expect(3 - result.state.seats[0]!.committedStreet).toBe(1);
    expect(result.state.seats.every((seat) => seat.stack >= 0)).toBe(true);
  });

  it('has no pending actor when both heads-up players post their last chip at a 1/2 level', () => {
    const config: TournamentConfig = {
      ...FOUR_HANDED_CONFIG,
      maxSeats: 2,
      startingStack: 1,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    };
    const result = startHand(createState(config), { fixedDeck: createStandardDeck() });

    expect(result.state.seats.map((seat) => ({ stack: seat.stack, status: seat.status })))
      .toEqual([{ stack: 0, status: 'all-in' }, { stack: 0, status: 'all-in' }]);
    expect(result.state.activeHand).toMatchObject({
      currentBetTo: 1,
      currentActorSeat: null,
      pendingActors: [],
    });
    expect(result.state.seats.every((seat) => seat.stack >= 0)).toBe(true);
  });
});
