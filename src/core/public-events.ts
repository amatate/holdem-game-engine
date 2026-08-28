import { cloneCanonicalCard, INVALID_PUBLIC_CARD_MESSAGE } from './cards.js';
import type { DomainEvent } from './events.js';
import type { HandCategory } from './hand-evaluator.js';
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
    type: 'handEvaluated';
    seatIndex: number;
    category: HandCategory;
    bestFive: readonly [Card, Card, Card, Card, Card];
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

const INVALID_PUBLIC_EVENT_MESSAGE = 'Invalid public event data';
const MAX_SEATS = 6;
const MAX_ORDERED_DEALS = 12;

class SafePublicProjectionError extends Error {}

function rejectPublic(message = INVALID_PUBLIC_EVENT_MESSAGE): never {
  throw new SafePublicProjectionError(message);
}

function rejectCard(): never {
  return rejectPublic(INVALID_PUBLIC_CARD_MESSAGE);
}

function requireRecord(value: unknown): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) rejectPublic();
  return value as Record<PropertyKey, unknown>;
}

function requireSafeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    rejectPublic();
  }
  return value as number;
}

function requirePositiveInteger(value: unknown): number {
  return requireSafeInteger(value, 1);
}

function requireSeatIndex(value: unknown): number {
  return requireSafeInteger(value, 0, MAX_SEATS - 1);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') rejectPublic();
  return value;
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) rejectPublic();
  return value;
}

function requireStreet(value: unknown): Street {
  if (value !== 'preflop' && value !== 'flop' && value !== 'turn' && value !== 'river') {
    rejectPublic();
  }
  return value;
}

function requirePostflopStreet(value: unknown): Exclude<Street, 'preflop'> {
  if (value !== 'flop' && value !== 'turn' && value !== 'river') rejectPublic();
  return value;
}

function requireHandCategory(value: unknown): HandCategory {
  if (value !== 'high-card'
    && value !== 'one-pair'
    && value !== 'two-pair'
    && value !== 'three-of-a-kind'
    && value !== 'straight'
    && value !== 'flush'
    && value !== 'full-house'
    && value !== 'four-of-a-kind'
    && value !== 'straight-flush') {
    rejectPublic();
  }
  return value;
}

function cloneDenseArray<T>(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  clone: (entry: unknown) => T,
): T[] {
  if (!Array.isArray(value)) rejectPublic();
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < minimumLength || length > maximumLength) {
    rejectPublic();
  }
  const result: T[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) rejectPublic();
    result.push(clone(Reflect.get(value, String(index))));
  }
  return result;
}

function cloneDistinctCardBatch(value: unknown, expectedCount: number): Card[] {
  if (!Array.isArray(value) || value.length !== expectedCount) rejectCard();
  const cards: Card[] = [];
  const codes = new Set<string>();
  for (let index = 0; index < expectedCount; index += 1) {
    if (!Object.hasOwn(value, index)) rejectCard();
    const rawCard = Reflect.get(value, String(index));
    let card: Card;
    try {
      card = cloneCanonicalCard(rawCard);
    } catch {
      rejectCard();
    }
    if (codes.has(card.code)) rejectCard();
    codes.add(card.code);
    cards.push(card);
  }
  return cards;
}

function cloneSeatIndexArray(value: unknown): number[] {
  const indexes = cloneDenseArray(value, 0, MAX_SEATS, requireSeatIndex);
  const seen = new Set<number>();
  for (let index = 0; index < indexes.length; index += 1) {
    const seatIndex = indexes[index]!;
    if (seen.has(seatIndex)) rejectPublic();
    seen.add(seatIndex);
  }
  return indexes;
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
  return rejectPublic('Unhandled domain event variant');
}

