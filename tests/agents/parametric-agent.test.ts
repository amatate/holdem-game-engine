import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ParametricHoldemAgent,
  computePolicyScores,
  computePositionAdjustment,
  computeStackContext,
  computeVisibleDrawAdjustment,
  selectAggressiveCandidate,
  type EquityProvider,
} from '../../src/agents/parametric-agent.js';
import {
  CHARACTERS,
  createCharacterAgent,
  type CharacterId,
} from '../../src/agents/characters.js';
import { MAX_EQUITY_SAMPLES, type EquityEstimate } from '../../src/agents/equity.js';
import type {
  ActionDecision,
  PlayerObservationV1,
  PublicSeatState,
  StyleProfile,
} from '../../src/agents/types.js';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import { projectObservation } from '../../src/agents/observation.js';
import type { ActionIntent, LegalActionSet } from '../../src/core/legal-actions.js';
import { createSeededRandom } from '../../src/core/random.js';
import { applyIntent } from '../../src/core/reducer.js';
import type { PlayerHandStatus, Street } from '../../src/core/state.js';
import { createTournament, startHand } from '../../src/core/state.js';
import type { Card, RandomSource } from '../../src/core/types.js';
import * as publicApi from '../../src/index.js';

const EXPECTED = {
  rock: {
    characterId: 'rock', displayName: '老周', nickname: '岩石',
    profile: {
      looseness: 0.15, aggression: 0.28, bluffing: 0.04, stickiness: 0.18,
      positionAwareness: 0.45, riskAppetite: 0.15, slowPlay: 0.20, variability: 0.06,
      sizing: { preferredPotFraction: 0.5, variance: 0.05, overbetFrequency: 0.01 },
    },
  },
  hunter: {
    characterId: 'hunter', displayName: '林岚', nickname: '猎手',
    profile: {
      looseness: 0.30, aggression: 0.74, bluffing: 0.18, stickiness: 0.42,
      positionAwareness: 0.90, riskAppetite: 0.48, slowPlay: 0.28, variability: 0.10,
      sizing: { preferredPotFraction: 0.75, variance: 0.10, overbetFrequency: 0.06 },
    },
  },
  maniac: {
    characterId: 'maniac', displayName: '阿凯', nickname: '疯狗',
    profile: {
      looseness: 0.82, aggression: 0.92, bluffing: 0.58, stickiness: 0.55,
      positionAwareness: 0.58, riskAppetite: 0.88, slowPlay: 0.08, variability: 0.28,
      sizing: { preferredPotFraction: 1, variance: 0.28, overbetFrequency: 0.30 },
    },
  },
  'calling-station': {
    characterId: 'calling-station', displayName: '莫叔', nickname: '跟注站',
    profile: {
      looseness: 0.78, aggression: 0.16, bluffing: 0.03, stickiness: 0.94,
      positionAwareness: 0.18, riskAppetite: 0.52, slowPlay: 0.42, variability: 0.10,
      sizing: { preferredPotFraction: 0.5, variance: 0.08, overbetFrequency: 0 },
    },
  },
} as const satisfies Readonly<Record<CharacterId, unknown>>;

const BASE_PROFILE: StyleProfile = EXPECTED.hunter.profile;

function cards(codes: readonly string[]): Card[] {
  return codes.map((code) => parseCard(code));
}

function legalFacingBet(overrides: Partial<LegalActionSet> = {}): LegalActionSet {
  return {
    fold: true,
    check: false,
    call: { pay: 4, to: 4, isAllIn: false },
    raiseTo: { min: 8, max: 100 },
    allIn: { to: 100, mode: 'fullRaise' },
    ...overrides,
  };
}

