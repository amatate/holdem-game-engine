import { describe, expect, it } from 'vitest';

import { buildPotLayers, type PotContribution } from '../../src/core/pots.js';

function contributions(
  amounts: readonly number[],
  foldedSeats: readonly number[] = [],
): PotContribution[] {
  return amounts.map((committedHand, seatIndex) => ({
    seatIndex,
    committedHand,
    folded: foldedSeats.includes(seatIndex),
  }));
}

describe('buildPotLayers', () => {
  it('builds deterministic main and side pots from pure contribution caps', () => {
    const input = contributions([25, 50, 100, 100]);
    const snapshot = structuredClone(input);

    expect(buildPotLayers(input)).toEqual({
      pots: [
        { amount: 100, cap: 25, eligibleSeats: [0, 1, 2, 3] },
        { amount: 75, cap: 50, eligibleSeats: [1, 2, 3] },
        { amount: 100, cap: 100, eligibleSeats: [2, 3] },
      ],
      refunds: [],
    });
    expect(input).toEqual(snapshot);
  });

  it('turns a top layer with one contributor into a refund', () => {
    expect(buildPotLayers(contributions([60, 100, 200]))).toEqual({
      pots: [
        { amount: 180, cap: 60, eligibleSeats: [0, 1, 2] },
        { amount: 80, cap: 100, eligibleSeats: [1, 2] },
      ],
      refunds: [{ seatIndex: 2, amount: 100 }],
    });
  });

  it('counts folded chips in every layer while excluding the folded seat from eligibility', () => {
    expect(buildPotLayers(contributions([50, 100, 100], [1]))).toEqual({
      pots: [
        { amount: 150, cap: 50, eligibleSeats: [0, 2] },
        { amount: 100, cap: 100, eligibleSeats: [2] },
      ],
      refunds: [],
    });
  });

  it('uses contributor count, not eligible count, when deciding a top-layer refund', () => {
    expect(buildPotLayers(contributions([100, 100, 60], [0]))).toEqual({
      pots: [
        { amount: 180, cap: 60, eligibleSeats: [1, 2] },
        { amount: 80, cap: 100, eligibleSeats: [1] },
      ],
      refunds: [],
    });
  });
});
