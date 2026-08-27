import type { DomainEvent } from './events.js';
import { compareHandRanks, type HandRank } from './hand-evaluator.js';
import { buildPotLayers, type PotLayer } from './pots.js';
import {
  reduceDomainEvent,
  type SeatState,
  type TournamentState,
  type TransitionResult,
} from './state.js';
import { EVENT_SCHEMA_VERSION } from './versions.js';

export function orderOddChipWinners(
  winners: readonly number[],
  buttonPosition: number,
  maxSeats: number,
): number[] {
  const winnerSet = new Set(winners);
  const ordered: number[] = [];
  for (let offset = 1; offset <= maxSeats; offset += 1) {
    const seat = (buttonPosition + offset) % maxSeats;
    if (winnerSet.has(seat)) ordered.push(seat);
  }
  return ordered;
}

function contribution(seat: SeatState) {
  return {
    seatIndex: seat.seatIndex,
    committedHand: seat.committedHand,
    folded: seat.status === 'folded' || seat.status === 'eliminated',
  };
}

function makeEmitter(state: TournamentState) {
  let current = state;
  const events: DomainEvent[] = [];
  const eventBase = () => ({
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventIndex: current.version,
    handId: current.activeHand!.handId,
  } as const);
  const emit = (event: DomainEvent): void => {
    current = reduceDomainEvent(current, event);
    events.push(event);
  };
  return {
    eventBase,
    emit,
    result: (): TransitionResult => ({ state: current, events }),
    state: (): TournamentState => current,
  };
}

function emitEliminationsAndCompletion(emitter: ReturnType<typeof makeEmitter>): void {
  for (const seat of emitter.state().seats) {
    if (seat.stack === 0 && seat.status !== 'eliminated') {
      emitter.emit({ ...emitter.eventBase(), type: 'PlayerEliminated', seat: seat.seatIndex });
    }
  }
  emitter.emit({
    ...emitter.eventBase(),
    type: 'HandCompleted',
    finalStacks: emitter.state().seats.map((seat) => ({ seat: seat.seatIndex, stack: seat.stack })),
  });
}

function emitRefunds(
  emitter: ReturnType<typeof makeEmitter>,
  refunds: ReturnType<typeof buildPotLayers>['refunds'],
): void {
  for (const refund of refunds) {
    emitter.emit({
      ...emitter.eventBase(),
      type: 'UncalledBetReturned',
      seat: refund.seatIndex,
      amount: refund.amount,
    });
  }
}

function emitPotConstructed(
  emitter: ReturnType<typeof makeEmitter>,
  pots: readonly PotLayer[],
): void {
  pots.forEach((pot, potIndex) => emitter.emit({
    ...emitter.eventBase(),
    type: 'PotConstructed',
    potId: `pot-${potIndex}`,
    amount: pot.amount,
    cap: pot.cap,
    eligibleSeats: [...pot.eligibleSeats],
  }));
}

function awardForWinners(
  amount: number,
  winners: readonly number[],
  buttonPosition: number,
  maxSeats: number,
): { readonly amounts: number[]; readonly oddChipRecipients: number[] } {
  const share = Math.floor(amount / winners.length);
  const remainder = amount % winners.length;
  const extras = new Set(orderOddChipWinners(winners, buttonPosition, maxSeats).slice(0, remainder));
  return {
    amounts: winners.map((seat) => share + (extras.has(seat) ? 1 : 0)),
    oddChipRecipients: orderOddChipWinners(winners, buttonPosition, maxSeats).slice(0, remainder),
  };
}

export function settleFoldWin(state: TournamentState): TransitionResult {
  const hand = state.activeHand;
  if (hand === null || hand.phase !== 'settlement') {
    throw new Error('fold settlement requires settlement phase');
  }
  const liveSeats = state.seats.filter((seat) => seat.status !== 'folded'
    && seat.status !== 'eliminated');
  if (liveSeats.length !== 1) {
    throw new Error('fold settlement requires exactly one live seat');
  }

  const layers = buildPotLayers(state.seats.map(contribution));
  const winner = liveSeats[0]!.seatIndex;
  const emitter = makeEmitter(state);
  emitRefunds(emitter, layers.refunds);
  emitPotConstructed(emitter, layers.pots);
  layers.pots.forEach((pot, potIndex) => emitter.emit({
    ...emitter.eventBase(),
    type: 'PotAwarded',
    potId: `pot-${potIndex}`,
    winners: [winner],
    amounts: [pot.amount],
    oddChipRecipients: [],
  }));
  emitEliminationsAndCompletion(emitter);
  return emitter.result();
}

