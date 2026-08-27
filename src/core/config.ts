import { parseCard } from './cards.js';
import type { Card } from './types.js';

export interface BlindLevel {
  readonly smallBlind: number;
  readonly bigBlind: number;
}

export interface TournamentConfig {
  readonly maxSeats: number;
  readonly startingStack: number;
  readonly handsPerLevel: number;
  readonly blindLevels: readonly BlindLevel[];
  readonly initialButtonSeat: number;
}

export interface TournamentParticipantInput {
  readonly playerId: string;
  readonly seatIndex: number;
}

export class TournamentConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TournamentConfigurationError';
  }
}

export class DeckValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DeckValidationError';
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateTournamentInputs(
  config: TournamentConfig,
  seats: readonly TournamentParticipantInput[],
): void {
  if (!Number.isSafeInteger(config.maxSeats) || config.maxSeats < 2 || config.maxSeats > 6) {
    throw new TournamentConfigurationError('maxSeats must be a safe integer from 2 through 6');
  }
  if (!isPositiveSafeInteger(config.startingStack)) {
    throw new TournamentConfigurationError('startingStack must be a positive safe integer');
  }
  if (!Number.isSafeInteger(config.startingStack * config.maxSeats)) {
    throw new TournamentConfigurationError('total starting chips must be a safe integer');
  }
  if (!isPositiveSafeInteger(config.handsPerLevel)) {
    throw new TournamentConfigurationError('handsPerLevel must be a positive safe integer');
  }
  if (!Number.isSafeInteger(config.initialButtonSeat)
    || config.initialButtonSeat < 0
    || config.initialButtonSeat >= config.maxSeats) {
    throw new TournamentConfigurationError('initialButtonSeat must identify a physical seat');
  }
  if (config.blindLevels.length === 0) {
    throw new TournamentConfigurationError('blindLevels must not be empty');
  }
  for (const level of config.blindLevels) {
    if (!isPositiveSafeInteger(level.smallBlind)
      || !isPositiveSafeInteger(level.bigBlind)
      || level.smallBlind >= level.bigBlind) {
      throw new TournamentConfigurationError('each blind level requires safe integers with 0 < SB < BB');
    }
  }
  if (seats.length !== config.maxSeats) {
    throw new TournamentConfigurationError('participant count must equal maxSeats');
  }

  const playerIds = new Set<string>();
  const seatIndexes = new Set<number>();
  for (const seat of seats) {
    if (seat.playerId.length === 0 || playerIds.has(seat.playerId)) {
      throw new TournamentConfigurationError('playerId values must be non-empty and unique');
    }
    if (!Number.isSafeInteger(seat.seatIndex)
      || seat.seatIndex < 0
      || seat.seatIndex >= config.maxSeats
      || seatIndexes.has(seat.seatIndex)) {
      throw new TournamentConfigurationError('seatIndex values must be unique physical seats');
    }
    playerIds.add(seat.playerId);
    seatIndexes.add(seat.seatIndex);
  }
  for (let seatIndex = 0; seatIndex < config.maxSeats; seatIndex += 1) {
    if (!seatIndexes.has(seatIndex)) {
      throw new TournamentConfigurationError('physical seats must be contiguous from zero');
    }
  }
}

export function cloneTournamentConfig(config: TournamentConfig): TournamentConfig {
  return {
    maxSeats: config.maxSeats,
    startingStack: config.startingStack,
    handsPerLevel: config.handsPerLevel,
    blindLevels: config.blindLevels.map((level) => ({ ...level })),
    initialButtonSeat: config.initialButtonSeat,
  };
}

export function validateAndCloneDeck(deck: readonly Card[]): readonly Card[] {
  if (deck.length !== 52) {
    throw new DeckValidationError('a fixed deck must contain exactly 52 cards');
  }

  const codes = new Set<string>();
  const cloned: Card[] = [];
  for (const card of deck) {
    let canonical: Card;
    try {
      canonical = parseCard(card.code);
    } catch {
      throw new DeckValidationError('a fixed deck contains an invalid card');
    }
    if (card.rank !== canonical.rank || card.suit !== canonical.suit) {
      throw new DeckValidationError('a fixed deck contains inconsistent card data');
    }
    if (codes.has(card.code)) {
      throw new DeckValidationError('a fixed deck must contain 52 unique cards');
    }
    codes.add(card.code);
    cloned.push(canonical);
  }
  return cloned;
}