function observation(options: Readonly<{
  actorSeatIndex?: number;
  street?: Street;
  holeCards?: readonly string[];
  board?: readonly string[];
  buttonPosition?: number;
  smallBlindSeat?: number | null;
  bigBlindSeat?: number;
  potTotal?: number;
  legalActions?: LegalActionSet;
  stacks?: readonly number[];
  committedStreet?: readonly number[];
  committedHand?: readonly number[];
  statuses?: readonly PlayerHandStatus[];
  playerIds?: readonly string[];
  handId?: string;
  handNumber?: number;
  decisionIndex?: number;
}> = {}): PlayerObservationV1 {
  const actorSeatIndex = options.actorSeatIndex ?? 3;
  const boardCodes = options.board ?? [];
  const street = options.street ?? (boardCodes.length === 0
    ? 'preflop'
    : boardCodes.length === 3 ? 'flop' : boardCodes.length === 4 ? 'turn' : 'river');
  const statuses = options.statuses ?? ['active', 'active', 'active', 'active'];
  const stacks = options.stacks ?? statuses.map((status) => status === 'eliminated' ? 0 : 100);
  const committedStreet = options.committedStreet ?? statuses.map(() => 0);
  const committedHand = options.committedHand ?? committedStreet;
  const seats: PublicSeatState[] = statuses.map((status, seatIndex) => ({
    playerId: options.playerIds?.[seatIndex] ?? `player-${seatIndex}`,
    seatIndex,
    stack: stacks[seatIndex]!,
    status,
    committedStreet: committedStreet[seatIndex]!,
    committedHand: committedHand[seatIndex]!,
    revealedHoleCards: null,
  }));
  return {
    schemaVersion: 1,
    handId: options.handId ?? 'hand/1',
    handNumber: options.handNumber ?? 1,
    decisionIndex: options.decisionIndex ?? 0,
    actorSeatIndex,
    street,
    holeCards: cards(options.holeCards ?? ['Ah', 'Kd']) as [Card, Card],
    board: cards(boardCodes),
    buttonPosition: options.buttonPosition ?? 0,
    smallBlindSeat: options.smallBlindSeat === undefined ? 1 : options.smallBlindSeat,
    bigBlindSeat: options.bigBlindSeat ?? 2,
    smallBlind: 1,
    bigBlind: 2,
    potTotal: options.potTotal ?? 12,
    sidePots: [],
    seats,
    actionHistory: [],
    legalActions: options.legalActions ?? legalFacingBet(),
  };
}

function providerFromWins(wins: number, ties = 0): EquityProvider {
  return (_observation, samples) => ({
    equity: (wins + ties / 2) / samples,
    wins,
    ties,
    losses: samples - wins - ties,
    samples,
  });
}

function withProfile(changes: Partial<Omit<StyleProfile, 'sizing'>> & {
  sizing?: Partial<StyleProfile['sizing']>;
} = {}): StyleProfile {
  return {
    ...BASE_PROFILE,
    ...changes,
    sizing: { ...BASE_PROFILE.sizing, ...changes.sizing },
  };
}

function scriptedRandom(values: Readonly<Record<string, readonly number[]>> = {}): Readonly<{
  random: RandomSource;
  labels: string[];
  calls: Record<string, number>;
  parent: { nextFloat: number; nextUint32: number };
}> {
  const labels: string[] = [];
  const calls: Record<string, number> = {};
  const parent = { nextFloat: 0, nextUint32: 0 };
  const child = (label: string): RandomSource => ({
    algorithm: 'mulberry32-v1',
    seedHash: 1,
    nextFloat: () => {
      const index = calls[label] ?? 0;
      calls[label] = index + 1;
      return values[label]?.[index] ?? 0.99;
    },
    nextUint32: () => {
      calls[`${label}:uint32`] = (calls[`${label}:uint32`] ?? 0) + 1;
      return 0;
    },
    fork: (nested) => child(`${label}/${nested}`),
  });
  const random: RandomSource = {
    algorithm: 'mulberry32-v1',
    seedHash: 7,
    nextFloat: () => { parent.nextFloat += 1; return 0.5; },
    nextUint32: () => { parent.nextUint32 += 1; return 0; },
    fork: (label) => { labels.push(label); return child(label); },
  };
  return { random, labels, calls, parent };
}

function decide(options: Readonly<{
  profile?: StyleProfile;
  observation?: PlayerObservationV1;
  equityWins?: number;
  randomValues?: Readonly<Record<string, readonly number[]>>;
  trace?: boolean;
}> = {}): Readonly<{ decision: ActionDecision; tracked: ReturnType<typeof scriptedRandom> }> {
  const tracked = scriptedRandom(options.randomValues);
  const agent = new ParametricHoldemAgent('test', options.profile ?? withProfile(), {
    equityProvider: providerFromWins(options.equityWins ?? 180),
    ...(options.trace === undefined ? {} : { includePrivateTrace: options.trace }),
  });
  const decision = agent.decide({ observation: options.observation ?? observation(), random: tracked.random });
  return { decision, tracked };
}

