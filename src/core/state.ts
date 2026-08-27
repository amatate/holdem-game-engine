import { createStandardDeck, shuffleDeck } from './cards.js';
import {
  cloneTournamentConfig,
  validateAndCloneDeck,
  validateTournamentInputs,
  type TournamentConfig,
  type TournamentParticipantInput,
} from './config.js';
import type { DomainEvent } from './events.js';
import { advancePositions, assignInitialPositions } from './positions.js';
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
      const resetSeats = state.seats.map((seat): SeatState => seat.stack === 0
        ? { ...seat, status: 'eliminated', holeCards: null, committedStreet: 0, committedHand: 0, lastActedAtBetTo: null }
        : { ...seat, status: 'active', holeCards: null, committedStreet: 0, committedHand: 0, lastActedAtBetTo: null });
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
      next = {
        ...state,
        activeHand: {
          ...state.activeHand,
          phase: event.street,
          street: event.street,
          currentActorSeat: event.actor,
          currentBetTo: event.currentBetTo,
          lastFullRaiseSize: event.lastFullRaiseSize,
          lastAggressorSeat: state.activeHand.positions.bigBlindSeat,
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
