import type { TournamentConfig, TournamentParticipantInput } from './config.js';
import type { HandRank } from './hand-evaluator.js';
import type { Street } from './state.js';
import type { Card } from './types.js';
import type {
  RNG_ALGORITHM_VERSION,
  RULES_VERSION,
  SHUFFLE_ALGORITHM_VERSION,
  STRATEGY_VERSION,
} from './versions.js';

interface EventBase {
  readonly schemaVersion: 1;
  readonly eventIndex: number;
}

interface HandEventBase extends EventBase {
  readonly handId: string;
}

export interface GameStartedEvent extends EventBase {
  readonly type: 'GameStarted';
  readonly config: TournamentConfig;
  readonly seats: readonly TournamentParticipantInput[];
  readonly runSeed: string;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly rngVersion: typeof RNG_ALGORITHM_VERSION;
  readonly shuffleVersion: typeof SHUFFLE_ALGORITHM_VERSION;
  readonly strategyVersion: typeof STRATEGY_VERSION;
}

export interface HandStartedEvent extends HandEventBase {
  readonly type: 'HandStarted';
  readonly handNumber: number;
  readonly logicalBlindLevel: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
}

export interface PositionsAssignedEvent extends HandEventBase {
  readonly type: 'PositionsAssigned';
  readonly buttonPosition: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
}

export interface BlindPostedEvent extends HandEventBase {
  readonly type: 'BlindPosted';
  readonly seat: number;
  readonly kind: 'small' | 'big';
  readonly amount: number;
  readonly allIn: boolean;
}

export interface DeckPreparedEvent extends HandEventBase {
  readonly type: 'DeckPrepared';
  readonly fullOrderedDeck: readonly Card[];
  readonly shuffleVersion: typeof SHUFFLE_ALGORITHM_VERSION;
}

export interface HoleCardDeal {
  readonly seat: number;
  readonly card: Card;
  readonly round: 1 | 2;
}

export interface HoleCardsDealtEvent extends HandEventBase {
  readonly type: 'HoleCardsDealt';
  readonly orderedDeals: readonly HoleCardDeal[];
}

export interface BettingRoundStartedEvent extends HandEventBase {
  readonly type: 'BettingRoundStarted';
  readonly street: Street;
  readonly actor: number | null;
  readonly currentBetTo: number;
  readonly lastFullRaiseSize: number;
}

export interface PlayerActedEvent extends HandEventBase {
  readonly type: 'PlayerActed';
  readonly seat: number;
  readonly normalizedKind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  readonly paid: number;
  readonly committedToAfter: number;
  readonly betToBefore: number;
  readonly betToAfter: number;
  readonly allIn: boolean;
  readonly fullRaise: boolean;
  readonly raiseReopened: boolean;
}

export interface BettingRoundClosedEvent extends HandEventBase {
  readonly type: 'BettingRoundClosed';
  readonly street: Street;
}

export interface CardBurnedEvent extends HandEventBase {
  readonly type: 'CardBurned';
  readonly street: Exclude<Street, 'preflop'>;
  readonly card: Card;
}

export interface CommunityCardsDealtEvent extends HandEventBase {
  readonly type: 'CommunityCardsDealt';
  readonly street: Exclude<Street, 'preflop'>;
  readonly cards: readonly Card[];
}

export interface HoleCardsRevealedEvent extends HandEventBase {
  readonly type: 'HoleCardsRevealed';
  readonly seat: number;
  readonly cards: readonly [Card, Card];
  readonly reason: 'all-in' | 'showdown';
}

export interface UncalledBetReturnedEvent extends HandEventBase {
  readonly type: 'UncalledBetReturned';
  readonly seat: number;
  readonly amount: number;
}

export interface ShowdownStartedEvent extends HandEventBase {
  readonly type: 'ShowdownStarted';
  readonly revealOrder: readonly number[];
}

export interface PotConstructedEvent extends HandEventBase {
  readonly type: 'PotConstructed';
  readonly potId: string;
  readonly amount: number;
  readonly cap: number;
  readonly eligibleSeats: readonly number[];
}

export interface HandEvaluatedEvent extends HandEventBase {
  readonly type: 'HandEvaluated';
  readonly seat: number;
  readonly rank: HandRank;
}

export interface PotAwardedEvent extends HandEventBase {
  readonly type: 'PotAwarded';
  readonly potId: string;
  readonly winners: readonly number[];
  readonly amounts: readonly number[];
  readonly oddChipRecipients: readonly number[];
}

export interface PlayerEliminatedEvent extends HandEventBase {
  readonly type: 'PlayerEliminated';
  readonly seat: number;
}

export interface HandCompletedEvent extends HandEventBase {
  readonly type: 'HandCompleted';
  readonly finalStacks: readonly { readonly seat: number; readonly stack: number }[];
}

export interface GameCompletedEvent extends HandEventBase {
  readonly type: 'GameCompleted';
  readonly winnerSeat: number;
}

export type DomainEvent =
  | GameStartedEvent
  | HandStartedEvent
  | PositionsAssignedEvent
  | BlindPostedEvent
  | DeckPreparedEvent
  | HoleCardsDealtEvent
  | BettingRoundStartedEvent
  | PlayerActedEvent
  | BettingRoundClosedEvent
  | CardBurnedEvent
  | CommunityCardsDealtEvent
  | HoleCardsRevealedEvent
  | UncalledBetReturnedEvent
  | ShowdownStartedEvent
  | PotConstructedEvent
  | HandEvaluatedEvent
  | PotAwardedEvent
  | PlayerEliminatedEvent
  | HandCompletedEvent
  | GameCompletedEvent;
