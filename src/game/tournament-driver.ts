import { projectObservation } from '../agents/observation.js';
import type { ActionDecision, DecisionContext, PlayerObservationV1 } from '../agents/types.js';
import type { TournamentConfig } from '../core/config.js';
import { advanceAutomaticPhases } from '../core/dealing.js';
import type { DomainEvent } from '../core/events.js';
import { assertTournamentInvariants } from '../core/invariants.js';
import type { ActionIntent, ActionRejection } from '../core/legal-actions.js';
import { createSeededRandom } from '../core/random.js';
import { applyIntent } from '../core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  startNextHand,
  type TournamentSeatInput,
  type TournamentState,
  type TransitionResult,
} from '../core/state.js';
import type { Participant } from './participant.js';
import type { ControllerDiagnosticEvent } from './tournament-controller.js';

const DEFAULT_MAX_TRANSITIONS = 20_000;
const UNCOMMITTED_MESSAGE = 'Tournament driver is not committed';
const BUSY_MESSAGE = 'Session operation already in progress';
const INVALID_PREPARED_MESSAGE = 'Invalid prepared driver transition';

export type DriverBoundary =
  | Readonly<{ kind: 'decision'; seatIndex: number; observation: Readonly<PlayerObservationV1> }>
  | Readonly<{ kind: 'hand-complete'; handNumber: number }>
  | Readonly<{ kind: 'game-complete'; winnerSeatIndex: number }>;

export type DriverTransitionSource =
  | 'automatic'
  | 'npc'
  | 'human-poker'
  | 'ability-swap';

export interface DriverTransitionBatch {
  readonly source: DriverTransitionSource;
  readonly commandIndex: number | null;
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly authorityEvents: readonly DomainEvent[];
}

export interface TournamentDriverOptions {
  readonly config: TournamentConfig;
  readonly runSeed: string;
  readonly seats: readonly TournamentSeatInput[];
  readonly participants: readonly (Participant | null)[];
  readonly pauseSeatIndexes: readonly number[];
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly onAcceptedTransition?: (
    batch: Readonly<DriverTransitionBatch>,
  ) => void | Promise<void>;
  readonly onDiagnostic?: (
    event: Readonly<ControllerDiagnosticEvent>,
  ) => void | Promise<void>;
}

declare const preparedDriverTransitionBrand: unique symbol;
export interface PreparedDriverTransition {
  readonly [preparedDriverTransitionBrand]: true;
  readonly candidateBoundary: Readonly<DriverBoundary>;
  readonly candidateAuthorityState: Readonly<TournamentState>;
  readonly transitionBatches: readonly Readonly<DriverTransitionBatch>[];
  readonly rejection: Readonly<ActionRejection> | null;
}

export type DriverActionResult =
  | Readonly<{ accepted: true; boundary: Readonly<DriverBoundary> }>
  | Readonly<{ accepted: false; rejection: Readonly<ActionRejection> }>;

export interface TournamentDriver {
  getBoundary(): Readonly<DriverBoundary>;
  getAuthorityState(): Readonly<TournamentState>;
  prepareOpen(): Promise<PreparedDriverTransition>;
  preparePausedAction(
    seatIndex: number,
    intent: Readonly<ActionIntent>,
    commandIndex: number,
  ): Promise<PreparedDriverTransition>;
  prepareContinueAfterHand(): Promise<PreparedDriverTransition>;
  prepareAuthorityTransition(
    transition: Readonly<TransitionResult>,
    source: 'ability-swap',
    commandIndex: number,
  ): Promise<PreparedDriverTransition>;
  commitPreparedTransition(
    prepared: Readonly<PreparedDriverTransition>,
  ): Readonly<DriverBoundary>;
  discardPreparedTransition(
    prepared: Readonly<PreparedDriverTransition>,
  ): void;
  submitPausedAction(
    seatIndex: number,
    intent: Readonly<ActionIntent>,
    commandIndex: number,
  ): Promise<DriverActionResult>;
  continueAfterHand(): Promise<Readonly<DriverBoundary>>;
}

