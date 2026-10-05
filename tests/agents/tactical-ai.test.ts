import { describe, expect, it } from 'vitest';
import { parseCard, createStandardDeck } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';
import { estimateEquity, estimateRangeEquity } from '../../src/agents/equity.js';
import { likelihood, rangeSignals, prepareRangeDealer, type OpponentRead } from '../../src/agents/opponent-ranges.js';
import { interpretOpponent } from '../../src/agents/opponent-beliefs.js';
import { choosePlan, currentPressure, tacticalScores } from '../../src/agents/tactics.js';
import { ParametricHoldemAgent, computePolicyScores } from '../../src/agents/parametric-agent.js';
import { LivingParticipant, TableMemory } from '../../src/agents/table-memory.js';
import { CHARACTERS } from '../../src/agents/characters.js';
import type { PlayerObservationV1 } from '../../src/agents/types.js';
import type { RandomSource } from '../../src/core/types.js';

function obs(changes: Partial<PlayerObservationV1> = {}): PlayerObservationV1 {
  return { schemaVersion: 1, handId: 'hand/1', handNumber: 1, decisionIndex: 1, actorSeatIndex: 0, street: 'river',
    holeCards: [parseCard('Qh'), parseCard('Tc')], board: ['Qs', 'Jd', '8c', '3h', '2s'].map(parseCard),
    buttonPosition: 0, smallBlindSeat: 0, bigBlindSeat: 1, smallBlind: 1, bigBlind: 2, potTotal: 80, sidePots: [],
    seats: [0, 1].map(seatIndex => ({ seatIndex, playerId: 'p' + seatIndex, stack: 200, status: 'active',
      committedStreet: 0, committedHand: 0, revealedHoleCards: null })),
    actionHistory: [],
    legalActions: { fold: true, check: false, call: { pay: 40, to: 40, isAllIn: false }, raiseTo: { min: 80, max: 200 }, allIn: { to: 200, mode: 'fullRaise' } },
    ...changes };
}
function raise(street: 'preflop' | 'flop' | 'turn' | 'river', seatIndex = 1) {
  return { type: 'playerActed' as const, street, seatIndex, kind: 'raise' as const, paid: 20, betTo: 20, allIn: false };
}
const read: OpponentRead = { confidence: .8, aggression: .2, foldRate: .6, callRate: .2, bluffRate: .05 };
function rolls(bluff: number): RandomSource {
  return { algorithm: 'mulberry32-v1', seedHash: 1, nextFloat: () => .99, nextUint32: () => 1,
    fork: label => ({ ...rolls(bluff), nextFloat: () => label === 'bluff' ? bluff : .99 }) };
}
const equityProvider = (equity: number) => (_o: Readonly<PlayerObservationV1>, samples: number) => ({
  equity, samples, wins: Math.round(samples * equity), losses: samples - Math.round(samples * equity), ties: 0,
});

