import { createStandardDeck } from './cards.js';
import { getLegalActions } from './legal-actions.js';
import { buildPotLayers } from './pots.js';
import type { Card } from './types.js';
import { reduceDomainEvent, type TournamentState } from './state.js';

export class TournamentInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TournamentInvariantError';
  }
}

function fail(message: string): never {
  throw new TournamentInvariantError(message);
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
}

function sameCard(left: Card, right: Card): boolean {
  return left.code === right.code && left.rank === right.rank && left.suit === right.suit;
}

function sameCards(left: readonly Card[], right: readonly Card[]): boolean {
  return left.length === right.length
    && left.every((card, index) => sameCard(card, right[index]!));
}

function assertCardAuthority(state: TournamentState): void {
  const hand = state.activeHand;
  if (hand === null) return;
  if (![0, 3, 4, 5].includes(hand.board.length)) {
    fail('board must grow only as 0/3/4/5 cards');
  }

  const handEvents = state.eventLog.filter(
    (event) => 'handId' in event && event.handId === hand.handId,
  );
  const deckPreparedEvents = handEvents.filter((event) => event.type === 'DeckPrepared');
  if (deckPreparedEvents.length > 1) {
    fail('each hand requires a single DeckPrepared event');
  }
  const deckPrepared = deckPreparedEvents[0];
  if (deckPrepared === undefined) {
    if (hand.deck.length !== 0 || hand.dealCursor !== 0
      || hand.board.length !== 0 || hand.burnedCards.length !== 0
      || state.seats.some((seat) => seat.holeCards !== null)) {
      fail('card destinations must remain empty before DeckPrepared');
    }
    return;
  }

  const canonical = new Map(createStandardDeck().map((card) => [card.code, card] as const));
  if (!sameCards(hand.deck, deckPrepared.fullOrderedDeck)) {
    fail('authoritative deck identity must equal DeckPrepared exactly');
  }
  if (hand.deck.length !== 52 || new Set(hand.deck.map((card) => card.code)).size !== 52
    || hand.deck.some((card) => {
      const expected = canonical.get(card.code);
      return expected === undefined || !sameCard(card, expected);
    })) {
    fail('authoritative deck must contain exactly 52 unique canonical cards');
  }

  const consumed: Card[] = [];
  const dealtBySeat = new Map<number, Card[]>();
  const burns: Card[] = [];
  const board: Card[] = [];
  for (const event of handEvents) {
    if (event.type === 'HoleCardsDealt') {
      for (const deal of event.orderedDeals) {
        consumed.push(deal.card);
        const cards = dealtBySeat.get(deal.seat) ?? [];
        cards.push(deal.card);
        dealtBySeat.set(deal.seat, cards);
      }
    } else if (event.type === 'CardBurned') {
      consumed.push(event.card);
      burns.push(event.card);
    } else if (event.type === 'CommunityCardsDealt') {
      consumed.push(...event.cards);
      board.push(...event.cards);
    }
  }

  if (hand.dealCursor !== consumed.length
    || !sameCards(hand.deck.slice(0, consumed.length), consumed)
    || new Set(consumed.map((card) => card.code)).size !== consumed.length) {
    fail('deal cursor and consumed destinations must map one-to-one onto the deck prefix');
  }
  for (const seat of state.seats) {
    const dealt = dealtBySeat.get(seat.seatIndex) ?? [];
    if (dealt.length === 0) {
      if (seat.holeCards !== null) fail('undealt seat cannot hold cards');
    } else if (dealt.length !== 2
      || seat.holeCards === null
      || !sameCards(seat.holeCards, dealt)) {
      fail('hole-card destination must match the ordered deal payload');
    }
  }
  if (!sameCards(hand.burnedCards, burns) || !sameCards(hand.board, board)) {
    fail('burn and board destinations must match consumed event order');
  }
}

function assertActorAuthority(state: TournamentState): void {
  const hand = state.activeHand;
  if (hand === null) return;
  const bettingPhase = hand.phase === 'preflop'
    || hand.phase === 'flop'
    || hand.phase === 'turn'
    || hand.phase === 'river';
  if (bettingPhase) {
    let derived: TournamentState | null = null;
    try {
      for (const event of state.eventLog) derived = reduceDomainEvent(derived, event);
    } catch (error) {
      fail(`actor authority cannot be derived from event history: ${String(error)}`);
    }
    if (derived?.activeHand?.currentActorSeat !== hand.currentActorSeat
      || derived?.activeHand?.pendingActors.length !== hand.pendingActors.length
      || derived.activeHand.pendingActors.some((seat, index) => seat !== hand.pendingActors[index])) {
      fail('actor and pending decisions must match independently reduced event authority');
    }
  }
  if (hand.currentActorSeat === null) {
    if (bettingPhase && hand.pendingActors.length > 0) {
      fail('a funded pending decision requires a current actor');
    }
    return;
  }
  if (!bettingPhase) fail('only a betting phase may wait for player input');
  if (hand.pendingActors[0] !== hand.currentActorSeat) {
    fail('current actor must be the first pending actor');
  }
  const actor = state.seats.find((seat) => seat.seatIndex === hand.currentActorSeat);
  if (actor === undefined || actor.status !== 'active' || actor.stack <= 0) {
    fail('current actor must be active and funded');
  }
  const legal = getLegalActions(state, actor.seatIndex);
  if (!legal.fold && !legal.check && legal.call === null
    && legal.raiseTo === null && legal.allIn === null) {
    fail('current actor must have at least one legal action');
  }
}