function clockwiseEligibleOrder(
  eligible: ReadonlySet<number>,
  startSeat: number,
  maxSeats: number,
): number[] {
  const order: number[] = [];
  for (let offset = 0; offset < maxSeats; offset += 1) {
    const seat = (startSeat + offset) % maxSeats;
    if (eligible.has(seat)) order.push(seat);
  }
  return order;
}

function compareVectors(left: HandRank, right: HandRank): number {
  return compareHandRanks(left, right);
}

export function settleShowdown(state: TournamentState): TransitionResult {
  const hand = state.activeHand;
  if (hand === null || hand.phase !== 'showdown' || hand.board.length !== 5) {
    throw new Error('showdown settlement requires a complete showdown board');
  }
  const layers = buildPotLayers(state.seats.map(contribution));
  const eligible = new Set(layers.pots.flatMap((pot) => pot.eligibleSeats));
  const liveEligible = state.seats.filter((seat) => eligible.has(seat.seatIndex));
  if (liveEligible.some((seat) => seat.holeCards === null)) {
    throw new Error('every showdown-eligible seat requires hole cards');
  }

  const defaultStart = (hand.positions.buttonPosition + 1) % state.config.maxSeats;
  const startSeat = hand.lastAggressorSeat !== null && eligible.has(hand.lastAggressorSeat)
    ? hand.lastAggressorSeat
    : defaultStart;
  const revealOrder = clockwiseEligibleOrder(eligible, startSeat, state.config.maxSeats);
  const emitter = makeEmitter(state);
  emitter.emit({ ...emitter.eventBase(), type: 'ShowdownStarted', revealOrder });
  for (const seatIndex of revealOrder) {
    if (emitter.state().activeHand!.revealedHoleCardSeats.includes(seatIndex)) continue;
    const seat = emitter.state().seats.find((candidate) => candidate.seatIndex === seatIndex)!;
    emitter.emit({
      ...emitter.eventBase(),
      type: 'HoleCardsRevealed',
      seat: seatIndex,
      cards: [seat.holeCards![0], seat.holeCards![1]],
      reason: 'showdown',
    });
  }

  emitRefunds(emitter, layers.refunds);
  emitPotConstructed(emitter, layers.pots);

  const ranks = new Map<number, HandRank>();
  for (const seatIndex of revealOrder) {
    const rank = emitter.state().activeHand!.showdownRanks!
      .find((evaluation) => evaluation.seat === seatIndex)!.rank;
    ranks.set(seatIndex, rank);
    emitter.emit({ ...emitter.eventBase(), type: 'HandEvaluated', seat: seatIndex, rank });
  }

  layers.pots.forEach((pot, potIndex) => {
    let winners: number[] = [];
    for (const seatIndex of pot.eligibleSeats) {
      if (winners.length === 0) {
        winners = [seatIndex];
        continue;
      }
      const comparison = compareVectors(ranks.get(seatIndex)!, ranks.get(winners[0]!)!);
      if (comparison > 0) winners = [seatIndex];
      else if (comparison === 0) winners.push(seatIndex);
    }
    if (winners.length === 0) throw new Error('a constructed pot requires an eligible winner');
    const award = awardForWinners(
      pot.amount,
      winners,
      hand.positions.buttonPosition,
      state.config.maxSeats,
    );
    emitter.emit({
      ...emitter.eventBase(),
      type: 'PotAwarded',
      potId: `pot-${potIndex}`,
      winners,
      amounts: award.amounts,
      oddChipRecipients: award.oddChipRecipients,
    });
  });

  emitEliminationsAndCompletion(emitter);
  return emitter.result();
}
