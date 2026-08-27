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

export type OracleCategory =
  | 'high-card'
  | 'one-pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

export interface OracleScenario {
  readonly id: string;
  readonly expectedCategory: OracleCategory;
  readonly cards: readonly CardCode[];
}

export interface OracleComparisonCase {
  readonly id: string;
  readonly left: readonly CardCode[];
  readonly right: readonly CardCode[];
  readonly expected: -1 | 0 | 1;
}

const RANK_CODES = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
type RankCode = (typeof RANK_CODES)[number];

const SUITS = ['c', 'd', 'h', 's'] as const satisfies readonly Suit[];
const TARGET_PER_CATEGORY = 20;

function card(rank: RankCode, suit: Suit): CardCode {
  return `${rank}${suit}`;
}

function combinations<T>(values: readonly T[], count: number): T[][] {
  const result: T[][] = [];
  const selected: T[] = [];

  function visit(startIndex: number): void {
    if (selected.length === count) {
      result.push([...selected]);
      return;
    }

    const valuesStillNeeded = count - selected.length;
    for (let index = startIndex; index <= values.length - valuesStillNeeded; index += 1) {
      selected.push(values[index]!);
      visit(index + 1);
      selected.pop();
    }
  }

  visit(0);
  return result;
}

function rankValue(rank: RankCode): number {
  return 14 - RANK_CODES.indexOf(rank);
}

function rankMultiset(cards: readonly CardCode[]): string {
  return cards
    .map((code) => rankValue(code[0] as RankCode))
    .sort((left, right) => right - left)
    .join('-');
}

function containsStraight(ranks: readonly RankCode[]): boolean {
  const values = new Set(ranks.map(rankValue));

  for (let high = 14; high >= 6; high -= 1) {
    if ([0, 1, 2, 3, 4].every((offset) => values.has(high - offset))) {
      return true;
    }
  }

  return [14, 5, 4, 3, 2].every((value) => values.has(value));
}

function straightRanks(high: number): readonly RankCode[] {
  if (high === 5) {
    return ['A', '5', '4', '3', '2'];
  }

  return [high, high - 1, high - 2, high - 3, high - 4].map(
    (value) => RANK_CODES[14 - value]!,
  );
}

