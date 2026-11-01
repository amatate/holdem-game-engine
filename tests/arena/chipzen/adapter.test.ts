import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseGameState, runExternalBot, RetryPolicy, type RunExternalBotOptions } from '@chipzen-ai/bot';
import { actionToChipzen, matchContext, observationFromTurn } from '../../../src/arena/chipzen/adapter.js';
import { HoldemChipzenBot } from '../../../src/arena/chipzen/bot.js';
import { PracticeGate, practiceConfig, redact, runHousePractice } from '../../../src/arena/chipzen/practice.js';

const fixture = () => JSON.parse(readFileSync(new URL('./turn.json', import.meta.url), 'utf8'));
const ctx = { matchId: 'fixture-match', heroSeat: 0, smallBlind: 5, bigBlind: 10 };
const start = (hero = 0) => ({ type: 'match_start', match_id: ctx.matchId,
  seats: [0, 1].map(seat => ({ seat, is_self: seat === hero })),
  game_config: { variant: 'nlhe', num_players: 2, small_blind: 5, big_blind: 10 } });
const config = { botId: '12345678-1234-1234-1234-123456789abc', token: `cz_extbot_${'x'.repeat(32)}`, origin: 'https://chipzen.ai' };

describe('ChipZen observation/action boundary', () => {
  it('preserves blind contributions and converts all-in to a raise TOTAL', () => {
    const o = observationFromTurn(fixture(), ctx);
    expect(o.seats.map(s => s.committedStreet)).toEqual([5, 10]);
    expect(o.legalActions.call).toEqual({ pay: 5, to: 10, isAllIn: false });
    expect(actionToChipzen({ type: 'allIn' }, o.legalActions).toWire()).toEqual({ action: 'raise', params: { amount: 1000 } });
    expect(Object.isFrozen(o.seats[0])).toBe(true);
    expect(() => actionToChipzen({ type: 'raiseTo', amount: 1001 }, o.legalActions)).toThrow();
  });
  it('handles seat 1, a raise-to followed by incremental call, and current-street reset', () => {
    const f = fixture(); f.seat = 1; f.valid_actions = ['check', 'raise'];
    Object.assign(f.state, { phase: 'flop', board: ['2c', '6h', '9d'], pot: 60,
      your_stack: 970, opponent_stacks: [970], to_call: 0, min_raise: 10, max_raise: 970 });
    f.state.action_history.push({ seat: 0, action: 'raise', amount: 30, phase: 'preflop' }, { seat: 1, action: 'call', amount: 20, phase: 'preflop' });
    const o = observationFromTurn(f, matchContext(start(1)));
    expect(o.actorSeatIndex).toBe(1);
    expect(o.seats.map(s => s.committedStreet)).toEqual([0, 0]);
    expect(o.seats.map(s => s.committedHand)).toEqual([30, 30]);
    expect(o.actionHistory.at(-2)).toMatchObject({ kind: 'raise', paid: 25, betTo: 30, street: 'preflop' });
    expect(o.actionHistory.at(-1)).toMatchObject({ paid: 20, betTo: 30 });
    f.state.action_history.at(-1).amount = 30; // Inconsistent old prose example: never silently guess.
    expect(() => observationFromTurn(f, { ...ctx, heroSeat: 1 })).toThrow('Inconsistent contribution');
  });
  it('caps a short-stack call and never invents money', () => {
    const f = fixture(); f.valid_actions = ['fold', 'call'];
    Object.assign(f.state, { your_stack: 95, opponent_stacks: [800], pot: 205, to_call: 195, min_raise: 0, max_raise: 0 });
    f.state.action_history.push({ seat: 1, action: 'raise', amount: 200, phase: 'preflop' });
    const o = observationFromTurn(f, ctx);
    expect(o.legalActions.call).toEqual({ pay: 95, to: 100, isAllIn: true });
    expect(actionToChipzen({ type: 'allIn' }, o.legalActions).toWire()).toEqual({ action: 'call', params: {} });
  });
  it('does not treat a platform-capped raise as a full-stack shove', () => {
    const f = fixture(); f.state.max_raise = 995;
    expect(observationFromTurn(f, ctx).legalActions.allIn).toBeNull();
  });
  it('keeps antes out of street bets and excludes hidden/server fields', () => {
    const f = fixture(); f.state.pot = 19; f.state.your_stack = 993; f.state.opponent_stacks = [988]; f.state.max_raise = 998;
    f.state.action_history.push(...[0, 1].map(seat => ({ seat, action: 'post_ante', amount: 2, phase: 'preflop' })));
    f.state.opponent_hole_cards = ['As', 'Ad']; f.state.deck_reveal = { seed: 'secret-deck' };
    const o = observationFromTurn(f, ctx);
    expect(o.seats.map(s => s.committedStreet)).toEqual([5, 10]);
    expect(o.seats.map(s => s.committedHand)).toEqual([7, 12]);
    expect(JSON.stringify(o)).not.toContain('secret-deck');
    expect(o.seats.every(s => s.revealedHoleCards === null)).toBe(true);
  });
  it.each(['duplicate-card', 'wrong-seat', 'missing-history', 'bad-phase', 'bad-bounds'])('rejects %s', condition => {
    const f = fixture();
    if (condition === 'duplicate-card') f.state.your_hole_cards = ['Ac', 'Ac'];
    if (condition === 'wrong-seat') f.seat = 1;
    if (condition === 'missing-history') f.state.action_history = [];
    if (condition === 'bad-phase') f.state.phase = 'showdown';
    if (condition === 'bad-bounds') f.state.min_raise = 1001;
    expect(() => observationFromTurn(f, ctx)).toThrow();
  });
});

