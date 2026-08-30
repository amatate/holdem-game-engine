import {
  CHARACTERS,
  createCharacterAgent,
  type CharacterId,
} from '../agents/characters.js';
import type { ParametricHoldemAgentOptions } from '../agents/parametric-agent.js';
import { AgentParticipant, type Participant } from './participant.js';

const AUTO_ROSTERS: Readonly<Record<2 | 3 | 4 | 5 | 6, readonly CharacterId[]>>
  = Object.freeze({
    2: Object.freeze(['hunter'] as const),
    3: Object.freeze(['small-ball', 'calling-station'] as const),
    4: Object.freeze(['hunter', 'maniac', 'calling-station'] as const),
    5: Object.freeze(['rock', 'hunter', 'small-ball', 'value-bettor'] as const),
    6: Object.freeze(['rock', 'hunter', 'maniac', 'trapper', 'value-bettor'] as const),
  });

type SupportedPlayerCount = keyof typeof AUTO_ROSTERS;

function requirePlayerCount(value: number): SupportedPlayerCount {
  if (!Number.isSafeInteger(value) || value < 2 || value > 6) {
    throw new Error('playerCount must be a safe integer from 2 through 6');
  }
  return value as SupportedPlayerCount;
}

export function selectNpcRoster(playerCount: number): readonly CharacterId[] {
  return Object.freeze([...AUTO_ROSTERS[requirePlayerCount(playerCount)]]);
}

export function createCharacterParticipant(
  characterId: CharacterId,
  options?: Readonly<ParametricHoldemAgentOptions>,
): Participant {
  const definition = CHARACTERS[characterId];
  if (definition === undefined) throw new Error('Invalid character ID');
  return new AgentParticipant(
    `${definition.displayName}“${definition.nickname}”`,
    createCharacterAgent(characterId, options),
  );
}
