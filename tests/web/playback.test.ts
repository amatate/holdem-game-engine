import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import type { SeatIdentity } from '../../src/web/protocol.js';
import { buildPlaybackFrames, PlaybackClock } from '../../src/web/playback.js';
import { renderPlaybackFrame } from '../../src/web/render.js';

const roster: SeatIdentity[] = [
  { seatIndex: 0, playerId: '你', name: '你', nickname: '玩家', style: '', characterId: 'hero' },
  { seatIndex: 1, playerId: '林岚', name: '林岚', nickname: '猎手', style: '', characterId: 'hunter' },
];
const events: PublicGameEvent[] = [
  { type: 'gameStarted', maxSeats: 2, startingStack: 100 },
  { type: 'handStarted', handNumber: 1, smallBlind: 1, bigBlind: 2 },
  { type: 'ownHoleCardsDealt', cards: [{ code: 'As', rank: 14, suit: 's' }, { code: 'Kd', rank: 13, suit: 'd' }] },
  { type: 'playerActed', seatIndex: 0, kind: 'bet', paid: 100, betTo: 100, allIn: true },
  { type: 'playerActed', seatIndex: 1, kind: 'call', paid: 100, betTo: 100, allIn: true },
  { type: 'communityCardsDealt', street: 'flop', cards: [{ code: '2c', rank: 2, suit: 'c' }, { code: '3c', rank: 3, suit: 'c' }, { code: '7d', rank: 7, suit: 'd' }] },
  { type: 'communityCardsDealt', street: 'turn', cards: [{ code: '9h', rank: 9, suit: 'h' }] },
  { type: 'communityCardsDealt', street: 'river', cards: [{ code: 'Jc', rank: 11, suit: 'c' }] },
  { type: 'holeCardsRevealed', seatIndex: 1, reason: 'showdown', cards: [{ code: 'Qh', rank: 12, suit: 'h' }, { code: 'Qs', rank: 12, suit: 's' }] },
  { type: 'potConstructed', potId: 'pot-0', amount: 200, eligibleSeats: [0, 1] },
  { type: 'potAwarded', potId: 'pot-0', winners: [1], amounts: [200], oddChipRecipients: [] },
  { type: 'handCompleted', finalStacks: [{ seatIndex: 0, stack: 0 }, { seatIndex: 1, stack: 200 }] },
];

describe('event-by-event playback', () => {
  it('does not show placeholder positions before the real seats are assigned', () => {
    const frames = buildPlaybackFrames(null, [
      ...events.slice(0, 2),
      { type: 'positionsAssigned', buttonPosition: 1, smallBlindSeat: 1, bigBlindSeat: 0 },
    ], roster);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event.type).toBe('positionsAssigned');
    expect(frames[0]?.view.buttonPosition).toBe(1);
    expect(frames[0]?.view.smallBlindSeat).toBe(1);
    expect(frames[0]?.view.bigBlindSeat).toBe(0);
  });
  it('reveals board, opponent cards and awards only at their event, with conserved chips', () => {
    const frames = buildPlaybackFrames(null, events, roster);
    const bet = frames.find((frame) => frame.event.type === 'playerActed')!;
    expect(bet.view.potTotal).toBe(100);
    expect(bet.view.seats.map((seat) => seat.stack)).toEqual([0, 100]);
    expect(bet.view.board).toEqual([]);
    expect(bet.view.seats[1]?.cards).toBeNull();
    const deals = frames.filter((frame) => frame.event.type === 'communityCardsDealt');
    expect(deals.map((frame) => frame.view.board.length)).toEqual([3, 4, 5]);
    expect(deals.map((frame) => frame.previousBoardCount)).toEqual([0, 3, 4]);
    const reveal = frames.find((frame) => frame.event.type === 'holeCardsRevealed')!;
    expect(reveal.view.seats[1]?.cards?.map((card) => card.code)).toEqual(['Qh', 'Qs']);
    expect(reveal.view.seats[1]?.stack).toBe(0);
    const award = frames.find((frame) => frame.event.type === 'potAwarded')!;
    expect(award.view.seats[1]?.stack).toBe(200);
    expect(award.view.potTotal).toBe(0);
    expect(bet.view.seats[1]?.cards).toBeNull(); // Later frames cannot mutate earlier snapshots.
    for (const frame of frames) expect(frame.view.potTotal + frame.view.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(200);
  });
  it('renders intermediate state without final results, legal commands or future cards', () => {
    const frames = buildPlaybackFrames(null, events, roster);
    const frame = frames.find((item) => item.event.type === 'playerActed')!;
    const html = renderPlaybackFrame(frame, roster, 3, frames.length);
    expect(html).toContain('正在播放');
    expect(html).toContain('100');
    expect(html).not.toContain('本手净');
    expect(html).not.toContain('data-intent=');
    expect(html).not.toContain('aria-label="Q♥"');
    expect(html).not.toContain('aria-label="J♣"');
    expect(html).not.toContain('赢得本场');
  });
  it('applies refunds and individual side-pot awards without changing their recipients', () => {
    const frames = buildPlaybackFrames(null, [...events.slice(0, 5),
      { type: 'uncalledBetReturned', seatIndex: 0, amount: 20 },
      { type: 'potAwarded', potId: 'pot-0', winners: [0, 1], amounts: [80, 80], oddChipRecipients: [] },
      { type: 'potAwarded', potId: 'pot-1', winners: [1], amounts: [20], oddChipRecipients: [] },
    ], roster);
    const awards = frames.filter((frame) => frame.event.type === 'potAwarded');
    expect(awards[0]?.view.seats.map((seat) => seat.stack)).toEqual([100, 80]);
    expect(awards[0]?.view.potTotal).toBe(20);
    expect(awards[1]?.view.seats.map((seat) => seat.stack)).toEqual([100, 100]);
    expect(awards[1]?.view.potTotal).toBe(0);
  });
});

describe('adjustable playback clock', () => {
  afterEach(() => vi.useRealTimers());
  it('changes the remaining portion of the current wait immediately', async () => {
    vi.useFakeTimers();
    const clock = new PlaybackClock();
    clock.start();
    let done = false;
    const wait = clock.wait(800).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(200);
    clock.setSpeed(4);
    await vi.advanceTimersByTimeAsync(149);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(done).toBe(true);
  });
  it('can slow down, skip immediately, then start a fresh segment', async () => {
    vi.useFakeTimers();
    const clock = new PlaybackClock();
    clock.setSpeed(0.5); clock.start();
    let done = false;
    const first = clock.wait(800).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(800);
    expect(done).toBe(false);
    clock.skip(); await first;
    expect(clock.skipped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await clock.wait(1200);
    clock.start(); expect(clock.skipped).toBe(false);
    const next = clock.wait(800);
    await vi.advanceTimersByTimeAsync(1600); await next;
    expect(vi.getTimerCount()).toBe(0);
    clock.setSpeed(Number.NaN); expect(clock.speed).toBe(0.5);
  });
});
