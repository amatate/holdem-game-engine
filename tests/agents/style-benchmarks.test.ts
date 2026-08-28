import { describe, expect, it } from 'vitest';

import { createCharacterAgent, type CharacterId } from '../../src/agents/characters.js';
import type { EquityProvider } from '../../src/agents/parametric-agent.js';
import type { PlayerObservationV1, PublicSeatState } from '../../src/agents/types.js';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { ActionIntent, LegalActionSet } from '../../src/core/legal-actions.js';
import { createSeededRandom } from '../../src/core/random.js';
import type { Card, CardCode } from '../../src/core/types.js';

const CHARACTER_IDS: readonly CharacterId[] = ['rock', 'hunter', 'maniac', 'calling-station'];
const PREFLOP_WINS = {
  trash: [36, 40, 44, 48, 52, 56, 60, 66],
  marginal: [72, 78, 84, 90, 96, 102, 106, 108],
  playable: [114, 118, 122, 126, 132, 136, 140, 144],
  'premium-range': [162, 166, 170, 174, 180, 184, 188, 192],
} as const;
const POSTFLOP_WINS = {
  neutral: [42, 48, 54, 60, 66, 72, 78, 84],
  'marginal-made': [60, 66, 72, 78, 84, 90, 96, 102],
  'visible-draw': [72, 78, 84, 90, 96, 102, 108, 114],
  'thin-value': [84, 90, 96, 102, 108, 114, 120, 126],
} as const;
type PreflopBand = keyof typeof PREFLOP_WINS;
type PostflopBand = keyof typeof POSTFLOP_WINS;

const RANK_PAIRS = [
  ['A', 'K'], ['A', 'Q'], ['A', 'J'], ['A', 'T'], ['A', '9'], ['A', '8'], ['A', '7'], ['A', '6'],
  ['K', 'Q'], ['K', 'J'], ['K', 'T'], ['K', '9'], ['K', '8'], ['K', '7'], ['K', '6'], ['K', '5'],
  ['Q', 'J'], ['Q', 'T'], ['Q', '9'], ['Q', '8'], ['Q', '7'], ['Q', '6'], ['Q', '5'], ['Q', '4'],
  ['J', 'T'], ['J', '9'], ['J', '8'], ['J', '7'], ['J', '6'], ['J', '5'], ['J', '4'], ['J', '3'],
] as const;
const SUIT_REPLICAS = [['c', 'd'], ['d', 'h'], ['h', 's'], ['s', 'c']] as const;

interface SemanticFixture {
  readonly phase: 'preflop' | 'postflop';
  readonly band: PreflopBand | PostflopBand;
  readonly position: 'early' | 'button' | 'hu';
  readonly observation: PlayerObservationV1;
  readonly potTarget: number;
  readonly seedPath: string;
}
interface RateMetric { readonly numerator: number; readonly denominator: number; readonly rate: number }
interface CharacterMetrics {
  readonly continue: RateMetric;
  readonly raise: RateMetric;
  readonly premiumRaise: RateMetric;
  readonly earlyContinue: RateMetric;
  readonly buttonContinue: RateMetric;
  readonly foldToBet: RateMetric;
  readonly potOrAllIn: RateMetric;
  readonly aggressiveCount: number;
}

function rate(numerator: number, denominator: number): RateMetric {
  return { numerator, denominator, rate: numerator / denominator };
}

function legalPreflop(): LegalActionSet {
  return {
    fold: true, check: false, call: { pay: 4, to: 4, isAllIn: false },
    raiseTo: { min: 8, max: 100 }, allIn: { to: 100, mode: 'fullRaise' },
  };
}

function legalPostflop(): LegalActionSet {
  return {
    fold: true, check: false, call: { pay: 6, to: 6, isAllIn: false },
    raiseTo: { min: 12, max: 120 }, allIn: { to: 120, mode: 'fullRaise' },
  };
}

