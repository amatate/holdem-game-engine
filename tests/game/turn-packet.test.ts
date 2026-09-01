import { describe, expect, it } from 'vitest';

import type { PlayerObservationV1 } from '../../src/agents/types.js';
import { parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import {
  projectEventsForViewer,
  type PublicGameEvent,
} from '../../src/core/public-events.js';
import type { Participant } from '../../src/game/participant.js';
import { createTournamentDriver } from '../../src/game/tournament-driver.js';
import {
  buildActionPanel,
  createClassicDecisionPacket,
  createClassicGameResultPacket,
  createClassicHandResultPacket,
  createDecisionKey,
  type ClassicDecisionPacket,
  type TurnPacket,
} from '../../src/game/turn-packet.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;
type ClassicPrivateEventsAreExactlyEmpty = Assert<Equal<
  ClassicDecisionPacket['privateEventsSinceLastPacket'],
  readonly []
>>;
const classicPrivateEventsAreExactlyEmpty: ClassicPrivateEventsAreExactlyEmpty = true;
void classicPrivateEventsAreExactlyEmpty;
type ClassicUnionPrivateEventsAreExactlyEmpty = Assert<Equal<
  Extract<TurnPacket, { kind: 'decision' }>['privateEventsSinceLastPacket'],
  readonly []
>>;
const classicUnionPrivateEventsAreExactlyEmpty: ClassicUnionPrivateEventsAreExactlyEmpty = true;
void classicUnionPrivateEventsAreExactlyEmpty;

const packetConfig: TournamentConfig = {
  maxSeats: 2,
  startingStack: 100,
  handsPerLevel: 100,
  blindLevels: [{ smallBlind: 10, bigBlind: 20 }],
  initialButtonSeat: 0,
};

function passiveParticipant(playerId: string): Participant {
  return {
    playerId,
    decide: async ({ observation }) => {
      if (observation.legalActions.check) return { action: { type: 'check' } };
      if (observation.legalActions.call !== null) return { action: { type: 'call' } };
      return { action: { type: 'fold' } };
    },
  };
}

async function createUncommittedCandidate() {
  const driver = createTournamentDriver({
    config: packetConfig,
    runSeed: 'TURN-PACKET-RUN-SEED-SENTINEL',
    seats: [
      { playerId: 'hero', seatIndex: 0 },
      { playerId: 'villain', seatIndex: 1 },
    ],
    participants: [null, passiveParticipant('villain')],
    pauseSeatIndexes: [0],
  });
  return await driver.prepareOpen();
}

async function createCompletedCandidates() {
  const completedConfig: TournamentConfig = {
    ...packetConfig,
    startingStack: 20,
  };
  const completedSeats = [
    { playerId: 'hero', seatIndex: 0 },
    { playerId: 'villain', seatIndex: 1 },
  ] as const;
  const driver = createTournamentDriver({
    config: completedConfig,
    runSeed: 'TURN-PACKET-COMPLETED-SEED-SENTINEL',
    seats: completedSeats,
    participants: [null, passiveParticipant('villain')],
    pauseSeatIndexes: [0],
  });
  const opened = await driver.prepareOpen();
  driver.commitPreparedTransition(opened);
  const hand = await driver.preparePausedAction(0, { type: 'call' }, 0);
  if (hand.candidateBoundary.kind !== 'hand-complete') {
    throw new Error('fixture must pause after the completed hand');
  }
  driver.commitPreparedTransition(hand);
  const game = await driver.prepareContinueAfterHand();
  if (game.candidateBoundary.kind !== 'game-complete') {
    throw new Error('fixture must end the game');
  }
  return { completedSeats, hand, game };
}

function normalCallObservation(): PlayerObservationV1 {
  return {
    schemaVersion: 1,
    handId: 'hand/3',
    handNumber: 3,
    decisionIndex: 4,
    actorSeatIndex: 0,
    street: 'preflop',
    holeCards: [parseCard('Ah'), parseCard('Kd')],
    board: [],
    buttonPosition: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    smallBlind: 10,
    bigBlind: 20,
    potTotal: 50,
    sidePots: [],
    seats: [
      {
        playerId: 'hero',
        seatIndex: 0,
        stack: 90,
        status: 'active',
        committedStreet: 10,
        committedHand: 10,
        revealedHoleCards: null,
      },
      {
        playerId: 'villain-1',
        seatIndex: 1,
        stack: 80,
        status: 'active',
        committedStreet: 20,
        committedHand: 20,
        revealedHoleCards: null,
      },
      {
        playerId: 'villain-2',
        seatIndex: 2,
        stack: 80,
        status: 'active',
        committedStreet: 20,
        committedHand: 20,
        revealedHoleCards: null,
      },
    ],
    actionHistory: [],
    legalActions: {
      fold: true,
      check: false,
      call: { pay: 10, to: 20, isAllIn: false },
      raiseTo: { min: 40, max: 100 },
      allIn: { to: 100, mode: 'fullRaise' },
    },
  };
}

function expectSafeTurnPacketError(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe('Invalid turn packet data');
  expect((caught as Error).message).not.toMatch(/SEED-SENTINEL|GETTER|PROXY/);
}

function isRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((child) => isRecursivelyFrozen(child, seen));
}

