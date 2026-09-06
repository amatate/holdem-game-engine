import { getLegalActions, type LegalActionSet } from '../core/legal-actions.js';
import { cloneCanonicalCard, INVALID_PUBLIC_CARD_MESSAGE } from '../core/cards.js';
import { buildPotLayers } from '../core/pots.js';
import type { PublicActionEvent } from '../core/public-events.js';
import type { SeatState, Street, TournamentState } from '../core/state.js';
import type { Card } from '../core/types.js';
import type { PlayerObservationV1, PublicSeatState } from './types.js';

const INVALID_OBSERVATION_MESSAGE = 'Invalid player observation data';
const MAX_SEATS = 6;

class SafeObservationProjectionError extends Error {}

function rejectObservation(message = INVALID_OBSERVATION_MESSAGE): never {
  throw new SafeObservationProjectionError(message);
}

function requireRecord(value: unknown): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) rejectObservation();
  return value as Record<PropertyKey, unknown>;
}

function requireSafeInteger(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    rejectObservation();
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
  if (typeof value !== 'boolean') rejectObservation();
  return value;
}

function requireNonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) rejectObservation();
  return value;
}

function cloneDistinctCards(value: unknown, expectedCount: number): Card[] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    rejectObservation(INVALID_PUBLIC_CARD_MESSAGE);
  }
  const cards: Card[] = [];
  const codes = new Set<string>();
  for (let index = 0; index < expectedCount; index += 1) {
    if (!Object.hasOwn(value, index)) rejectObservation(INVALID_PUBLIC_CARD_MESSAGE);
    const rawCard = Reflect.get(value, String(index));
    let card: Card;
    try {
      card = cloneCanonicalCard(rawCard);
    } catch {
      rejectObservation(INVALID_PUBLIC_CARD_MESSAGE);
    }
    if (codes.has(card.code)) rejectObservation(INVALID_PUBLIC_CARD_MESSAGE);
    codes.add(card.code);
    cards.push(card);
  }
  return cards;
}

function cloneLegalActions(actions: LegalActionSet): LegalActionSet {
  return {
    fold: actions.fold,
    check: actions.check,
    call: actions.call === null
      ? null
      : { pay: actions.call.pay, to: actions.call.to, isAllIn: actions.call.isAllIn },
    raiseTo: actions.raiseTo === null
      ? null
      : { min: actions.raiseTo.min, max: actions.raiseTo.max },
    allIn: actions.allIn === null
      ? null
      : { to: actions.allIn.to, mode: actions.allIn.mode },
  };
}

function hasAnyLegalAction(actions: LegalActionSet): boolean {
  return actions.fold || actions.check || actions.call !== null
    || actions.raiseTo !== null || actions.allIn !== null;
}

function isBettingStreet(value: unknown): value is Street {
  return value === 'preflop' || value === 'flop' || value === 'turn' || value === 'river';
}

function isPlayerStatus(value: unknown): value is SeatState['status'] {
  return value === 'active' || value === 'folded' || value === 'all-in' || value === 'eliminated';
}

interface EventSnapshot {
  readonly type: string;
  readonly handId: string | null;
  readonly smallBlind?: number;
  readonly bigBlind?: number;
  readonly seatIndex?: number;
  readonly blindKind?: 'small' | 'big';
  readonly actionKind?: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  readonly amount?: number;
  readonly betTo?: number;
  readonly allIn?: boolean;
}