describe('public-information range equity', () => {
  it('keeps unobserved opponents exactly uniform and repeatable', () => {
    const o = obs();
    expect(estimateRangeEquity(o, 30, createSeededRandom('same'))).toEqual(estimateEquity(o, 30, createSeededRandom('same')));
    const pressured = obs({ actionHistory: [raise('river')] });
    expect(estimateRangeEquity(pressured, 30, createSeededRandom('same'))).toEqual(estimateRangeEquity(pressured, 30, createSeededRandom('same')));
  });
  it('discounts a marginal top pair against repeated betting, without declaring bluffs impossible', () => {
    const o = obs({ actionHistory: [raise('preflop'), raise('flop'), raise('turn'), raise('river')] });
    const uniform = estimateEquity(o, 400, createSeededRandom('range-benchmark')).equity;
    const weighted = estimateRangeEquity(o, 400, createSeededRandom('range-benchmark')).equity;
    expect(weighted).toBeLessThan(uniform - .12);
    expect(likelihood(0, 3, 0, read)).toBeGreaterThan(0);
    expect(likelihood(.9, 3, 0, read)).toBeGreaterThan(likelihood(.2, 3, 0, read));
  });
  it('uses range inference in the default NPC, changing the actual decision rather than only a debug score', () => {
    const o = obs({ actionHistory: [raise('preflop'), raise('flop'), raise('turn'), raise('river')] });
    const decide = (uniform: boolean) => new ParametricHoldemAgent('hunter', CHARACTERS.hunter.profile, {
      includePrivateTrace: true, ...(uniform ? { equityProvider: estimateEquity, tacticalContext: {} } : {}),
    }).decide({ observation: o, random: createSeededRandom('range-benchmark') });
    expect(decide(false).action.type).toBe('fold');
    expect(decide(true).action.type).toBe('raiseTo');
  });
  it('uses only the board visible at each action and ignores unlabeled legacy postflop history', () => {
    const o = obs({ actionHistory: [raise('preflop'), raise('flop')] });
    expect(rangeSignals(o, 1).map(s => s.board.length)).toEqual([0, 3]);
    const legacy = { ...raise('river'), street: undefined };
    expect(rangeSignals(obs({ actionHistory: [legacy] } as unknown as Partial<PlayerObservationV1>), 1)).toEqual([]);
    expect(currentPressure(o)).toBe(0);
    expect(currentPressure(obs({ actionHistory: [raise('river')] }))).toBe(1);
  });
  it('samples six-player non-colliding hands, including collision-exhaustion fallback', () => {
    const o = obs({ street: 'flop', board: ['Qs', 'Jd', '8c'].map(parseCard), seats: Array.from({ length: 6 }, (_, seatIndex) => ({
      ...obs().seats[0]!, seatIndex, playerId: 'p' + seatIndex })), actionHistory: [1, 2, 3, 4, 5].map(i => raise('flop', i)) });
    const known = [...o.holeCards, ...o.board].map(c => c.code);
    const dealer = prepareRangeDealer(o, createStandardDeck().filter(c => !known.includes(c.code)))!;
    for (const random of [createSeededRandom('deal'), { ...rolls(0), nextFloat: () => 0 }]) {
      const cards = dealer(random);
      expect(cards).toHaveLength(12);
      expect(new Set([...known, ...cards.map(c => c.code)]).size).toBe(17);
    }
  });
  it('never reads cast-in private authority and does not mutate the observation', () => {
    const o = obs({ actionHistory: [raise('river')] }), before = structuredClone(o);
    for (const key of ['opponentHoleCards', 'futureDeck', 'masterSeed']) Object.defineProperty(o, key, { get() { throw Error('PRIVATE'); } });
    expect(() => estimateRangeEquity(o, 10, createSeededRandom('private'))).not.toThrow();
    expect(o.actionHistory).toEqual(before.actionHistory); expect(o.seats).toEqual(before.seats);
    expect(o.holeCards).toEqual(before.holeCards);
  });
  it('still splits a board royal correctly with weighted opponent hands', () => {
    const o = obs({ holeCards: [parseCard('2c'), parseCard('3d')], board: ['As', 'Ks', 'Qs', 'Js', 'Ts'].map(parseCard), actionHistory: [raise('river')] });
    expect(estimateRangeEquity(o, 20, createSeededRandom('royal')).equity).toBe(.5);
  });
});

