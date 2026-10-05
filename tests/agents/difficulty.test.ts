import { expect, it, vi } from 'vitest';
import { AI_DIFFICULTIES, AI_SAMPLES, difficultyScores, difficultySizing } from '../../src/agents/difficulty.js';
import { ParametricHoldemAgent, computePolicyScores } from '../../src/agents/parametric-agent.js';
import { CHARACTERS } from '../../src/agents/characters.js';
import { parseCard } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';
import type { PlayerObservationV1 } from '../../src/agents/types.js';
import { openLocalTable, advanceSession } from '../../src/web/table-session.js';
import { submitSessionCommand, continueAfterHandResult } from '../../src/game/game-session.js';

function observation(rivals = 1): PlayerObservationV1 {
  return { schemaVersion: 1, handId: 'test', handNumber: 1, decisionIndex: 0, actorSeatIndex: 0, street: 'river',
    holeCards: [parseCard('As'), parseCard('3c')], board: ['2d', '7c', 'Jh', 'Qs', '8h'].map(parseCard),
    buttonPosition: 0, smallBlindSeat: 0, bigBlindSeat: 1, smallBlind: 1, bigBlind: 2, potTotal: 100, sidePots: [],
    seats: Array.from({ length: rivals + 1 }, (_, seatIndex) => ({ seatIndex, playerId: `p${seatIndex}`, stack: 100,
      status: 'active', committedStreet: 0, committedHand: 0, revealedHoleCards: null })),
    legalActions: { fold: true, check: false, call: { pay: 50, to: 50, isAllIn: false }, raiseTo: { min: 100, max: 100 }, allIn: { to: 100, mode: 'fullRaise' } },
    actionHistory: [{ type: 'playerActed', seatIndex: 1, kind: 'raise', paid: 50, betTo: 50, allIn: false }] };
}
function scores(obs = observation(), equity = 0.3, bluffRoll = 0) {
  const profile = CHARACTERS.maniac.profile, odds = (obs.legalActions.call?.pay ?? 0) / (obs.potTotal + (obs.legalActions.call?.pay ?? 0));
  const original = computePolicyScores({ equity, potOdds: odds, profile, positionAdjustment: 0, drawAdjustment: 0,
    policyRoll: 0.5, bluffRoll, slowPlayRoll: 1, canAggress: true, largeCommitPenalty: 0 });
  return { original, hard: difficultyScores('challenging', original, obs, profile, equity, odds, 0, bluffRoll) };
}
it('keeps standard policy identical and validates level input', () => {
  const obs = observation(), s = scores(obs);
  expect(difficultyScores('standard', s.original, obs, CHARACTERS.hunter.profile, 0.3, 1/3, 0, 0)).toBe(s.original);
  expect(() => new ParametricHoldemAgent('bad', CHARACTERS.hunter.profile, { difficulty: 'impossible' as never })).toThrow('Invalid parametric agent options');
});
it('challenge declines a costly weak call even when the original maniac would bluff', () => {
  const { original, hard } = scores();
  expect(original.bluffTriggered).toBe(true); expect(hard.bluffTriggered).toBe(false); expect(hard.continueScore).toBeLessThan(0);
  const result = new ParametricHoldemAgent('maniac', CHARACTERS.maniac.profile, { difficulty: 'challenging',
    equityProvider: (_o, samples) => ({ equity: .3, samples, wins: samples * .3, ties: 0, losses: samples * .7 })
  }).decide({ observation: observation(), random: createSeededRandom('hard-fold') });
  expect(result.action).toEqual({ type: 'fold' });
});
it('challenge gates multiway and all-in bluffs but still value-bets strong hands', () => {
  const obs = observation(3);
  expect(scores(obs).hard.bluffProbability).toBe(0);
  expect(scores(obs, .95).hard.valueRaiseAvailable).toBe(true);
  const headsUp = observation();
  expect(scores({ ...headsUp, seats: [headsUp.seats[0]!, { ...headsUp.seats[1]!, status: 'all-in' }] }).hard.bluffProbability).toBe(0);
  const unchecked = { ...headsUp, actionHistory: [], legalActions: { ...headsUp.legalActions, call: null, check: true } };
  expect(scores(unchecked).hard.bluffProbability).toBeGreaterThan(0);
  const base = CHARACTERS.maniac.profile;
  expect(difficultySizing('challenging', base, .3).sizing.overbetFrequency).toBe(0);
  expect(difficultySizing('challenging', base, .95).sizing.preferredPotFraction).toBe(base.sizing.preferredPotFraction);
});
it.each(AI_DIFFICULTIES)('%s uses its actual sample budget and stays deterministic', level => {
  let requested = 0;
  const agent = new ParametricHoldemAgent('hunter', CHARACTERS.hunter.profile, { difficulty: level,
    equityProvider: (_o, samples) => { requested = samples; return { equity: .5, samples, wins: samples / 2, losses: samples / 2, ties: 0 }; } });
  const decide = () => agent.decide({ observation: observation(), random: createSeededRandom('same') });
  expect(decide()).toEqual(decide()); expect(requested).toBe(AI_SAMPLES[level]);
});
it.each(AI_DIFFICULTIES)('%s completes six-seat hands with conserved chips and no fallback', async difficulty => {
  const decisions = vi.spyOn(ParametricHoldemAgent.prototype, 'decide');
  try {
  const session = await openLocalTable(6, 'classic', 'free', 0, true, `difficulty-${difficulty}`, difficulty);
  let finished = 0;
  for (let step = 0; step < 100 && finished < 3; step++) {
    const packet = session.table.packet;
    if (packet.kind === 'game-result') break;
    if (packet.kind === 'hand-result') {
      expect(packet.handResult.seats.reduce((sum, s) => sum + s.finalStack, 0)).toBe(600);
      finished++;
      if (finished === 3) break;
      expect((await continueAfterHandResult(session.handle, packet.packetIndex)).accepted).toBe(true);
    } else {
      const legal = packet.observation.legalActions;
      expect((await submitSessionCommand(session.handle, { type: 'act', expectedPacketIndex: packet.packetIndex,
        decisionKey: packet.decisionKey, intent: { type: legal.check ? 'check' : legal.call ? 'call' : 'fold' } })).accepted).toBe(true);
    }
    advanceSession(session);
  }
  expect(finished).toBeGreaterThan(0);
  expect(decisions).toHaveBeenCalled();
  expect(decisions.mock.results.every(result => result.type === 'return')).toBe(true);
  } finally { decisions.mockRestore(); }
});
