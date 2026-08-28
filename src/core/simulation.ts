import type { TournamentConfig } from './config.js';
import { advanceAutomaticPhases } from './dealing.js';
import { assertTournamentInvariants } from './invariants.js';
import { getLegalActions, type ActionIntent, type LegalActionSet } from './legal-actions.js';
import { createSeededRandom } from './random.js';
import { applyIntent } from './reducer.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  type TournamentSeatInput,
  type TournamentState,
  type TransitionResult,
} from './state.js';
import type { RandomSource } from './types.js';

export interface RandomHandResult {
  readonly state: TournamentState;
  readonly seed: string;
  readonly playerCount: number;
  readonly configurationKey: string;
  readonly transitionCount: number;
  readonly eventCount: number;
  readonly invariantCheckCount: number;
  readonly transitionReplayCheckCount: number;
}

function uniqueRaises(range: NonNullable<LegalActionSet['raiseTo']>): number[] {
  const midpoint = range.min + Math.floor((range.max - range.min) / 2);
  return [...new Set([range.min, midpoint, range.max])];
}

export function chooseRandomLegalAction(
  legal: LegalActionSet,
  random: RandomSource,
): ActionIntent {
  const candidates: ActionIntent[] = [];
  if (legal.fold) candidates.push({ type: 'fold' });
  if (legal.check) candidates.push({ type: 'check' });
  if (legal.call !== null) candidates.push({ type: 'call' });
  if (legal.raiseTo !== null) {
    candidates.push(...uniqueRaises(legal.raiseTo).map((amount): ActionIntent => ({
      type: 'raiseTo',
      amount,
    })));
  }
  if (legal.allIn !== null) candidates.push({ type: 'allIn' });
  if (candidates.length === 0) {
    throw new Error('cannot sample an empty legal action set');
  }
  return candidates[random.nextUint32() % candidates.length]!;
}

export function runRandomHand(
  config: TournamentConfig,
  seats: readonly TournamentSeatInput[],
  runSeed: string,
): RandomHandResult {
  const random = createSeededRandom(runSeed, 'random-hand-actions');
  let transitionCount = 0;
  let invariantCheckCount = 0;
  let transitionReplayCheckCount = 0;

  const created = createTournament(config, seats, runSeed);
  let current = created.state;
  assertTournamentInvariants(current);
  invariantCheckCount += 1;

  const acceptEvents = (before: TournamentState, transition: TransitionResult): TournamentState => {
    let prefix = before;
    for (const event of transition.events) {
      prefix = reduceDomainEvent(prefix, event);
      transitionCount += 1;
      if (transitionCount > 500) {
        const tail = prefix.eventLog.slice(-8);
        throw new Error(`random hand exceeded 500 transitions: ${JSON.stringify({
          seed: runSeed,
          playerCount: config.maxSeats,
          version: prefix.version,
          tail,
        })}`);
      }
      assertTournamentInvariants(prefix);
      invariantCheckCount += 1;
    }
    if (JSON.stringify(prefix) !== JSON.stringify(transition.state)) {
      throw new Error('transition state must deep-equal reduction of its emitted event prefix');
    }
    transitionReplayCheckCount += 1;
    return prefix;
  };

  current = acceptEvents(current, startHand(current));
  while (current.activeHand?.phase !== 'hand-complete') {
    const automatic = advanceAutomaticPhases(current);
    if (automatic.events.length > 0) {
      current = acceptEvents(current, automatic);
      continue;
    }
    const actor = current.activeHand?.currentActorSeat;
    if (actor === null || actor === undefined) {
      throw new Error(`random hand stalled without an actor: ${JSON.stringify({
        seed: runSeed,
        playerCount: config.maxSeats,
        version: current.version,
        tail: current.eventLog.slice(-8),
      })}`);
    }
    const intent = chooseRandomLegalAction(getLegalActions(current, actor), random);
    const applied = applyIntent(current, actor, intent);
    if (!applied.accepted) {
      throw new Error(`legal action sampler produced rejected action: ${applied.rejection.code}`);
    }
    current = acceptEvents(current, applied);
  }

  return {
    state: current,
    seed: runSeed,
    playerCount: config.maxSeats,
    configurationKey: `${config.startingStack}/${config.blindLevels[0]!.smallBlind}/${config.blindLevels[0]!.bigBlind}`,
    transitionCount,
    eventCount: current.eventLog.length,
    invariantCheckCount,
    transitionReplayCheckCount,
  };
}
