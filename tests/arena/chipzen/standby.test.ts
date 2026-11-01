import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStandby, standbyStatusFresh, type StandbyStatus } from '../../../src/arena/chipzen/standby.js';
import { acquireSessionLock, saveStandbyStatus, sessionFiles } from '../../../src/arena/chipzen/session-files.js';

const config = { botId: '12345678-1234-1234-1234-123456789abc', token: `cz_extbot_${'x'.repeat(32)}`, origin: 'https://chipzen.ai' };
let sockets: FakeSocket[], autoHello: boolean, autoOpen: boolean;
class FakeSocket extends EventTarget {
  closed = false;
  sent: Record<string, unknown>[] = [];
  constructor(readonly url: string) {
    super(); sockets.push(this);
    if (autoOpen) void Promise.resolve().then(() => this.dispatchEvent(new Event('open')));
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
    if (autoHello && JSON.parse(raw).type === 'authenticate') void Promise.resolve().then(() => this.message({ type: 'hello', endpoint: 'lobby', match_id: config.botId }));
  }
  message(data: Record<string, unknown>) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close(code = 1000, reason = '') {
    if (!this.closed) { this.closed = true; this.dispatchEvent(Object.assign(new Event('close'), { code, reason })); }
  }
}
function start() {
  const abort = new AbortController(), snapshots: StandbyStatus[] = [];
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const done = runStandby(config, (type, data) => events.push({ type, data }), abort.signal, status => snapshots.push(status));
  return { abort, snapshots, events, done };
}

beforeEach(() => {
  sockets = []; autoHello = true; autoOpen = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Standby must not make HTTP requests'); }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('presence-only lobby', () => {
  it('authenticates, answers bare pings, and never dispatches or joins even unrated/resumed matches', async () => {
    const run = start(); await vi.advanceTimersByTimeAsync(0);
    const socket = sockets[0]!;
    expect(run.snapshots.at(-1)?.state).toBe('online');
    expect(socket.sent).toEqual([{ type: 'authenticate', token: config.token }]);
    socket.message({ type: 'ping', match_id: 'opaque-bot-id' });
    for (const rated of [true, false]) socket.message({ type: 'matched', rated, resume: true, match_id: 'any', gateway_ws_url: '/ws/external/match/any/0' });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent.at(-1)).toEqual({ type: 'pong' });
    expect(run.snapshots.at(-1)).toMatchObject({ heartbeats: 1, ignoredMatches: 2 });
    expect(sockets).toHaveLength(1); expect(fetch).not.toHaveBeenCalled();
    run.abort.abort(); await run.done;
    expect(socket.closed).toBe(true); expect(run.snapshots.at(-1)?.state).toBe('stopped');
    expect(JSON.stringify(run.snapshots)).not.toContain(config.token);
    expect(JSON.stringify(run.events)).not.toContain(config.token);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not claim online before hello; times out stalled authentication and reconnects', async () => {
    autoHello = false; const run = start(); await vi.advanceTimersByTimeAsync(0);
    expect(run.snapshots.at(-1)?.state).toBe('authenticating');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run.snapshots.at(-1)).toMatchObject({ state: 'retrying', lastError: 'Lobby authentication timed out' });
    autoHello = true; await vi.advanceTimersByTimeAsync(2_000);
    expect(run.snapshots.at(-1)).toMatchObject({ state: 'online', attempts: 2 });
    run.abort.abort(); await run.done;
  });
  it('reconnects after silence, and backs off exponentially across handshake-only flaps', async () => {
    const run = start(); await vi.advanceTimersByTimeAsync(45_000);
    expect(run.snapshots.at(-1)).toMatchObject({ state: 'retrying', lastError: 'No lobby heartbeat for 45 seconds' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.close(1006, 'network'); await vi.advanceTimersByTimeAsync(0);
    expect(run.events.filter(e => e.type === 'standby-retry').map(e => e.data.backoffMs)).toEqual([2000, 4000]);
    run.abort.abort(); await run.done; await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
  });
  it.each([[4001, 'invalid token'], [4002, 'token revoked'], [1008, 'rate limit'], [4000, 'Replaced by new connection']])('stops on close %s / %s instead of reconnect fighting', async (code, reason) => {
    const run = start(); const result = run.done.catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.close(Number(code), String(reason));
    expect(await result).toBeInstanceOf(Error);
    expect(run.snapshots.at(-1)?.state).toBe('error');
    await vi.advanceTimersByTimeAsync(60_000); expect(sockets).toHaveLength(1);
  });
  it('retries a heartbeat-failed close but stops on evict frames', async () => {
    const run = start(); const result = run.done.catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.close(4000, 'Heartbeat failed'); await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.message({ type: 'evict', reason: 'Replaced' });
    expect(await result).toBeInstanceOf(Error); expect(run.snapshots.at(-1)?.state).toBe('error');
  });
  it('aborts promptly even while the socket is opening', async () => {
    autoOpen = false; const run = start(); run.abort.abort(); await run.done;
    expect(sockets[0]!.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects stale status rather than showing a dead connection as online', async () => {
    const run = start(); await vi.advanceTimersByTimeAsync(0);
    const status = run.snapshots.at(-1)!;
    expect(standbyStatusFresh(status)).toBe(true);
    expect(standbyStatusFresh(status, Date.parse(status.connectedAt!) + 45_000)).toBe(false);
    expect(standbyStatusFresh({ ...status, state: 'retrying' })).toBe(false);
    run.abort.abort(); await run.done;
  });
  it('refuses non-official origins without opening a socket', async () => {
    await expect(runStandby({ ...config, origin: 'https://example.com' }, () => {}, new AbortController().signal, () => {})).rejects.toThrow('endpoint');
    expect(sockets).toHaveLength(0);
  });
});

describe('local session ownership', () => {
  it('blocks duplicate standby/practice, releases on stop, writes private atomic snapshots', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chipzen-standby-test-'));
    try {
      const release = acquireSessionLock(dir, config, 'standby');
      expect(() => acquireSessionLock(dir, config, 'practice')).toThrow('Another session');
      const run = start(); await vi.advanceTimersByTimeAsync(0);
      const path = sessionFiles(dir, config).status;
      saveStandbyStatus(path, run.snapshots.at(-1)!);
      expect(JSON.parse(readFileSync(path, 'utf8')).state).toBe('online');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      run.abort.abort(); await run.done; release();
      acquireSessionLock(dir, config, 'practice')();
    } finally { rmSync(dir, { recursive: true }); }
  });
});
