import { estimateKnownHandEquity, type KnownHandEquityInput } from '../agents/equity.js';
import type { RandomSource } from '../core/types.js';

export type StrengthBand = 'weak' | 'medium' | 'strong';
export const READ_STRENGTH_SAMPLE_COUNT = 1000;
export const READ_STRENGTH_ALGORITHM_VERSION = 'known-hand-monte-carlo-v1';

export function strengthBand(equity: number, livePlayerCount: number): StrengthBand {
  const fairShare = 1 / livePlayerCount;
  return equity < 0.8 * fairShare ? 'weak' : equity < 1.5 * fairShare ? 'medium' : 'strong';
}

export function classifyKnownHandStrength(input: KnownHandEquityInput, random: RandomSource): StrengthBand {
  return strengthBand(estimateKnownHandEquity(input, READ_STRENGTH_SAMPLE_COUNT, random).equity, input.livePlayerCount);
}