function buildOracleScenarios(): readonly OracleScenario[] {
  const scenarios: OracleScenario[] = [];
  const usedRankMultisets = new Set<string>();
  const categoryCounts = new Map<OracleCategory, number>();

  function count(category: OracleCategory): number {
    return categoryCounts.get(category) ?? 0;
  }

  function add(category: OracleCategory, cards: readonly CardCode[]): void {
    if (count(category) >= TARGET_PER_CATEGORY) {
      return;
    }

    const signature = rankMultiset(cards);
    if (usedRankMultisets.has(signature)) {
      return;
    }

    usedRankMultisets.add(signature);
    const nextCount = count(category) + 1;
    categoryCounts.set(category, nextCount);
    scenarios.push({ id: `${category}-${nextCount}`, expectedCategory: category, cards });
  }

  // Runs vary in height, side ranks, and winning-five positions.
  for (let variation = 0; count('straight-flush') < TARGET_PER_CATEGORY; variation += 1) {
    for (let high = 5; high <= 14; high += 1) {
      const run = straightRanks(high);
      const extras = combinations(
        RANK_CODES.filter((rank) => !run.includes(rank)),
        2,
      );
      const selectedExtras = extras[variation % extras.length]!;
      add('straight-flush', [
        card(selectedExtras[0]!, 'c'),
        ...run.map((rank) => card(rank, 'h')),
        card(selectedExtras[1]!, 'd'),
      ]);
    }
  }

  for (let variation = 0; count('straight') < TARGET_PER_CATEGORY; variation += 1) {
    for (let high = 5; high <= 14; high += 1) {
      const run = straightRanks(high);
      const extras = combinations(
        RANK_CODES.filter((rank) => !run.includes(rank)),
        2,
      );
      const selectedExtras = extras[(variation * 3 + high) % extras.length]!;
      add('straight', [
        card(selectedExtras[0]!, 'd'),
        ...run.map((rank, index) => card(rank, SUITS[index % SUITS.length]!)),
        card(selectedExtras[1]!, 'h'),
      ]);
    }
  }

  // Multiplicity categories rotate the made rank and independently vary side ranks.
  for (let variation = 0; count('four-of-a-kind') < TARGET_PER_CATEGORY; variation += 1) {
    for (const [rankIndex, madeRank] of RANK_CODES.entries()) {
      const sideRankSets = combinations(
        RANK_CODES.filter((rank) => rank !== madeRank),
        3,
      );
      const sideRanks = sideRankSets[(variation * 11 + rankIndex) % sideRankSets.length]!;
      add('four-of-a-kind', [
        ...SUITS.map((suit) => card(madeRank, suit)),
        card(sideRanks[0]!, 'c'),
        card(sideRanks[1]!, 'd'),
        card(sideRanks[2]!, 'h'),
      ]);
    }
  }

  for (let variation = 0; count('full-house') < TARGET_PER_CATEGORY; variation += 1) {
    for (const [rankIndex, tripRank] of RANK_CODES.entries()) {
      const remaining = RANK_CODES.filter((rank) => rank !== tripRank);
      const pairRank = remaining[(variation + rankIndex) % remaining.length]!;
      const singles = combinations(
        remaining.filter((rank) => rank !== pairRank),
        2,
      );
      const sideRanks = singles[(variation * 7 + rankIndex) % singles.length]!;
      add('full-house', [
        card(tripRank, 'c'),
        card(tripRank, 'd'),
        card(tripRank, 'h'),
        card(pairRank, 's'),
        card(pairRank, 'c'),
        card(sideRanks[0]!, 'd'),
        card(sideRanks[1]!, 'h'),
      ]);
    }
  }

  for (let variation = 0; count('three-of-a-kind') < TARGET_PER_CATEGORY; variation += 1) {
    for (const [rankIndex, tripRank] of RANK_CODES.entries()) {
      const sideRankSets = combinations(
        RANK_CODES.filter((rank) => rank !== tripRank),
        4,
      ).filter((ranks) => !containsStraight([tripRank, ...ranks]));
      const sideRanks = sideRankSets[(variation * 13 + rankIndex) % sideRankSets.length]!;
      add('three-of-a-kind', [
        card(tripRank, 'c'),
        card(tripRank, 'd'),
        card(tripRank, 'h'),
        ...sideRanks.map((rank, index) => card(rank, SUITS[(index + 3) % SUITS.length]!)),
      ]);
    }
  }

  const pairRankSets = combinations(RANK_CODES, 2);
  for (const [pairIndex, pairRanks] of pairRankSets.entries()) {
    const sideRankSets = combinations(
      RANK_CODES.filter((rank) => !pairRanks.includes(rank)),
      3,
    ).filter((ranks) => !containsStraight([...pairRanks, ...ranks]));
    const sideRanks = sideRankSets[(pairIndex * 5) % sideRankSets.length]!;
    add('two-pair', [
      card(pairRanks[0]!, 'c'),
      card(pairRanks[0]!, 'd'),
      card(sideRanks[0]!, 'c'),
      card(pairRanks[1]!, 'h'),
      card(pairRanks[1]!, 's'),
      card(sideRanks[1]!, 'h'),
      card(sideRanks[2]!, 'd'),
    ]);
  }

  for (let variation = 0; count('one-pair') < TARGET_PER_CATEGORY; variation += 1) {
    for (const [rankIndex, pairRank] of RANK_CODES.entries()) {
      const sideRankSets = combinations(
        RANK_CODES.filter((rank) => rank !== pairRank),
        5,
      ).filter((ranks) => !containsStraight([pairRank, ...ranks]));
      const sideRanks = sideRankSets[(variation * 17 + rankIndex) % sideRankSets.length]!;
      add('one-pair', [
        card(pairRank, 'c'),
        card(sideRanks[0]!, 'h'),
        card(sideRanks[1]!, 's'),
        card(pairRank, 'd'),
        card(sideRanks[2]!, 'c'),
        card(sideRanks[3]!, 'd'),
        card(sideRanks[4]!, 'h'),
      ]);
    }
  }

  // Distinct-rank categories deliberately exclude straight rank sets.
  for (const flushRanks of combinations(RANK_CODES, 5).filter((ranks) => !containsStraight(ranks))) {
    const extras = combinations(
      RANK_CODES.filter((rank) => !flushRanks.includes(rank)),
      2,
    );
    for (const sideRanks of extras) {
      add('flush', [
        card(sideRanks[0]!, 'c'),
        ...flushRanks.map((rank) => card(rank, 'h')),
        card(sideRanks[1]!, 'd'),
      ]);
    }
  }

  for (const ranks of combinations(RANK_CODES, 7).filter((candidate) => !containsStraight(candidate))) {
    add('high-card', ranks.map((rank, index) => card(rank, SUITS[index % SUITS.length]!)));
  }

  const incomplete = ([
    'high-card',
    'one-pair',
    'two-pair',
    'three-of-a-kind',
    'straight',
    'flush',
    'full-house',
    'four-of-a-kind',
    'straight-flush',
  ] as const).filter((category) => count(category) !== TARGET_PER_CATEGORY);
  if (incomplete.length > 0) {
    throw new Error(`Incomplete oracle fixture categories: ${incomplete.join(', ')}`);
  }

  return scenarios;
}