function makeObservation(options: Readonly<{
  actorSeatIndex: number;
  holeCards: readonly [CardCode, CardCode];
  board?: readonly CardCode[];
  potTotal: number;
  legalActions: LegalActionSet;
  seats: number;
  buttonPosition: number;
  handId?: string;
  handNumber?: number;
  decisionIndex?: number;
  playerPrefix?: string;
}>): PlayerObservationV1 {
  const publicSeats: PublicSeatState[] = Array.from({ length: options.seats }, (_, seatIndex) => ({
    playerId: `${options.playerPrefix ?? 'player'}-${seatIndex}`,
    seatIndex,
    stack: options.legalActions.allIn?.to ?? 100,
    status: 'active',
    committedStreet: 0,
    committedHand: 0,
    revealedHoleCards: null,
  }));
  const board = (options.board ?? []).map((code) => parseCard(code));
  return {
    schemaVersion: 1,
    handId: options.handId ?? 'hand/1',
    handNumber: options.handNumber ?? 1,
    decisionIndex: options.decisionIndex ?? 0,
    actorSeatIndex: options.actorSeatIndex,
    street: board.length === 0 ? 'preflop' : 'flop',
    holeCards: options.holeCards.map((code) => parseCard(code)) as [Card, Card],
    board,
    buttonPosition: options.buttonPosition,
    smallBlindSeat: options.seats === 2 ? 0 : 1,
    bigBlindSeat: options.seats === 2 ? 1 : 2,
    smallBlind: 1,
    bigBlind: 2,
    potTotal: options.potTotal,
    sidePots: [],
    seats: publicSeats,
    actionHistory: [],
    legalActions: options.legalActions,
  };
}

function semanticKey(observation: PlayerObservationV1): string {
  return `${observation.holeCards[0].code}/${observation.holeCards[1].code}`
    + `|${observation.board.map((card) => card.code).join('/')}`;
}

function buildPreflopFixtures(winsByKey: Map<string, number>): SemanticFixture[] {
  const fixtures: SemanticFixture[] = [];
  let point = 0;
  for (const [band, winsList] of Object.entries(PREFLOP_WINS) as Array<[PreflopBand, readonly number[]]>) {
    for (let equityIndex = 0; equityIndex < winsList.length; equityIndex += 1) {
      const ranks = RANK_PAIRS[point]!;
      for (let replica = 0; replica < SUIT_REPLICAS.length; replica += 1) {
        const suits = SUIT_REPLICAS[replica]!;
        const holeCards = [`${ranks[0]}${suits[0]}`, `${ranks[1]}${suits[1]}`] as [CardCode, CardCode];
        for (const position of ['early', 'button'] as const) {
          const visible = makeObservation({
            actorSeatIndex: position === 'early' ? 3 : 0,
            holeCards,
            potTotal: 12,
            legalActions: legalPreflop(),
            seats: 4,
            buttonPosition: 0,
          });
          winsByKey.set(semanticKey(visible), winsList[equityIndex]!);
          fixtures.push({
            phase: 'preflop', band, position, observation: visible, potTarget: 20,
            seedPath: `pre/${band}/${equityIndex}/${replica}`,
          });
        }
      }
      point += 1;
    }
  }
  return fixtures;
}

function candidatePairsForBand(band: PostflopBand): Readonly<{
  board: readonly [CardCode, CardCode, CardCode];
  holes: readonly [CardCode, CardCode][];
}> {
  const board = band === 'neutral'
    ? ['2c', '7d', 'Jh'] as const
    : band === 'marginal-made'
      ? ['8c', '2d', 'Kh'] as const
      : band === 'visible-draw'
        ? ['Kh', '2h', '9h'] as const
        : ['Qc', '7d', '2h'] as const;
  const excluded = new Set<string>(board);
  const deck = createStandardDeck().filter((card) => !excluded.has(card.code));
  const holes: Array<[CardCode, CardCode]> = [];
  for (let left = 0; left < deck.length && holes.length < 64; left += 1) {
    for (let right = left + 1; right < deck.length && holes.length < 64; right += 1) {
      const one = deck[left]!;
      const two = deck[right]!;
      const acceptable = band === 'neutral'
        ? one.rank !== two.rank && ![2, 7, 11].includes(one.rank) && ![2, 7, 11].includes(two.rank)
        : band === 'marginal-made'
          ? (one.rank === 8) !== (two.rank === 8)
          : band === 'visible-draw'
            ? (one.suit === 'h') !== (two.suit === 'h')
            : (one.rank === 12) !== (two.rank === 12);
      if (acceptable) holes.push([one.code, two.code]);
    }
  }
  if (holes.length !== 64) throw new Error(`insufficient ${band} replicas`);
  return { board, holes };
}

function buildPostflopFixtures(winsByKey: Map<string, number>): SemanticFixture[] {
  const fixtures: SemanticFixture[] = [];
  for (const [band, winsList] of Object.entries(POSTFLOP_WINS) as Array<[PostflopBand, readonly number[]]>) {
    const cardSets = candidatePairsForBand(band);
    for (let equityIndex = 0; equityIndex < winsList.length; equityIndex += 1) {
      for (let replica = 0; replica < 8; replica += 1) {
        const holeCards = cardSets.holes[equityIndex * 8 + replica]!;
        const visible = makeObservation({
          actorSeatIndex: 1,
          holeCards,
          board: cardSets.board,
          potTotal: 18,
          legalActions: legalPostflop(),
          seats: 2,
          buttonPosition: 0,
        });
        winsByKey.set(semanticKey(visible), winsList[equityIndex]!);
        fixtures.push({
          phase: 'postflop', band, position: 'hu', observation: visible, potTarget: 30,
          seedPath: `post/${band}/${equityIndex}/${replica}`,
        });
      }
    }
  }
  return fixtures;
}

