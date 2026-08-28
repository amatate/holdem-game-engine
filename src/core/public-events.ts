import type { DomainEvent } from './events.js';
import type { Street } from './state.js';
import type { Card } from './types.js';

export type PublicActionEvent =
  | Readonly<{
    type: 'blindPosted';
    seatIndex: number;
    kind: 'small' | 'big';
    amount: number;
    allIn: boolean;
  }>
  | Readonly<{
    type: 'playerActed';
    seatIndex: number;
    kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
    paid: number;
    betTo: number;
    allIn: boolean;
  }>;

export type PublicGameEvent =
  | Readonly<{ type: 'gameStarted'; maxSeats: number; startingStack: number }>
  | Readonly<{ type: 'handStarted'; handNumber: number; smallBlind: number; bigBlind: number }>
  | Readonly<{
    type: 'positionsAssigned';
    buttonPosition: number;
    smallBlindSeat: number | null;
    bigBlindSeat: number;
  }>
  | PublicActionEvent
  | Readonly<{ type: 'ownHoleCardsDealt'; cards: readonly [Card, Card] }>
  | Readonly<{
    type: 'bettingRoundStarted';
    street: Street;
    actor: number | null;
    currentBetTo: number;
  }>
  | Readonly<{ type: 'bettingRoundClosed'; street: Street }>
  | Readonly<{
    type: 'communityCardsDealt';
    street: Exclude<Street, 'preflop'>;
    cards: readonly Card[];
  }>
  | Readonly<{
    type: 'holeCardsRevealed';
    seatIndex: number;
    cards: readonly [Card, Card];
    reason: 'all-in' | 'showdown';
  }>
  | Readonly<{ type: 'uncalledBetReturned'; seatIndex: number; amount: number }>
  | Readonly<{ type: 'showdownStarted'; revealOrder: readonly number[] }>
  | Readonly<{
    type: 'potConstructed';
    potId: string;
    amount: number;
    eligibleSeats: readonly number[];
  }>
  | Readonly<{
    type: 'potAwarded';
    potId: string;
    winners: readonly number[];
    amounts: readonly number[];
    oddChipRecipients: readonly number[];
  }>
  | Readonly<{ type: 'playerEliminated'; seatIndex: number }>
  | Readonly<{
    type: 'handCompleted';
    finalStacks: readonly Readonly<{ seatIndex: number; stack: number }>[];
  }>
  | Readonly<{ type: 'gameCompleted'; winnerSeat: number }>;

function cloneCard(card: Card): Card {
  return { code: card.code, rank: card.rank, suit: card.suit };
}

function freezeRecursively<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRecursively(child);
  }
  return Object.freeze(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled domain event variant: ${JSON.stringify(value)}`);
}

function projectOneEvent(
  event: DomainEvent,
  viewerSeatIndex: number | null,
): PublicGameEvent | null {
  switch (event.type) {
    case 'GameStarted':
      return {
        type: 'gameStarted',
        maxSeats: event.config.maxSeats,
        startingStack: event.config.startingStack,
      };
    case 'HandStarted':
      return {
        type: 'handStarted',
        handNumber: event.handNumber,
        smallBlind: event.smallBlind,
        bigBlind: event.bigBlind,
      };
    case 'PositionsAssigned':
      return {
        type: 'positionsAssigned',
        buttonPosition: event.buttonPosition,
        smallBlindSeat: event.smallBlindSeat,
        bigBlindSeat: event.bigBlindSeat,
      };
    case 'BlindPosted':
      return {
        type: 'blindPosted',
        seatIndex: event.seat,
        kind: event.kind,
        amount: event.amount,
        allIn: event.allIn,
      };
    case 'DeckPrepared':
      return null;
    case 'HoleCardsDealt': {
      if (viewerSeatIndex === null) return null;
      const ownDeals = event.orderedDeals.filter((deal) => deal.seat === viewerSeatIndex);
      if (ownDeals.length === 0) return null;
      if (ownDeals.length !== 2 || ownDeals[0]?.round !== 1 || ownDeals[1]?.round !== 2) {
        throw new Error('malformed own hole-card deal batch');
      }
      return {
        type: 'ownHoleCardsDealt',
        cards: [cloneCard(ownDeals[0].card), cloneCard(ownDeals[1].card)],
      };
    }
    case 'BettingRoundStarted':
      return {
        type: 'bettingRoundStarted',
        street: event.street,
        actor: event.actor,
        currentBetTo: event.currentBetTo,
      };
    case 'PlayerActed':
      return {
        type: 'playerActed',
        seatIndex: event.seat,
        kind: event.normalizedKind,
        paid: event.paid,
        betTo: event.betToAfter,
        allIn: event.allIn,
      };
    case 'BettingRoundClosed':
      return { type: 'bettingRoundClosed', street: event.street };
    case 'CardBurned':
      return null;
    case 'CommunityCardsDealt':
      return {
        type: 'communityCardsDealt',
        street: event.street,
        cards: event.cards.map(cloneCard),
      };
    case 'HoleCardsRevealed':
      return {
        type: 'holeCardsRevealed',
        seatIndex: event.seat,
        cards: [cloneCard(event.cards[0]), cloneCard(event.cards[1])],
        reason: event.reason,
      };
    case 'UncalledBetReturned':
      return { type: 'uncalledBetReturned', seatIndex: event.seat, amount: event.amount };
    case 'ShowdownStarted':
      return { type: 'showdownStarted', revealOrder: [...event.revealOrder] };
    case 'PotConstructed':
      return {
        type: 'potConstructed',
        potId: event.potId,
        amount: event.amount,
        eligibleSeats: [...event.eligibleSeats],
      };
    case 'HandEvaluated':
      return null;
    case 'PotAwarded':
      return {
        type: 'potAwarded',
        potId: event.potId,
        winners: [...event.winners],
        amounts: [...event.amounts],
        oddChipRecipients: [...event.oddChipRecipients],
      };
    case 'PlayerEliminated':
      return { type: 'playerEliminated', seatIndex: event.seat };
    case 'HandCompleted':
      return {
        type: 'handCompleted',
        finalStacks: event.finalStacks.map((seat) => ({
          seatIndex: seat.seat,
          stack: seat.stack,
        })),
      };
    case 'GameCompleted':
      return { type: 'gameCompleted', winnerSeat: event.winnerSeat };
    default:
      return assertNever(event);
  }
}

export function projectEventsForViewer(
  events: readonly DomainEvent[],
  viewerSeatIndex: number | null,
): readonly PublicGameEvent[] {
  const projected: PublicGameEvent[] = [];
  for (const event of events) {
    const publicEvent = projectOneEvent(event, viewerSeatIndex);
    if (publicEvent !== null) projected.push(publicEvent);
  }
  return freezeRecursively(projected);
}
