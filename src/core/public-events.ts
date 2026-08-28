import { parseCard } from './cards.js';
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

const INVALID_PUBLIC_CARD_MESSAGE = 'Invalid public card data';

function cloneCard(card: Card): Card {
  let canonical: Card;
  try {
    canonical = parseCard(card.code);
  } catch {
    throw new Error(INVALID_PUBLIC_CARD_MESSAGE);
  }
  if (canonical.rank !== card.rank || canonical.suit !== card.suit) {
    throw new Error(INVALID_PUBLIC_CARD_MESSAGE);
  }
  return canonical;
}

function freezeRecursively<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRecursively(child);
  }
  return Object.freeze(value);
}

function assertNever(value: never): never {
  void value;
  throw new Error('Unhandled domain event variant');
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
        throw new Error(INVALID_PUBLIC_CARD_MESSAGE);
      }
      const first = cloneCard(ownDeals[0].card);
      const second = cloneCard(ownDeals[1].card);
      if (first.code === second.code) throw new Error(INVALID_PUBLIC_CARD_MESSAGE);
      return {
        type: 'ownHoleCardsDealt',
        cards: [first, second],
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
