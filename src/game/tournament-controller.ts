import { projectObservation } from '../agents/observation.js';
import type { ActionDecision, DecisionContext } from '../agents/types.js';
import type { TournamentConfig } from '../core/config.js';
import { advanceAutomaticPhases } from '../core/dealing.js';
import type { DomainEvent } from '../core/events.js';
import { assertTournamentInvariants } from '../core/invariants.js';
import type {
  ActionIntent,
  ActionRejectionCode,
} from '../core/legal-actions.js';
import {
  projectEventsForViewer,
  type PublicGameEvent,
} from '../core/public-events.js';
import { createSeededRandom } from '../core/random.js';
import { applyIntent } from '../core/reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  startNextHand,
  type TournamentState,
  type TransitionResult,
} from '../core/state.js';
import type { Participant } from './participant.js';

const DEFAULT_MAX_TRANSITIONS = 20_000;

export type ControllerDiagnosticEvent = Readonly<{
  type: 'AgentInvalidAction';
  playerId: string;
  seatIndex: number;
  handNumber: number;
  decisionIndex: number;
  attemptedType: ActionIntent['type'] | 'unknown';
  rejectionCode: ActionRejectionCode | 'malformed-decision';
  fallbackAction: 'check' | 'fold';
}>;

export interface RunTournamentOptions {
  readonly config: TournamentConfig;
  readonly participants: readonly Participant[];
  readonly runSeed: string;
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly publicViewerSeatIndex?: number | null;
  readonly onPublicEvents?: (
    events: readonly PublicGameEvent[],
  ) => void | Promise<void>;
  readonly onAuthorityEvents?: (
    events: readonly DomainEvent[],
  ) => void | Promise<void>;
  readonly onDiagnostic?: (
    event: ControllerDiagnosticEvent,
  ) => void | Promise<void>;
}

type ActionSnapshot = Readonly<{
  valid: true;
  intent: ActionIntent;
  attemptedType: ActionIntent['type'];
}> | Readonly<{
  valid: false;
  attemptedType: ActionIntent['type'] | 'unknown';
}>;

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRecursively(child, seen);
  }
  return Object.freeze(value);
}