function isAggressive(action: ActionIntent, legal: LegalActionSet): boolean {
  return action.type === 'raiseTo'
    || (action.type === 'allIn' && legal.allIn !== null && legal.allIn.mode !== 'call');
}

function assertLegal(action: ActionIntent, legal: LegalActionSet): void {
  if (action.type === 'fold') expect(legal.fold).toBe(true);
  if (action.type === 'check') expect(legal.check).toBe(true);
  if (action.type === 'call') expect(legal.call).not.toBeNull();
  if (action.type === 'allIn') expect(legal.allIn).not.toBeNull();
  if (action.type === 'raiseTo') {
    expect(legal.raiseTo).not.toBeNull();
    expect(action.amount).toBeGreaterThanOrEqual(legal.raiseTo!.min);
    expect(action.amount).toBeLessThanOrEqual(legal.raiseTo!.max);
  }
}

function providerFor(winsByKey: ReadonlyMap<string, number>, callSamples: number[]): EquityProvider {
  return (visible, samples) => {
    expect(samples).toBe(300);
    callSamples.push(samples);
    const wins = winsByKey.get(semanticKey(visible));
    if (wins === undefined) throw new Error(`unregistered semantic fixture: ${semanticKey(visible)}`);
    return { equity: wins / 300, wins, ties: 0, losses: 300 - wins, samples: 300 };
  };
}

type Accumulator = {
  preContinue: number; preTotal: number; preRaise: number; premiumRaise: number; premiumTotal: number;
  earlyContinue: number; earlyTotal: number; buttonContinue: number; buttonTotal: number;
  postFold: number; postTotal: number; potOrAllIn: number; aggressive: number;
};

function runBenchmark(
  fixtures: readonly SemanticFixture[],
  provider: EquityProvider,
  seed: string,
  characterOrder: readonly CharacterId[],
  reverseFixtures: boolean,
): Readonly<Record<CharacterId, CharacterMetrics>> {
  const orderedFixtures = reverseFixtures ? [...fixtures].reverse() : fixtures;
  const accumulators = Object.fromEntries(CHARACTER_IDS.map((characterId) => [characterId, {
    preContinue: 0, preTotal: 0, preRaise: 0, premiumRaise: 0, premiumTotal: 0,
    earlyContinue: 0, earlyTotal: 0, buttonContinue: 0, buttonTotal: 0,
    postFold: 0, postTotal: 0, potOrAllIn: 0, aggressive: 0,
  }])) as Record<CharacterId, Accumulator>;

  for (const fixture of orderedFixtures) {
    for (const characterId of characterOrder) {
      const decision = createCharacterAgent(characterId, { equityProvider: provider }).decide({
        observation: fixture.observation,
        random: createSeededRandom(seed, fixture.seedPath),
      });
      assertLegal(decision.action, fixture.observation.legalActions);
      const a = accumulators[characterId];
      const aggressive = isAggressive(decision.action, fixture.observation.legalActions);
      if (fixture.phase === 'preflop') {
        a.preTotal += 1;
        if (decision.action.type !== 'fold') a.preContinue += 1;
        if (aggressive) a.preRaise += 1;
        if (fixture.band === 'premium-range') {
          a.premiumTotal += 1;
          if (aggressive) a.premiumRaise += 1;
        }
        if (fixture.position === 'early') {
          a.earlyTotal += 1;
          if (decision.action.type !== 'fold') a.earlyContinue += 1;
        } else {
          a.buttonTotal += 1;
          if (decision.action.type !== 'fold') a.buttonContinue += 1;
        }
      } else {
        a.postTotal += 1;
        if (decision.action.type === 'fold') a.postFold += 1;
      }
      if (aggressive) {
        a.aggressive += 1;
        if (decision.action.type === 'allIn'
          || (decision.action.type === 'raiseTo' && decision.action.amount === fixture.potTarget)) {
          a.potOrAllIn += 1;
        }
      }
    }
  }

  return Object.fromEntries(CHARACTER_IDS.map((characterId) => {
    const a = accumulators[characterId];
    return [characterId, {
      continue: rate(a.preContinue, a.preTotal),
      raise: rate(a.preRaise, a.preTotal),
      premiumRaise: rate(a.premiumRaise, a.premiumTotal),
      earlyContinue: rate(a.earlyContinue, a.earlyTotal),
      buttonContinue: rate(a.buttonContinue, a.buttonTotal),
      foldToBet: rate(a.postFold, a.postTotal),
      potOrAllIn: rate(a.potOrAllIn, a.aggressive),
      aggressiveCount: a.aggressive,
    }];
  })) as unknown as Readonly<Record<CharacterId, CharacterMetrics>>;
}