function projectOneEvent(
  event: DomainEvent,
  viewerSeatIndex: number | null,
): PublicGameEvent | null {
  switch (event.type) {
    case 'GameStarted': {
      const config = requireRecord(event.config);
      return {
        type: 'gameStarted',
        maxSeats: requireSafeInteger(config.maxSeats, 2, MAX_SEATS),
        startingStack: requirePositiveInteger(config.startingStack),
      };
    }
    case 'HandStarted': {
      const smallBlind = requirePositiveInteger(event.smallBlind);
      const bigBlind = requirePositiveInteger(event.bigBlind);
      if (smallBlind >= bigBlind) rejectPublic();
      return {
        type: 'handStarted',
        handNumber: requirePositiveInteger(event.handNumber),
        smallBlind,
        bigBlind,
      };
    }
    case 'PositionsAssigned':
      return {
        type: 'positionsAssigned',
        buttonPosition: requireSeatIndex(event.buttonPosition),
        smallBlindSeat: event.smallBlindSeat === null
          ? null
          : requireSeatIndex(event.smallBlindSeat),
        bigBlindSeat: requireSeatIndex(event.bigBlindSeat),
      };
    case 'BlindPosted': {
      const kind = event.kind;
      if (kind !== 'small' && kind !== 'big') rejectPublic();
      return {
        type: 'blindPosted',
        seatIndex: requireSeatIndex(event.seat),
        kind,
        amount: requirePositiveInteger(event.amount),
        allIn: requireBoolean(event.allIn),
      };
    }
    case 'DeckPrepared':
      return null;
    case 'HoleCardsDealt': {
      if (viewerSeatIndex === null) return null;
      const orderedDeals = event.orderedDeals;
      const dealCount = Array.isArray(orderedDeals) ? orderedDeals.length : -1;
      if (!Array.isArray(orderedDeals)
        || !Number.isSafeInteger(dealCount)
        || dealCount < 0
        || dealCount > MAX_ORDERED_DEALS) {
        rejectCard();
      }
      let roundOne: unknown;
      let roundTwo: unknown;
      let hasRoundOne = false;
      let hasRoundTwo = false;
      for (let index = 0; index < dealCount; index += 1) {
        if (!Object.hasOwn(orderedDeals, index)) rejectCard();
        const deal = requireRecord(Reflect.get(orderedDeals, String(index)));
        const seat = deal.seat;
        const round = deal.round;
        if (!Number.isSafeInteger(seat) || (seat as number) < 0 || (seat as number) >= MAX_SEATS
          || (round !== 1 && round !== 2)) {
          rejectCard();
        }
        if (seat !== viewerSeatIndex) continue;
        if (round === 1) {
          if (hasRoundOne) rejectCard();
          roundOne = deal.card;
          hasRoundOne = true;
        } else {
          if (hasRoundTwo) rejectCard();
          roundTwo = deal.card;
          hasRoundTwo = true;
        }
      }
      if (!hasRoundOne && !hasRoundTwo) return null;
      if (!hasRoundOne || !hasRoundTwo) rejectCard();
      const cards = cloneDistinctCardBatch(
        [roundOne, roundTwo],
        2,
      ) as [Card, Card];
      return {
        type: 'ownHoleCardsDealt',
        cards,
      };
    }
    case 'BettingRoundStarted':
      return {
        type: 'bettingRoundStarted',
        street: requireStreet(event.street),
        actor: event.actor === null ? null : requireSeatIndex(event.actor),
        currentBetTo: requireSafeInteger(event.currentBetTo),
      };
    case 'PlayerActed': {
      const kind = event.normalizedKind;
      if (kind !== 'fold' && kind !== 'check' && kind !== 'call'
        && kind !== 'bet' && kind !== 'raise') {
        rejectPublic();
      }
      return {
        type: 'playerActed',
        seatIndex: requireSeatIndex(event.seat),
        kind,
        paid: requireSafeInteger(event.paid),
        betTo: requireSafeInteger(event.committedToAfter),
        allIn: requireBoolean(event.allIn),
      };
    }
    case 'BettingRoundClosed':
      return { type: 'bettingRoundClosed', street: requireStreet(event.street) };
    case 'CardBurned':
      return null;
    case 'CommunityCardsDealt': {
      const street = requirePostflopStreet(event.street);
      const expectedCount = street === 'flop'
        ? 3
        : 1;
      return {
        type: 'communityCardsDealt',
        street,
        cards: cloneDistinctCardBatch(event.cards, expectedCount),
      };
    }
    case 'HoleCardsRevealed': {
      const reason = event.reason;
      if (reason !== 'all-in' && reason !== 'showdown') rejectPublic();
      const cards = cloneDistinctCardBatch(event.cards, 2) as [Card, Card];
      return {
        type: 'holeCardsRevealed',
        seatIndex: requireSeatIndex(event.seat),
        cards,
        reason,
      };
    }
    case 'UncalledBetReturned':
      return {
        type: 'uncalledBetReturned',
        seatIndex: requireSeatIndex(event.seat),
        amount: requirePositiveInteger(event.amount),
      };
    case 'ShowdownStarted':
      return { type: 'showdownStarted', revealOrder: cloneSeatIndexArray(event.revealOrder) };
    case 'PotConstructed':
      return {
        type: 'potConstructed',
        potId: requireNonemptyString(event.potId),
        amount: requirePositiveInteger(event.amount),
        eligibleSeats: cloneSeatIndexArray(event.eligibleSeats),
      };
    case 'HandEvaluated': {
      const rank = requireRecord(event.rank);
      const category = requireHandCategory(rank.category);
      const bestFive = cloneDistinctCardBatch(rank.bestFive, 5) as [
        Card,
        Card,
        Card,
        Card,
        Card,
      ];
      return {
        type: 'handEvaluated',
        seatIndex: requireSeatIndex(event.seat),
        category,
        bestFive,
      };
    }
    case 'PotAwarded': {
      const winners = cloneSeatIndexArray(event.winners);
      const amounts = cloneDenseArray(event.amounts, 0, MAX_SEATS, requirePositiveInteger);
      if (winners.length !== amounts.length || winners.length === 0) rejectPublic();
      return {
        type: 'potAwarded',
        potId: requireNonemptyString(event.potId),
        winners,
        amounts,
        oddChipRecipients: cloneSeatIndexArray(event.oddChipRecipients),
      };
    }
    case 'PlayerEliminated':
      return { type: 'playerEliminated', seatIndex: requireSeatIndex(event.seat) };
    case 'HandCompleted': {
      const finalStacks = cloneDenseArray(event.finalStacks, 2, MAX_SEATS, (value) => {
        const stack = requireRecord(value);
        return {
          seatIndex: requireSeatIndex(stack.seat),
          stack: requireSafeInteger(stack.stack),
        };
      });
      return {
        type: 'handCompleted',
        finalStacks,
      };
    }
    case 'GameCompleted':
      return { type: 'gameCompleted', winnerSeat: requireSeatIndex(event.winnerSeat) };
    default:
      return assertNever(event);
  }
}

export function projectEventsForViewer(
  events: readonly DomainEvent[],
  viewerSeatIndex: number | null,
): readonly PublicGameEvent[] {
  try {
    if (viewerSeatIndex !== null) requireSeatIndex(viewerSeatIndex);
    if (!Array.isArray(events)) rejectPublic();
    const eventCount = events.length;
    if (!Number.isSafeInteger(eventCount) || eventCount < 0) rejectPublic();
    const projected: PublicGameEvent[] = [];
    for (let index = 0; index < eventCount; index += 1) {
      if (!Object.hasOwn(events, index)) rejectPublic();
      const event = Reflect.get(events, String(index)) as DomainEvent;
      const publicEvent = projectOneEvent(event, viewerSeatIndex);
      if (publicEvent !== null) projected.push(publicEvent);
    }
    return freezeRecursively(projected);
  } catch (error) {
    if (error instanceof SafePublicProjectionError) throw new Error(error.message);
    throw new Error(INVALID_PUBLIC_EVENT_MESSAGE);
  }
}
