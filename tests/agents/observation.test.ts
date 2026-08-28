import { describe, expect, it } from 'vitest';

import { projectObservation } from '../../src/agents/observation.js';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  startHand,
  startNextHand,
  type TournamentState,
} from '../../src/core/state.js';

function config(
  maxSeats = 2,
  startingStack = 100,
  smallBlind = 1,
  bigBlind = 2,
  handsPerLevel = 8,
): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel,
    blindLevels: [{ smallBlind, bigBlind }],
    initialButtonSeat: 0,
  };
}

function createStartedState(tableConfig = config(), runSeed = 'MASTER-SEED-SENTINEL'): TournamentState {
  const created = createTournament(
    tableConfig,
    Array.from({ length: tableConfig.maxSeats }, (_, seatIndex) => ({
      playerId: `player-${seatIndex}`,
      seatIndex,
    })),
    runSeed,
  ).state;
  return startHand(created, { fixedDeck: createStandardDeck() }).state;
}

function accepted(
  state: TournamentState,
  seatIndex: number,
  intent: Parameters<typeof applyIntent>[2],
): TournamentState {
  const result = applyIntent(state, seatIndex, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

function formedSidePotDecision(): TournamentState {
  let state = createStartedState(config(4), 'formed-side-pot');
  state = accepted(state, 3, { type: 'raiseTo', amount: 30 });
  state = accepted(state, 0, { type: 'call' });
  state = accepted(state, 1, { type: 'call' });
  state = accepted(state, 2, { type: 'fold' });
  state = advanceAutomaticPhases(state).state;
  state = accepted(state, 1, { type: 'check' });
  state = accepted(state, 3, { type: 'check' });
  state = accepted(state, 0, { type: 'allIn' });
  state = accepted(state, 1, { type: 'fold' });

  expect(state.activeHand?.street).toBe('flop');
  expect(state.activeHand?.currentActorSeat).toBe(3);
  expect(state.activeHand?.currentBetTo).toBe(70);
  expect(state.activeHand?.pendingActors).toEqual([3]);
  expect(state.seats.map((seat) => seat.status)).toEqual(['all-in', 'folded', 'folded', 'active']);
  expect(state.seats.reduce((sum, seat) => sum + seat.stack + seat.committedHand, 0))
    .toBe(state.initialChipTotal);
  expect(() => assertTournamentInvariants(state)).not.toThrow();
  return state;
}

describe('current-player observation projection', () => {
  it('builds every schema field explicitly at the first HU decision', () => {
    const state = createStartedState();
    const observation = projectObservation(state, 0);

    expect(observation).toEqual({
      schemaVersion: 1,
      handId: 'hand/1',
      handNumber: 1,
      decisionIndex: 0,
      actorSeatIndex: 0,
      street: 'preflop',
      holeCards: [parseCard('2d'), parseCard('2s')],
      board: [],
      buttonPosition: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      smallBlind: 1,
      bigBlind: 2,
      potTotal: 3,
      sidePots: [],
      seats: [
        {
          playerId: 'player-0',
          seatIndex: 0,
          stack: 99,
          status: 'active',
          committedStreet: 1,
          committedHand: 1,
          revealedHoleCards: null,
        },
        {
          playerId: 'player-1',
          seatIndex: 1,
          stack: 98,
          status: 'active',
          committedStreet: 2,
          committedHand: 2,
          revealedHoleCards: null,
        },
      ],
      actionHistory: [
        { type: 'blindPosted', seatIndex: 0, kind: 'small', amount: 1, allIn: false },
        { type: 'blindPosted', seatIndex: 1, kind: 'big', amount: 2, allIn: false },
      ],
      legalActions: {
        fold: true,
        check: false,
        call: { pay: 1, to: 2, isAllIn: false },
        raiseTo: { min: 4, max: 100 },
        allIn: { to: 100, mode: 'fullRaise' },
      },
    });
    expect(JSON.stringify(observation)).not.toContain('MASTER-SEED-SENTINEL');
  });

  it('counts accepted current-hand actions and resets history and decision index next hand', () => {
    let first = createStartedState(config(2, 100, 1, 2, 1));
    first = accepted(first, 0, { type: 'call' });
    const facingCheck = projectObservation(first, 1);
    expect(facingCheck.decisionIndex).toBe(1);
    expect(facingCheck.actionHistory).toEqual([
      { type: 'blindPosted', seatIndex: 0, kind: 'small', amount: 1, allIn: false },
      { type: 'blindPosted', seatIndex: 1, kind: 'big', amount: 2, allIn: false },
      { type: 'playerActed', seatIndex: 0, kind: 'call', paid: 1, betTo: 2, allIn: false },
    ]);

    let completed = createStartedState(config(2, 100, 1, 2, 1));
    completed = accepted(completed, 0, { type: 'fold' });
    completed = advanceAutomaticPhases(completed).state;
    expect(completed.activeHand?.phase).toBe('hand-complete');
    const second = startNextHand(completed, { fixedDeck: createStandardDeck() }).state;
    const observation = projectObservation(second, 1);

    expect(observation.handId).toBe('hand/2');
    expect(observation.handNumber).toBe(2);
    expect(observation.decisionIndex).toBe(0);
    expect(observation.smallBlind).toBe(2);
    expect(observation.bigBlind).toBe(4);
    expect(observation.actionHistory).toEqual([
      { type: 'blindPosted', seatIndex: 1, kind: 'small', amount: 2, allIn: false },
      { type: 'blindPosted', seatIndex: 0, kind: 'big', amount: 4, allIn: false },
    ]);
    expect(JSON.stringify(observation.actionHistory)).not.toMatch(/fold|hand\/1/);
  });

  it('uses actual authoritative HandStarted blinds for extrapolated and short-blind hands', () => {
    let completed = createStartedState(config(2, 100, 1, 2, 1));
    completed = accepted(completed, 0, { type: 'fold' });
    completed = advanceAutomaticPhases(completed).state;
    const extrapolated = startNextHand(completed, { fixedDeck: createStandardDeck() }).state;
    const extrapolatedObservation = projectObservation(extrapolated, 1);

    expect(extrapolated.logicalBlindLevel).toBe(1);
    expect(extrapolatedObservation.smallBlind).toBe(2);
    expect(extrapolatedObservation.bigBlind).toBe(4);

    const created = createTournament(
      config(2, 100, 2, 4),
      [{ playerId: 'player-0', seatIndex: 0 }, { playerId: 'player-1', seatIndex: 1 }],
      'short-blind-seed',
    ).state;
    const rebalanced: TournamentState = {
      ...created,
      seats: created.seats.map((seat) => ({
        ...seat,
        stack: seat.seatIndex === 0 ? 197 : 3,
      })),
    };
    const shortBlind = startHand(rebalanced, { fixedDeck: createStandardDeck() }).state;
    const shortObservation = projectObservation(shortBlind, 0);

    expect(shortBlind.seats.find((seat) => seat.seatIndex === 1)?.committedHand).toBe(3);
    expect(shortObservation.smallBlind).toBe(2);
    expect(shortObservation.bigBlind).toBe(4);
    expect(shortObservation.potTotal).toBe(5);
    expect(shortObservation.legalActions.call).toEqual({ pay: 1, to: 3, isAllIn: false });
  });

  it('derives actor-contestable total and only currently formed non-main side-pot layers', () => {
    const normal = projectObservation(createStartedState(), 0);
    expect(normal.potTotal).toBe(3);
    expect(normal.sidePots).toEqual([]);

    const layeredAuthority = formedSidePotDecision();
    const layeredBefore = structuredClone(layeredAuthority);
    const layered = projectObservation(layeredAuthority, 3);
    expect(layered.legalActions.call).toEqual({ pay: 70, to: 70, isAllIn: true });
    expect(layered.potTotal).toBe(162);
    expect(layered.sidePots).toEqual([
      { amount: 84, eligibleSeatIndexes: [0, 3] },
    ]);
    expect(layeredAuthority).toEqual(layeredBefore);
    expect(layeredAuthority.seats.reduce(
      (sum, seat) => sum + seat.stack + seat.committedHand,
      0,
    )).toBe(layeredAuthority.initialChipTotal);
    expect(Object.isFrozen(layeredAuthority)).toBe(false);
    expect(Object.isFrozen(layeredAuthority.seats)).toBe(false);
    expect(Object.isFrozen(layeredAuthority.seats[0])).toBe(false);

    const shortCreated = createTournament(
      config(),
      [{ playerId: 'player-0', seatIndex: 0 }, { playerId: 'player-1', seatIndex: 1 }],
      'short-contest-cap',
    ).state;
    const shortRebalanced: TournamentState = {
      ...shortCreated,
      seats: shortCreated.seats.map((seat) => ({
        ...seat,
        stack: seat.seatIndex === 0 ? 10 : 190,
      })),
    };
    let shortActor = startHand(shortRebalanced, { fixedDeck: createStandardDeck() }).state;
    shortActor = accepted(shortActor, 0, { type: 'raiseTo', amount: 5 });
    shortActor = accepted(shortActor, 1, { type: 'raiseTo', amount: 50 });
    expect(shortActor.seats.reduce(
      (sum, seat) => sum + seat.stack + seat.committedHand,
      0,
    )).toBe(shortActor.initialChipTotal);
    expect(() => assertTournamentInvariants(shortActor)).not.toThrow();
    const short = projectObservation(shortActor, 0);

    expect(short.legalActions.call).toEqual({ pay: 5, to: 10, isAllIn: true });
    expect(short.potTotal).toBe(15);
    expect(short.sidePots).toEqual([]);
  });

  it('fails closed unless the requested viewer is the funded active current betting actor with two cards and legal actions', () => {
    const state = createStartedState();
    const invalidStates: readonly [string, TournamentState, number][] = [
      ['wrong actor', state, 1],
      ['nonbetting phase', { ...state, activeHand: { ...state.activeHand!, phase: 'deal-flop' } }, 0],
      ['missing cards', {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 0 ? { ...seat, holeCards: null } : seat),
      }, 0],
      ['folded actor', {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 0
          ? { ...seat, status: 'folded' as const }
          : seat),
      }, 0],
      ['all-in actor', {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 0
          ? { ...seat, status: 'all-in' as const }
          : seat),
      }, 0],
      ['empty legal set', {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 0
          ? { ...seat, stack: 0 }
          : seat),
      }, 0],
    ];

    for (const [name, invalid, actor] of invalidStates) {
      expect(() => projectObservation(invalid, actor), name).toThrow();
    }
  });

  it('rejects an unknown runtime street even when phase and street are forged to match', () => {
    const state = createStartedState();
    const forged: TournamentState = {
      ...state,
      activeHand: {
        ...state.activeHand!,
        phase: 'evil-street' as never,
        street: 'evil-street' as never,
      },
    };

    expect(() => projectObservation(forged, 0)).toThrow(/betting street|street/i);
  });

  it('rejects a decision observation if a forged current-hand reveal is present', () => {
    const state = createStartedState();
    const opponent = state.seats[1]!;
    if (opponent.holeCards === null) throw new Error('test fixture lacks opponent cards');
    const forgedReveal = {
      type: 'HoleCardsRevealed' as const,
      schemaVersion: 1 as const,
      eventIndex: state.version,
      handId: state.activeHand!.handId,
      seat: opponent.seatIndex,
      cards: [opponent.holeCards[0], opponent.holeCards[1]] as const,
      reason: 'showdown' as const,
    };
    const forged: TournamentState = {
      ...state,
      version: state.version + 1,
      eventLog: [...state.eventLog, forgedReveal],
      activeHand: {
        ...state.activeHand!,
        revealedHoleCardSeats: [opponent.seatIndex],
      },
    };

    expect(() => projectObservation(forged, 0)).toThrow(/reveal|decision/i);
  });
});
