import { describe, expect, it } from 'vitest';

import { createCharacterAgent } from '../../src/agents/characters.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { AgentParticipant, type Participant } from '../../src/game/participant.js';
import { runTournament } from '../../src/game/tournament-controller.js';

const defaultConfig: TournamentConfig = {
  maxSeats: 4,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: [
    { smallBlind: 1, bigBlind: 2 },
    { smallBlind: 2, bigBlind: 4 },
    { smallBlind: 3, bigBlind: 6 },
    { smallBlind: 5, bigBlind: 10 },
    { smallBlind: 10, bigBlind: 20 },
    { smallBlind: 20, bigBlind: 40 },
    { smallBlind: 40, bigBlind: 80 },
    { smallBlind: 80, bigBlind: 160 },
  ],
  initialButtonSeat: 0,
};

describe('fixed-seed default tournament', () => {
  it('runs a human-safe seat with hunter, maniac, and calling-station to one champion', async () => {
    const human: Participant = {
      playerId: 'human',
      decide: async ({ observation }) => {
        const legal = observation.legalActions;
        if (legal.check) return { action: { type: 'check' } };
        if (legal.call !== null) return { action: { type: 'call' } };
        return { action: { type: 'fold' } };
      },
    };
    const participants: Participant[] = [
      human,
      new AgentParticipant('hunter', createCharacterAgent('hunter')),
      new AgentParticipant('maniac', createCharacterAgent('maniac')),
      new AgentParticipant('calling-station', createCharacterAgent('calling-station')),
    ];

    const state = await runTournament({
      config: defaultConfig,
      participants,
      runSeed: 'default-tournament-smoke-v1',
      invalidAgentActionMode: 'fallback',
    });

    expect(() => assertTournamentInvariants(state)).not.toThrow();
    expect(state.handNumber).toBeGreaterThan(0);
    expect(state.activeHand?.phase).toBe('game-complete');
    expect(state.seats.filter((seat) => seat.stack > 0)).toHaveLength(1);
    expect(state.eventLog.filter((event) => event.type === 'GameCompleted')).toHaveLength(1);
  }, 15_000);
});
