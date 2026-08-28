import { EVENT_SCHEMA_VERSION } from './versions.js';
import {
  getLegalActions,
  hasFundedResponder,
  hasRaiseRights,
  type ActionIntent,
  type ActionRejectionCode,
  type IntentTransitionResult,
} from './legal-actions.js';
import type { DomainEvent, PlayerActedEvent } from './events.js';
import { reduceDomainEvent, type TournamentState } from './state.js';

function reject(
  state: TournamentState,
  code: ActionRejectionCode,
  message: string,
): IntentTransitionResult {
  return {
    accepted: false,
    state,
    events: [],
    rejection: { code, message },
  };
}

function accept(state: TournamentState, event: PlayerActedEvent): IntentTransitionResult {
  return {
    accepted: true,
    state: reduceDomainEvent(state, event),
    events: [event],
  };
}

export function applyIntent(
  state: TournamentState,
  seatIndex: number,
  intent: ActionIntent,
): IntentTransitionResult {
  const hand = state.activeHand;
  const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
  if (hand === null || hand.currentActorSeat !== seatIndex) {
    return reject(state, 'not-current-actor', 'only the current actor may act');
  }
  if (seat === undefined || seat.status !== 'active' || seat.stack <= 0) {
    return reject(state, 'seat-cannot-act', 'seat is not able to act');
  }

  const legal = getLegalActions(state, seatIndex);
  const eventBase = {
    type: 'PlayerActed' as const,
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventIndex: state.version,
    handId: hand.handId,
    seat: seatIndex,
    betToBefore: hand.currentBetTo,
  };

  if (intent.type === 'fold') {
    if (!legal.fold) {
      return reject(state, 'action-not-legal', 'fold is not a legal action');
    }
    return accept(state, {
      ...eventBase,
      normalizedKind: 'fold',
      paid: 0,
      committedToAfter: seat.committedStreet,
      betToAfter: hand.currentBetTo,
      allIn: false,
      fullRaise: false,
      raiseReopened: false,
    });
  }

  if (intent.type === 'check') {
    if (!legal.check) {
      return reject(state, 'action-not-legal', 'check is not a legal action');
    }
    return accept(state, {
      ...eventBase,
      normalizedKind: 'check',
      paid: 0,
      committedToAfter: seat.committedStreet,
      betToAfter: hand.currentBetTo,
      allIn: false,
      fullRaise: false,
      raiseReopened: false,
    });
  }

  if (intent.type === 'call') {
    if (legal.call === null) {
      return reject(state, 'action-not-legal', 'call is not a legal action');
    }
    return accept(state, {
      ...eventBase,
      normalizedKind: 'call',
      paid: legal.call.pay,
      committedToAfter: legal.call.to,
      betToAfter: hand.currentBetTo,
      allIn: legal.call.isAllIn,
      fullRaise: false,
      raiseReopened: false,
    });
  }

  if (intent.type === 'allIn') {
    if (legal.allIn === null) {
      return reject(state, 'action-not-legal', 'all-in is not a legal action');
    }
    const mode = legal.allIn.mode;
    const isIncrease = mode !== 'call';
    const fullRaise = mode === 'fullBet' || mode === 'fullRaise';
    return accept(state, {
      ...eventBase,
      normalizedKind: mode === 'call'
        ? 'call'
        : hand.currentBetTo === 0 ? 'bet' : 'raise',
      paid: seat.stack,
      committedToAfter: legal.allIn.to,
      betToAfter: isIncrease ? legal.allIn.to : hand.currentBetTo,
      allIn: true,
      fullRaise,
      raiseReopened: fullRaise,
    });
  }

  if (!Number.isSafeInteger(intent.amount) || intent.amount <= 0) {
    return reject(state, 'invalid-amount', 'raiseTo must be a positive safe integer');
  }

  const maxRaiseTo = seat.committedStreet + seat.stack;
  const minRaiseTo = hand.currentBetTo + hand.lastFullRaiseSize;
  if (intent.amount <= hand.currentBetTo
    || intent.amount > maxRaiseTo
    || (intent.amount < minRaiseTo && intent.amount !== maxRaiseTo)) {
    return reject(state, 'raise-out-of-range', 'raiseTo is outside the legal target range');
  }
  if (!hasRaiseRights(state, seatIndex)) {
    return reject(state, 'raise-not-reopened', 'raising has not been reopened for this seat');
  }
  if (!hasFundedResponder(state, seatIndex)) {
    return reject(state, 'action-not-legal', 'no funded opponent can respond to a raise');
  }

  const increment = intent.amount - hand.currentBetTo;
  const fullRaise = increment >= hand.lastFullRaiseSize;
  const allIn = intent.amount === maxRaiseTo;
  return accept(state, {
    ...eventBase,
    normalizedKind: hand.currentBetTo === 0 ? 'bet' : 'raise',
    paid: intent.amount - seat.committedStreet,
    committedToAfter: intent.amount,
    betToAfter: intent.amount,
    allIn,
    fullRaise,
    raiseReopened: fullRaise,
  });
}

export type { ActionIntent, IntentTransitionResult } from './legal-actions.js';
export type { DomainEvent } from './events.js';
export { advanceAutomaticPhases } from './dealing.js';
