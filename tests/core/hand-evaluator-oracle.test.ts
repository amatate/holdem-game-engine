/**
 * Independent test oracle: pokersolver 2.1.4 (MIT).
 * Upstream: https://github.com/goldfire/pokersolver
 *
 * The oracle is loaded only from this test through createRequire. No oracle
 * source is copied into, or imported by, the production evaluator.
 */
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import {
  compareHandRanks,
  evaluateBest,
  evaluateFive,
  type HandCategory,
} from '../../src/core/hand-evaluator.js';
import type { CardCode } from '../../src/core/types.js';
import { ORACLE_HANDS } from '../fixtures/hand-ranks.js';

interface OracleSolvedHand {
  readonly name: string;
}

interface OracleHandAdapter {
  solve(cards: string[]): OracleSolvedHand;
  winners(hands: OracleSolvedHand[]): OracleSolvedHand[];
}

const require = createRequire(import.meta.url);
const { Hand: OracleHand } = require('pokersolver') as { readonly Hand: OracleHandAdapter };

const CATEGORY_BY_ORACLE_NAME: Readonly<Record<string, HandCategory>> = {
  'High Card': 'high-card',
  Pair: 'one-pair',
  'Two Pair': 'two-pair',
  'Three of a Kind': 'three-of-a-kind',
  Straight: 'straight',
  Flush: 'flush',
  'Full House': 'full-house',
  'Four of a Kind': 'four-of-a-kind',
  'Straight Flush': 'straight-flush',
};

function solveWithOracle(codes: readonly CardCode[]): OracleSolvedHand {
  return OracleHand.solve([...codes]);
}

function compareWithOracle(left: OracleSolvedHand, right: OracleSolvedHand): -1 | 0 | 1 {
  const winners = OracleHand.winners([left, right]);

  if (winners.length === 2) {
    return 0;
  }

  return winners[0] === left ? 1 : -1;
}

describe('hand evaluator oracle parity', () => {
  it('matches the independent oracle category across at least 128 fixed seven-card hands', () => {
    expect(ORACLE_HANDS.length).toBeGreaterThanOrEqual(128);
    expect(new Set(ORACLE_HANDS.map((codes) => codes.join(' '))).size).toBeGreaterThanOrEqual(128);

    const observedCategories = new Set<HandCategory>();

    for (const codes of ORACLE_HANDS) {
      expect(codes).toHaveLength(7);
      expect(new Set(codes).size).toBe(7);

      const oracle = solveWithOracle(codes);
      const expectedCategory = CATEGORY_BY_ORACLE_NAME[oracle.name];
      const actual = evaluateBest(codes.map(parseCard));

      expect(expectedCategory, `unmapped oracle category for ${codes.join(' ')}`).toBeDefined();
      expect(actual.category, codes.join(' ')).toBe(expectedCategory);
      observedCategories.add(actual.category);
    }

    expect(observedCategories).toEqual(new Set(Object.values(CATEGORY_BY_ORACLE_NAME)));
  });

  it('matches oracle ordering and ties for every adjacent fixed-hand pair', () => {
    for (let index = 1; index < ORACLE_HANDS.length; index += 1) {
      const leftCodes = ORACLE_HANDS[index - 1]!;
      const rightCodes = ORACLE_HANDS[index]!;
      const expected = compareWithOracle(solveWithOracle(leftCodes), solveWithOracle(rightCodes));
      const actual = compareHandRanks(
        evaluateBest(leftCodes.map(parseCard)),
        evaluateBest(rightCodes.map(parseCard)),
      );

      expect(actual, `${leftCodes.join(' ')} vs ${rightCodes.join(' ')}`).toBe(expected);
    }
  });

  it('rejects repeated cards in both five-card and seven-card APIs', () => {
    expect(() => evaluateFive(['As', 'As', 'Qs', 'Js', 'Ts'].map(parseCard))).toThrow(/distinct/i);
    expect(() =>
      evaluateBest(['As', 'As', 'Qs', 'Js', 'Ts', '2d', '3c'].map(parseCard)),
    ).toThrow(/distinct/i);
  });
});