function snapshotEventLog(value: unknown, expectedLength: number): EventSnapshot[] {
  if (!Array.isArray(value) || value.length !== expectedLength) rejectObservation();
  const snapshots: EventSnapshot[] = [];
  for (let index = 0; index < expectedLength; index += 1) {
    if (!Object.hasOwn(value, index)) rejectObservation();
    const event = requireRecord(Reflect.get(value, String(index)));
    const type = event.type;
    if (event.schemaVersion !== 1 || event.eventIndex !== index || typeof type !== 'string') {
      rejectObservation();
    }
    const handId = type === 'GameStarted' ? null : requireNonemptyString(event.handId);
    switch (type) {
      case 'GameStarted':
      case 'PositionsAssigned':
      case 'DeckPrepared':
      case 'HoleCardsDealt':
      case 'HoleCardReplaced':
      case 'BettingRoundStarted':
      case 'BettingRoundClosed':
      case 'CardBurned':
      case 'CommunityCardsDealt':
      case 'HoleCardsRevealed':
      case 'UncalledBetReturned':
      case 'ShowdownStarted':
      case 'PotConstructed':
      case 'HandEvaluated':
      case 'PotAwarded':
      case 'PlayerEliminated':
      case 'HandCompleted':
      case 'GameCompleted':
        snapshots.push({ type, handId });
        break;
      case 'HandStarted': {
        const smallBlind = requirePositiveInteger(event.smallBlind);
        const bigBlind = requirePositiveInteger(event.bigBlind);
        if (smallBlind >= bigBlind) rejectObservation();
        snapshots.push({ type, handId, smallBlind, bigBlind });
        break;
      }
      case 'BlindPosted': {
        const kind = event.kind;
        if (kind !== 'small' && kind !== 'big') rejectObservation();
        snapshots.push({
          type,
          handId,
          seatIndex: requireSeatIndex(event.seat),
          blindKind: kind,
          amount: requirePositiveInteger(event.amount),
          allIn: requireBoolean(event.allIn),
        });
        break;
      }
      case 'PlayerActed': {
        const kind = event.normalizedKind;
        if (kind !== 'fold' && kind !== 'check' && kind !== 'call'
          && kind !== 'bet' && kind !== 'raise') {
          rejectObservation();
        }
        snapshots.push({
          type,
          handId,
          seatIndex: requireSeatIndex(event.seat),
          actionKind: kind,
          amount: requireSafeInteger(event.paid),
          betTo: requireSafeInteger(event.committedToAfter),
          allIn: requireBoolean(event.allIn),
        });
        break;
      }
      default:
        rejectObservation();
    }
  }
  return snapshots;
}

interface SeatSnapshots {
  readonly legalSeats: SeatState[];
  readonly publicSeats: PublicSeatState[];
  readonly contributions: {
    readonly seatIndex: number;
    readonly committedHand: number;
    readonly folded: boolean;
  }[];
  readonly hero: SeatState;
  readonly heroHoleCards: [Card, Card];
}

function snapshotSeats(value: unknown, actorSeatIndex: number): SeatSnapshots {
  if (!Array.isArray(value)) rejectObservation();
  const seatCount = value.length;
  if (!Number.isSafeInteger(seatCount) || seatCount < 2 || seatCount > MAX_SEATS) {
    rejectObservation();
  }
  const legalSeats: SeatState[] = [];
  const publicSeats: PublicSeatState[] = [];
  const contributions: SeatSnapshots['contributions'] = [];
  const playerIds = new Set<string>();
  let hero: SeatState | null = null;
  let heroHoleCards: [Card, Card] | null = null;

  for (let index = 0; index < seatCount; index += 1) {
    if (!Object.hasOwn(value, index)) rejectObservation();
    const authoritySeat = requireRecord(Reflect.get(value, String(index)));
    const playerId = requireNonemptyString(authoritySeat.playerId);
    const seatIndex = requireSeatIndex(authoritySeat.seatIndex);
    const stack = requireSafeInteger(authoritySeat.stack);
    const committedStreet = requireSafeInteger(authoritySeat.committedStreet);
    const committedHand = requireSafeInteger(authoritySeat.committedHand);
    const authorityLastActedAtBetTo = authoritySeat.lastActedAtBetTo;
    const lastActedAtBetTo = authorityLastActedAtBetTo === null
      ? null
      : requireSafeInteger(authorityLastActedAtBetTo);
    const status = authoritySeat.status;
    if (seatIndex !== index || !isPlayerStatus(status) || playerIds.has(playerId)
      || !Number.isSafeInteger(stack + committedHand)
      || !Number.isSafeInteger(stack + committedStreet)) {
      rejectObservation();
    }
    playerIds.add(playerId);

    let holeCards: [Card, Card] | null = null;
    if (seatIndex === actorSeatIndex) {
      const authorityHoleCards = authoritySeat.holeCards;
      if (authorityHoleCards !== null) {
        holeCards = cloneDistinctCards(authorityHoleCards, 2) as [Card, Card];
        heroHoleCards = holeCards;
      }
    }
    const localSeat: SeatState = {
      playerId,
      seatIndex,
      stack,
      status,
      holeCards,
      committedStreet,
      committedHand,
      lastActedAtBetTo,
    };
    legalSeats.push(localSeat);
    publicSeats.push({
      playerId,
      seatIndex,
      stack,
      status,
      committedStreet,
      committedHand,
      revealedHoleCards: null,
    });
    contributions.push({
      seatIndex,
      committedHand,
      folded: status === 'folded' || status === 'eliminated',
    });
    if (seatIndex === actorSeatIndex) hero = localSeat;
  }

  if (hero === null || hero.status !== 'active' || hero.stack <= 0 || heroHoleCards === null) {
    rejectObservation('observation requires a funded active actor with exactly two hole cards');
  }
  return { legalSeats, publicSeats, contributions, hero, heroHoleCards };
}

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeRecursively(child, seen);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

