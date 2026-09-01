import type { TournamentConfig } from '../core/config.js';
import type { ActionIntent, ActionRejectionCode } from '../core/legal-actions.js';
import type { TournamentSeatInput } from '../core/state.js';
import type { Participant } from './participant.js';
import type { ControllerDiagnosticEvent } from './tournament-controller.js';
import type { TurnPacket } from './turn-packet.js';

declare const gameSessionHandleBrand: unique symbol;

export interface GameSessionHandle {
  readonly [gameSessionHandleBrand]: true;
}

export interface OpenGameSessionOptions {
  readonly mode: 'classic';
  readonly config: TournamentConfig;
  readonly runSeed: string;
  readonly humanSeatIndex: number;
  readonly seats: readonly TournamentSeatInput[];
  readonly participants: readonly (Participant | null)[];
  readonly maxTransitions?: number;
  readonly invalidAgentActionMode?: 'throw' | 'fallback';
  readonly onDiagnostic?: (
    event: Readonly<ControllerDiagnosticEvent>,
  ) => void | Promise<void>;
}

export type AbilityRejectionCode =
  | 'wrong-mode'
  | 'not-human-turn'
  | 'stale-decision'
  | 'stale-packet'
  | 'ability-spent'
  | 'ability-already-used-this-decision'
  | 'invalid-target'
  | 'target-cards-public'
  | 'invalid-hole-card-index'
  | 'deck-exhausted'
  | 'malformed-command';

export type SessionCommand =
  | Readonly<{
      type: 'act';
      decisionKey: string;
      expectedPacketIndex: number;
      intent: ActionIntent;
    }>
  | Readonly<{
      type: 'useAbility';
      decisionKey: string;
      expectedPacketIndex: number;
      ability: 'peek';
      targetSeatIndex: number;
    }>
  | Readonly<{
      type: 'useAbility';
      decisionKey: string;
      expectedPacketIndex: number;
      ability: 'read';
      targetSeatIndex: number;
    }>
  | Readonly<{
      type: 'useAbility';
      decisionKey: string;
      expectedPacketIndex: number;
      ability: 'swap';
      holeCardIndex: 0 | 1;
    }>;

export interface SessionStep {
  readonly handle: GameSessionHandle;
  readonly packet: Readonly<TurnPacket>;
}

export type SessionCommandResult =
  | Readonly<{ accepted: true; step: SessionStep }>
  | Readonly<{
      accepted: false;
      handle: GameSessionHandle;
      rejection: AbilityRejectionCode | ActionRejectionCode;
      packet: Readonly<TurnPacket>;
    }>;

export type SessionContinueResult =
  | Readonly<{ accepted: true; step: SessionStep }>
  | Readonly<{
      accepted: false;
      handle: GameSessionHandle;
      rejection: 'stale-packet' | 'wrong-boundary';
      packet: Readonly<TurnPacket>;
    }>;
