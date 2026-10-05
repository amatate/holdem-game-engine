import { estimateEquity, estimateRangeEquity, MAX_EQUITY_SAMPLES, type EquityEstimate } from './equity.js';
import type {
  ActionDecision,
  DecisionContext,
  PlayerObservationV1,
  PokerAgent,
  PublicSeatState,
  StyleProfile,
} from './types.js';
import type { ActionIntent, LegalActionSet } from '../core/legal-actions.js';
import type { RandomSource } from '../core/types.js';
import { AI_SAMPLES, isAiDifficulty, difficultyScores, difficultySizing, type AiDifficulty } from './difficulty.js';
import { choosePlan, primaryRead, tacticalScores, tacticalSizing, type TacticalContext } from './tactics.js';

const INVALID_PROFILE = 'Invalid style profile';
const INVALID_OPTIONS = 'Invalid parametric agent options';
const INVALID_ESTIMATE = 'Invalid equity estimate';

export type EquityProvider = (
  observation: Readonly<PlayerObservationV1>,
  samples: number,
  random: RandomSource,
) => EquityEstimate;

export interface ParametricHoldemAgentOptions {
  /** Internal beliefs / previous intention only. Never attached to public game packets. */
  readonly tacticalContext?: TacticalContext;
  readonly difficulty?: AiDifficulty;
  readonly equityProvider?: EquityProvider;
  /** Positive safe integer <= MAX_EQUITY_SAMPLES; defaults to the tier's budget (standard: 300). */
  readonly equitySamples?: number;
  /** Default false; must not affect action or RNG consumption. */
  readonly includePrivateTrace?: boolean;
}

export interface StackContext {
  readonly effectiveStack: number;
  readonly spr: number;
  readonly commitFraction: number;
  readonly largeCommitPenalty: number;
}

export interface PolicyScoreInput {
  readonly equity: number;
  readonly potOdds: number;
  readonly profile: Readonly<StyleProfile>;
  readonly positionAdjustment: number;
  readonly drawAdjustment: number;
  readonly policyRoll: number;
  readonly bluffRoll: number;
  readonly slowPlayRoll: number;
  readonly canAggress: boolean;
  readonly largeCommitPenalty: number;
}

export interface PolicyScores {
  readonly policyNoise: number;
  readonly continueScore: number;
  readonly naturalRaiseScore: number;
  readonly raiseThreshold: number;
  readonly valueRaiseAvailable: boolean;
  readonly bluffProbability: number;
  readonly bluffTriggered: boolean;
  readonly raiseScore: number;
  readonly slowPlayTriggered: boolean;
}

export type AggressiveSizingReason =
  | 'minimum'
  | 'half-pot'
  | 'three-quarter-pot'
  | 'pot'
  | 'all-in';

export interface AggressiveCandidate {
  readonly action: ActionIntent;
  readonly target: number;
  readonly payment: number;
  readonly sizingReason: AggressiveSizingReason;
}

function invalidProfile(): never {
  throw new Error(INVALID_PROFILE);
}

function requireUnitInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalidProfile();
  }
  return value;
}

function cloneProfile(value: Readonly<StyleProfile>): Readonly<StyleProfile> {
  try {
    if (typeof value !== 'object' || value === null) invalidProfile();
    const sizing = value.sizing;
    if (typeof sizing !== 'object' || sizing === null) invalidProfile();
    const preferredPotFraction = sizing.preferredPotFraction;
    if (preferredPotFraction !== 0.5 && preferredPotFraction !== 0.75
      && preferredPotFraction !== 1) {
      invalidProfile();
    }
    const sizingSnapshot = Object.freeze({
      preferredPotFraction,
      variance: requireUnitInterval(sizing.variance),
      overbetFrequency: requireUnitInterval(sizing.overbetFrequency),
    });
    return Object.freeze({
      looseness: requireUnitInterval(value.looseness),
      aggression: requireUnitInterval(value.aggression),
      bluffing: requireUnitInterval(value.bluffing),
      stickiness: requireUnitInterval(value.stickiness),
      positionAwareness: requireUnitInterval(value.positionAwareness),
      riskAppetite: requireUnitInterval(value.riskAppetite),
      slowPlay: requireUnitInterval(value.slowPlay),
      variability: requireUnitInterval(value.variability),
      sizing: sizingSnapshot,
    });
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_PROFILE) throw error;
    throw new Error(INVALID_PROFILE);
  }
}

