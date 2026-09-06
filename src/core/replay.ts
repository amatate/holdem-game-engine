import { validateTournamentInputs, type TournamentConfig } from './config.js';
import type { DomainEvent, GameStartedEvent } from './events.js';
import { assertTournamentInvariants, TournamentInvariantError } from './invariants.js';
import { reduceDomainEvent, type TournamentSeatInput, type TournamentState } from './state.js';
import {
  EVENT_SCHEMA_VERSION,
  RNG_ALGORITHM_VERSION,
  RULES_VERSION,
  SHUFFLE_ALGORITHM_VERSION,
  STRATEGY_VERSION,
} from './versions.js';

export interface ReplayEnvelopeV1 {
  readonly containsPrivateData: true;
  readonly schemaVersion: 1;
  readonly rulesVersion: 'holdem-v1';
  readonly rngVersion: 'mulberry32-v1';
  readonly shuffleVersion: 'fisher-yates-v1';
  readonly strategyVersion: 'parametric-v1';
  readonly initialConfig: TournamentConfig;
  readonly seats: readonly TournamentSeatInput[];
  readonly runSeed: string;
  readonly events: readonly DomainEvent[];
}

export class ReplayVersionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ReplayVersionError';
  }
}

export class ReplayHeaderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ReplayHeaderError';
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateVersions(envelope: ReplayEnvelopeV1): void {
  if (envelope.schemaVersion !== EVENT_SCHEMA_VERSION) {
    throw new ReplayVersionError('unsupported replay schema version');
  }
  if (envelope.rulesVersion !== RULES_VERSION) {
    throw new ReplayVersionError('unsupported replay rules version');
  }
  if (envelope.rngVersion !== RNG_ALGORITHM_VERSION) {
    throw new ReplayVersionError('unsupported replay RNG version');
  }
  if (envelope.shuffleVersion !== SHUFFLE_ALGORITHM_VERSION) {
    throw new ReplayVersionError('unsupported replay shuffle version');
  }
  if (envelope.strategyVersion !== STRATEGY_VERSION) {
    throw new ReplayVersionError('unsupported replay strategy version');
  }
}

function validateEventStream(envelope: ReplayEnvelopeV1): GameStartedEvent {
  if (envelope.containsPrivateData !== true) {
    throw new ReplayHeaderError('exact replay requires a private-data envelope');
  }
  try {
    validateTournamentInputs(envelope.initialConfig, envelope.seats);
  } catch (error) {
    throw new ReplayHeaderError(`invalid replay tournament header: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (envelope.events.length === 0 || envelope.events[0]?.type !== 'GameStarted') {
    throw new ReplayHeaderError('replay must begin with exactly one GameStarted event');
  }
  if (envelope.events.filter((event) => event.type === 'GameStarted').length !== 1) {
    throw new ReplayHeaderError('replay must contain exactly one GameStarted event');
  }
  for (const [index, event] of envelope.events.entries()) {
    if (event.type === 'HoleCardReplaced') {
      throw new ReplayHeaderError('classic replay cannot contain ability replacements');
    }
    if (event.schemaVersion !== EVENT_SCHEMA_VERSION || event.eventIndex !== index) {
      throw new ReplayHeaderError('replay events require supported schema and contiguous indices');
    }
    if (event.type === 'DeckPrepared' && event.shuffleVersion !== envelope.shuffleVersion) {
      throw new ReplayHeaderError('DeckPrepared shuffle version disagrees with replay header');
    }
  }

  const started = envelope.events[0];
  if (started.type !== 'GameStarted') {
    throw new ReplayHeaderError('replay must begin with GameStarted');
  }
  if (!sameValue(started.config, envelope.initialConfig)
    || !sameValue(started.seats, envelope.seats)
    || started.runSeed !== envelope.runSeed
    || started.rulesVersion !== envelope.rulesVersion
    || started.rngVersion !== envelope.rngVersion
    || started.shuffleVersion !== envelope.shuffleVersion
    || started.strategyVersion !== envelope.strategyVersion) {
    throw new ReplayHeaderError('replay header disagrees with GameStarted');
  }
  return started;
}

export function replayTournament(envelope: ReplayEnvelopeV1): TournamentState {
  validateVersions(envelope);
  validateEventStream(envelope);

  let state: TournamentState | null = null;
  for (const event of envelope.events) {
    try {
      state = reduceDomainEvent(state, event);
      assertTournamentInvariants(state);
    } catch (error) {
      if (error instanceof TournamentInvariantError) throw error;
      throw new TournamentInvariantError(
        `replay event violates domain authority: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (state === null) {
    throw new ReplayHeaderError('replay contains no reducible state');
  }
  return state;
}
