import { createStandardDeck, shuffleDeck } from './cards.js';
import {
  cloneTournamentConfig,
  validateAndCloneDeck,
  validateTournamentInputs,
  type TournamentConfig,
  type TournamentParticipantInput,
} from './config.js';
import type { DomainEvent } from './events.js';
import { compareHandRanks, evaluateBest, type HandRank } from './hand-evaluator.js';
import { advancePositions, assignInitialPositions } from './positions.js';
import { buildPotLayers } from './pots.js';
import { createSeededRandom } from './random.js';
import type { Card } from './types.js';
import {
  EVENT_SCHEMA_VERSION,
  RNG_ALGORITHM_VERSION,
  RULES_VERSION,
  SHUFFLE_ALGORITHM_VERSION,
  STRATEGY_VERSION,
} from './versions.js';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export type Phase =
  | 'waiting'
  | 'post-blinds'
  | 'deal-hole'
  | 'preflop'
  | 'deal-flop'
  | 'flop'
  | 'deal-turn'
  | 'turn'
  | 'deal-river'
  | 'river'
  | 'showdown'
  | 'settlement'
  | 'hand-complete'
  | 'game-complete';

export type PlayerHandStatus = 'active' | 'folded' | 'all-in' | 'eliminated';

export interface SeatState {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly status: PlayerHandStatus;
  readonly holeCards: readonly [Card, Card] | null;
  readonly committedStreet: number;
  readonly committedHand: number;
  readonly lastActedAtBetTo: number | null;
}

export interface PositionState {
  readonly buttonPosition: number;
  readonly smallBlindSeat: number | null;
  readonly bigBlindSeat: number;
}

export interface PendingPotState {
  readonly potId: string;
  readonly amount: number;
  readonly cap: number;
  readonly eligibleSeats: readonly number[];
}

export interface EvaluatedHandState {
  readonly seat: number;
  readonly rank: HandRank;
}

export interface HandState {
  readonly handId: string;
  readonly phase: Phase;
  readonly street: Street | null;
  readonly board: readonly Card[];
  readonly burnedCards: readonly Card[];
  readonly deck: readonly Card[];
  readonly dealCursor: number;
  readonly revealedHoleCardSeats: readonly number[];
  readonly positions: PositionState;
  readonly currentActorSeat: number | null;
  readonly currentBetTo: number;
  readonly lastFullRaiseSize: number;
  readonly lastAggressorSeat: number | null;
  readonly pendingActors: readonly number[];
  readonly pendingPots?: readonly PendingPotState[];
  readonly constructedPotCount?: number;
  readonly lastConstructedCap?: number;
  readonly showdownRevealOrder?: readonly number[];
  readonly showdownRanks?: readonly EvaluatedHandState[];
  readonly evaluatedHands?: readonly EvaluatedHandState[];
}

export interface TournamentState {
  readonly config: TournamentConfig;
  readonly seats: readonly SeatState[];
  readonly handNumber: number;
  readonly logicalBlindLevel: number;
  readonly activeHand: HandState | null;
  readonly eventLog: readonly DomainEvent[];
  readonly version: number;
  readonly runSeed: string;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly rngVersion: typeof RNG_ALGORITHM_VERSION;
  readonly shuffleVersion: typeof SHUFFLE_ALGORITHM_VERSION;
  readonly strategyVersion: typeof STRATEGY_VERSION;
  readonly initialChipTotal: number;
}

export interface TournamentSeatInput extends TournamentParticipantInput {}

export interface StartHandOptions {
  /** First element is the next physical card dealt or burned. */
  readonly fixedDeck?: readonly Card[];
}