function validateOptions(value: Readonly<ParametricHoldemAgentOptions> | undefined): Readonly<{
  equityProvider: EquityProvider;
  equitySamples: number;
  includePrivateTrace: boolean;
  difficulty: AiDifficulty;
}> {
  try {
    if (value !== undefined && (typeof value !== 'object' || value === null)) {
      throw new Error(INVALID_OPTIONS);
    }
    const difficulty = value?.difficulty ?? 'standard';
    if (!isAiDifficulty(difficulty)) throw new Error(INVALID_OPTIONS);
    const equityProvider = value?.equityProvider ?? (difficulty === 'casual' ? estimateEquity : estimateRangeEquity);
    const equitySamples = value?.equitySamples ?? AI_SAMPLES[difficulty];
    const includePrivateTrace = value?.includePrivateTrace ?? false;
    if (typeof equityProvider !== 'function'
      || !Number.isSafeInteger(equitySamples)
      || equitySamples < 1
      || equitySamples > MAX_EQUITY_SAMPLES
      || typeof includePrivateTrace !== 'boolean') {
      throw new Error(INVALID_OPTIONS);
    }
    return { equityProvider, equitySamples, includePrivateTrace, difficulty };
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_OPTIONS) throw error;
    throw new Error(INVALID_OPTIONS);
  }
}

function validateEstimate(value: EquityEstimate, expectedSamples: number): EquityEstimate {
  try {
    if (typeof value !== 'object' || value === null) throw new Error(INVALID_ESTIMATE);
    const equity = value.equity;
    const wins = value.wins;
    const ties = value.ties;
    const losses = value.losses;
    const samples = value.samples;
    if (typeof equity !== 'number' || !Number.isFinite(equity) || equity < 0 || equity > 1
      || !Number.isSafeInteger(wins) || wins < 0
      || !Number.isSafeInteger(ties) || ties < 0
      || !Number.isSafeInteger(losses) || losses < 0
      || !Number.isSafeInteger(samples) || samples !== expectedSamples
      || wins + ties + losses !== samples) {
      throw new Error(INVALID_ESTIMATE);
    }
    return { equity, wins, ties, losses, samples };
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_ESTIMATE) throw error;
    throw new Error(INVALID_ESTIMATE);
  }
}

function nextPhysicalSeat(
  seats: readonly PublicSeatState[],
  anchor: number,
): number | null {
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const seatIndex = (anchor + offset) % seats.length;
    if (seats[seatIndex]?.status !== 'eliminated') return seatIndex;
  }
  return null;
}

export function computePositionAdjustment(
  observation: Readonly<PlayerObservationV1>,
  positionAwareness: number,
): number {
  let livePhysicalSeats = 0;
  for (let index = 0; index < observation.seats.length; index += 1) {
    if (observation.seats[index]?.status !== 'eliminated') livePhysicalSeats += 1;
  }
  if (livePhysicalSeats <= 2) return 0;
  if (observation.actorSeatIndex === observation.buttonPosition
    && observation.seats[observation.buttonPosition]?.status !== 'eliminated') {
    return 0.08 * positionAwareness;
  }
  const earlyAnchor = observation.street === 'preflop'
    ? observation.bigBlindSeat
    : observation.buttonPosition;
  return nextPhysicalSeat(observation.seats, earlyAnchor) === observation.actorSeatIndex
    ? -0.08 * positionAwareness
    : 0;
}

const STRAIGHT_WINDOWS: readonly (readonly number[])[] = [
  [14, 2, 3, 4, 5],
  [2, 3, 4, 5, 6],
  [3, 4, 5, 6, 7],
  [4, 5, 6, 7, 8],
  [5, 6, 7, 8, 9],
  [6, 7, 8, 9, 10],
  [7, 8, 9, 10, 11],
  [8, 9, 10, 11, 12],
  [9, 10, 11, 12, 13],
  [10, 11, 12, 13, 14],
];

function windowIsPresent(window: readonly number[], ranks: ReadonlySet<number>): boolean {
  for (let index = 0; index < window.length; index += 1) {
    if (!ranks.has(window[index]!)) return false;
  }
  return true;
}

