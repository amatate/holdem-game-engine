import type { CharacterId } from './characters.js';
import type { ActionEvidence } from './table-memory.js';
import type { OpponentRead } from './opponent-ranges.js';

// Different priors and trust in small samples, not knowledge of the opponent's real profile.
const temperament: Record<CharacterId, { prior: number; suspicion: number }> = {
  hunter: { prior: 3, suspicion: .12 }, maniac: { prior: 2, suspicion: .28 },
  'calling-station': { prior: 6, suspicion: .06 }, rock: { prior: 7, suspicion: .05 },
  'small-ball': { prior: 4, suspicion: .16 }, trapper: { prior: 5, suspicion: .10 },
  'value-bettor': { prior: 5, suspicion: .08 },
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Reconstructed from completed rolling public history: deterministic, forgetful, no private facts. */
export function interpretOpponent(character: CharacterId, evidence: ActionEvidence, shownHighCardAggression: number): OpponentRead {
  const bias = temperament[character], total = evidence.hands + bias.prior;
  return {
    confidence: Math.min(.85, evidence.hands / total),
    aggression: clamp((evidence.aggressiveHands + bias.prior * .35) / total),
    foldRate: clamp((evidence.folds + bias.prior * .35) / total),
    callRate: clamp((evidence.calls + bias.prior * .4) / (evidence.actions + bias.prior)),
    // High-card aggression is evidence of possible bluffing, not proof of intent.
    bluffRate: clamp((shownHighCardAggression * .65 + bias.prior * bias.suspicion) / total),
  };
}