export interface TransitionResult {
  readonly state: TournamentState;
  readonly events: readonly DomainEvent[];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled domain event: ${JSON.stringify(value)}`);
}

function replaceSeat(
  seats: readonly SeatState[],
  seatIndex: number,
  update: (seat: SeatState) => SeatState,
): readonly SeatState[] {
  return seats.map((seat) => seat.seatIndex === seatIndex ? update(seat) : seat);
}

function clockwiseSeatsFrom(
  startSeat: number,
  includedSeats: ReadonlySet<number>,
  maxSeats: number,
): number[] {
  const ordered: number[] = [];
  for (let offset = 0; offset < maxSeats; offset += 1) {
    const seat = (startSeat + offset) % maxSeats;
    if (includedSeats.has(seat)) {
      ordered.push(seat);
    }
  }
  return ordered;
}

function firstIncludedAfter(
  position: number,
  includedSeats: ReadonlySet<number>,
  maxSeats: number,
): number | null {
  for (let offset = 1; offset <= maxSeats; offset += 1) {
    const seat = (position + offset) % maxSeats;
    if (includedSeats.has(seat)) {
      return seat;
    }
  }
  return null;
}

function appendEvent(state: TournamentState, event: DomainEvent): TournamentState {
  return {
    ...state,
    eventLog: [...state.eventLog, event],
    version: state.version + 1,
  };
}

function sameCard(left: Card, right: Card): boolean {
  return left.code === right.code && left.rank === right.rank && left.suit === right.suit;
}

function contributionLayers(state: TournamentState) {
  return buildPotLayers(state.seats.map((seat) => ({
    seatIndex: seat.seatIndex,
    committedHand: seat.committedHand,
    folded: seat.status === 'folded' || seat.status === 'eliminated',
  })));
}

function expectedShowdownRevealOrder(state: TournamentState): number[] {
  const hand = state.activeHand!;
  const eligible = new Set(contributionLayers(state).pots.flatMap((pot) => pot.eligibleSeats));
  const startSeat = hand.street === 'river'
    && hand.lastAggressorSeat !== null
    && eligible.has(hand.lastAggressorSeat)
    ? hand.lastAggressorSeat
    : (hand.positions.buttonPosition + 1) % state.config.maxSeats;
  const order: number[] = [];
  for (let offset = 0; offset < state.config.maxSeats; offset += 1) {
    const seat = (startSeat + offset) % state.config.maxSeats;
    if (eligible.has(seat)) order.push(seat);
  }
  return order;
}

function oddChipOrder(
  winners: readonly number[],
  buttonPosition: number,
  maxSeats: number,
): number[] {
  const winnerSet = new Set(winners);
  const order: number[] = [];
  for (let offset = 1; offset <= maxSeats; offset += 1) {
    const seat = (buttonPosition + offset) % maxSeats;
    if (winnerSet.has(seat)) order.push(seat);
  }
  return order;
}

const BOARD_COUNT_BEFORE_STREET: Readonly<Record<Exclude<Street, 'preflop'>, number>> = {
  flop: 0,
  turn: 3,
  river: 4,
};

const BURN_COUNT_BEFORE_STREET: Readonly<Record<Exclude<Street, 'preflop'>, number>> = {
  flop: 0,
  turn: 1,
  river: 2,
};

export function reduceDomainEvent(
  state: TournamentState | null,
  event: DomainEvent,
): TournamentState {
  if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
    throw new Error('unsupported event schema version');
  }
  if (event.type === 'GameStarted') {
    if (state !== null) {
      throw new Error('GameStarted cannot reduce an initialized state');
    }
    if (event.eventIndex !== 0) {
      throw new Error('GameStarted must have event index zero');
    }
    return {
      config: event.config,
      seats: event.seats
        .map((seat) => ({
          playerId: seat.playerId,
          seatIndex: seat.seatIndex,
          stack: event.config.startingStack,
          status: 'active' as const,
          holeCards: null,
          committedStreet: 0,
          committedHand: 0,
          lastActedAtBetTo: null,
        }))
        .sort((left, right) => left.seatIndex - right.seatIndex),
      handNumber: 0,
      logicalBlindLevel: 0,
      activeHand: null,
      eventLog: [event],
      version: 1,
      runSeed: event.runSeed,
      rulesVersion: event.rulesVersion,
      rngVersion: event.rngVersion,
      shuffleVersion: event.shuffleVersion,
      strategyVersion: event.strategyVersion,
      initialChipTotal: event.config.startingStack * event.config.maxSeats,
    };
  }

  if (state === null) {
    throw new Error('only GameStarted can reduce from null');
  }
  if (event.eventIndex !== state.version) {
    throw new Error('domain event index must be contiguous');
  }

  let next: TournamentState;
  switch (event.type) {
    case 'HandStarted': {
      if (state.seats.some((seat) => seat.stack === 0 && seat.status !== 'eliminated')) {
        throw new Error('HandStarted requires settlement-owned elimination to be finalized');
      }
      const resetSeats = state.seats.map((seat): SeatState => ({
        ...seat,
        status: seat.stack === 0 ? seat.status : 'active',
        holeCards: null,
        committedStreet: 0,
        committedHand: 0,
        lastActedAtBetTo: null,
      }));
      next = {
        ...state,
        seats: resetSeats,
        handNumber: event.handNumber,
        logicalBlindLevel: event.logicalBlindLevel,
        activeHand: {
          handId: event.handId,
          phase: 'post-blinds',
          street: null,
          board: [],
          burnedCards: [],
          deck: [],
          dealCursor: 0,
          revealedHoleCardSeats: [],
          positions: { buttonPosition: 0, smallBlindSeat: null, bigBlindSeat: 0 },
          currentActorSeat: null,
          currentBetTo: 0,
          lastFullRaiseSize: event.bigBlind,
          lastAggressorSeat: null,
          pendingActors: [],
          pendingPots: [],
          constructedPotCount: 0,
          lastConstructedCap: 0,
        },
      };
      break;
    }
    case 'PositionsAssigned': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('PositionsAssigned requires the matching active hand');
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          positions: {
            buttonPosition: event.buttonPosition,
            smallBlindSeat: event.smallBlindSeat,
            bigBlindSeat: event.bigBlindSeat,
          },
        },
      };
      break;
    }
    case 'BlindPosted': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('BlindPosted requires the matching active hand');
      }
      next = {
        ...state,
        seats: replaceSeat(state.seats, event.seat, (seat) => {
          if (event.amount < 0 || event.amount > seat.stack) {
            throw new Error('blind post cannot make a stack negative');
          }
          const stack = seat.stack - event.amount;
          return {
            ...seat,
            stack,
            status: event.allIn ? 'all-in' : seat.status,
            committedStreet: seat.committedStreet + event.amount,
            committedHand: seat.committedHand + event.amount,
          };
        }),
        activeHand: {
          ...state.activeHand,
          currentBetTo: Math.max(state.activeHand.currentBetTo, event.amount),
          lastAggressorSeat: event.kind === 'big'
            ? event.seat
            : state.activeHand.lastAggressorSeat,
        },
      };
      break;
    }
    case 'DeckPrepared': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('DeckPrepared requires the matching active hand');
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          phase: 'deal-hole',
          deck: event.fullOrderedDeck.map((card) => ({ ...card })),
          dealCursor: 0,
        },
      };
      break;
    }
    case 'HoleCardsDealt': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('HoleCardsDealt requires the matching active hand');
      }
      const cardsBySeat = new Map<number, Card[]>();
      for (const deal of event.orderedDeals) {
        const cards = cardsBySeat.get(deal.seat) ?? [];
        cards.push({ ...deal.card });
        cardsBySeat.set(deal.seat, cards);
      }
      const dealtSeats = state.seats.map((seat): SeatState => {
        const cards = cardsBySeat.get(seat.seatIndex);
        if (cards === undefined) {
          return seat;
        }
        if (cards.length !== 2) {
          throw new Error('a batched hole-card deal must give each included seat two cards');
        }
        return { ...seat, holeCards: [cards[0]!, cards[1]!] };
      });
      next = {
        ...state,
        seats: dealtSeats,
        activeHand: {
          ...state.activeHand,
          dealCursor: state.activeHand.dealCursor + event.orderedDeals.length,
        },
      };
      break;
    }
    case 'BettingRoundStarted': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('BettingRoundStarted requires the matching active hand');
      }
      const actionable = new Set(state.seats
        .filter((seat) => seat.status === 'active' && seat.stack > 0)
        .map((seat) => seat.seatIndex));
      const pendingActors = event.actor === null
        ? []
        : clockwiseSeatsFrom(event.actor, actionable, state.config.maxSeats);
      const seats = event.street === 'preflop'
        ? state.seats
        : state.seats.map((seat): SeatState => ({
          ...seat,
          committedStreet: 0,
          lastActedAtBetTo: null,
        }));
      next = {
        ...state,
        seats,
        activeHand: {
          ...state.activeHand,
          phase: event.street,
          street: event.street,
          currentActorSeat: event.actor,
          currentBetTo: event.currentBetTo,
          lastFullRaiseSize: event.lastFullRaiseSize,
          lastAggressorSeat: event.street === 'preflop'
            ? state.activeHand.positions.bigBlindSeat
            : null,
          pendingActors,
        },
      };
      break;
    }
    case 'PlayerActed': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('PlayerActed requires the matching active hand');
      }
      const actingSeat = state.seats.find((seat) => seat.seatIndex === event.seat);
      if (actingSeat === undefined || event.paid < 0 || event.paid > actingSeat.stack) {
        throw new Error('player action cannot make a stack negative');
      }
      const updatedSeats = replaceSeat(state.seats, event.seat, (seat) => {
        const stack = seat.stack - event.paid;
        return {
          ...seat,
          stack,
          status: event.normalizedKind === 'fold'
            ? 'folded'
            : event.allIn ? 'all-in' : seat.status,
          committedStreet: seat.committedStreet + event.paid,
          committedHand: seat.committedHand + event.paid,
          lastActedAtBetTo: event.betToAfter,
        };
      });
      const increased = event.betToAfter > event.betToBefore;
      let pendingActors: number[];
      if (increased) {
        const responders = new Set(updatedSeats
          .filter((seat) => seat.seatIndex !== event.seat
            && seat.status === 'active'
            && seat.stack > 0
            && seat.committedStreet < event.betToAfter)
          .map((seat) => seat.seatIndex));
        pendingActors = clockwiseSeatsFrom(
          (event.seat + 1) % state.config.maxSeats,
          responders,
          state.config.maxSeats,
        );
      } else {
        pendingActors = state.activeHand.pendingActors.filter((seat) => seat !== event.seat);
      }
      next = {
        ...state,
        seats: updatedSeats,
        activeHand: {
          ...state.activeHand,
          currentActorSeat: pendingActors[0] ?? null,
          currentBetTo: event.betToAfter,
          lastFullRaiseSize: increased && event.fullRaise
            ? event.betToAfter - event.betToBefore
            : state.activeHand.lastFullRaiseSize,
          lastAggressorSeat: increased ? event.seat : state.activeHand.lastAggressorSeat,
          pendingActors,
        },
      };
      break;
    }
    case 'BettingRoundClosed': {
      if (state.activeHand === null
        || state.activeHand.handId !== event.handId
        || state.activeHand.street !== event.street) {
        throw new Error('BettingRoundClosed requires the matching active street');
      }
      const liveCount = state.seats.filter((seat) => seat.status !== 'folded'
        && seat.status !== 'eliminated').length;
      const nextPhase: Phase = liveCount === 1
        ? 'settlement'
        : event.street === 'preflop'
          ? 'deal-flop'
          : event.street === 'flop'
            ? 'deal-turn'
            : event.street === 'turn'
              ? 'deal-river'
              : 'showdown';
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          phase: nextPhase,
          currentActorSeat: null,
          pendingActors: [],
        },
      };
      break;
    }
    case 'CardBurned': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('CardBurned requires the matching active hand');
      }
      const expectedPhase = `deal-${event.street}` as const;
      const nextCard = state.activeHand.deck[state.activeHand.dealCursor];
      if (state.activeHand.phase !== expectedPhase
        || state.activeHand.board.length !== BOARD_COUNT_BEFORE_STREET[event.street]
        || state.activeHand.burnedCards.length !== BURN_COUNT_BEFORE_STREET[event.street]) {
        throw new Error('CardBurned violates the required street sequence');
      }
      if (nextCard === undefined || !sameCard(nextCard, event.card)) {
        throw new Error('CardBurned must match the next authoritative deck card');
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          burnedCards: [...state.activeHand.burnedCards, { ...nextCard }],
          dealCursor: state.activeHand.dealCursor + 1,
        },
      };
      break;
    }
    case 'CommunityCardsDealt': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('CommunityCardsDealt requires the matching active hand');
      }
      const expectedPhase = `deal-${event.street}` as const;
      const expectedCount = event.street === 'flop' ? 3 : 1;
      const nextCards = state.activeHand.deck.slice(
        state.activeHand.dealCursor,
        state.activeHand.dealCursor + expectedCount,
      );
      if (state.activeHand.phase !== expectedPhase
        || state.activeHand.board.length !== BOARD_COUNT_BEFORE_STREET[event.street]
        || state.activeHand.burnedCards.length !== BURN_COUNT_BEFORE_STREET[event.street] + 1) {
        throw new Error('CommunityCardsDealt violates the required burn/deal sequence');
      }
      if (nextCards.length !== expectedCount
        || event.cards.length !== expectedCount
        || nextCards.some((card, index) => {
          const eventCard = event.cards[index];
          return eventCard === undefined || !sameCard(card, eventCard);
        })) {
        throw new Error('CommunityCardsDealt must match the next authoritative deck cards');
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          board: [...state.activeHand.board, ...nextCards.map((card) => ({ ...card }))],
          dealCursor: state.activeHand.dealCursor + nextCards.length,
        },
      };
      break;
    }
    case 'HoleCardsRevealed': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('HoleCardsRevealed requires the matching active hand');
      }
      const seat = state.seats.find((candidate) => candidate.seatIndex === event.seat);
      if (seat?.holeCards === null
        || seat?.holeCards === undefined
        || seat.status === 'folded'
        || seat.status === 'eliminated'
        || seat.holeCards.some((card, index) => {
          const eventCard = event.cards[index];
          return eventCard === undefined || !sameCard(card, eventCard);
        })) {
        throw new Error('HoleCardsRevealed requires matching live hole cards');
      }
      if (state.activeHand.revealedHoleCardSeats.includes(event.seat)) {
        throw new Error('HoleCardsRevealed cannot reveal a seat more than once');
      }
      const revealOrder = state.activeHand.showdownRevealOrder ?? expectedShowdownRevealOrder(state);
      const nextReveal = revealOrder.find(
        (seatIndex) => !state.activeHand!.revealedHoleCardSeats.includes(seatIndex),
      );
      if (event.seat !== nextReveal) {
        throw new Error('HoleCardsRevealed must follow authoritative reveal order');
      }
      if (event.reason === 'showdown') {
        if (state.activeHand.phase !== 'showdown') {
          throw new Error('showdown hole-card reveal requires showdown phase');
        }
      } else {
        const liveSeats = state.seats.filter((candidate) => candidate.status !== 'folded'
          && candidate.status !== 'eliminated');
        const actionableSeats = liveSeats.filter((candidate) => candidate.status === 'active'
          && candidate.stack > 0);
        const noFutureDecision = actionableSeats.length === 0
          || (actionableSeats.length === 1
            && Math.max(
              0,
              state.activeHand.currentBetTo - actionableSeats[0]!.committedStreet,
            ) === 0);
        if (liveSeats.length < 2
          || !liveSeats.some((candidate) => candidate.status === 'all-in')
          || !noFutureDecision) {
          throw new Error('all-in hole-card reveal requires multiple live seats and no future decision');
        }
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          revealedHoleCardSeats: [...state.activeHand.revealedHoleCardSeats, event.seat]
            .sort((left, right) => left - right),
        },
      };
      break;
    }
    case 'UncalledBetReturned': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('UncalledBetReturned requires the matching active hand');
      }
      const seat = state.seats.find((candidate) => candidate.seatIndex === event.seat);
      const expectedRefund = contributionLayers(state).refunds[0];
      if (seat === undefined
        || (state.activeHand.phase !== 'showdown' && state.activeHand.phase !== 'settlement')
        || (state.activeHand.pendingPots?.length ?? 0) !== 0
        || (state.activeHand.constructedPotCount ?? 0) !== 0
        || (state.activeHand.evaluatedHands?.length ?? 0) !== 0
        || (state.activeHand.phase === 'showdown'
          && (state.activeHand.showdownRevealOrder === undefined
            || state.activeHand.showdownRevealOrder.some(
              (seatIndex) => !state.activeHand!.revealedHoleCardSeats.includes(seatIndex),
            )))
        || expectedRefund === undefined
        || event.seat !== expectedRefund.seatIndex
        || event.amount !== expectedRefund.amount) {
        throw new Error('UncalledBetReturned violates refund phase or showdown chronology');
      }
      next = {
        ...state,
        seats: replaceSeat(state.seats, event.seat, (candidate) => ({
          ...candidate,
          stack: candidate.stack + event.amount,
          committedHand: candidate.committedHand - event.amount,
          committedStreet: Math.max(0, candidate.committedStreet - event.amount),
        })),
      };
      break;
    }
    case 'ShowdownStarted': {
      if (state.activeHand === null
        || state.activeHand.handId !== event.handId
        || state.activeHand.phase !== 'showdown'
        || state.activeHand.board.length !== 5) {
        throw new Error('ShowdownStarted requires showdown phase');
      }
      const expectedOrder = expectedShowdownRevealOrder(state);
      if (state.activeHand.showdownRevealOrder !== undefined
        || JSON.stringify(event.revealOrder) !== JSON.stringify(expectedOrder)) {
        throw new Error('ShowdownStarted reveal order must match showdown authority');
      }
      const showdownRanks = event.revealOrder.map((seatIndex) => {
        const seat = state.seats.find((candidate) => candidate.seatIndex === seatIndex);
        if (seat?.holeCards === null || seat?.holeCards === undefined) {
          throw new Error('ShowdownStarted requires hole cards for every eligible seat');
        }
        return {
          seat: seatIndex,
          rank: evaluateBest([...state.activeHand!.board, ...seat.holeCards]),
        };
      });
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          showdownRevealOrder: [...event.revealOrder],
          showdownRanks,
          evaluatedHands: [],
        },
      };
      break;
    }
    case 'PotConstructed': {
      if (state.activeHand === null
        || state.activeHand.handId !== event.handId
        || (state.activeHand.phase !== 'showdown' && state.activeHand.phase !== 'settlement')) {
        throw new Error('PotConstructed requires settlement or showdown phase');
      }
      if (state.activeHand.phase === 'showdown'
        && state.activeHand.showdownRevealOrder === undefined) {
        throw new Error('PotConstructed requires ShowdownStarted first');
      }
      const pendingPots = state.activeHand.pendingPots ?? [];
      const constructedPotCount = state.activeHand.constructedPotCount ?? 0;
      const positiveCommitments = state.seats
        .map((seat) => seat.committedHand)
        .filter((amount) => amount > 0);
      const layerWidth = Math.min(...positiveCommitments);
      const contributors = state.seats.filter((seat) => seat.committedHand > 0);
      const previousCap = state.activeHand.lastConstructedCap ?? 0;
      const expectedEligible = contributors
        .filter((seat) => seat.status !== 'folded' && seat.status !== 'eliminated')
        .map((seat) => seat.seatIndex);
      const expectedAmount = layerWidth * contributors.length;
      if (!Number.isSafeInteger(event.amount)
        || event.amount <= 0
        || contributors.length <= 1
        || contributionLayers(state).refunds.length !== 0
        || (state.activeHand.evaluatedHands?.length ?? 0) !== 0
        || !Number.isFinite(layerWidth)
        || event.amount !== expectedAmount
        || event.cap !== previousCap + layerWidth
        || JSON.stringify(event.eligibleSeats) !== JSON.stringify(expectedEligible)
        || event.potId !== `pot-${constructedPotCount}`
        || pendingPots.some((pot) => pot.potId === event.potId)) {
        throw new Error('PotConstructed must match the next authoritative contribution layer');
      }
      if (state.activeHand.showdownRevealOrder !== undefined
        && state.activeHand.showdownRevealOrder.some(
          (seat) => !state.activeHand!.revealedHoleCardSeats.includes(seat),
        )) {
        throw new Error('PotConstructed requires every showdown reveal first');
      }
      next = {
        ...state,
        seats: state.seats.map((seat) => seat.committedHand === 0 ? seat : ({
          ...seat,
          committedHand: seat.committedHand - layerWidth,
          committedStreet: Math.max(0, seat.committedStreet - layerWidth),
        })),
        activeHand: {
          ...state.activeHand,
          phase: 'settlement',
          pendingPots: [...pendingPots, {
            potId: event.potId,
            amount: event.amount,
            cap: event.cap,
            eligibleSeats: [...event.eligibleSeats],
          }],
          constructedPotCount: constructedPotCount + 1,
          lastConstructedCap: event.cap,
        },
      };
      break;
    }
    case 'HandEvaluated': {
      if (state.activeHand === null
        || state.activeHand.handId !== event.handId
        || (state.activeHand.phase !== 'showdown' && state.activeHand.phase !== 'settlement')) {
        throw new Error('HandEvaluated requires showdown settlement');
      }
      const revealOrder = state.activeHand.showdownRevealOrder;
      const evaluations = state.activeHand.evaluatedHands ?? [];
      const seat = state.seats.find((candidate) => candidate.seatIndex === event.seat);
      if (revealOrder === undefined
        || !revealOrder.includes(event.seat)
        || event.seat !== revealOrder[evaluations.length]
        || evaluations.some((evaluation) => evaluation.seat === event.seat)
        || state.seats.some((candidate) => candidate.committedHand !== 0)
        || seat?.holeCards === null
        || seat?.holeCards === undefined) {
        throw new Error('HandEvaluated violates next evaluation order or eligibility');
      }
      const expectedRank = state.activeHand.showdownRanks?.find(
        (evaluation) => evaluation.seat === event.seat,
      )?.rank;
      if (expectedRank === undefined) {
        throw new Error('HandEvaluated requires a precomputed authoritative rank');
      }
      if (JSON.stringify(event.rank) !== JSON.stringify(expectedRank)) {
        throw new Error('HandEvaluated rank must match authoritative cards');
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          evaluatedHands: [...evaluations, { seat: event.seat, rank: event.rank }],
        },
      };
      break;
    }
    case 'PotAwarded': {
      if (state.activeHand === null
        || state.activeHand.handId !== event.handId
        || state.activeHand.phase !== 'settlement') {
        throw new Error('PotAwarded requires settlement phase');
      }
      const pendingPots = state.activeHand.pendingPots ?? [];
      const pot = pendingPots[0];
      const uniqueWinners = new Set(event.winners);
      let expectedWinners: number[] = [];
      if (pot !== undefined && state.activeHand.showdownRevealOrder !== undefined) {
        const ranks = new Map((state.activeHand.evaluatedHands ?? [])
          .map((evaluation) => [evaluation.seat, evaluation.rank] as const));
        if (pot.eligibleSeats.every((seat) => ranks.has(seat))) {
          for (const seat of pot.eligibleSeats) {
            if (expectedWinners.length === 0) {
              expectedWinners = [seat];
              continue;
            }
            const comparison = compareHandRanks(ranks.get(seat)!, ranks.get(expectedWinners[0]!)!);
            if (comparison > 0) expectedWinners = [seat];
            else if (comparison === 0) expectedWinners.push(seat);
          }
        }
      } else if (pot !== undefined) {
        expectedWinners = state.seats
          .filter((seat) => seat.status !== 'folded' && seat.status !== 'eliminated')
          .map((seat) => seat.seatIndex);
      }
      const allShowdownSeatsEvaluated = state.activeHand.showdownRevealOrder === undefined
        || state.activeHand.showdownRevealOrder.every((seat) => (state.activeHand!.evaluatedHands ?? [])
          .some((evaluation) => evaluation.seat === seat));
      const share = pot === undefined ? 0 : Math.floor(pot.amount / expectedWinners.length);
      const remainder = pot === undefined ? 0 : pot.amount % expectedWinners.length;
      const expectedOddRecipients = oddChipOrder(
        expectedWinners,
        state.activeHand.positions.buttonPosition,
        state.config.maxSeats,
      ).slice(0, remainder);
      const extraSeats = new Set(expectedOddRecipients);
      const expectedAmounts = expectedWinners.map((seat) => share + (extraSeats.has(seat) ? 1 : 0));
      if (pot === undefined
        || pot.potId !== event.potId
        || state.seats.some((seat) => seat.committedHand !== 0)
        || contributionLayers(state).refunds.length !== 0
        || !allShowdownSeatsEvaluated
        || (state.activeHand.showdownRevealOrder === undefined && expectedWinners.length !== 1)
        || event.winners.length === 0
        || event.winners.length !== event.amounts.length
        || uniqueWinners.size !== event.winners.length
        || event.winners.some((seat) => !pot.eligibleSeats.includes(seat))
        || event.amounts.some((amount) => !Number.isSafeInteger(amount) || amount <= 0)
        || event.amounts.reduce((sum, amount) => sum + amount, 0) !== pot.amount
        || event.oddChipRecipients.some((seat) => !uniqueWinners.has(seat))
        || JSON.stringify(event.winners) !== JSON.stringify(expectedWinners)
        || JSON.stringify(event.amounts) !== JSON.stringify(expectedAmounts)
        || JSON.stringify(event.oddChipRecipients) !== JSON.stringify(expectedOddRecipients)) {
        throw new Error('PotAwarded violates pending-pot order, remaining layers, or award authority');
      }
      let seats = state.seats;
      event.winners.forEach((winner, index) => {
        seats = replaceSeat(seats, winner, (seat) => ({
          ...seat,
          stack: seat.stack + event.amounts[index]!,
        }));
      });
      next = {
        ...state,
        seats,
        activeHand: {
          ...state.activeHand,
          pendingPots: pendingPots.filter((candidate) => candidate.potId !== event.potId),
        },
      };
      break;
    }
    case 'PlayerEliminated': {
      if (state.activeHand === null || state.activeHand.handId !== event.handId) {
        throw new Error('PlayerEliminated requires the matching active hand');
      }
      const seat = state.seats.find((candidate) => candidate.seatIndex === event.seat);
      const nextBustedSeat = state.seats.find(
        (candidate) => candidate.stack === 0 && candidate.status !== 'eliminated',
      )?.seatIndex;
      if (seat === undefined
        || event.seat !== nextBustedSeat
        || seat.stack !== 0
        || seat.status === 'eliminated'
        || state.seats.some((candidate) => candidate.committedHand !== 0)
        || (state.activeHand.pendingPots?.length ?? 0) !== 0) {
        throw new Error('PlayerEliminated requires fully settled chips and a newly busted seat');
      }
      next = {
        ...state,
        seats: replaceSeat(state.seats, event.seat, (candidate) => ({
          ...candidate,
          status: 'eliminated',
        })),
      };
      break;
    }
    case 'HandCompleted': {
      if (state.activeHand === null
        || state.activeHand.handId !== event.handId
        || state.activeHand.phase !== 'settlement') {
        throw new Error('HandCompleted requires settlement phase');
      }
      const finalStacks = state.seats.map((seat) => ({ seat: seat.seatIndex, stack: seat.stack }));
      if (state.seats.some((seat) => seat.committedHand !== 0)
        || (state.activeHand.pendingPots?.length ?? 0) !== 0
        || state.seats.some((seat) => seat.stack === 0 && seat.status !== 'eliminated')
        || JSON.stringify(event.finalStacks) !== JSON.stringify(finalStacks)) {
        throw new Error('HandCompleted requires exact finalized stacks, elimination, and no pending chips');
      }
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          phase: 'hand-complete',
          currentActorSeat: null,
          pendingActors: [],
        },
      };
      break;
    }
    default:
      return assertNever(event);
  }

  return appendEvent(next, event);
}

export function createTournament(
  config: TournamentConfig,
  seats: readonly TournamentSeatInput[],
  runSeed: string,
): TransitionResult {
  validateTournamentInputs(config, seats);
  const ownedConfig = cloneTournamentConfig(config);
  const ownedSeats = seats.map((seat) => ({
    playerId: seat.playerId,
    seatIndex: seat.seatIndex,
  }));
  const event: DomainEvent = {
    type: 'GameStarted',
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventIndex: 0,
    config: ownedConfig,
    seats: ownedSeats,
    runSeed,
    rulesVersion: RULES_VERSION,
    rngVersion: RNG_ALGORITHM_VERSION,
    shuffleVersion: SHUFFLE_ALGORITHM_VERSION,
    strategyVersion: STRATEGY_VERSION,
  };
  return {
    state: reduceDomainEvent(null, event),
    events: [event],
  };
}

export function startHand(
  state: TournamentState,
  options: Readonly<StartHandOptions> = {},
): TransitionResult {
  if (state.activeHand !== null && state.activeHand.phase !== 'hand-complete') {
    throw new Error('cannot start a hand while another hand is active');
  }
  if (state.seats.some((seat) => seat.stack === 0 && seat.status !== 'eliminated')) {
    throw new Error('cannot start a hand before settlement-owned elimination is finalized');
  }

  const survivorSeats = state.seats
    .filter((seat) => seat.stack > 0 && seat.status !== 'eliminated')
    .map((seat) => seat.seatIndex);
  if (survivorSeats.length < 2) {
    throw new Error('at least two survivors are required to start a hand');
  }

  const handNumber = state.handNumber + 1;
  const logicalBlindLevel = Math.min(
    Math.floor((handNumber - 1) / state.config.handsPerLevel),
    state.config.blindLevels.length - 1,
  );
  const blindLevel = state.config.blindLevels[logicalBlindLevel]!;
  const handId = `${state.runSeed}/hand/${handNumber}`;
  let current = state;
  const events: DomainEvent[] = [];

  const emit = (event: DomainEvent): void => {
    current = reduceDomainEvent(current, event);
    events.push(event);
  };
  const eventBase = () => ({
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventIndex: current.version,
    handId,
  } as const);

  emit({
    ...eventBase(),
    type: 'HandStarted',
    handNumber,
    logicalBlindLevel,
    smallBlind: blindLevel.smallBlind,
    bigBlind: blindLevel.bigBlind,
  });

  const positions = state.handNumber === 0 || state.activeHand === null
    ? assignInitialPositions(state.config.initialButtonSeat, survivorSeats, state.config.maxSeats)
    : advancePositions(state.activeHand.positions, survivorSeats, state.config.maxSeats);
  emit({ ...eventBase(), type: 'PositionsAssigned', ...positions });

  const postBlind = (seatIndex: number, kind: 'small' | 'big', blind: number): void => {
    const seat = current.seats.find((candidate) => candidate.seatIndex === seatIndex)!;
    const amount = Math.min(blind, seat.stack);
    emit({
      ...eventBase(),
      type: 'BlindPosted',
      seat: seatIndex,
      kind,
      amount,
      allIn: amount === seat.stack,
    });
  };
  if (positions.smallBlindSeat !== null) {
    postBlind(positions.smallBlindSeat, 'small', blindLevel.smallBlind);
  }
  postBlind(positions.bigBlindSeat, 'big', blindLevel.bigBlind);

  const fullOrderedDeck = options.fixedDeck === undefined
    ? shuffleDeck(createStandardDeck(), createSeededRandom(state.runSeed, `deck/${handNumber}`))
    : validateAndCloneDeck(options.fixedDeck);
  emit({
    ...eventBase(),
    type: 'DeckPrepared',
    fullOrderedDeck,
    shuffleVersion: SHUFFLE_ALGORITHM_VERSION,
  });

  const survivors = new Set(survivorSeats);
  const firstDealSeat = firstIncludedAfter(
    positions.buttonPosition,
    survivors,
    state.config.maxSeats,
  )!;
  const dealOrder = clockwiseSeatsFrom(firstDealSeat, survivors, state.config.maxSeats);
  const orderedDeals = ([1, 2] as const).flatMap((round) => dealOrder.map((seat) => ({
    seat,
    card: fullOrderedDeck[(round - 1) * dealOrder.length + dealOrder.indexOf(seat)]!,
    round,
  })));
  emit({ ...eventBase(), type: 'HoleCardsDealt', orderedDeals });

  const actionable = new Set(current.seats
    .filter((seat) => seat.status === 'active' && seat.stack > 0)
    .map((seat) => seat.seatIndex));
  const actualBigBlind = current.seats.find((seat) => seat.seatIndex === positions.bigBlindSeat)!
    .committedStreet;
  const currentBetTo = survivorSeats.length === 2 ? actualBigBlind : blindLevel.bigBlind;
  let actor = firstIncludedAfter(positions.bigBlindSeat, actionable, state.config.maxSeats);
  if (survivorSeats.length === 2 && actionable.size === 1) {
    const onlyFundedSeat = current.seats.find((seat) => actionable.has(seat.seatIndex))!;
    if (onlyFundedSeat.committedStreet >= currentBetTo) {
      actor = null;
    }
  }
  emit({
    ...eventBase(),
    type: 'BettingRoundStarted',
    street: 'preflop',
    actor,
    currentBetTo,
    lastFullRaiseSize: blindLevel.bigBlind,
  });

  return { state: current, events };
}
