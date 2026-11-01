import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PracticeConfig } from './practice.js';
import type { StandbyStatus } from './standby.js';

export function sessionFiles(dir: string, config: PracticeConfig): { lock: string; status: string } {
  const key = `${config.origin === 'https://chipzen.ai' ? 'prod' : 'staging'}-${config.botId}`;
  return { lock: resolve(dir, `${key}.lock`), status: resolve(dir, `${key}.status.json`) };
}

/** Conservative exclusive lease. A crash leaves a lock for explicit inspection, never steal one. */
export function acquireSessionLock(dir: string, config: PracticeConfig, mode: string): () => void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { lock } = sessionFiles(dir, config);
  const owner = JSON.stringify({ pid: process.pid, mode, startedAt: new Date().toISOString() });
  try { writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(`Another session owns ${lock}. Stop its terminal with Ctrl+C first. After a crash, confirm its PID is no longer running before removing this lock.`);
  }
  return () => { if (readFileSync(lock, 'utf8') === owner) unlinkSync(lock); };
}

export function saveStandbyStatus(path: string, status: StandbyStatus): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path); // Readers never see a partially written snapshot.
}
