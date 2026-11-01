import { Action, Bot, type GameState } from '@chipzen-ai/bot';
import { createHash, randomUUID } from 'node:crypto';
import { actionToChipzen, integer, matchContext, observationFromTurn, record, safeAction, textId, type MatchContext } from './adapter.js';
import type { DecisionRunner } from './worker.js';

export type Audit = (type: string, data: Record<string, unknown>) => void;

export class HoldemChipzenBot extends Bot {
  private context: MatchContext | undefined;
  private cache = new Map<string, { fingerprint: string; action: Action }>();
  private ready = new Map<string, Action>();
  private currentHand = 0;
  readonly policySeed = randomUUID();
  constructor(private readonly run: DecisionRunner, private readonly audit: Audit, private readonly maxDecisionMs = 1500) { super(); }

  override onMatchStart(message: Record<string, unknown>): void { this.context = matchContext(message); }
  override onReconnected(message: Record<string, unknown>): void { this.context = matchContext(message); }
  override decide(state: GameState): Action {
    const action = this.ready.get(state.requestId);
    if (!action) throw new Error('Raw turn was not prepared');
    this.ready.delete(state.requestId);
    return action;
  }

  /** Called by the transport reader BEFORE the SDK loses fields in parseGameState. */
  async prepare(message: Record<string, unknown>, receivedAt = performance.now()): Promise<void> {
    if (message.type === 'match_start' || message.type === 'reconnected') this.context = matchContext(message);
    if (message.type === 'reconnected' && message.pending_request) {
      await this.prepare(record(message.pending_request), receivedAt); return;
    }
    if (message.type !== 'turn_request') return;
    if (!this.context) throw new Error('Missing match context');
    const requestId = textId(message.request_id), s = record(message.state), hand = integer(s.hand_number, 1);
    if (hand < this.currentHand) throw new Error('Stale hand');
    if (hand > this.currentHand) { this.currentHand = hand; this.cache.clear(); this.ready.clear(); }
    const fingerprint = createHash('sha256').update(JSON.stringify([message.match_id, s, message.valid_actions])).digest('hex');
    const cached = this.cache.get(requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new Error('Reused request ID changed state');
      this.ready.set(requestId, cached.action); return;
    }
    if (!Array.isArray(message.valid_actions)) throw new Error('Missing valid actions');
    let action = safeAction(message.valid_actions), reason: string | null = null;
    const start = performance.now();
    try {
      const observation = observationFromTurn(message, this.context);
      const remaining = integer(message.remaining_ms ?? message.timeout_ms, 1) - (start - receivedAt) - 150;
      const budget = Math.min(this.maxDecisionMs, remaining);
      if (budget < 50) throw new Error('decision-timeout');
      const intent = await this.run(observation, `${this.policySeed}/${requestId}`, budget);
      if (performance.now() - start > budget) throw new Error('decision-timeout');
      action = actionToChipzen(intent, observation.legalActions);
      this.audit('observation', { requestId, observation });
    } catch (error) {
      reason = error instanceof Error && error.message === 'decision-timeout' ? 'timeout' : 'adapter-or-strategy-error';
    }
    this.cache.set(requestId, { fingerprint, action }); this.ready.set(requestId, action);
    this.audit('decision', { requestId, hand, phase: s.phase, action: action.toWire(), elapsedMs: performance.now() - start,
      fallback: reason, policySeed: this.policySeed });
  }
}