function expectActionLegal(action: ActionIntent, legal: LegalActionSet): void {
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

describe('parametric holdem character API', () => {
  it('publishes the four exact character definitions', () => {
    expect(CHARACTERS).toEqual(EXPECTED);
  });

  it('deep-freezes definitions, profiles, and sizing objects', () => {
    expect(Object.isFrozen(CHARACTERS)).toBe(true);
    for (const definition of Object.values(CHARACTERS)) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.profile)).toBe(true);
      expect(Object.isFrozen(definition.profile.sizing)).toBe(true);
    }
  });

  it('creates fresh non-aliased agent profile snapshots', () => {
    const first = createCharacterAgent('rock');
    const second = createCharacterAgent('rock');
    expect(first.agentId).toBe('rock');
    expect(first.profile).toEqual(CHARACTERS.rock.profile);
    expect(first.profile).not.toBe(CHARACTERS.rock.profile);
    expect(first.profile).not.toBe(second.profile);
    expect(first.profile.sizing).not.toBe(CHARACTERS.rock.profile.sizing);
    expect(Object.isFrozen(first.profile)).toBe(true);
    expect(Object.isFrozen(first.profile.sizing)).toBe(true);
  });

  it('rejects invalid runtime character IDs', () => {
    expect(() => createCharacterAgent('ghost' as CharacterId)).toThrow();
  });

  it('snapshots a caller profile instead of aliasing later mutation', () => {
    const profile = structuredClone(EXPECTED.hunter.profile) as StyleProfile;
    const agent = new ParametricHoldemAgent('copy', profile);
    (profile as { aggression: number }).aggression = 0;
    (profile.sizing as { variance: number }).variance = 1;
    expect(agent.profile).toEqual(EXPECTED.hunter.profile);
  });

  // Direct helpers are imported here so the first TDD run proves both new modules are absent.
  it('declares the locked direct helper surface', () => {
    expect([
      computePolicyScores,
      computePositionAdjustment,
      computeStackContext,
      computeVisibleDrawAdjustment,
      selectAggressiveCandidate,
    ]).toHaveLength(5);
  });

  it('root-exports only the public policy and character API, not formula helpers', () => {
    expect(publicApi.ParametricHoldemAgent).toBe(ParametricHoldemAgent);
    expect(publicApi.CHARACTERS).toBe(CHARACTERS);
    expect(publicApi.createCharacterAgent).toBe(createCharacterAgent);
    expect(publicApi).not.toHaveProperty('computePolicyScores');
    expect(publicApi).not.toHaveProperty('computePositionAdjustment');
    expect(publicApi).not.toHaveProperty('computeStackContext');
    expect(publicApi).not.toHaveProperty('computeVisibleDrawAdjustment');
    expect(publicApi).not.toHaveProperty('selectAggressiveCandidate');
  });
});

describe('constructor and provider validation', () => {
  it('rejects empty agent IDs and every invalid scalar, sizing value, and option', () => {
    expect(() => new ParametricHoldemAgent('', BASE_PROFILE)).toThrow();
    const scalarFields = [
      'looseness', 'aggression', 'bluffing', 'stickiness',
      'positionAwareness', 'riskAppetite', 'slowPlay', 'variability',
    ] as const;
    for (const field of scalarFields) {
      for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => new ParametricHoldemAgent('bad', withProfile({ [field]: value }))).toThrow();
      }
    }
    for (const preferredPotFraction of [0, 0.6, 2, Number.NaN]) {
      expect(() => new ParametricHoldemAgent('bad', withProfile({
        sizing: { preferredPotFraction: preferredPotFraction as 0.5 },
      }))).toThrow();
    }
    for (const field of ['variance', 'overbetFrequency'] as const) {
      for (const value of [-1, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => new ParametricHoldemAgent('bad', withProfile({ sizing: { [field]: value } }))).toThrow();
      }
    }
    for (const equitySamples of [0, -1, 1.5, MAX_EQUITY_SAMPLES + 1]) {
      expect(() => new ParametricHoldemAgent('bad', BASE_PROFILE, { equitySamples })).toThrow();
    }
    expect(() => new ParametricHoldemAgent('bad', BASE_PROFILE, {
      equityProvider: 42 as unknown as EquityProvider,
    })).toThrow();
    expect(() => new ParametricHoldemAgent('bad', BASE_PROFILE, {
      includePrivateTrace: 1 as unknown as boolean,
    })).toThrow();
  });

  it('uses exactly 300 samples by default and accepts a validated override', () => {
    const calls: number[] = [];
    const provider: EquityProvider = (_observation, samples) => {
      calls.push(samples);
      return { equity: 0.5, wins: samples, ties: 0, losses: 0, samples };
    };
    const first = new ParametricHoldemAgent('default', BASE_PROFILE, { equityProvider: provider });
    first.decide({ observation: observation(), random: scriptedRandom().random });
    const second = new ParametricHoldemAgent('override', BASE_PROFILE, {
      equityProvider: provider,
      equitySamples: 17,
    });
    second.decide({ observation: observation(), random: scriptedRandom().random });
    expect(calls).toEqual([300, 17]);
  });

  it('wires the real default estimator to exactly 300 samples', () => {
    const tracked = scriptedRandom();
    const river = observation({
      actorSeatIndex: 0,
      street: 'river',
      holeCards: ['As', 'Ks'],
      board: ['Qs', 'Js', 'Ts', '2d', '3c'],
      statuses: ['active', 'active'],
      stacks: [100, 100],
      committedStreet: [0, 0],
      committedHand: [0, 0],
      buttonPosition: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      potTotal: 12,
      legalActions: legalFacingBet(),
    });
    new ParametricHoldemAgent('real', BASE_PROFILE).decide({
      observation: river,
      random: tracked.random,
    });
    expect(tracked.calls['equity-sampling']).toBe(300 * 44);
  });

  it.each([
    { equity: Number.NaN, wins: 0, ties: 0, losses: 300, samples: 300 },
    { equity: -0.1, wins: 0, ties: 0, losses: 300, samples: 300 },
    { equity: 1.1, wins: 300, ties: 0, losses: 0, samples: 300 },
    { equity: 0.5, wins: -1, ties: 1, losses: 300, samples: 300 },
    { equity: 0.5, wins: 150.5, ties: 0, losses: 149.5, samples: 300 },
    { equity: 0.5, wins: 150, ties: 0, losses: 150, samples: 299 },
    { equity: 0.5, wins: 100, ties: 100, losses: 99, samples: 300 },
  ])('rejects malformed provider estimate %#', (estimate) => {
    const provider = () => estimate as EquityEstimate;
    const agent = new ParametricHoldemAgent('invalid-estimate', BASE_PROFILE, { equityProvider: provider });
    expect(() => agent.decide({ observation: observation(), random: scriptedRandom().random }))
      .toThrow(/equity estimate/i);
  });
});