function heroParticipatesInRanks(
  ranks: readonly number[],
  heroRanks: ReadonlySet<number>,
  boardRanks: ReadonlySet<number>,
): boolean {
  for (let index = 0; index < ranks.length; index += 1) {
    const rank = ranks[index]!;
    if (heroRanks.has(rank) && !boardRanks.has(rank)) return true;
  }
  return false;
}

export function computeVisibleDrawAdjustment(
  observation: Readonly<PlayerObservationV1>,
): number {
  if (observation.street !== 'flop' && observation.street !== 'turn') return 0;
  const allCards = [observation.holeCards[0], observation.holeCards[1], ...observation.board];
  const allRanks = new Set<number>();
  const heroRanks = new Set<number>();
  const boardRanks = new Set<number>();
  const suitCounts = new Map<string, number>();
  const heroSuits = new Set<string>();
  for (let index = 0; index < allCards.length; index += 1) {
    const card = allCards[index]!;
    allRanks.add(card.rank);
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  }
  for (let index = 0; index < observation.holeCards.length; index += 1) {
    heroRanks.add(observation.holeCards[index]!.rank);
    heroSuits.add(observation.holeCards[index]!.suit);
  }
  for (let index = 0; index < observation.board.length; index += 1) {
    boardRanks.add(observation.board[index]!.rank);
  }

  for (const count of suitCounts.values()) {
    if (count >= 5) return 0;
  }
  for (let index = 0; index < STRAIGHT_WINDOWS.length; index += 1) {
    if (windowIsPresent(STRAIGHT_WINDOWS[index]!, allRanks)) return 0;
  }

  for (const [suit, count] of suitCounts) {
    if (count === 4 && heroSuits.has(suit)) return 0.08;
  }

  for (let start = 2; start <= 10; start += 1) {
    const run = [start, start + 1, start + 2, start + 3];
    if (windowIsPresent(run, allRanks)
      && heroParticipatesInRanks(run, heroRanks, boardRanks)) {
      return 0.08;
    }
  }

  for (let index = 0; index < STRAIGHT_WINDOWS.length; index += 1) {
    const window = STRAIGHT_WINDOWS[index]!;
    let present = 0;
    const presentRanks: number[] = [];
    for (let rankIndex = 0; rankIndex < window.length; rankIndex += 1) {
      const rank = window[rankIndex]!;
      if (allRanks.has(rank)) {
        present += 1;
        presentRanks.push(rank);
      }
    }
    if (present === 4 && heroParticipatesInRanks(presentRanks, heroRanks, boardRanks)) return 0.04;
  }
  return 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function computeStackContext(
  observation: Readonly<PlayerObservationV1>,
  proposedPayment: number,
  riskAppetite: number,
): StackContext {
  let hero: PublicSeatState | null = null;
  for (let index = 0; index < observation.seats.length; index += 1) {
    const seat = observation.seats[index]!;
    if (seat.seatIndex === observation.actorSeatIndex) hero = seat;
  }
  if (hero === null) throw new Error('Invalid decision observation');
  let effectiveStack = 0;
  for (let index = 0; index < observation.seats.length; index += 1) {
    const opponent = observation.seats[index]!;
    if (opponent.seatIndex === hero.seatIndex
      || (opponent.status !== 'active' && opponent.status !== 'all-in')) continue;
    const contestableAdditional = clamp(
      opponent.stack + opponent.committedHand - hero.committedHand,
      0,
      hero.stack,
    );
    effectiveStack = Math.max(effectiveStack, contestableAdditional);
  }
  const spr = effectiveStack / Math.max(1, observation.potTotal);
  const commitFraction = proposedPayment
    / Math.max(1, spr * Math.max(1, observation.potTotal));
  const largeCommitPenalty = Math.min(
    0.10,
    Math.max(0, commitFraction - 0.5) * 0.20 * (1 - riskAppetite),
  );
  return { effectiveStack, spr, commitFraction, largeCommitPenalty };
}

export function computePolicyScores(input: Readonly<PolicyScoreInput>): PolicyScores {
  const policyNoise = (input.policyRoll - 0.5) * 0.12 * input.profile.variability;
  const continueScore = input.equity - input.potOdds
    + (input.profile.looseness - 0.5) * 0.25
    + (input.profile.stickiness - 0.5) * 0.15
    + input.positionAdjustment
    + policyNoise;
  const naturalRaiseScore = input.equity
    + (input.profile.aggression - 0.5) * 0.25
    + input.drawAdjustment
    + policyNoise
    - input.largeCommitPenalty;
  const raiseThreshold = 0.62 - input.profile.aggression * 0.12;
  const valueRaiseAvailable = input.canAggress && naturalRaiseScore > raiseThreshold;
  const bluffProbability = input.profile.bluffing * (0.15 + 0.35 * input.profile.aggression);
  const bluffTriggered = input.canAggress && !valueRaiseAvailable
    && input.bluffRoll < bluffProbability;
  const raiseScore = naturalRaiseScore + (bluffTriggered ? 0.15 : 0);
  const slowPlayTriggered = valueRaiseAvailable && input.equity >= 0.75
    && input.slowPlayRoll < input.profile.slowPlay * 0.25;
  return {
    policyNoise,
    continueScore,
    naturalRaiseScore,
    raiseThreshold,
    valueRaiseAvailable,
    bluffProbability,
    bluffTriggered,
    raiseScore,
    slowPlayTriggered,
  };
}

function findHero(observation: Readonly<PlayerObservationV1>): PublicSeatState {
  for (let index = 0; index < observation.seats.length; index += 1) {
    if (observation.seats[index]?.seatIndex === observation.actorSeatIndex) {
      return observation.seats[index]!;
    }
  }
  throw new Error('Invalid decision observation');
}

function rawFractionTarget(
  committedStreet: number,
  callPay: number,
  potTotal: number,
  fraction: 0.5 | 0.75 | 1,
): number {
  const payment = callPay + fraction * (potTotal + callPay);
  return committedStreet + Math.round(payment);
}

function buildAggressiveCandidates(
  observation: Readonly<PlayerObservationV1>,
): AggressiveCandidate[] {
  const legal = observation.legalActions;
  const hero = findHero(observation);
  const callPay = legal.call?.pay ?? 0;
  const candidates: AggressiveCandidate[] = [];
  const targetIndexes = new Map<number, number>();

  const addNumeric = (target: number, sizingReason: AggressiveSizingReason): void => {
    if (legal.raiseTo === null) return;
    const finalTarget = clamp(target, legal.raiseTo.min, legal.raiseTo.max);
    if (!Number.isSafeInteger(finalTarget) || targetIndexes.has(finalTarget)) return;
    targetIndexes.set(finalTarget, candidates.length);
    candidates.push({
      action: { type: 'raiseTo', amount: finalTarget },
      target: finalTarget,
      payment: finalTarget - hero.committedStreet,
      sizingReason,
    });
  };

  if (legal.raiseTo !== null) {
    addNumeric(legal.raiseTo.min, 'minimum');
    addNumeric(rawFractionTarget(hero.committedStreet, callPay, observation.potTotal, 0.5), 'half-pot');
    addNumeric(rawFractionTarget(hero.committedStreet, callPay, observation.potTotal, 0.75), 'three-quarter-pot');
    addNumeric(rawFractionTarget(hero.committedStreet, callPay, observation.potTotal, 1), 'pot');
  }

  if (legal.allIn !== null && legal.allIn.mode !== 'call') {
    const allInCandidate: AggressiveCandidate = {
      action: { type: 'allIn' },
      target: legal.allIn.to,
      payment: legal.allIn.to - hero.committedStreet,
      sizingReason: 'all-in',
    };
    const existing = targetIndexes.get(legal.allIn.to);
    if (existing === undefined) {
      candidates.push(allInCandidate);
    } else {
      candidates[existing] = allInCandidate;
    }
  }
  return candidates;
}

export function selectAggressiveCandidate(
  observation: Readonly<PlayerObservationV1>,
  profile: Readonly<StyleProfile>,
  varianceRoll: number,
  overbetRoll: number,
  maximumPayment = Infinity,
): AggressiveCandidate | null {
  const candidates = buildAggressiveCandidates(observation).filter(candidate => candidate.payment <= maximumPayment);
  if (candidates.length === 0) return null;
  const ordered = [...candidates].sort((left, right) => left.target - right.target);
  if (overbetRoll < profile.sizing.overbetFrequency * profile.riskAppetite) {
    return ordered[ordered.length - 1]!;
  }
  const hero = findHero(observation);
  const preferredTarget = rawFractionTarget(
    hero.committedStreet,
    observation.legalActions.call?.pay ?? 0,
    observation.potTotal,
    profile.sizing.preferredPotFraction,
  );
  let selectedIndex = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const selectedDistance = Math.abs(ordered[selectedIndex]!.target - preferredTarget);
    const candidateDistance = Math.abs(ordered[index]!.target - preferredTarget);
    if (candidateDistance < selectedDistance
      || (candidateDistance === selectedDistance
        && ordered[index]!.target < ordered[selectedIndex]!.target)) {
      selectedIndex = index;
    }
  }
  if (varianceRoll < profile.sizing.variance && ordered.length > 1) {
    const lower = selectedIndex > 0 ? selectedIndex - 1 : null;
    const higher = selectedIndex + 1 < ordered.length ? selectedIndex + 1 : null;
    if (lower !== null && higher !== null) {
      selectedIndex = varianceRoll / profile.sizing.variance < 0.5 ? lower : higher;
    } else {
      selectedIndex = lower ?? higher!;
    }
  }
  return ordered[selectedIndex]!;
}

