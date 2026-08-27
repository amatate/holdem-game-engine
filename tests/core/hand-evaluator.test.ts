import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import {
  compareHandRanks,
  evaluateBest,
  evaluateFive,
} from '../../src/core/hand-evaluator.js';
import type { CardCode } from '../../src/core/types.js';
import { HAND_CASES } from '../fixtures/hand-ranks.js';

function cards(codes: readonly CardCode[]) {
  return codes.map(parseCard);
}

describe('hand evaluator', () => {
  it.each(HAND_CASES)('evaluates $category with its complete rank vector', (handCase) => {
    const result = evaluateFive(cards(handCase.cards));

    expect(result.category).toBe(handCase.category);
    expect(result.vector).toEqual(handCase.vector);
    expect(result.bestFive.map((card) => card.code)).toEqual(handCase.cards);
  });

  it('selects the strongest five-card combination from seven cards', () => {
    const result = evaluateBest(cards(['As', 'Ad', 'Ah', 'Kc', 'Kd', '2s', '3c']));

    expect(result.category).toBe('full-house');
    expect(result.vector).toEqual([6, 14, 13]);
    expect(result.bestFive.map((card) => card.code)).toEqual(['As', 'Ad', 'Ah', 'Kc', 'Kd']);
  });

  it('ties every player when the board is a royal flush', () => {
    const board = ['As', 'Ks', 'Qs', 'Js', 'Ts'] as const;
    const first = evaluateBest(cards([...board, '2c', '3d']));
    const second = evaluateBest(cards([...board, 'Ah', 'Ad']));

    expect(compareHandRanks(first, second)).toBe(0);
    expect(first.bestFive.map((card) => card.code)).toEqual(board);
    expect(second.bestFive.map((card) => card.code)).toEqual(board);
  });

  it('compares equal ranks as a tie regardless of suit', () => {
    const first = evaluateFive(cards(['As', 'Kd', 'Qh', 'Jc', '9s']));
    const second = evaluateFive(cards(['Ah', 'Kc', 'Qd', 'Js', '9h']));

    expect(compareHandRanks(first, second)).toBe(0);
  });
});
