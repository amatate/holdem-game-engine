import { CHARACTERS, type CharacterId } from '../agents/characters.js';
import { AI_SAMPLES, type AiDifficulty } from '../agents/difficulty.js';
import { ParametricHoldemAgent } from '../agents/parametric-agent.js';
import type { PokerAgent } from '../agents/types.js';
import { chooseRandomLegalAction } from '../core/simulation.js';

export const ARENA_AGENT_IDS = [
  'hunter-challenge', 'hunter-standard', 'rock', 'maniac', 'calling-station',
  'check-call', 'check-fold', 'random', 'all-in',
] as const;
export type ArenaAgentId = typeof ARENA_AGENT_IDS[number];

/** Fresh instance per match: no state or private information shared between seats. */
export interface AgentFactory {
  readonly id: string;
  readonly description: string;
  readonly equitySamples: number | null;
  create(): PokerAgent;
}

export function arenaAgent(id: string, samples?: number): AgentFactory {
  if (!(ARENA_AGENT_IDS as readonly string[]).includes(id)) throw new Error(`Unknown agent: ${id}`);
  if (samples !== undefined && (!Number.isSafeInteger(samples) || samples < 1 || samples > 10_000)) {
    throw new Error('Arena samples must be an integer from 1 to 10000');
  }
  const character: CharacterId | null = id.startsWith('hunter-') ? 'hunter'
    : id === 'rock' || id === 'maniac' || id === 'calling-station' ? id : null;
  if (character !== null) {
    const difficulty: AiDifficulty = id === 'hunter-challenge' ? 'challenging' : 'standard';
    const equitySamples = samples ?? AI_SAMPLES[difficulty];
    return {
      id, equitySamples,
      description: `${character}/${difficulty}; existing heuristic; no cross-hand memory; not a solver`,
      create: () => new ParametricHoldemAgent(`arena/${id}/v0`, CHARACTERS[character].profile,
        { difficulty, equitySamples, includePrivateTrace: false }),
    };
  }
  return {
    id, equitySamples: null, description: `Scripted ${id} baseline; not a strength reference`,
    create: () => ({
      agentId: `arena/${id}/v0`,
      decide: ({ observation, random }) => {
        const legal = observation.legalActions;
        if (id === 'random') return { action: chooseRandomLegalAction(legal, random) };
        if (id === 'all-in' && legal.allIn) return { action: { type: 'allIn' } };
        if (legal.check) return { action: { type: 'check' } };
        if (id !== 'check-fold' && legal.call) return { action: { type: 'call' } };
        return { action: { type: 'fold' } };
      },
    }),
  };
}
