import type { PlayerObservationV1, StyleProfile } from './types.js';
import type { PolicyScores } from './parametric-agent.js';
import { currentPressure } from './tactics.js';

export const AI_DIFFICULTIES = ['casual', 'standard', 'challenging'] as const;
export type AiDifficulty = typeof AI_DIFFICULTIES[number];
export const AI_LABELS: Record<AiDifficulty, string> = { casual: '休闲', standard: '标准', challenging: '挑战' };
export const AI_SAMPLES: Record<AiDifficulty, number> = { casual: 72, standard: 300, challenging: 600 };
export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return typeof value === 'string' && (AI_DIFFICULTIES as readonly string[]).includes(value);
}

/** Heuristic decision quality, not a solver or a peek at actual opponent cards. */
export function difficultyScores(level: AiDifficulty, original: PolicyScores, observation: Readonly<PlayerObservationV1>,
  profile: Readonly<StyleProfile>, equity: number, potOdds: number, draw: number, bluffRoll: number): PolicyScores {
  if (level === 'standard') return original;
  if (level === 'casual') return { ...original, continueScore: original.continueScore + potOdds * 0.3 };
  const rivals = observation.seats.filter(s => s.seatIndex !== observation.actorSeatIndex && (s.status === 'active' || s.status === 'all-in'));
  const raises = currentPressure(observation);
  // Small current-round risk margin, not the old whole-hand uniform-equity discount.
  // Default standard/challenge agents already condition equity on betting ranges.
  const pressure = Math.min(0.06, raises * 0.02);
  const futureRisk = observation.street !== 'river' && observation.actorSeatIndex !== observation.buttonPosition ? 0.025 : 0;
  const usableEquity = Math.max(0, equity - pressure - futureRisk);
  const styleEdge = (profile.looseness - 0.5) * 0.06 + (profile.stickiness - 0.5) * 0.04;
  const continueScore = usableEquity - potOdds + styleEdge + original.policyNoise * 0.25;
  const raiseThreshold = 0.64 - profile.aggression * 0.08 + Math.min(0.09, (rivals.length - 1) * 0.03);
  const valueRaiseAvailable = original.valueRaiseAvailable && usableEquity > raiseThreshold;
  const actor = observation.seats.find(s => s.seatIndex === observation.actorSeatIndex)!;
  const callPay = observation.legalActions.call?.pay ?? 0;
  // No bluffing into an all-in player, multiway crowds, or an expensive raise.
  const bluffWindow = rivals.length === 1 && rivals[0]!.status === 'active' && actor.stack > callPay
    && callPay <= observation.potTotal * 0.2 && raises <= 1 && equity < 0.55
    && (callPay === 0 || draw > 0);
  const bluffProbability = bluffWindow ? profile.bluffing * (draw > 0 ? 0.3 : 0.12) : 0;
  const canRaise = observation.legalActions.raiseTo !== null || (observation.legalActions.allIn !== null && observation.legalActions.allIn.mode !== 'call');
  const bluffTriggered = canRaise && !valueRaiseAvailable && bluffRoll < bluffProbability;
  return { ...original, continueScore, raiseThreshold, valueRaiseAvailable, bluffProbability, bluffTriggered,
    slowPlayTriggered: original.slowPlayTriggered && valueRaiseAvailable && rivals.length === 1 };
}

export function difficultySizing(level: AiDifficulty, profile: Readonly<StyleProfile>, equity: number): Readonly<StyleProfile> {
  if (level !== 'challenging') return profile;
  // Keep character tendencies, but stop random overbets with weak hands.
  return { ...profile, riskAppetite: profile.riskAppetite * (equity > 0.8 ? 1 : 0.25),
    sizing: { ...profile.sizing, variance: profile.sizing.variance * 0.25,
      overbetFrequency: equity > 0.8 ? profile.sizing.overbetFrequency : 0 } };
}
