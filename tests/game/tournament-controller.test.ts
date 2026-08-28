import { describe, expect, it } from 'vitest';

import type { DecisionContext } from '../../src/agents/types.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { createSeededRandom } from '../../src/core/random.js';
import {
  AgentParticipant,
  ScriptedParticipant,
  type Participant,
} from '../../src/game/participant.js';
import { runTournament } from '../../src/game/tournament-controller.js';

const headsUp: TournamentConfig = {
  maxSeats: 2,
  startingStack: 2,
  handsPerLevel: 100,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};

describe('participants', () => {
  it('copies scripted actions, exhausts the copy, and forwards an agent decision', async () => {
    const source = [{ type: 'call' } as const];
    const scripted = new ScriptedParticipant('script', source);
    source.push({ type: 'check' } as never);

    await expect(scripted.decide(undefined as never)).resolves.toEqual({ action: { type: 'call' } });
    await expect(scripted.decide(undefined as never)).rejects.toThrow(/exhausted/i);

    const context = { observation: {} } as DecisionContext;
    const agent = {
      agentId: 'agent',
      decide: (received: Readonly<DecisionContext>) => {
        expect(received).toBe(context);
        return { action: { type: 'fold' } as const };
      },
    };
    await expect(new AgentParticipant('agent', agent).decide(context))
      .resolves.toEqual({ action: { type: 'fold' } });
  });
});

describe('runTournament', () => {
  it('routes the physical actor with the exact decision RNG path and reaches one champion', async () => {
    const calls: Array<{ seat: number; decision: number; seedHash: number }> = [];
    const participants: Participant[] = [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async ({ observation, random }) => {
        calls.push({
          seat: observation.actorSeatIndex,
          decision: observation.decisionIndex,
          seedHash: random.seedHash,
        });
        const legal = observation.legalActions;
        if (legal.call !== null) return { action: { type: 'call' } };
        if (legal.check) return { action: { type: 'check' } };
        return { action: { type: 'fold' } };
      },
    }));

    const state = await runTournament({
      config: headsUp,
      participants,
      runSeed: 'controller-fixture-0',
    });

    expect(calls).toEqual([{
      seat: 0,
      decision: 0,
      seedHash: createSeededRandom('controller-fixture-0', 'agent/1/0/0').seedHash,
    }]);
    expect(state.activeHand?.phase).toBe('game-complete');
    expect(state.seats.filter((seat) => seat.stack > 0)).toHaveLength(1);
    expect(state.eventLog.filter((event) => event.type === 'GameCompleted')).toHaveLength(1);
  });

  it('keeps strict failures pure and fallback emits one diagnostic without exposing private events', async () => {
    const passive: Participant = {
      playerId: 'passive',
      decide: async ({ observation }) => ({
        action: observation.legalActions.check
          ? { type: 'check' }
          : observation.legalActions.call !== null
            ? { type: 'call' }
            : { type: 'fold' },
      }),
    };
    const invalidOnce = (): Participant => {
      let first = true;
      return {
        playerId: 'invalid',
        decide: async (context) => {
          if (first) {
            first = false;
            return { action: { type: 'check' } };
          }
          return passive.decide(context);
        },
      };
    };
    const strictEvents: string[] = [];
    await expect(runTournament({
      config: headsUp,
      participants: [invalidOnce(), passive],
      runSeed: 'strict-invalid',
      onAuthorityEvents: (events) => { strictEvents.push(...events.map((event) => event.type)); },
    })).rejects.toThrow(/action|legal/i);
    expect(strictEvents).not.toContain('PlayerActed');

    const diagnostics: unknown[] = [];
    const publicTypes: string[] = [];
    const state = await runTournament({
      config: headsUp,
      participants: [invalidOnce(), passive],
      runSeed: 'fallback-invalid',
      invalidAgentActionMode: 'fallback',
      publicViewerSeatIndex: null,
      onDiagnostic: (event) => { diagnostics.push(event); },
      onPublicEvents: (events) => { publicTypes.push(...events.map((event) => event.type)); },
    });

    expect(diagnostics).toEqual([expect.objectContaining({
      type: 'AgentInvalidAction',
      playerId: 'invalid',
      seatIndex: 0,
      decisionIndex: 0,
      attemptedType: 'check',
      rejectionCode: 'action-not-legal',
      fallbackAction: 'fold',
    })]);
    expect(publicTypes).not.toContain('ownHoleCardsDealt');
    expect(publicTypes).not.toContain('DeckPrepared');
    expect(publicTypes).not.toContain('CardBurned');
    expect(state.activeHand?.phase).toBe('game-complete');
  });
});
