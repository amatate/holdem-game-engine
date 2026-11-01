import { describe, expect, it } from 'vitest';
import { projectObservation } from '../../../src/agents/observation.js';
import { createSeededRandom } from '../../../src/core/random.js';
import { createTournament, startHand } from '../../../src/core/state.js';
import { advanceAutomaticPhases, applyIntent } from '../../../src/core/reducer.js';
import { chooseRandomLegalAction } from '../../../src/core/simulation.js';
import { observationFromTurn } from '../../../src/arena/chipzen/adapter.js';

describe('offline engine → documented ChipZen wire → agent observation parity', () => {
  it('preserves public cards, money, positions and street-labelled actions across 100 random hands', () => {
    let decisions = 0;
    for (let hand = 0; hand < 100; hand++) {
      const random = createSeededRandom(`adapter-parity-${hand}`);
      let state = startHand(createTournament({ maxSeats: 2, startingStack: 200, initialButtonSeat: hand % 2,
        handsPerLevel: 10, blindLevels: [{ smallBlind: 1, bigBlind: 2 }] },
      [{ playerId: 'p0', seatIndex: 0 }, { playerId: 'p1', seatIndex: 1 }], `parity-deck-${hand}`).state).state;
      for (let step = 0; step < 100; step++) {
        state = advanceAutomaticPhases(state).state;
        if (state.activeHand!.phase === 'hand-complete') break;
        const actor = state.activeHand!.currentActorSeat!, o = projectObservation(state, actor), legal = o.legalActions;
        const bounds = legal.raiseTo ?? (legal.allIn && legal.allIn.mode !== 'call' ? { min: legal.allIn.to, max: legal.allIn.to } : null);
        const valid = [legal.check && 'check', legal.fold && 'fold', legal.call && 'call', bounds && 'raise'].filter(Boolean);
        const frame = { type: 'turn_request', match_id: 'parity', request_id: `r${step}`, seat: actor, valid_actions: valid,
          state: { hand_number: 1, phase: o.street, board: o.board.map(c => c.code), your_hole_cards: o.holeCards.map(c => c.code),
            your_stack: o.seats[actor]!.stack, opponent_stacks: [o.seats[1 - actor]!.stack], pot: o.potTotal,
            to_call: Math.max(...o.seats.map(s => s.committedStreet)) - o.seats[actor]!.committedStreet,
            min_raise: bounds?.min ?? 0, max_raise: bounds?.max ?? 0,
            action_history: o.actionHistory.map(a => a.type === 'blindPosted'
              ? { seat: a.seatIndex, action: a.kind === 'small' ? 'post_small_blind' : 'post_big_blind', amount: a.amount, phase: 'preflop' }
              : { seat: a.seatIndex, action: a.kind === 'bet' ? 'raise' : a.kind,
                amount: a.kind === 'raise' || a.kind === 'bet' ? a.betTo : a.paid, phase: a.street }),
          } };
        const mapped = observationFromTurn(frame, { matchId: 'parity', heroSeat: actor, smallBlind: 1, bigBlind: 2 });
        expect(mapped.seats.map(s => [s.stack, s.committedHand, s.committedStreet, s.status]))
          .toEqual(o.seats.map(s => [s.stack, s.committedHand, s.committedStreet, s.status]));
        expect(mapped.board).toEqual(o.board); expect(mapped.holeCards).toEqual(o.holeCards);
        expect(mapped.buttonPosition).toBe(o.buttonPosition); expect(mapped.legalActions.call).toEqual(legal.call);
        expect(mapped.actionHistory.filter(a => a.type === 'playerActed')).toEqual(o.actionHistory.filter(a => a.type === 'playerActed'));
        decisions++;
        const applied = applyIntent(state, actor, chooseRandomLegalAction(legal, random));
        if (!applied.accepted) throw new Error('Random action rejected');
        state = applied.state;
      }
      expect(state.activeHand!.phase).toBe('hand-complete');
    }
    expect(decisions).toBeGreaterThan(200);
  });
});
