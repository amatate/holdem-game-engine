import {
  ParametricHoldemAgent,
  type ParametricHoldemAgentOptions,
} from './parametric-agent.js';
import type { StyleProfile } from './types.js';

export type CharacterId = 'rock' | 'hunter' | 'maniac' | 'calling-station';

export interface CharacterDefinition {
  readonly characterId: CharacterId;
  readonly displayName: string;
  readonly nickname: string;
  readonly profile: Readonly<StyleProfile>;
}

function frozenProfile(profile: StyleProfile): Readonly<StyleProfile> {
  return Object.freeze({
    ...profile,
    sizing: Object.freeze({ ...profile.sizing }),
  });
}

function definition(
  characterId: CharacterId,
  displayName: string,
  nickname: string,
  profile: StyleProfile,
): CharacterDefinition {
  return Object.freeze({
    characterId,
    displayName,
    nickname,
    profile: frozenProfile(profile),
  });
}

export const CHARACTERS: Readonly<Record<CharacterId, CharacterDefinition>> = Object.freeze({
  rock: definition('rock', '老周', '岩石', {
    looseness: 0.15,
    aggression: 0.28,
    bluffing: 0.04,
    stickiness: 0.18,
    positionAwareness: 0.45,
    riskAppetite: 0.15,
    slowPlay: 0.20,
    variability: 0.06,
    sizing: { preferredPotFraction: 0.5, variance: 0.05, overbetFrequency: 0.01 },
  }),
  hunter: definition('hunter', '林岚', '猎手', {
    looseness: 0.30,
    aggression: 0.74,
    bluffing: 0.18,
    stickiness: 0.42,
    positionAwareness: 0.90,
    riskAppetite: 0.48,
    slowPlay: 0.28,
    variability: 0.10,
    sizing: { preferredPotFraction: 0.75, variance: 0.10, overbetFrequency: 0.06 },
  }),
  maniac: definition('maniac', '阿凯', '疯狗', {
    looseness: 0.82,
    aggression: 0.92,
    bluffing: 0.58,
    stickiness: 0.55,
    positionAwareness: 0.58,
    riskAppetite: 0.88,
    slowPlay: 0.08,
    variability: 0.28,
    sizing: { preferredPotFraction: 1, variance: 0.28, overbetFrequency: 0.30 },
  }),
  'calling-station': definition('calling-station', '莫叔', '跟注站', {
    looseness: 0.78,
    aggression: 0.16,
    bluffing: 0.03,
    stickiness: 0.94,
    positionAwareness: 0.18,
    riskAppetite: 0.52,
    slowPlay: 0.42,
    variability: 0.10,
    sizing: { preferredPotFraction: 0.5, variance: 0.08, overbetFrequency: 0 },
  }),
});

function isCharacterId(value: unknown): value is CharacterId {
  return value === 'rock' || value === 'hunter' || value === 'maniac'
    || value === 'calling-station';
}

export function createCharacterAgent(
  characterId: CharacterId,
  options?: Readonly<ParametricHoldemAgentOptions>,
): ParametricHoldemAgent {
  if (!isCharacterId(characterId)) throw new Error('Invalid character ID');
  return new ParametricHoldemAgent(characterId, CHARACTERS[characterId].profile, options);
}
