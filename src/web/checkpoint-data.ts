import type { SessionCommand, SessionMode } from '../game/session-types.js';
import { isAiDifficulty, type AiDifficulty } from '../agents/difficulty.js';
import type { SaveSummary, TableExperience } from './protocol.js';
import { isNightAbility, type NightAbility } from '../game/first-night.js';

export const MAX_COMMANDS = 10_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export interface TableSetup {
  players: number; mode: SessionMode; experience: TableExperience;
  lesson: number; socialEnabled: boolean; runSeed: string;
  storyEdition?: 2;
  difficulty?: AiDifficulty;
  nightAbility?: NightAbility | null;
}
export type JournalEntry =
  | { type: 'command'; command: SessionCommand }
  | { type: 'continue'; packetIndex: number }
  | { type: 'reply'; promptId: string; choice: string; revision: number }
  | { type: 'answer'; answer: string }
  | { type: 'chapter' | 'second-night'; choice: string; revision: number }
  | { type: 'story'; input: import('../game/story-campaign.js').StoryInput };
export interface Checkpoint {
  format: 1; engine: string; setup: TableSetup; journal: JournalEntry[];
  digest: string; summary: SaveSummary;
}
export interface CheckpointStore {
  read(token: string): Promise<Checkpoint | null>;
  write(token: string, checkpoint: Checkpoint): Promise<void>;
}


export function validCheckpoint(value: unknown): value is Checkpoint {
  if (!value || typeof value !== 'object') return false;
  const record = value as Checkpoint;
  const setup = record.setup;
  const summary = record.summary;
  return record.format === 1 && typeof record.engine === 'string' && /^[a-f0-9]{64}$/.test(record.digest)
    && !!setup && Number.isInteger(setup.players) && setup.players >= 2 && setup.players <= 6
    && ['classic', 'ability-lab'].includes(setup.mode) && ['free', 'living', 'tutorial', 'competitive', 'first-night', 'second-night'].includes(setup.experience)
    && (setup.experience !== 'second-night' || (setup.players === 2 && setup.lesson === 0 && setup.socialEnabled === true && setup.mode === 'classic'))
    && (setup.experience !== 'first-night' || (setup.players === 2 && setup.lesson === 0 && setup.socialEnabled === true
      && (setup.mode === 'classic' ? setup.nightAbility === null : isNightAbility(setup.nightAbility))))
    && (setup.experience !== 'competitive' || (setup.players === 2 && setup.mode === 'classic'
      && setup.difficulty === 'challenging' && setup.socialEnabled === false && setup.lesson === 0))
    && (setup.storyEdition===undefined || setup.storyEdition===2&&setup.experience==='second-night')
    && Number.isInteger(setup.lesson) && setup.lesson >= 0 && setup.lesson <= 2
    && typeof setup.socialEnabled === 'boolean' && typeof setup.runSeed === 'string' && setup.runSeed.length <= 128
    && (setup.difficulty === undefined || isAiDifficulty(setup.difficulty))
    && Array.isArray(record.journal) && record.journal.length <= MAX_COMMANDS
    && !!summary && typeof summary.id === 'string' && typeof summary.savedAt === 'string'
    && Number.isFinite(Date.parse(summary.savedAt)) && Number.isSafeInteger(summary.hand) && summary.hand > 0
    && Number.isSafeInteger(summary.heroStack) && summary.heroStack >= 0 && typeof summary.ended === 'boolean'
    && (summary.wallet===undefined || Number.isSafeInteger(summary.wallet)&&summary.wallet>=0)
    && (summary.storyNight===undefined || Number.isInteger(summary.storyNight)&&summary.storyNight>=1&&summary.storyNight<=6)
    && summary.players === setup.players && summary.mode === setup.mode && summary.experience === setup.experience
    && summary.lesson === (setup.experience === 'tutorial' ? setup.lesson : null);
}