function cloneFrozenEvents(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return freezeRecursively(structuredClone(events));
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
    if (type !== 'raiseTo') {
      return { valid: true, attemptedType, intent: { type } };
    }
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

function validateOptions(options: Readonly<RunTournamentOptions>): number {
  if (typeof options.runSeed !== 'string' || options.runSeed.length === 0) {
    throw new Error('runSeed must be non-empty');
  }
  if (!Array.isArray(options.participants)
    || options.participants.length !== options.config.maxSeats) {
    throw new Error('participant count must equal maxSeats');
  }
  const ids = new Set<string>();
  for (const participant of options.participants) {
    if (typeof participant?.playerId !== 'string'
      || participant.playerId.length === 0
      || ids.has(participant.playerId)) {
      throw new Error('participant playerId values must be non-empty and unique');
    }
    ids.add(participant.playerId);
  }
  const maximum = options.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new Error('maxTransitions must be a positive safe integer');
  }
  const viewer = options.publicViewerSeatIndex;
  if (viewer !== undefined && viewer !== null
    && (!Number.isSafeInteger(viewer) || viewer < 0 || viewer >= options.config.maxSeats)) {
    throw new Error('publicViewerSeatIndex must identify a physical seat');
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

function safeControllerError(
  message: string,
  state: TournamentState | null,
  runSeed: string,
  publicTail: readonly PublicGameEvent[],
): Error {
  return new Error(`${message}: ${JSON.stringify({
    seed: runSeed,
    handNumber: state?.handNumber ?? 0,
    version: state?.version ?? 0,
    publicEvents: publicTail.slice(-20),
  })}`);
}

export async function runTournament(
  options: Readonly<RunTournamentOptions>,
): Promise<TournamentState> {
  const maxTransitions = validateOptions(options);
  const viewer = options.publicViewerSeatIndex ?? null;
  const invalidMode = options.invalidAgentActionMode ?? 'throw';
  const seats = options.participants.map((participant, seatIndex) => ({
    playerId: participant.playerId,
    seatIndex,
  }));
  let state: TournamentState | null = null;
  let eventCount = 0;
  let publicTail: PublicGameEvent[] = [];

  const acceptTransition = async (transition: Readonly<TransitionResult>): Promise<void> => {
    const before = state;
    let replayed = before;
    for (const event of transition.events) {
      if (eventCount >= maxTransitions) {
        throw safeControllerError('Tournament event guard exceeded', before, options.runSeed, publicTail);
      }
      replayed = reduceDomainEvent(replayed, event);
      assertTournamentInvariants(replayed);
      eventCount += 1;
    }
    if (replayed === null || !sameValue(replayed, transition.state)) {
      throw safeControllerError('Tournament transition replay mismatch', before, options.runSeed, publicTail);
    }
    if (eventCount !== transition.state.version) {
      throw safeControllerError('Tournament event count mismatch', before, options.runSeed, publicTail);
    }
    state = transition.state;

    const spectatorEvents = projectEventsForViewer(transition.events, null);
    publicTail = [...publicTail, ...spectatorEvents].slice(-20);
    if (options.onAuthorityEvents !== undefined && transition.events.length > 0) {
      await options.onAuthorityEvents(cloneFrozenEvents(transition.events));
    }
    const projected = projectEventsForViewer(transition.events, viewer);
    if (options.onPublicEvents !== undefined && projected.length > 0) {
      await options.onPublicEvents(projected);
    }
  };

  await acceptTransition(createTournament(options.config, seats, options.runSeed));
  await acceptTransition(startHand(state!));

  while (true) {
    const automatic = advanceAutomaticPhases(state!);
    if (automatic.events.length > 0) {
      await acceptTransition(automatic);
      continue;
    }

    const phase = state!.activeHand?.phase;
    if (phase === 'hand-complete') {
      await acceptTransition(startNextHand(state!));
      continue;
    }
    if (phase === 'game-complete') return state!;

    const seatIndex = state!.activeHand?.currentActorSeat;
    if (seatIndex === null || seatIndex === undefined) {
      throw safeControllerError('Tournament stalled without a current actor', state, options.runSeed, publicTail);
    }
    const participant = options.participants[seatIndex];
    if (participant === undefined) {
      throw safeControllerError('Tournament actor has no physical participant', state, options.runSeed, publicTail);
    }
    const observation = projectObservation(state!, seatIndex);
    const decisionIndex = currentDecisionIndex(state!);
    if (observation.decisionIndex !== decisionIndex) {
      throw safeControllerError('Tournament decision index mismatch', state, options.runSeed, publicTail);
    }
    const context: Readonly<DecisionContext> = Object.freeze({
      observation,
      random: createSeededRandom(
        options.runSeed,
        `agent/${state!.handNumber}/${seatIndex}/${decisionIndex}`,
      ),
    });
    const decision = await participant.decide(context);
    const snapshot = snapshotDecision(decision);

    let attemptedType: ActionIntent['type'] | 'unknown';
    let rejectionCode: ActionRejectionCode | 'malformed-decision';
    if (!snapshot.valid) {
      attemptedType = snapshot.attemptedType;
      rejectionCode = 'malformed-decision';
    } else {
      const attempted = applyIntent(state!, seatIndex, snapshot.intent);
      if (attempted.accepted) {
        await acceptTransition(attempted);
        continue;
      }
      attemptedType = snapshot.attemptedType;
      rejectionCode = attempted.rejection.code;
    }

    if (invalidMode === 'throw') {
      throw new Error(rejectionCode === 'malformed-decision'
        ? 'Agent returned a malformed action decision'
        : `Agent action rejected: ${rejectionCode}`);
    }

    const fallbackAction = observation.legalActions.check ? 'check' : 'fold';
    const diagnostic: ControllerDiagnosticEvent = Object.freeze({
      type: 'AgentInvalidAction',
      playerId: participant.playerId,
      seatIndex,
      handNumber: state!.handNumber,
      decisionIndex,
      attemptedType,
      rejectionCode,
      fallbackAction,
    });
    if (options.onDiagnostic !== undefined) await options.onDiagnostic(diagnostic);
    const fallback = applyIntent(state!, seatIndex, { type: fallbackAction });
    if (!fallback.accepted) {
      throw safeControllerError('Controller fallback action was rejected', state, options.runSeed, publicTail);
    }
    await acceptTransition(fallback);
  }
}
