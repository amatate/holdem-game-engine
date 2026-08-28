import { describe, expect, it } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import type { DomainEvent } from '../../src/core/events.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  resolveBlindLevelForHand,
  startHand,
  type TournamentState,
  type TransitionResult,
} from '../../src/core/state.js';

function config(maxSeats = 3, startingStack = 100): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: 0,
  };
}

function created(tableConfig = config(), seed = 'reducer-authority'): TournamentState {
  return createTournament(
    tableConfig,
    Array.from({ length: tableConfig.maxSeats }, (_, seatIndex) => ({
      playerId: `p${seatIndex}`,
      seatIndex,
    })),
    seed,
  ).state;
}

function started(tableConfig = config(), seed = 'reducer-authority'): TransitionResult {
  return startHand(created(tableConfig, seed), { fixedDeck: createStandardDeck() });
}

function prefixBefore(
  initial: TournamentState,
  events: readonly DomainEvent[],
  type: DomainEvent['type'],
  occurrence = 0,
): { readonly state: TournamentState; readonly event: DomainEvent } {
  let state = initial;
  let seen = 0;
  for (const event of events) {
    if (event.type === type) {
      if (seen === occurrence) return { state, event };
      seen += 1;
    }
    state = reduceDomainEvent(state, event);
  }
  throw new Error(`missing event ${type}`);
}