export const ORACLE_SCENARIOS = buildOracleScenarios();

function hand(...cards: CardCode[]): readonly CardCode[] {
  return cards;
}

export const ORACLE_COMPARISON_CASES = [
  // Category boundaries.
  { id: 'straight-flush beats quads', left: hand('As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c'), right: hand('Ah', 'Ad', 'Ac', 'As', 'Kd', 'Qc', '2s'), expected: 1 },
  { id: 'quads beat full house', left: hand('Ah', 'Ad', 'Ac', 'As', 'Kd', 'Qc', '2s'), right: hand('Kh', 'Kd', 'Kc', '2s', '2d', 'As', 'Qc'), expected: 1 },
  { id: 'full house beats flush', left: hand('Kh', 'Kd', 'Kc', '2s', '2d', 'As', 'Qc'), right: hand('Ah', 'Jh', '8h', '4h', '2h', 'Ks', 'Qc'), expected: 1 },
  { id: 'flush beats straight', left: hand('Ah', 'Jh', '8h', '4h', '2h', 'Ks', 'Qc'), right: hand('As', 'Kd', 'Qh', 'Jc', 'Ts', '2d', '3c'), expected: 1 },
  { id: 'straight beats trips', left: hand('As', 'Kd', 'Qh', 'Jc', 'Ts', '2d', '3c'), right: hand('Qh', 'Qd', 'Qc', '9s', '2d', 'Ac', 'Ks'), expected: 1 },
  { id: 'trips beat two pair', left: hand('Qh', 'Qd', 'Qc', '9s', '2d', 'Ac', 'Ks'), right: hand('Jh', 'Jd', '4c', '4s', 'Ad', 'Kc', '2h'), expected: 1 },
  { id: 'two pair beats pair', left: hand('Jh', 'Jd', '4c', '4s', 'Ad', 'Kc', '2h'), right: hand('Th', 'Td', 'As', '7c', '3d', 'Kc', '2s'), expected: 1 },
  { id: 'pair beats high card', left: hand('Th', 'Td', 'As', '7c', '3d', 'Kc', '2s'), right: hand('As', 'Jd', '8c', '5s', '2d', 'Kh', '7c'), expected: 1 },
  { id: 'high card loses to pair', left: hand('As', 'Jd', '8c', '5s', '2d', 'Kh', '7c'), right: hand('Th', 'Td', 'As', '7c', '3d', 'Kc', '2s'), expected: -1 },

  // Made-rank and kicker boundaries for every vector layer.
  { id: 'straight-flush high card', left: hand('9s', '8s', '7s', '6s', '5s', 'Ac', 'Kd'), right: hand('8h', '7h', '6h', '5h', '4h', 'As', 'Kc'), expected: 1 },
  { id: 'quads made rank', left: hand('Ah', 'Ad', 'Ac', 'As', '2d', '3c', '4h'), right: hand('Kh', 'Kd', 'Kc', 'Ks', 'Ad', '2c', '3h'), expected: 1 },
  { id: 'quads kicker', left: hand('Ah', 'Ad', 'Ac', 'As', 'Kd', '2c', '3h'), right: hand('Ah', 'Ad', 'Ac', 'As', 'Qd', '2c', '3h'), expected: 1 },
  { id: 'full-house trips', left: hand('Kh', 'Kd', 'Kc', '2s', '2d', '3c', '4h'), right: hand('Qh', 'Qd', 'Qc', 'As', 'Ad', '2c', '3h'), expected: 1 },
  { id: 'full-house pair', left: hand('Kh', 'Kd', 'Kc', 'Qs', 'Qd', '2c', '3h'), right: hand('Kh', 'Kd', 'Kc', 'Js', 'Jd', '2c', '3h'), expected: 1 },
  { id: 'flush first rank', left: hand('Ah', 'Jh', '8h', '4h', '2h', '6c', '3d'), right: hand('Kh', 'Jh', '8h', '4h', '2h', '6c', '3d'), expected: 1 },
  { id: 'flush second rank', left: hand('Ah', 'Kh', '8h', '4h', '2h', '6c', '3d'), right: hand('As', 'Qs', '8s', '4s', '2s', '6c', '3d'), expected: 1 },
  { id: 'flush third rank', left: hand('Ah', 'Kh', 'Qh', '4h', '2h', '6c', '3d'), right: hand('As', 'Ks', 'Js', '4s', '2s', '6c', '3d'), expected: 1 },
  { id: 'flush fourth rank', left: hand('Ah', 'Kh', 'Qh', 'Jh', '2h', '6c', '3d'), right: hand('As', 'Ks', 'Qs', 'Ts', '2s', '6c', '3d'), expected: 1 },
  { id: 'flush fifth rank', left: hand('Ah', 'Kh', 'Qh', 'Jh', '9h', '2c', '3d'), right: hand('As', 'Ks', 'Qs', 'Js', '8s', '2c', '3d'), expected: 1 },
  { id: 'straight high card', left: hand('As', 'Kd', 'Qh', 'Jc', 'Ts', '2d', '3c'), right: hand('Kh', 'Qd', 'Jc', 'Ts', '9h', '2d', '3c'), expected: 1 },
  { id: 'trips made rank', left: hand('Qh', 'Qd', 'Qc', 'As', '9d', '2c', '3s'), right: hand('Jh', 'Jd', 'Jc', 'As', '9d', '2c', '3s'), expected: 1 },
  { id: 'trips first kicker', left: hand('Qh', 'Qd', 'Qc', 'As', '9d', '2c', '3s'), right: hand('Qs', 'Qd', 'Qc', 'Kh', 'Jd', '2c', '3s'), expected: 1 },
  { id: 'trips second kicker', left: hand('Qh', 'Qd', 'Qc', 'As', '9d', '2c', '3s'), right: hand('Qs', 'Qd', 'Qc', 'Ah', '8d', '2c', '3s'), expected: 1 },
  { id: 'two-pair top pair', left: hand('Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'), right: hand('Kh', 'Kd', 'Qh', 'Qd', 'As', '2c', '3h'), expected: 1 },
  { id: 'two-pair lower pair', left: hand('Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'), right: hand('As', 'Ac', 'Qh', 'Qd', 'Ks', '2c', '3h'), expected: 1 },
  { id: 'two-pair kicker', left: hand('Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'), right: hand('As', 'Ac', 'Ks', 'Kc', 'Jd', '2h', '3c'), expected: 1 },
  { id: 'pair made rank', left: hand('Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'), right: hand('Kh', 'Kd', 'As', 'Qc', '9d', '2c', '3s'), expected: 1 },
  { id: 'pair first kicker', left: hand('Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'), right: hand('As', 'Ac', 'Qh', 'Jc', 'Td', '2c', '3s'), expected: 1 },
  { id: 'pair second kicker', left: hand('Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'), right: hand('As', 'Ac', 'Kh', 'Jc', 'Td', '2c', '3s'), expected: 1 },
  { id: 'pair third kicker', left: hand('Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'), right: hand('As', 'Ac', 'Kh', 'Qd', '8c', '2c', '3s'), expected: 1 },
  { id: 'high-card first rank', left: hand('As', 'Qd', '9h', '6c', '3s', '2d', '4c'), right: hand('Ks', 'Qd', '9h', '6c', '3s', '2d', '4c'), expected: 1 },
  { id: 'high-card second rank', left: hand('As', 'Kd', '9h', '6c', '3s', '2d', '4c'), right: hand('Ah', 'Qd', '9s', '6c', '3h', '2d', '4c'), expected: 1 },
  { id: 'high-card third rank', left: hand('As', 'Kd', 'Qh', '8c', '3s', '2d', '5c'), right: hand('Ah', 'Kc', 'Jd', '8s', '3h', '2d', '5c'), expected: 1 },
  { id: 'high-card fourth rank', left: hand('As', 'Kd', 'Qh', '9c', '3s', '2d', '5c'), right: hand('Ah', 'Kc', 'Qd', '8s', '3h', '2d', '5c'), expected: 1 },
  { id: 'high-card fifth rank', left: hand('As', 'Kd', 'Qh', '9c', '6s', '2d', '3c'), right: hand('Ah', 'Kc', 'Qd', '9s', '5h', '2d', '3c'), expected: 1 },

  // Suit-insensitive ties for every category, including a board-play royal flush.
  { id: 'board royal flush tie', left: hand('As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d'), right: hand('As', 'Ks', 'Qs', 'Js', 'Ts', 'Ah', 'Ad'), expected: 0 },
  { id: 'straight-flush tie', left: hand('9s', '8s', '7s', '6s', '5s', 'Ac', 'Kd'), right: hand('9h', '8h', '7h', '6h', '5h', 'As', 'Kc'), expected: 0 },
  { id: 'quads tie', left: hand('Ah', 'Ad', 'Ac', 'As', 'Kd', '2c', '3h'), right: hand('Ah', 'Ad', 'Ac', 'As', 'Kh', '2d', '3c'), expected: 0 },
  { id: 'full-house tie', left: hand('Kh', 'Kd', 'Kc', 'As', 'Ad', '2c', '3h'), right: hand('Ks', 'Kh', 'Kd', 'Ac', 'Ah', '2d', '3s'), expected: 0 },
  { id: 'flush tie', left: hand('Ah', 'Kh', 'Qh', 'Jh', '9h', '2c', '3d'), right: hand('As', 'Ks', 'Qs', 'Js', '9s', '2c', '3d'), expected: 0 },
  { id: 'straight tie', left: hand('As', 'Kd', 'Qh', 'Jc', 'Ts', '2d', '3c'), right: hand('Ah', 'Kc', 'Qd', 'Js', 'Th', '2d', '3c'), expected: 0 },
  { id: 'trips tie', left: hand('Qh', 'Qd', 'Qc', 'As', '9d', '2c', '3s'), right: hand('Qs', 'Qh', 'Qd', 'Ac', '9c', '2d', '3s'), expected: 0 },
  { id: 'two-pair tie', left: hand('Ah', 'Ad', 'Kh', 'Kd', 'Qs', '2c', '3h'), right: hand('As', 'Ac', 'Ks', 'Kc', 'Qd', '2h', '3c'), expected: 0 },
  { id: 'pair tie', left: hand('Ah', 'Ad', 'Ks', 'Qc', '9d', '2c', '3s'), right: hand('As', 'Ac', 'Kh', 'Qd', '9c', '2d', '3s'), expected: 0 },
  { id: 'high-card tie', left: hand('As', 'Kd', 'Qh', 'Jc', '9s', '2d', '3c'), right: hand('Ah', 'Kc', 'Qd', 'Js', '9h', '2d', '3c'), expected: 0 },
] as const satisfies readonly OracleComparisonCase[];
