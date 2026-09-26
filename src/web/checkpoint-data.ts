import type { SessionCommand, SessionMode } from '../game/session-types.js';
import type { SaveSummary, TableExperience } from './protocol.js';

export const MAX_COMMANDS = 1_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export interface TableSetup {
  players: number; mode: SessionMode; experience: TableExperience;
  lesson: number; socialEnabled: boolean; runSeed: string;
}
export type JournalEntry =
  | { type: 'command'; command: SessionCommand }
  | { type: 'continue'; packetIndex: number }
  | { type: 'reply'; promptId: string; choice: string; revision: number }
  | { type: 'answer'; answer: string };
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
    && ['classic', 'ability-lab'].includes(setup.mode) && ['free', 'living', 'tutorial'].includes(setup.experience)
    && Number.isInteger(setup.lesson) && setup.lesson >= 0 && setup.lesson <= 2
    && typeof setup.socialEnabled === 'boolean' && typeof setup.runSeed === 'string' && setup.runSeed.length <= 128
    && Array.isArray(record.journal) && record.journal.length <= MAX_COMMANDS
    && !!summary && typeof summary.id === 'string' && typeof summary.savedAt === 'string'
    && Number.isFinite(Date.parse(summary.savedAt)) && Number.isSafeInteger(summary.hand) && summary.hand > 0
    && Number.isSafeInteger(summary.heroStack) && summary.heroStack >= 0 && typeof summary.ended === 'boolean'
    && summary.players === setup.players && summary.mode === setup.mode && summary.experience === setup.experience
    && summary.lesson === (setup.experience === 'tutorial' ? setup.lesson : null);
}
