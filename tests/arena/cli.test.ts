import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const cli = ['--import', 'tsx', 'scripts/arena.ts'];

describe('arena CLI', () => {
  it('saves distinct reports with source fingerprints and reproducible results', () => {
    const out = mkdtempSync(join(tmpdir(), 'holdem-arena-cli-'));
    const args = [...cli, '--hero', 'check-call', '--opponents', 'check-call', '--blocks', '2', '--out', out];
    execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe' });
    execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe' });
    const jsons = readdirSync(out).filter(f => f.endsWith('.json'));
    expect(jsons).toHaveLength(2);
    expect(readdirSync(out).filter(f => f.endsWith('.md'))).toHaveLength(2);
    const [a, b] = jsons.map(f => JSON.parse(readFileSync(join(out, f), 'utf8')));
    expect(a.resultDigest).toBe(b.resultDigest);
    expect(a.games).toBe(4);
    expect(a.provenance.sourceSha256Before).toMatch(/^[0-9a-f]{64}$/);
    expect(a.provenance.sourceChangedDuringRun).toBe(false);
    expect(a.provenance.sourceSha256Before).toBe(b.provenance.sourceSha256Before);
  }, 15_000);

  it('fails visibly on invalid options rather than silently using defaults', () => {
    for (const args of [['--players', '7'], ['--blocks', '1.5'], ['--blocks', '0'],
      ['--hero', 'missing'], ['--seed'], ['--mode', 'cash', '--mode', 'tournament']]) {
      const result = spawnSync(process.execPath, [...cli, ...args], { cwd: root, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Arena:');
    }
  }, 15_000);

  it('writes unresolved tournament results but returns a nonzero status', () => {
    const out = mkdtempSync(join(tmpdir(), 'holdem-arena-cap-'));
    const result = spawnSync(process.execPath, [...cli, '--mode', 'tournament', '--blocks', '1',
      '--max-hands', '1', '--hero', 'check-fold', '--opponents', 'check-fold', '--out', out],
    { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(2);
    const json = readdirSync(out).find(f => f.endsWith('.json'))!;
    const report = JSON.parse(readFileSync(join(out, json), 'utf8'));
    expect(report.censoredGames).toBe(2);
    expect(report.hero.winRate).toBeNull();
  }, 15_000);
});
