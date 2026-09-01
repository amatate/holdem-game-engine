import { cloneCanonicalCard } from '../core/cards.js';
import type { HandCategory } from '../core/hand-evaluator.js';
import type { PublicGameEvent } from '../core/public-events.js';
import type { TournamentSeatInput } from '../core/state.js';
import type { Card } from '../core/types.js';

const INVALID_HAND_RESULT_MESSAGE = 'Invalid hand result data';
const MAX_SEATS = 6;

export interface HandSeatResult {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly holeCards: readonly [Card, Card] | null;
  readonly category: HandCategory | null;
  readonly bestFive: readonly Card[] | null;
  readonly potWon: number;
  readonly invested: number;
  readonly returned: number;
  readonly net: number;
  readonly finalStack: number;
}

export interface HandResultPot {
  readonly potId: string;
  readonly label: '底池' | '主池' | `边池 ${number}`;
  readonly amount: number;
  readonly eligibleSeatIndexes: readonly number[];
  readonly winnerSeatIndexes: readonly number[];
  readonly awards: readonly number[];
}

export interface HandResultSummary {
  readonly handNumber: number;
  readonly seats: readonly Readonly<HandSeatResult>[];
  readonly pots: readonly Readonly<HandResultPot>[];
}

interface MutableSeatResult {
  seatIndex: number;
  playerId: string;
  holeCards: [Card, Card] | null;
  category: HandCategory | null;
  bestFive: Card[] | null;
  potWon: number;
  invested: number;
  returned: number;
  finalStack: number;
}

interface MutablePotResult {
  potId: string;
  amount: number;
  eligibleSeatIndexes: number[];
  winnerSeatIndexes: number[];
  awards: number[];
}

function freezeRecursively<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = Reflect.get(descriptors, keys[index]!) as PropertyDescriptor | undefined;
    if (descriptor !== undefined && 'value' in descriptor) freezeRecursively(descriptor.value);
  }
  return Object.freeze(value);
}

function requireSafeNonnegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('unsafe integer');
  return value as number;
}

function requirePositive(value: unknown): number {
  const result = requireSafeNonnegative(value);
  if (result === 0) throw new Error('expected positive integer');
  return result;
}

function requireSeatIndex(value: unknown): number {
  const result = requireSafeNonnegative(value);
  if (result >= MAX_SEATS) throw new Error('invalid seat index');
  return result;
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('invalid string');
  return value;
}

function cloneCardArray(value: unknown, expectedLength: number): Card[] {
  if (!Array.isArray(value) || value.length !== expectedLength) throw new Error('invalid cards');
  const cards: Card[] = [];
  const codes = new Set<string>();
  for (let index = 0; index < expectedLength; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error('sparse cards');
    const card = cloneCanonicalCard(Reflect.get(value, String(index)));
    if (codes.has(card.code)) throw new Error('duplicate card');
    codes.add(card.code);
    cards.push(card);
  }
  return cards;
}

function cloneCardPair(value: unknown): [Card, Card] {
  const cards = cloneCardArray(value, 2);
  return [cards[0]!, cards[1]!];
}

function cloneSeatIndexes(
  value: unknown,
  seatsByIndex: ReadonlyMap<number, MutableSeatResult>,
  minimumLength: number,
): number[] {
  if (!Array.isArray(value)
    || value.length < minimumLength
    || value.length > seatsByIndex.size) {
    throw new Error('invalid seat array');
  }
  const copied: number[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error('sparse seat array');
    const seatIndex = requireSeatIndex(Reflect.get(value, String(index)));
    if (!seatsByIndex.has(seatIndex) || seen.has(seatIndex)) {
      throw new Error('unknown or duplicate seat');
    }
    seen.add(seatIndex);
    copied.push(seatIndex);
  }
  return copied;
}

function clonePositiveAmounts(value: unknown, maximumLength: number): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumLength) {
    throw new Error('invalid amount array');
  }
  const copied: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error('sparse amount array');
    copied.push(requirePositive(Reflect.get(value, String(index))));
  }
  return copied;
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
    throw new Error('invalid hand category');
  }
  return value;
}

