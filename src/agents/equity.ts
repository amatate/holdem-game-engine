import type { PlayerObservationV1 } from './types.js';
import { cloneCanonicalCard, createStandardDeck, shuffleDeck } from '../core/cards.js';
import { compareHandRanks, evaluateBest, type HandRank } from '../core/hand-evaluator.js';
import type { Card, RandomSource } from '../core/types.js';
import { prepareRangeDealer, type OpponentReads } from './opponent-ranges.js';

export interface EquityEstimate {
  readonly equity: number;
  readonly wins: number;
  readonly ties: number;
  readonly losses: number;
  readonly samples: number;
}

export const MAX_EQUITY_SAMPLES = 1_000_000;

const EQUITY_UNIT_SCALE = 60;
const INVALID_EQUITY_INPUT = 'Invalid equity input';

class EquityInputError extends Error {}

interface ValidatedEquityInput {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly liveOpponentCount: number;
  readonly unknownDeck: readonly Card[];
}

function rejectInput(): never {
  throw new EquityInputError(INVALID_EQUITY_INPUT);
}

function copyDenseArray(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value)) rejectInput();
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) rejectInput();

  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) rejectInput();
    copy.push(value[index]);
  }
  return copy;
}

function cloneCardBatch(value: unknown, minimum: number, maximum: number): Card[] {
  const rawCards = copyDenseArray(value, minimum, maximum);
  const result: Card[] = [];
  for (let index = 0; index < rawCards.length; index += 1) {
    result.push(cloneCanonicalCard(rawCards[index]));
  }
  return result;
}

function isStreet(value: unknown): value is 'preflop' | 'flop' | 'turn' | 'river' {
  return value === 'preflop' || value === 'flop' || value === 'turn' || value === 'river';
}

function expectedBoardLength(street: 'preflop' | 'flop' | 'turn' | 'river'): number {
  if (street === 'preflop') return 0;
  if (street === 'flop') return 3;
  if (street === 'turn') return 4;
  return 5;
}

function validateObservation(observation: PlayerObservationV1): ValidatedEquityInput {
  try {
    if (typeof observation !== 'object' || observation === null) rejectInput();
    if (observation.schemaVersion !== 1) rejectInput();

    const street = observation.street;
    if (!isStreet(street)) rejectInput();

    const actorSeatIndex = observation.actorSeatIndex;
    if (!Number.isSafeInteger(actorSeatIndex) || actorSeatIndex < 0 || actorSeatIndex > 5) {
      rejectInput();
    }

    const heroCards = cloneCardBatch(observation.holeCards, 2, 2);
    const board = cloneCardBatch(observation.board, 0, 5);
    if (board.length !== expectedBoardLength(street)) rejectInput();

    const knownCodes = new Set<string>();
    for (let index = 0; index < heroCards.length; index += 1) {
      const code = heroCards[index]!.code;
      if (knownCodes.has(code)) rejectInput();
      knownCodes.add(code);
    }
    for (let index = 0; index < board.length; index += 1) {
      const code = board[index]!.code;
      if (knownCodes.has(code)) rejectInput();
      knownCodes.add(code);
    }

    const rawSeats = copyDenseArray(observation.seats, 2, 6);
    const playerIds = new Set<string>();
    let actorCount = 0;
    let liveOpponentCount = 0;
    for (let index = 0; index < rawSeats.length; index += 1) {
      const rawSeat = rawSeats[index];
      if (typeof rawSeat !== 'object' || rawSeat === null) rejectInput();
      const seat = rawSeat as Record<string, unknown>;

      const revealedHoleCards = seat.revealedHoleCards;
      if (revealedHoleCards !== null) rejectInput();

      const seatIndex = seat.seatIndex;
      const playerId = seat.playerId;
      const status = seat.status;
      if (!Number.isSafeInteger(seatIndex) || seatIndex !== index) rejectInput();
      if (typeof playerId !== 'string' || playerId.length === 0 || playerIds.has(playerId)) {
        rejectInput();
      }
      playerIds.add(playerId);
      if (status !== 'active' && status !== 'folded'
        && status !== 'all-in' && status !== 'eliminated') {
        rejectInput();
      }

      if (seatIndex === actorSeatIndex) {
        actorCount += 1;
        if (status !== 'active') rejectInput();
      } else if (status === 'active' || status === 'all-in') {
        liveOpponentCount += 1;
      }
    }
    if (actorCount !== 1 || liveOpponentCount < 1 || liveOpponentCount > 5) rejectInput();

    const standardDeck = createStandardDeck();
    const unknownDeck: Card[] = [];
    for (let index = 0; index < standardDeck.length; index += 1) {
      const card = standardDeck[index]!;
      if (!knownCodes.has(card.code)) unknownDeck.push(card);
    }
    const requiredUnknownCards = liveOpponentCount * 2 + (5 - board.length);
    if (requiredUnknownCards > unknownDeck.length) rejectInput();

    return {
      heroCards: [heroCards[0]!, heroCards[1]!],
      board,
      liveOpponentCount,
      unknownDeck,
    };
  } catch (error) {
    if (error instanceof EquityInputError) throw error;
    throw new EquityInputError(INVALID_EQUITY_INPUT);
  }
}

