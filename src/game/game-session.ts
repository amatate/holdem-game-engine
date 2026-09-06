import type { TournamentSeatInput, TournamentState } from '../core/state.js';
import type { ActionIntent, ActionRejectionCode } from '../core/legal-actions.js';
import type { TournamentConfig } from '../core/config.js';
import type { Participant } from './participant.js';
import { createSeededRandom } from '../core/random.js';
import { cloneCanonicalCard } from '../core/cards.js';
import { replaceHoleCard } from '../core/hole-card-replacement.js';
import { classifyKnownHandStrength } from './ability-strength.js';
import { createPeekDecisionPacket, type AbilityState, type PrivateAbilityKnowledge } from './peek-ability.js';
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
  type ClassicTurnPacket,
} from './turn-packet.js';
import type {
  AbilityRejectionCode,
  GameSessionHandle,
  OpenGameSessionOptions,
  SessionCommand,
  SessionCommandResult,
  SessionContinueResult,
  SessionStep,
  SessionMode,
} from './session-types.js';

const INVALID_HANDLE_MESSAGE = 'Invalid game session handle';
const INVALID_OPTIONS_MESSAGE = 'Invalid game session options';
const BUSY_MESSAGE = 'Session operation already in progress';

interface SessionAggregate {
  readonly driver: TournamentDriver;
  readonly seats: readonly TournamentSeatInput[];
  readonly humanSeatIndex: number;
  readonly acceptedCommandIndex: number;
  readonly nextPacketIndex: number;
  readonly deliveredCoreVersion: number;
  readonly pendingPacket: Readonly<TurnPacket>;
  readonly abilityState: Readonly<AbilityState> | null;
}

const sessions = new WeakMap<object, SessionAggregate>();
const activeSessionOperations = new WeakSet<object>();

type ProxyDetector = (value: unknown) => boolean;

interface TrustedOpenOptions {
  readonly mode: SessionMode;
  readonly config: TournamentConfig;
  readonly runSeed: string;
  readonly humanSeatIndex: number;
  readonly seats: readonly TournamentSeatInput[];
  readonly participants: readonly (Participant | null)[];
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly onDiagnostic?: NonNullable<OpenGameSessionOptions['onDiagnostic']>;
}

function loadProxyDetector(): ProxyDetector | null {
  const runtime = globalThis as typeof globalThis & {
    process?: { getBuiltinModule?: (specifier: string) => unknown };
  };
  const getBuiltinModule = runtime.process?.getBuiltinModule;
  if (typeof getBuiltinModule !== 'function') return null;
  try {
    const nodeUtil = getBuiltinModule('node:util') as {
      types?: { isProxy?: (value: unknown) => boolean };
    };
    const isProxy = nodeUtil.types?.isProxy;
    return typeof isProxy === 'function' ? (value) => isProxy(value) : null;
  } catch {
    return null;
  }
}

const proxyDetector = loadProxyDetector();

function requireAggregate(handle: GameSessionHandle): SessionAggregate {
  const aggregate = sessions.get(handle as object);
  if (aggregate === undefined) throw new Error(INVALID_HANDLE_MESSAGE);
  return aggregate;
}

function isDetectedProxy(value: unknown): boolean {
  if (proxyDetector === null) return true;
  try {
    return proxyDetector(value);
  } catch {
    return true;
  }
}

