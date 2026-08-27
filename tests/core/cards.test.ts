import { describe, expect, it } from 'vitest';

import { createStandardDeck, parseCard, shuffleDeck } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';

describe('cards', () => {
  it('creates 52 unique cards', () => {
    const deck = createStandardDeck();

    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => card.code)).size).toBe(52);
  });

  it('shuffles reproducibly without mutating its input', () => {
    const deck = createStandardDeck();
    const originalCodes = deck.map((card) => card.code);
    const first = shuffleDeck(deck, createSeededRandom('same')).map((card) => card.code);
    const second = shuffleDeck(deck, createSeededRandom('same')).map((card) => card.code);

    expect(first).toEqual(second);
    expect(deck.map((card) => card.code)).toEqual(originalCodes);
  });

  it('produces distinct shuffled orders for distinct fixed seeds', () => {
    const deck = createStandardDeck();
    const first = shuffleDeck(deck, createSeededRandom('seed-a')).map((card) => card.code);
    const second = shuffleDeck(deck, createSeededRandom('seed-b')).map((card) => card.code);

    expect(first).not.toEqual(second);
  });

  it('parses valid cards and rejects invalid card text', () => {
    expect(parseCard('As')).toEqual({ code: 'As', rank: 14, suit: 's' });
    expect(() => parseCard('1x')).toThrow(/invalid card/i);
  });
});
