import { Action } from '@chipzen-ai/bot';
import { deepFreezeObservation } from '../../agents/observation.js';
import type { PlayerObservationV1 } from '../../agents/types.js';
import { parseCard } from '../../core/cards.js';
import type { ActionIntent, LegalActionSet } from '../../core/legal-actions.js';
import type { Street } from '../../core/state.js';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid protocol object');
  return value as Record<string, unknown>;
}
export function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error('Invalid protocol integer');
  return value as number;
}
export function seat(value: unknown): number {
  const n = integer(value);
  if (n > 1) throw new Error('Only heads-up is supported');
  return n;
}
export function textId(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 200) throw new Error('Missing protocol ID');
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid protocol array');
  return value;
}
const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];
function street(value: unknown): Street {
  if (!STREETS.includes(value as Street)) throw new Error('Invalid betting phase');
  return value as Street;
}
export interface MatchContext {
  matchId: string;
  heroSeat: number;
  smallBlind: number;
  bigBlind: number;
}
export function matchContext(message: Record<string, unknown>): MatchContext {
  const config = record(message.game_config);
  const seats = list(message.seats).map(record);
  const hero = seats.filter(s => s.is_self === true);
  if (config.variant !== 'nlhe' || seats.length !== 2 || hero.length !== 1
    || (config.num_players !== undefined && config.num_players !== 2)
    || new Set(seats.map(s => seat(s.seat))).size !== 2) throw new Error('Expected heads-up NLHE match');
  const smallBlind = integer(config.small_blind, 1), bigBlind = integer(config.big_blind, 1);
  if (smallBlind > bigBlind) throw new Error('Invalid blinds');
  return { matchId: textId(message.match_id), heroSeat: seat(hero[0]!.seat), smallBlind, bigBlind };
}

