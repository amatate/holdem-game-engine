import { describe, expect, it, vi } from 'vitest';

const projectionControl = vi.hoisted(() => ({ emptyViewerSeatIndex: undefined as number | undefined }));
const driverControl = vi.hoisted(() => ({ openCalls: 0 }));

vi.mock('../../src/core/public-events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/public-events.js')>();
  return {
    ...actual,
    projectEventsForViewer: (
      events: Parameters<typeof actual.projectEventsForViewer>[0],
      viewerSeatIndex: Parameters<typeof actual.projectEventsForViewer>[1],
    ) => viewerSeatIndex === projectionControl.emptyViewerSeatIndex
      ? []
      : actual.projectEventsForViewer(events, viewerSeatIndex),
  };
});

vi.mock('../../src/game/tournament-driver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/game/tournament-driver.js')>();
  return {
    ...actual,
    openTournamentDriver: (
      options: Parameters<typeof actual.openTournamentDriver>[0],
    ) => {
      driverControl.openCalls += 1;
      return actual.openTournamentDriver(options);
    },
  };
});

import type { DecisionContext } from '../../src/agents/types.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { createSeededRandom } from '../../src/core/random.js';
import {
  AgentParticipant,
  ScriptedParticipant,
  type Participant,
} from '../../src/game/participant.js';
import { runTournament } from '../../src/game/tournament-controller.js';

