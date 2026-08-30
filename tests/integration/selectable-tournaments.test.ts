import { describe, expect, it } from 'vitest';

import type { TournamentConfig } from '../../src/core/config.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { projectEventsForViewer, type PublicGameEvent } from '../../src/core/public-events.js';
import { replayTournament, type ReplayEnvelopeV1 } from '../../src/core/replay.js';
import {
  EVENT_SCHEMA_VERSION,
  RNG_ALGORITHM_VERSION,
  RULES_VERSION,
  SHUFFLE_ALGORITHM_VERSION,
  STRATEGY_VERSION,
} from '../../src/core/versions.js';
import type { Participant } from '../../src/game/participant.js';
import {
  createCharacterParticipant,
  selectNpcRoster,
} from '../../src/game/roster.js';
import { runTournament } from '../../src/game/tournament-controller.js';

const safeHuman: Participant = {
  playerId: 'safe-human',
  decide: async ({ observation }) => {
    const legal = observation.legalActions;
    if (legal.check) return { action: { type: 'check' } };
    if (legal.call !== null) return { action: { type: 'call' } };
    return { action: { type: 'fold' } };
  },
};

function selectableConfig(playerCount: number): TournamentConfig {
  return {
    maxSeats: playerCount,
    startingStack: 20,
    handsPerLevel: 4,
    blindLevels: [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
      { smallBlind: 4, bigBlind: 8 },
      { smallBlind: 8, bigBlind: 16 },
    ],
    initialButtonSeat: 0,
  };
}

describe('selectable-table tournaments', () => {
  it.each([2, 3, 4, 5, 6])(
    'runs the selected %i-player roster through an exact, viewer-safe tournament',
    async (playerCount) => {
      const config = selectableConfig(playerCount);
      const roster = selectNpcRoster(playerCount);
      const participants: Participant[] = [
        safeHuman,
        ...roster.map((characterId) => createCharacterParticipant(characterId, { equitySamples: 20 })),
      ];
      const runSeed = `selectable-tournament-${playerCount}`;
      const publicEvents: PublicGameEvent[] = [];

      const state = await runTournament({
        config,
        participants,
        runSeed,
        maxTransitions: 20_000,
        publicViewerSeatIndex: 0,
        onPublicEvents: (events) => { publicEvents.push(...events); },
      });

      expect(state.activeHand?.phase).toBe('game-complete');
      expect(state.seats).toHaveLength(playerCount);
      expect(state.seats.map((seat) => seat.seatIndex))
        .toEqual(Array.from({ length: playerCount }, (_, seat) => seat));
      expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0))
        .toBe(playerCount * 20);
      expect(state.seats.filter((seat) => seat.stack > 0)).toHaveLength(1);
      expect(() => assertTournamentInvariants(state)).not.toThrow();

      const envelope: ReplayEnvelopeV1 = {
        containsPrivateData: true,
        schemaVersion: EVENT_SCHEMA_VERSION,
        rulesVersion: RULES_VERSION,
        rngVersion: RNG_ALGORITHM_VERSION,
        shuffleVersion: SHUFFLE_ALGORITHM_VERSION,
        strategyVersion: STRATEGY_VERSION,
        initialConfig: config,
        seats: participants.map((participant, seatIndex) => ({
          playerId: participant.playerId,
          seatIndex,
        })),
        runSeed,
        events: state.eventLog,
      };
      expect(replayTournament(envelope)).toEqual(state);

      const projectedJson = JSON.stringify(publicEvents);
      expect(projectedJson).not.toMatch(/DeckPrepared|CardBurned|fullOrderedDeck|runSeed|dealCursor|burnedCards/);
      expect(publicEvents.every((event) => Object.isFrozen(event))).toBe(true);
      const gameStarted = publicEvents.find((event) => event.type === 'gameStarted');
      expect(gameStarted?.maxSeats).toBe(playerCount);
      expect(publicEvents).toEqual(projectEventsForViewer(state.eventLog, 0));
    },
    30_000,
  );
});