function assertLockedRankings(metrics: Readonly<Record<CharacterId, CharacterMetrics>>): void {
  const diagnostics = JSON.stringify(metrics);
  const continueRates = CHARACTER_IDS.map((id) => metrics[id].continue.rate);
  expect(metrics.rock.continue.rate, diagnostics).toBe(Math.min(...continueRates));
  expect(metrics.maniac.continue.rate - metrics.rock.continue.rate, diagnostics).toBeGreaterThanOrEqual(0.20);
  expect(metrics.maniac.raise.rate - metrics.rock.raise.rate, diagnostics).toBeGreaterThanOrEqual(0.15);
  expect(metrics.maniac.raise.rate, diagnostics).toBeGreaterThan(metrics.hunter.raise.rate);
  expect(metrics.maniac.raise.rate, diagnostics).toBeGreaterThan(metrics['calling-station'].raise.rate);
  expect(metrics.hunter.premiumRaise.rate - metrics.rock.premiumRaise.rate, diagnostics)
    .toBeGreaterThanOrEqual(0.10);
  expect(metrics.hunter.buttonContinue.rate - metrics.hunter.earlyContinue.rate, diagnostics)
    .toBeGreaterThanOrEqual(0.10);
  expect(metrics['calling-station'].foldToBet.rate - metrics.rock.foldToBet.rate, diagnostics)
    .toBeLessThanOrEqual(-0.20);
  expect(metrics['calling-station'].raise.rate - metrics.hunter.raise.rate, diagnostics)
    .toBeLessThanOrEqual(-0.10);
  expect(metrics.maniac.aggressiveCount, diagnostics).toBeGreaterThanOrEqual(32);
  expect(metrics.hunter.aggressiveCount, diagnostics).toBeGreaterThanOrEqual(32);
  expect(metrics.maniac.potOrAllIn.rate - metrics.hunter.potOrAllIn.rate, diagnostics)
    .toBeGreaterThanOrEqual(0.05);
}

describe('deterministic character style benchmarks', () => {
  it('meets locked metrics on 256 preflop plus 256 postflop shared fixtures', () => {
    const winsByKey = new Map<string, number>();
    const fixtures = [...buildPreflopFixtures(winsByKey), ...buildPostflopFixtures(winsByKey)];
    expect(fixtures.filter((fixture) => fixture.phase === 'preflop')).toHaveLength(256);
    expect(fixtures.filter((fixture) => fixture.phase === 'postflop')).toHaveLength(256);
    const samples: number[] = [];
    const metrics = runBenchmark(fixtures, providerFor(winsByKey, samples), 'style-main', CHARACTER_IDS, false);
    assertLockedRankings(metrics);
    expect(samples).toHaveLength(512 * 4);
    expect(new Set(samples)).toEqual(new Set([300]));
  });

  it('keeps rankings stable with reversed fixture/character order and a holdout seed', () => {
    const winsByKey = new Map<string, number>();
    const fixtures = [...buildPreflopFixtures(winsByKey), ...buildPostflopFixtures(winsByKey)];
    const reverseOrder = [...CHARACTER_IDS].reverse();
    const reversed = runBenchmark(fixtures, providerFor(winsByKey, []), 'style-main', reverseOrder, true);
    const holdout = runBenchmark(fixtures, providerFor(winsByKey, []), 'style-holdout', reverseOrder, true);
    assertLockedRankings(reversed);
    assertLockedRankings(holdout);
  });

  it('is invariant to public IDs and hand counters with identical semantics/provider/seed', () => {
    const winsByKey = new Map<string, number>();
    const fixture = buildPreflopFixtures(winsByKey)[0]!;
    const changed: PlayerObservationV1 = {
      ...fixture.observation,
      handId: 'hand/999',
      handNumber: 999,
      decisionIndex: 888,
      seats: fixture.observation.seats.map((seat) => ({ ...seat, playerId: `renamed-${seat.seatIndex}` })),
    };
    const provider = providerFor(winsByKey, []);
    for (const characterId of CHARACTER_IDS) {
      const agent = createCharacterAgent(characterId, { equityProvider: provider });
      const originalAction = agent.decide({
        observation: fixture.observation,
        random: createSeededRandom('id-neutral', fixture.seedPath),
      }).action;
      const changedAction = agent.decide({
        observation: changed,
        random: createSeededRandom('id-neutral', fixture.seedPath),
      }).action;
      expect(changedAction).toEqual(originalAction);
    }
  });
});
