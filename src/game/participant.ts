import type {
  ActionDecision,
  DecisionContext,
  PokerAgent,
} from '../agents/types.js';
import type { ActionIntent } from '../core/legal-actions.js';

export interface Participant {
  readonly playerId: string;
  decide(context: Readonly<DecisionContext>): Promise<ActionDecision>;
}

function requirePlayerId(playerId: string): void {
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new Error('Participant playerId must be non-empty');
  }
}

function cloneIntent(intent: ActionIntent): ActionIntent {
  return intent.type === 'raiseTo'
    ? { type: 'raiseTo', amount: intent.amount }
    : { type: intent.type };
}

export class ScriptedParticipant implements Participant {
  public readonly playerId: string;
  readonly #actions: readonly ActionIntent[];
  #cursor = 0;

  public constructor(playerId: string, actions: readonly ActionIntent[]) {
    requirePlayerId(playerId);
    this.playerId = playerId;
    this.#actions = actions.map(cloneIntent);
  }

  public async decide(_context: Readonly<DecisionContext>): Promise<ActionDecision> {
    const action = this.#actions[this.#cursor];
    if (action === undefined) {
      throw new Error(`ScriptedParticipant action queue exhausted for ${this.playerId}`);
    }
    this.#cursor += 1;
    return { action: cloneIntent(action) };
  }
}

export class AgentParticipant implements Participant {
  public readonly playerId: string;
  readonly #agent: PokerAgent;

  public constructor(playerId: string, agent: PokerAgent) {
    requirePlayerId(playerId);
    this.playerId = playerId;
    this.#agent = agent;
  }

  public async decide(context: Readonly<DecisionContext>): Promise<ActionDecision> {
    return await this.#agent.decide(context);
  }
}
