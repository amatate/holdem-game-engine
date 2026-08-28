import { getLegalActions, type LegalActionSet } from '../core/legal-actions.js';
import { buildPotLayers } from '../core/pots.js';
import type { PublicActionEvent } from '../core/public-events.js';
import type { Street, TournamentState } from '../core/state.js';
import type { Card } from '../core/types.js';
import type { PlayerObservationV1, PublicSeatState } from './types.js';

function cloneCard(card: Card): Card {
  return { code: card.code, rank: card.rank, suit: card.suit };
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
  const hand = state.activeHand;
  if (hand === null
    || !isBettingStreet(hand.street)
    || hand.phase !== hand.street
    || hand.currentActorSeat !== actorSeatIndex) {
    throw new Error('observation requires the current actor during a betting street');
  }
  const hero = state.seats.find((seat) => seat.seatIndex === actorSeatIndex);
  if (hero === undefined || hero.status !== 'active' || hero.stack <= 0
    || hero.holeCards === null || hero.holeCards.length !== 2) {
    throw new Error('observation requires a funded active actor with exactly two hole cards');
  }

  const authorityLegalActions = getLegalActions(state, actorSeatIndex);
  if (!hasAnyLegalAction(authorityLegalActions)) {
    throw new Error('observation requires a nonempty legal action set');
  }
  const legalActions = cloneLegalActions(authorityLegalActions);

  const currentHandEvents = state.eventLog.filter((event) =>
    'handId' in event && event.handId === hand.handId);
  if (currentHandEvents.some((event) => event.type === 'HoleCardsRevealed')) {
    throw new Error('decision observation cannot include revealed hole cards');
  }
  const handStarted = currentHandEvents.filter((event) => event.type === 'HandStarted');
  if (handStarted.length !== 1 || handStarted[0]?.type !== 'HandStarted') {
    throw new Error('observation requires one authoritative current-hand HandStarted event');
  }

  const actionHistory: PublicActionEvent[] = [];
  let decisionIndex = 0;
  for (const event of currentHandEvents) {
    if (event.type === 'BlindPosted') {
      actionHistory.push({
        type: 'blindPosted',
        seatIndex: event.seat,
        kind: event.kind,
        amount: event.amount,
        allIn: event.allIn,
      });
    } else if (event.type === 'PlayerActed') {
      decisionIndex += 1;
      actionHistory.push({
        type: 'playerActed',
        seatIndex: event.seat,
        kind: event.normalizedKind,
        paid: event.paid,
        betTo: event.betToAfter,
        allIn: event.allIn,
      });
    }
  }

  const seats: PublicSeatState[] = state.seats.map((seat) => {
    return {
      playerId: seat.playerId,
      seatIndex: seat.seatIndex,
      stack: seat.stack,
      status: seat.status,
      committedStreet: seat.committedStreet,
      committedHand: seat.committedHand,
      revealedHoleCards: null,
    };
  });

  const callPay = legalActions.call?.pay ?? 0;
  const contestCap = hero.committedHand + callPay;
  const potTotal = state.seats.reduce(
    (sum, seat) => sum + Math.min(seat.committedHand, contestCap),
    0,
  );
  const formedPots = buildPotLayers(state.seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    committedHand: seat.committedHand,
    folded: seat.status === 'folded' || seat.status === 'eliminated',
  }))).pots;

  return deepFreezeObservation({
    schemaVersion: 1,
    handId: `hand/${state.handNumber}`,
    handNumber: state.handNumber,
    decisionIndex,
    actorSeatIndex,
    street: hand.street,
    holeCards: [cloneCard(hero.holeCards[0]), cloneCard(hero.holeCards[1])],
    board: hand.board.map(cloneCard),
    buttonPosition: hand.positions.buttonPosition,
    smallBlindSeat: hand.positions.smallBlindSeat,
    bigBlindSeat: hand.positions.bigBlindSeat,
    smallBlind: handStarted[0].smallBlind,
    bigBlind: handStarted[0].bigBlind,
    potTotal,
    sidePots: formedPots.slice(1).map((pot) => ({
      amount: pot.amount,
      eligibleSeatIndexes: [...pot.eligibleSeats],
    })),
    seats,
    actionHistory,
    legalActions,
  });
}
