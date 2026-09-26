import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionCommand, SessionMode } from '../game/session-types.js';
import type { SaveSummary, TableExperience, WebTable } from './protocol.js';

export { MAX_COMMANDS } from './checkpoint-data.js';
export type { TableSetup, JournalEntry, Checkpoint, CheckpointStore } from './checkpoint-data.js';
import { MAX_COMMANDS, MAX_BYTES, validCheckpoint, type Checkpoint, type CheckpointStore } from './checkpoint-data.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function tableDigest(table: WebTable): string {
  const { id: _id, save: _save, ...state } = table;
  return hash(JSON.stringify(state));
}

/** Fence rule/policy changes, including uncommitted local builds, not just release tags. */
export async function engineFingerprint(): Promise<string> {
  const pieces: string[] = ['checkpoint-v1'];
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  for (const directory of ['core', 'agents', 'game', 'cli']) {
    const url = new URL(`../${directory}/`, import.meta.url);
    for (const name of (await readdir(url)).filter((name) => name.endsWith(extension)).sort()) {
      pieces.push(`${directory}/${name}`, await readFile(new URL(name, url), 'utf8'));
    }
  }
  for (const name of ['server', 'view', 'checkpoints', 'checkpoint-data', 'table-session']) pieces.push(await readFile(new URL(`./${name}${extension}`, import.meta.url), 'utf8'));
  return hash(pieces.join('\0'));
}



export class FileCheckpointStore implements CheckpointStore {
  constructor(readonly directory: string) {}
  #path(token: string): string { return join(this.directory, `${hash(token)}.json`); }
  async read(token: string): Promise<Checkpoint | null> {
    let file;
    try { file = await open(this.#path(token), 'r'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    try {
      if ((await file.stat()).size > MAX_BYTES) throw new Error('Checkpoint too large');
      const value: unknown = JSON.parse(await file.readFile('utf8'));
      if (!validCheckpoint(value)) throw new Error('Invalid checkpoint');
      return value;
    } finally { await file.close(); }
  }
  async write(token: string, checkpoint: Checkpoint): Promise<void> {
    const text = JSON.stringify(checkpoint);
    if (!validCheckpoint(checkpoint) || Buffer.byteLength(text) > MAX_BYTES) throw new Error('Checkpoint limit');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.#path(token);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