function hasAnyLegalAction(legal: LegalActionSet): boolean {
  return legal.fold || legal.check || legal.call !== null
    || legal.raiseTo !== null || legal.allIn !== null;
}

function actionIsAggressive(action: ActionIntent, legal: LegalActionSet): boolean {
  return action.type === 'raiseTo'
    || (action.type === 'allIn' && legal.allIn !== null && legal.allIn.mode !== 'call');
}

function validateFinalAction(action: ActionIntent, legal: LegalActionSet): void {
  const valid = action.type === 'fold'
    ? legal.fold
    : action.type === 'check'
      ? legal.check
      : action.type === 'call'
        ? legal.call !== null
        : action.type === 'allIn'
          ? legal.allIn !== null
          : legal.raiseTo !== null
            && Number.isSafeInteger(action.amount)
            && action.amount >= legal.raiseTo.min
            && action.amount <= legal.raiseTo.max;
  if (!valid) throw new Error('Parametric agent produced an illegal action');
}

function equityBand(equity: number): 'low' | 'medium' | 'high' {
  return equity < 0.35 ? 'low' : equity < 0.65 ? 'medium' : 'high';
}

function potOddsBand(potOdds: number): 'low' | 'medium' | 'high' {
  return potOdds < 0.20 ? 'low' : potOdds < 0.40 ? 'medium' : 'high';
}

