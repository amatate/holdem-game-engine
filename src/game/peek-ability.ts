import { cloneCanonicalCard } from '../core/cards.js';
import type { Card } from '../core/types.js';
import type { Street, TournamentState } from '../core/state.js';
import type { AbilityDecisionPacket, ClassicDecisionPacket } from './turn-packet.js';
import type { StrengthBand } from './ability-strength.js';

export interface PeekKnowledge {
  readonly type: 'peek';
  readonly handNumber: number;
  readonly targetSeatIndex: number;
  readonly card: Readonly<Card>;
}

export interface ReadKnowledge {
  readonly type: 'read';
  readonly handNumber: number;
  readonly targetSeatIndex: number;
  readonly street: Street;
  readonly band: StrengthBand;
}
export interface SwapKnowledge {
  readonly type: 'swap';
  readonly handNumber: number;
  readonly holeCardIndex: 0 | 1;
  readonly oldCard: Readonly<Card>;
  readonly newCard: Readonly<Card>;
}
export type PrivateAbilityKnowledge = PeekKnowledge | ReadKnowledge | SwapKnowledge;
export type AbilityId = 'peek' | 'read' | 'swap';
export type AbilityCommandView =
  | Readonly<{ ability: 'peek' | 'read'; targetSeatIndex: number }>
  | Readonly<{ ability: 'swap'; holeCardIndex: 0 | 1 }>;
export interface AbilityPanel {
  readonly charges: Readonly<Record<AbilityId, 0 | 1>>;
  readonly usedThisDecision: boolean;
  readonly availableCommands: readonly AbilityCommandView[];
  readonly knowledge: readonly PrivateAbilityKnowledge[];
}
/** Compatibility name from the original peek-only API. */
export type PeekAbilityPanel = AbilityPanel;
export interface AbilityState {
  readonly charges: Readonly<Record<AbilityId, 0 | 1>>;
  readonly usedThisDecision: boolean;
  readonly knowledge: readonly PrivateAbilityKnowledge[];
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
  humanSeatIndex: number, abilityState: Readonly<AbilityState>, notices: readonly PrivateAbilityKnowledge[] = [],
): Readonly<AbilityDecisionPacket> {
  const snapshot = (entry: PrivateAbilityKnowledge): PrivateAbilityKnowledge => {
    if (entry.type === 'peek') return Object.freeze({
      type: 'peek', handNumber: entry.handNumber, targetSeatIndex: entry.targetSeatIndex,
      card: Object.freeze(cloneCanonicalCard(entry.card)),
    });
    if (entry.type === 'read') return Object.freeze({
      type: 'read', handNumber: entry.handNumber, targetSeatIndex: entry.targetSeatIndex,
      street: entry.street, band: entry.band,
    });
    return Object.freeze({
      type: 'swap', handNumber: entry.handNumber, holeCardIndex: entry.holeCardIndex,
      oldCard: Object.freeze(cloneCanonicalCard(entry.oldCard)),
      newCard: Object.freeze(cloneCanonicalCard(entry.newCard)),
    });
  };
  const commands: AbilityCommandView[] = [];
  if (!abilityState.usedThisDecision) {
    for (const ability of ['peek', 'read'] as const) {
      if (abilityState.charges[ability] > 0) {
        commands.push(...eligiblePeekTargets(state, humanSeatIndex)
          .map((targetSeatIndex) => Object.freeze({ ability, targetSeatIndex })));
      }
    }
    const hand = state.activeHand;
    if (abilityState.charges.swap > 0 && hand?.currentActorSeat === humanSeatIndex
      && hand.deck[hand.dealCursor] && !hand.revealedHoleCardSeats.includes(humanSeatIndex)) {
      commands.push(Object.freeze({ ability: 'swap', holeCardIndex: 0 }),
        Object.freeze({ ability: 'swap', holeCardIndex: 1 }));
    }
  }
  const abilities: AbilityPanel = Object.freeze({
    charges: Object.freeze({ ...abilityState.charges }),
    usedThisDecision: abilityState.usedThisDecision,
    availableCommands: Object.freeze(commands),
    knowledge: Object.freeze(abilityState.knowledge.filter((entry) => entry.handNumber === state.handNumber).map(snapshot)),
  });
  return Object.freeze({ ...packet, abilities,
    privateEventsSinceLastPacket: Object.freeze(notices.map(snapshot)) });
}
