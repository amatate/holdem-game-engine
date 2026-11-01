import type { PublicGameEvent } from '../core/public-events.js';
import type { TableView } from './protocol.js';
import { chipPieces, chipFace, chipOffset, renderChipPile } from './chips.js';

export type ChipAnchor = { zone: 'pot' } | { zone: 'stack' | 'bet'; seatIndex: number };
export interface ChipTransfer {
  kind: 'bet' | 'collect' | 'refund' | 'award';
  from: ChipAnchor;
  to: ChipAnchor;
  amount: number;
}
// Fast playback still needs enough wall time to see a transfer. Skip remains instant.
export const CHIP_MAX_SPEED = 2;
const FLIGHT_MS = { bet: 850, collect: 900, refund: 900, award: 1150 } as const;
const STAGGER_MS = 65;
const TRAIL_MS = 32;
const SETTLE_MS = 160;

/** Only public, already-reached events; no RNG, authoritative state or future packet. */
export function chipTransfers(previous: TableView | null, event: PublicGameEvent): ChipTransfer[] {
  if (event.type === 'blindPosted' || event.type === 'playerActed') {
    const amount = event.type === 'blindPosted' ? event.amount : event.paid;
    return amount > 0 ? [{ kind: 'bet', amount, from: { zone: 'stack', seatIndex: event.seatIndex },
      to: { zone: 'bet', seatIndex: event.seatIndex } }] : [];
  }
  if (event.type === 'bettingRoundClosed') return (previous?.seats ?? [])
    .filter(seat => seat.committedStreet > 0)
    .map(seat => ({ kind: 'collect', amount: seat.committedStreet,
      from: { zone: 'bet', seatIndex: seat.seatIndex }, to: { zone: 'pot' } }));
  if (event.type === 'uncalledBetReturned') return event.amount > 0 ? [{ kind: 'refund', amount: event.amount,
    from: { zone: 'pot' }, to: { zone: 'stack', seatIndex: event.seatIndex } }] : [];
  if (event.type === 'potAwarded') return event.winners.flatMap((seatIndex, index) => {
    const amount = event.amounts[index] ?? 0;
    return amount > 0 ? [{ kind: 'award' as const, amount, from: { zone: 'pot' as const },
      to: { zone: 'stack' as const, seatIndex } }] : [];
  });
  return [];
}

export function chipMotionDuration(transfers: readonly ChipTransfer[]): number {
  return transfers.reduce((max, transfer, index) => Math.max(max,
    index * STAGGER_MS + FLIGHT_MS[transfer.kind] + Math.max(0, chipPieces(transfer.amount).length - 1) * TRAIL_MS + SETTLE_MS), 0);
}

