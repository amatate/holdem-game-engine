import type { CardCode, Suit } from '../../src/core/types.js';

export const HAND_CASES = [
  { cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'], vector: [8, 14], category: 'straight-flush' },
  { cards: ['9s', '8s', '7s', '6s', '5s'], vector: [8, 9], category: 'straight-flush' },
  { cards: ['Ah', 'Ad', 'Ac', 'As', 'Kd'], vector: [7, 14, 13], category: 'four-of-a-kind' },
  { cards: ['Kh', 'Kd', 'Kc', '2s', '2d'], vector: [6, 13, 2], category: 'full-house' },
  { cards: ['Ah', 'Jh', '8h', '4h', '2h'], vector: [5, 14, 11, 8, 4, 2], category: 'flush' },
  { cards: ['As', '2d', '3h', '4c', '5s'], vector: [4, 5], category: 'straight' },
  { cards: ['Qh', 'Qd', 'Qc', '9s', '2d'], vector: [3, 12, 9, 2], category: 'three-of-a-kind' },
  { cards: ['Jh', 'Jd', '4c', '4s', 'Ad'], vector: [2, 11, 4, 14], category: 'two-pair' },
  { cards: ['Th', 'Td', 'As', '7c', '3d'], vector: [1, 10, 14, 7, 3], category: 'one-pair' },
  { cards: ['As', 'Jd', '8c', '5s', '2d'], vector: [0, 14, 11, 8, 5, 2], category: 'high-card' },
] as const;

// Literal seeds deliberately cover every category, the wheel, and paired hands
// whose result depends on each successive kicker layer. Applying three fixed suit
// bijections gives 198 evaluator-independent seven-card inputs while preserving
// each seed's poker value and distinct-card property.
const ORACLE_SEED_HANDS = [
  // Every category, including both ace-high and nine-high straight flushes.
  ['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c'],
  ['9s', '8s', '7s', '6s', '5s', 'Ac', 'Kd'],
  ['Ah', 'Ad', 'Ac', 'As', 'Kd', 'Qc', '2s'],
  ['9h', '9d', '9c', '9s', 'Ad', 'Kc', '2s'],
  ['Kh', 'Kd', 'Kc', '2s', '2d', 'As', 'Qc'],
  ['Ah', 'Ad', 'Ac', 'Ks', 'Kd', 'Qc', 'Js'],
  ['Ah', 'Jh', '8h', '4h', '2h', 'Ks', 'Qc'],
  ['Kh', 'Th', '9h', '5h', '3h', 'As', '2c'],
  ['As', '2d', '3h', '4c', '5s', 'Kd', 'Qh'],
  ['9s', '8d', '7h', '6c', '5s', 'Ac', 'Kd'],
  ['Qh', 'Qd', 'Qc', '9s', '2d', 'Ac', 'Ks'],
  ['Jh', 'Jd', 'Jc', 'As', '9d', '7c', '2s'],
  ['Jh', 'Jd', '4c', '4s', 'Ad', 'Kc', '2h'],
  ['Ah', 'Ad', 'Kh', 'Kd', 'Qs', 'Jc', '2s'],
  ['Th', 'Td', 'As', '7c', '3d', 'Kc', '2s'],
  ['Ah', 'Ad', 'Ks', 'Qc', '9d', '7c', '2s'],
  ['As', 'Jd', '8c', '5s', '2d', 'Kh', '7c'],
  ['Ks', 'Qd', '9c', '6s', '3d', 'Jh', '2c'],

  // Four-of-a-kind kicker; full-house trip rank and pair rank.
  ['Ah', 'Ad', 'Ac', 'As', 'Kd', '2c', '3h'],
  ['Ah', 'Ad', 'Ac', 'As', 'Qd', '2c', '3h'],
  ['Kh', 'Kd', 'Kc', 'As', 'Ad', '2c', '3h'],
  ['Qh', 'Qd', 'Qc', 'As', 'Ad', '2c', '3h'],
  ['Kh', 'Kd', 'Kc', 'Qs', 'Qd', '2c', '3h'],
  ['Kh', 'Kd', 'Kc', 'Js', 'Jd', '2c', '3h'],

  // Flush and high-card final-kicker comparisons.
  ['Ah', 'Kh', 'Qh', 'Jh', '9h', '2c', '3d'],
  ['As', 'Ks', 'Qs', 'Js', '8s', '2c', '3d'],
  ['As', 'Kd', 'Qh', 'Jc', '9s', '2d', '3c'],
  ['Ah', 'Kc', 'Qd', 'Js', '8h', '2d', '3c'],

  // Three-of-a-kind first and second kicker comparisons.
  ['Qh', 'Qd', 'Qc', 'As', '9d', '2c', '3s'],
  ['Qh', 'Qd', 'Qc', 'Ks', 'Jd', '2c', '3s'],
  ['Qh', 'Qd', 'Qc', 'As', '8d', '2c', '3s'],
  ['Qh', 'Qd', 'Qc', 'Ad', '7s', '2c', '3h'],

  // Two-pair top pair, lower pair, and kicker comparisons.
  ['Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'],
  ['Kh', 'Kd', 'Qh', 'Qd', 'As', '2c', '3h'],
  ['Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'],
  ['Ah', 'Ad', 'Qh', 'Qd', 'Ks', '2c', '3h'],
  ['Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'],
  ['Ah', 'Ad', 'Kh', 'Kd', 'Js', '2c', '3h'],

  // Pair rank and all three pair-kicker comparisons.
  ['Ah', 'Ad', 'Ks', 'Qc', '9d', '7c', '2s'],
  ['Kh', 'Kd', 'As', 'Qc', '9d', '7c', '2s'],
  ['Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'],
  ['Ah', 'Ad', 'Qs', 'Jc', 'Td', '2c', '3s'],
  ['Ah', 'Ad', 'Ks', 'Qc', '8d', '2c', '3s'],
  ['Ah', 'Ad', 'Kh', 'Jc', 'Td', '2c', '3s'],
  ['Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'],
  ['Ah', 'Ad', 'Kh', 'Qd', '8c', '2c', '3s'],

  // Straight high-card comparison and suit-insensitive ties in every category.
  ['As', 'Kd', 'Qh', 'Jc', 'Ts', '2d', '3c'],
  ['Kh', 'Qd', 'Jc', 'Ts', '9h', '2d', '3c'],
  ['As', 'Kd', 'Qh', 'Jc', 'Ts', '2d', '3c'],
  ['Ah', 'Kc', 'Qd', 'Js', 'Th', '2d', '3c'],
  ['Ah', 'Kh', 'Qh', 'Jh', '9h', '2c', '3d'],
  ['As', 'Ks', 'Qs', 'Js', '9s', '2c', '3d'],
  ['As', 'Kd', 'Qh', 'Jc', '9s', '2d', '3c'],
  ['Ah', 'Kc', 'Qd', 'Js', '9h', '2d', '3c'],
  ['Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'],
  ['As', 'Ac', 'Kh', 'Qd', '9c', '2d', '3s'],
  ['Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'],
  ['As', 'Ac', 'Ks', 'Kc', 'Qd', '2h', '3c'],
  ['Qh', 'Qd', 'Qc', 'As', '9d', '2c', '3s'],
  ['Qs', 'Qh', 'Qd', 'Ac', '9c', '2d', '3s'],
  ['Kh', 'Kd', 'Kc', 'As', 'Ad', '2c', '3h'],
  ['Ks', 'Kh', 'Kd', 'Ac', 'Ah', '2d', '3s'],
  ['Ah', 'Ad', 'Ac', 'As', 'Kd', '2c', '3h'],
  ['Ah', 'Ad', 'Ac', 'As', 'Kh', '2d', '3c'],
  ['9s', '8s', '7s', '6s', '5s', 'Ac', 'Kd'],
  ['9h', '8h', '7h', '6h', '5h', 'As', 'Kc'],
] as const satisfies readonly (readonly CardCode[])[];

const SUIT_PERMUTATIONS = [
  { c: 'c', d: 'd', h: 'h', s: 's' },
  { c: 'd', d: 'c', h: 's', s: 'h' },
  { c: 'h', d: 's', h: 'c', s: 'd' },
] as const satisfies readonly Readonly<Record<Suit, Suit>>[];

function remapSuit(card: CardCode, permutation: Readonly<Record<Suit, Suit>>): CardCode {
  const rank = card[0];
  const suit = card[1] as Suit;
  return `${rank}${permutation[suit]}` as CardCode;
}

export const ORACLE_HANDS: readonly (readonly CardCode[])[] = ORACLE_SEED_HANDS.flatMap((cards) =>
  SUIT_PERMUTATIONS.map((permutation) => cards.map((card) => remapSuit(card, permutation))),
);
