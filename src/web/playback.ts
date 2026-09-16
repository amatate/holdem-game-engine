import type { PublicGameEvent } from '../core/public-events.js';
import type { SeatIdentity, TableView } from './protocol.js';
import { applyPublicEvents } from './view.js';
import type { TableLine, MemoryNotice } from '../game/living-table.js';

export interface PlaybackFrame {
  view: TableView;
  event: PublicGameEvent;
  previousBoardCount: number;
  holdMs: number;
  line?: TableLine;
  memory?: MemoryNotice;
  reactionOnly?: boolean;
}

export interface PlaybackFeedback { packetIndex: number; lines: readonly TableLine[]; memories: readonly MemoryNotice[] }

const HOLDS: Partial<Record<PublicGameEvent['type'], number>> = {
  positionsAssigned: 500, blindPosted: 400, ownHoleCardsDealt: 1000,
  playerActed: 800, communityCardsDealt: 1000, holeCardsRevealed: 1000,
  showdownStarted: 500, handEvaluated: 800, uncalledBetReturned: 800, potAwarded: 1200,
};

// Only explicitly anchored public feedback may enter, never final notes or a final packet.
export function buildPlaybackFrames(
  previous: TableView | null, events: readonly PublicGameEvent[], roster: readonly SeatIdentity[],
  feedback?: PlaybackFeedback,
): PlaybackFrame[] {
  let view = previous;
  const frames: PlaybackFrame[] = [];
  let greetings: TableLine[] = [];
  for (const [eventIndex, event] of events.entries()) {
    const previousBoardCount = view?.board.length ?? 0;
    view = applyPublicEvents(view, [event], roster);
    const anchored = (item: TableLine | MemoryNotice) => item.packetIndex === feedback?.packetIndex && item.eventIndex === eventIndex;
    let lines = feedback?.lines.filter(anchored) ?? [];
    // An opening line must not expose placeholder/previous-hand blind positions.
    if (event.type === 'handStarted') { greetings = lines; continue; }
    if (event.type === 'positionsAssigned') { lines = [...greetings, ...lines]; greetings = []; }
    const memory = feedback?.memories.find(anchored);
    const holdMs = HOLDS[event.type] ?? 0;
    const line = lines[0];
    if (holdMs || line || memory) frames.push({ view, event, previousBoardCount,
      holdMs: Math.max(holdMs, feedbackHold(line, memory)), ...(line ? { line } : {}), ...(memory ? { memory } : {}) });
    for (const line of lines.slice(1)) frames.push({ view, event, previousBoardCount,
      holdMs: feedbackHold(line), line, reactionOnly: true });
  }
  return frames;
}

function feedbackHold(line?: TableLine, memory?: MemoryNotice): number {
  // Virtual milliseconds: follows speed changes and skip just like cards and chips.
  return line ? Math.min(4200, Math.max(2400, line.text.length * 85)) : memory ? 2600 : 0;
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