export function estimateEquity(
  observation: PlayerObservationV1,
  samples: number,
  random: RandomSource,
): EquityEstimate {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > MAX_EQUITY_SAMPLES) {
    rejectInput();
  }

  const input = validateObservation(observation);
  return sampleKnownHand(input, samples, random);
}

export interface KnownHandEquityInput {
  readonly holeCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly livePlayerCount: number;
}

/** Conditions candidate hands on public betting rounds; never accepts actual opponent cards. */
export function estimateRangeEquity(observation: PlayerObservationV1, samples: number, random: RandomSource,
  reads?: OpponentReads): EquityEstimate {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > MAX_EQUITY_SAMPLES) rejectInput();
  const input = validateObservation(observation);
  const deal = prepareRangeDealer(observation, input.unknownDeck, reads);
  return sampleKnownHand(input, samples, random, deal ?? undefined);
}

/** Samples unknown opponents; never accepts their real cards or the authoritative deck. */
export function estimateKnownHandEquity(
  input: KnownHandEquityInput, samples: number, random: RandomSource,
): EquityEstimate {
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > MAX_EQUITY_SAMPLES) rejectInput();
  const heroCards = cloneCardBatch(input.holeCards, 2, 2);
  const board = cloneCardBatch(input.board, 0, 5);
  if (![0, 3, 4, 5].includes(board.length) || !Number.isSafeInteger(input.livePlayerCount)
    || input.livePlayerCount < 2 || input.livePlayerCount > 6) rejectInput();
  const codes = new Set([...heroCards, ...board].map((card) => card.code));
  if (codes.size !== heroCards.length + board.length) rejectInput();
  return sampleKnownHand({
    heroCards: [heroCards[0]!, heroCards[1]!], board,
    liveOpponentCount: input.livePlayerCount - 1,
    unknownDeck: createStandardDeck().filter((card) => !codes.has(card.code)),
  }, samples, random);
}

function sampleKnownHand(input: ValidatedEquityInput, samples: number, random: RandomSource, deal?: (random: RandomSource) => Card[]): EquityEstimate {
  let wins = 0;
  let ties = 0;
  let losses = 0;
  let equityUnits = 0;
  // A river board is fixed across samples; avoid re-evaluating identical seven-card hands.
  const riverHero = input.board.length === 5 ? evaluateBest([...input.heroCards, ...input.board]) : null;
  const riverOpponents = new Map<string, HandRank>();

  for (let sample = 0; sample < samples; sample += 1) {
    const shuffled = deal ? deal(random) : shuffleDeck(input.unknownDeck, random);
    const opponentCards: Array<readonly [Card, Card]> = [];
    let cursor = 0;
    for (let opponent = 0; opponent < input.liveOpponentCount; opponent += 1) {
      opponentCards.push([shuffled[cursor]!, shuffled[cursor + 1]!]);
      cursor += 2;
    }

    const completedBoard: Card[] = [];
    for (let index = 0; index < input.board.length; index += 1) {
      completedBoard.push(input.board[index]!);
    }
    while (completedBoard.length < 5) {
      completedBoard.push(shuffled[cursor]!);
      cursor += 1;
    }

    const heroSeven: Card[] = [input.heroCards[0], input.heroCards[1]];
    heroSeven.push(...completedBoard);
    const heroRank = riverHero ?? evaluateBest(heroSeven);
    let bestRank = heroRank;
    let heroIsBest = true;
    let winnerCount = 1;

    for (let opponent = 0; opponent < opponentCards.length; opponent += 1) {
      const holeCards = opponentCards[opponent]!;
      const opponentSeven: Card[] = [holeCards[0], holeCards[1]];
      opponentSeven.push(...completedBoard);
      const key = holeCards[0].code < holeCards[1].code
        ? holeCards[0].code + holeCards[1].code : holeCards[1].code + holeCards[0].code;
      let opponentRank = riverHero ? riverOpponents.get(key) : undefined;
      if (!opponentRank) {
        opponentRank = evaluateBest(opponentSeven);
        if (riverHero) riverOpponents.set(key, opponentRank);
      }
      const comparison = compareHandRanks(opponentRank, bestRank);
      if (comparison > 0) {
        bestRank = opponentRank;
        heroIsBest = false;
        winnerCount = 1;
      } else if (comparison === 0) {
        winnerCount += 1;
      }
    }

    if (!heroIsBest) {
      losses += 1;
    } else if (winnerCount === 1) {
      wins += 1;
      equityUnits += EQUITY_UNIT_SCALE;
    } else {
      ties += 1;
      equityUnits += EQUITY_UNIT_SCALE / winnerCount;
    }
  }

  return {
    equity: equityUnits / (EQUITY_UNIT_SCALE * samples),
    wins,
    ties,
    losses,
    samples,
  };
}