interface Point { x: number; y: number }
/** Coordinates are local to the overlay; subtracting its bounds avoids border/scroll offsets. */
export function chipKeyframes(from: Point, to: Point, lane: number): Keyframe[] {
  const transform = (x: number, y: number, rotation: number, scale: number) =>
    `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
  return [
    { transform: transform(from.x, from.y, lane % 2 ? -3 : 3, 1), opacity: 0, offset: 0 },
    { transform: transform(from.x, from.y, lane % 2 ? -3 : 3, 1), opacity: 1, offset: .06 },
    { transform: transform((from.x + to.x) / 2, (from.y + to.y) / 2 - 4, 0, 1), opacity: 1, offset: .5 },
    { transform: transform(to.x, to.y, 0, 1), opacity: 1, offset: .87 },
    { transform: transform(to.x, to.y + 1, 0, .98), opacity: 1, offset: .95 },
    { transform: transform(to.x, to.y, 0, 1), opacity: 1, offset: 1 },
  ];
}

export interface ChipMotionPlayback { setSpeed(speed: number): void; cancel(): void }

/** Purely disposable presentation. Cancel/skip removes every sprite and landing effect. */
export function animateChipTransfers(root: HTMLElement, transfers: readonly ChipTransfer[],
  speed: number, reducedMotion: boolean): ChipMotionPlayback {
  const animations: Animation[] = [];
  const arrivals: Promise<unknown>[] = [];
  const restores: (() => void)[] = [];
  let restored = false;
  const restore = () => { if (!restored) { restored = true; restores.forEach(fn => fn()); } };
  let layer: HTMLElement | null = null;
  const playback: ChipMotionPlayback = {
    setSpeed(value) { if (Number.isFinite(value) && value > 0) animations.forEach(animation => { animation.playbackRate = Math.min(value, CHIP_MAX_SPEED); }); },
    cancel() { restore(); animations.forEach(animation => animation.cancel()); layer?.remove(); layer = null; },
  };
  const arena = root.querySelector<HTMLElement>('.arena');
  if (reducedMotion || !transfers.length || !arena || typeof arena.animate !== 'function') return playback;
  const doc = root.ownerDocument;
  layer = doc.createElement('div');
  layer.className = 'chip-motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  arena.append(layer);
  const bounds = layer.getBoundingClientRect();
  const resolve = (anchor: ChipAnchor) => anchor.zone === 'pot' ? root.querySelector<HTMLElement>('.pot-chip-bank')
    : root.querySelector<HTMLElement>(`[data-seat="${anchor.seatIndex}"] .${anchor.zone === 'stack' ? 'seat-stack' : 'bet-chip-bank'}`);
  const point = (element: Element): Point => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2 - bounds.left, y: box.top + box.height / 2 - bounds.top };
  };
  const animate = (element: Element, frames: Keyframe[], duration: number, delay = 0) => {
    const animation = element.animate(frames, { duration, delay, fill: 'both', easing: 'cubic-bezier(.22,.61,.36,1)' });
    animation.playbackRate = Math.min(speed, CHIP_MAX_SPEED);
    animations.push(animation);
    return animation;
  };
  // Keep the previous physical pile until arriving chips actually land. Public totals
  // and engine state remain authoritative; these local DOM snapshots are disposable.
  const keepPreviousPile = (bank: HTMLElement, incoming: number) => {
    const finalAmount = Number(bank.dataset.chipTotal);
    if (!Number.isSafeInteger(finalAmount)) return;
    const finalHtml = bank.innerHTML;
    bank.innerHTML = renderChipPile(Math.max(0, finalAmount - incoming));
    restores.push(() => { bank.innerHTML = finalHtml; });
  };
  const pot = root.querySelector<HTMLElement>('.pot-chip-bank');
  const collecting = transfers.filter(move => move.kind === 'collect').reduce((sum, move) => sum + move.amount, 0);
  if (pot && collecting) keepPreviousPile(pot, collecting);
  transfers.forEach((transfer, index) => {
    const origin = resolve(transfer.from), target = resolve(transfer.to);
    if (!origin || !target) return;
    const from = point(origin), to = point(target);
    const flight = FLIGHT_MS[transfer.kind], delay = index * STAGGER_MS;
    const pieces = chipPieces(transfer.amount);
    const count = pieces.length;
    if (transfer.from.zone === 'bet') animate(origin, [{ opacity: 0 }, { opacity: 0 }], chipMotionDuration(transfers));
    if (transfer.to.zone === 'bet') keepPreviousPile(target, transfer.amount);
    for (const [lane, piece] of pieces.entries()) {
      const sprite = doc.createElement('span');
      sprite.className = `flying-chip chip-flight chip-flight-${transfer.kind}`;
      sprite.dataset.chipFrom = transfer.from.zone;
      sprite.dataset.chipTo = transfer.to.zone;
      sprite.dataset.chipAmount = String(piece.denomination * piece.units);
      sprite.dataset.transferAmount = String(transfer.amount);
      sprite.innerHTML = chipFace(piece.denomination, piece.units);
      if (lane === count - 1) {
        const label = doc.createElement('span'); label.className = 'chip-flight-amount';
        label.textContent = `${transfer.kind === 'award' || transfer.kind === 'refund' ? '+' : ''}${transfer.amount.toLocaleString('en-US')}`;
        sprite.append(label);
      }
      layer!.append(sprite);
      const width = sprite.getBoundingClientRect().width || 30;
      const offset = chipOffset(piece, pieces, width);
      const start = { x: from.x + offset.x, y: from.y + offset.y };
      const end = { x: to.x + offset.x, y: to.y + offset.y };
      const motion = animate(sprite, chipKeyframes(start, end, lane), flight, delay + lane * TRAIL_MS);
      // Local references only: completion can never affect a later frame's DOM or money.
      void motion.finished.then(() => sprite.remove(), () => sprite.remove());
      arrivals.push(motion.finished.catch(() => {}));
    }
    const landing = target;
    const impact = transfer.kind === 'award' ? 1.09 : 1.04;
    const pop = animate(landing, [
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: `scale(${impact})`, filter: 'brightness(1.35)', offset: .35 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], SETTLE_MS, delay + flight - 100 + (count - 1) * TRAIL_MS);
    // Avoid a pre-arrival fill effect on static elements.
    if (pop.effect) pop.effect.updateTiming({ fill: 'none', easing: 'ease-out' });
  });
  void Promise.all(arrivals).then(restore);
  return playback;
}
