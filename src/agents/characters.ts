import {
  ParametricHoldemAgent,
  type ParametricHoldemAgentOptions,
} from './parametric-agent.js';
import type { StyleProfile } from './types.js';

export const CHARACTER_IDS = Object.freeze([
  'rock',
  'hunter',
  'maniac',
  'calling-station',
  'small-ball',
  'trapper',
  'value-bettor',
] as const);

export type CharacterId = (typeof CHARACTER_IDS)[number];

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
  'small-ball': definition('small-ball', '程墨', '小刀', {
    looseness: 0.48,
    aggression: 0.62,
    bluffing: 0.38,
    stickiness: 0.40,
    positionAwareness: 0.82,
    riskAppetite: 0.32,
    slowPlay: 0.16,
    variability: 0.14,
    sizing: { preferredPotFraction: 0.5, variance: 0.12, overbetFrequency: 0.03 },
  }),
  trapper: definition('trapper', '苏蔓', '伏蛇', {
    looseness: 0.30,
    aggression: 0.42,
    bluffing: 0.06,
    stickiness: 0.58,
    positionAwareness: 0.50,
    riskAppetite: 0.36,
    slowPlay: 0.86,
    variability: 0.05,
    sizing: { preferredPotFraction: 0.5, variance: 0.04, overbetFrequency: 0.02 },
  }),
  'value-bettor': definition('value-bettor', '韩烈', '重锤', {
    looseness: 0.26,
    aggression: 0.80,
    bluffing: 0.07,
    stickiness: 0.46,
    positionAwareness: 0.38,
    riskAppetite: 0.62,
    slowPlay: 0.10,
    variability: 0.08,
    sizing: { preferredPotFraction: 1, variance: 0.08, overbetFrequency: 0.12 },
  }),
});

function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string'
    && CHARACTER_IDS.includes(value as CharacterId);
}

export function createCharacterAgent(
  characterId: CharacterId,
  options?: Readonly<ParametricHoldemAgentOptions>,
): ParametricHoldemAgent {
  if (!isCharacterId(characterId)) throw new Error('Invalid character ID');
  return new ParametricHoldemAgent(characterId, CHARACTERS[characterId].profile, options);
}
