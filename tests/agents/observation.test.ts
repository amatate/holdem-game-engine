import { describe, expect, it } from 'vitest';

import { projectObservation } from '../../src/agents/observation.js';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { replayTournament } from '../../src/core/replay.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  startHand,
  startNextHand,
  type TournamentState,
} from '../../src/core/state.js';

const SAFE_CARD_ERROR = 'Invalid public card data';
const SAFE_OBSERVATION_ERROR = 'Invalid player observation data';

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

function throwingCard(property: 'code' | 'rank' | 'suit') {
  const card: Record<string, unknown> = { code: 'Ah', rank: 14, suit: 'h' };
  Object.defineProperty(card, property, {
    enumerable: true,
    get: () => { throw new Error(`OBSERVATION-${property.toUpperCase()}-GETTER-SEED-SENTINEL`); },
  });
  return card as unknown as ReturnType<typeof parseCard>;
}

function expectSafeCardError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(SAFE_CARD_ERROR);
  expect((caught as Error).message).not.toMatch(/SEED-SENTINEL|OBSERVATION-CARD/);
}

function expectSafeObservationError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(SAFE_OBSERVATION_ERROR);
  expect((caught as Error).message).not.toMatch(/SEED-SENTINEL|PROXY|GETTER/);
}

function sparseArray<T>(length: number, entries: readonly (readonly [number, T])[]): T[] {
  const result = new Array<T>(length);
  for (const [index, value] of entries) result[index] = value;
  return result;
}

function fixedWinningDeck(winnerSeatIndex: 0 | 1) {
  const prefix = winnerSeatIndex === 0
    ? ['Kc', 'Ah', 'Qc', 'Ad', '2c', '3d', '4h', '5s', '6c', '7d', '8c', '9h']
    : ['Ah', 'Kc', 'Ad', 'Qc', '2c', '3d', '4h', '5s', '6c', '7d', '8c', '9h'];
  const standard = createStandardDeck();
  const byCode = new Map(standard.map((card) => [card.code, card] as const));
  return [
    ...prefix.map((code) => byCode.get(code as never)!),
    ...standard.filter((card) => !prefix.includes(card.code)),
  ];
}

function completeRaisedCheckdown(
  tableConfig: TournamentConfig,
  runSeed: string,
  raiseTo: number,
  winnerSeatIndex: 0 | 1,
): TournamentState {
  let state = createTournament(
    tableConfig,
    [{ playerId: 'player-0', seatIndex: 0 }, { playerId: 'player-1', seatIndex: 1 }],
    runSeed,
  ).state;
  state = startHand(state, { fixedDeck: fixedWinningDeck(winnerSeatIndex) }).state;
  state = accepted(state, 0, { type: 'raiseTo', amount: raiseTo });
  state = accepted(state, 1, { type: 'call' });

  for (const street of ['flop', 'turn', 'river'] as const) {
    state = advanceAutomaticPhases(state).state;
    expect(state.activeHand?.street).toBe(street);
    expect(state.activeHand?.currentActorSeat).toBe(1);
    state = accepted(state, 1, { type: 'check' });
    state = accepted(state, 0, { type: 'check' });
  }
  state = advanceAutomaticPhases(state).state;
  expect(state.activeHand?.phase).toBe('hand-complete');
  return state;
}

function expectExactReplayAndInvariants(state: TournamentState): void {
  const gameStarted = state.eventLog[0];
  if (gameStarted?.type !== 'GameStarted') throw new Error('test fixture lacks GameStarted');
  const replayed = replayTournament({
    containsPrivateData: true,
    schemaVersion: 1,
    rulesVersion: state.rulesVersion,
    rngVersion: state.rngVersion,
    shuffleVersion: state.shuffleVersion,
    strategyVersion: state.strategyVersion,
    initialConfig: state.config,
    seats: gameStarted.seats,
    runSeed: state.runSeed,
    events: state.eventLog,
  });

  expect(replayed).toEqual(state);
  expect(() => assertTournamentInvariants(state)).not.toThrow();
  expect(state.seats.reduce((sum, seat) => sum + seat.stack + seat.committedHand, 0))
    .toBe(state.initialChipTotal);
}