describe('isolated deterministic random consumption', () => {
  it('forks in the locked order, never advances the parent, and consumes fixed policy rolls', () => {
    const { tracked } = decide();
    expect(tracked.labels).toEqual([
      'equity-sampling',
      'policy-variability',
      'bluff',
      'slow-play',
      'sizing',
    ]);
    expect(tracked.parent).toEqual({ nextFloat: 0, nextUint32: 0 });
    expect(tracked.calls['policy-variability']).toBe(1);
    expect(tracked.calls.bluff).toBe(1);
    expect(tracked.calls['slow-play']).toBe(1);
    expect(tracked.calls.sizing).toBe(2);
  });

  it('is deterministic for the same semantic observation and seed', () => {
    const agent = createCharacterAgent('maniac', { equityProvider: providerFromWins(120), includePrivateTrace: true });
    const one = agent.decide({ observation: observation(), random: createSeededRandom('same') });
    const two = agent.decide({ observation: observation(), random: createSeededRandom('same') });
    expect(one).toEqual(two);
  });

  it('isolates 1,000 extra equity draws from every action and trace component', () => {
    const baseProvider = providerFromWins(120);
    const noisyProvider: EquityProvider = (visible, samples, random) => {
      for (let index = 0; index < 1_000; index += 1) random.nextFloat();
      return baseProvider(visible, samples, random);
    };
    const options = { includePrivateTrace: true } as const;
    const quiet = new ParametricHoldemAgent('same', EXPECTED.maniac.profile, {
      ...options, equityProvider: baseProvider,
    }).decide({ observation: observation(), random: createSeededRandom('isolated') });
    const noisy = new ParametricHoldemAgent('same', EXPECTED.maniac.profile, {
      ...options, equityProvider: noisyProvider,
    }).decide({ observation: observation(), random: createSeededRandom('isolated') });
    expect(noisy).toEqual(quiet);
  });
});

