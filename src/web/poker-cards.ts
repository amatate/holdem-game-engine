import type { Card } from '../core/types.js';
import type { HandCategory } from '../core/hand-evaluator.js';

const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' } as const;
// Code-drawn pips stay crisp at NPC-card size and never depend on an emoji font.
const PIPS = {
  s: '<path d="M12 1C9 6 2 9 2 14a5 5 0 0 0 9 3c0 3-2 4-4 5h10c-2-1-4-2-4-5a5 5 0 0 0 9-3C22 9 15 6 12 1Z"/>',
  h: '<path d="M12 22C9 18 1 12 1 7a6 6 0 0 1 11-3 6 6 0 0 1 11 3c0 5-8 11-11 15Z"/>',
  d: '<path d="m12 1 10 11-10 11L2 12Z"/>',
  c: '<circle cx="12" cy="6" r="5"/><circle cx="6" cy="14" r="5"/><circle cx="18" cy="14" r="5"/><path d="M11 12h2c0 6 1 8 5 10H6c4-2 5-4 5-10Z"/>',
} as const;

/** A face has exactly one rank and one pip; tiny cards cannot fit mirrored indices. */
export function cardFace(card: Readonly<Card> | null, small = false, fromHole = false): string {
  const size = small ? ' card-small' : '';
  if (!card) return `<span class="card poker-card card-back${size}" role="img" aria-label="未公开的底牌"></span>`;
  // Use the canonical numeric rank rather than putting arbitrary code text in markup.
  const rank = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ?? String(card.rank);
  return `<span class="card poker-card${size}${card.suit === 'h' || card.suit === 'd' ? ' card-red' : ''}${fromHole ? ' card-from-hole' : ''}" role="img" aria-label="${rank}${SUITS[card.suit]}${fromHole ? ' · 底牌' : ''}"><span class="card-rank" aria-hidden="true">${rank}</span><svg class="card-pip" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PIPS[card.suit]}</svg></span>`;
}

/** Display order only. Preserve the engine's exact chosen five and tie semantics. */
export function orderedBestFive(cards: readonly Card[], category: HandCategory): Card[] {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const straight = category === 'straight' || category === 'straight-flush';
  const wheel = straight && [14, 2, 3, 4, 5].every(rank => counts.has(rank));
  const value = (card: Card) => wheel && card.rank === 14 ? 1 : card.rank;
  return [...cards].sort((a, b) => (straight ? 0 : counts.get(b.rank)! - counts.get(a.rank)!)
    || value(b) - value(a));
}
