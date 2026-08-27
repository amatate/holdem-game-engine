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
import {
  ORACLE_COMPARISON_CASES,
  ORACLE_SCENARIOS,
} from '../fixtures/hand-ranks.js';

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

function normalizedRankMultiset(codes: readonly CardCode[]): string {
  return codes
    .map((code) => code[0])
    .sort()
    .join('');
}

function comparisonDirectionKey(left: readonly CardCode[], right: readonly CardCode[]): string {
  return `${left.join(' ')} | ${right.join(' ')}`;
}

function reverseComparison(expected: -1 | 0 | 1): -1 | 0 | 1 {
  return expected === 0 ? 0 : expected === 1 ? -1 : 1;
}

describe('hand evaluator oracle parity', () => {
  it('matches the independent oracle across at least 128 semantically distinct seven-card scenarios', () => {
    const scenarioHands = ORACLE_SCENARIOS.map(({ cards }) => cards);

    expect(ORACLE_SCENARIOS.length).toBeGreaterThanOrEqual(128);
    expect(new Set(scenarioHands.map((codes) => codes.join(' '))).size).toBe(ORACLE_SCENARIOS.length);
    expect(new Set(scenarioHands.map(normalizedRankMultiset)).size).toBe(ORACLE_SCENARIOS.length);
    for (const category of Object.values(CATEGORY_BY_ORACLE_NAME)) {
      expect(ORACLE_SCENARIOS.filter((scenario) => scenario.expectedCategory === category)).toHaveLength(20);
    }
    expect(
      ORACLE_SCENARIOS.some(
        (scenario) =>
          scenario.expectedCategory === 'straight' &&
          ['A', '5', '4', '3', '2'].every((rank) =>
            scenario.cards.some((code) => code[0] === rank),
          ),
      ),
    ).toBe(true);

    const observedCategories = new Set<HandCategory>();

    for (const scenario of ORACLE_SCENARIOS) {
      const { cards: codes } = scenario;
      expect(codes).toHaveLength(7);
      expect(new Set(codes).size).toBe(7);

      const oracle = solveWithOracle(codes);
      const oracleCategory = CATEGORY_BY_ORACLE_NAME[oracle.name];
      const actual = evaluateBest(codes.map(parseCard));

      expect(oracleCategory, `unmapped oracle category for ${scenario.id}`).toBeDefined();
      expect(oracleCategory, scenario.id).toBe(scenario.expectedCategory);
      expect(actual.category, scenario.id).toBe(oracleCategory);
      observedCategories.add(actual.category);
    }

    expect(observedCategories).toEqual(new Set(Object.values(CATEGORY_BY_ORACLE_NAME)));
  });

  it('matches explicit oracle ordering and tie cases for every vector layer', () => {
    expect(new Set(ORACLE_COMPARISON_CASES.map(({ id }) => id)).size).toBe(ORACLE_COMPARISON_CASES.length);
    expect(new Set(ORACLE_COMPARISON_CASES.map(({ expected }) => expected))).toEqual(
      new Set([-1, 0, 1]),
    );

    const expectedByDirection = new Map(
      ORACLE_COMPARISON_CASES.map(({ left, right, expected }) => [
        comparisonDirectionKey(left, right),
        expected,
      ]),
    );
    for (const comparison of ORACLE_COMPARISON_CASES) {
      expect(
        expectedByDirection.get(comparisonDirectionKey(comparison.right, comparison.left)),
        `${comparison.id} reverse coverage`,
      ).toBe(reverseComparison(comparison.expected));
    }

    for (const comparison of ORACLE_COMPARISON_CASES) {
      expect(comparison.left).toHaveLength(7);
      expect(comparison.right).toHaveLength(7);
      expect(new Set(comparison.left).size, `${comparison.id} left`).toBe(7);
      expect(new Set(comparison.right).size, `${comparison.id} right`).toBe(7);

      const oracleResult = compareWithOracle(
        solveWithOracle(comparison.left),
        solveWithOracle(comparison.right),
      );
      const actual = compareHandRanks(
        evaluateBest(comparison.left.map(parseCard)),
        evaluateBest(comparison.right.map(parseCard)),
      );

      expect(oracleResult, `${comparison.id} oracle`).toBe(comparison.expected);
      expect(actual, comparison.id).toBe(oracleResult);
    }
  });

  it('rejects repeated cards in both five-card and seven-card APIs', () => {
    expect(() => evaluateFive(['As', 'As', 'Qs', 'Js', 'Ts'].map(parseCard))).toThrow(/distinct/i);
    expect(() =>
      evaluateBest(['As', 'As', 'Qs', 'Js', 'Ts', '2d', '3c'].map(parseCard)),
    ).toThrow(/distinct/i);
  });
});