describe('visible position, draw, and stack helpers', () => {
  it('applies button and early-seat adjustments only in multiway physical positions', () => {
    const multiway = observation();
    expect(computePositionAdjustment(multiway, 1)).toBe(-0.08);
    expect(computePositionAdjustment(observation({ actorSeatIndex: 0 }), 1)).toBe(0.08);
    expect(computePositionAdjustment(observation({ actorSeatIndex: 1 }), 1)).toBe(0);
    const postflopEarly = observation({
      actorSeatIndex: 1,
      street: 'flop',
      holeCards: ['Ah', 'Kd'],
      board: ['2c', '7d', '9h'],
    });
    expect(computePositionAdjustment(postflopEarly, 0.5)).toBe(-0.04);

    const headsUp = observation({
      actorSeatIndex: 0,
      statuses: ['active', 'active'],
      stacks: [100, 100],
      committedStreet: [0, 0],
      committedHand: [0, 0],
      buttonPosition: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
    });
    expect(computePositionAdjustment(headsUp, 1)).toBe(0);
    const deadButton = observation({
      actorSeatIndex: 1,
      buttonPosition: 0,
      statuses: ['eliminated', 'active', 'active', 'active'],
      stacks: [0, 100, 100, 100],
    });
    expect(computePositionAdjustment(deadButton, 1)).toBe(0);
  });

  it.each([
    [['Ah', '7h'], ['Kh', '2h', '9c'], 0.08],
    [['8c', '7d'], ['6h', '9s', 'Kc'], 0.08],
    [['8c', '7d'], ['5h', '9s', 'Kc'], 0.04],
    [['8c', '7d'], ['6h', '9s', 'Ts'], 0],
  ] as const)('scores required draw vector %j / %j', (holeCards, board, expected) => {
    expect(computeVisibleDrawAdjustment(observation({
      actorSeatIndex: 1,
      street: 'flop',
      holeCards,
      board,
    }))).toBe(expected);
  });

  it('ignores river draws, made hands, and draws entirely on the board', () => {
    expect(computeVisibleDrawAdjustment(observation({
      actorSeatIndex: 1,
      street: 'river',
      holeCards: ['Ah', '7d'],
      board: ['Kh', '2h', '9h', '3h', 'Qc'],
    }))).toBe(0);
    expect(computeVisibleDrawAdjustment(observation({
      actorSeatIndex: 1,
      street: 'turn',
      holeCards: ['Ah', '7h'],
      board: ['Kh', '2h', '9h', '3h'],
    }))).toBe(0);
    expect(computeVisibleDrawAdjustment(observation({
      actorSeatIndex: 1,
      street: 'flop',
      holeCards: ['Ac', 'Kd'],
      board: ['6h', '7s', '8c'],
    }))).toBe(0);
  });

  it('derives effective stack, SPR, and a lower-SPR commitment penalty', () => {
    const deep = observation({
      actorSeatIndex: 0,
      potTotal: 20,
      stacks: [100, 200, 60, 0],
      committedHand: [20, 20, 10, 0],
      statuses: ['active', 'active', 'all-in', 'folded'],
    });
    expect(computeStackContext(deep, 60, 0)).toEqual({
      effectiveStack: 100,
      spr: 5,
      commitFraction: 0.6,
      largeCommitPenalty: 0.019999999999999997,
    });
    const shallow = { ...deep, potTotal: 100 };
    expect(computeStackContext(shallow, 60, 0).spr).toBe(1);
    expect(computeStackContext(shallow, 60, 0).largeCommitPenalty)
      .toBe(computeStackContext(deep, 60, 0).largeCommitPenalty);
    expect(computeStackContext(deep, 100, 0).largeCommitPenalty).toBe(0.1);
    expect(computeStackContext(deep, 100, 1).largeCommitPenalty).toBe(0);
  });
});

describe('score formulas and every profile field', () => {
  const score = (profile: StyleProfile, changes: Partial<Parameters<typeof computePolicyScores>[0]> = {}) =>
    computePolicyScores({
      equity: 0.5,
      potOdds: 0.25,
      profile,
      positionAdjustment: 0,
      drawAdjustment: 0,
      policyRoll: 0.75,
      bluffRoll: 0.2,
      slowPlayRoll: 0.04,
      canAggress: true,
      largeCommitPenalty: 0.05,
      ...changes,
    });

  it('makes looseness and stickiness monotonically increase continue score', () => {
    expect(score(withProfile({ looseness: 1 })).continueScore)
      .toBeGreaterThan(score(withProfile({ looseness: 0 })).continueScore);
    expect(score(withProfile({ stickiness: 1 })).continueScore)
      .toBeGreaterThan(score(withProfile({ stickiness: 0 })).continueScore);
  });

  it('makes aggression increase natural raise score, lower threshold, and bluff chance', () => {
    const low = score(withProfile({ aggression: 0 }));
    const high = score(withProfile({ aggression: 1 }));
    expect(high.naturalRaiseScore).toBeGreaterThan(low.naturalRaiseScore);
    expect(high.raiseThreshold).toBeLessThan(low.raiseThreshold);
    expect(high.bluffProbability).toBeGreaterThan(low.bluffProbability);
  });

  it('makes bluffing alter a returned trigger and raise score under one fixed roll', () => {
    const weak = { equity: 0.2, bluffRoll: 0.05 };
    const never = score(withProfile({ aggression: 0.5, bluffing: 0 }), weak);
    const often = score(withProfile({ aggression: 0.5, bluffing: 1 }), weak);
    expect(never.bluffTriggered).toBe(false);
    expect(often.bluffTriggered).toBe(true);
    expect(often.raiseScore - often.naturalRaiseScore).toBeCloseTo(0.15);
  });

  it('uses position awareness, risk appetite, slow play, and variability in returned results', () => {
    expect(computePositionAdjustment(observation(), 1))
      .toBeLessThan(computePositionAdjustment(observation(), 0));
    expect(computeStackContext(observation(), 100, 1).largeCommitPenalty)
      .toBeLessThan(computeStackContext(observation(), 100, 0).largeCommitPenalty);
    expect(score(withProfile({ slowPlay: 0 }), { equity: 0.9 }).slowPlayTriggered).toBe(false);
    expect(score(withProfile({ slowPlay: 1 }), { equity: 0.9 }).slowPlayTriggered).toBe(true);
    expect(score(withProfile({ variability: 1 })).policyNoise)
      .toBeGreaterThan(score(withProfile({ variability: 0 })).policyNoise);
  });
});

