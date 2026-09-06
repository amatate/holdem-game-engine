import type { PublicGameEvent } from '../core/public-events.js';
import type { SeatIdentity, TableView } from './protocol.js';
import { applyPublicEvents } from './view.js';

export interface PlaybackFrame {
  view: TableView;
  event: PublicGameEvent;
  previousBoardCount: number;
  holdMs: number;
}

const HOLDS: Partial<Record<PublicGameEvent['type'], number>> = {
  positionsAssigned: 500, blindPosted: 400, ownHoleCardsDealt: 1000,
  playerActed: 800, communityCardsDealt: 1000, holeCardsRevealed: 1000,
  showdownStarted: 500, handEvaluated: 800, uncalledBetReturned: 800, potAwarded: 1200,
};

// No final packet or private engine state can enter the presentation timeline.
export function buildPlaybackFrames(
  previous: TableView | null, events: readonly PublicGameEvent[], roster: readonly SeatIdentity[],
): PlaybackFrame[] {
  let view = previous;
  const frames: PlaybackFrame[] = [];
  for (const event of events) {
    const previousBoardCount = view?.board.length ?? 0;
    view = applyPublicEvents(view, [event], roster);
    const holdMs = HOLDS[event.type];
    if (holdMs) frames.push({ view, event, previousBoardCount, holdMs });
  }
  return frames;
}

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;

// One virtual-time wait at a time. A rate change re-times the active wait as well.
export class PlaybackClock {
  speed = 1;
  skipped = false;
  private pending: {
    remaining: number; since: number; timer: ReturnType<typeof setTimeout>; resolve: () => void;
  } | null = null;

  start(): void { this.skip(); this.skipped = false; }
  setSpeed(value: number): void {
    if (!PLAYBACK_SPEEDS.some((speed) => speed === value)) return;
    const pending = this.pending;
    if (pending) {
      pending.remaining = Math.max(0, pending.remaining - (Date.now() - pending.since) * this.speed);
      clearTimeout(pending.timer);
    }
    this.speed = value;
    if (pending) this.schedule();
  }
  wait(duration: number): Promise<void> {
    if (this.skipped || duration <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      if (this.pending) throw new Error('Playback waits must be sequential');
      this.pending = { remaining: duration, since: Date.now(), timer: undefined as unknown as ReturnType<typeof setTimeout>, resolve };
      this.schedule();
    });
  }
  skip(): void {
    this.skipped = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const { resolve } = this.pending;
      this.pending = null;
      resolve();
    }
  }
  private schedule(): void {
    const pending = this.pending!;
    pending.since = Date.now();
    pending.timer = setTimeout(() => {
      this.pending = null;
      pending.resolve();
    }, pending.remaining / this.speed);
  }
}