export function deepFreezeObservation(
  observation: PlayerObservationV1,
): Readonly<PlayerObservationV1> {
  return freezeRecursively(observation);
}

export function projectObservation(
  state: TournamentState,
  actorSeatIndex: number,
): Readonly<PlayerObservationV1> {
  try {
    requireSeatIndex(actorSeatIndex);
    const handValue = state.activeHand;
    if (handValue === null) {
      rejectObservation('observation requires the current actor during a betting street');
    }
    const hand = requireRecord(handValue);
    const street = hand.street;
    if (!isBettingStreet(street) || hand.phase !== street) {
      rejectObservation('observation requires the current actor during a betting street');
    }
    const currentActorSeat = requireSeatIndex(hand.currentActorSeat);
    if (currentActorSeat !== actorSeatIndex) {
      rejectObservation('observation requires the current actor during a betting street');
    }
    const handId = requireNonemptyString(hand.handId);
    const currentBetTo = requireSafeInteger(hand.currentBetTo);
    const lastFullRaiseSize = requirePositiveInteger(hand.lastFullRaiseSize);
    const positions = requireRecord(hand.positions);
    const buttonPosition = requireSeatIndex(positions.buttonPosition);
    const smallBlindSeat = positions.smallBlindSeat === null
      ? null
      : requireSeatIndex(positions.smallBlindSeat);
    const bigBlindSeat = requireSeatIndex(positions.bigBlindSeat);

    const revealMarkers = hand.revealedHoleCardSeats;
    if (!Array.isArray(revealMarkers)) rejectObservation();
    const revealCount = revealMarkers.length;
    if (!Number.isSafeInteger(revealCount) || revealCount < 0 || revealCount > MAX_SEATS) {
      rejectObservation();
    }
    if (revealCount > 0) {
      rejectObservation('decision observation cannot include revealed hole cards');
    }

    const handNumber = requirePositiveInteger(state.handNumber);
    const version = requireSafeInteger(state.version);
    const seatSnapshots = snapshotSeats(state.seats, actorSeatIndex);
    if (buttonPosition >= seatSnapshots.legalSeats.length
      || bigBlindSeat >= seatSnapshots.legalSeats.length
      || (smallBlindSeat !== null && smallBlindSeat >= seatSnapshots.legalSeats.length)) {
      rejectObservation();
    }

    const expectedBoardCount = street === 'preflop'
      ? 0
      : street === 'flop'
        ? 3
        : street === 'turn'
          ? 4
          : 5;
    const board = cloneDistinctCards(hand.board, expectedBoardCount);
    const knownCodes = new Set<string>();
    for (let index = 0; index < seatSnapshots.heroHoleCards.length; index += 1) {
      knownCodes.add(seatSnapshots.heroHoleCards[index]!.code);
    }
    for (let index = 0; index < board.length; index += 1) {
      const code = board[index]!.code;
      if (knownCodes.has(code)) rejectObservation(INVALID_PUBLIC_CARD_MESSAGE);
      knownCodes.add(code);
    }

    const legalState = {
      activeHand: { currentActorSeat, currentBetTo, lastFullRaiseSize },
      seats: seatSnapshots.legalSeats,
    } as unknown as TournamentState;
    const authorityLegalActions = getLegalActions(legalState, actorSeatIndex);
    if (!hasAnyLegalAction(authorityLegalActions)) {
      rejectObservation('observation requires a nonempty legal action set');
    }
    const legalActions = cloneLegalActions(authorityLegalActions);

    const eventSnapshots = snapshotEventLog(state.eventLog, version);
    const actionHistory: PublicActionEvent[] = [];
    let decisionIndex = 0;
    let handStartedCount = 0;
    let smallBlind = 0;
    let bigBlind = 0;
    for (let index = 0; index < eventSnapshots.length; index += 1) {
      const event = eventSnapshots[index]!;
      if (event.handId !== handId) continue;
      if (event.type === 'HoleCardsRevealed') {
        rejectObservation('decision observation cannot include revealed hole cards');
      }
      if (event.type === 'HandStarted') {
        handStartedCount += 1;
        smallBlind = event.smallBlind!;
        bigBlind = event.bigBlind!;
      } else if (event.type === 'BlindPosted') {
        actionHistory.push({
          type: 'blindPosted',
          seatIndex: event.seatIndex!,
          kind: event.blindKind!,
          amount: event.amount!,
          allIn: event.allIn!,
        });
      } else if (event.type === 'PlayerActed') {
        decisionIndex += 1;
        actionHistory.push({
          type: 'playerActed',
          seatIndex: event.seatIndex!,
          kind: event.actionKind!,
          paid: event.amount!,
          betTo: event.betTo!,
          allIn: event.allIn!,
        });
      }
    }
    if (handStartedCount !== 1) {
      rejectObservation('observation requires one authoritative current-hand HandStarted event');
    }

    const callPay = legalActions.call?.pay ?? 0;
    const contestCap = seatSnapshots.hero.committedHand + callPay;
    if (!Number.isSafeInteger(contestCap)) rejectObservation();
    let potTotal = 0;
    for (let index = 0; index < seatSnapshots.contributions.length; index += 1) {
      potTotal += Math.min(seatSnapshots.contributions[index]!.committedHand, contestCap);
      if (!Number.isSafeInteger(potTotal)) rejectObservation();
    }
    const formedPots = buildPotLayers(seatSnapshots.contributions).pots;
    const sidePots: { amount: number; eligibleSeatIndexes: number[] }[] = [];
    for (let index = 1; index < formedPots.length; index += 1) {
      const pot = formedPots[index]!;
      if (!Number.isSafeInteger(pot.amount) || pot.amount <= 0) rejectObservation();
      const eligibleSeatIndexes: number[] = [];
      for (let seatIndex = 0; seatIndex < pot.eligibleSeats.length; seatIndex += 1) {
        eligibleSeatIndexes.push(requireSeatIndex(pot.eligibleSeats[seatIndex]));
      }
      sidePots.push({ amount: pot.amount, eligibleSeatIndexes });
    }

    return deepFreezeObservation({
      schemaVersion: 1,
      handId: `hand/${handNumber}`,
      handNumber,
      decisionIndex,
      actorSeatIndex,
      street,
      holeCards: seatSnapshots.heroHoleCards,
      board,
      buttonPosition,
      smallBlindSeat,
      bigBlindSeat,
      smallBlind,
      bigBlind,
      potTotal,
      sidePots,
      seats: seatSnapshots.publicSeats,
      actionHistory,
      legalActions,
    });
  } catch (error) {
    if (error instanceof SafeObservationProjectionError) throw new Error(error.message);
    throw new Error(INVALID_OBSERVATION_MESSAGE);
  }
}