describe('approved aggressive sizing', () => {
  it('builds the locked distinct min/half/three-quarter/pot/all-in surface', () => {
    const profile = withProfile({ sizing: { preferredPotFraction: 0.75, variance: 0, overbetFrequency: 0 } });
    const selected = selectAggressiveCandidate(observation(), profile, 0.99, 0.99);
    expect(selected).toMatchObject({ target: 16, payment: 16, sizingReason: 'three-quarter-pot' });
    expect(selected?.action).toEqual({ type: 'raiseTo', amount: 16 });
  });

  it('clamps, deduplicates, picks smaller target ties, and preserves all-in identity', () => {
    const cramped = observation({
      legalActions: legalFacingBet({
        raiseTo: { min: 18, max: 20 },
        allIn: { to: 20, mode: 'fullRaise' },
      }),
    });
    const selected = selectAggressiveCandidate(
      cramped,
      withProfile({ sizing: { preferredPotFraction: 1, variance: 0, overbetFrequency: 0 } }),
      0.99,
      0.99,
    );
    expect(selected?.target).toBe(20);
    expect(selected?.action).toEqual({ type: 'allIn' });
    expectActionLegal(selected!.action, cramped.legalActions);

    const tie = observation({ potTotal: 10, legalActions: legalFacingBet({ raiseTo: { min: 9, max: 11 }, allIn: null }) });
    expect(selectAggressiveCandidate(
      tie,
      withProfile({ sizing: { preferredPotFraction: 0.5, variance: 0, overbetFrequency: 0 } }),
      0.99,
      0.99,
    )?.target).toBe(11);
  });

  it('lets preferred fraction, variance, and overbet frequency change an actual size', () => {
    const half = selectAggressiveCandidate(observation(), withProfile({
      riskAppetite: 1,
      sizing: { preferredPotFraction: 0.5, variance: 0, overbetFrequency: 0 },
    }), 0.9, 0.9)!;
    const pot = selectAggressiveCandidate(observation(), withProfile({
      riskAppetite: 1,
      sizing: { preferredPotFraction: 1, variance: 0, overbetFrequency: 0 },
    }), 0.9, 0.9)!;
    const varied = selectAggressiveCandidate(observation(), withProfile({
      riskAppetite: 1,
      sizing: { preferredPotFraction: 0.75, variance: 1, overbetFrequency: 0 },
    }), 0.9, 0.9)!;
    const overbet = selectAggressiveCandidate(observation(), withProfile({
      riskAppetite: 1,
      sizing: { preferredPotFraction: 0.5, variance: 0, overbetFrequency: 1 },
    }), 0.9, 0)!;
    expect(half.target).toBe(12);
    expect(pot.target).toBe(20);
    expect(varied.target).toBe(20);
    expect(overbet.target).toBe(100);
  });

  it('chooses lower then higher adjacent targets from the normalized variance roll', () => {
    const profile = withProfile({ sizing: { preferredPotFraction: 0.75, variance: 1, overbetFrequency: 0 } });
    expect(selectAggressiveCandidate(observation(), profile, 0.25, 1)?.target).toBe(12);
    expect(selectAggressiveCandidate(observation(), profile, 0.75, 1)?.target).toBe(20);
  });
});