function createFlopDecisionState(): TournamentState {
  let state = createStartedState();
  state = accepted(state, 0, { type: 'call' });
  state = accepted(state, 1, { type: 'check' });
  state = advanceAutomaticPhases(state).state;
  expect(state.activeHand?.street).toBe('flop');
  expect(state.activeHand?.currentActorSeat).toBe(1);
  return state;
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

    const shortBlindConfig = config(2, 100, 2, 4);
    const shortBlindCompleted = completeRaisedCheckdown(
      shortBlindConfig,
      'short-blind-seed',
      97,
      1,
    );
    expect(shortBlindCompleted.seats.map((seat) => seat.stack)).toEqual([3, 197]);
    const shortBlind = startNextHand(shortBlindCompleted, {
      fixedDeck: createStandardDeck(),
    }).state;
    expectExactReplayAndInvariants(shortBlind);
    const shortObservation = projectObservation(shortBlind, 1);

    expect(shortBlind.seats.find((seat) => seat.seatIndex === 0)?.committedHand).toBe(3);
    expect(shortObservation.smallBlind).toBe(2);
    expect(shortObservation.bigBlind).toBe(4);
    expect(shortObservation.potTotal).toBe(5);
    expect(shortObservation.legalActions.call).toEqual({ pay: 1, to: 3, isAllIn: false });
  });

  it('derives actor-contestable total without inventing side pots from folded contribution caps', () => {
    const normal = projectObservation(createStartedState(), 0);
    expect(normal.potTotal).toBe(3);
    expect(normal.sidePots).toEqual([]);

    const layeredAuthority = formedSidePotDecision();
    const layeredBefore = structuredClone(layeredAuthority);
    const layered = projectObservation(layeredAuthority, 3);
    expect(layered.legalActions.call).toEqual({ pay: 70, to: 70, isAllIn: true });
    expect(layered.potTotal).toBe(162);
    expect(layered.sidePots).toEqual([]);
    expect(layeredAuthority).toEqual(layeredBefore);
    expect(layeredAuthority.seats.reduce(
      (sum, seat) => sum + seat.stack + seat.committedHand,
      0,
    )).toBe(layeredAuthority.initialChipTotal);
    expect(Object.isFrozen(layeredAuthority)).toBe(false);
    expect(Object.isFrozen(layeredAuthority.seats)).toBe(false);
    expect(Object.isFrozen(layeredAuthority.seats[0])).toBe(false);

    const shortActorCompleted = completeRaisedCheckdown(
      config(),
      'short-contest-cap',
      90,
      0,
    );
    expect(shortActorCompleted.seats.map((seat) => seat.stack)).toEqual([190, 10]);
    let shortActor = startNextHand(shortActorCompleted, {
      fixedDeck: createStandardDeck(),
    }).state;
    shortActor = accepted(shortActor, 1, { type: 'raiseTo', amount: 5 });
    shortActor = accepted(shortActor, 0, { type: 'raiseTo', amount: 50 });
    expectExactReplayAndInvariants(shortActor);
    const short = projectObservation(shortActor, 1);

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

  it.each([
    ['hero marker', [0]],
    ['opponent marker', [1]],
    ['both markers', [0, 1]],
  ] as const)('rejects marker-only revealed cards: %s', (_name, revealedHoleCardSeats) => {
    const state = createStartedState();
    const forged: TournamentState = {
      ...state,
      activeHand: { ...state.activeHand!, revealedHoleCardSeats },
    };

    expect(() => projectObservation(forged, 0)).toThrow(/reveal|decision/i);
  });

  it('normalizes malformed hero and board Cards to one safe non-reflective error', () => {
    const state = createFlopDecisionState();
    const hero = state.seats[1]!;
    if (hero.holeCards === null) throw new Error('test fixture lacks hero cards');
    const invalidValues: readonly unknown[] = [
      undefined,
      null,
      7,
      'OBSERVATION-CARD-STRING-SEED-SENTINEL',
      throwingCard('code'),
      throwingCard('rank'),
      throwingCard('suit'),
      { ...hero.holeCards[0], rank: 13 },
      { ...hero.holeCards[0], suit: 's' },
    ];

    for (const value of invalidValues) {
      const invalidHero: TournamentState = {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 1
          ? {
            ...seat,
            holeCards: [value, hero.holeCards![1]] as unknown as typeof seat.holeCards,
          }
          : seat),
      };
      const invalidBoard: TournamentState = {
        ...state,
        activeHand: {
          ...state.activeHand!,
          board: [value, state.activeHand!.board[1], state.activeHand!.board[2]] as never,
        },
      };
      expectSafeCardError(() => projectObservation(invalidHero, 1));
      expectSafeCardError(() => projectObservation(invalidBoard, 1));
    }
  });

  it('does not access an opponent private Card getter while projecting the hero', () => {
    const state = createFlopDecisionState();
    const hiddenCards = [throwingCard('code'), throwingCard('rank')] as const;
    const guarded: TournamentState = {
      ...state,
      seats: state.seats.map((seat) => seat.seatIndex === 0
        ? { ...seat, holeCards: hiddenCards }
        : seat),
    };

    const observation = projectObservation(guarded, 1);
    expect(JSON.stringify(observation)).not.toContain('GETTER-SEED-SENTINEL');
  });

  it('rejects invalid board growth, duplicate known cards, and hero-board collisions', () => {
    const state = createFlopDecisionState();
    const hero = state.seats[1]!;
    if (hero.holeCards === null) throw new Error('test fixture lacks hero cards');
    const board = state.activeHand!.board;
    const invalidStates: TournamentState[] = [
      { ...state, activeHand: { ...state.activeHand!, board: board.slice(0, 1) } },
      { ...state, activeHand: { ...state.activeHand!, board: [board[0]!, board[0]!, board[2]!] } },
      { ...state, activeHand: { ...state.activeHand!, board: [hero.holeCards[0], board[1]!, board[2]!] } },
      {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 1
          ? { ...seat, holeCards: [hero.holeCards![0], hero.holeCards![0]] }
          : seat),
      },
    ];

    for (const invalid of invalidStates) {
      expectSafeCardError(() => projectObservation(invalid, 1));
    }
  });

  it('rejects sparse hero-hole and board batches with the fixed card error', () => {
    const preflop = createStartedState();
    const preflopHero = preflop.seats[0]!;
    if (preflopHero.holeCards === null) throw new Error('test fixture lacks hero cards');
    const sparseHole = sparseArray(2, [[0, preflopHero.holeCards[0]]]);
    const sparseHeroState: TournamentState = {
      ...preflop,
      seats: preflop.seats.map((seat) => seat.seatIndex === 0
        ? { ...seat, holeCards: sparseHole as never }
        : seat),
    };

    const flopState = createFlopDecisionState();
    const board = flopState.activeHand!.board;
    const sparseBoard = sparseArray(3, [[0, board[0]!], [2, board[2]!]]);
    const sparseBoardState: TournamentState = {
      ...flopState,
      activeHand: { ...flopState.activeHand!, board: sparseBoard },
    };

    expectSafeCardError(() => projectObservation(sparseHeroState, 0));
    expectSafeCardError(() => projectObservation(sparseBoardState, 1));
  });

  it('ignores overridden hero-hole and board methods and clones canonical cards', () => {
    const state = createFlopDecisionState();
    const hero = state.seats[1]!;
    if (hero.holeCards === null) throw new Error('test fixture lacks hero cards');
    const holeCards = [...hero.holeCards] as unknown as typeof hero.holeCards;
    const board = [...state.activeHand!.board];
    const poison = () => { throw new Error('OBSERVATION-CARD-METHOD-SEED-SENTINEL'); };
    for (const cards of [holeCards, board]) {
      Object.defineProperty(cards, 'map', { value: poison });
      Object.defineProperty(cards, 'filter', { value: poison });
      Object.defineProperty(cards, Symbol.iterator, { value: poison });
    }
    const guarded: TournamentState = {
      ...state,
      seats: state.seats.map((seat) => seat.seatIndex === 1
        ? { ...seat, holeCards }
        : seat),
      activeHand: { ...state.activeHand!, board },
    };

    const observation = projectObservation(guarded, 1);

    expect(observation.holeCards).toEqual(hero.holeCards);
    expect(observation.board).toEqual(state.activeHand!.board);
    expect(JSON.stringify(observation)).not.toContain('SEED-SENTINEL');
    expect(Object.isFrozen(holeCards)).toBe(false);
    expect(Object.isFrozen(board)).toBe(false);
    expect(Object.isFrozen(board[0])).toBe(false);
  });

  it('selects the hero by seatIndex even when authority seats.find returns the opponent', () => {
    const state = createStartedState();
    const hero = state.seats[0]!;
    const opponent = state.seats[1]!;
    if (hero.holeCards === null || opponent.holeCards === null) {
      throw new Error('test fixture lacks private cards');
    }
    const seats = [...state.seats];
    Object.defineProperty(seats, 'find', { value: () => opponent });
    const guarded: TournamentState = { ...state, seats };

    const observation = projectObservation(guarded, 0);

    expect(observation.holeCards).toEqual(hero.holeCards);
    expect(JSON.stringify(observation)).not.toContain(opponent.holeCards[0].code);
    expect(JSON.stringify(observation)).not.toContain(opponent.holeCards[1].code);
    expect(Object.isFrozen(opponent)).toBe(false);
    expect(Object.isFrozen(opponent.holeCards[0])).toBe(false);
  });

  it('never accepts raw authority seats returned by an overridden seats.map', () => {
    const state = createStartedState();
    const opponent = state.seats[1]!;
    if (opponent.holeCards === null) throw new Error('test fixture lacks opponent cards');
    const seats = [...state.seats];
    Object.defineProperty(seats, 'map', { value: () => [opponent] });
    const guarded: TournamentState = { ...state, seats };

    const observation = projectObservation(guarded, 0);

    expect(observation.seats).toHaveLength(2);
    expect(observation.seats.every((seat) => seat.revealedHoleCards === null)).toBe(true);
    expect(JSON.stringify(observation.seats)).not.toContain(opponent.holeCards[0].code);
    expect(Object.isFrozen(opponent)).toBe(false);
    expect(Object.isFrozen(opponent.holeCards)).toBe(false);
    expect(Object.isFrozen(opponent.holeCards[0])).toBe(false);
  });

  it.each(['some', 'reduce', 'iterator'] as const)(
    'does not invoke authority seats.%s while projecting',
    (method) => {
      const state = createStartedState();
      const seats = [...state.seats];
      const poison = () => { throw new Error(`SEATS-${method.toUpperCase()}-SEED-SENTINEL`); };
      Object.defineProperty(
        seats,
        method === 'iterator' ? Symbol.iterator : method,
        { value: poison },
      );
      const guarded: TournamentState = { ...state, seats };

      const observation = projectObservation(guarded, 0);

      expect(observation.actorSeatIndex).toBe(0);
      expect(observation.seats).toHaveLength(2);
      expect(JSON.stringify(observation)).not.toContain('SEED-SENTINEL');
      expect(Object.isFrozen(seats)).toBe(false);
    },
  );

  it.each(['filter', 'some', 'second-filter', 'iterator'] as const)(
    'does not invoke authority-derived eventLog.%s methods',
    (method) => {
      const state = createStartedState();
      const baseline = projectObservation(state, 0);
      const eventLog = [...state.eventLog];
      const currentEvents = eventLog.filter((event) =>
        'handId' in event && event.handId === state.activeHand!.handId);
      const poison = () => { throw new Error(`EVENTLOG-${method.toUpperCase()}-SEED-SENTINEL`); };

      if (method === 'filter') {
        Object.defineProperty(eventLog, 'filter', { value: poison });
      } else {
        Object.defineProperty(eventLog, 'filter', { value: () => currentEvents });
        Object.defineProperty(
          currentEvents,
          method === 'iterator' ? Symbol.iterator : method === 'second-filter' ? 'filter' : 'some',
          { value: poison },
        );
      }
      const guarded: TournamentState = { ...state, eventLog };

      const observation = projectObservation(guarded, 0);

      expect(observation).toEqual(baseline);
      expect(JSON.stringify(observation)).not.toContain('SEED-SENTINEL');
      expect(Object.isFrozen(eventLog)).toBe(false);
    },
  );

  it('cannot hide a current-hand reveal through an overridden eventLog.filter', () => {
    const state = createStartedState();
    const opponent = state.seats[1]!;
    if (opponent.holeCards === null) throw new Error('test fixture lacks opponent cards');
    const reveal = {
      type: 'HoleCardsRevealed' as const,
      schemaVersion: 1 as const,
      eventIndex: state.version,
      handId: state.activeHand!.handId,
      seat: opponent.seatIndex,
      cards: opponent.holeCards,
      reason: 'showdown' as const,
    };
    const eventLog = [...state.eventLog, reveal];
    Object.defineProperty(eventLog, 'filter', {
      value: () => eventLog.slice(0, -1),
    });
    const guarded: TournamentState = {
      ...state,
      version: state.version + 1,
      eventLog,
    };

    expect(() => projectObservation(guarded, 0)).toThrow(/reveal|decision/i);
  });

  it('rejects sparse or version-mismatched event logs with one observation error', () => {
    const state = createStartedState();
    const deckEventIndex = state.eventLog.findIndex((event) => event.type === 'DeckPrepared');
    expect(deckEventIndex).toBeGreaterThanOrEqual(0);
    const sparseEventLog = new Array<TournamentState['eventLog'][number]>(state.eventLog.length);
    for (let index = 0; index < state.eventLog.length; index += 1) {
      if (index !== deckEventIndex) sparseEventLog[index] = state.eventLog[index]!;
    }

    expectSafeObservationError(() => projectObservation({
      ...state,
      eventLog: sparseEventLog,
    }, 0));
    expectSafeObservationError(() => projectObservation({
      ...state,
      version: state.version + 1,
    }, 0));
  });

  it('normalizes state, seat, and event Proxy getter failures to one observation error', () => {
    const state = createStartedState();
    const stateProxy = new Proxy(state, {
      get(target, property, receiver) {
        if (property === 'activeHand') throw new Error('STATE-PROXY-SEED-SENTINEL');
        return Reflect.get(target, property, receiver);
      },
    });
    const seatProxy = new Proxy(state.seats[0]!, {
      get(target, property, receiver) {
        if (property === 'stack') throw new Error('SEAT-PROXY-SEED-SENTINEL');
        return Reflect.get(target, property, receiver);
      },
    });
    const eventIndex = state.eventLog.findIndex((event) => event.type === 'BlindPosted');
    const eventProxy = new Proxy(state.eventLog[eventIndex]!, {
      get(target, property, receiver) {
        if (property === 'type') throw new Error('EVENT-PROXY-SEED-SENTINEL');
        return Reflect.get(target, property, receiver);
      },
    });
    const eventLog = [...state.eventLog];
    eventLog[eventIndex] = eventProxy;
    const hero = state.seats[0]!;
    if (hero.holeCards === null) throw new Error('test fixture lacks hero cards');
    const holeCardsProxy = new Proxy([...hero.holeCards], {
      get(target, property, receiver) {
        if (property === 'length') throw new Error('HOLE-BATCH-PROXY-SEED-SENTINEL');
        return Reflect.get(target, property, receiver);
      },
    });

    expectSafeObservationError(() => projectObservation(stateProxy, 0));
    expectSafeObservationError(() => projectObservation({
      ...state,
      seats: [seatProxy, state.seats[1]!],
    }, 0));
    expectSafeObservationError(() => projectObservation({ ...state, eventLog }, 0));
    expectSafeObservationError(() => projectObservation({
      ...state,
      seats: state.seats.map((seat) => seat.seatIndex === 0
        ? { ...seat, holeCards: holeCardsProxy as never }
        : seat),
    }, 0));
  });

  it('rejects object-valued and non-safe known observation fields without reflecting payloads', () => {
    const state = createStartedState();
    const secret = { runSeed: 'OBSERVATION-SCALAR-SEED-SENTINEL' };
    const scalarCases: readonly TournamentState[] = [
      { ...state, handNumber: secret as never },
      {
        ...state,
        activeHand: {
          ...state.activeHand!,
          positions: { ...state.activeHand!.positions, buttonPosition: secret as never },
        },
      },
      {
        ...state,
        seats: state.seats.map((seat) => seat.seatIndex === 0
          ? { ...seat, stack: secret as never }
          : seat),
      },
      {
        ...state,
        eventLog: state.eventLog.map((event) => event.type === 'BlindPosted'
          ? { ...event, amount: secret as never }
          : event),
      },
    ];

    for (const invalid of scalarCases) {
      expectSafeObservationError(() => projectObservation(invalid, 0));
    }
    expect(Object.isFrozen(secret)).toBe(false);
  });

  it('reads dynamic event enum getters only once while snapshotting history', () => {
    const state = createStartedState();
    const blindIndex = state.eventLog.findIndex((event) => event.type === 'BlindPosted');
    const secret = { runSeed: 'DYNAMIC-HISTORY-ENUM-SEED-SENTINEL' };
    let kindReads = 0;
    const dynamicBlind = new Proxy(state.eventLog[blindIndex]!, {
      get(target, property, receiver) {
        if (property === 'kind') {
          kindReads += 1;
          return kindReads === 1 ? 'small' : secret;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const eventLog = [...state.eventLog];
    eventLog[blindIndex] = dynamicBlind;

    const observation = projectObservation({ ...state, eventLog }, 0);

    expect(observation.actionHistory[0]).toEqual({
      type: 'blindPosted',
      seatIndex: 0,
      kind: 'small',
      amount: 1,
      allIn: false,
    });
    expect(kindReads).toBe(1);
    expect(JSON.stringify(observation)).not.toContain('SEED-SENTINEL');
    expect(Object.isFrozen(secret)).toBe(false);
  });

  it('snapshots the authority seat-array length once before dense scanning', () => {
    const state = createStartedState();
    let lengthReads = 0;
    const seats = new Proxy([...state.seats], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 0;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const observation = projectObservation({ ...state, seats }, 0);

    expect(observation.seats).toHaveLength(2);
    expect(observation.actorSeatIndex).toBe(0);
    expect(lengthReads).toBe(1);
  });

  it('rejects fractional seat lengths and non-safe reveal-marker lengths', () => {
    const state = createStartedState();
    const extraSeat = {
      ...state.seats[1]!,
      playerId: 'player-2',
      seatIndex: 2,
      holeCards: null,
      committedStreet: 0,
      committedHand: 0,
      lastActedAtBetTo: null,
    };
    const fractionalSeats = new Proxy([...state.seats, extraSeat], {
      get(target, property, receiver) {
        return property === 'length' ? 2.5 : Reflect.get(target, property, receiver);
      },
    });

    expectSafeObservationError(() => projectObservation({
      ...state,
      seats: fractionalSeats,
    }, 0));

    for (const forgedLength of [Number.NaN, -1]) {
      const markers = new Proxy([1], {
        get(target, property, receiver) {
          return property === 'length' ? forgedLength : Reflect.get(target, property, receiver);
        },
      });
      expectSafeObservationError(() => projectObservation({
        ...state,
        activeHand: { ...state.activeHand!, revealedHoleCardSeats: markers },
      }, 0));
    }
  });

  it('never reads an opponent holeCards container getter', () => {
    const state = createStartedState();
    const opponent = new Proxy(state.seats[1]!, {
      get(target, property, receiver) {
        if (property === 'holeCards') {
          throw new Error('OPPONENT-HOLE-CONTAINER-SEED-SENTINEL');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const guarded: TournamentState = { ...state, seats: [state.seats[0]!, opponent] };

    const observation = projectObservation(guarded, 0);

    expect(observation.actorSeatIndex).toBe(0);
    expect(JSON.stringify(observation)).not.toContain('SEED-SENTINEL');
  });

  it('reads the matched hero holeCards container exactly once', () => {
    const state = createStartedState();
    const hero = state.seats[0]!;
    const opponent = state.seats[1]!;
    if (hero.holeCards === null || opponent.holeCards === null) {
      throw new Error('test fixture lacks private cards');
    }
    let holeReads = 0;
    const dynamicHero = new Proxy(hero, {
      get(target, property, receiver) {
        if (property === 'holeCards') {
          holeReads += 1;
          return holeReads === 1 ? hero.holeCards : opponent.holeCards;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const observation = projectObservation({
      ...state,
      seats: [dynamicHero, opponent],
    }, 0);

    expect(observation.holeCards).toEqual(hero.holeCards);
    expect(holeReads).toBe(1);
    expect(JSON.stringify(observation)).not.toContain(opponent.holeCards[0].code);
    expect(JSON.stringify(observation)).not.toContain(opponent.holeCards[1].code);
    expect(Object.isFrozen(opponent.holeCards[0])).toBe(false);
  });
});
