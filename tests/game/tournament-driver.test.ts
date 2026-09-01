import { describe, expect, it } from 'vitest';

import type { ActionIntent } from '../../src/core/legal-actions.js';
import { applyIntent } from '../../src/core/reducer.js';
import type { TournamentConfig } from '../../src/core/config.js';
import type { TournamentState, TransitionResult } from '../../src/core/state.js';
import type { Participant } from '../../src/game/participant.js';
import { runTournament } from '../../src/game/tournament-controller.js';
import {
  createTournamentDriver,
  openTournamentDriver,
  type DriverBoundary,
  type DriverTransitionBatch,
  type PreparedDriverTransition,
  type TournamentDriverOptions,
} from '../../src/game/tournament-driver.js';

const decisionConfig: TournamentConfig = {
  maxSeats: 2,
  startingStack: 10,
  handsPerLevel: 100,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};

const oneHandConfig: TournamentConfig = {
  ...decisionConfig,
  startingStack: 2,
};

function passiveParticipant(
  playerId: string,
  onDecision: (seatIndex: number) => void = () => undefined,
): Participant {
  return {
    playerId,
    decide: async ({ observation }) => {
      onDecision(observation.actorSeatIndex);
      const legal = observation.legalActions;
      if (legal.check) return { action: { type: 'check' } };
      if (legal.call !== null) return { action: { type: 'call' } };
      return { action: { type: 'fold' } };
    },
  };
}

function options(
  overrides: Partial<TournamentDriverOptions> = {},
): TournamentDriverOptions {
  return {
    config: decisionConfig,
    runSeed: 'driver-test-seed',
    seats: [
      { playerId: 'human', seatIndex: 0 },
      { playerId: 'npc', seatIndex: 1 },
    ],
    participants: [null, passiveParticipant('npc')],
    pauseSeatIndexes: [0],
    ...overrides,
  };
}

function isRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((child) => isRecursivelyFrozen(child, seen));
}

type ObjectMetadata = Readonly<{
  object: object;
  frozen: boolean;
  descriptors: Readonly<Record<string, Readonly<{
    configurable: boolean;
    enumerable: boolean;
    writable: boolean | null;
  }>>>;
}>;

function snapshotObjectMetadata(root: object): readonly ObjectMetadata[] {
  const seen = new WeakSet<object>();
  const snapshots: ObjectMetadata[] = [];
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    snapshots.push({
      object: value,
      frozen: Object.isFrozen(value),
      descriptors: Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        {
          configurable: descriptor.configurable ?? false,
          enumerable: descriptor.enumerable ?? false,
          writable: 'writable' in descriptor ? descriptor.writable ?? false : null,
        },
      ])),
    });
    for (const descriptor of Object.values(descriptors)) {
      if ('value' in descriptor) visit(descriptor.value);
    }
  };
  visit(root);
  return snapshots;
}

function expectMetadataUnchanged(snapshots: readonly ObjectMetadata[]): void {
  for (const snapshot of snapshots) {
    expect(Object.isFrozen(snapshot.object)).toBe(snapshot.frozen);
    const descriptors = Object.getOwnPropertyDescriptors(snapshot.object);
    expect(Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      {
        configurable: descriptor.configurable ?? false,
        enumerable: descriptor.enumerable ?? false,
        writable: 'writable' in descriptor ? descriptor.writable ?? false : null,
      },
    ]))).toEqual(snapshot.descriptors);
  }
}

type ReachableMetadata = Readonly<{
  path: string;
  prototype: 'array' | 'object' | 'null';
  frozen: boolean;
  descriptors: readonly Readonly<{
    key: string;
    kind: 'data' | 'accessor';
    configurable: boolean;
    enumerable: boolean;
    writable: boolean | null;
  }>[];
}>;