function assertSettlementAuthority(state: TournamentState): void {
  const hand = state.activeHand;
  if (hand === null) return;
  const pendingPots = hand.pendingPots ?? [];
  for (const pot of pendingPots) {
    assertNonNegativeSafeInteger(pot.amount, 'pending pot amount');
    assertNonNegativeSafeInteger(pot.cap, 'pending pot cap');
    if (pot.amount === 0 || pot.eligibleSeats.length === 0
      || new Set(pot.eligibleSeats).size !== pot.eligibleSeats.length) {
      fail('pending pots require positive amount and unique eligible seats');
    }
    if (pot.eligibleSeats.some((seatIndex) => {
      const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
      return seat === undefined || seat.status === 'folded' || seat.status === 'eliminated';
    })) {
      fail('folded or eliminated players cannot remain pot eligible');
    }
  }

  const committed = state.seats.reduce((sum, seat) => sum + seat.committedHand, 0);
  const residual = buildPotLayers(state.seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    committedHand: seat.committedHand,
    folded: seat.status === 'folded' || seat.status === 'eliminated',
  })));
  const residualAmount = residual.pots.reduce((sum, pot) => sum + pot.amount, 0)
    + residual.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  if (residualAmount !== committed) {
    fail('residual pots and refunds must equal residual hand commitments');
  }

  for (const event of state.eventLog) {
    if (event.type !== 'PotAwarded' || event.handId !== hand.handId) continue;
    if (event.winners.some((winner) => {
      const seat = state.seats.find((candidate) => candidate.seatIndex === winner);
      return seat === undefined || seat.status === 'folded' || seat.status === 'eliminated';
    })) {
      fail('folded or eliminated players cannot be recorded winners');
    }
  }

  if (hand.phase === 'hand-complete' || hand.phase === 'game-complete') {
    if (committed !== 0
      || state.seats.some((seat) => seat.committedStreet !== 0)
      || pendingPots.length !== 0
      || residual.pots.length !== 0
      || residual.refunds.length !== 0) {
      fail('completed hands must clear commitments, pots, refunds, and payouts');
    }
  }
}

export function assertTournamentInvariants(state: TournamentState): void {
  assertNonNegativeSafeInteger(state.initialChipTotal, 'initial chip total');
  assertNonNegativeSafeInteger(state.handNumber, 'hand number');
  assertNonNegativeSafeInteger(state.logicalBlindLevel, 'logical blind level');
  assertNonNegativeSafeInteger(state.version, 'state version');
  if (state.version !== state.eventLog.length
    || state.eventLog.some((event, index) => event.eventIndex !== index
      || event.schemaVersion !== 1)) {
    fail('event log and state version must be contiguous');
  }

  for (const seat of state.seats) {
    assertNonNegativeSafeInteger(seat.stack, `seat ${seat.seatIndex} stack`);
    assertNonNegativeSafeInteger(seat.committedStreet, `seat ${seat.seatIndex} street commitment`);
    assertNonNegativeSafeInteger(seat.committedHand, `seat ${seat.seatIndex} hand commitment`);
    if (seat.committedStreet > seat.committedHand) {
      fail('street commitment cannot exceed hand commitment');
    }
  }
  const pending = state.activeHand?.pendingPots ?? [];
  if (state.activeHand !== null) {
    assertNonNegativeSafeInteger(state.activeHand.currentBetTo, 'current bet target');
    assertNonNegativeSafeInteger(state.activeHand.lastFullRaiseSize, 'last full raise size');
    assertNonNegativeSafeInteger(state.activeHand.dealCursor, 'deal cursor');
    assertNonNegativeSafeInteger(
      state.activeHand.constructedPotCount ?? 0,
      'constructed pot count',
    );
    assertNonNegativeSafeInteger(
      state.activeHand.lastConstructedCap ?? 0,
      'last constructed cap',
    );
    if (state.activeHand.lastFullRaiseSize === 0) {
      fail('last full raise size must be positive');
    }
    const { buttonPosition, smallBlindSeat, bigBlindSeat } = state.activeHand.positions;
    const validPhysicalSeat = (seat: number): boolean => Number.isSafeInteger(seat)
      && seat >= 0
      && seat < state.config.maxSeats;
    if (!validPhysicalSeat(buttonPosition)
      || !validPhysicalSeat(bigBlindSeat)
      || (smallBlindSeat !== null && !validPhysicalSeat(smallBlindSeat))) {
      fail('button and blinds must identify physical table seats');
    }
  }
  const authorityTotal = state.seats.reduce(
    (sum, seat) => sum + seat.stack + seat.committedHand,
    0,
  ) + pending.reduce((sum, pot) => sum + pot.amount, 0);
  if (!Number.isSafeInteger(authorityTotal) || authorityTotal !== state.initialChipTotal) {
    fail('stacks, commitments, pending refunds, and pending payouts must conserve chips');
  }

  assertCardAuthority(state);
  assertActorAuthority(state);
  assertSettlementAuthority(state);
}