describe('decision isolation and resumption', () => {
  it('reuses a repeated request without rerolling, rejects changed/stale requests', async () => {
    let calls = 0;
    const bot = new HoldemChipzenBot(async () => { calls++; return { type: 'call' }; }, () => {});
    await bot.prepare(start()); const f = fixture();
    await bot.prepare(f); expect(bot.decide(parseGameState(f)).action).toBe('call');
    await bot.prepare(f); expect(bot.decide(parseGameState(f)).action).toBe('call'); expect(calls).toBe(1);
    f.state.your_stack--; await expect(bot.prepare(f)).rejects.toThrow('changed state');
    const next = fixture(); next.state.hand_number = 2; next.request_id = 'new-hand'; await bot.prepare(next);
    await expect(bot.prepare(fixture())).rejects.toThrow('Stale hand');
  });
  it('uses safe fallback on bad translation, illegal action or exhausted deadline', async () => {
    const events: Record<string, unknown>[] = [];
    const bot = new HoldemChipzenBot(async () => ({ type: 'raiseTo', amount: 999999 }), (type, data) => { if (type === 'decision') events.push(data); });
    await bot.prepare(start()); let f = fixture();
    await bot.prepare(f); expect(bot.decide(parseGameState(f)).action).toBe('fold');
    f = fixture(); f.request_id = 'no-time'; f.timeout_ms = 30;
    await bot.prepare(f); expect(bot.decide(parseGameState(f)).action).toBe('fold');
    expect(events.map(e => e.fallback)).toEqual(['adapter-or-strategy-error', 'timeout']);
  });
  it('reconstructs seat/context from reconnected before preparing pending request', async () => {
    const bot = new HoldemChipzenBot(async () => ({ type: 'call' }), () => {});
    await bot.prepare({ ...start(), type: 'reconnected', pending_request: fixture() });
    expect(bot.decide(parseGameState(fixture())).action).toBe('call');
  });
});