function snapshotReachableMetadata(root: object): readonly ReachableMetadata[] {
  const seen = new WeakSet<object>();
  const snapshots: ReachableMetadata[] = [];
  const visit = (value: unknown, path: string): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    const prototype = Object.getPrototypeOf(value) as object | null;
    const keys = Reflect.ownKeys(value);
    snapshots.push({
      path,
      prototype: prototype === null ? 'null' : Array.isArray(value) ? 'array' : 'object',
      frozen: Object.isFrozen(value),
      descriptors: keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        return {
          key: typeof key === 'symbol' ? `[${String(key)}]` : key,
          kind: 'value' in descriptor ? 'data' : 'accessor',
          configurable: descriptor.configurable ?? false,
          enumerable: descriptor.enumerable ?? false,
          writable: 'writable' in descriptor ? descriptor.writable ?? false : null,
        };
      }),
    });
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if ('value' in descriptor) {
        const segment = typeof key === 'symbol' ? `[${String(key)}]` : key;
        visit(descriptor.value, `${path}.${segment}`);
      }
    }
  };
  visit(root, '$');
  return snapshots;
}

async function openDecisionDriver(
  overrides: Partial<TournamentDriverOptions> = {},
) {
  return await openTournamentDriver(options(overrides));
}

describe('TournamentDriver opening and validation', () => {
  it('starts uncommitted and prepares exactly to the paused seat before synchronous commit', async () => {
    const npcSeats: number[] = [];
    const driver = createTournamentDriver(options({
      participants: [null, passiveParticipant('npc', (seatIndex) => npcSeats.push(seatIndex))],
    }));

    expect(() => driver.getBoundary()).toThrow('Tournament driver is not committed');
    expect(() => driver.getAuthorityState()).toThrow('Tournament driver is not committed');

    const preparedOpen = await driver.prepareOpen();
    expect(preparedOpen.candidateBoundary).toMatchObject({ kind: 'decision', seatIndex: 0 });
    expect(preparedOpen.candidateAuthorityState.activeHand?.currentActorSeat).toBe(0);
    expect(npcSeats).toEqual([]);
    expect(() => driver.getAuthorityState()).toThrow('Tournament driver is not committed');

    const boundary = driver.commitPreparedTransition(preparedOpen);
    expect(boundary).toBe(preparedOpen.candidateBoundary);
    expect(driver.getBoundary()).toBe(boundary);
    expect(driver.getAuthorityState().activeHand?.currentActorSeat).toBe(0);

    const preparedAction = await driver.preparePausedAction(0, { type: 'call' }, 0);
    expect(npcSeats.length).toBeGreaterThan(0);
    expect(npcSeats.every((seatIndex) => seatIndex === 1)).toBe(true);
    driver.discardPreparedTransition(preparedAction);
  });

  it.each([
    ['mismatched seat/provider lengths', { participants: [null] }, /count|length/i],
    ['non-contiguous seat indexes', { seats: [{ playerId: 'human', seatIndex: 0 }, { playerId: 'npc', seatIndex: 2 }] }, /seat/i],
    ['duplicate player IDs', { seats: [{ playerId: 'same', seatIndex: 0 }, { playerId: 'same', seatIndex: 1 }] }, /playerId/i],
    ['empty player ID', { seats: [{ playerId: '', seatIndex: 0 }, { playerId: 'npc', seatIndex: 1 }] }, /playerId/i],
    ['null provider outside pause set', { participants: [null, null] }, /provider|participant/i],
    ['provider ID mismatch', { participants: [null, passiveParticipant('wrong')] }, /playerId/i],
    ['negative pause index', { pauseSeatIndexes: [-1] }, /pause/i],
    ['duplicate pause index', { pauseSeatIndexes: [0, 0] }, /pause/i],
    ['zero maxTransitions', { maxTransitions: 0 }, /maxTransitions/i],
    ['unsafe maxTransitions', { maxTransitions: Number.MAX_SAFE_INTEGER + 1 }, /maxTransitions/i],
  ])('rejects %s', (_name, override, message) => {
    expect(() => createTournamentDriver(options(override as Partial<TournamentDriverOptions>)))
      .toThrow(message as RegExp);
  });
});