describe('decision priority and exact legal postcondition', () => {
  it('covers full value raise, forced bluff, fold, call, and check branches', () => {
    const value = decide({ equityWins: 210 }).decision.action;
    expect(['raiseTo', 'allIn']).toContain(value.type);

    const bluff = decide({
      equityWins: 15,
      profile: withProfile({ aggression: 0.5, bluffing: 1, looseness: 0, stickiness: 0 }),
      randomValues: { bluff: [0], 'slow-play': [1], sizing: [1, 1] },
    }).decision.action;
    expect(['raiseTo', 'allIn']).toContain(bluff.type);

    const fold = decide({
      equityWins: 0,
      profile: withProfile({ bluffing: 0, looseness: 0, stickiness: 0 }),
    }).decision.action;
    expect(fold).toEqual({ type: 'fold' });

    const noAggression = legalFacingBet({ raiseTo: null, allIn: null });
    const call = decide({
      equityWins: 180,
      observation: observation({ legalActions: noAggression }),
    }).decision.action;
    expect(call).toEqual({ type: 'call' });

    const checkLegal: LegalActionSet = {
      fold: false, check: true, call: null, raiseTo: null, allIn: null,
    };
    const check = decide({
      equityWins: 120,
      observation: observation({ legalActions: checkLegal }),
    }).decision.action;
    expect(check).toEqual({ type: 'check' });
  });

  it.each(['shortBet', 'shortRaise'] as const)('uses legal aggressive %s all-in without raiseTo', (mode) => {
    const legal: LegalActionSet = {
      fold: mode === 'shortRaise',
      check: mode === 'shortBet',
      call: mode === 'shortRaise' ? { pay: 4, to: 4, isAllIn: false } : null,
      raiseTo: null,
      allIn: { to: 6, mode },
    };
    const action = decide({
      equityWins: 240,
      observation: observation({ legalActions: legal, stacks: [100, 100, 100, 6] }),
    }).decision.action;
    expect(action).toEqual({ type: 'allIn' });
  });

  it('normalizes call-mode all-in to call and never treats it as aggression', () => {
    const legal: LegalActionSet = {
      fold: true,
      check: false,
      call: { pay: 3, to: 3, isAllIn: true },
      raiseTo: null,
      allIn: { to: 3, mode: 'call' },
    };
    expect(decide({
      equityWins: 240,
      observation: observation({ legalActions: legal, stacks: [100, 100, 100, 3] }),
    }).decision.action).toEqual({ type: 'call' });
  });

  it('honors no-reopen and no-funded-responder surfaces without inventing a raise', () => {
    for (const legalActions of [
      legalFacingBet({ raiseTo: null, allIn: null }),
      { fold: false, check: true, call: null, raiseTo: null, allIn: null } as LegalActionSet,
    ]) {
      const action = decide({ equityWins: 300, observation: observation({ legalActions }) }).decision.action;
      expect(['call', 'check']).toContain(action.type);
      expectActionLegal(action, legalActions);
    }
  });

  it('slow-plays a strong value hand by calling or checking before the raise branch', () => {
    const profile = withProfile({ slowPlay: 1 });
    const facing = decide({
      profile,
      equityWins: 270,
      trace: true,
      randomValues: { 'slow-play': [0], sizing: [1, 1] },
    }).decision;
    expect(facing.action).toEqual({ type: 'call' });
    expect(facing.privateTrace?.intent).toBe('trap');
    const checked = decide({
      profile,
      equityWins: 270,
      trace: true,
      observation: observation({
        legalActions: {
          fold: false, check: true, call: null,
          raiseTo: { min: 4, max: 100 }, allIn: { to: 100, mode: 'fullBet' },
        },
      }),
      randomValues: { 'slow-play': [0], sizing: [1, 1] },
    }).decision;
    expect(checked.action).toEqual({ type: 'check' });
    expect(checked.privateTrace?.intent).toBe('trap');
  });

  it('rejects an empty legal set and never silently rewrites an illegal output', () => {
    const empty: LegalActionSet = {
      fold: false, check: false, call: null, raiseTo: null, allIn: null,
    };
    expect(() => decide({ observation: observation({ legalActions: empty }) })).toThrow(/legal/i);
  });

  it('accepts decisions through a real projectObservation -> decide -> applyIntent path', () => {
    const config = {
      maxSeats: 4,
      startingStack: 100,
      handsPerLevel: 8,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
      initialButtonSeat: 0,
    } as const;
    const created = createTournament(config, Array.from({ length: 4 }, (_, seatIndex) => ({
      playerId: `player-${seatIndex}`,
      seatIndex,
    })), 'agent-integration').state;
    const authority = startHand(created, { fixedDeck: createStandardDeck() }).state;
    const visible = projectObservation(authority, 3);
    const decision = new ParametricHoldemAgent('integration', BASE_PROFILE, {
      equityProvider: providerFromWins(150),
    }).decide({ observation: visible, random: createSeededRandom('agent-integration') });
    expectActionLegal(decision.action, visible.legalActions);
    expect(applyIntent(authority, 3, decision.action).accepted).toBe(true);
  });
});

