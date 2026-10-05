import type { PlayerObservationV1, StyleProfile } from './types.js';
import type { PolicyScores } from './parametric-agent.js';
import type { OpponentRead, OpponentReads } from './opponent-ranges.js';

export type DecisionPlan = 'value' | 'pressure' | 'draw' | 'control';
export interface TacticalContext {
  readonly previousPlan?: DecisionPlan;
  readonly reads?: OpponentReads;
}

export function currentPressure(observation: Readonly<PlayerObservationV1>): number {
  return observation.actionHistory.filter(e => e.type === 'playerActed' && e.seatIndex !== observation.actorSeatIndex
    && (e.kind === 'bet' || e.kind === 'raise') && (e.street === observation.street || e.street === undefined)
    && observation.seats.some(s => s.seatIndex === e.seatIndex && (s.status === 'active' || s.status === 'all-in'))).length;
}
export function primaryRead(observation: Readonly<PlayerObservationV1>, reads?: OpponentReads): OpponentRead | undefined {
  const live = observation.seats.filter(s => s.seatIndex !== observation.actorSeatIndex && (s.status === 'active' || s.status === 'all-in'));
  const aggressor = [...observation.actionHistory].reverse().find(e => e.type === 'playerActed'
    && (e.kind === 'bet' || e.kind === 'raise') && live.some(s => s.seatIndex === e.seatIndex));
  return reads?.get(aggressor?.seatIndex ?? live[0]?.seatIndex ?? -1);
}
export function isWetBoard(observation: Readonly<PlayerObservationV1>): boolean {
  const board = observation.board;
  const ranks = new Set<number>(board.map(c => c.rank)); if (ranks.has(14)) ranks.add(1);
  return board.some(c => board.filter(b => b.suit === c.suit).length >= 3)
    || Array.from({ length: 10 }, (_, i) => i + 1).some(low =>
      Array.from({ length: 5 }, (_, i) => low + i).filter(n => ranks.has(n)).length >= 4);
}
export function choosePlan(observation: Readonly<PlayerObservationV1>, equity: number, draw: number,
  previous?: DecisionPlan): DecisionPlan {
  if (equity >= .7) return 'value';
  if (draw > 0 && observation.street !== 'river') return 'draw';
  const pay = observation.legalActions.call?.pay ?? 0;
  const affordable = pay <= observation.potTotal * .2;
  if (previous === 'pressure' && !isWetBoard(observation) && affordable && currentPressure(observation) === 0) return 'pressure';
  return 'control';
}

/** Public context gates bluffs; stronger difficulty is not permission to erase personality. */
export function tacticalScores(original: PolicyScores, observation: Readonly<PlayerObservationV1>, profile: Readonly<StyleProfile>,
  equity: number, draw: number, bluffRoll: number, plan: DecisionPlan, read?: OpponentRead, challenging = false,
  canAggress = true): PolicyScores {
  const rivals = observation.seats.filter(s => s.seatIndex !== observation.actorSeatIndex && (s.status === 'active' || s.status === 'all-in'));
  const pay = observation.legalActions.call?.pay ?? 0;
  const pressure = currentPressure(observation);
  const wet = isWetBoard(observation);
  const confidence = read?.confidence ?? 0;
  const foldRate = read?.foldRate ?? .35;
  const foldFactor = Math.max(.25, Math.min(1.6, 1 + (foldRate - .35) * confidence * 2));
  const window = rivals.length === 1 && rivals[0]!.status === 'active' && pay <= observation.potTotal * (challenging ? .2 : .25)
    && pressure <= 1 && equity < .65 && (draw > 0 || !wet) && (!challenging || pay === 0 || draw > 0);
  const probability = window && canAggress ? Math.min(.35, profile.bluffing * (draw > 0 ? .45 : plan === 'pressure' ? .28 : .14) * foldFactor) : 0;
  const canRaise = canAggress && (observation.legalActions.raiseTo !== null || observation.legalActions.allIn?.mode === 'fullRaise'
    || observation.legalActions.allIn?.mode === 'shortRaise');
  const valueRaiseAvailable = original.valueRaiseAvailable && !(wet && equity < .6)
    && !(pressure >= 2 && equity < .68);
  const bluffTriggered = canRaise && !valueRaiseAvailable && bluffRoll < probability;
  // Price-sensitive bluff catching, bounded so a tiny sample cannot overrule clear odds.
  const catchAdjustment = pay > 0 ? ((read?.bluffRate ?? .1) - .1) * confidence * .12 : 0;
  return { ...original, valueRaiseAvailable, bluffProbability: probability, bluffTriggered,
    continueScore: original.continueScore + catchAdjustment,
    // Never trap on the river when checked to: there is no later street to earn value.
    slowPlayTriggered: original.slowPlayTriggered && valueRaiseAvailable && !wet && rivals.length === 1
      && !(observation.street === 'river' && pay === 0) };
}

export function tacticalSizing(profile: Readonly<StyleProfile>, observation: Readonly<PlayerObservationV1>,
  equity: number, plan: DecisionPlan, read?: OpponentRead): StyleProfile {
  const caller = (read?.confidence ?? 0) > .3 && (read?.callRate ?? 0) > .55;
  return { ...profile, sizing: { ...profile.sizing,
    preferredPotFraction: plan === 'pressure' || plan === 'draw' ? .5
      : plan === 'value' && caller ? 1 : profile.sizing.preferredPotFraction,
    // No random deep-stack shove with a weak hand. Short-stack legal jams remain possible.
    overbetFrequency: equity >= .72 ? profile.sizing.overbetFrequency : 0,
  } };
}