describe('TournamentDriver boundaries and transactions', () => {
  it('returns rejected poker intents as unchanged discardable candidates', async () => {
    const driver = await openDecisionDriver();
    const before = structuredClone(driver.getAuthorityState());
    const rejected = await driver.preparePausedAction(0, { type: 'check' }, 0);

    expect(rejected.rejection).toMatchObject({ code: 'action-not-legal' });
    expect(rejected.candidateAuthorityState).toEqual(before);
    expect(rejected.transitionBatches).toEqual([]);
    driver.discardPreparedTransition(rejected);
    expect(driver.getAuthorityState()).toEqual(before);
  });

  it('rejects operations from the wrong boundary and pauses once before each hand continuation', async () => {
    const driver = await openDecisionDriver({ config: oneHandConfig });
    await expect(driver.preparePausedAction(1, { type: 'fold' }, 0))
      .rejects.toThrow(/paused seat|seat/i);
    await expect(driver.prepareContinueAfterHand()).rejects.toThrow(/hand-complete/i);

    const hand = await driver.preparePausedAction(0, { type: 'call' }, 0);
    expect(hand.candidateBoundary).toEqual({ kind: 'hand-complete', handNumber: 1 });
    driver.commitPreparedTransition(hand);
    await expect(driver.preparePausedAction(0, { type: 'fold' }, 1))
      .rejects.toThrow(/decision/i);

    const game = await driver.prepareContinueAfterHand();
    expect(game.candidateBoundary).toEqual({ kind: 'game-complete', winnerSeatIndex: 1 });
    expect(driver.getBoundary()).toEqual({ kind: 'hand-complete', handNumber: 1 });
    driver.commitPreparedTransition(game);
    await expect(driver.prepareContinueAfterHand()).rejects.toThrow(/hand-complete/i);
  });

  it('accepts one authority transition batch without advancing the current decision', async () => {
    const batches: DriverTransitionBatch[] = [];
    const driver = await openDecisionDriver({
      onAcceptedTransition: (batch) => { batches.push(batch); },
    });
    batches.length = 0;
    const state = driver.getAuthorityState();
    const prepared = await driver.prepareAuthorityTransition(
      { state, events: [] },
      'ability-swap',
      7,
    );

    expect(prepared.rejection).toBeNull();
    expect(prepared.candidateBoundary).toMatchObject({ kind: 'decision', seatIndex: 0 });
    expect(prepared.transitionBatches).toEqual([
      expect.objectContaining({
        source: 'ability-swap',
        commandIndex: 7,
        beforeVersion: state.version,
        afterVersion: state.version,
        authorityEvents: [],
      }),
    ]);
    expect(batches).toEqual(prepared.transitionBatches);
    driver.discardPreparedTransition(prepared);

    for (const commandIndex of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(driver.prepareAuthorityTransition(
        { state, events: [] },
        'ability-swap',
        commandIndex,
      )).rejects.toThrow(/commandIndex/i);
    }
  });

  it('closes both the transition-version and replay-mismatch guard holes', async () => {
    const driver = await openDecisionDriver();
    const state = driver.getAuthorityState();
    await expect(driver.prepareAuthorityTransition({
      state: { ...state, version: state.version + 1 },
      events: [],
    }, 'ability-swap', 0)).rejects.toThrow(/version mismatch/i);

    await expect(driver.prepareAuthorityTransition({
      state: { ...state, runSeed: 'forged' },
      events: [],
    }, 'ability-swap', 0)).rejects.toThrow(/replay mismatch/i);

    const guarded = createTournamentDriver(options({ maxTransitions: 1 }));
    await expect(guarded.prepareOpen()).rejects.toThrow(/event guard exceeded/i);
  });

  it('rejects forged authority state even when a hidden toJSON hook disguises it', async () => {
    const driver = await openDecisionDriver();
    const committed = driver.getAuthorityState();
    let toJSONCalls = 0;
    const forged = { ...committed, runSeed: 'forged-run-seed' } as TournamentState;
    Object.defineProperty(forged, 'toJSON', {
      configurable: true,
      enumerable: false,
      value: () => {
        toJSONCalls += 1;
        return committed;
      },
    });

    await expect(driver.prepareAuthorityTransition(
      { state: forged, events: [] },
      'ability-swap',
      0,
    )).rejects.toThrow(/replay mismatch/i);
    expect(toJSONCalls).toBe(0);
    expect(driver.getAuthorityState()).toBe(committed);

    const retry = await driver.prepareAuthorityTransition(
      { state: committed, events: [] },
      'ability-swap',
      1,
    );
    driver.discardPreparedTransition(retry);
    expect(driver.getAuthorityState()).toBe(committed);
  });

  it('enforces one active lease during pending and prepared operations', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let callbackCount = 0;
    const driver = createTournamentDriver(options({
      onAcceptedTransition: async () => {
        callbackCount += 1;
        if (callbackCount === 1) await gate;
      },
    }));

    const pending = driver.prepareOpen();
    await Promise.resolve();
    await expect(driver.prepareOpen()).rejects.toThrow('Session operation already in progress');
    expect(() => driver.getAuthorityState()).toThrow('Tournament driver is not committed');
    release();
    const prepared = await pending;
    await expect(driver.prepareOpen()).rejects.toThrow('Session operation already in progress');
    driver.discardPreparedTransition(prepared);

    const replacement = await driver.prepareOpen();
    driver.commitPreparedTransition(replacement);
  });

  it('publishes detached recursively frozen candidates and batches while keeping commit state mutable', async () => {
    const driver = createTournamentDriver(options());
    const prepared = await driver.prepareOpen();

    expect(isRecursivelyFrozen(prepared)).toBe(true);
    expect(isRecursivelyFrozen(prepared.candidateBoundary)).toBe(true);
    expect(isRecursivelyFrozen(prepared.candidateAuthorityState)).toBe(true);
    expect(isRecursivelyFrozen(prepared.transitionBatches)).toBe(true);

    const publicCandidate = prepared.candidateAuthorityState;
    const committed = driver.commitPreparedTransition(prepared);
    const authority = driver.getAuthorityState();
    expect(committed).toBe(prepared.candidateBoundary);
    expect(authority).not.toBe(publicCandidate);
    expect(authority).toEqual(publicCandidate);
    expect(Object.isFrozen(authority)).toBe(false);
    expect(Object.isFrozen(authority.seats)).toBe(false);
    expect(Object.isFrozen(authority.eventLog)).toBe(false);
  });

  it('rejects forged, foreign-driver, and stale prepared objects before mutation', async () => {
    const first = createTournamentDriver(options());
    const second = createTournamentDriver(options({ runSeed: 'second-driver' }));
    const prepared = await first.prepareOpen();
    const forged = structuredClone(prepared) as PreparedDriverTransition;

    expect(() => first.commitPreparedTransition(forged))
      .toThrow('Invalid prepared driver transition');
    expect(() => second.commitPreparedTransition(prepared))
      .toThrow('Invalid prepared driver transition');
    expect(() => first.getAuthorityState()).toThrow('Tournament driver is not committed');

    first.commitPreparedTransition(prepared);
    const committed = first.getAuthorityState();
    expect(() => first.commitPreparedTransition(prepared))
      .toThrow('Invalid prepared driver transition');
    expect(first.getAuthorityState()).toBe(committed);
  });

  it('discard preserves every reachable committed object, descriptor, event, and boundary', async () => {
    const driver = await openDecisionDriver();
    const authority = driver.getAuthorityState();
    const boundary = driver.getBoundary();
    const version = authority.version;
    const eventCount = authority.eventLog.length;
    const metadata = snapshotObjectMetadata(authority);

    const prepared = await driver.preparePausedAction(0, { type: 'call' }, 0);
    driver.discardPreparedTransition(prepared);

    expect(driver.getAuthorityState()).toBe(authority);
    expect(driver.getBoundary()).toBe(boundary);
    expect(driver.getAuthorityState().version).toBe(version);
    expect(driver.getAuthorityState().eventLog).toHaveLength(eventCount);
    expectMetadataUnchanged(metadata);

    const next = await driver.preparePausedAction(0, { type: 'fold' }, 1);
    driver.discardPreparedTransition(next);
  });

  it('convenience methods prepare then commit and retain legacy result mutability', async () => {
    const driver = await openDecisionDriver({ config: oneHandConfig });
    const before = driver.getAuthorityState();
    const rejected = await driver.submitPausedAction(0, { type: 'check' }, 0);
    expect(rejected).toMatchObject({ accepted: false, rejection: { code: 'action-not-legal' } });
    expect(driver.getAuthorityState()).toBe(before);

    const accepted = await driver.submitPausedAction(0, { type: 'call' }, 1);
    expect(accepted).toEqual({
      accepted: true,
      boundary: { kind: 'hand-complete', handNumber: 1 },
    });
    const boundary = await driver.continueAfterHand();
    expect(boundary).toEqual({ kind: 'game-complete', winnerSeatIndex: 1 });
    const final = driver.getAuthorityState();
    expect(Object.isFrozen(final)).toBe(false);
    expect(Object.isFrozen(final.seats)).toBe(false);
    expect(Object.isFrozen(final.eventLog)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(final, 'version')).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });
});