type ActionSnapshot = Readonly<{
  valid: true;
  intent: ActionIntent;
  attemptedType: ActionIntent['type'];
}> | Readonly<{
  valid: false;
  attemptedType: ActionIntent['type'] | 'unknown';
}>;

interface CandidateDraft {
  readonly state: TournamentState | null;
  readonly eventCount: number;
  readonly batches: readonly Readonly<DriverTransitionBatch>[];
}

interface PreparedInternal {
  readonly owner: object;
  readonly baseRevision: number;
  readonly commitRevision: number;
  readonly commitState: TournamentState;
  readonly commitBoundary: Readonly<DriverBoundary>;
  readonly eventCount: number;
  readonly rejection: Readonly<ActionRejection> | null;
}

const preparedInternals = new WeakMap<object, PreparedInternal>();

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRecursively(child, seen);
  }
  return Object.freeze(value);
}

type ProxyDetector = (value: object) => boolean;

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

function ownDataVersion(value: unknown): number | null | undefined {
  if (proxyDetector === null) return undefined;
  if (typeof value !== 'object' || value === null) return null;
  try {
    if (proxyDetector(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'version');
    return descriptor !== undefined
      && 'value' in descriptor
      && typeof descriptor.value === 'number'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function sameValue(
  left: unknown,
  right: unknown,
  enforceAliasTopology: boolean,
): boolean | null {
  if (proxyDetector === null) return null;
  const leftToRight = new WeakMap<object, object>();
  const rightToLeft = new WeakMap<object, object>();
  const comparedPairs = new WeakMap<object, WeakSet<object>>();
  const compare = (leftValue: unknown, rightValue: unknown): boolean => {
    if (typeof leftValue !== 'object' || leftValue === null
      || typeof rightValue !== 'object' || rightValue === null) {
      return Object.is(leftValue, rightValue);
    }
    if (proxyDetector(leftValue) || proxyDetector(rightValue)) return false;

    if (enforceAliasTopology) {
      const knownRight = leftToRight.get(leftValue);
      const knownLeft = rightToLeft.get(rightValue);
      if (knownRight !== undefined || knownLeft !== undefined) {
        return knownRight === rightValue && knownLeft === leftValue;
      }
      leftToRight.set(leftValue, rightValue);
      rightToLeft.set(rightValue, leftValue);
    } else {
      if (Object.is(leftValue, rightValue)) return true;
      const knownRights = comparedPairs.get(leftValue);
      if (knownRights?.has(rightValue) === true) return true;
      if (knownRights === undefined) {
        comparedPairs.set(leftValue, new WeakSet([rightValue]));
      } else {
        knownRights.add(rightValue);
      }
    }
    if (Object.is(leftValue, rightValue)) return true;

    if (Object.getPrototypeOf(leftValue) !== Object.getPrototypeOf(rightValue)) return false;
    const leftKeys = Reflect.ownKeys(leftValue);
    const rightKeys = Reflect.ownKeys(rightValue);
    if (leftKeys.length !== rightKeys.length) return false;
    const rightKeySet = new Set<PropertyKey>(rightKeys);
    for (const leftKey of leftKeys) {
      if (!rightKeySet.has(leftKey)) return false;
      const leftDescriptor = Object.getOwnPropertyDescriptor(leftValue, leftKey);
      const rightDescriptor = Object.getOwnPropertyDescriptor(rightValue, leftKey);
      if (leftDescriptor === undefined || rightDescriptor === undefined
        || leftDescriptor.configurable !== rightDescriptor.configurable
        || leftDescriptor.enumerable !== rightDescriptor.enumerable) {
        return false;
      }
      const leftIsData = 'value' in leftDescriptor;
      const rightIsData = 'value' in rightDescriptor;
      if (leftIsData !== rightIsData) return false;
      if (leftIsData && rightIsData) {
        if (leftDescriptor.writable !== rightDescriptor.writable
          || !compare(leftDescriptor.value, rightDescriptor.value)) {
          return false;
        }
      } else if (leftDescriptor.get !== rightDescriptor.get
        || leftDescriptor.set !== rightDescriptor.set) {
        return false;
      }
    }
    return true;
  };

  try {
    return compare(left, right);
  } catch {
    return false;
  }
}

function snapshotDecision(decision: ActionDecision): ActionSnapshot {
  let attemptedType: ActionIntent['type'] | 'unknown' = 'unknown';
  try {
    if (typeof decision !== 'object' || decision === null) return { valid: false, attemptedType };
    const action = Reflect.get(decision, 'action') as unknown;
    if (typeof action !== 'object' || action === null) return { valid: false, attemptedType };
    const type = Reflect.get(action, 'type') as unknown;
    if (type !== 'fold' && type !== 'check' && type !== 'call'
      && type !== 'raiseTo' && type !== 'allIn') {
      return { valid: false, attemptedType };
    }
    attemptedType = type;
    if (type !== 'raiseTo') return { valid: true, attemptedType, intent: { type } };
    const amount = Reflect.get(action, 'amount') as unknown;
    if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
      return { valid: false, attemptedType };
    }
    return {
      valid: true,
      attemptedType,
      intent: { type: 'raiseTo', amount: amount as number },
    };
  } catch {
    return { valid: false, attemptedType };
  }
}

function requireCommandIndex(commandIndex: number): void {
  if (!Number.isSafeInteger(commandIndex) || commandIndex < 0) {
    throw new Error('commandIndex must be a non-negative safe integer');
  }
}

function validateOptions(options: Readonly<TournamentDriverOptions>): number {
  if (typeof options.runSeed !== 'string' || options.runSeed.length === 0) {
    throw new Error('runSeed must be non-empty');
  }
  if (!Array.isArray(options.seats)
    || !Array.isArray(options.participants)
    || options.seats.length !== options.config.maxSeats
    || options.participants.length !== options.config.maxSeats) {
    throw new Error('seat and participant count must equal maxSeats');
  }

  const playerIds = new Set<string>();
  for (let seatIndex = 0; seatIndex < options.seats.length; seatIndex += 1) {
    const seat = options.seats[seatIndex];
    if (seat === undefined
      || seat.seatIndex !== seatIndex
      || !Number.isSafeInteger(seat.seatIndex)) {
      throw new Error('seat indexes must be contiguous from zero');
    }
    if (typeof seat.playerId !== 'string'
      || seat.playerId.length === 0
      || playerIds.has(seat.playerId)) {
      throw new Error('seat playerId values must be non-empty and unique');
    }
    playerIds.add(seat.playerId);
  }

  if (!Array.isArray(options.pauseSeatIndexes)) {
    throw new Error('pauseSeatIndexes must be an array');
  }
  const pauseSeats = new Set<number>();
  for (const seatIndex of options.pauseSeatIndexes) {
    if (!Number.isSafeInteger(seatIndex)
      || seatIndex < 0
      || seatIndex >= options.config.maxSeats
      || pauseSeats.has(seatIndex)) {
      throw new Error('pause seat indexes must be unique physical seats');
    }
    pauseSeats.add(seatIndex);
  }

  for (let seatIndex = 0; seatIndex < options.participants.length; seatIndex += 1) {
    const participant = options.participants[seatIndex];
    if (participant === null) {
      if (!pauseSeats.has(seatIndex)) {
        throw new Error('a null participant provider must identify a paused seat');
      }
      continue;
    }
    if (typeof participant !== 'object'
      || participant.playerId !== options.seats[seatIndex]!.playerId
      || typeof participant.decide !== 'function') {
      throw new Error('participant provider playerId must match its seat descriptor');
    }
  }

  const maximum = options.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new Error('maxTransitions must be a positive safe integer');
  }
  if (options.invalidAgentActionMode !== undefined
    && options.invalidAgentActionMode !== 'throw'
    && options.invalidAgentActionMode !== 'fallback') {
    throw new Error('invalidAgentActionMode must be throw or fallback');
  }
  return maximum;
}

function currentDecisionIndex(state: TournamentState): number {
  const handId = state.activeHand?.handId;
  if (handId === undefined) return 0;
  return state.eventLog.filter(
    (event) => event.type === 'PlayerActed' && event.handId === handId,
  ).length;
}

function safeDriverError(message: string): Error {
  return new Error(message);
}

function canonicalizeReplayAliases(state: TournamentState): TournamentState {
  const hand = state.activeHand;
  if (hand?.showdownRanks === undefined || hand.evaluatedHands === undefined) return state;
  const trustedRanks = new Map(hand.showdownRanks.map((evaluation) => [
    evaluation.seat,
    evaluation.rank,
  ] as const));
  const evaluatedHands = hand.evaluatedHands.map((evaluation) => ({
    ...evaluation,
    rank: trustedRanks.get(evaluation.seat) ?? evaluation.rank,
  }));
  const eventLog = state.eventLog.map((event) => event.type === 'HandEvaluated'
    && event.handId === hand.handId
    ? { ...event, rank: trustedRanks.get(event.seat) ?? event.rank }
    : event);
  return {
    ...state,
    eventLog,
    activeHand: { ...hand, evaluatedHands },
  };
}

class TournamentDriverImplementation implements TournamentDriver {
  readonly #options: Readonly<TournamentDriverOptions>;
  readonly #maximum: number;
  readonly #pauseSeats: ReadonlySet<number>;
  readonly #owner = Object.freeze({});
  #committedState: TournamentState | null = null;
  #committedBoundary: Readonly<DriverBoundary> | null = null;
  #committedEventCount = 0;
  #committedRevision = 0;
  #activeLease: object | null = null;

  public constructor(options: Readonly<TournamentDriverOptions>) {
    this.#maximum = validateOptions(options);
    this.#options = options;
    this.#pauseSeats = new Set(options.pauseSeatIndexes);
  }

  public getBoundary(): Readonly<DriverBoundary> {
    if (this.#committedBoundary === null) throw new Error(UNCOMMITTED_MESSAGE);
    return this.#committedBoundary;
  }

  public getAuthorityState(): Readonly<TournamentState> {
    if (this.#committedState === null) throw new Error(UNCOMMITTED_MESSAGE);
    return this.#committedState;
  }

  #beginPrepare(): object {
    if (this.#activeLease !== null) throw new Error(BUSY_MESSAGE);
    const pending = Object.freeze({});
    this.#activeLease = pending;
    return pending;
  }

  #releasePending(pending: object): void {
    if (this.#activeLease === pending) this.#activeLease = null;
  }

  async #appendCandidateTransition(
    transition: Readonly<TransitionResult>,
    source: DriverTransitionSource,
    commandIndex: number | null,
    draft: CandidateDraft,
  ): Promise<CandidateDraft> {
    const before = draft.state;
    let candidate = before;
    let candidateEventCount = draft.eventCount;
    for (const event of transition.events) {
      if (candidateEventCount >= this.#maximum) {
        throw safeDriverError('Tournament event guard exceeded');
      }
      candidate = reduceDomainEvent(candidate, event);
      assertTournamentInvariants(candidate);
      candidateEventCount += 1;
    }
    if (candidate !== null
      && transition.events.some((event) => event.type === 'HandEvaluated')) {
      candidate = canonicalizeReplayAliases(candidate);
    }
    if (candidate === null || candidateEventCount !== candidate.version) {
      throw safeDriverError('Tournament transition version mismatch');
    }
    const suppliedVersion = ownDataVersion(transition.state);
    if (suppliedVersion !== undefined
      && suppliedVersion !== null
      && suppliedVersion !== candidateEventCount) {
      throw safeDriverError('Tournament transition version mismatch');
    }
    const replayMatches = sameValue(
      candidate,
      transition.state,
      transition.events.length === 0,
    );
    if (replayMatches === false
      || (replayMatches === null
        && transition.events.length === 0
        && !Object.is(candidate, transition.state))) {
      throw safeDriverError('Tournament transition replay mismatch');
    }
    const batch = freezeRecursively({
      source,
      commandIndex,
      beforeVersion: before?.version ?? 0,
      afterVersion: candidate.version,
      authorityEvents: structuredClone(transition.events),
    });
    await this.#options.onAcceptedTransition?.(batch);
    return {
      state: candidate,
      eventCount: candidateEventCount,
      batches: [...draft.batches, batch],
    };
  }

  #decisionBoundary(state: TournamentState, seatIndex: number): Readonly<DriverBoundary> {
    const observation = projectObservation(state, seatIndex);
    if (observation.decisionIndex !== currentDecisionIndex(state)) {
      throw safeDriverError('Tournament decision index mismatch');
    }
    return freezeRecursively({ kind: 'decision', seatIndex, observation });
  }

  #boundaryForState(state: TournamentState): Readonly<DriverBoundary> {
    const hand = state.activeHand;
    if (hand?.phase === 'hand-complete') {
      return Object.freeze({ kind: 'hand-complete', handNumber: state.handNumber });
    }
    if (hand?.phase === 'game-complete') {
      const winner = state.seats.find((seat) => seat.stack > 0 && seat.status !== 'eliminated');
      if (winner === undefined) throw safeDriverError('Tournament completed without a winner');
      return Object.freeze({ kind: 'game-complete', winnerSeatIndex: winner.seatIndex });
    }
    const seatIndex = hand?.currentActorSeat;
    if (seatIndex === null || seatIndex === undefined) {
      throw safeDriverError('Tournament stalled without a current actor');
    }
    return this.#decisionBoundary(state, seatIndex);
  }

  async #advanceToBoundary(initial: CandidateDraft): Promise<Readonly<{
    draft: CandidateDraft & { readonly state: TournamentState };
    boundary: Readonly<DriverBoundary>;
  }>> {
    let draft = initial;
    while (true) {
      const state = draft.state;
      if (state === null) throw safeDriverError('Tournament candidate is not initialized');
      const automatic = advanceAutomaticPhases(state);
      if (automatic.events.length > 0) {
        draft = await this.#appendCandidateTransition(automatic, 'automatic', null, draft);
        continue;
      }

      const phase = draft.state!.activeHand?.phase;
      if (phase === 'hand-complete' || phase === 'game-complete') {
        return { draft: draft as CandidateDraft & { state: TournamentState }, boundary: this.#boundaryForState(draft.state!) };
      }
      const seatIndex = draft.state!.activeHand?.currentActorSeat;
      if (seatIndex === null || seatIndex === undefined) {
        throw safeDriverError('Tournament stalled without a current actor');
      }
      if (this.#pauseSeats.has(seatIndex)) {
        return {
          draft: draft as CandidateDraft & { state: TournamentState },
          boundary: this.#decisionBoundary(draft.state!, seatIndex),
        };
      }

      const participant = this.#options.participants[seatIndex];
      if (participant === undefined || participant === null) {
        throw safeDriverError('Tournament actor has no physical participant');
      }
      const observation = projectObservation(draft.state!, seatIndex);
      const decisionIndex = currentDecisionIndex(draft.state!);
      if (observation.decisionIndex !== decisionIndex) {
        throw safeDriverError('Tournament decision index mismatch');
      }
      const context: Readonly<DecisionContext> = Object.freeze({
        observation,
        random: createSeededRandom(
          this.#options.runSeed,
          `agent/${draft.state!.handNumber}/${seatIndex}/${decisionIndex}`,
        ),
      });
      const snapshot = snapshotDecision(await participant.decide(context));
      let attemptedType: ActionIntent['type'] | 'unknown';
      let rejectionCode: ControllerDiagnosticEvent['rejectionCode'];
      if (!snapshot.valid) {
        attemptedType = snapshot.attemptedType;
        rejectionCode = 'malformed-decision';
      } else {
        const attempted = applyIntent(draft.state!, seatIndex, snapshot.intent);
        if (attempted.accepted) {
          draft = await this.#appendCandidateTransition(attempted, 'npc', null, draft);
          continue;
        }
        attemptedType = snapshot.attemptedType;
        rejectionCode = attempted.rejection.code;
      }

      if ((this.#options.invalidAgentActionMode ?? 'throw') === 'throw') {
        throw new Error(rejectionCode === 'malformed-decision'
          ? 'Agent returned a malformed action decision'
          : `Agent action rejected: ${rejectionCode}`);
      }
      const fallbackAction = observation.legalActions.check ? 'check' : 'fold';
      const diagnostic: ControllerDiagnosticEvent = Object.freeze({
        type: 'AgentInvalidAction',
        playerId: participant.playerId,
        seatIndex,
        handNumber: draft.state!.handNumber,
        decisionIndex,
        attemptedType,
        rejectionCode,
        fallbackAction,
      });
      await this.#options.onDiagnostic?.(diagnostic);
      const fallback = applyIntent(draft.state!, seatIndex, { type: fallbackAction });
      if (!fallback.accepted) {
        throw safeDriverError('Controller fallback action was rejected');
      }
      draft = await this.#appendCandidateTransition(fallback, 'npc', null, draft);
    }
  }

  #publishPrepared(
    pending: object,
    draft: CandidateDraft & { readonly state: TournamentState },
    boundary: Readonly<DriverBoundary>,
    rejection: Readonly<ActionRejection> | null,
  ): PreparedDriverTransition {
    const prepared = freezeRecursively({
      candidateBoundary: boundary,
      candidateAuthorityState: freezeRecursively(structuredClone(draft.state)),
      transitionBatches: freezeRecursively([...draft.batches]),
      rejection: rejection === null ? null : freezeRecursively(structuredClone(rejection)),
    }) as unknown as PreparedDriverTransition;
    const internal: PreparedInternal = {
      owner: this.#owner,
      baseRevision: this.#committedRevision,
      commitRevision: this.#committedRevision + 1,
      commitState: draft.state,
      commitBoundary: boundary,
      eventCount: draft.eventCount,
      rejection,
    };
    preparedInternals.set(prepared, internal);
    if (this.#activeLease !== pending) throw new Error(BUSY_MESSAGE);
    this.#activeLease = prepared;
    return prepared;
  }

  public async prepareOpen(): Promise<PreparedDriverTransition> {
    const pending = this.#beginPrepare();
    try {
      if (this.#committedState !== null) throw new Error('Tournament driver is already open');
      let draft: CandidateDraft = { state: null, eventCount: 0, batches: [] };
      draft = await this.#appendCandidateTransition(
        createTournament(this.#options.config, this.#options.seats, this.#options.runSeed),
        'automatic',
        null,
        draft,
      );
      draft = await this.#appendCandidateTransition(
        startHand(draft.state!),
        'automatic',
        null,
        draft,
      );
      const advanced = await this.#advanceToBoundary(draft);
      return this.#publishPrepared(pending, advanced.draft, advanced.boundary, null);
    } catch (error) {
      this.#releasePending(pending);
      throw error;
    }
  }

  public async preparePausedAction(
    seatIndex: number,
    intent: Readonly<ActionIntent>,
    commandIndex: number,
  ): Promise<PreparedDriverTransition> {
    const pending = this.#beginPrepare();
    try {
      requireCommandIndex(commandIndex);
      const state = this.#committedState;
      const boundary = this.#committedBoundary;
      if (state === null || boundary === null) throw new Error(UNCOMMITTED_MESSAGE);
      if (boundary.kind !== 'decision') {
        throw new Error('preparePausedAction requires a decision boundary');
      }
      if (boundary.seatIndex !== seatIndex || !this.#pauseSeats.has(seatIndex)) {
        throw new Error('preparePausedAction requires the current paused seat');
      }
      const attempted = applyIntent(state, seatIndex, intent);
      const baseDraft: CandidateDraft & { readonly state: TournamentState } = {
        state,
        eventCount: this.#committedEventCount,
        batches: [],
      };
      if (!attempted.accepted) {
        return this.#publishPrepared(pending, baseDraft, boundary, attempted.rejection);
      }
      const draft = await this.#appendCandidateTransition(
        attempted,
        'human-poker',
        commandIndex,
        baseDraft,
      );
      const advanced = await this.#advanceToBoundary(draft);
      return this.#publishPrepared(pending, advanced.draft, advanced.boundary, null);
    } catch (error) {
      this.#releasePending(pending);
      throw error;
    }
  }

  public async prepareContinueAfterHand(): Promise<PreparedDriverTransition> {
    const pending = this.#beginPrepare();
    try {
      const state = this.#committedState;
      const boundary = this.#committedBoundary;
      if (state === null || boundary === null) throw new Error(UNCOMMITTED_MESSAGE);
      if (boundary.kind !== 'hand-complete') {
        throw new Error('prepareContinueAfterHand requires a hand-complete boundary');
      }
      let draft: CandidateDraft = {
        state,
        eventCount: this.#committedEventCount,
        batches: [],
      };
      draft = await this.#appendCandidateTransition(
        startNextHand(state),
        'automatic',
        null,
        draft,
      );
      const advanced = await this.#advanceToBoundary(draft);
      return this.#publishPrepared(pending, advanced.draft, advanced.boundary, null);
    } catch (error) {
      this.#releasePending(pending);
      throw error;
    }
  }

  public async prepareAuthorityTransition(
    transition: Readonly<TransitionResult>,
    source: 'ability-swap',
    commandIndex: number,
  ): Promise<PreparedDriverTransition> {
    const pending = this.#beginPrepare();
    try {
      requireCommandIndex(commandIndex);
      if (source !== 'ability-swap') throw new Error('unsupported authority transition source');
      const state = this.#committedState;
      if (state === null || this.#committedBoundary === null) throw new Error(UNCOMMITTED_MESSAGE);
      const draft = await this.#appendCandidateTransition(
        transition,
        source,
        commandIndex,
        { state, eventCount: this.#committedEventCount, batches: [] },
      );
      const commitState = draft.state!;
      const boundary = this.#boundaryForState(commitState);
      return this.#publishPrepared(
        pending,
        draft as CandidateDraft & { readonly state: TournamentState },
        boundary,
        null,
      );
    } catch (error) {
      this.#releasePending(pending);
      throw error;
    }
  }

  public commitPreparedTransition(
    prepared: Readonly<PreparedDriverTransition>,
  ): Readonly<DriverBoundary> {
    const internal = preparedInternals.get(prepared);
    if (internal === undefined
      || internal.owner !== this.#owner
      || internal.baseRevision !== this.#committedRevision
      || this.#activeLease !== prepared
      || internal.rejection !== null) {
      throw new Error(INVALID_PREPARED_MESSAGE);
    }
    this.#committedState = internal.commitState;
    this.#committedBoundary = internal.commitBoundary;
    this.#committedEventCount = internal.eventCount;
    this.#committedRevision = internal.commitRevision;
    this.#activeLease = null;
    return internal.commitBoundary;
  }

  public discardPreparedTransition(prepared: Readonly<PreparedDriverTransition>): void {
    const internal = preparedInternals.get(prepared);
    if (internal === undefined
      || internal.owner !== this.#owner
      || internal.baseRevision !== this.#committedRevision
      || this.#activeLease !== prepared) {
      throw new Error(INVALID_PREPARED_MESSAGE);
    }
    this.#activeLease = null;
  }

  public async submitPausedAction(
    seatIndex: number,
    intent: Readonly<ActionIntent>,
    commandIndex: number,
  ): Promise<DriverActionResult> {
    const prepared = await this.preparePausedAction(seatIndex, intent, commandIndex);
    if (prepared.rejection !== null) {
      const rejection = prepared.rejection;
      this.discardPreparedTransition(prepared);
      return Object.freeze({ accepted: false, rejection });
    }
    return Object.freeze({
      accepted: true,
      boundary: this.commitPreparedTransition(prepared),
    });
  }

  public async continueAfterHand(): Promise<Readonly<DriverBoundary>> {
    const prepared = await this.prepareContinueAfterHand();
    return this.commitPreparedTransition(prepared);
  }
}

export function createTournamentDriver(
  options: Readonly<TournamentDriverOptions>,
): TournamentDriver {
  return new TournamentDriverImplementation(options);
}

export async function openTournamentDriver(
  options: Readonly<TournamentDriverOptions>,
): Promise<TournamentDriver> {
  const driver = createTournamentDriver(options);
  const prepared = await driver.prepareOpen();
  driver.commitPreparedTransition(prepared);
  return driver;
}