function poisonArrayMethods<T>(values: readonly T[]): T[] {
  const clone: T[] = [];
  for (let index = 0; index < values.length; index += 1) clone.push(values[index]!);
  const poison = () => { throw new Error('ARRAY-METHOD-SEED-SENTINEL'); };
  Object.defineProperties(clone, {
    map: { value: poison },
    filter: { value: poison },
    values: { value: poison },
    [Symbol.iterator]: { value: poison },
  });
  return clone;
}

describe('classic action panel', () => {
  it('renders the exact normal-call commands and contribution totals', () => {
    expect(buildActionPanel(normalCallObservation())).toEqual({
      currentBetTo: 20,
      facingBet: true,
      tableCommittedTotal: 50,
      heroContestableTotal: 60,
      commands: [
        { kind: 'fixed', inputs: ['f'], label: '弃牌', intent: { type: 'fold' } },
        { kind: 'fixed', inputs: ['c'], label: '跟注 10', intent: { type: 'call' } },
        {
          kind: 'raise-range',
          inputPattern: 'r <金额>',
          label: '加注到',
          minimum: 40,
          maximum: 100,
        },
        { kind: 'fixed', inputs: ['a'], label: '全下 100', intent: { type: 'allIn' } },
      ],
    });
  });

  it('accepts x and c for check and labels an opening raise as a bet', () => {
    const observation: PlayerObservationV1 = {
      ...normalCallObservation(),
      potTotal: 0,
      seats: normalCallObservation().seats.map((seat) => ({
        ...seat,
        stack: 100,
        committedStreet: 0,
        committedHand: 0,
      })),
      legalActions: {
        fold: false,
        check: true,
        call: null,
        raiseTo: { min: 20, max: 100 },
        allIn: { to: 100, mode: 'fullBet' },
      },
    };

    expect(buildActionPanel(observation).commands).toEqual([
      { kind: 'fixed', inputs: ['x', 'c'], label: '过牌', intent: { type: 'check' } },
      {
        kind: 'raise-range',
        inputPattern: 'r <金额>',
        label: '下注到',
        minimum: 20,
        maximum: 100,
      },
      { kind: 'fixed', inputs: ['a'], label: '全下 100', intent: { type: 'allIn' } },
    ]);
  });

  it('shows a short call-mode all-in only as c and keeps the table bet target', () => {
    const base = normalCallObservation();
    const observation: PlayerObservationV1 = {
      ...base,
      potTotal: 210,
      seats: [
        { ...base.seats[0]!, stack: 90, committedStreet: 10, committedHand: 10 },
        { ...base.seats[1]!, stack: 800, committedStreet: 200, committedHand: 200 },
        { ...base.seats[2]!, stack: 800, committedStreet: 200, committedHand: 200 },
      ],
      legalActions: {
        fold: true,
        check: false,
        call: { pay: 90, to: 100, isAllIn: true },
        raiseTo: null,
        allIn: { to: 100, mode: 'call' },
      },
    };

    const panel = buildActionPanel(observation);

    expect(panel.currentBetTo).toBe(200);
    expect(observation.legalActions.call?.pay).toBe(90);
    expect(panel.heroContestableTotal).toBe(300);
    expect(panel.commands).toEqual([
      { kind: 'fixed', inputs: ['f'], label: '弃牌', intent: { type: 'fold' } },
      { kind: 'fixed', inputs: ['c'], label: '跟注 90（全下）', intent: { type: 'call' } },
    ]);
  });

  it('caps a four-way all-in contest at the hero post-call contribution', () => {
    const base = normalCallObservation();
    const observation: PlayerObservationV1 = {
      ...base,
      potTotal: 350,
      seats: [
        { ...base.seats[0]!, stack: 50, committedStreet: 50, committedHand: 50 },
        { ...base.seats[1]!, stack: 900, committedStreet: 100, committedHand: 100 },
        { ...base.seats[2]!, stack: 800, committedStreet: 200, committedHand: 200 },
        {
          playerId: 'villain-3',
          seatIndex: 3,
          stack: 800,
          status: 'active',
          committedStreet: 200,
          committedHand: 200,
          revealedHoleCards: null,
        },
      ],
      legalActions: {
        fold: true,
        check: false,
        call: { pay: 50, to: 100, isAllIn: true },
        raiseTo: null,
        allIn: { to: 100, mode: 'call' },
      },
    };

    const panel = buildActionPanel(observation);

    expect(panel.tableCommittedTotal).toBe(550);
    expect(panel.heroContestableTotal).toBe(400);
  });

  it('converts hostile authority getters to the fixed safe error', () => {
    const observation = normalCallObservation();
    const hostileSeat = { ...observation.seats[1]! } as Record<string, unknown>;
    Object.defineProperty(hostileSeat, 'committedHand', {
      enumerable: true,
      get: () => { throw new Error('GETTER-SEED-SENTINEL'); },
    });
    const hostile = {
      ...observation,
      seats: [observation.seats[0], hostileSeat, observation.seats[2]],
    } as unknown as PlayerObservationV1;

    expectSafeTurnPacketError(() => buildActionPanel(hostile));
  });

  it('uses dense numeric seat access without authority-owned array methods', () => {
    const observation = normalCallObservation();
    const seats = [...observation.seats];
    const poison = () => { throw new Error('ARRAY-METHOD-SEED-SENTINEL'); };
    Object.defineProperties(seats, {
      map: { value: poison },
      filter: { value: poison },
      values: { value: poison },
      [Symbol.iterator]: { value: poison },
    });

    expect(buildActionPanel({ ...observation, seats })).toMatchObject({
      currentBetTo: 20,
      tableCommittedTotal: 50,
    });

    const sparseSeats = new Array(observation.seats.length);
    sparseSeats[0] = observation.seats[0];
    sparseSeats[2] = observation.seats[2];
    expectSafeTurnPacketError(() => buildActionPanel({
      ...observation,
      seats: sparseSeats,
    } as PlayerObservationV1));
  });

  it('rejects unsafe contribution arithmetic instead of emitting corrupt totals', () => {
    const observation = normalCallObservation();
    const unsafe = {
      ...observation,
      seats: [
        { ...observation.seats[0]!, committedHand: Number.MAX_SAFE_INTEGER },
        { ...observation.seats[1]!, committedHand: 1 },
        observation.seats[2],
      ],
    } as PlayerObservationV1;

    expectSafeTurnPacketError(() => buildActionPanel(unsafe));
  });

  it('rejects malformed legal-action amounts instead of rendering them', () => {
    const observation = normalCallObservation();
    const malformed = {
      ...observation,
      legalActions: {
        ...observation.legalActions,
        raiseTo: { min: -40, max: 100 },
      },
    } as PlayerObservationV1;

    expectSafeTurnPacketError(() => buildActionPanel(malformed));
  });

  it('rejects an observation outside the supported dense seat range', () => {
    const observation = normalCallObservation();
    const seats = [...observation.seats];
    while (seats.length < 7) {
      const seatIndex = seats.length;
      seats.push({
        ...observation.seats[1]!,
        playerId: `villain-${seatIndex}`,
        seatIndex,
      });
    }

    expectSafeTurnPacketError(() => buildActionPanel({ ...observation, seats }));
  });
});

