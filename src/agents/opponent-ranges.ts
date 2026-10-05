import type { Card, RandomSource } from '../core/types.js';
import { evaluateBest, compareHandRanks } from '../core/hand-evaluator.js';
import type { PlayerObservationV1 } from './types.js';

export interface OpponentRead {
  readonly confidence: number;
  readonly aggression: number;
  readonly foldRate: number;
  readonly callRate: number;
  readonly bluffRate: number;
}
export type OpponentReads = ReadonlyMap<number, OpponentRead>;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const rounds = ['preflop', 'flop', 'turn', 'river'] as const;

/** Heuristic likelihood, not a solved hand range. Unknown / checked hands stay broad. */
export function rangeSignals(observation: Readonly<PlayerObservationV1>, seat: number) {
  return rounds.flatMap((street) => {
    const actions = observation.actionHistory.filter(e => e.type === 'playerActed' && e.seatIndex === seat
      && (e.street === street || (e.street === undefined && observation.street === 'preflop' && street === 'preflop')));
    const raises = actions.filter(e => e.kind === 'bet' || e.kind === 'raise').length;
    const calls = actions.filter(e => e.kind === 'call').length;
    if (!raises && !calls) return [];
    const count = street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
    // Never infer an earlier decision from a later public card.
    if (count > observation.board.length) return [];
    return [{ street, board: observation.board.slice(0, count), raises: Math.min(3, raises), calls: Math.min(2, calls) }];
  });
}

export function startingHandStrength(hole: readonly [Card, Card]): number {
  const [a, b] = hole;
  return clamp(.08 + (a.rank + b.rank - 4) / 24 * .55 + (a.rank === b.rank ? .35 : 0)
    + (a.suit === b.suit ? .06 : 0) + (Math.abs(a.rank - b.rank) === 1 ? .06 : 0));
}

function visibleStrength(hole: readonly [Card, Card], board: readonly Card[]): number {
  if (!board.length) return startingHandStrength(hole);
  const rank = evaluateBest([...hole, ...board]);
  // A strong board is not evidence that a player holds a strong private hand.
  if (board.length === 5 && compareHandRanks(rank, evaluateBest(board)) === 0) return .18;
  const values = { 'high-card': .12, 'one-pair': .43, 'two-pair': .65, 'three-of-a-kind': .78,
    straight: .86, flush: .9, 'full-house': .96, 'four-of-a-kind': .99, 'straight-flush': 1 };
  let strength = values[rank.category];
  if (rank.category === 'one-pair') {
    const ownPair = hole[0].rank === hole[1].rank;
    const matched = hole.filter(c => board.some(b => b.rank === c.rank));
    if (!ownPair && !matched.length) strength = .18; // board pair, not a made private pair
    else if ((ownPair ? hole[0].rank : Math.max(...matched.map(c => c.rank))) >= Math.max(...board.map(c => c.rank))) strength += .12;
  }
  if (board.length < 5) {
    const cards = [...hole, ...board];
    const flushDraw = hole.some(c => cards.filter(b => b.suit === c.suit).length === 4);
    const ranks = new Set<number>(cards.map(c => c.rank)); if (ranks.has(14)) ranks.add(1);
    const straightDraw = Array.from({ length: 10 }, (_, i) => i + 1).some(low =>
      Array.from({ length: 5 }, (_, i) => low + i).filter(n => ranks.has(n)).length === 4
      && hole.some(c => (c.rank >= low && c.rank <= low + 4 || c.rank === 14 && low === 1)
        && !board.some(b => b.rank === c.rank)));
    if (flushDraw || straightDraw) strength = Math.max(strength, .46);
  }
  return clamp(strength);
}

export function likelihood(strength: number, raises: number, calls: number, read?: OpponentRead): number {
  if (!raises && !calls) return 1;
  const confidence = read?.confidence ?? 0;
  const aggression = .35 + ((read?.aggression ?? .35) - .35) * confidence;
  const bluff = .10 + ((read?.bluffRate ?? .10) - .10) * confidence;
  if (raises) {
    const floor = .05 + bluff * .6; // Always preserve bluffs and mistaken reads.
    return floor + (1 - floor) * strength ** (1.6 + raises * .8 + (.35 - aggression) * 2);
  }
  const calling = .4 + ((read?.callRate ?? .4) - .4) * confidence;
  return .2 + calling * .35 + strength * (.8 - calling * .35);
}

interface Pair { a: Card; b: Card; weight: number; cumulative: number }
/** Sequential weighted sampling with card removal. Approximate multiway ranges, not GTO. */
export function prepareRangeDealer(observation: Readonly<PlayerObservationV1>, deck: readonly Card[], reads?: OpponentReads) {
  const opponents = observation.seats.filter(s => s.seatIndex !== observation.actorSeatIndex && (s.status === 'active' || s.status === 'all-in'));
  const signals = opponents.map(s => rangeSignals(observation, s.seatIndex));
  if (signals.every(s => !s.length)) return null;
  const strengths = new Map<string, number>();
  const tables = opponents.map((seat, index) => {
    const pairs: Pair[] = []; let cumulative = 0;
    for (let a = 0; a < deck.length; a++) for (let b = a + 1; b < deck.length; b++) {
      const one = deck[a]!, two = deck[b]!;
      let weight = 1;
      for (const signal of signals[index]!) {
        const key = one.code + two.code + signal.street;
        let strength = strengths.get(key);
        if (strength === undefined) { strength = visibleStrength([one, two], signal.board); strengths.set(key, strength); }
        weight *= likelihood(strength, signal.raises, signal.calls, reads?.get(seat.seatIndex));
      }
      cumulative += weight;
      pairs.push({ a: one, b: two, weight, cumulative });
    }
    return { pairs, total: cumulative };
  });
  return (random: RandomSource): Card[] => {
    const used = new Set<string>(), result: Card[] = [];
    for (const table of tables) {
      let pair: Pair | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        const roll = random.nextFloat() * table.total;
        let low = 0, high = table.pairs.length - 1;
        while (low < high) { const mid = (low + high) >>> 1; if (table.pairs[mid]!.cumulative > roll) high = mid; else low = mid + 1; }
        const candidate = table.pairs[low]!;
        if (!used.has(candidate.a.code) && !used.has(candidate.b.code)) { pair = candidate; break; }
      }
      if (!pair) {
        // Exact remaining distribution on collision exhaustion, not a uniform fallback.
        const available = table.pairs.filter(p => !used.has(p.a.code) && !used.has(p.b.code));
        let roll = random.nextFloat() * available.reduce((sum, p) => sum + p.weight, 0);
        pair = available[available.length - 1]!;
        for (const p of available) { roll -= p.weight; if (roll < 0) { pair = p; break; } }
      }
      result.push(pair.a, pair.b); used.add(pair.a.code); used.add(pair.b.code);
    }
    const remaining = deck.filter(c => !used.has(c.code));
    for (let n = 0; n < 5 - observation.board.length; n++) {
      const at = Math.floor(random.nextFloat() * remaining.length);
      result.push(remaining[at]!); remaining.splice(at, 1);
    }
    return result;
  };
}
