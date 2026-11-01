import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deepFreezeObservation, projectObservation } from '../agents/observation.js';
import type { ActionDecision, DecisionContext, PokerAgent } from '../agents/types.js';
import { assertTournamentInvariants } from '../core/invariants.js';
import type { ActionIntent, LegalActionSet } from '../core/legal-actions.js';
import { createSeededRandom } from '../core/random.js';
import { advanceAutomaticPhases, applyIntent } from '../core/reducer.js';
import { createTournament, startHand, type TournamentState } from '../core/state.js';
import { RULES_VERSION, RNG_ALGORITHM_VERSION, SHUFFLE_ALGORITHM_VERSION } from '../core/versions.js';
import type { AgentFactory } from './agents.js';
import { blockConfidence95, mean, percentile } from './statistics.js';

export interface ArenaOptions {
  readonly mode: 'cash' | 'tournament';
  readonly seed: string;
  /** Each independent block contains one game per cyclic seat rotation. */
  readonly blocks: number;
  readonly stackBB: number;
  readonly handsPerLevel: number;
  readonly maxHands: number;
  readonly decisionBudgetMs: number;
  readonly entrants: readonly AgentFactory[];
}

export interface DecisionHealth {
  decisions: number;
  invalid: number;
  errors: number;
  timeouts: number;
  fallbacks: number;
  durationsMs: number[];
}

export interface MatchResult {
  readonly block: number;
  readonly rotation: number;
  readonly dealSeed: string;
  readonly status: 'complete' | 'hand-cap';
  readonly hands: number;
  /** Index into entrants, not the physical seat. */
  readonly winner: number | null;
  readonly stacksByEntrant: readonly number[];
  readonly netChipsByEntrant: readonly number[];
  readonly actionDigest: string;
}

export interface DecisionFailure {
  readonly block: number;
  readonly rotation: number;
  readonly hand: number;
  readonly seat: number;
  readonly entrant: number;
  readonly street: string;
  readonly decisionIndex: number;
  readonly kind: 'timeout' | 'invalid' | 'error';
  readonly elapsedMs: number;
  readonly fallback: ActionIntent;
}

export interface ArenaReport {
  readonly schemaVersion: 1;
  readonly arenaVersion: 'arena-v0.1';
  readonly rulesVersion: string;
  readonly rngVersion: string;
  readonly shuffleVersion: string;
  readonly config: Omit<ArenaOptions, 'entrants'>;
  readonly agents: readonly { id: string; description: string; equitySamples: number | null }[];
  readonly games: number;
  readonly hands: number;
  readonly censoredGames: number;
  readonly hero: {
    readonly bbPer100: number | null;
    readonly winRate: number | null;
    readonly winRateBounds: readonly [number, number] | null;
    readonly confidence95: readonly [number, number] | null;
    readonly confidenceUnit: 'bb/100' | 'match win fraction';
  };
  readonly health: readonly Omit<DecisionHealth, 'durationsMs'>[];
  readonly latency: readonly { p50Ms: number | null; p95Ms: number | null; maxMs: number | null }[];
  readonly failures: readonly DecisionFailure[];
  readonly matches: readonly MatchResult[];
  readonly resultDigest: string;
  readonly warnings: readonly string[];
}

