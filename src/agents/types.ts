import type { ActionIntent, LegalActionSet } from '../core/legal-actions.js';
import type { PublicActionEvent } from '../core/public-events.js';
import type { PlayerHandStatus, Street } from '../core/state.js';
import type { Card, RandomSource } from '../core/types.js';

export interface PublicSeatState {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly status: PlayerHandStatus;
  readonly committedStreet: number;
  readonly committedHand: number;
  readonly revealedHoleCards: readonly [Card, Card] | null;
}

export interface PublicPotView {
  readonly amount: number;
  readonly eligibleSeatIndexes: readonly number[];
}

export interface PlayerObservationV1 {
  readonly schemaVersion: 1;
  readonly handId: string;
  readonly handNumber: number;
  readonly decisionIndex: number;
  readonly actorSeatIndex: number;
  readonly street: Street;
  readonly holeCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly buttonPosition: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly potTotal: number;
  readonly sidePots: readonly PublicPotView[];
  readonly seats: readonly PublicSeatState[];
  /** Round labels are public information; optional for legacy/custom observations. */
  readonly actionHistory: readonly (PublicActionEvent & { readonly street?: Street })[];
  readonly legalActions: LegalActionSet;
}

export interface DecisionContext {
  readonly observation: Readonly<PlayerObservationV1>;
  readonly random: RandomSource;
}

export interface StyleProfile {
  readonly looseness: number;
  readonly aggression: number;
  readonly bluffing: number;
  readonly stickiness: number;
  readonly positionAwareness: number;
  readonly riskAppetite: number;
  readonly slowPlay: number;
  readonly variability: number;
  readonly sizing: Readonly<{
    readonly preferredPotFraction: 0.5 | 0.75 | 1;
    readonly variance: number;
    readonly overbetFrequency: number;
  }>;
}

export interface ActionDecision {
  readonly action: ActionIntent;
  readonly privateTrace?: Readonly<{
    intent: 'value' | 'bluff' | 'semiBluff' | 'potControl' | 'trap' | 'draw' | 'preserveStack';
    equityBand: 'low' | 'medium' | 'high';
    potOddsBand: 'low' | 'medium' | 'high';
    positionAdjustment: number;
    sizingReason: 'none' | 'minimum' | 'half-pot' | 'three-quarter-pot' | 'pot' | 'all-in';
  }>;
}

export interface PokerAgent {
  readonly agentId: string;
  decide(context: Readonly<DecisionContext>): ActionDecision | Promise<ActionDecision>;
}
