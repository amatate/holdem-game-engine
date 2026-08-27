import type { Card } from './types.js';

export type HandCategory =
  | 'high-card'
  | 'one-pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

export interface HandRank {
  readonly category: HandCategory;
  readonly vector: readonly number[];
  readonly bestFive: readonly [Card, Card, Card, Card, Card];
}

interface RankCount {
  readonly rank: number;
  readonly count: number;
}

function requireDistinctCards(cards: readonly Card[]): void {
  if (new Set(cards.map((card) => card.code)).size !== cards.length) {
    throw new Error('Hand requires distinct cards');
  }
}

function toFiveCardTuple(cards: readonly Card[]): readonly [Card, Card, Card, Card, Card] {
  return [cards[0]!, cards[1]!, cards[2]!, cards[3]!, cards[4]!];
}

function findStraightHigh(descendingUniqueRanks: readonly number[]): number | null {
  if (
    descendingUniqueRanks.length === 5 &&
    descendingUniqueRanks.every((rank, index) => index === 0 || rank === descendingUniqueRanks[index - 1]! - 1)
  ) {
    return descendingUniqueRanks[0]!;
  }

  if (
    descendingUniqueRanks.length === 5 &&
    descendingUniqueRanks.every((rank, index) => rank === [14, 5, 4, 3, 2][index])
  ) {
    return 5;
  }

  return null;
}

export function evaluateFive(cards: readonly Card[]): HandRank {
  if (cards.length !== 5) {
    throw new Error('evaluateFive requires exactly five cards');
  }
  requireDistinctCards(cards);

  const countsByRank = new Map<number, number>();
  for (const card of cards) {
    countsByRank.set(card.rank, (countsByRank.get(card.rank) ?? 0) + 1);
  }

  const rankCounts: RankCount[] = [...countsByRank].map(([rank, count]) => ({ rank, count }));
  rankCounts.sort((left, right) => right.count - left.count || right.rank - left.rank);

  const descendingUniqueRanks = [...countsByRank.keys()].sort((left, right) => right - left);
  const straightHigh = findStraightHigh(descendingUniqueRanks);
  const flush = new Set(cards.map((card) => card.suit)).size === 1;
  const bestFive = toFiveCardTuple(cards);

  if (flush && straightHigh !== null) {
    return { category: 'straight-flush', vector: [8, straightHigh], bestFive };
  }

  if (rankCounts[0]?.count === 4) {
    return {
      category: 'four-of-a-kind',
      vector: [7, rankCounts[0].rank, rankCounts[1]!.rank],
      bestFive,
    };
  }

  if (rankCounts[0]?.count === 3 && rankCounts[1]?.count === 2) {
    return {
      category: 'full-house',
      vector: [6, rankCounts[0].rank, rankCounts[1].rank],
      bestFive,
    };
  }

  if (flush) {
    return { category: 'flush', vector: [5, ...descendingUniqueRanks], bestFive };
  }

  if (straightHigh !== null) {
    return { category: 'straight', vector: [4, straightHigh], bestFive };
  }

  if (rankCounts[0]?.count === 3) {
    return {
      category: 'three-of-a-kind',
      vector: [3, rankCounts[0].rank, ...rankCounts.slice(1).map(({ rank }) => rank)],
      bestFive,
    };
  }

  if (rankCounts[0]?.count === 2 && rankCounts[1]?.count === 2) {
    return {
      category: 'two-pair',
      vector: [2, rankCounts[0].rank, rankCounts[1].rank, rankCounts[2]!.rank],
      bestFive,
    };
  }

  if (rankCounts[0]?.count === 2) {
    return {
      category: 'one-pair',
      vector: [1, rankCounts[0].rank, ...rankCounts.slice(1).map(({ rank }) => rank)],
      bestFive,
    };
  }

  return { category: 'high-card', vector: [0, ...descendingUniqueRanks], bestFive };
}

export function compareHandRanks(left: HandRank, right: HandRank): -1 | 0 | 1 {
  const length = Math.max(left.vector.length, right.vector.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left.vector[index] ?? 0;
    const rightValue = right.vector[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

export function evaluateBest(cards: readonly Card[]): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error('evaluateBest requires between five and seven cards');
  }
  requireDistinctCards(cards);

  let best: HandRank | undefined;
  const combination: Card[] = [];

  function visit(startIndex: number): void {
    if (combination.length === 5) {
      const candidate = evaluateFive(combination);
      if (best === undefined || compareHandRanks(candidate, best) > 0) {
        best = candidate;
      }
      return;
    }

    const cardsStillNeeded = 5 - combination.length;
    for (let index = startIndex; index <= cards.length - cardsStillNeeded; index += 1) {
      combination.push(cards[index]!);
      visit(index + 1);
      combination.pop();
    }
  }

  visit(0);
  return best!;
}
