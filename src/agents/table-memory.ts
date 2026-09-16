import type { PublicActionEvent } from '../core/public-events.js';
import type { StyleProfile, DecisionContext, ActionDecision } from './types.js';
import { CHARACTERS, type CharacterId } from './characters.js';
import { ParametricHoldemAgent, type ParametricHoldemAgentOptions } from './parametric-agent.js';
import type { Participant } from '../game/participant.js';
import type { HandCategory } from '../core/hand-evaluator.js';
import type { Street } from '../core/state.js';
import { personaProfile, pressuredBoard, type StreetPlan } from './persona-policy.js';

export interface PublicOutcome { hand: number; net: number; bigBlind: number }

export interface ActionEvidence {
  hands: number;
  actions: number;
  raises: number;
  calls: number;
  folds: number;
  aggressiveHands: number;
}

/** Public action history only. No cards, private trace, or ability receipts can enter this store. */
export class TableMemory {
  readonly #hands = new Map<number, readonly PublicActionEvent[]>();
  readonly #outcomes = new Map<number, Map<number, PublicOutcome>>();
  readonly #showdowns = new Map<number, Map<number, HandCategory>>();
  #latest = 0;

  observe(hand: number, history: readonly PublicActionEvent[]): void {
    if (hand < this.#latest - 7) return;
    this.#latest = Math.max(hand, this.#latest);
    for (const key of this.#hands.keys()) if (key < this.#latest - 7) this.#hands.delete(key);
    for (const key of this.#outcomes.keys()) if (key < this.#latest - 7) this.#outcomes.delete(key);
    for (const key of this.#showdowns.keys()) if (key < this.#latest - 7) this.#showdowns.delete(key);
    const previous = this.#hands.get(hand);
    // Every observation contains the same hand's full prefix. Refreshes and shorter prefixes are no-ops.
    if (previous && previous.length >= history.length) return;
    this.#hands.set(hand, history.map((event) => event.type === 'playerActed'
      ? { type: event.type, seatIndex: event.seatIndex, kind: event.kind, paid: event.paid, betTo: event.betTo, allIn: event.allIn }
      : { type: event.type, seatIndex: event.seatIndex, kind: event.kind, amount: event.amount, allIn: event.allIn }));
  }

  recordOutcome(hand: number, seat: number, net: number, bigBlind: number): void {
    if (hand < this.#latest - 7) return;
    const entries = this.#outcomes.get(hand) ?? new Map<number, PublicOutcome>();
    if (!entries.has(seat)) entries.set(seat, { hand, net, bigBlind });
    this.#outcomes.set(hand, entries);
  }

  lastSignificantOutcome(seat: number, beforeHand: number): PublicOutcome | null {
    const entries = [...this.#outcomes.values()].map((items) => items.get(seat))
      .filter((entry): entry is PublicOutcome => !!entry && entry.hand < beforeHand && Math.abs(entry.net) >= 10 * entry.bigBlind)
      .sort((a, b) => b.hand - a.hand);
    return entries[0] ? { ...entries[0] } : null;
  }

  recordShowdown(hand: number, seat: number, category: HandCategory): void {
    if (hand < this.#latest - 7) return;
    const entries = this.#showdowns.get(hand) ?? new Map<number, HandCategory>();
    if (!entries.has(seat)) entries.set(seat, category);
    this.#showdowns.set(hand, entries);
  }

  keyEvidence(seat: number, beforeHand: number): { pressureHands: number; shownHighCardAggression: number } {
    let pressureHands = 0; let shownHighCardAggression = 0;
    for (const [hand, events] of this.#hands) {
      if (hand >= beforeHand) continue;
      const raises = events.filter((event) => event.type === 'playerActed' && event.seatIndex === seat && (event.kind === 'bet' || event.kind === 'raise')).length;
      if (raises >= 2) pressureHands++;
      if (raises > 0 && this.#showdowns.get(hand)?.get(seat) === 'high-card') shownHighCardAggression++;
    }
    return { pressureHands, shownHighCardAggression };
  }

  evidence(seat: number, beforeHand = Infinity): ActionEvidence {
    const stats: ActionEvidence = { hands: 0, actions: 0, raises: 0, calls: 0, folds: 0, aggressiveHands: 0 };
    for (const [hand, events] of this.#hands) {
      if (hand >= beforeHand) continue;
      const actions = events.filter((event) => event.type === 'playerActed' && event.seatIndex === seat);
      if (!actions.length) continue;
      stats.hands++;
      stats.actions += actions.length;
      let aggressive = false;
      for (const event of actions) {
        if (event.kind === 'bet' || event.kind === 'raise') { stats.raises++; aggressive = true; }
        if (event.kind === 'call') stats.calls++;
        if (event.kind === 'fold') stats.folds++;
      }
      if (aggressive) stats.aggressiveHands++;
    }
    return stats;
  }
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Small, inspectable exploitative heuristics; this is not opponent-range solving or GTO. */
export function adaptProfile(base: Readonly<StyleProfile>, evidence: ActionEvidence,
  pressure: number, carryInitiative: boolean, mood: number): StyleProfile {
  const confidence = evidence.hands >= 3 ? Math.min(1, evidence.hands / 6) : 0;
  const aggressionRate = evidence.hands ? evidence.aggressiveHands / evidence.hands : 0;
  const foldRate = evidence.hands ? evidence.folds / evidence.hands : 0;
  const challenge = aggressionRate >= 0.6 ? 0.08 * confidence : 0;
  const steal = foldRate >= 0.6 ? 0.08 * confidence : 0;
  const caution = Math.min(0.1, Math.max(0, pressure - 1) * 0.04);
  return { ...base,
    aggression: clamp(base.aggression + steal + (carryInitiative ? 0.035 : 0) + mood * 0.025 - caution),
    stickiness: clamp(base.stickiness + challenge - caution),
    bluffing: clamp(base.bluffing + steal - caution),
    looseness: clamp(base.looseness + challenge / 2 - caution),
    riskAppetite: clamp(base.riskAppetite + mood * 0.025 - caution),
    sizing: { ...base.sizing },
  };
}

export class LivingParticipant implements Participant {
  readonly playerId: string;
  #hand = '';
  #initiative = false;
  #street: Street | null = null;
  #plan: StreetPlan = 'none';
  constructor(readonly characterId: CharacterId, readonly memory: TableMemory, readonly mood: () => number,
    readonly options?: Readonly<ParametricHoldemAgentOptions>) {
    const character = CHARACTERS[characterId];
    this.playerId = `${character.displayName}“${character.nickname}”`;
  }

  async decide(context: Readonly<DecisionContext>): Promise<ActionDecision> {
    const observation = context.observation;
    this.memory.observe(observation.handNumber, observation.actionHistory);
    if (this.#hand !== observation.handId) { this.#hand = observation.handId; this.#initiative = false; this.#street = null; this.#plan = 'none'; }
    if (this.#street !== observation.street) {
      this.#plan = this.#initiative ? pressuredBoard(observation) ? 'control' : 'pressure' : 'none';
      this.#street = observation.street;
    }
    const rivals = observation.seats.filter((seat) => seat.seatIndex !== observation.actorSeatIndex && (seat.status === 'active' || seat.status === 'all-in'));
    // Use the last publicly aggressive live opponent, not privileged hole-card information.
    const aggressor = [...observation.actionHistory].reverse().find((event) => event.type === 'playerActed'
      && (event.kind === 'bet' || event.kind === 'raise') && rivals.some((seat) => seat.seatIndex === event.seatIndex));
    const target = aggressor?.seatIndex ?? rivals[0]?.seatIndex ?? 0;
    const pressure = observation.actionHistory.filter((event) => event.type === 'playerActed'
      && event.seatIndex !== observation.actorSeatIndex && (event.kind === 'bet' || event.kind === 'raise')).length;
    const evidence = this.memory.evidence(target, observation.handNumber);
    // Kai's result reaction has a defined three-hand lifetime rather than an endless mood tail.
    const adapted = adaptProfile(CHARACTERS[this.characterId].profile, evidence, pressure, this.#initiative,
      this.characterId === 'maniac' ? 0 : this.mood());
    const profile = personaProfile(this.characterId, adapted, observation, { plan: this.#plan, evidence,
      ...this.memory.keyEvidence(target, observation.handNumber), outcome: this.memory.lastSignificantOutcome(observation.actorSeatIndex, observation.handNumber) });
    const decision = new ParametricHoldemAgent(this.characterId, profile, this.options).decide(context);
    this.#initiative = decision.action.type === 'raiseTo' || (decision.action.type === 'allIn'
      && observation.legalActions.allIn?.mode !== 'call');
    return decision;
  }
}
