import type { TournamentConfig } from '../core/config.js';
import type { DomainEvent } from '../core/events.js';
import type {
  ActionIntent,
  ActionRejectionCode,
} from '../core/legal-actions.js';
import {
  projectEventsForViewer,
  type PublicGameEvent,
} from '../core/public-events.js';
import type { TournamentState } from '../core/state.js';
import type { Participant } from './participant.js';
import {
  openTournamentDriver,
  type DriverTransitionBatch,
} from './tournament-driver.js';

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

export async function runTournament(
  options: Readonly<RunTournamentOptions>,
): Promise<TournamentState> {
  validateOptions(options);
  const driver = await openTournamentDriver({
    config: options.config,
    runSeed: options.runSeed,
    seats: options.participants.map((participant, seatIndex) => ({
      playerId: participant.playerId,
      seatIndex,
    })),
    participants: options.participants,
    pauseSeatIndexes: [],
    ...(options.maxTransitions === undefined ? {} : { maxTransitions: options.maxTransitions }),
    ...(options.invalidAgentActionMode === undefined
      ? {}
      : { invalidAgentActionMode: options.invalidAgentActionMode }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    onAcceptedTransition: async (batch: Readonly<DriverTransitionBatch>) => {
      if (batch.authorityEvents.length > 0) {
        await options.onAuthorityEvents?.(batch.authorityEvents);
      }
      const projected = projectEventsForViewer(
        batch.authorityEvents,
        options.publicViewerSeatIndex ?? null,
      );
      if (projected.length > 0) await options.onPublicEvents?.(projected);
    },
  });

  while (true) {
    const boundary = driver.getBoundary();
    if (boundary.kind === 'hand-complete') {
      await driver.continueAfterHand();
      continue;
    }
    if (boundary.kind === 'game-complete') return driver.getAuthorityState();
    throw new Error('Tournament driver returned a decision boundary without paused seats');
  }
}