describe('individual interpretations and continuous intentions', () => {
  it('interprets the same public evidence differently, gains confidence, and forgets expired hands', () => {
    const memory = new TableMemory();
    for (let hand = 1; hand <= 4; hand++) { memory.observe(hand, [raise('preflop'), raise('flop')]); memory.recordShowdown(hand, 1, 'high-card'); }
    const view = (id: 'hunter' | 'maniac' | 'calling-station') => interpretOpponent(id, memory.evidence(1, 5), memory.keyEvidence(1, 5).shownHighCardAggression);
    expect(view('hunter')).not.toEqual(view('maniac')); expect(view('maniac').bluffRate).toBeGreaterThan(view('calling-station').bluffRate);
    expect(view('hunter').confidence).toBeGreaterThan(0);
    memory.observe(13, []);
    expect(view('hunter').confidence).toBe(0);
  });
  it('carries pressure on a dry round, revises on danger, and values a newly improved hand', () => {
    const dry = obs({ street: 'turn', board: ['Qs', '7d', '2c', '4h'].map(parseCard), legalActions: { ...obs().legalActions, check: true, call: null } });
    expect(choosePlan(dry, .3, 0, 'pressure')).toBe('pressure');
    expect(choosePlan({ ...dry, board: ['Qs', 'Js', '8s', '2c'].map(parseCard) }, .3, 0, 'pressure')).toBe('control');
    expect(choosePlan(dry, .85, 0, 'pressure')).toBe('value');
    expect(choosePlan(dry, .35, .1, 'pressure')).toBe('draw');
  });
  it('lets an actual bluff influence the next street, but never leaks the plan or carries it to a new hand', async () => {
    const npc = () => new LivingParticipant('hunter', new TableMemory(), () => 0, { equityProvider: equityProvider(.2) });
    const pre = obs({ street: 'preflop', board: [], legalActions: { ...obs().legalActions, check: true, call: null } });
    const flop = { ...pre, street: 'flop' as const, board: ['Qs', '7d', '2c'].map(parseCard) };
    const lan = npc();
    const first = await lan.decide({ observation: pre, random: rolls(0) });
    expect(first.action.type).toBe('raiseTo'); expect(Object.keys(first)).toEqual(['action']);
    expect((await lan.decide({ observation: flop, random: rolls(.04) })).action.type).toBe('raiseTo');
    expect((await npc().decide({ observation: flop, random: rolls(.04) })).action.type).toBe('check');
    expect((await lan.decide({ observation: { ...flop, handId: 'hand/2', handNumber: 2 }, random: rolls(.04) })).action.type).toBe('check');
  });
  it('prevents multiway/all-in bluffs and deep weak shoves while preserving value betting', () => {
    const base = obs({ legalActions: { ...obs().legalActions, check: true, call: null } });
    const make = (o: PlayerObservationV1, strength = .2) => new ParametricHoldemAgent('maniac', CHARACTERS.maniac.profile,
      { equityProvider: equityProvider(strength), tacticalContext: {} }).decide({ observation: o, random: rolls(0) }).action;
    expect(make(base).type).toBe('raiseTo'); // small heads-up bluff, not all-in
    expect(make({ ...base, seats: [...base.seats, { ...base.seats[1]!, seatIndex: 2, playerId: 'p2' }] }).type).toBe('check');
    expect(make({ ...base, seats: [base.seats[0]!, { ...base.seats[1]!, status: 'all-in' }] }).type).toBe('check');
    expect(make(base, .9).type).toBe('raiseTo');
    const onlyExpensiveRaise = { ...base, legalActions: { ...base.legalActions, raiseTo: { min: 200, max: 200 } } };
    expect(make(onlyExpensiveRaise).type).toBe('check');
    for (let seed = 0; seed < 100; seed++) {
      const action = new ParametricHoldemAgent('maniac', CHARACTERS.maniac.profile, {
        equityProvider: equityProvider(.4), tacticalContext: {},
      }).decide({ observation: base, random: createSeededRandom('sizing-' + seed) }).action;
      expect(action.type).not.toBe('allIn');
    }
  });
  it('does not check strong river hands merely to slow-play, and bluffs less against sticky readers', () => {
    const o = obs({ legalActions: { ...obs().legalActions, check: true, call: null } });
    const p = CHARACTERS.trapper.profile;
    const score = computePolicyScores({ equity: .9, potOdds: 0, profile: p, positionAdjustment: 0, drawAdjustment: 0,
      policyRoll: .5, bluffRoll: .9, slowPlayRoll: 0, canAggress: true, largeCommitPenalty: 0 });
    expect(score.slowPlayTriggered).toBe(true);
    expect(tacticalScores(score, o, p, .9, 0, .9, 'value').slowPlayTriggered).toBe(false);
    const a = tacticalScores(score, o, p, .2, 0, .9, 'pressure', { ...read, foldRate: .8 });
    const b = tacticalScores(score, o, p, .2, 0, .9, 'pressure', { ...read, foldRate: .1 });
    expect(a.bluffProbability).toBeGreaterThan(b.bluffProbability);
  });
});
