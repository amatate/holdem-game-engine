import type { Card, CardCode, RandomSource, Rank, Suit } from './types.js';

const RANK_CODES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['c', 'd', 'h', 's'] as const satisfies readonly Suit[];

const RANK_BY_CODE: Readonly<Record<(typeof RANK_CODES)[number], Rank>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function createStandardDeck(): Card[] {
  const deck: Card[] = [];

  for (const rankCode of RANK_CODES) {
    for (const suit of SUITS) {
      deck.push({
        code: `${rankCode}${suit}`,
        rank: RANK_BY_CODE[rankCode],
        suit,
      });
    }
  }

  return deck;
}

export function parseCard(code: string): Card {
  const match = /^([2-9TJQKA])([cdhs])$/.exec(code);

  if (match === null) {
    throw new Error(`Invalid card: ${code}`);
  }

  const rankCode = match[1] as (typeof RANK_CODES)[number];
  const suit = match[2] as Suit;

  return {
    code: code as CardCode,
    rank: RANK_BY_CODE[rankCode],
    suit,
  };
}

export function shuffleDeck(deck: readonly Card[], rng: RandomSource): Card[] {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.nextFloat() * (index + 1));
    const current = shuffled[index]!;
    shuffled[index] = shuffled[swapIndex]!;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}