describe('TournamentDriver classic compatibility gates', () => {
  it('matches the legacy controller NPC random seed path and generated trace', async () => {
    type RandomTrace = Readonly<{
      seatIndex: number;
      decisionIndex: number;
      seedHash: number;
      draws: readonly [number, number];
    }>;
    const legacyTrace: RandomTrace[] = [];
    const driverTrace: RandomTrace[] = [];
    const participants = (trace: RandomTrace[]): Participant[] => [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async ({ observation, random }) => {
        trace.push({
          seatIndex: observation.actorSeatIndex,
          decisionIndex: observation.decisionIndex,
          seedHash: random.seedHash,
          draws: [random.nextUint32(), random.nextUint32()],
        });
        const legal = observation.legalActions;
        if (legal.call !== null) return { action: { type: 'call' } };
        if (legal.check) return { action: { type: 'check' } };
        return { action: { type: 'fold' } };
      },
    }));

    await runTournament({
      config: oneHandConfig,
      participants: participants(legacyTrace),
      runSeed: 'driver-rng-compatibility-v1',
    });
    const driver = await openTournamentDriver({
      config: oneHandConfig,
      runSeed: 'driver-rng-compatibility-v1',
      seats: [{ playerId: 'p0', seatIndex: 0 }, { playerId: 'p1', seatIndex: 1 }],
      participants: participants(driverTrace),
      pauseSeatIndexes: [],
    });
    await driver.continueAfterHand();

    expect(driverTrace).toEqual(legacyTrace);
    expect(driverTrace).toEqual([{
      seatIndex: 0,
      decisionIndex: 0,
      seedHash: 2_310_341_521,
      draws: [2_918_232_665, 1_242_128_488],
    }]);
  });

  it('matches legacy final state and all reachable freeze and descriptor metadata', async () => {
    const participants = (): Participant[] => [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async ({ observation }) => ({
        action: observation.legalActions.call !== null
          ? { type: 'call' }
          : observation.legalActions.check
            ? { type: 'check' }
            : { type: 'fold' },
      }),
    }));
    const legacyState = await runTournament({
      config: oneHandConfig,
      participants: participants(),
      runSeed: 'driver-metadata-compatibility-v1',
    });
    const driver = await openTournamentDriver({
      config: oneHandConfig,
      runSeed: 'driver-metadata-compatibility-v1',
      seats: [{ playerId: 'p0', seatIndex: 0 }, { playerId: 'p1', seatIndex: 1 }],
      participants: participants(),
      pauseSeatIndexes: [],
    });
    await driver.continueAfterHand();
    const driverState = driver.getAuthorityState();

    expect(driverState).toEqual(legacyState);
    expect(snapshotReachableMetadata(driverState))
      .toEqual(snapshotReachableMetadata(legacyState));
  });
});

