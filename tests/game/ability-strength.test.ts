import { describe, expect, it } from 'vitest';
import { parseCard } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';
import { classifyKnownHandStrength, strengthBand } from '../../src/game/ability-strength.js';
import { estimateKnownHandEquity } from '../../src/agents/equity.js';

describe('coarse strength read', () => {
  it('uses table-relative boundaries, including exact thresholds', () => {
    expect(strengthBand(0.399, 2)).toBe('weak');
    expect(strengthBand(0.4, 2)).toBe('medium');
    expect(strengthBand(0.75, 2)).toBe('strong');
    expect(strengthBand(0.25, 6)).toBe('strong');
  });
  it('splits shared-board ties exactly and never mistakes a guaranteed chop for strength', () => {
    const input = { holeCards: [parseCard('2c'), parseCard('3d')] as const,
      board: ['As', 'Ks', 'Qs', 'Js', 'Ts'].map(parseCard), livePlayerCount: 6 };
    expect(estimateKnownHandEquity(input, 20, createSeededRandom('ties')))
      .toMatchObject({ equity: 1 / 6, wins: 0, ties: 20, losses: 0 });
    expect(classifyKnownHandStrength(input, createSeededRandom('ties'))).toBe('medium');
  });
  it('recognizes a locked royal flush and reproduces results from an independent seed', () => {
    const input = { holeCards: [parseCard('As'), parseCard('Ks')] as const,
      board: ['Qs', 'Js', 'Ts', '2d', '3h'].map(parseCard), livePlayerCount: 2 };
    expect(classifyKnownHandStrength(input, createSeededRandom('nuts'))).toBe('strong');
    const preflop = { ...input, board: [] };
    expect(classifyKnownHandStrength(preflop, createSeededRandom('same')))
      .toBe(classifyKnownHandStrength(preflop, createSeededRandom('same')));
    expect(() => estimateKnownHandEquity({ ...input, board: [parseCard('As'), ...input.board.slice(1)] }, 10, createSeededRandom('invalid'))).toThrow();
  });
});