function snapshotOwnDataRecord(value: unknown): ReadonlyMap<string, unknown> | null {
  if (typeof value !== 'object' || value === null || isDetectedProxy(value)) return null;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    const snapshot = new Map<string, unknown>();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        return null;
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function hasExactFields(
  record: ReadonlyMap<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  if (record.size < required.length || record.size > required.length + optional.length) {
    return false;
  }
  for (let index = 0; index < required.length; index += 1) {
    if (!record.has(required[index]!)) return false;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of record.keys()) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function snapshotDenseArray(value: unknown): readonly unknown[] | null {
  if (typeof value !== 'object' || value === null || isDetectedProxy(value)) return null;
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined
      || !('value' in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0) {
      return null;
    }
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        return null;
      }
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function snapshotConfig(value: unknown): TournamentConfig | null {
  const record = snapshotOwnDataRecord(value);
  if (record === null || !hasExactFields(record, [
    'maxSeats',
    'startingStack',
    'handsPerLevel',
    'blindLevels',
    'initialButtonSeat',
  ])) return null;
  const maxSeats = record.get('maxSeats');
  const startingStack = record.get('startingStack');
  const handsPerLevel = record.get('handsPerLevel');
  const initialButtonSeat = record.get('initialButtonSeat');
  const levels = snapshotDenseArray(record.get('blindLevels'));
  if (!Number.isSafeInteger(maxSeats) || (maxSeats as number) < 2 || (maxSeats as number) > 6
    || !isPositiveSafeInteger(startingStack)
    || !Number.isSafeInteger(startingStack * (maxSeats as number))
    || !isPositiveSafeInteger(handsPerLevel)
    || !Number.isSafeInteger(initialButtonSeat)
    || (initialButtonSeat as number) < 0
    || (initialButtonSeat as number) >= (maxSeats as number)
    || levels === null
    || levels.length === 0) {
    return null;
  }
  const blindLevels: Array<{ readonly smallBlind: number; readonly bigBlind: number }> = [];
  for (let index = 0; index < levels.length; index += 1) {
    const level = snapshotOwnDataRecord(levels[index]);
    if (level === null || !hasExactFields(level, ['smallBlind', 'bigBlind'])) return null;
    const smallBlind = level.get('smallBlind');
    const bigBlind = level.get('bigBlind');
    if (!isPositiveSafeInteger(smallBlind)
      || !isPositiveSafeInteger(bigBlind)
      || smallBlind >= bigBlind) {
      return null;
    }
    blindLevels.push(Object.freeze({ smallBlind, bigBlind }));
  }
  return Object.freeze({
    maxSeats: maxSeats as number,
    startingStack,
    handsPerLevel,
    blindLevels: Object.freeze(blindLevels),
    initialButtonSeat: initialButtonSeat as number,
  });
}

function snapshotSeats(
  value: unknown,
  maxSeats: number,
): readonly TournamentSeatInput[] | null {
  const rawSeats = snapshotDenseArray(value);
  if (rawSeats === null || rawSeats.length !== maxSeats) return null;
  const seats: TournamentSeatInput[] = [];
  const playerIds = new Set<string>();
  for (let seatIndex = 0; seatIndex < rawSeats.length; seatIndex += 1) {
    const record = snapshotOwnDataRecord(rawSeats[seatIndex]);
    if (record === null || !hasExactFields(record, ['playerId', 'seatIndex'])) return null;
    const playerId = record.get('playerId');
    const suppliedSeatIndex = record.get('seatIndex');
    if (typeof playerId !== 'string'
      || playerId.length === 0
      || playerIds.has(playerId)
      || suppliedSeatIndex !== seatIndex) {
      return null;
    }
    playerIds.add(playerId);
    seats.push(Object.freeze({ playerId, seatIndex }));
  }
  return Object.freeze(seats);
}

function isSafeCallable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function' && !isDetectedProxy(value);
}

const MAX_PARTICIPANT_PROTOTYPE_DEPTH = 32;

function snapshotParticipant(
  value: unknown,
  expectedPlayerId: string,
): Participant | null {
  if (typeof value !== 'object' || value === null || isDetectedProxy(value)) return null;
  try {
    const playerIdDescriptor = Object.getOwnPropertyDescriptor(value, 'playerId');
    if (playerIdDescriptor === undefined
      || !('value' in playerIdDescriptor)
      || playerIdDescriptor.value !== expectedPlayerId
      || typeof playerIdDescriptor.value !== 'string'
      || playerIdDescriptor.value.length === 0) {
      return null;
    }

    let trustedDecide: Participant['decide'] | null = null;
    const ownDecideDescriptor = Object.getOwnPropertyDescriptor(value, 'decide');
    if (ownDecideDescriptor !== undefined) {
      if (!('value' in ownDecideDescriptor) || !isSafeCallable(ownDecideDescriptor.value)) {
        return null;
      }
      trustedDecide = ownDecideDescriptor.value as Participant['decide'];
    }

    const visited = new Set<object>([value]);
    let prototype = Object.getPrototypeOf(value) as object | null;
    let depth = 0;
    while (prototype !== null) {
      if (isDetectedProxy(prototype)
        || visited.has(prototype)
        || depth >= MAX_PARTICIPANT_PROTOTYPE_DEPTH) {
        return null;
      }
      visited.add(prototype);
      depth += 1;

      if (Object.getOwnPropertyDescriptor(prototype, 'playerId') !== undefined) return null;
      const inheritedDecideDescriptor = Object.getOwnPropertyDescriptor(prototype, 'decide');
      if (inheritedDecideDescriptor !== undefined) {
        if (!('value' in inheritedDecideDescriptor)
          || !isSafeCallable(inheritedDecideDescriptor.value)) {
          return null;
        }
        if (trustedDecide === null) {
          trustedDecide = inheritedDecideDescriptor.value as Participant['decide'];
        }
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    if (trustedDecide === null) return null;

    const originalParticipant = value;
    const playerId = playerIdDescriptor.value;
    const decide = trustedDecide;
    return Object.freeze({
      playerId,
      decide: async (context: Parameters<Participant['decide']>[0]) => await Reflect.apply(
        decide,
        originalParticipant,
        [context],
      ),
    });
  } catch {
    return null;
  }
}

function snapshotParticipants(
  value: unknown,
  seats: readonly TournamentSeatInput[],
  humanSeatIndex: number,
): readonly (Participant | null)[] | null {
  const rawParticipants = snapshotDenseArray(value);
  if (rawParticipants === null || rawParticipants.length !== seats.length
    || rawParticipants[humanSeatIndex] !== null) {
    return null;
  }
  const participants: Array<Participant | null> = [];
  for (let seatIndex = 0; seatIndex < rawParticipants.length; seatIndex += 1) {
    if (seatIndex === humanSeatIndex) {
      participants.push(null);
      continue;
    }
    const participant = snapshotParticipant(
      rawParticipants[seatIndex],
      seats[seatIndex]!.playerId,
    );
    if (participant === null) return null;
    participants.push(participant);
  }
  return Object.freeze(participants);
}

function snapshotOpenOptions(value: unknown): TrustedOpenOptions | null {
  const record = snapshotOwnDataRecord(value);
  if (record === null || !hasExactFields(record, [
    'mode',
    'config',
    'runSeed',
    'humanSeatIndex',
    'seats',
    'participants',
  ], ['maxTransitions', 'invalidAgentActionMode', 'onDiagnostic'])) return null;
  const mode = record.get('mode');
  const runSeed = record.get('runSeed');
  const humanSeatIndex = record.get('humanSeatIndex');
  const maxTransitions = record.get('maxTransitions');
  const invalidAgentActionMode = record.get('invalidAgentActionMode');
  const onDiagnostic = record.get('onDiagnostic');
  if ((mode !== 'classic' && mode !== 'ability-lab')
    || typeof runSeed !== 'string'
    || runSeed.length === 0
    || !Number.isSafeInteger(humanSeatIndex)
    || (maxTransitions !== undefined && !isPositiveSafeInteger(maxTransitions))
    || (invalidAgentActionMode !== undefined
      && invalidAgentActionMode !== 'throw'
      && invalidAgentActionMode !== 'fallback')
    || (onDiagnostic !== undefined && !isSafeCallable(onDiagnostic))) {
    return null;
  }
  const config = snapshotConfig(record.get('config'));
  if (config === null
    || (humanSeatIndex as number) < 0
    || (humanSeatIndex as number) >= config.maxSeats) {
    return null;
  }
  const seats = snapshotSeats(record.get('seats'), config.maxSeats);
  if (seats === null) return null;
  const participants = snapshotParticipants(
    record.get('participants'),
    seats,
    humanSeatIndex as number,
  );
  if (participants === null) return null;
  return Object.freeze({
    mode,
    config,
    runSeed,
    humanSeatIndex: humanSeatIndex as number,
    seats,
    participants,
    ...(maxTransitions === undefined ? {} : { maxTransitions: maxTransitions as number }),
    ...(invalidAgentActionMode === undefined
      ? {}
      : { invalidAgentActionMode: invalidAgentActionMode as 'throw' | 'fallback' }),
    ...(onDiagnostic === undefined
      ? {}
      : { onDiagnostic: onDiagnostic as NonNullable<OpenGameSessionOptions['onDiagnostic']> }),
  });
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
): Readonly<ClassicTurnPacket> {
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
  aggregate: SessionAggregate,
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
  const record = snapshotOwnDataRecord(value);
  if (record === null) return null;
  const type = record.get('type');
  if (type === 'fold' || type === 'check' || type === 'call' || type === 'allIn') {
    return hasExactFields(record, ['type']) ? { type } : null;
  }
  if (type !== 'raiseTo' || !hasExactFields(record, ['type', 'amount'])) return null;
  const amount = record.get('amount');
  return typeof amount === 'number' ? { type: 'raiseTo', amount } : null;
}

function snapshotCommand(value: unknown): SessionCommand | null {
  const record = snapshotOwnDataRecord(value);
  if (record === null) return null;
  const type = record.get('type');
  const decisionKey = record.get('decisionKey');
  const expectedPacketIndex = record.get('expectedPacketIndex');
  if (typeof decisionKey !== 'string' || decisionKey.length === 0
    || !Number.isSafeInteger(expectedPacketIndex)
    || (expectedPacketIndex as number) < 0) {
    return null;
  }
  if (type === 'act') {
    if (!hasExactFields(record, ['type', 'decisionKey', 'expectedPacketIndex', 'intent'])) {
      return null;
    }
    const intent = snapshotIntent(record.get('intent'));
    return intent === null ? null : {
      type: 'act',
      decisionKey,
      expectedPacketIndex: expectedPacketIndex as number,
      intent,
    };
  }
  if (type !== 'useAbility') return null;
  const ability = record.get('ability');
  if (ability === 'peek' || ability === 'read') {
    if (!hasExactFields(record, [
      'type',
      'decisionKey',
      'expectedPacketIndex',
      'ability',
      'targetSeatIndex',
    ])) return null;
    const targetSeatIndex = record.get('targetSeatIndex');
    return typeof targetSeatIndex !== 'number' ? null : {
      type: 'useAbility',
      decisionKey,
      expectedPacketIndex: expectedPacketIndex as number,
      ability,
      targetSeatIndex,
    };
  }
  if (ability !== 'swap' || !hasExactFields(record, [
    'type',
    'decisionKey',
    'expectedPacketIndex',
    'ability',
    'holeCardIndex',
  ])) return null;
  const holeCardIndex = record.get('holeCardIndex');
  return typeof holeCardIndex !== 'number' ? null : {
    type: 'useAbility',
    decisionKey,
    expectedPacketIndex: expectedPacketIndex as number,
    ability: 'swap',
    holeCardIndex: holeCardIndex as 0 | 1,
  };
}

function createCandidate(
  previous: Omit<SessionAggregate, 'pendingPacket'>,
  prepared: Readonly<PreparedDriverTransition>,
  acceptedCommandIndex: number,
  notices: readonly PrivateAbilityKnowledge[] = [],
): SessionAggregate {
  const state = prepared.candidateAuthorityState;
  const classicPacket = createPacket(
    state,
    prepared.candidateBoundary,
    previous.seats,
    previous.humanSeatIndex,
    previous.nextPacketIndex,
    previous.deliveredCoreVersion,
  );
  const abilityState: AbilityState | null = previous.abilityState === null ? null : Object.freeze({
    charges: previous.abilityState.charges,
    usedThisDecision: notices.length > 0,
    knowledge: Object.freeze(classicPacket.kind === 'decision'
      ? previous.abilityState.knowledge.filter((entry) => entry.handNumber === state.handNumber) : []),
  });
  let packet: Readonly<TurnPacket> = classicPacket.kind === 'decision' && abilityState !== null
    ? createPeekDecisionPacket(classicPacket, state, previous.humanSeatIndex, abilityState, notices) : classicPacket;
  // Folded human cards are not publicly revealed. Preserve their final (possibly swapped)
  // pair in the private settlement, without filling any hidden opponent row.
  if (packet.kind === 'hand-result' && state.activeHand?.abilityDiscardedCards?.length) {
    const ownCards = state.seats.find((seat) => seat.seatIndex === previous.humanSeatIndex)?.holeCards;
    if (ownCards) packet = Object.freeze({ ...packet,
      handResult: Object.freeze({ ...packet.handResult,
        seats: Object.freeze(packet.handResult.seats.map((seat) => seat.seatIndex !== previous.humanSeatIndex
          ? seat : Object.freeze({ ...seat, holeCards: Object.freeze(ownCards.map((card) =>
            Object.freeze(cloneCanonicalCard(card)))) as unknown as typeof ownCards }))),
      }),
    });
  }
  return Object.freeze({
    ...previous,
    abilityState,
    acceptedCommandIndex,
    nextPacketIndex: previous.nextPacketIndex + 1,
    deliveredCoreVersion: state.version,
    pendingPacket: packet,
  });
}

function commitSessionCandidate(
  handle: object,
  previous: SessionAggregate | undefined,
  prepared: Readonly<PreparedDriverTransition>,
  candidate: SessionAggregate,
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
  const snapshot = snapshotOpenOptions(options);
  if (snapshot === null) throw new Error(INVALID_OPTIONS_MESSAGE);
  const seats = snapshot.seats;
  const handle = Object.freeze({}) as GameSessionHandle;
  beginSessionOperation(handle as object);
  let driver: TournamentDriver | undefined;
  let prepared: Readonly<PreparedDriverTransition> | undefined;
  try {
    driver = createTournamentDriver({
      config: snapshot.config,
      runSeed: snapshot.runSeed,
      seats,
      participants: snapshot.participants,
      pauseSeatIndexes: Object.freeze([snapshot.humanSeatIndex]),
      ...(snapshot.maxTransitions === undefined
        ? {}
        : { maxTransitions: snapshot.maxTransitions }),
      ...(snapshot.invalidAgentActionMode === undefined
        ? {}
        : { invalidAgentActionMode: snapshot.invalidAgentActionMode }),
      ...(snapshot.onDiagnostic === undefined ? {} : { onDiagnostic: snapshot.onDiagnostic }),
    });
    prepared = await driver.prepareOpen();
    const candidate = createCandidate({
      driver,
      seats,
      humanSeatIndex: snapshot.humanSeatIndex,
      acceptedCommandIndex: 0,
      nextPacketIndex: 0,
      deliveredCoreVersion: 0,
      abilityState: snapshot.mode === 'classic' ? null : Object.freeze({
        charges: Object.freeze({ peek: 1, read: 1, swap: 1 }), usedThisDecision: false, knowledge: Object.freeze([]),
      }),
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

async function useAbility(
  handle: GameSessionHandle, previous: SessionAggregate,
  command: Extract<SessionCommand, { type: 'useAbility' }>,
): Promise<SessionCommandResult> {
  const abilityState = previous.abilityState!;
  if (abilityState.charges[command.ability] === 0) return rejectCommand(handle, previous, 'ability-spent');
  if (abilityState.usedThisDecision) return rejectCommand(handle, previous, 'ability-already-used-this-decision');
  const state = previous.driver.getAuthorityState();
  const hand = state.activeHand;
  const boundary = previous.driver.getBoundary();
  if (!hand || boundary.kind !== 'decision' || hand.currentActorSeat !== previous.humanSeatIndex) {
    return rejectCommand(handle, previous, 'not-human-turn');
  }
  let notice: PrivateAbilityKnowledge;
  let prepared: Readonly<PreparedDriverTransition> | undefined;
  try {
    if (command.ability === 'swap') {
      if (command.holeCardIndex !== 0 && command.holeCardIndex !== 1) {
        return rejectCommand(handle, previous, 'invalid-hole-card-index');
      }
      if (hand.revealedHoleCardSeats.includes(previous.humanSeatIndex)) {
        return rejectCommand(handle, previous, 'target-cards-public');
      }
      const nextCard = hand.deck[hand.dealCursor];
      if (!nextCard) return rejectCommand(handle, previous, 'deck-exhausted');
      const oldCard = state.seats.find((seat) => seat.seatIndex === previous.humanSeatIndex)!.holeCards![command.holeCardIndex];
      notice = Object.freeze({
        type: 'swap', handNumber: state.handNumber, holeCardIndex: command.holeCardIndex,
        oldCard: Object.freeze(cloneCanonicalCard(oldCard)), newCard: Object.freeze(cloneCanonicalCard(nextCard)),
      });
      prepared = await previous.driver.prepareAuthorityTransition(
        replaceHoleCard(state, previous.humanSeatIndex, command.holeCardIndex),
        'ability-swap', previous.acceptedCommandIndex,
      );
    } else {
      const target = state.seats.find((seat) => seat.seatIndex === command.targetSeatIndex);
      if (!Number.isSafeInteger(command.targetSeatIndex) || !target
        || target.seatIndex === previous.humanSeatIndex
        || (target.status !== 'active' && target.status !== 'all-in') || !target.holeCards) {
        return rejectCommand(handle, previous, 'invalid-target');
      }
      if (hand.revealedHoleCardSeats.includes(target.seatIndex)) {
        return rejectCommand(handle, previous, 'target-cards-public');
      }
      // Independent forks do not advance dealing or NPC randomness, even after a failed delivery.
      const random = createSeededRandom(state.runSeed)
        .fork(`ability/${command.ability}/${state.handNumber}/${previous.acceptedCommandIndex}`);
      notice = command.ability === 'peek'
        ? Object.freeze({
            type: 'peek', handNumber: state.handNumber, targetSeatIndex: target.seatIndex,
            card: Object.freeze(cloneCanonicalCard(target.holeCards[random.nextUint32() % 2]!)),
          })
        : Object.freeze({
            type: 'read', handNumber: state.handNumber, targetSeatIndex: target.seatIndex,
            street: hand.street!, band: classifyKnownHandStrength({
              holeCards: target.holeCards, board: hand.board,
              livePlayerCount: state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in').length,
            }, random),
          });
    }
    const nextAbilities: AbilityState = Object.freeze({
      charges: Object.freeze({ ...abilityState.charges, [command.ability]: 0 }),
      usedThisDecision: true, knowledge: Object.freeze([...abilityState.knowledge, notice]),
    });
    let candidate: SessionAggregate;
    if (prepared) {
      candidate = createCandidate({ ...previous, abilityState: nextAbilities }, prepared,
        previous.acceptedCommandIndex + 1, [notice]);
    } else {
      const basePacket = createClassicDecisionPacket({
        state, boundary, humanSeatIndex: previous.humanSeatIndex,
        packetIndex: previous.nextPacketIndex, fromCoreVersion: previous.deliveredCoreVersion,
      });
      const packet = createPeekDecisionPacket(basePacket, state, previous.humanSeatIndex, nextAbilities, [notice]);
      candidate = Object.freeze({ ...previous, abilityState: nextAbilities, pendingPacket: packet,
        nextPacketIndex: previous.nextPacketIndex + 1,
        acceptedCommandIndex: previous.acceptedCommandIndex + 1,
      });
    }
    const step = Object.freeze({ handle, packet: candidate.pendingPacket });
    const result = Object.freeze({ accepted: true as const, step });
    // All fallible projection/freezing is complete before committing either core or charges.
    if (prepared) commitSessionCandidate(handle as object, previous, prepared, candidate, step);
    else {
      if (sessions.get(handle as object) !== previous) throw new Error('Session candidate is stale');
      sessions.set(handle as object, candidate);
    }
    return result;
  } catch (error) {
    if (prepared) previous.driver.discardPreparedTransition(prepared);
    throw error;
  }
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
    if (snapshot.type === 'useAbility' && previous.abilityState === null) return rejectCommand(handle, previous, 'wrong-mode');
    if (previous.pendingPacket.kind !== 'decision') {
      return rejectCommand(handle, previous, 'not-human-turn');
    }
    if (snapshot.expectedPacketIndex !== previous.pendingPacket.packetIndex) {
      return rejectCommand(handle, previous, 'stale-packet');
    }
    if (snapshot.decisionKey !== previous.pendingPacket.decisionKey) {
      return rejectCommand(handle, previous, 'stale-decision');
    }
    if (snapshot.type === 'useAbility') return await useAbility(handle, previous, snapshot);
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