export class ParametricHoldemAgent implements PokerAgent {
  readonly agentId: string;
  readonly profile: Readonly<StyleProfile>;
  readonly #equityProvider: EquityProvider;
  readonly #equitySamples: number;
  readonly #includePrivateTrace: boolean;
  readonly #difficulty: AiDifficulty;
  readonly #tactics: TacticalContext | undefined;

  constructor(
    agentId: string,
    profile: Readonly<StyleProfile>,
    options?: Readonly<ParametricHoldemAgentOptions>,
  ) {
    if (typeof agentId !== 'string' || agentId.length === 0) {
      throw new Error('Invalid agent ID');
    }
    this.agentId = agentId;
    this.profile = cloneProfile(profile);
    const validated = validateOptions(options);
    this.#equityProvider = validated.equityProvider;
    this.#equitySamples = validated.equitySamples;
    this.#includePrivateTrace = validated.includePrivateTrace;
    this.#difficulty = validated.difficulty;
    // Custom providers retain the legacy policy unless they explicitly opt into tactics.
    this.#tactics = options?.tacticalContext ?? (!options?.equityProvider && this.#difficulty !== 'casual' ? {} : undefined);
  }

  decide(context: Readonly<DecisionContext>): ActionDecision {
    const observation = context.observation;
    const legal = observation.legalActions;
    if (!hasAnyLegalAction(legal)) throw new Error('Parametric agent requires a nonempty legal action set');

    const equityRandom = context.random.fork('equity-sampling');
    const policyRandom = context.random.fork('policy-variability');
    const bluffRandom = context.random.fork('bluff');
    const slowPlayRandom = context.random.fork('slow-play');
    const sizingRandom = context.random.fork('sizing');
    const policyRoll = policyRandom.nextFloat();
    const bluffRoll = bluffRandom.nextFloat();
    const slowPlayRoll = slowPlayRandom.nextFloat();
    const varianceRoll = sizingRandom.nextFloat();
    const overbetRoll = sizingRandom.nextFloat();

    const estimate = validateEstimate(
      this.#equityProvider === estimateRangeEquity
        ? estimateRangeEquity(observation, this.#equitySamples, equityRandom, this.#tactics?.reads)
        : this.#equityProvider(observation, this.#equitySamples, equityRandom),
      this.#equitySamples,
    );
    const drawAdjustment = computeVisibleDrawAdjustment(observation);
    const plan = choosePlan(observation, estimate.equity, drawAdjustment, this.#tactics?.previousPlan);
    const read = this.#tactics?.reads ? primaryRead(observation, this.#tactics.reads) : undefined;
    const sizingProfile = difficultySizing(this.#difficulty, this.profile, estimate.equity);
    const candidate = selectAggressiveCandidate(
      observation,
      this.#tactics ? tacticalSizing(sizingProfile, observation, estimate.equity, plan, read) : sizingProfile,
      varianceRoll,
      overbetRoll,
      this.#tactics && estimate.equity < .72
        ? Math.max(observation.bigBlind * 3, observation.potTotal + 2 * (legal.call?.pay ?? 0)) : Infinity,
    );
    const callPay = legal.call?.pay ?? 0;
    const facingBet = legal.call !== null;
    const potOdds = facingBet ? callPay / (observation.potTotal + callPay) : 0;
    const positionAdjustment = computePositionAdjustment(observation, this.profile.positionAwareness);
    const stackContext = computeStackContext(
      observation,
      candidate?.payment ?? callPay,
      this.profile.riskAppetite,
    );
    const perceivedEquity = this.#difficulty === 'casual'
      ? Math.max(0, Math.min(1, Math.round(estimate.equity * 5) / 5 + (policyRoll - 0.5) * 0.24)) : estimate.equity;
    const baselineScores = computePolicyScores({
      equity: perceivedEquity,
      potOdds,
      profile: this.profile,
      positionAdjustment,
      drawAdjustment,
      policyRoll,
      bluffRoll,
      slowPlayRoll,
      canAggress: candidate !== null,
      largeCommitPenalty: stackContext.largeCommitPenalty,
    });
    const difficultyPolicy = difficultyScores(this.#difficulty, baselineScores, observation, this.profile,
      perceivedEquity, potOdds, drawAdjustment, bluffRoll);
    const scores = this.#tactics ? tacticalScores(difficultyPolicy, observation, this.profile,
      perceivedEquity, drawAdjustment, bluffRoll, plan, read, this.#difficulty === 'challenging', candidate !== null) : difficultyPolicy;

    let action: ActionIntent;
    if (scores.slowPlayTriggered) {
      action = facingBet ? { type: 'call' } : { type: 'check' };
    } else if (scores.bluffTriggered) {
      action = candidate!.action;
    } else if (facingBet && scores.continueScore < 0) {
      action = { type: 'fold' };
    } else if (scores.valueRaiseAvailable) {
      action = candidate!.action;
    } else {
      action = facingBet ? { type: 'call' } : { type: 'check' };
    }
    validateFinalAction(action, legal);

    if (!this.#includePrivateTrace) return { action };
    const aggressive = actionIsAggressive(action, legal);
    const intent = scores.slowPlayTriggered
      ? 'trap' as const
      : scores.bluffTriggered && aggressive
        ? 'bluff' as const
        : aggressive && drawAdjustment > 0
          ? 'semiBluff' as const
          : aggressive
            ? 'value' as const
            : drawAdjustment > 0 && (action.type === 'call' || action.type === 'check')
              ? 'draw' as const
              : action.type === 'fold'
                || (stackContext.largeCommitPenalty > 0 && !aggressive)
                ? 'preserveStack' as const
                : 'potControl' as const;
    return {
      action,
      privateTrace: {
        intent,
        equityBand: equityBand(estimate.equity),
        potOddsBand: potOddsBand(potOdds),
        positionAdjustment,
        sizingReason: aggressive ? candidate!.sizingReason : 'none',
      },
    };
  }
}
