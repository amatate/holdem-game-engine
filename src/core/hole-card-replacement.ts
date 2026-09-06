import { cloneCanonicalCard } from './cards.js';
import type { HoleCardReplacedEvent } from './events.js';
import { reduceDomainEvent, type TournamentState, type TransitionResult } from './state.js';

// Authority-only transition. Session owns charges and the one-ability-per-decision lock.
export function replaceHoleCard(state: Readonly<TournamentState>, seatIndex: number, holeCardIndex: 0 | 1): TransitionResult {
  const hand = state.activeHand;
  const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
  if (!hand || !seat?.holeCards || (holeCardIndex !== 0 && holeCardIndex !== 1)) {
    throw new Error('Invalid hole-card replacement');
  }
  const nextCard = hand.deck[hand.dealCursor];
  if (!nextCard) throw new Error('Replacement deck exhausted');
  const event: HoleCardReplacedEvent = {
    type: 'HoleCardReplaced', schemaVersion: 1, eventIndex: state.version,
    handId: hand.handId, seat: seatIndex, holeCardIndex,
    discardedCard: cloneCanonicalCard(seat.holeCards[holeCardIndex]),
    replacementCard: cloneCanonicalCard(nextCard),
  };
  return { state: reduceDomainEvent(state, event), events: [event] };
}
