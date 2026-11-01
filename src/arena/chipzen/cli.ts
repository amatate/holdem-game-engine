import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { arenaAgent } from '../agents.js';
import { HoldemChipzenBot, type Audit } from './bot.js';
import { practiceConfig, redact, runHousePractice, type PracticeConfig } from './practice.js';
import { workerDecision } from './worker.js';
import { runStandby, standbyStatusFresh, type StandbyStatus } from './standby.js';
import { acquireSessionLock, saveStandbyStatus, sessionFiles } from './session-files.js';

const help = `ChipZen adapter (no ranked play or uploads)
  npm run ai:chipzen -- --check     Offline configuration check; no connection
  npm run ai:chipzen -- --standby   Stay online until Ctrl+C; presence ONLY, never join/create matches
  npm run ai:chipzen -- --status    Read local standby status; no connection
  npm run ai:chipzen -- --practice  Connect, request ONE house-bot match, record, exit
  npm run ai:chipzen -- --resume <match-uuid>  Reattach only this unrated match; NEVER create one
  npm run ai:chipzen -- --worker-smoke  Exercise the real isolated strategy worker offline
Environment (local only): CHIPZEN_BOT_ID, CHIPZEN_BOT_TOKEN; optional CHIPZEN_ENV=prod|staging
Live decisions: hunter-challenge / 600 samples, 1500ms worker cap, 150ms network reserve.
Practice cap: 15 minutes; resume cap: 2 minutes; standby: until Ctrl+C.
One session per bot. Stop standby before starting practice. Reports: artifacts/chipzen/ (gitignored).
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help') { process.stdout.write(help); return; }
  const resumeMatchId = args[0] === '--resume' ? args[1] : undefined;
  if (args[0] === '--resume') {
    if (args.length !== 2 || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(resumeMatchId ?? '')) throw new Error('Resume requires an exact match UUID');
  } else if (args.length !== 1 || !['--check', '--practice', '--worker-smoke', '--standby', '--status'].includes(args[0]!)) throw new Error('Use --help for supported options');
  arenaAgent('hunter-challenge', 600);
  if (args[0] === '--worker-smoke') {
    const { observationFromTurn, actionToChipzen } = await import('./adapter.js');
    const frame = JSON.parse(readFileSync(resolve('tests/arena/chipzen/turn.json'), 'utf8'));
    const observation = observationFromTurn(frame, { matchId: 'fixture-match', heroSeat: 0, smallBlind: 5, bigBlind: 10 });
    const started = performance.now();
    const action = await workerDecision('hunter-challenge', 600)(observation, 'chipzen-worker-smoke', 1500);
    const wire = actionToChipzen(action, observation.legalActions).toWire();
    const elapsedMs = performance.now() - started;
    let hardTimeoutVerified = false;
    try { await workerDecision('hunter-challenge', 600)(observation, 'timeout-smoke', 1); }
    catch (e) { hardTimeoutVerified = e instanceof Error && e.message === 'decision-timeout'; }
    if (!hardTimeoutVerified) throw new Error('Hard timeout smoke check failed');
    process.stdout.write(JSON.stringify({ offline: true, action: wire, elapsedMs, hardTimeoutVerified }) + '\n'); return;
  }
  const config = practiceConfig(process.env);
  if (args[0] === '--check') {
    process.stdout.write('Credentials have the expected shape; not authenticated or connected. Use --standby for presence only, or --practice for one unrated match.\n'); return;
  }
  const dir = resolve('artifacts/chipzen'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (args[0] === '--status') {
    try {
      const status = JSON.parse(readFileSync(sessionFiles(dir, config).status, 'utf8')) as StandbyStatus;
      let processAlive: boolean | null = false;
      if (Number.isSafeInteger(status.pid) && status.pid > 0) {
        try { process.kill(status.pid, 0); processAlive = true; }
        catch (error) { processAlive = (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null; }
      }
      const onlineConfirmed = processAlive === true && standbyStatusFresh(status);
      process.stdout.write(JSON.stringify({ ...status, processAlive, onlineConfirmed,
        note: processAlive === null ? 'Cannot inspect process in this environment; presence is unconfirmed, not known offline. Check the bot page.'
          : 'Local standby snapshot only; online requires a live process and recent authenticated hello/pong. Not proof of match readiness.' }, null, 2) + '\n');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      process.stdout.write('No local standby status yet. Start with --standby.\n');
    }
    return;
  }
  const release = acquireSessionLock(dir, config, args[0]!.slice(2));
  try { await runLiveSession(config, dir, args[0]!, resumeMatchId); } finally { release(); }
}

async function runLiveSession(config: PracticeConfig, dir: string, mode: string, resumeMatchId?: string): Promise<void> {
  const stem = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const journal = resolve(dir, `${stem}.jsonl`), report = resolve(dir, `${stem}.json`);
  writeFileSync(journal, '', { flag: 'wx', mode: 0o600 });
  const health = { decisions: 0, fallbacks: 0, rejected: 0, timeouts: 0, hands: 0 };
  const audit: Audit = (type, data) => {
    if (type === 'decision') { health.decisions++; if (data.fallback) health.fallbacks++; }
    if (type === 'frame') {
      if (data.type === 'action_rejected') health.rejected++;
      if (data.type === 'action_timeout') health.timeouts++;
      if (data.type === 'round_result') health.hands++;
    }
    appendFileSync(journal, JSON.stringify({ at: new Date().toISOString(), type, data: redact(data) }) + '\n');
    if (mode === '--standby' && type === 'ignored-match') process.stdout.write('收到比赛通知，但当前仅在线待机，未接入。请先停止待机，再使用单场练习入口。\n');
  };
  if (mode === '--standby') {
    const abort = new AbortController();
    const stop = () => abort.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
    let previous = '';
    process.stdout.write(`在线待机：只保持大厅连接，不创建或接入比赛。Ctrl+C 停止；关机/休眠会掉线。\n日志：${journal}\n`);
    audit('run-start', { mode: 'presence-only', botId: config.botId, node: process.version });
    try {
      await runStandby(config, audit, abort.signal, status => {
        saveStandbyStatus(sessionFiles(dir, config).status, status);
        if (previous !== status.state || (status.state === 'online' && (status.heartbeats === 1 || status.heartbeats % 4 === 0))) {
          const labels = { connecting: '连接中', authenticating: '认证中', online: '已认证在线（仅待机）', retrying: '掉线，等待重连', stopped: '已停止', error: '已停止，需要处理' };
          process.stdout.write(`[${new Date().toISOString()}] ${labels[status.state]}｜心跳 ${status.heartbeats}${status.state === 'retrying' || status.state === 'error' ? `｜${status.lastError}` : ''}\n`);
        }
        previous = status.state;
      });
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return;
  }
  const hash = createHash('sha256');
  for (const base of ['dist/arena', 'dist/agents', 'dist/core']) {
    for (const entry of readdirSync(base, { recursive: true }).filter(p => typeof p === 'string').sort()) {
      if (!entry.endsWith('.js')) continue;
      const path = resolve(base, entry); hash.update(relative(process.cwd(), path)).update(readFileSync(path));
    }
  }
  hash.update(readFileSync('package-lock.json'));
  const provenance = { adapter: 'chipzen-v0', sdk: '0.3.1', agent: 'hunter-challenge', samples: 600,
    runtimeSha256: hash.digest('hex'), node: process.version, environment: process.env.CHIPZEN_ENV ?? 'prod' };
  audit('run-start', { ...provenance, resumeMatchId });
  process.stdout.write(`${resumeMatchId ? `Resuming ONLY ${resumeMatchId}; no new match request (2 minute cap).` : 'Starting ONE unrated practice match.'} Journal: ${journal}\n`);
  const abort = new AbortController();
  const stop = () => abort.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setTimeout(stop, (resumeMatchId ? 2 : 15) * 60_000);
  let result: unknown = null, error: string | null = null;
  try {
    result = await runHousePractice(config, () => new HoldemChipzenBot(workerDecision('hunter-challenge', 600), audit), audit, abort.signal, resumeMatchId);
  } catch (e) { error = e instanceof Error ? String(redact(e.message)) : 'Session failed'; }
  finally { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  const clean = resumeMatchId === undefined && error === null && health.fallbacks === 0 && health.rejected === 0 && health.timeouts === 0 && health.decisions > 0;
  writeFileSync(report, JSON.stringify({ provenance, online: true, resumeMatchId, complete: error === null, clean, health, result, error }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(`Report: ${report}\n${error ?? (resumeMatchId ? 'Resumed diagnostic session completed; exclude from strength claims.' : clean ? 'Match completed; this alone is not proof of strength.' : 'Match completed with reliability failures; exclude from strength claims.')}\n`);
  if (!clean) process.exitCode = 2;
}
main().catch(error => { process.stderr.write(String(redact(error instanceof Error ? error.message : 'ChipZen error')) + '\n'); process.exitCode = 1; });