function act(
  state: TournamentState,
  intent: Parameters<typeof applyIntent>[2],
): TournamentState {
  const actor = state.activeHand?.currentActorSeat;
  if (actor === null || actor === undefined) throw new Error('fixture requires actor');
  const result = applyIntent(state, actor, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

function expectRejected(state: TournamentState, event: DomainEvent): void {
  expect(() => reduceDomainEvent(state, { ...event, eventIndex: state.version })).toThrow();
}

function handStartedEvent(state: TournamentState): DomainEvent {
  const handNumber = state.handNumber + 1;
  const level = resolveBlindLevelForHand(state.config, state.initialChipTotal, handNumber);
  return {
    type: 'HandStarted',
    schemaVersion: 1,
    eventIndex: state.version,
    handId: `${state.runSeed}/hand/${handNumber}`,
    handNumber,
    logicalBlindLevel: level.logicalLevel,
    smallBlind: level.blindLevel.smallBlind,
    bigBlind: level.blindLevel.bigBlind,
  };
}

describe('strict setup event authority', () => {
  it('rejects HandStarted before completion and with fewer than two funded survivors', () => {
    const inProgress = started().state;
    expectRejected(inProgress, handStartedEvent(inProgress));

    const base = created();
    const oneSurvivor: TournamentState = {
      ...base,
      seats: base.seats.map((seat, index) => ({
        ...seat,
        stack: index === 0 ? base.initialChipTotal : 0,
        status: index === 0 ? 'active' as const : 'eliminated' as const,
      })),
    };
    expectRejected(oneSurvivor, handStartedEvent(oneSurvivor));
  });

  it('rejects valid-range positions that differ from authoritative physical advancement', () => {
    const initial = created(config(4));
    const transition = startHand(initial, { fixedDeck: createStandardDeck() });
    const { state, event } = prefixBefore(initial, transition.events, 'PositionsAssigned');
    expect(event.type).toBe('PositionsAssigned');
    if (event.type !== 'PositionsAssigned') throw new Error('fixture event mismatch');

    expectRejected(state, {
      ...event,
      buttonPosition: 1,
      smallBlindSeat: 2,
      bigBlindSeat: 3,
    });
  });

  it('rejects forged, out-of-order, duplicate, or missing blind posts', () => {
    const initial = created();
    const transition = startHand(initial, { fixedDeck: createStandardDeck() });
    const beforeSmall = prefixBefore(initial, transition.events, 'BlindPosted', 0);
    const small = beforeSmall.event;
    const big = transition.events.filter((event) => event.type === 'BlindPosted')[1]!;
    expect(small.type).toBe('BlindPosted');
    expect(big.type).toBe('BlindPosted');
    if (small.type !== 'BlindPosted' || big.type !== 'BlindPosted') throw new Error('fixture event mismatch');

    const forgeries: DomainEvent[] = [
      { ...small, amount: 0 },
      { ...small, seat: 0 },
      { ...small, kind: 'big' },
      { ...small, amount: small.amount + 1 },
      { ...small, allIn: true },
      { ...big, eventIndex: beforeSmall.state.version },
    ];
    for (const forged of forgeries) expectRejected(beforeSmall.state, forged);

    const afterSmall = reduceDomainEvent(beforeSmall.state, small);
    expectRejected(afterSmall, small);

    const deck = transition.events.find((event) => event.type === 'DeckPrepared')!;
    expectRejected(beforeSmall.state, deck);
  });

  it('rejects duplicate, malformed, wrong-version, and wrong-phase deck preparation', () => {
    const initial = created();
    const transition = startHand(initial, { fixedDeck: createStandardDeck() });
    const beforeDeck = prefixBefore(initial, transition.events, 'DeckPrepared');
    const deck = beforeDeck.event;
    expect(deck.type).toBe('DeckPrepared');
    if (deck.type !== 'DeckPrepared') throw new Error('fixture event mismatch');

    const malformed = [
      ...deck.fullOrderedDeck.slice(0, 51),
      deck.fullOrderedDeck[0]!,
    ];
    expectRejected(beforeDeck.state, { ...deck, fullOrderedDeck: malformed });
    expectRejected(beforeDeck.state, {
      ...deck,
      shuffleVersion: 'other-shuffle' as 'fisher-yates-v1',
    });

    const afterDeck = reduceDomainEvent(beforeDeck.state, deck);
    expectRejected(afterDeck, deck);

    const beforePositions = prefixBefore(initial, transition.events, 'PositionsAssigned').state;
    expectRejected(beforePositions, deck);
  });
});

describe('strict decision event authority', () => {
  it('rejects forged preflop and postflop BettingRoundStarted events and wrong order', () => {
    const initial = created();
    const transition = startHand(initial, { fixedDeck: createStandardDeck() });
    const beforePreflop = prefixBefore(initial, transition.events, 'BettingRoundStarted');
    const preflop = beforePreflop.event;
    expect(preflop.type).toBe('BettingRoundStarted');
    if (preflop.type !== 'BettingRoundStarted') throw new Error('fixture event mismatch');

    for (const forged of [
      { ...preflop, actor: null },
      { ...preflop, actor: 1 },
      { ...preflop, currentBetTo: 1 },
      { ...preflop, lastFullRaiseSize: 3 },
      { ...preflop, street: 'flop' as const },
    ]) expectRejected(beforePreflop.state, forged);

    const beforeHole = prefixBefore(initial, transition.events, 'HoleCardsDealt').state;
    expectRejected(beforeHole, preflop);

    let state = transition.state;
    state = act(state, { type: 'call' });
    state = act(state, { type: 'call' });
    state = act(state, { type: 'check' });
    const automatic = advanceAutomaticPhases(state);
    const beforeFlop = prefixBefore(state, automatic.events, 'BettingRoundStarted');
    const flop = beforeFlop.event;
    expect(flop.type).toBe('BettingRoundStarted');
    if (flop.type !== 'BettingRoundStarted') throw new Error('fixture event mismatch');

    for (const forged of [
      { ...flop, actor: null },
      { ...flop, actor: 0 },
      { ...flop, currentBetTo: 1 },
      { ...flop, lastFullRaiseSize: 3 },
      { ...flop, street: 'turn' as const },
    ]) expectRejected(beforeFlop.state, forged);

    const beforeBurn = prefixBefore(state, automatic.events, 'CardBurned').state;
    expectRejected(beforeBurn, flop);
  });

  it('rejects out-of-turn and forged check/call/raise/all-in PlayerActed payloads', () => {
    const initial = started().state;
    const call = applyIntent(initial, initial.activeHand!.currentActorSeat!, { type: 'call' });
    expect(call.accepted).toBe(true);
    if (!call.accepted || call.events[0]?.type !== 'PlayerActed') throw new Error('call fixture failed');
    const callEvent = call.events[0];
    for (const forged of [
      { ...callEvent, seat: 1 },
      { ...callEvent, paid: 0 },
      { ...callEvent, betToAfter: 1 },
      { ...callEvent, allIn: true },
      { ...callEvent, normalizedKind: 'check' as const },
    ]) expectRejected(initial, forged);

    const raised = applyIntent(initial, initial.activeHand!.currentActorSeat!, {
      type: 'raiseTo', amount: 6,
    });
    expect(raised.accepted).toBe(true);
    if (!raised.accepted || raised.events[0]?.type !== 'PlayerActed') throw new Error('raise fixture failed');
    for (const forged of [
      { ...raised.events[0], paid: 0 },
      { ...raised.events[0], betToAfter: 5 },
      { ...raised.events[0], paid: 5.5, betToAfter: 5.5 },
      { ...raised.events[0], fullRaise: false },
      { ...raised.events[0], raiseReopened: false },
    ]) expectRejected(initial, forged);

    const allIn = applyIntent(initial, initial.activeHand!.currentActorSeat!, { type: 'allIn' });
    expect(allIn.accepted).toBe(true);
    if (!allIn.accepted || allIn.events[0]?.type !== 'PlayerActed') throw new Error('all-in fixture failed');
    for (const forged of [
      { ...allIn.events[0], paid: allIn.events[0].paid - 1 },
      { ...allIn.events[0], allIn: false },
      { ...allIn.events[0], fullRaise: false },
    ]) expectRejected(initial, forged);

    let checkState = initial;
    checkState = act(checkState, { type: 'fold' });
    checkState = act(checkState, { type: 'call' });
    const checked = applyIntent(checkState, checkState.activeHand!.currentActorSeat!, { type: 'check' });
    expect(checked.accepted).toBe(true);
    if (!checked.accepted || checked.events[0]?.type !== 'PlayerActed') throw new Error('check fixture failed');
    expectRejected(checkState, { ...checked.events[0], paid: 1 });
  });

  it('rejects BettingRoundClosed while a player decision is still owed', () => {
    const state = started().state;
    expectRejected(state, {
      type: 'BettingRoundClosed',
      schemaVersion: 1,
      eventIndex: state.version,
      handId: state.activeHand!.handId,
      street: 'preflop',
    });
  });

  it('rejects actor-null betting state even when corrupted pendingActors is also empty', () => {
    const state = started().state;
    const stranded: TournamentState = {
      ...state,
      activeHand: {
        ...state.activeHand!,
        currentActorSeat: null,
        pendingActors: [],
      },
    };

    expect(() => assertTournamentInvariants(stranded)).toThrow(/actor|decision|pending/i);
  });
});
