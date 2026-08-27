import type { DomainEvent } from './events.js';
import {
  reduceDomainEvent,
  type HandState,
  type SeatState,
  type Street,
  type TournamentState,
  type TransitionResult,
} from './state.js';
import { EVENT_SCHEMA_VERSION } from './versions.js';

type PostflopStreet = Exclude<Street, 'preflop'>;

const NEXT_STREET: Readonly<Partial<Record<Street, PostflopStreet>>> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
};

function isLive(seat: SeatState): boolean {
  return seat.status !== 'folded' && seat.status !== 'eliminated';
}

function isActionable(seat: SeatState): boolean {
  return seat.status === 'active' && seat.stack > 0;
}

function firstActionableAfterButton(state: TournamentState): number | null {
  const hand = state.activeHand!;
  for (let offset = 1; offset <= state.config.maxSeats; offset += 1) {
    const seatIndex = (hand.positions.buttonPosition + offset) % state.config.maxSeats;
    const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
    if (seat !== undefined && isActionable(seat)) {
      return seatIndex;
    }
  }
  return null;
}

export function isBettingRoundClosed(
  hand: Readonly<HandState>,
  seats: readonly Readonly<SeatState>[],
): boolean {
  const fundedLiveSeats = seats.filter(isActionable);
  return hand.currentActorSeat === null
    && hand.pendingActors.length === 0
    && fundedLiveSeats.every((seat) => seat.committedStreet === hand.currentBetTo);
}

export function advanceAutomaticPhases(state: TournamentState): TransitionResult {
  const initialHand = state.activeHand;
  if (initialHand === null
    || initialHand.street === null
    || !(['preflop', 'flop', 'turn', 'river'] as const).includes(initialHand.phase as Street)) {
    return { state, events: [] };
  }

  let current = state;
  const events: DomainEvent[] = [];
  const emit = (event: DomainEvent): void => {
    current = reduceDomainEvent(current, event);
    events.push(event);
  };
  const eventBase = () => ({
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventIndex: current.version,
    handId: current.activeHand!.handId,
  } as const);

  const closeCurrentStreet = (): void => {
    const street = current.activeHand!.street!;
    emit({ ...eventBase(), type: 'BettingRoundClosed', street });
  };

  const dealNextStreet = (street: PostflopStreet, actor: number | null): void => {
    const hand = current.activeHand!;
    const burn = hand.deck[hand.dealCursor];
    if (burn === undefined) {
      throw new Error('deck exhausted before burn');
    }
    emit({ ...eventBase(), type: 'CardBurned', street, card: burn });

    const cardCount = street === 'flop' ? 3 : 1;
    const cards = current.activeHand!.deck.slice(
      current.activeHand!.dealCursor,
      current.activeHand!.dealCursor + cardCount,
    );
    if (cards.length !== cardCount) {
      throw new Error('deck exhausted before community deal');
    }
    emit({ ...eventBase(), type: 'CommunityCardsDealt', street, cards });

    const bigBlind = current.config.blindLevels[current.logicalBlindLevel]!.bigBlind;
    emit({
      ...eventBase(),
      type: 'BettingRoundStarted',
      street,
      actor,
      currentBetTo: 0,
      lastFullRaiseSize: bigBlind,
    });
  };

  const revealLiveHands = (): void => {
    for (const seat of current.seats.filter(isLive)) {
      if (seat.holeCards === null
        || current.activeHand!.revealedHoleCardSeats.includes(seat.seatIndex)) {
        continue;
      }
      emit({
        ...eventBase(),
        type: 'HoleCardsRevealed',
        seat: seat.seatIndex,
        cards: [seat.holeCards[0], seat.holeCards[1]],
        reason: 'all-in',
      });
    }
  };

  const runOutToShowdown = (): void => {
    while (current.activeHand?.phase !== 'showdown') {
      const hand = current.activeHand;
      if (hand === null || hand.street === null) {
        throw new Error('automatic runout requires an active betting street');
      }
      const nextStreet = NEXT_STREET[hand.street];
      closeCurrentStreet();
      if (nextStreet === undefined) {
        continue;
      }
      dealNextStreet(nextStreet, null);
    }
  };

  const liveSeats = current.seats.filter(isLive);
  if (liveSeats.length === 1) {
    closeCurrentStreet();
    return { state: current, events };
  }

  const actionableSeats = liveSeats.filter(isActionable);
  const allInOpponentExists = liveSeats.some((seat) => seat.status === 'all-in');
  if (actionableSeats.length === 0) {
    if (allInOpponentExists) {
      revealLiveHands();
    }
    runOutToShowdown();
    return { state: current, events };
  }

  if (actionableSeats.length === 1) {
    const onlyActionable = actionableSeats[0]!;
    const toCall = Math.max(0, current.activeHand!.currentBetTo - onlyActionable.committedStreet);
    if (toCall === 0 && allInOpponentExists) {
      revealLiveHands();
      runOutToShowdown();
      return { state: current, events };
    }
  }

  if (!isBettingRoundClosed(current.activeHand!, current.seats)) {
    return { state, events: [] };
  }

  const street = current.activeHand!.street!;
  const nextStreet = NEXT_STREET[street];
  closeCurrentStreet();
  if (nextStreet !== undefined) {
    dealNextStreet(nextStreet, firstActionableAfterButton(current));
  }
  return { state: current, events };
}
