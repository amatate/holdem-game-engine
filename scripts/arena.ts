import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arenaAgent, ARENA_AGENT_IDS } from '../src/arena/agents.js';
import { renderArenaReport } from '../src/arena/report.js';
import { runArena } from '../src/arena/runner.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Local competitive AI baseline (no network, no Chipzen registration)

npm run ai:arena -- [options]
  --mode cash|tournament       default cash
  --players 2..6              default 2
  --hero ID                  default hunter-challenge (existing heuristic)
  --opponents ID[,ID...]      default hunter-standard; one repeated ID or one per opponent
  --blocks N                 default 50; each block rotates every entrant through every seat
  --seed TEXT                default arena-v0-baseline
  --stack-bb N               default 100; blinds start at 1/2
  --hands-per-level N        default 10; tournament blinds double
  --max-hands N              default 300; cap is unresolved, not a chip-leader win
  --decision-ms N            default 5000; soft local deadline, not a CPU sandbox
  --samples N                optional shared equity-sample budget (otherwise native tier budgets)
  --out DIRECTORY            default artifacts/arena (unique files, never overwrites)
  --help

Agents: ${ARENA_AGENT_IDS.join(', ')}
JSON records exact options, source fingerprint, scores, failures, and per-match digests.
No confidence interval below 30 independent blocks or after failures/censored games.
`;

async function sourceFingerprint(): Promise<string> {
  const files: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
    }
  };
  await walk('src');
  files.push('scripts/arena.ts', 'package.json', 'package-lock.json');
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file + '\0').update(await readFile(join(root, file))).update('\0');
  return hash.digest('hex');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { process.stdout.write(help); return; }
  const allowed = new Set(['mode', 'players', 'hero', 'opponents', 'blocks', 'seed', 'stack-bb',
    'hands-per-level', 'max-hands', 'decision-ms', 'samples', 'out']);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    const value = args[i + 1];
    if (!args[i]?.startsWith('--') || !key || !allowed.has(key) || value === undefined
      || value.startsWith('--') || values.has(key)) throw new Error(`Invalid/duplicate option: ${args[i]}`);
    values.set(key, value);
  }
  const integer = (key: string, fallback: number): number => {
    const raw = values.get(key);
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new Error(`${key} must be a positive integer`);
    const result = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${key} must be a positive integer`);
    return result;
  };
  const players = integer('players', 2);
  if (players < 2 || players > 6) throw new Error('players must be 2–6');
  const mode = values.get('mode') ?? 'cash';
  if (mode !== 'cash' && mode !== 'tournament') throw new Error('mode must be cash or tournament');
  const opponents = (values.get('opponents') ?? 'hunter-standard').split(',');
  if (opponents.length !== 1 && opponents.length !== players - 1) throw new Error('Provide one opponent ID, or players-1 IDs');
  const samples = values.has('samples') ? integer('samples', 600) : undefined;
  const entrants = [values.get('hero') ?? 'hunter-challenge',
    ...Array.from({ length: players - 1 }, (_, i) => opponents[i % opponents.length]!)].map(id => arenaAgent(id, samples));
  const sourceBefore = await sourceFingerprint();
  process.stderr.write(`Local ${mode}: ${players} seats; existing heuristic baseline; no online actions.\n`);
  const started = new Date().toISOString();
  const report = await runArena({
    mode, entrants, blocks: integer('blocks', 50), seed: values.get('seed') ?? 'arena-v0-baseline',
    stackBB: integer('stack-bb', 100), handsPerLevel: integer('hands-per-level', 10),
    maxHands: integer('max-hands', 300), decisionBudgetMs: integer('decision-ms', 5000),
  }, (done, total) => {
    if (done === 1 || done === total || done % 10 === 0) process.stderr.write(`Blocks ${done}/${total}\n`);
  });
  const sourceAfter = await sourceFingerprint();
  let gitCommit: string | null = null;
  let gitDirty: boolean | null = null;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
  } catch { /* Source archive without .git still has a content fingerprint. */ }
  const artifact = {
    ...report, provenance: { started, finished: new Date().toISOString(), node: process.version,
      gitCommit, gitDirty, sourceSha256Before: sourceBefore, sourceSha256After: sourceAfter,
      sourceChangedDuringRun: sourceBefore !== sourceAfter, cliArguments: args },
  };
  const directory = resolve(root, values.get('out') ?? 'artifacts/arena');
  await mkdir(directory, { recursive: true });
  const basename = `${started.replace(/[:.]/g, '-')}-${mode}-${randomUUID().slice(0, 8)}`;
  const json = join(directory, `${basename}.json`);
  const markdown = join(directory, `${basename}.md`);
  const provenanceText = `\nSource SHA-256: ${sourceBefore}\n\nSource changed during run: ${sourceBefore !== sourceAfter}\n`;
  await writeFile(json, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
  await writeFile(markdown, renderArenaReport(report) + provenanceText, { flag: 'wx' });
  process.stdout.write(renderArenaReport(report) + `\nJSON: ${json}\nReport: ${markdown}\n`);
  if (report.health.some(h => h.fallbacks > 0) || report.censoredGames > 0 || sourceBefore !== sourceAfter) process.exitCode = 2;
}

main().catch(error => {
  process.stderr.write(`Arena: ${error instanceof Error ? error.message : 'unexpected failure'}\nUse --help for options.\n`);
  process.exitCode = 1;
});
