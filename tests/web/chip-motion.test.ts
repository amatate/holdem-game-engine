import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { chipTransfers, chipMotionDuration, chipKeyframes, animateChipTransfers, CHIP_MAX_SPEED } from '../../src/web/chip-motion.js';
import { buildPlaybackFrames, PlaybackClock } from '../../src/web/playback.js';
import { renderPlaybackFrame } from '../../src/web/render.js';
import { applyPublicEvents } from '../../src/web/view.js';
import { translateText } from '../../src/web/i18n.js';
import { frameSound } from '../../src/web/sound.js';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import { rosterFor } from '../../src/web/table-session.js';

const roster = rosterFor(4);
const setup: PublicGameEvent[] = [
  { type: 'gameStarted', maxSeats: 4, startingStack: 100 },
  { type: 'handStarted', handNumber: 1, smallBlind: 1, bigBlind: 2 },
  { type: 'positionsAssigned', buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
  { type: 'blindPosted', seatIndex: 1, kind: 'small', amount: 1, allIn: false },
  { type: 'blindPosted', seatIndex: 2, kind: 'big', amount: 2, allIn: false },
  { type: 'playerActed', seatIndex: 0, kind: 'raise', paid: 20, betTo: 20, allIn: false },
  { type: 'playerActed', seatIndex: 1, kind: 'fold', paid: 0, betTo: 1, allIn: false },
  { type: 'playerActed', seatIndex: 2, kind: 'call', paid: 18, betTo: 20, allIn: false },
];
afterEach(() => vi.useRealTimers());

describe('public chip choreography', () => {
  it('moves only money actually paid to a seat bet, never the raise-to total', () => {
    const move = chipTransfers(null, setup.at(-1)!);
    expect(move).toEqual([{ kind: 'bet', amount: 18, from: { zone: 'stack', seatIndex: 2 }, to: { zone: 'bet', seatIndex: 2 } }]);
    expect(chipTransfers(null, setup[3]!)[0]?.amount).toBe(1);
    for (const kind of ['fold', 'check'] as const) {
      expect(chipTransfers(null, { type: 'playerActed', seatIndex: 1, kind, paid: 0, betTo: 20, allIn: false })).toEqual([]);
    }
  });
  it('collects folded contributions as well, once, before dealing the next street', () => {
    const close: PublicGameEvent = { type: 'bettingRoundClosed', street: 'preflop' };
    const events: PublicGameEvent[] = [...setup, close,
      { type: 'communityCardsDealt', street: 'flop', cards: [
        { code: 'As', rank: 14, suit: 's' }, { code: '7d', rank: 7, suit: 'd' }, { code: '2c', rank: 2, suit: 'c' },
      ] },
      { type: 'bettingRoundStarted', street: 'flop', actor: 0, currentBetTo: 0 },
      { type: 'bettingRoundClosed', street: 'flop' }];
    const frames = buildPlaybackFrames(null, events, roster);
    const sweeps = frames.filter(frame => frame.event.type === 'bettingRoundClosed');
    const called = frames.find(frame => frame.event.type === 'playerActed' && frame.event.kind === 'call')!;
    const calledHtml = renderPlaybackFrame(called, roster, 1, frames.length);
    expect(calledHtml).toContain('class="pot-chip-bank" data-chip-total="0"');
    expect(calledHtml).toContain('class="bet-chip-bank" data-chip-total="20"');
    expect(sweeps).toHaveLength(1); // Empty streets do not animate or pause.
    const sweep = sweeps[0]!;
    expect(sweep.chipTransfers?.map(move => move.amount)).toEqual([20, 1, 20]);
    expect(sweep.chipTransfers?.every(move => move.from.zone === 'bet' && move.to.zone === 'pot')).toBe(true);
    expect(sweep.view.board).toEqual([]);
    expect(sweep.view.seats.every(seat => seat.committedStreet === 0)).toBe(true);
    expect(sweep.view.potTotal).toBe(41); // Collection NEVER adds to the already-inclusive pot again.
    expect(frameSound(sweep)).toBe('chips');
    const html = renderPlaybackFrame(sweep, roster, 1, frames.length);
    expect(html.match(/class="bet-chip" aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain('data-chip-collecting');
    expect(html).toContain('收池 · 本轮下注归入底池');
    expect(translateText('收池 · 本轮下注归入底池', 'en')).not.toMatch(/[\p{Script=Han}]/u);
    for (const frame of frames) expect(frame.view.potTotal + frame.view.seats.reduce((n, seat) => n + seat.stack, 0)).toBe(400);
    expect(sweep.view).toEqual(applyPublicEvents(null, [...setup, close], roster));
  });
  it('routes refunds and split/side-pot awards to the exact public recipients', () => {
    expect(chipTransfers(null, { type: 'uncalledBetReturned', seatIndex: 0, amount: 9 }))
      .toEqual([{ kind: 'refund', from: { zone: 'pot' }, to: { zone: 'stack', seatIndex: 0 }, amount: 9 }]);
    const award: PublicGameEvent = { type: 'potAwarded', potId: 'pot-0', winners: [0, 2], amounts: [11, 10], oddChipRecipients: [0] };
    expect(chipTransfers(null, award).map(move => [move.to, move.amount])).toEqual([
      [{ zone: 'stack', seatIndex: 0 }, 11], [{ zone: 'stack', seatIndex: 2 }, 10],
    ]);
    const side: PublicGameEvent = { ...award, potId: 'pot-1', winners: [2], amounts: [20], oddChipRecipients: [] };
    expect(chipTransfers(null, side)).toEqual([{ kind: 'award', from: { zone: 'pot' }, to: { zone: 'stack', seatIndex: 2 }, amount: 20 }]);
  });
  it('keeps 4× chip movement visible and gives every staggered flight time to finish', () => {
    const bet = chipTransfers(null, setup[5]!);
    expect(chipMotionDuration(bet) / CHIP_MAX_SPEED).toBeGreaterThan(500);
    const previous = applyPublicEvents(null, setup, roster);
    expect(chipMotionDuration(chipTransfers(previous, { type: 'bettingRoundClosed', street: 'preflop' }))).toBeGreaterThan(1200);
    expect(chipMotionDuration([])).toBe(0);
    const keyframes = chipKeyframes({ x: 20, y: 40 }, { x: 100, y: 200 }, 1);
    expect(keyframes[0]?.transform).toContain('translate(20px, 40px)');
    expect(keyframes.at(-1)?.transform).toContain('translate(100px, 200px)');
    expect(keyframes.at(-1)?.opacity).toBe(1); // Lands solid, then becomes the static pile.
  });
  it('caps only motion waits and retimes immediately when slowing down or skipping', async () => {
    vi.useFakeTimers();
    const clock = new PlaybackClock(); clock.setSpeed(4); clock.start();
    let completed = false;
    const wait = clock.wait(1200, CHIP_MAX_SPEED).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(200); // 400 virtual ms consumed, not 800.
    clock.setSpeed(1);
    await vi.advanceTimersByTimeAsync(799); expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await wait; expect(completed).toBe(true);
    clock.setSpeed(4);
    const next = clock.wait(1000, CHIP_MAX_SPEED); clock.skip(); await next;
    expect(vi.getTimerCount()).toBe(0);
    clock.start(); completed = false;
    const ordinary = clock.wait(800).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(199); expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await ordinary; expect(completed).toBe(true);
  });
});

// DOM/WAAPI doubles only; mapping, timing, geometry, cleanup and sprite creation are real.
function animationRig() {
  const recorded: { animation: Animation; cancel: ReturnType<typeof vi.fn>; frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  class Surface {
    className = ''; textContent = ''; innerHTML = ''; dataset: Record<string, string> = {};
    children: Surface[] = []; parent: Surface | null = null;
    ownerDocument = { createElement: () => new Surface() };
    getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 60 }; }
    setAttribute() {}
    append(child: Surface) { child.parent = this; this.children.push(child); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    querySelector(selector: string): Surface | null {
      if (selector === '.arena') return arena;
      if (selector === '.chip-art') return null;
      return target;
    }
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      const cancel = vi.fn();
      const animation = { playbackRate: 1, cancel, effect: { updateTiming: vi.fn() }, finished: new Promise<void>(() => {}) } as unknown as Animation;
      recorded.push({ animation, cancel, frames, options }); return animation;
    }
  }
  const target = new Surface(), arena = new Surface(), root = new Surface();
  return { root: root as unknown as HTMLElement, arena, recorded };
}
it('creates staggered sprite flights and removes them all on skip without timers or callbacks changing money', () => {
  const r = animationRig();
  const flight = animateChipTransfers(r.root, chipTransfers(null, setup[5]!), 4, false);
  expect(r.arena.children).toHaveLength(1);
  expect(r.arena.children[0]?.className).toBe('chip-motion-layer');
  expect(r.arena.children[0]?.children).toHaveLength(4); // 20 = four real denomination-5 chips.
  expect(r.arena.children[0]?.children.map(sprite => sprite.dataset.chipAmount)).toEqual(['5', '5', '5', '5']);
  expect(r.arena.children[0]?.children.every(sprite => sprite.innerHTML.includes('data-denomination="5"'))).toBe(true);
  expect(r.recorded.every(record => record.animation.playbackRate === 2)).toBe(true);
  flight.setSpeed(.5);
  expect(r.recorded.every(record => record.animation.playbackRate === .5)).toBe(true);
  flight.cancel(); flight.cancel();
  expect(r.arena.children).toHaveLength(0);
  expect(r.recorded.every(record => record.cancel.mock.calls.length >= 1)).toBe(true);
});
it('respects reduced motion and missing geometry without creating overlays', () => {
  const r = animationRig();
  animateChipTransfers(r.root, chipTransfers(null, setup[5]!), 1, true).cancel();
  expect(r.arena.children).toHaveLength(0);
  expect(r.recorded).toHaveLength(0);
  const absent = { querySelector: () => null } as unknown as HTMLElement;
  expect(() => animateChipTransfers(absent, chipTransfers(null, setup[5]!), 1, false).cancel()).not.toThrow();
});
it('serves the animation dependency on Node and keeps the overlay non-interactive', () => {
  expect(readFileSync(new URL('../../src/web/server.ts', import.meta.url), 'utf8')).toContain("'/chip-motion.js'");
  const css = readFileSync(new URL('../../src/web/deck-skins.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.chip-motion-layer\s*\{[^}]*pointer-events:none/);
  expect(css).toContain('@media(prefers-reduced-motion:reduce) { .chip-motion-layer { display:none; } }');
});