function positiveInt(value: number, label: string, max: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer from 1 to ${max}`);
}

function validate(options: ArenaOptions): void {
  if (options.mode !== 'cash' && options.mode !== 'tournament') throw new Error('Unknown arena mode');
  if (!options.seed.trim() || options.seed.length > 200) throw new Error('Seed must contain 1–200 characters');
  positiveInt(options.blocks, 'blocks', 100_000);
  positiveInt(options.stackBB, 'stackBB', 100_000);
  positiveInt(options.handsPerLevel, 'handsPerLevel', 100_000);
  positiveInt(options.maxHands, 'maxHands', 1_000);
  positiveInt(options.decisionBudgetMs, 'decisionBudgetMs', 60_000);
  if (options.entrants.length < 2 || options.entrants.length > 6) throw new Error('Arena requires 2–6 entrants');
}

function legalIntent(value: unknown, legal: LegalActionSet): value is ActionIntent {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  switch (value.type) {
    case 'fold': return legal.fold;
    case 'check': return legal.check;
    case 'call': return legal.call !== null;
    case 'allIn': return legal.allIn !== null;
    case 'raiseTo': return 'amount' in value && typeof value.amount === 'number'
      && Number.isSafeInteger(value.amount) && legal.raiseTo !== null
      && value.amount >= legal.raiseTo.min && value.amount <= legal.raiseTo.max;
    default: return false;
  }
}

class DecisionTimeout extends Error {}

/** Trusted local agents only. Async watchdog; synchronous work is checked after return, not preempted. */
export async function guardedDecision(agent: PokerAgent, context: DecisionContext, budgetMs: number,
  health: DecisionHealth): Promise<ActionIntent> {
  health.decisions += 1;
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decision: ActionDecision = await Promise.race([
      Promise.resolve().then(() => agent.decide(context)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DecisionTimeout()), budgetMs); }),
    ]);
    if (performance.now() - started > budgetMs) throw new DecisionTimeout();
    if (legalIntent(decision?.action, context.observation.legalActions)) {
      // Copy the result; never hand an agent-owned mutable object to the authority.
      return decision.action.type === 'raiseTo'
        ? { type: 'raiseTo', amount: decision.action.amount } : { type: decision.action.type };
    }
    health.invalid += 1;
  } catch (error) {
    if (error instanceof DecisionTimeout) health.timeouts += 1;
    else health.errors += 1;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    health.durationsMs.push(performance.now() - started);
  }
  health.fallbacks += 1;
  const legal = context.observation.legalActions;
  if (legal.check) return { type: 'check' };
  if (legal.fold) return { type: 'fold' };
  throw new Error('No free safe fallback exists');
}

async function playMatch(options: ArenaOptions, block: number, rotation: number,
  health: DecisionHealth[], failures: DecisionFailure[]): Promise<MatchResult> {
  const count = options.entrants.length;
  const entrantAtSeat = (seat: number) => (seat - rotation + count) % count;
  // No rotation/agent ID in the deck seed: paired runs reuse physical cards and button.
  const dealSeed = `${options.seed}/block/${block}`;
  const agents = options.entrants.map(factory => factory.create());
  let state = createTournament({
    maxSeats: count, startingStack: options.stackBB * 2, initialButtonSeat: 0,
    handsPerLevel: options.handsPerLevel, blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  }, Array.from({ length: count }, (_, seatIndex) => ({
    playerId: `entrant-${entrantAtSeat(seatIndex)}`, seatIndex,
  })), dealSeed).state;
  const digest = createHash('sha256');
  const terminal = (s: TournamentState) => s.activeHand?.phase === 'hand-complete';
  const handLimit = options.mode === 'cash' ? 1 : options.maxHands;
  for (let hand = 0; hand < handLimit; hand += 1) {
    state = startHand(state).state;
    let actions = 0;
    while (!terminal(state)) {
      state = advanceAutomaticPhases(state).state;
      if (terminal(state)) break;
      if (++actions > 2_000) throw new Error(`Action cap: ${dealSeed}, rotation ${rotation}, hand ${hand + 1}`);
      const seat = state.activeHand?.currentActorSeat;
      if (seat === null || seat === undefined) throw new Error('Arena stalled without current actor');
      const entrant = entrantAtSeat(seat);
      // Core replay hand IDs contain runSeed. Do not expose a dealer seed to a player.
      const observation = deepFreezeObservation({ ...projectObservation(state, seat),
        handId: `arena-hand-${state.handNumber}` });
      const before = { ...health[entrant]! };
      const action = await guardedDecision(agents[entrant]!, {
        observation,
        // Separate streams: policy draws cannot consume or reveal the dealer's RNG.
        random: createSeededRandom(options.seed, `arena/policy/${block}/${rotation}/${hand}/${seat}/${observation.decisionIndex}`),
      }, options.decisionBudgetMs, health[entrant]!);
      const after = health[entrant]!;
      if (after.fallbacks !== before.fallbacks) failures.push({
        block, rotation, hand: state.handNumber, seat, entrant, street: observation.street,
        decisionIndex: observation.decisionIndex,
        kind: after.timeouts > before.timeouts ? 'timeout' : after.invalid > before.invalid ? 'invalid' : 'error',
        elapsedMs: after.durationsMs.at(-1)!, fallback: action,
      });
      digest.update(JSON.stringify([state.handNumber, seat, action]) + '\n');
      const applied = applyIntent(state, seat, action);
      if (!applied.accepted) throw new Error(`Arena/engine legality mismatch: ${applied.rejection.code}`);
      state = applied.state;
    }
    assertTournamentInvariants(state);
    if (state.seats.filter(s => s.stack > 0).length === 1) break;
  }
  const survivors = state.seats.filter(s => s.stack > 0);
  const stacks = options.entrants.map((_, entrant) => state.seats.find(s => entrantAtSeat(s.seatIndex) === entrant)!.stack);
  const net = stacks.map(stack => stack - options.stackBB * 2);
  if (net.reduce((a, b) => a + b, 0) !== 0) throw new Error('Arena chip conservation failed');
  return {
    block, rotation, dealSeed, hands: state.handNumber,
    status: options.mode === 'cash' || survivors.length === 1 ? 'complete' : 'hand-cap',
    winner: survivors.length === 1 ? entrantAtSeat(survivors[0]!.seatIndex) : null,
    stacksByEntrant: stacks, netChipsByEntrant: net, actionDigest: digest.digest('hex'),
  };
}

export async function runArena(options: ArenaOptions,
  onBlock?: (completed: number, total: number) => void): Promise<ArenaReport> {
  validate(options);
  const health: DecisionHealth[] = options.entrants.map(() => ({
    decisions: 0, invalid: 0, errors: 0, timeouts: 0, fallbacks: 0, durationsMs: [],
  }));
  const matches: MatchResult[] = [];
  const failures: DecisionFailure[] = [];
  const blockMeans: number[] = [];
  for (let block = 0; block < options.blocks; block += 1) {
    const outcomes: number[] = [];
    for (let rotation = 0; rotation < options.entrants.length; rotation += 1) {
      const match = await playMatch(options, block, rotation, health, failures);
      matches.push(match);
      outcomes.push(options.mode === 'cash' ? match.netChipsByEntrant[0]! / 2 * 100 : Number(match.winner === 0));
    }
    blockMeans.push(mean(outcomes));
    onBlock?.(block + 1, options.blocks);
  }
  const censoredGames = matches.filter(m => m.status !== 'complete').length;
  const faults = health.reduce((sum, h) => sum + h.fallbacks, 0);
  const warnings = [
    'Local heuristic baseline, not GTO, a Chipzen result, or evidence of world-class strength.',
    'No cross-hand personality memory. Fresh policy instances per match; no abilities or hidden-card access.',
    '95% percentile bootstrap over seed blocks (2000 resamples); seat rotations are correlated, not extra independent samples.',
    'Trusted local agents only: async watchdog and post-return synchronous deadline check, NOT a hard CPU sandbox.',
    'Same seed/source/options reproduce actions and scores only when no timing fallback occurs. Latencies are machine-dependent.',
  ];
  if (options.blocks < 30) warnings.push('Fewer than 30 independent blocks: confidence interval withheld; smoke test only.');
  if (faults) warnings.push('Decision failures occurred: scores include check/fold fallbacks; not a clean strength comparison.');
  if (censoredGames) warnings.push('Hand-capped matches are unresolved, never awarded to chip leaders. Win-rate bounds shown; CI withheld.');
  if (options.mode === 'tournament') warnings.push('Local blinds start at 1/2 and double each level (capped by total chips); NOT verified Chipzen rules.');
  const { entrants, ...config } = options;
  const wins = matches.filter(m => m.winner === 0).length;
  return {
    schemaVersion: 1, arenaVersion: 'arena-v0.1', rulesVersion: RULES_VERSION,
    rngVersion: RNG_ALGORITHM_VERSION, shuffleVersion: SHUFFLE_ALGORITHM_VERSION,
    config, agents: entrants.map(({ id, description, equitySamples }) => ({ id, description, equitySamples })),
    games: matches.length, hands: matches.reduce((sum, m) => sum + m.hands, 0), censoredGames,
    hero: {
      bbPer100: options.mode === 'cash' ? mean(blockMeans) : null,
      winRate: options.mode === 'tournament' && !censoredGames ? wins / matches.length : null,
      winRateBounds: options.mode === 'tournament' ? [wins / matches.length, (wins + censoredGames) / matches.length] : null,
      confidence95: censoredGames || faults ? null : blockConfidence95(blockMeans, options.seed),
      confidenceUnit: options.mode === 'cash' ? 'bb/100' : 'match win fraction',
    },
    health: health.map(({ durationsMs: _, ...h }) => h),
    latency: health.map(h => ({ p50Ms: percentile(h.durationsMs, .5), p95Ms: percentile(h.durationsMs, .95),
      maxMs: percentile(h.durationsMs, 1) })),
    matches, failures, resultDigest: createHash('sha256').update(JSON.stringify(matches)).digest('hex'), warnings,
  };
}