describe('TournamentDriver callback atomicity', () => {
  it('releases the lease and preserves committed state when an accepted-transition hook rejects', async () => {
    let failHuman = true;
    const driver = await openDecisionDriver({
      onAcceptedTransition: (batch) => {
        if (failHuman && batch.source === 'human-poker') {
          failHuman = false;
          throw new Error('hook failed');
        }
      },
    });
    const before = driver.getAuthorityState();

    await expect(driver.preparePausedAction(0, { type: 'call' }, 0))
      .rejects.toThrow('hook failed');
    expect(driver.getAuthorityState()).toBe(before);

    const retry = await driver.preparePausedAction(0, { type: 'fold' }, 1);
    driver.discardPreparedTransition(retry);
  });

  it('awaits each callback before exposing a candidate or starting the next transition', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const observed: string[][] = [];
    let settled = false;
    const driver = createTournamentDriver(options({
      onAcceptedTransition: async (batch) => {
        observed.push(batch.authorityEvents.map((event) => event.type));
        if (observed.length === 1) await gate;
      },
    }));

    const pending = driver.prepareOpen().then((prepared) => {
      settled = true;
      return prepared;
    });
    await Promise.resolve();
    expect(observed).toEqual([['GameStarted']]);
    expect(settled).toBe(false);
    expect(() => driver.getBoundary()).toThrow('Tournament driver is not committed');
    release();
    const prepared = await pending;
    expect(observed.length).toBeGreaterThan(1);
    driver.discardPreparedTransition(prepared);
  });

  it('emits fallback diagnostics before the npc transition and keeps its source npc', async () => {
    const operations: string[] = [];
    let first = true;
    const invalidNpc: Participant = {
      playerId: 'npc',
      decide: async ({ observation }) => {
        if (first) {
          first = false;
          return { action: { type: 'check' } };
        }
        return {
          action: observation.legalActions.check
            ? { type: 'check' }
            : observation.legalActions.call !== null
              ? { type: 'call' }
              : { type: 'fold' },
        };
      },
    };
    const driver = await openDecisionDriver({
      participants: [null, invalidNpc],
      invalidAgentActionMode: 'fallback',
      onDiagnostic: (event) => { operations.push(`diagnostic:${event.type}`); },
      onAcceptedTransition: (batch) => {
        if (batch.source === 'npc') {
          operations.push(`transition:${batch.source}:${batch.authorityEvents[0]?.type}`);
        }
      },
    });

    const prepared = await driver.preparePausedAction(0, { type: 'allIn' }, 0);
    expect(operations).toEqual([
      'diagnostic:AgentInvalidAction',
      'transition:npc:PlayerActed',
    ]);
    driver.discardPreparedTransition(prepared);
  });

  it('switches state, boundary, event count, and revision only at commit for actions and hand continuation', async () => {
    const driver = await openDecisionDriver({ config: oneHandConfig });
    const oldState = driver.getAuthorityState();
    const oldBoundary = driver.getBoundary();
    const action = await driver.preparePausedAction(0, { type: 'call' }, 0);

    expect(driver.getAuthorityState()).toBe(oldState);
    expect(driver.getBoundary()).toBe(oldBoundary);
    expect(driver.getAuthorityState().eventLog).toHaveLength(oldState.eventLog.length);
    driver.commitPreparedTransition(action);
    expect(driver.getAuthorityState()).not.toBe(oldState);
    expect(driver.getAuthorityState().version).toBe(action.candidateAuthorityState.version);
    expect(driver.getAuthorityState().eventLog).toHaveLength(action.candidateAuthorityState.eventLog.length);
    expect(driver.getBoundary()).toBe(action.candidateBoundary);

    const handState = driver.getAuthorityState();
    const handBoundary = driver.getBoundary();
    const continuation = await driver.prepareContinueAfterHand();
    expect(driver.getAuthorityState()).toBe(handState);
    expect(driver.getBoundary()).toBe(handBoundary);
    driver.commitPreparedTransition(continuation);
    expect(driver.getAuthorityState().version).toBe(continuation.candidateAuthorityState.version);
    expect(driver.getBoundary()).toBe(continuation.candidateBoundary);
  });
});

// Compile-time contract checks: these aliases keep the exact public shapes in use.
const _boundaryContract: DriverBoundary | null = null;
const _transitionContract: TransitionResult | null = null;
const _intentContract: ActionIntent | null = null;
const _stateContract: TournamentState | null = null;
void [_boundaryContract, _transitionContract, _intentContract, _stateContract];
