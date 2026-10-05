import { describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../src/agents/characters.js';
import { ParametricHoldemAgent, type EquityProvider } from '../../src/agents/parametric-agent.js';
import { LivingParticipant, TableMemory } from '../../src/agents/table-memory.js';
import { personaProfile, pressuredBoard } from '../../src/agents/persona-policy.js';
import type { PlayerObservationV1 } from '../../src/agents/types.js';
import { parseCard } from '../../src/core/cards.js';
import type { RandomSource } from '../../src/core/types.js';
import type { PublicActionEvent } from '../../src/core/public-events.js';

function observation(changes: Partial<PlayerObservationV1> = {}): PlayerObservationV1 {
  return { schemaVersion: 1, handId: 'hand-1', handNumber: 1, decisionIndex: 0, actorSeatIndex: 1, street: 'preflop',
    holeCards: [parseCard('Ah'), parseCard('Kd')], board: [], buttonPosition: 0, smallBlindSeat: 0, bigBlindSeat: 1,
    smallBlind: 1, bigBlind: 2, potTotal: 30, sidePots: [], actionHistory: [],
    seats: [0, 1].map((seatIndex) => ({ seatIndex, playerId: `p${seatIndex}`, stack: 100, status: 'active',
      committedHand: 0, committedStreet: 0, revealedHoleCards: null })),
    legalActions: { fold: false, check: true, call: null, raiseTo: { min: 2, max: 100 }, allIn: { to: 100, mode: 'fullRaise' } }, ...changes };
}

function random(sizingRoll = 0.99): RandomSource {
  return { algorithm: 'mulberry32-v1', seedHash: 1, nextFloat: () => 0.99, nextUint32: () => 0,
    fork: (label) => { let index = 0; const rng = random(sizingRoll); return { ...rng, nextFloat: () => label === 'sizing' && index++ > 0 ? sizingRoll : 0.99 }; } };
}
const provider = (equity: number): EquityProvider => (_o, samples) => ({ equity, samples,
  wins: Math.round(equity * samples), losses: samples - Math.round(equity * samples), ties: 0 });
const raise: PublicActionEvent = { type: 'playerActed', seatIndex: 0, kind: 'raise', paid: 10, betTo: 10, allIn: false };
const empty = new TableMemory().evidence(0);
const neutral = { plan: 'none' as const, evidence: empty, pressureHands: 0, shownHighCardAggression: 0, outcome: null };

describe('living-table v2 character policies', () => {
  it('makes Mo call an affordable price but fold a marginal hand to a large one, unlike his old profile', async () => {
    const options = { equityProvider: provider(0.30) };
    const large = observation({ potTotal: 60, legalActions: { fold: true, check: false, call: { pay: 40, to: 40, isAllIn: false },
      raiseTo: { min: 80, max: 100 }, allIn: { to: 100, mode: 'fullRaise' } } });
    expect(new ParametricHoldemAgent('old-mo', CHARACTERS['calling-station'].profile, options).decide({ observation: large, random: random() }).action.type).toBe('call');
    expect((await new LivingParticipant('calling-station', new TableMemory(), () => 0, options).decide({ observation: large, random: random() })).action.type).toBe('fold');
    const small = observation({ potTotal: 50, legalActions: { ...large.legalActions, call: { pay: 4, to: 4, isAllIn: false }, raiseTo: { min: 8, max: 100 } } });
    expect((await new LivingParticipant('calling-station', new TableMemory(), () => 0, options).decide({ observation: small, random: random() })).action.type).toBe('call');
    const strong = new LivingParticipant('calling-station', new TableMemory(), () => 0, { equityProvider: provider(0.90) });
    expect((await strong.decide({ observation: large, random: random() })).action.type).not.toBe('fold');
  });

  it('carries Lan’s initiative to a dry flop, controls a pressured board, and resets between hands', async () => {
    const options = { equityProvider: ((o, n, r) => provider(o.street === 'preflop' ? 0.8 : 0.46)(o, n, r)) as EquityProvider };
    const dry = observation({ street: 'flop', board: ['2c', '7d', '9s'].map(parseCard) });
    const wet = observation({ street: 'flop', board: ['2c', '7c', '9c'].map(parseCard) });
    const make = () => new LivingParticipant('hunter', new TableMemory(), () => 0, options);
    expect((await make().decide({ observation: dry, random: random() })).action.type).toBe('check');
    const lan = make();
    expect((await lan.decide({ observation: observation(), random: random() })).action.type).toBe('raiseTo');
    expect((await lan.decide({ observation: dry, random: random() })).action.type).toBe('raiseTo');
    const cautious = make();
    await cautious.decide({ observation: observation(), random: random() });
    expect((await cautious.decide({ observation: wet, random: random() })).action.type).toBe('check');
    expect((await cautious.decide({ observation: { ...wet, decisionIndex: 2 }, random: random() })).action.type).toBe('check');
    expect((await lan.decide({ observation: { ...dry, handId: 'hand-2', handNumber: 2 }, random: random() })).action.type).toBe('check');
    expect(pressuredBoard({ board: ['As', '2c', '3d', '4h'].map(parseCard) })).toBe(true);
  });

  it('lets Kai’s loss change the actual bet size and completely expires the reaction on the fourth hand', async () => {
    const memory = new TableMemory(); memory.observe(1, [raise]); memory.recordOutcome(1, 1, -40, 2);
    // Tilt still changes strong-hand sizing; weak hands no longer randomly jam deep stacks.
    const options = { equityProvider: provider(0.76) };
    const act = async (hand: number, shared: TableMemory) => (await new LivingParticipant('maniac', shared, () => -1, options)
      .decide({ observation: observation({ handId: `hand-${hand}`, handNumber: hand }), random: random(0.3) })).action;
    expect((await act(2, new TableMemory())).type).toBe('raiseTo');
    expect((await act(2, memory)).type).toBe('allIn');
    expect(await act(5, memory)).toEqual(await act(5, new TableMemory()));
    const values = [2, 3, 4, 5].map((handNumber) => personaProfile('maniac', CHARACTERS.maniac.profile,
      observation({ handNumber }), { ...neutral, outcome: memory.lastSignificantOutcome(1, handNumber) }).sizing.overbetFrequency);
    expect(values).toEqual([0.48, 0.39, 0.345, 0.30]);
    const smallLoss = personaProfile('maniac', CHARACTERS.maniac.profile, observation({ handNumber: 2 }),
      { ...neutral, outcome: { hand: 1, net: -19, bigBlind: 2 } });
    expect(smallLoss).toEqual(CHARACTERS.maniac.profile);
  });

  it('uses only completed public evidence, keeps returns immutable and expires old records', () => {
    const memory = new TableMemory();
    for (let hand = 1; hand <= 3; hand++) {
      memory.observe(hand, [raise, raise]); memory.recordShowdown(hand, 0, 'high-card');
      memory.recordOutcome(hand, 1, -40, 2);
    }
    expect(memory.keyEvidence(0, 3)).toEqual({ pressureHands: 2, shownHighCardAggression: 2 });
    expect(memory.keyEvidence(1, 4)).toEqual({ pressureHands: 0, shownHighCardAggression: 0 });
    memory.recordOutcome(3, 1, 999, 2); memory.recordShowdown(3, 0, 'straight');
    const copy = memory.lastSignificantOutcome(1, 4)!; copy.net = 0;
    expect(memory.lastSignificantOutcome(1, 4)?.net).toBe(-40);
    const base = CHARACTERS.hunter.profile;
    const enhanced = personaProfile('hunter', base, observation(), { ...neutral, evidence: memory.evidence(0), ...memory.keyEvidence(0, 4) });
    expect(enhanced.stickiness).toBeGreaterThan(base.stickiness);
    expect(personaProfile('hunter', base, observation(), { ...neutral, evidence: memory.evidence(0, 3), ...memory.keyEvidence(0, 3) })).toEqual(base);
    memory.observe(11, []);
    expect(memory.keyEvidence(0, 12)).toEqual({ pressureHands: 0, shownHighCardAggression: 0 });
    expect(memory.lastSignificantOutcome(1, 12)).toBeNull();
  });

  it('wires key memories into the participant without exporting a private plan or trace', async () => {
    const memory = new TableMemory();
    for (let hand = 1; hand <= 3; hand++) memory.observe(hand, [raise, raise]);
    const spy = vi.spyOn(ParametricHoldemAgent.prototype, 'decide');
    try {
      const npc = new LivingParticipant('hunter', memory, () => 0, { equityProvider: provider(0.35) });
      const result = await npc.decide({ observation: observation({ handNumber: 4 }), random: random() });
      expect((spy.mock.contexts[0] as ParametricHoldemAgent).profile.stickiness).toBeGreaterThan(0.55);
      expect(Object.keys(result)).toEqual(['action']);
    } finally { spy.mockRestore(); }
  });
});