function requireStreet(value: unknown): void {
  if (value !== 'preflop' && value !== 'flop' && value !== 'turn' && value !== 'river') {
    throw new Error('invalid street');
  }
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function validateOddChipAward(
  potAmount: number,
  winners: readonly number[],
  amounts: readonly number[],
  oddChipRecipients: readonly number[],
  buttonPosition: number | null,
  maxSeats: number,
): void {
  const share = Math.floor(potAmount / winners.length);
  const remainder = potAmount % winners.length;
  if (remainder > 0 && buttonPosition === null) throw new Error('missing button position');
  const expectedOddRecipients: number[] = [];
  if (buttonPosition !== null) {
    const winnerSet = new Set<number>();
    for (let index = 0; index < winners.length; index += 1) winnerSet.add(winners[index]!);
    for (let offset = 1; offset <= maxSeats && expectedOddRecipients.length < remainder; offset += 1) {
      const seatIndex = (buttonPosition + offset) % maxSeats;
      if (winnerSet.has(seatIndex)) expectedOddRecipients.push(seatIndex);
    }
  }
  if (!sameNumberArray(oddChipRecipients, expectedOddRecipients)) {
    throw new Error('invalid odd-chip recipients');
  }
  const oddRecipientSet = new Set<number>();
  for (let index = 0; index < oddChipRecipients.length; index += 1) {
    oddRecipientSet.add(oddChipRecipients[index]!);
  }
  for (let index = 0; index < winners.length; index += 1) {
    const expectedAmount = oddRecipientSet.has(winners[index]!)
      ? addSafeNonnegative(share, 1)
      : share;
    if (amounts[index] !== expectedAmount) throw new Error('invalid odd-chip amount');
  }
}

function addSafeNonnegative(left: number, right: unknown): number {
  return requireSafeNonnegative(requireSafeNonnegative(left) + requireSafeNonnegative(right));
}

function subtractSafe(left: unknown, right: unknown): number {
  const result = requireSafeNonnegative(left) - requireSafeNonnegative(right);
  if (!Number.isSafeInteger(result)) throw new Error('unsafe subtraction');
  return result;
}

function buildHandResultSummaryUnchecked(
  seats: readonly TournamentSeatInput[],
  viewerEvents: readonly PublicGameEvent[],
  viewerSeatIndexValue: number | undefined,
): Readonly<HandResultSummary> {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > MAX_SEATS) {
    throw new Error('invalid seats');
  }
  const seatResults: MutableSeatResult[] = [];
  const seatsByIndex = new Map<number, MutableSeatResult>();
  for (let index = 0; index < seats.length; index += 1) {
    if (!Object.hasOwn(seats, index)) throw new Error('sparse seats');
    const seat = Reflect.get(seats, String(index)) as TournamentSeatInput;
    if (typeof seat !== 'object' || seat === null) throw new Error('invalid seat');
    const seatIndex = requireSeatIndex(Reflect.get(seat, 'seatIndex'));
    const playerId = requireNonemptyString(Reflect.get(seat, 'playerId'));
    if (seatsByIndex.has(seatIndex)) throw new Error('duplicate seat');
    const result: MutableSeatResult = {
      seatIndex,
      playerId,
      holeCards: null,
      category: null,
      bestFive: null,
      potWon: 0,
      invested: 0,
      returned: 0,
      finalStack: 0,
    };
    seatResults.push(result);
    seatsByIndex.set(seatIndex, result);
  }
  for (let seatIndex = 0; seatIndex < seats.length; seatIndex += 1) {
    if (!seatsByIndex.has(seatIndex)) throw new Error('non-contiguous seats');
  }
  const viewerSeatIndex = viewerSeatIndexValue === undefined
    ? null
    : requireSeatIndex(viewerSeatIndexValue);
  if (viewerSeatIndex !== null && !seatsByIndex.has(viewerSeatIndex)) {
    throw new Error('unknown viewer seat');
  }

  if (!Array.isArray(viewerEvents) || viewerEvents.length < 2) {
    throw new Error('invalid event interval');
  }
  let handNumber = 0;
  let completed = false;
  let ownCardsSeen = false;
  let buttonPosition: number | null = null;
  const revealedSeats = new Set<number>();
  const evaluatedSeats = new Set<number>();
  const finalizedSeats = new Set<number>();
  const awardedPots = new Set<string>();
  const pots: MutablePotResult[] = [];
  const potsById = new Map<string, MutablePotResult>();
  for (let index = 0; index < viewerEvents.length; index += 1) {
    if (!Object.hasOwn(viewerEvents, index)) throw new Error('sparse events');
    const event = Reflect.get(viewerEvents, String(index)) as PublicGameEvent;
    if (typeof event !== 'object' || event === null) throw new Error('invalid event');
    switch (event.type) {
      case 'handStarted': {
        if (index !== 0 || handNumber !== 0) throw new Error('misplaced hand start');
        handNumber = requirePositive(event.handNumber);
        const smallBlind = requirePositive(event.smallBlind);
        const bigBlind = requirePositive(event.bigBlind);
        if (smallBlind >= bigBlind) throw new Error('invalid blinds');
        break;
      }
      case 'blindPosted': {
        const seat = seatsByIndex.get(requireSeatIndex(event.seatIndex));
        if (seat === undefined || (event.kind !== 'small' && event.kind !== 'big')
          || typeof event.allIn !== 'boolean') {
          throw new Error('invalid blind');
        }
        seat.invested = addSafeNonnegative(
          seat.invested,
          event.amount,
        );
        break;
      }
      case 'playerActed': {
        const seat = seatsByIndex.get(requireSeatIndex(event.seatIndex));
        if (seat === undefined
          || (event.kind !== 'fold' && event.kind !== 'check' && event.kind !== 'call'
            && event.kind !== 'bet' && event.kind !== 'raise')
          || typeof event.allIn !== 'boolean') {
          throw new Error('invalid action');
        }
        requireSafeNonnegative(event.betTo);
        seat.invested = addSafeNonnegative(
          seat.invested,
          event.paid,
        );
        break;
      }
      case 'ownHoleCardsDealt':
        if (ownCardsSeen || viewerSeatIndex === null) throw new Error('ambiguous own cards');
        ownCardsSeen = true;
        seatsByIndex.get(viewerSeatIndex)!.holeCards = cloneCardPair(event.cards);
        break;
      case 'holeCardsRevealed': {
        const seatIndex = requireSeatIndex(event.seatIndex);
        const seat = seatsByIndex.get(seatIndex);
        if (seat === undefined || revealedSeats.has(seatIndex)
          || (event.reason !== 'all-in' && event.reason !== 'showdown')) {
          throw new Error('invalid reveal');
        }
        revealedSeats.add(seatIndex);
        seat.holeCards = cloneCardPair(event.cards);
        break;
      }
      case 'uncalledBetReturned': {
        const seat = seatsByIndex.get(requireSeatIndex(event.seatIndex));
        if (seat === undefined) throw new Error('invalid refund seat');
        seat.returned = addSafeNonnegative(
          seat.returned,
          event.amount,
        );
        break;
      }
      case 'potConstructed': {
        const potId = requireNonemptyString(event.potId);
        if (potsById.has(potId)) throw new Error('duplicate pot');
        const pot: MutablePotResult = {
          potId,
          amount: requirePositive(event.amount),
          eligibleSeatIndexes: cloneSeatIndexes(event.eligibleSeats, seatsByIndex, 1),
          winnerSeatIndexes: [],
          awards: [],
        };
        pots.push(pot);
        potsById.set(pot.potId, pot);
        break;
      }
      case 'handEvaluated': {
        const seatIndex = requireSeatIndex(event.seatIndex);
        const seat = seatsByIndex.get(seatIndex);
        if (seat === undefined || evaluatedSeats.has(seatIndex)) {
          throw new Error('invalid evaluation seat');
        }
        evaluatedSeats.add(seatIndex);
        const category = requireHandCategory(event.category);
        const bestFive = cloneCardArray(event.bestFive, 5);
        if (seat.holeCards === null) break;
        seat.category = category;
        seat.bestFive = bestFive;
        break;
      }
      case 'potAwarded': {
        const potId = requireNonemptyString(event.potId);
        const pot = potsById.get(potId);
        if (pot === undefined || awardedPots.has(potId)) throw new Error('invalid pot award order');
        const winners = cloneSeatIndexes(event.winners, seatsByIndex, 1);
        const amounts = clonePositiveAmounts(event.amounts, seatsByIndex.size);
        if (winners.length !== amounts.length) {
          throw new Error('mismatched awards');
        }
        const oddChipRecipients = cloneSeatIndexes(event.oddChipRecipients, seatsByIndex, 0);
        let awardedTotal = 0;
        for (let awardIndex = 0; awardIndex < winners.length; awardIndex += 1) {
          const winnerSeatIndex = winners[awardIndex]!;
          if (!pot.eligibleSeatIndexes.includes(winnerSeatIndex)) throw new Error('ineligible winner');
          awardedTotal = addSafeNonnegative(awardedTotal, amounts[awardIndex]);
          const winner = seatsByIndex.get(winnerSeatIndex)!;
          winner.potWon = addSafeNonnegative(winner.potWon, amounts[awardIndex]);
        }
        if (awardedTotal !== pot.amount) throw new Error('pot award total mismatch');
        validateOddChipAward(
          pot.amount,
          winners,
          amounts,
          oddChipRecipients,
          buttonPosition,
          seatsByIndex.size,
        );
        pot.winnerSeatIndexes = winners;
        pot.awards = amounts;
        awardedPots.add(potId);
        break;
      }
      case 'handCompleted': {
        if (completed || index !== viewerEvents.length - 1
          || !Array.isArray(event.finalStacks)
          || event.finalStacks.length !== seatsByIndex.size) {
          throw new Error('invalid hand completion');
        }
        completed = true;
        for (let stackIndex = 0; stackIndex < event.finalStacks.length; stackIndex += 1) {
          if (!Object.hasOwn(event.finalStacks, stackIndex)) throw new Error('sparse stacks');
          const stack = Reflect.get(event.finalStacks, String(stackIndex)) as {
            readonly seatIndex: number;
            readonly stack: number;
          };
          if (typeof stack !== 'object' || stack === null) throw new Error('invalid stack');
          const seatIndex = requireSeatIndex(Reflect.get(stack, 'seatIndex'));
          const seat = seatsByIndex.get(seatIndex);
          if (seat === undefined || finalizedSeats.has(seatIndex)) throw new Error('invalid final seat');
          finalizedSeats.add(seatIndex);
          seat.finalStack = requireSafeNonnegative(Reflect.get(stack, 'stack'));
        }
        break;
      }
      case 'communityCardsDealt':
        if (event.street !== 'flop' && event.street !== 'turn' && event.street !== 'river') {
          throw new Error('invalid community street');
        }
        cloneCardArray(event.cards, event.street === 'flop' ? 3 : 1);
        break;
      case 'showdownStarted':
        cloneSeatIndexes(event.revealOrder, seatsByIndex, 1);
        break;
      case 'positionsAssigned':
        if (buttonPosition !== null) throw new Error('duplicate positions');
        buttonPosition = requireSeatIndex(event.buttonPosition);
        if (!seatsByIndex.has(buttonPosition)) throw new Error('unknown button seat');
        if (event.smallBlindSeat !== null
          && !seatsByIndex.has(requireSeatIndex(event.smallBlindSeat))) {
          throw new Error('unknown small blind seat');
        }
        if (!seatsByIndex.has(requireSeatIndex(event.bigBlindSeat))) {
          throw new Error('unknown big blind seat');
        }
        break;
      case 'bettingRoundStarted':
        requireStreet(event.street);
        if (event.actor !== null && !seatsByIndex.has(requireSeatIndex(event.actor))) {
          throw new Error('invalid actor');
        }
        requireSafeNonnegative(event.currentBetTo);
        break;
      case 'bettingRoundClosed':
        requireStreet(event.street);
        break;
      case 'playerEliminated':
        if (!seatsByIndex.has(requireSeatIndex(event.seatIndex))) {
          throw new Error('invalid eliminated seat');
        }
        break;
      case 'gameStarted':
      case 'gameCompleted':
        throw new Error('event outside current hand interval');
      default:
        throw new Error('unknown public event');
    }
  }

  if (!completed || handNumber === 0 || finalizedSeats.size !== seatsByIndex.size) {
    throw new Error('incomplete hand');
  }
  for (let index = 0; index < pots.length; index += 1) {
    if (!awardedPots.has(pots[index]!.potId)) throw new Error('unawarded pot');
  }

  const finalSeats: HandSeatResult[] = [];
  let totalInvested = 0;
  let totalReturned = 0;
  for (let index = 0; index < seatResults.length; index += 1) {
    const seat = seatResults[index]!;
    totalInvested = addSafeNonnegative(totalInvested, seat.invested);
    totalReturned = addSafeNonnegative(totalReturned, seat.returned);
    const grossReceived = addSafeNonnegative(seat.potWon, seat.returned);
    const net = subtractSafe(grossReceived, seat.invested);
    finalSeats.push({
      seatIndex: seat.seatIndex,
      playerId: seat.playerId,
      holeCards: seat.holeCards,
      category: seat.category,
      bestFive: seat.bestFive,
      potWon: seat.potWon,
      invested: seat.invested,
      returned: seat.returned,
      net,
      finalStack: seat.finalStack,
    });
  }
  const finalPots: HandResultPot[] = [];
  let totalConstructed = 0;
  let totalAwarded = 0;
  for (let index = 0; index < pots.length; index += 1) {
    const pot = pots[index]!;
    totalConstructed = addSafeNonnegative(totalConstructed, pot.amount);
    for (let awardIndex = 0; awardIndex < pot.awards.length; awardIndex += 1) {
      totalAwarded = addSafeNonnegative(totalAwarded, pot.awards[awardIndex]);
    }
    finalPots.push({
      potId: pot.potId,
      label: pots.length === 1 ? '底池' : index === 0 ? '主池' : `边池 ${index}`,
      amount: pot.amount,
      eligibleSeatIndexes: pot.eligibleSeatIndexes,
      winnerSeatIndexes: pot.winnerSeatIndexes,
      awards: pot.awards,
    });
  }
  const netInvested = subtractSafe(totalInvested, totalReturned);
  if (netInvested < 0
    || netInvested !== totalConstructed
    || totalConstructed !== totalAwarded) {
    throw new Error('settlement conservation mismatch');
  }
  return freezeRecursively({ handNumber, seats: finalSeats, pots: finalPots });
}

export function buildHandResultSummary(
  seats: readonly TournamentSeatInput[],
  viewerEvents: readonly PublicGameEvent[],
): Readonly<HandResultSummary>;
export function buildHandResultSummary(
  seats: readonly TournamentSeatInput[],
  viewerEvents: readonly PublicGameEvent[],
  viewerSeatIndex: number,
): Readonly<HandResultSummary>;
export function buildHandResultSummary(
  seats: readonly TournamentSeatInput[],
  viewerEvents: readonly PublicGameEvent[],
  viewerSeatIndex?: number,
): Readonly<HandResultSummary> {
  try {
    return buildHandResultSummaryUnchecked(seats, viewerEvents, viewerSeatIndex);
  } catch {
    throw new Error(INVALID_HAND_RESULT_MESSAGE);
  }
}
