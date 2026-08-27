import type { DomainEvent } from './events.js';
import type { TournamentState } from './state.js';

export type ActionIntent =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'call' }
  | { readonly type: 'raiseTo'; readonly amount: number }
  | { readonly type: 'allIn' };

export interface LegalActionSet {
  readonly fold: boolean;
  readonly check: boolean;
  readonly call: null | {
    readonly pay: number;
    readonly to: number;
    readonly isAllIn: boolean;
  };
  readonly raiseTo: null | { readonly min: number; readonly max: number };
  readonly allIn: null | {
    readonly to: number;
    readonly mode: 'call' | 'shortBet' | 'fullBet' | 'shortRaise' | 'fullRaise';
  };
}

export type ActionRejectionCode =
  | 'not-current-actor'
  | 'seat-cannot-act'
  | 'action-not-legal'
  | 'invalid-amount'
  | 'raise-out-of-range'
  | 'raise-not-reopened';

export interface ActionRejection {
  readonly code: ActionRejectionCode;
  readonly message: string;
}

export type IntentTransitionResult =
  | Readonly<{
    accepted: true;
    state: TournamentState;
    events: readonly DomainEvent[];
  }>
  | Readonly<{
    accepted: false;
    state: TournamentState;
    events: readonly [];
    rejection: Readonly<ActionRejection>;
  }>;

const EMPTY_ACTIONS: LegalActionSet = {
  fold: false,
  check: false,
  call: null,
  raiseTo: null,
  allIn: null,
};

export function hasRaiseRights(state: TournamentState, seatIndex: number): boolean {
  const hand = state.activeHand;
  const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
  if (hand === null || seat === undefined) {
    return false;
  }
  return seat.lastActedAtBetTo === null
    || hand.currentBetTo - seat.lastActedAtBetTo >= hand.lastFullRaiseSize;
}

export function hasFundedResponder(state: TournamentState, seatIndex: number): boolean {
  return state.seats.some((seat) => seat.seatIndex !== seatIndex
    && seat.status === 'active'
    && seat.stack > 0);
}

export function getLegalActions(state: TournamentState, seatIndex: number): LegalActionSet {
  const hand = state.activeHand;
  const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
  if (hand === null
    || hand.currentActorSeat !== seatIndex
    || seat === undefined
    || seat.status !== 'active'
    || seat.stack <= 0) {
    return EMPTY_ACTIONS;
  }

  const toCall = Math.max(0, hand.currentBetTo - seat.committedStreet);
  const callPay = Math.min(toCall, seat.stack);
  const maxRaiseTo = seat.committedStreet + seat.stack;
  const minRaiseTo = hand.currentBetTo + hand.lastFullRaiseSize;
  const retainsRaiseRights = hasRaiseRights(state, seatIndex);
  const responderExists = hasFundedResponder(state, seatIndex);
  const canIncrease = responderExists
    && retainsRaiseRights
    && maxRaiseTo > hand.currentBetTo;

  let allIn: LegalActionSet['allIn'] = null;
  if (seat.stack <= toCall) {
    allIn = { to: seat.committedStreet + seat.stack, mode: 'call' };
  } else if (canIncrease) {
    if (hand.currentBetTo === 0) {
      allIn = {
        to: maxRaiseTo,
        mode: maxRaiseTo < minRaiseTo ? 'shortBet' : 'fullBet',
      };
    } else {
      allIn = {
        to: maxRaiseTo,
        mode: maxRaiseTo < minRaiseTo ? 'shortRaise' : 'fullRaise',
      };
    }
  }

  return {
    fold: toCall > 0,
    check: toCall === 0,
    call: toCall === 0
      ? null
      : {
        pay: callPay,
        to: seat.committedStreet + callPay,
        isAllIn: callPay === seat.stack,
      },
    raiseTo: canIncrease && maxRaiseTo >= minRaiseTo
      ? { min: minRaiseTo, max: maxRaiseTo }
      : null,
    allIn,
  };
}