describe('classic decision packet identity', () => {
  it('formats the hand, seat and decision indexes without ambiguity', () => {
    expect(createDecisionKey(3, 0, 4)).toBe('hand/3/seat/0/decision/4');
  });

  it('rejects malformed decision-key indexes with the fixed safe error', () => {
    expectSafeTurnPacketError(() => createDecisionKey(3, -1, 4));
  });

  it('rejects physical seat index 6 with the fixed safe error', () => {
    expectSafeTurnPacketError(() => createDecisionKey(1, 6, 0));
  });

  it('rejects an extreme safe-integer seat index with the fixed safe error', () => {
    expectSafeTurnPacketError(() => createDecisionKey(1, Number.MAX_SAFE_INTEGER, 0));
  });

  it('projects an uncommitted candidate over a half-open core version range', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const state = prepared.candidateAuthorityState;
    const fromCoreVersion = 2;

    const packet = createClassicDecisionPacket({
      state,
      boundary: prepared.candidateBoundary,
      humanSeatIndex: 0,
      packetIndex: 7,
      fromCoreVersion,
    });

    expect(packet.schemaVersion).toBe(1);
    expect(packet.kind).toBe('decision');
    expect(packet.packetIndex).toBe(7);
    expect(packet.decisionKey).toBe('hand/1/seat/0/decision/0');
    expect(packet.coreEventRange).toEqual({
      fromVersionInclusive: fromCoreVersion,
      toVersionExclusive: state.version,
    });
    expect(packet.viewerEventsSinceLastPacket).toEqual(projectEventsForViewer(
      state.eventLog.slice(fromCoreVersion, state.version),
      0,
    ));
    expect(packet.privateEventsSinceLastPacket).toEqual([]);
    expect(packet.abilities).toBeNull();
    expect(packet.observation.handId).toBe('hand/1');
  });

  it('rejects a boundary observation that does not match the candidate state', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const forgedBoundary = {
      ...prepared.candidateBoundary,
      observation: {
        ...prepared.candidateBoundary.observation,
        decisionIndex: prepared.candidateBoundary.observation.decisionIndex + 1,
      },
    };

    expectSafeTurnPacketError(() => createClassicDecisionPacket({
      state: prepared.candidateAuthorityState,
      boundary: forgedBoundary,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: 0,
    }));
  });

  it('returns fresh deeply frozen viewer-safe clones without authority secrets', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const input = {
      state: prepared.candidateAuthorityState,
      boundary: prepared.candidateBoundary,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: 0,
    } as const;

    const first = createClassicDecisionPacket(input);
    const second = createClassicDecisionPacket(input);
    const opponentCards = prepared.candidateAuthorityState.seats[1]!.holeCards;
    if (opponentCards === null) throw new Error('fixture requires opponent cards');
    const heroCards = prepared.candidateAuthorityState.seats[0]!.holeCards;
    if (heroCards === null) throw new Error('fixture requires hero cards');
    const serialized = JSON.stringify(first);

    expect(first).not.toBe(second);
    expect(first.observation).not.toBe(prepared.candidateBoundary.observation);
    expect(first.observation).not.toBe(second.observation);
    expect(first.observation.holeCards[0]).not.toBe(heroCards[0]);
    expect(first.observation.holeCards[1]).not.toBe(heroCards[1]);
    expect(first.viewerEventsSinceLastPacket).not.toBe(second.viewerEventsSinceLastPacket);
    expect(isRecursivelyFrozen(first)).toBe(true);
    expect(first.observation.handId).toBe('hand/1');
    expect(serialized).not.toContain('fullOrderedDeck');
    expect(serialized).not.toContain('runSeed');
    expect(serialized).not.toContain('burnedCards');
    expect(serialized).not.toContain('TURN-PACKET-RUN-SEED-SENTINEL');
    expect(serialized).not.toContain(opponentCards[0].code);
    expect(serialized).not.toContain(opponentCards[1].code);
  });

  it('projects dense authority arrays without calling poisoned methods or iterators', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const observation = prepared.candidateBoundary.observation;
    const poisonedBoundary = {
      ...prepared.candidateBoundary,
      observation: {
        ...observation,
        seats: poisonArrayMethods(observation.seats),
      },
    };
    const poisonedState = {
      ...prepared.candidateAuthorityState,
      seats: poisonArrayMethods(prepared.candidateAuthorityState.seats),
      eventLog: poisonArrayMethods(prepared.candidateAuthorityState.eventLog),
    };

    expect(createClassicDecisionPacket({
      state: poisonedState,
      boundary: poisonedBoundary,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: 0,
    }).decisionKey).toBe('hand/1/seat/0/decision/0');
  });

  it('represents an already-delivered core prefix as an empty half-open range', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const version = prepared.candidateAuthorityState.version;

    const packet = createClassicDecisionPacket({
      state: prepared.candidateAuthorityState,
      boundary: prepared.candidateBoundary,
      humanSeatIndex: 0,
      packetIndex: 1,
      fromCoreVersion: version,
    });

    expect(packet.coreEventRange).toEqual({
      fromVersionInclusive: version,
      toVersionExclusive: version,
    });
    expect(packet.viewerEventsSinceLastPacket).toEqual([]);
  });

  it('rejects a core cursor beyond the uncommitted candidate version', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const boundary = prepared.candidateBoundary;

    expectSafeTurnPacketError(() => createClassicDecisionPacket({
      state: prepared.candidateAuthorityState,
      boundary,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: prepared.candidateAuthorityState.version + 1,
    }));
  });

  it('rejects a packet viewer that is not the decision boundary seat', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const boundary = prepared.candidateBoundary;

    expectSafeTurnPacketError(() => createClassicDecisionPacket({
      state: prepared.candidateAuthorityState,
      boundary,
      humanSeatIndex: 1,
      packetIndex: 0,
      fromCoreVersion: 0,
    }));
  });

  it('rejects a sparse authority event log with the fixed safe error', async () => {
    const prepared = await createUncommittedCandidate();
    if (prepared.candidateBoundary.kind !== 'decision') {
      throw new Error('fixture must pause at a decision');
    }
    const boundary = prepared.candidateBoundary;
    const source = prepared.candidateAuthorityState.eventLog;
    const sparse = new Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      if (index !== 2) sparse[index] = source[index];
    }

    expectSafeTurnPacketError(() => createClassicDecisionPacket({
      state: { ...prepared.candidateAuthorityState, eventLog: sparse },
      boundary,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: 0,
    }));
  });
});

