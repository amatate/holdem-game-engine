import type { TournamentSeatInput, TournamentState } from '../core/state.js';
import type { ActionIntent, ActionRejectionCode } from '../core/legal-actions.js';
import {
  createTournamentDriver,
  type DriverBoundary,
  type PreparedDriverTransition,
  type TournamentDriver,
} from './tournament-driver.js';
import {
  createClassicDecisionPacket,
  createClassicGameResultPacket,
  createClassicHandResultPacket,
  projectCurrentHandViewerEvents,
  type TurnPacket,
} from './turn-packet.js';
import type {
  AbilityRejectionCode,
  GameSessionHandle,
  OpenGameSessionOptions,
  SessionCommand,
  SessionCommandResult,
  SessionContinueResult,
  SessionStep,
} from './session-types.js';

const INVALID_HANDLE_MESSAGE = 'Invalid game session handle';
const INVALID_OPTIONS_MESSAGE = 'Invalid game session options';
const BUSY_MESSAGE = 'Session operation already in progress';

interface ClassicAggregate {
  readonly driver: TournamentDriver;
  readonly seats: readonly TournamentSeatInput[];
  readonly humanSeatIndex: number;
  readonly acceptedCommandIndex: number;
  readonly nextPacketIndex: number;
  readonly deliveredCoreVersion: number;
  readonly pendingPacket: Readonly<TurnPacket>;
}

const sessions = new WeakMap<object, ClassicAggregate>();
const activeSessionOperations = new WeakSet<object>();

function requireAggregate(handle: GameSessionHandle): ClassicAggregate {
  const aggregate = sessions.get(handle as object);
  if (aggregate === undefined) throw new Error(INVALID_HANDLE_MESSAGE);
  return aggregate;
}

function cloneSeats(seats: readonly TournamentSeatInput[]): readonly TournamentSeatInput[] {
  return Object.freeze(seats.map((seat) => Object.freeze({
    playerId: seat.playerId,
    seatIndex: seat.seatIndex,
  })));
}

function validateSessionOptions(options: Readonly<OpenGameSessionOptions>): void {
  if (options.mode !== 'classic'
    || !Array.isArray(options.seats)
    || !Array.isArray(options.participants)
    || options.seats.length !== options.config.maxSeats
    || options.participants.length !== options.seats.length
    || !Number.isSafeInteger(options.humanSeatIndex)
    || options.humanSeatIndex < 0
    || options.humanSeatIndex >= options.seats.length
    || options.participants[options.humanSeatIndex] !== null) {
    throw new Error(INVALID_OPTIONS_MESSAGE);
  }
  for (let seatIndex = 0; seatIndex < options.seats.length; seatIndex += 1) {
    if (seatIndex === options.humanSeatIndex) continue;
    const seat = options.seats[seatIndex];
    const participant = options.participants[seatIndex];
    if (seat === undefined
      || participant === undefined
      || participant === null
      || typeof participant !== 'object'
      || participant.playerId !== seat.playerId
      || typeof participant.decide !== 'function') {
      throw new Error(INVALID_OPTIONS_MESSAGE);
    }
  }
}

function beginSessionOperation(handle: object): void {
  if (activeSessionOperations.has(handle)) throw new Error(BUSY_MESSAGE);
  activeSessionOperations.add(handle);
}

function createPacket(
  state: Readonly<TournamentState>,
  boundary: Readonly<DriverBoundary>,
  seats: readonly TournamentSeatInput[],
  humanSeatIndex: number,
  packetIndex: number,
  fromCoreVersion: number,
): Readonly<TurnPacket> {
  switch (boundary.kind) {
    case 'decision':
      return createClassicDecisionPacket({
        state,
        boundary,
        humanSeatIndex,
        packetIndex,
        fromCoreVersion,
      });
    case 'hand-complete': {
      const currentHandViewerEvents = projectCurrentHandViewerEvents(state, humanSeatIndex);
      return createClassicHandResultPacket({
        state,
        boundary,
        seats,
        humanSeatIndex,
        packetIndex,
        fromCoreVersion,
        currentHandViewerEvents,
      });
    }
    case 'game-complete':
      return createClassicGameResultPacket({
        state,
        boundary,
        humanSeatIndex,
        packetIndex,
        fromCoreVersion,
      });
  }
}

