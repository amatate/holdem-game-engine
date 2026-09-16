import type { CharacterId } from './characters.js';
import type { PlayerObservationV1, StyleProfile } from './types.js';
import type { ActionEvidence, PublicOutcome } from './table-memory.js';

export type StreetPlan = 'none' | 'pressure' | 'control';
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Board texture only; deliberately makes no claim about anyone's hidden cards. */
export function pressuredBoard(observation: Pick<PlayerObservationV1, 'board'>): boolean {
  const cards = observation.board;
  const suits = new Map<string, number>();
  const ranks = new Set<number>(cards.map((card) => card.rank));
  if (ranks.has(14)) ranks.add(1);
  for (const card of cards) suits.set(card.suit, (suits.get(card.suit) ?? 0) + 1);
  if ([...suits.values()].some((count) => count >= 3)) return true;
  for (let low = 1; low <= 10; low++) {
    if (Array.from({ length: 5 }, (_, index) => low + index).filter((rank) => ranks.has(rank)).length >= 4) return true;
  }
  return false;
}

export function personaProfile(character: CharacterId, base: Readonly<StyleProfile>, observation: Readonly<PlayerObservationV1>,
  situation: { plan: StreetPlan; evidence: ActionEvidence; pressureHands: number; shownHighCardAggression: number; outcome: PublicOutcome | null }): StyleProfile {
  const profile = { ...base, sizing: { ...base.sizing } };
  const pay = observation.legalActions.call?.pay ?? 0;
  const stack = observation.seats.find((seat) => seat.seatIndex === observation.actorSeatIndex)?.stack ?? 0;
  const expensive = pay > 0 && (pay / Math.max(1, observation.potTotal) >= 0.5 || pay / Math.max(1, stack) >= 0.4);
  if (character === 'hunter') {
    if (situation.evidence.hands >= 3 && (situation.pressureHands >= 2 || situation.shownHighCardAggression >= 2)) {
      profile.stickiness = clamp(profile.stickiness + 0.10);
      profile.bluffing = clamp(profile.bluffing - 0.04);
    }
    if (situation.plan === 'control' || expensive) {
      profile.aggression = clamp(profile.aggression - 0.22);
      profile.bluffing = clamp(profile.bluffing - 0.12);
      profile.riskAppetite = clamp(profile.riskAppetite - 0.12);
    } else if (situation.plan === 'pressure') {
      profile.aggression = clamp(profile.aggression + 0.12);
      profile.bluffing = clamp(profile.bluffing + 0.04);
      profile.sizing.preferredPotFraction = 0.5;
    }
  } else if (character === 'maniac' && situation.outcome) {
    const age = observation.handNumber - situation.outcome.hand;
    const intensity = age >= 1 && age <= 3 ? 2 ** (1 - age) : 0;
    if (Math.abs(situation.outcome.net) >= situation.outcome.bigBlind * 10 && intensity > 0) {
      const chasing = situation.outcome.net < 0;
      profile.aggression = clamp(profile.aggression + (chasing ? 0.08 : 0.03) * intensity);
      profile.looseness = clamp(profile.looseness + (chasing ? 0.10 : 0.03) * intensity);
      profile.bluffing = clamp(profile.bluffing + (chasing ? 0.12 : 0.04) * intensity);
      profile.riskAppetite = clamp(profile.riskAppetite + (chasing ? 0.10 : 0.04) * intensity);
      profile.sizing.overbetFrequency = clamp(profile.sizing.overbetFrequency + (chasing ? 0.18 : 0.06) * intensity);
    }
  } else if (character === 'calling-station' && pay > 0) {
    if (expensive) {
      profile.stickiness = clamp(profile.stickiness - 0.42);
      profile.looseness = clamp(profile.looseness - 0.28);
      profile.riskAppetite = clamp(profile.riskAppetite - 0.18);
      profile.bluffing = 0;
    } else if (pay / Math.max(1, observation.potTotal) <= 0.2) {
      profile.stickiness = clamp(profile.stickiness + 0.05);
      profile.looseness = clamp(profile.looseness + 0.04);
    }
  }
  return profile;
}