describe('classic result packet variants', () => {
  it('keeps full-hand summary history separate from the half-open delivery increment', async () => {
    const { completedSeats, hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const handStart = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const handEnd = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    if (handStart < 0 || handEnd < handStart) throw new Error('fixture hand interval missing');
    const currentHandViewerEvents = projectEventsForViewer(
      state.eventLog.slice(handStart, handEnd + 1),
      0,
    );
    const fromCoreVersion = state.version - 4;

    const packet = createClassicHandResultPacket({
      state,
      boundary,
      seats: completedSeats,
      humanSeatIndex: 0,
      packetIndex: 8,
      fromCoreVersion,
      currentHandViewerEvents,
    });

    expect(packet).toMatchObject({
      schemaVersion: 1,
      kind: 'hand-result',
      packetIndex: 8,
      handNumber: 1,
      coreEventRange: {
        fromVersionInclusive: fromCoreVersion,
        toVersionExclusive: state.version,
      },
      privateEventsSinceLastPacket: [],
    });
    expect(packet.viewerEventsSinceLastPacket).toEqual(projectEventsForViewer(
      state.eventLog.slice(fromCoreVersion, state.version),
      0,
    ));
    expect(packet.handResult.seats[0]!.holeCards).toHaveLength(2);
    expect(packet.handResult.handNumber).toBe(1);
    expect(isRecursivelyFrozen(packet)).toBe(true);
  });

  it('builds a frozen game result from the explicit game-complete candidate', async () => {
    const { hand, game } = await createCompletedCandidates();
    if (game.candidateBoundary.kind !== 'game-complete') throw new Error('fixture mismatch');
    const state = game.candidateAuthorityState;

    const packet = createClassicGameResultPacket({
      state,
      boundary: game.candidateBoundary,
      humanSeatIndex: 0,
      packetIndex: 9,
      fromCoreVersion: hand.candidateAuthorityState.version,
    });

    expect(packet).toEqual({
      schemaVersion: 1,
      kind: 'game-result',
      packetIndex: 9,
      winnerSeatIndex: game.candidateBoundary.winnerSeatIndex,
      finalStacks: state.seats.map(({ seatIndex, stack }) => ({ seatIndex, stack })),
      coreEventRange: {
        fromVersionInclusive: hand.candidateAuthorityState.version,
        toVersionExclusive: state.version,
      },
      viewerEventsSinceLastPacket: projectEventsForViewer(
        state.eventLog.slice(hand.candidateAuthorityState.version, state.version),
        0,
      ),
      privateEventsSinceLastPacket: [],
    });
    expect(isRecursivelyFrozen(packet)).toBe(true);
    expect(JSON.stringify(packet)).not.toContain('TURN-PACKET-COMPLETED-SEED-SENTINEL');
  });

  it('assigns own cards to a nonzero human seat without filling an unrevealed NPC row', async () => {
    const physicalSeats = [
      { playerId: 'villain', seatIndex: 0 },
      { playerId: 'hero', seatIndex: 1 },
    ] as const;
    const aggressiveVillain: Participant = {
      playerId: 'villain',
      decide: async ({ observation }) => {
        const range = observation.legalActions.raiseTo;
        if (range !== null) return { action: { type: 'raiseTo', amount: range.min } };
        if (observation.legalActions.call !== null) return { action: { type: 'call' } };
        return { action: { type: 'check' } };
      },
    };
    const driver = createTournamentDriver({
      config: packetConfig,
      runSeed: 'TURN-PACKET-NONZERO-HUMAN-SEED-SENTINEL',
      seats: physicalSeats,
      participants: [aggressiveVillain, null],
      pauseSeatIndexes: [1],
    });
    const opened = await driver.prepareOpen();
    driver.commitPreparedTransition(opened);
    const hand = await driver.preparePausedAction(1, { type: 'fold' }, 0);
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const state = hand.candidateAuthorityState;
    const handStart = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const handEnd = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const fullViewerEvents = projectEventsForViewer(
      state.eventLog.slice(handStart, handEnd + 1),
      1,
    );

    const packet = createClassicHandResultPacket({
      state,
      boundary: hand.candidateBoundary,
      seats: physicalSeats,
      humanSeatIndex: 1,
      packetIndex: 2,
      fromCoreVersion: state.version,
      currentHandViewerEvents: fullViewerEvents,
    });

    expect(packet.handResult.seats).toMatchObject([
      { seatIndex: 0, holeCards: null, category: null, bestFive: null },
      { seatIndex: 1, holeCards: expect.any(Array) },
    ]);
    expect(packet.handResult.seats[1]!.holeCards).toHaveLength(2);
    const villainCards = state.seats[0]!.holeCards;
    if (villainCards === null) throw new Error('fixture requires hidden NPC cards');
    expect(JSON.stringify(packet)).not.toContain(villainCards[0].code);
    expect(JSON.stringify(packet)).not.toContain(villainCards[1].code);
  });

  it('rejects a full-hand summary interval whose first event is not handStarted', async () => {
    const { completedSeats, hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const malformedInterval = projectEventsForViewer(state.eventLog.slice(start + 1, end + 1), 0);

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: completedSeats,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: malformedInterval,
    }));
  });

  it('rejects a game-result winner that does not match the explicit candidate', async () => {
    const { hand, game } = await createCompletedCandidates();
    if (game.candidateBoundary.kind !== 'game-complete') throw new Error('fixture mismatch');
    const forgedBoundary = {
      kind: 'game-complete' as const,
      winnerSeatIndex: game.candidateBoundary.winnerSeatIndex === 0 ? 1 : 0,
    };

    expectSafeTurnPacketError(() => createClassicGameResultPacket({
      state: game.candidateAuthorityState,
      boundary: forgedBoundary,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: hand.candidateAuthorityState.version,
    }));
  });

  it('rejects duplicate physical seat descriptors before hand aggregation', async () => {
    const { hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const fullViewerEvents = projectEventsForViewer(state.eventLog.slice(start, end + 1), 0);

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: [
        { playerId: 'hero', seatIndex: 0 },
        { playerId: 'villain', seatIndex: 0 },
      ],
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: fullViewerEvents,
    }));
  });

  it('rejects otherwise authentic physical seat descriptors in non-contiguous array order', async () => {
    const { completedSeats, hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const fullViewerEvents = projectEventsForViewer(state.eventLog.slice(start, end + 1), 0);

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: [completedSeats[1]!, completedSeats[0]!],
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: fullViewerEvents,
    }));
  });

  it('rejects physical seat descriptors whose player IDs are swapped against the candidate', async () => {
    const { hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const fullViewerEvents = projectEventsForViewer(state.eventLog.slice(start, end + 1), 0);

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: [
        { playerId: 'villain', seatIndex: 0 },
        { playerId: 'hero', seatIndex: 1 },
      ],
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: fullViewerEvents,
    }));
  });

  it('rejects a forged player ID for an otherwise matching physical seat', async () => {
    const { hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const fullViewerEvents = projectEventsForViewer(state.eventLog.slice(start, end + 1), 0);

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: [
        { playerId: 'impostor', seatIndex: 0 },
        { playerId: 'villain', seatIndex: 1 },
      ],
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: fullViewerEvents,
    }));
  });

  it('rejects supplied handCompleted stacks that differ from the candidate projection', async () => {
    const { completedSeats, hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const authentic = projectEventsForViewer(state.eventLog.slice(start, end + 1), 0);
    const supplied = structuredClone(authentic) as PublicGameEvent[];
    const completion = supplied[supplied.length - 1];
    if (completion?.type !== 'handCompleted') throw new Error('fixture mismatch');
    supplied[supplied.length - 1] = {
      type: 'handCompleted',
      finalStacks: completion.finalStacks.map((entry, index) => ({
        ...entry,
        stack: index === 0 ? entry.stack + 1 : entry.stack,
      })),
    };

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: completedSeats,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: supplied,
    }));
  });

  it('rejects a replaced middle event in the supplied full-hand interval', async () => {
    const { completedSeats, hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const supplied = structuredClone(projectEventsForViewer(
      state.eventLog.slice(start, end + 1),
      0,
    )) as PublicGameEvent[];
    const positionsIndex = supplied.findIndex((event) => event.type === 'positionsAssigned');
    const positions = supplied[positionsIndex];
    if (positions?.type !== 'positionsAssigned') throw new Error('fixture mismatch');
    supplied[positionsIndex] = {
      ...positions,
      buttonPosition: positions.buttonPosition === 0 ? 1 : 0,
    };

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: completedSeats,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: supplied,
    }));
  });

  it('rejects a full-hand interval projected for the wrong viewer', async () => {
    const { completedSeats, hand } = await createCompletedCandidates();
    if (hand.candidateBoundary.kind !== 'hand-complete') throw new Error('fixture mismatch');
    const boundary = hand.candidateBoundary;
    const state = hand.candidateAuthorityState;
    const start = state.eventLog.findIndex((event) => event.type === 'HandStarted');
    const end = state.eventLog.findIndex((event) => event.type === 'HandCompleted');
    const wrongViewerEvents = projectEventsForViewer(state.eventLog.slice(start, end + 1), 1);

    expectSafeTurnPacketError(() => createClassicHandResultPacket({
      state,
      boundary,
      seats: completedSeats,
      humanSeatIndex: 0,
      packetIndex: 0,
      fromCoreVersion: state.version,
      currentHandViewerEvents: wrongViewerEvents,
    }));
  });
});