function rejectCommand(
  handle: GameSessionHandle,
  aggregate: ClassicAggregate,
  rejection: AbilityRejectionCode | ActionRejectionCode,
): SessionCommandResult {
  return Object.freeze({
    accepted: false,
    handle,
    rejection,
    packet: aggregate.pendingPacket,
  });
}

function snapshotIntent(value: unknown): ActionIntent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  try {
    const candidate = value as { readonly type?: unknown; readonly amount?: unknown };
    const type = candidate.type;
    if (type === 'fold'
      || type === 'check'
      || type === 'call'
      || type === 'allIn') {
      return { type };
    }
    if (type === 'raiseTo') {
      const amount = candidate.amount;
      return typeof amount === 'number' ? { type: 'raiseTo', amount } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function snapshotCommand(value: unknown): SessionCommand | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  try {
    const candidate = value as {
      readonly type?: unknown;
      readonly decisionKey?: unknown;
      readonly expectedPacketIndex?: unknown;
      readonly intent?: unknown;
      readonly ability?: unknown;
      readonly targetSeatIndex?: unknown;
      readonly holeCardIndex?: unknown;
    };
    const type = candidate.type;
    const decisionKey = candidate.decisionKey;
    const expectedPacketIndex = candidate.expectedPacketIndex;
    if (typeof decisionKey !== 'string' || decisionKey.length === 0
      || !Number.isSafeInteger(expectedPacketIndex)
      || (expectedPacketIndex as number) < 0) {
      return null;
    }
    if (type === 'act') {
      const intent = snapshotIntent(candidate.intent);
      return intent === null ? null : {
        type: 'act',
        decisionKey,
        expectedPacketIndex: expectedPacketIndex as number,
        intent,
      };
    }
    if (type !== 'useAbility') return null;
    const ability = candidate.ability;
    if (ability === 'peek' || ability === 'read') {
      const targetSeatIndex = candidate.targetSeatIndex;
      if (typeof targetSeatIndex !== 'number') return null;
      return {
        type: 'useAbility',
        decisionKey,
        expectedPacketIndex: expectedPacketIndex as number,
        ability,
        targetSeatIndex,
      };
    }
    if (ability === 'swap') {
      const holeCardIndex = candidate.holeCardIndex;
      if (typeof holeCardIndex !== 'number') return null;
      return {
        type: 'useAbility',
        decisionKey,
        expectedPacketIndex: expectedPacketIndex as number,
        ability: 'swap',
        holeCardIndex: holeCardIndex as 0 | 1,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function createCandidate(
  previous: Omit<ClassicAggregate, 'pendingPacket'>,
  prepared: Readonly<PreparedDriverTransition>,
  acceptedCommandIndex: number,
): ClassicAggregate {
  const state = prepared.candidateAuthorityState;
  const packet = createPacket(
    state,
    prepared.candidateBoundary,
    previous.seats,
    previous.humanSeatIndex,
    previous.nextPacketIndex,
    previous.deliveredCoreVersion,
  );
  return Object.freeze({
    ...previous,
    acceptedCommandIndex,
    nextPacketIndex: previous.nextPacketIndex + 1,
    deliveredCoreVersion: state.version,
    pendingPacket: packet,
  });
}

function commitSessionCandidate(
  handle: object,
  previous: ClassicAggregate | undefined,
  prepared: Readonly<PreparedDriverTransition>,
  candidate: ClassicAggregate,
  step: Readonly<SessionStep>,
): Readonly<SessionStep> {
  if (sessions.get(handle) !== previous) throw new Error('Session candidate is stale');
  candidate.driver.commitPreparedTransition(prepared);
  sessions.set(handle, candidate);
  return step;
}

export async function openGameSession(
  options: Readonly<OpenGameSessionOptions>,
): Promise<Readonly<SessionStep>> {
  validateSessionOptions(options);
  const seats = cloneSeats(options.seats);
  const handle = Object.freeze({}) as GameSessionHandle;
  beginSessionOperation(handle as object);
  let driver: TournamentDriver | undefined;
  let prepared: Readonly<PreparedDriverTransition> | undefined;
  try {
    driver = createTournamentDriver({
      config: options.config,
      runSeed: options.runSeed,
      seats,
      participants: Object.freeze([...options.participants]),
      pauseSeatIndexes: Object.freeze([options.humanSeatIndex]),
      ...(options.maxTransitions === undefined ? {} : { maxTransitions: options.maxTransitions }),
      ...(options.invalidAgentActionMode === undefined
        ? {}
        : { invalidAgentActionMode: options.invalidAgentActionMode }),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    });
    prepared = await driver.prepareOpen();
    const candidate = createCandidate({
      driver,
      seats,
      humanSeatIndex: options.humanSeatIndex,
      acceptedCommandIndex: 0,
      nextPacketIndex: 0,
      deliveredCoreVersion: 0,
    }, prepared, 0);
    const step = Object.freeze({ handle, packet: candidate.pendingPacket });
    return commitSessionCandidate(handle as object, undefined, prepared, candidate, step);
  } catch (error) {
    if (prepared !== undefined) driver?.discardPreparedTransition(prepared);
    throw error;
  } finally {
    activeSessionOperations.delete(handle as object);
  }
}

export function getCurrentPacket(handle: GameSessionHandle): Readonly<TurnPacket> {
  return requireAggregate(handle).pendingPacket;
}

export async function submitSessionCommand(
  handle: GameSessionHandle,
  command: Readonly<SessionCommand>,
): Promise<SessionCommandResult> {
  const previous = requireAggregate(handle);
  const handleObject = handle as object;
  beginSessionOperation(handleObject);
  try {
    const snapshot = snapshotCommand(command);
    if (snapshot === null) return rejectCommand(handle, previous, 'malformed-command');
    if (snapshot.type === 'useAbility') return rejectCommand(handle, previous, 'wrong-mode');
    if (previous.pendingPacket.kind !== 'decision') {
      return rejectCommand(handle, previous, 'not-human-turn');
    }
    if (snapshot.expectedPacketIndex !== previous.pendingPacket.packetIndex) {
      return rejectCommand(handle, previous, 'stale-packet');
    }
    if (snapshot.decisionKey !== previous.pendingPacket.decisionKey) {
      return rejectCommand(handle, previous, 'stale-decision');
    }
    let prepared: Readonly<PreparedDriverTransition> | undefined;
    try {
      prepared = await previous.driver.preparePausedAction(
        previous.humanSeatIndex,
        snapshot.intent,
        previous.acceptedCommandIndex,
      );
      if (prepared.rejection !== null) {
        const rejection = prepared.rejection.code;
        previous.driver.discardPreparedTransition(prepared);
        prepared = undefined;
        return rejectCommand(handle, previous, rejection);
      }
      const candidate = createCandidate(previous, prepared, previous.acceptedCommandIndex + 1);
      const step = Object.freeze({ handle, packet: candidate.pendingPacket });
      const result = Object.freeze({ accepted: true as const, step });
      commitSessionCandidate(handleObject, previous, prepared, candidate, step);
      return result;
    } catch (error) {
      if (prepared !== undefined) previous.driver.discardPreparedTransition(prepared);
      throw error;
    }
  } finally {
    activeSessionOperations.delete(handleObject);
  }
}

export async function continueAfterHandResult(
  handle: GameSessionHandle,
  packetIndex: number,
): Promise<SessionContinueResult> {
  const previous = requireAggregate(handle);
  const handleObject = handle as object;
  beginSessionOperation(handleObject);
  try {
    if (packetIndex !== previous.pendingPacket.packetIndex) {
      return Object.freeze({
        accepted: false,
        handle,
        rejection: 'stale-packet',
        packet: previous.pendingPacket,
      });
    }
    if (previous.pendingPacket.kind !== 'hand-result') {
      return Object.freeze({
        accepted: false,
        handle,
        rejection: 'wrong-boundary',
        packet: previous.pendingPacket,
      });
    }
    let prepared: Readonly<PreparedDriverTransition> | undefined;
    try {
      prepared = await previous.driver.prepareContinueAfterHand();
      const candidate = createCandidate(previous, prepared, previous.acceptedCommandIndex);
      const step = Object.freeze({ handle, packet: candidate.pendingPacket });
      const result = Object.freeze({ accepted: true as const, step });
      commitSessionCandidate(handleObject, previous, prepared, candidate, step);
      return result;
    } catch (error) {
      if (prepared !== undefined) previous.driver.discardPreparedTransition(prepared);
      throw error;
    }
  } finally {
    activeSessionOperations.delete(handleObject);
  }
}
