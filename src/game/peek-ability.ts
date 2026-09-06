import { cloneCanonicalCard } from '../core/cards.js';
import type { Card } from '../core/types.js';
import type { TournamentState } from '../core/state.js';
import type { AbilityDecisionPacket, ClassicDecisionPacket } from './turn-packet.js';

export interface PeekKnowledge {
  readonly type: 'peek';
  readonly handNumber: number;
  readonly targetSeatIndex: number;
  readonly card: Readonly<Card>;
}

export interface PeekAbilityPanel {
  readonly charges: Readonly<{ peek: 0 | 1 }>;
  readonly availableCommands: readonly Readonly<{ ability: 'peek'; targetSeatIndex: number }>[];
  readonly knowledge: readonly PeekKnowledge[];
}

export interface PeekState {
  readonly remaining: 0 | 1;
  readonly knowledge: readonly PeekKnowledge[];
}

export function eligiblePeekTargets(state: Readonly<TournamentState>, humanSeatIndex: number): number[] {
  const hand = state.activeHand;
  if (!hand || hand.currentActorSeat !== humanSeatIndex) return [];
  return state.seats.filter((seat) => seat.seatIndex !== humanSeatIndex
    && (seat.status === 'active' || seat.status === 'all-in')
    && seat.holeCards !== null && !hand.revealedHoleCardSeats.includes(seat.seatIndex))
    .map((seat) => seat.seatIndex);
}

// This is a human-private projection; never merge it into observations or public events.
export function createPeekDecisionPacket(
  packet: Readonly<ClassicDecisionPacket>, state: Readonly<TournamentState>,
  humanSeatIndex: number, peek: Readonly<PeekState>, notices: readonly PeekKnowledge[] = [],
): Readonly<AbilityDecisionPacket> {
  const snapshot = (entry: PeekKnowledge): PeekKnowledge => Object.freeze({
    type: 'peek', handNumber: entry.handNumber, targetSeatIndex: entry.targetSeatIndex,
    card: Object.freeze(cloneCanonicalCard(entry.card)),
  });
  const abilities: PeekAbilityPanel = Object.freeze({
    charges: Object.freeze({ peek: peek.remaining }),
    availableCommands: Object.freeze(peek.remaining === 0 ? [] : eligiblePeekTargets(state, humanSeatIndex)
      .map((targetSeatIndex) => Object.freeze({ ability: 'peek' as const, targetSeatIndex }))),
    knowledge: Object.freeze(peek.knowledge.filter((entry) => entry.handNumber === state.handNumber).map(snapshot)),
  });
  return Object.freeze({ ...packet, abilities,
    privateEventsSinceLastPacket: Object.freeze(notices.map(snapshot)) });
}
