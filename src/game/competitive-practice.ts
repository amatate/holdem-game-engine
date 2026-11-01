import { arenaAgent } from '../arena/agents.js';
import { DEFAULT_TOURNAMENT_CONFIG } from './default-config.js';
import { AgentParticipant, type Participant } from './participant.js';

/** The exact v0 arena baseline, not a solver or a separate trained model. */
export const COMPETITIVE_BASELINE = 'hunter-challenge';
export const COMPETITIVE_SAMPLES = 600;
export const COMPETITIVE_CONFIG = Object.freeze({
  ...DEFAULT_TOURNAMENT_CONFIG,
  maxSeats: 2,
  startingStack: 200, // 100 BB at the initial 1/2 level; normal eight-hand blind ladder.
});

export function competitiveParticipant(playerId: string): Participant {
  return new AgentParticipant(playerId, arenaAgent(COMPETITIVE_BASELINE, COMPETITIVE_SAMPLES).create());
}
