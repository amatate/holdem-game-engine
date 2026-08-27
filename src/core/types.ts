export type Suit = 'c' | 'd' | 'h' | 's';

export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type CardCode = `${'2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A'}${Suit}`;

export interface Card {
  readonly code: CardCode;
  readonly rank: Rank;
  readonly suit: Suit;
}

export interface RandomSource {
  readonly algorithm: 'mulberry32-v1';
  readonly seedHash: number;
  nextUint32(): number;
  nextFloat(): number;
  fork(label: string): RandomSource;
}