/** Raw frames are intentional: SDK 0.3.1 drops history.phase and defaults missing yourSeat to 0. */
export function observationFromTurn(message: Record<string, unknown>, context: MatchContext): PlayerObservationV1 {
  if (message.match_id !== context.matchId || message.type !== 'turn_request') throw new Error('Wrong match');
  textId(message.request_id);
  const s = record(message.state), phase = street(s.phase), hero = context.heroSeat;
  if (message.seat !== undefined && seat(message.seat) !== hero) throw new Error('Wrong acting seat');
  if (s.your_seat !== undefined && seat(s.your_seat) !== hero) throw new Error('Wrong private seat');
  const cards = (v: unknown) => list(v).map(c => {
    if (typeof c !== 'string') throw new Error('Invalid card');
    return parseCard(c);
  });
  const hole = cards(s.your_hole_cards), board = cards(s.board);
  if (hole.length !== 2 || board.length !== [0, 3, 4, 5][STREETS.indexOf(phase)]
    || new Set([...hole, ...board].map(c => c.code)).size !== hole.length + board.length) throw new Error('Invalid card count/duplicates');
  const opponents = list(s.opponent_stacks).map(n => integer(n));
  if (opponents.length !== 1) throw new Error('Only heads-up is supported');
  const stacks = hero === 0 ? [integer(s.your_stack, 1), opponents[0]!] : [opponents[0]!, integer(s.your_stack, 1)];
  let currentStreet: Street = 'preflop';
  let bets = [0, 0];
  const committed = [0, 0], folded = [false, false];
  let button: number | undefined, bbSeat: number | undefined;
  const actions: PlayerObservationV1['actionHistory'][number][] = [];
  const history = list(s.action_history);
  if (history.length > 2000) throw new Error('History exceeds safety limit');
  for (const raw of history) {
    const entry = record(raw), who = seat(entry.seat), round = street(entry.phase), amount = integer(entry.amount);
    if (STREETS.indexOf(round) < STREETS.indexOf(currentStreet) || STREETS.indexOf(round) > STREETS.indexOf(phase)) throw new Error('Unordered history');
    if (round !== currentStreet) { currentStreet = round; bets = [0, 0]; }
    const previous = bets[who]!;
    if (entry.action === 'post_ante') { committed[who]! += amount; continue; }
    if (entry.action === 'post_small_blind' || entry.action === 'post_big_blind') {
      if (round !== 'preflop') throw new Error('Blind outside preflop');
      const small = entry.action === 'post_small_blind';
      if (small ? button !== undefined : bbSeat !== undefined) throw new Error('Duplicate blind');
      if (small) button = who; else bbSeat = who;
      bets[who]! += amount; committed[who]! += amount;
      actions.push({ type: 'blindPosted', seatIndex: who, kind: small ? 'small' : 'big', amount, allIn: false, street: round });
      continue;
    }
    const kind = entry.action;
    if (kind !== 'fold' && kind !== 'check' && kind !== 'call' && kind !== 'raise') throw new Error('Unsupported history action');
    if ((kind === 'check' || kind === 'fold') && amount !== 0) throw new Error('Nonzero free action');
    // Wire raises are totals; calls/blinds/antes are additional chips. Never sum raise-to totals.
    const paid = kind === 'raise' ? amount - previous : amount;
    if (paid < 0) throw new Error('Decreasing raise total');
    const wasBet = kind === 'raise' && Math.max(...bets) === 0;
    bets[who]! += paid; committed[who]! += paid;
    if (kind === 'fold') folded[who] = true;
    actions.push({ type: 'playerActed', seatIndex: who, kind: wasBet ? 'bet' : kind,
      paid, betTo: bets[who]!, allIn: false, street: round });
  }
  if (button === undefined || bbSeat === undefined || button === bbSeat) throw new Error('Missing blind/position history');
  if (s.dealer_seat !== undefined && seat(s.dealer_seat) !== button) throw new Error('Button/history mismatch');
  if (currentStreet !== phase) bets = [0, 0];
  const pot = integer(s.pot), toCall = integer(s.to_call);
  if (committed[0]! + committed[1]! !== pot || toCall !== Math.max(...bets) - bets[hero]!) throw new Error('Inconsistent contribution history');
  const valid = list(message.valid_actions);
  if (valid.length === 0 || valid.some(a => !['fold', 'check', 'call', 'raise'].includes(a as string))) throw new Error('Invalid legal actions');
  const can = (a: string) => valid.includes(a);
  if ((can('check') && toCall !== 0) || (can('call') && toCall === 0)) throw new Error('Invalid call/check price');
  const min = integer(s.min_raise), max = integer(s.max_raise), fullStack = bets[hero]! + stacks[hero]!;
  if (can('raise') && (min <= Math.max(...bets) || max < min || max > fullStack)) throw new Error('Invalid raise bounds');
  const pay = Math.min(stacks[hero]!, toCall);
  const allIn: LegalActionSet['allIn'] = can('call') && pay === stacks[hero]!
    ? { to: fullStack, mode: 'call' }
    : can('raise') && max === fullStack ? { to: max, mode: toCall === 0 ? 'fullBet' : 'fullRaise' } : null;
  // Mark historical all-ins only where no subsequent contribution exists, using public stacks.
  for (let i = 0; i < actions.length; i++) {
    const event = actions[i]!;
    const paid = event.type === 'blindPosted' ? event.amount : event.paid;
    if (paid > 0 && stacks[event.seatIndex] === 0 && !actions.slice(i + 1).some(a => a.seatIndex === event.seatIndex
      && (a.type === 'blindPosted' ? a.amount : a.paid) > 0)) actions[i] = { ...event, allIn: true };
  }
  return deepFreezeObservation({
    schemaVersion: 1, handId: `chipzen-hand-${integer(s.hand_number, 1)}`, handNumber: integer(s.hand_number, 1),
    decisionIndex: history.length, actorSeatIndex: hero, street: phase,
    holeCards: [hole[0]!, hole[1]!], board, buttonPosition: button, smallBlindSeat: button, bigBlindSeat: bbSeat,
    smallBlind: context.smallBlind, bigBlind: context.bigBlind, potTotal: pot,
    sidePots: [{ amount: pot, eligibleSeatIndexes: [0, 1].filter(i => !folded[i]) }],
    seats: [0, 1].map(i => ({ playerId: `chipzen-seat-${i}`, seatIndex: i, stack: stacks[i]!,
      status: folded[i] ? 'folded' : stacks[i] === 0 ? 'all-in' : 'active',
      committedStreet: bets[i]!, committedHand: committed[i]!, revealedHoleCards: null })),
    actionHistory: actions,
    legalActions: { fold: can('fold'), check: can('check'), call: can('call') ? { pay, to: bets[hero]! + pay, isAllIn: pay === stacks[hero] } : null,
      raiseTo: can('raise') ? { min, max } : null, allIn },
  });
}

export function safeAction(valid: readonly unknown[]): Action {
  if (valid.includes('check')) return Action.check();
  if (valid.includes('fold')) return Action.fold();
  throw new Error('No free legal fallback');
}

export function actionToChipzen(action: ActionIntent, legal: LegalActionSet): Action {
  if (action.type === 'fold' && legal.fold) return Action.fold();
  if (action.type === 'check' && legal.check) return Action.check();
  if (action.type === 'call' && legal.call) return Action.call();
  if (action.type === 'allIn' && legal.allIn) return legal.allIn.mode === 'call' ? Action.call() : Action.raiseTo(legal.allIn.to);
  if (action.type === 'raiseTo' && Number.isSafeInteger(action.amount) && legal.raiseTo
    && action.amount >= legal.raiseTo.min && action.amount <= legal.raiseTo.max) return Action.raiseTo(action.amount);
  throw new Error('Illegal strategy action');
}