describe('practice safety boundary', () => {
  it('refuses missing credentials and non-official environments without leaking the token', () => {
    expect(() => practiceConfig({})).toThrow('locally');
    expect(() => practiceConfig({ CHIPZEN_BOT_ID: config.botId, CHIPZEN_BOT_TOKEN: config.token, CHIPZEN_ENV: 'evil' })).toThrow('prod or staging');
    expect(JSON.stringify(redact({ token: config.token, detail: config.token, deck_reveal: { seed: 'private' } }))).not.toContain(config.token);
    expect(redact({ deck_reveal: { seed: 'private' } })).toEqual({});
  });
  it('dispatches once and only accepts that exact unrated match', async () => {
    let count = 0;
    const gate = new PracticeGate(config, (async (url, options) => {
      count++; expect(url).toBe('https://chipzen.ai/api/external-api/challenges/house-bot');
      expect(options?.redirect).toBe('error');
      return new Response(JSON.stringify({ match_id: 'expected', rated: false }));
    }) as typeof fetch);
    await gate.dispatch(new AbortController().signal); await gate.dispatch(new AbortController().signal);
    expect(count).toBe(1);
    expect(gate.accepts({ match_id: 'expected', rated: false, gateway_ws_url: '/ws/external/match/expected/p0' })).toBe(true);
    expect(gate.accepts({ match_id: 'expected', rated: false, gateway_ws_url: 'wss://evil.example/ws/external/match/expected/p0' })).toBe(false);
    expect(gate.accepts({ match_id: 'expected', rated: false, gateway_ws_url: '/ws/external/match/other/p0' })).toBe(false);
    expect(gate.accepts({ match_id: 'expected', rated: true })).toBe(false);
    expect(gate.accepts({ match_id: 'unsolicited', rated: false })).toBe(false);
  });
  it('never retries an ambiguous dispatch failure', async () => {
    let count = 0;
    const gate = new PracticeGate(config, (async () => { count++; throw new Error('network'); }) as typeof fetch);
    await expect(gate.dispatch(new AbortController().signal)).rejects.toThrow();
    expect(await gate.dispatch(new AbortController().signal)).toBeUndefined(); expect(count).toBe(1);
  });
  it('resumes only an exact unrated match without an HTTP dispatch', async () => {
    const request = vi.fn(async () => { throw new Error('Must not dispatch'); });
    const matchId = '12345678-1234-1234-1234-123456789abc';
    const gate = new PracticeGate(config, request, matchId);
    expect(await gate.dispatch(new AbortController().signal)).toBe(matchId);
    expect(request).not.toHaveBeenCalled();
    const notification = { match_id: matchId, rated: false, gateway_ws_url: `/ws/external/match/${matchId}/p0`, resume: true };
    expect(gate.accepts(notification)).toBe(true);
    expect(gate.accepts({ ...notification, rated: true })).toBe(false);
    expect(gate.accepts({ ...notification, match_id: 'other' })).toBe(false);
    expect(() => new PracticeGate(config, request, 'anything')).toThrow('UUID');
  });
  it('preserves a dispatch failure through SDK reconnects without issuing another request', async () => {
    const writes: Record<string, unknown>[] = [];
    class FakeSocket extends EventTarget {
      private closed = false;
      constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
      send(raw: string) {
        writes.push(JSON.parse(raw));
        if (JSON.parse(raw).type === 'authenticate') queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'hello', endpoint: 'lobby' }) }));
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ping', match_id: 'bot-correlation-id' }) }));
        });
      }
      close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
    }
    const request = vi.fn(async () => new Response('{}', { status: 503 }));
    const events: { type: string; data: Record<string, unknown> }[] = [];
    vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('fetch', request);
    try {
      await expect(runHousePractice(config,
        () => new HoldemChipzenBot(async () => ({ type: 'check' }), () => {}),
        (type, data) => events.push({ type, data }), new AbortController().signal))
        .rejects.toThrow('Practice dispatch HTTP 503');
      expect(request).toHaveBeenCalledTimes(1);
      expect(events.find(e => e.type === 'session-error')?.data.message).toContain('HTTP 503');
      expect(writes.find(m => m.type === 'pong')).toEqual({ type: 'pong' });
      expect(events.find(e => e.type === 'heartbeat-received')?.data.endpoint).toBe('lobby');
      expect(events.find(e => e.type === 'heartbeat-sent')?.data.frame).toEqual({ type: 'pong' });
    } finally { vi.unstubAllGlobals(); }
  });
  it('runs the official SDK lobby + match handshake and request echo against an in-memory protocol fixture', async () => {
    let bot: HoldemChipzenBot;
    const sent: Record<string, unknown>[] = [];
    const transport: NonNullable<RunExternalBotOptions['transport']> = async (url, options) => {
      const lobby = url.includes('/bot/');
      if (!lobby) expect(options.subprotocols).toEqual(['chipzen-bot-token', config.token]);
      const frames = lobby ? [{ type: 'hello' }, { type: 'matched', match_id: ctx.matchId, gateway_ws_url: '/ws/external/match/fixture-match/p0', rated: false }]
        : [{ type: 'hello', match_id: ctx.matchId }, start(), fixture(), { type: 'match_end', match_id: ctx.matchId, results: [] }];
      return { send: data => { sent.push(JSON.parse(data)); }, close: () => {}, reader: { next: async () => {
        const frame = frames.shift();
        if (!frame && lobby) { await new Promise(resolve => setTimeout(resolve, 20)); return null; }
        if (!frame) return null;
        if (!lobby) await bot.prepare(frame);
        return JSON.stringify(frame);
      } } };
    };
    const result = await runExternalBot(() => { bot = new HoldemChipzenBot(async () => ({ type: 'call' }), () => {}); return bot; }, {
      url: `wss://chipzen.ai/ws/external/bot/${config.botId}`, token: config.token, config: null, transport,
      maxMatches: 1, safeMode: false, retryPolicy: new RetryPolicy({ maxReconnectAttempts: 0 }),
    });
    expect(result).toHaveLength(1);
    expect(sent.find(m => m.type === 'turn_action')).toMatchObject({ request_id: 'fixture-request-1', action: 'call' });
  });
});