const headsUp: TournamentConfig = {
  maxSeats: 2,
  startingStack: 2,
  handsPerLevel: 100,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('participants', () => {
  it('copies scripted actions, exhausts the copy, and forwards an agent decision', async () => {
    const source = [{ type: 'call' } as const];
    const scripted = new ScriptedParticipant('script', source);
    source.push({ type: 'check' } as never);

    await expect(scripted.decide(undefined as never)).resolves.toEqual({ action: { type: 'call' } });
    await expect(scripted.decide(undefined as never)).rejects.toThrow(/exhausted/i);

    const context = { observation: {} } as DecisionContext;
    const agent = {
      agentId: 'agent',
      decide: (received: Readonly<DecisionContext>) => {
        expect(received).toBe(context);
        return { action: { type: 'fold' } as const };
      },
    };
    await expect(new AgentParticipant('agent', agent).decide(context))
      .resolves.toEqual({ action: { type: 'fold' } });
  });
});

describe('runTournament', () => {
  it('awaits each authority and public callback before the next callback or participant', async () => {
    const authorityGate = deferred();
    const publicGate = deferred();
    const operations: string[] = [];
    let authorityCalls = 0;
    let publicCalls = 0;
    let participantCalls = 0;
    const participants: Participant[] = [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async () => {
        participantCalls += 1;
        return { action: { type: 'fold' } };
      },
    }));

    const running = runTournament({
      config: headsUp,
      participants,
      runSeed: 'controller-callback-blocking',
      publicViewerSeatIndex: 0,
      onAuthorityEvents: async (events) => {
        authorityCalls += 1;
        if (events[0]?.type !== 'GameStarted') return;
        operations.push('authority:start:GameStarted');
        await authorityGate.promise;
        operations.push('authority:end:GameStarted');
      },
      onPublicEvents: async (events) => {
        publicCalls += 1;
        if (events[0]?.type !== 'gameStarted') return;
        operations.push('public:start:gameStarted');
        await publicGate.promise;
        operations.push('public:end:gameStarted');
      },
    });

    await vi.waitFor(() => {
      expect(operations).toEqual(['authority:start:GameStarted']);
    });
    expect(authorityCalls).toBe(1);
    expect(publicCalls).toBe(0);
    expect(participantCalls).toBe(0);

    authorityGate.resolve();
    await vi.waitFor(() => {
      expect(operations).toEqual([
        'authority:start:GameStarted',
        'authority:end:GameStarted',
        'public:start:gameStarted',
      ]);
    });
    expect(authorityCalls).toBe(1);
    expect(publicCalls).toBe(1);
    expect(participantCalls).toBe(0);

    publicGate.resolve();
    await running;
    expect(operations).toEqual([
      'authority:start:GameStarted',
      'authority:end:GameStarted',
      'public:start:gameStarted',
      'public:end:gameStarted',
    ]);
    expect(participantCalls).toBeGreaterThan(0);
  });

  it('does not invoke the public callback for an empty projected batch', async () => {
    const authorityBatches: string[][] = [];
    const publicBatches: string[][] = [];
    const participants: Participant[] = [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async () => ({ action: { type: 'fold' } }),
    }));
    projectionControl.emptyViewerSeatIndex = 0;

    try {
      await expect(runTournament({
        config: headsUp,
        participants,
        runSeed: 'controller-empty-public-batch',
        maxTransitions: 1,
        publicViewerSeatIndex: 0,
        onAuthorityEvents: (events) => {
          authorityBatches.push(events.map((event) => event.type));
        },
        onPublicEvents: (events) => {
          publicBatches.push(events.map((event) => event.type));
        },
      })).rejects.toThrow(/event guard/i);
    } finally {
      projectionControl.emptyViewerSeatIndex = undefined;
    }

    expect(authorityBatches).toEqual([['GameStarted']]);
    expect(publicBatches).toEqual([]);
  });

  it.each([
    ['negative', -1],
    ['fractional', 0.5],
    ['out-of-range', 2],
  ])('rejects a %s public viewer before opening the driver or invoking user code', async (
    _label,
    publicViewerSeatIndex,
  ) => {
    const participantOperations: string[] = [];
    const authorityOperations: string[] = [];
    const publicOperations: string[] = [];
    driverControl.openCalls = 0;
    const participants: Participant[] = [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async () => {
        participantOperations.push(`participant:${seatIndex}`);
        return { action: { type: 'fold' } };
      },
    }));

    await expect(runTournament({
      config: headsUp,
      participants,
      runSeed: 'controller-invalid-viewer',
      publicViewerSeatIndex,
      onAuthorityEvents: () => { authorityOperations.push('authority'); },
      onPublicEvents: () => { publicOperations.push('public'); },
    })).rejects.toThrow('publicViewerSeatIndex must identify a physical seat');

    expect(driverControl.openCalls).toBe(0);
    expect(participantOperations).toEqual([]);
    expect(authorityOperations).toEqual([]);
    expect(publicOperations).toEqual([]);
  });

  it('routes the physical actor with the exact decision RNG path and reaches one champion', async () => {
    const calls: Array<{ seat: number; decision: number; seedHash: number }> = [];
    const participants: Participant[] = [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async ({ observation, random }) => {
        calls.push({
          seat: observation.actorSeatIndex,
          decision: observation.decisionIndex,
          seedHash: random.seedHash,
        });
        const legal = observation.legalActions;
        if (legal.call !== null) return { action: { type: 'call' } };
        if (legal.check) return { action: { type: 'check' } };
        return { action: { type: 'fold' } };
      },
    }));

    const state = await runTournament({
      config: headsUp,
      participants,
      runSeed: 'controller-fixture-0',
    });

    expect(calls).toEqual([{
      seat: 0,
      decision: 0,
      seedHash: createSeededRandom('controller-fixture-0', 'agent/1/0/0').seedHash,
    }]);
    expect(state.activeHand?.phase).toBe('game-complete');
    expect(state.seats.filter((seat) => seat.stack > 0)).toHaveLength(1);
    expect(state.eventLog.filter((event) => event.type === 'GameCompleted')).toHaveLength(1);
  });

  it('keeps strict failures pure and fallback emits one diagnostic without exposing private events', async () => {
    const passive: Participant = {
      playerId: 'passive',
      decide: async ({ observation }) => ({
        action: observation.legalActions.check
          ? { type: 'check' }
          : observation.legalActions.call !== null
            ? { type: 'call' }
            : { type: 'fold' },
      }),
    };
    const invalidOnce = (): Participant => {
      let first = true;
      return {
        playerId: 'invalid',
        decide: async (context) => {
          if (first) {
            first = false;
            return { action: { type: 'check' } };
          }
          return passive.decide(context);
        },
      };
    };
    const strictEvents: string[] = [];
    await expect(runTournament({
      config: headsUp,
      participants: [invalidOnce(), passive],
      runSeed: 'strict-invalid',
      onAuthorityEvents: (events) => { strictEvents.push(...events.map((event) => event.type)); },
    })).rejects.toThrow(/action|legal/i);
    expect(strictEvents).not.toContain('PlayerActed');

    const diagnostics: unknown[] = [];
    const publicTypes: string[] = [];
    const state = await runTournament({
      config: headsUp,
      participants: [invalidOnce(), passive],
      runSeed: 'fallback-invalid',
      invalidAgentActionMode: 'fallback',
      publicViewerSeatIndex: null,
      onDiagnostic: (event) => { diagnostics.push(event); },
      onPublicEvents: (events) => { publicTypes.push(...events.map((event) => event.type)); },
    });

    expect(diagnostics).toEqual([expect.objectContaining({
      type: 'AgentInvalidAction',
      playerId: 'invalid',
      seatIndex: 0,
      decisionIndex: 0,
      attemptedType: 'check',
      rejectionCode: 'action-not-legal',
      fallbackAction: 'fold',
    })]);
    expect(publicTypes).not.toContain('ownHoleCardsDealt');
    expect(publicTypes).not.toContain('DeckPrepared');
    expect(publicTypes).not.toContain('CardBurned');
    expect(state.activeHand?.phase).toBe('game-complete');
  });
});