describe('private trace and input isolation', () => {
  it('defaults to exactly { action } and opt-in adds only the five approved fields', () => {
    const without = decide({ equityWins: 120 }).decision;
    const withTrace = decide({ equityWins: 120, trace: true }).decision;
    expect(Object.keys(without)).toEqual(['action']);
    expect(Object.keys(withTrace).sort()).toEqual(['action', 'privateTrace']);
    expect(Object.keys(withTrace.privateTrace!).sort()).toEqual([
      'equityBand', 'intent', 'positionAdjustment', 'potOddsBand', 'sizingReason',
    ]);
    expect(JSON.stringify(withTrace.privateTrace)).not.toMatch(
      /exact|score|roll|card|player|profile|seed|state|equity\"\s*:/i,
    );
  });

  it('keeps action and random consumption identical when trace is toggled', () => {
    const off = decide({ equityWins: 120, trace: false });
    const on = decide({ equityWins: 120, trace: true });
    expect(on.decision.action).toEqual(off.decision.action);
    expect(on.tracked.labels).toEqual(off.tracked.labels);
    expect(on.tracked.calls).toEqual(off.tracked.calls);
  });

  it('assigns exact bands, intent precedence, and sizing reason from the actual action', () => {
    const bluff = decide({
      equityWins: 30,
      trace: true,
      profile: withProfile({ aggression: 0.5, bluffing: 1, looseness: 0, stickiness: 0 }),
      randomValues: { bluff: [0], 'slow-play': [1], sizing: [1, 1] },
    }).decision.privateTrace!;
    expect(bluff.intent).toBe('bluff');
    expect(bluff.equityBand).toBe('low');
    expect(bluff.potOddsBand).toBe('medium');
    expect(bluff.sizingReason).not.toBe('none');

    const drawn = decide({
      equityWins: 180,
      trace: true,
      observation: observation({
        actorSeatIndex: 1,
        street: 'flop',
        holeCards: ['Ah', '7h'],
        board: ['Kh', '2h', '9c'],
      }),
    }).decision.privateTrace!;
    expect(['semiBluff', 'draw']).toContain(drawn.intent);
  });

  it('does not mutate observation, profile, sizing, or supplied RNG objects', () => {
    const visible = observation();
    const profile = structuredClone(EXPECTED.hunter.profile) as StyleProfile;
    const tracked = scriptedRandom();
    const visibleBefore = structuredClone(visible);
    const profileBefore = structuredClone(profile);
    const randomKeys = Reflect.ownKeys(tracked.random);
    new ParametricHoldemAgent('pure', profile, { equityProvider: providerFromWins(150) })
      .decide({ observation: visible, random: tracked.random });
    expect(visible).toEqual(visibleBefore);
    expect(profile).toEqual(profileBefore);
    expect(Reflect.ownKeys(tracked.random)).toEqual(randomKeys);
    expect(Object.isFrozen(tracked.random)).toBe(false);
  });

  it('ignores public IDs/counters and never reads hidden or irrelevant getters', () => {
    const base = observation();
    const poison = () => { throw new Error('HIDDEN-SEED-SENTINEL'); };
    const seats = base.seats.map((seat) => {
      const safe = { ...seat } as Record<string, unknown>;
      Object.defineProperty(safe, 'playerId', { enumerable: true, get: poison });
      Object.defineProperty(safe, 'revealedHoleCards', { enumerable: true, get: poison });
      return safe as unknown as PublicSeatState;
    });
    const guarded = { ...base, seats } as PlayerObservationV1;
    Object.defineProperty(guarded, 'handId', { enumerable: true, get: poison });
    Object.defineProperty(guarded, 'handNumber', { enumerable: true, get: poison });
    Object.defineProperty(guarded, 'decisionIndex', { enumerable: true, get: poison });
    Object.defineProperty(guarded, 'actionHistory', { enumerable: true, get: poison });
    Object.defineProperty(guarded, 'sidePots', { enumerable: true, get: poison });
    expect(() => new ParametricHoldemAgent('guard', BASE_PROFILE, {
      equityProvider: providerFromWins(150),
    }).decide({ observation: guarded, random: createSeededRandom('guard') })).not.toThrow();

    const renamed = observation({
      playerIds: ['x', 'y', 'z', 'w'], handId: 'hand/999', handNumber: 999, decisionIndex: 999,
    });
    const agent = createCharacterAgent('hunter', { equityProvider: providerFromWins(150) });
    expect(agent.decide({ observation: renamed, random: createSeededRandom('ids') }))
      .toEqual(agent.decide({ observation: base, random: createSeededRandom('ids') }));
  });

  it('contains no forbidden authority imports or ambient random/time APIs', () => {
    const source = readFileSync(new URL('../../src/agents/parametric-agent.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/TournamentState|HandState|DeckPrepared|burnedCards|runSeed/);
    expect(source).not.toMatch(/Math\.random|Date\.now|node:|process\.|Buffer/);
  });
});
