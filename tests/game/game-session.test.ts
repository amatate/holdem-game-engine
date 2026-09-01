import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TournamentConfig } from '../../src/core/config.js';
import type { ActionIntent } from '../../src/core/legal-actions.js';
import type { Participant } from '../../src/game/participant.js';
import {
  continueAfterHandResult,
  getCurrentPacket,
  openGameSession,
  submitSessionCommand,
} from '../../src/game/game-session.js';
import type {
  GameSessionHandle,
  OpenGameSessionOptions,
  SessionCommand,
} from '../../src/game/session-types.js';
import type {
  DriverTransitionBatch,
  TournamentDriver,
  TournamentDriverOptions,
} from '../../src/game/tournament-driver.js';
import type { ClassicDecisionPacket, TurnPacket } from '../../src/game/turn-packet.js';

const capture = vi.hoisted(() => ({
  batches: [] as DriverTransitionBatch[],
  commandIndexes: [] as number[],
  drivers: [] as TournamentDriver[],
  driverOptions: [] as TournamentDriverOptions[],
  failDecisionBuilds: 0,
  failHandBuilds: 0,
  failGameBuilds: 0,
}));

vi.mock('../../src/game/tournament-driver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/game/tournament-driver.js')>();
  return {
    ...actual,
    createTournamentDriver(options: Readonly<TournamentDriverOptions>) {
      capture.driverOptions.push(options as TournamentDriverOptions);
      const real = actual.createTournamentDriver({
        ...options,
        onAcceptedTransition: async (batch) => {
          capture.batches.push(batch);
          await options.onAcceptedTransition?.(batch);
        },
      });
      capture.drivers.push(real);
      return new Proxy(real, {
        get(target, property) {
          if (property !== 'preparePausedAction') {
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return async (
            seatIndex: number,
            intent: Readonly<ActionIntent>,
            commandIndex: number,
          ) => {
            capture.commandIndexes.push(commandIndex);
            return await target.preparePausedAction(seatIndex, intent, commandIndex);
          };
        },
      });
    },
  };
});

vi.mock('../../src/game/turn-packet.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/game/turn-packet.js')>();
  return {
    ...actual,
    createClassicDecisionPacket(...args: Parameters<typeof actual.createClassicDecisionPacket>) {
      if (capture.failDecisionBuilds > 0) {
        capture.failDecisionBuilds -= 1;
        throw new Error('injected decision packet failure');
      }
      return actual.createClassicDecisionPacket(...args);
    },
    createClassicHandResultPacket(
      ...args: Parameters<typeof actual.createClassicHandResultPacket>
    ) {
      if (capture.failHandBuilds > 0) {
        capture.failHandBuilds -= 1;
        throw new Error('injected hand packet failure');
      }
      return actual.createClassicHandResultPacket(...args);
    },
    createClassicGameResultPacket(...args: Parameters<typeof actual.createClassicGameResultPacket>) {
      if (capture.failGameBuilds > 0) {
        capture.failGameBuilds -= 1;
        throw new Error('injected game packet failure');
      }
      return actual.createClassicGameResultPacket(...args);
    },
  };
});

const decisionConfig: TournamentConfig = {
  maxSeats: 2,
  startingStack: 100,
  handsPerLevel: 100,
  blindLevels: [{ smallBlind: 10, bigBlind: 20 }],
  initialButtonSeat: 0,
};

function passiveParticipant(playerId: string): Participant {
  return {
    playerId,
    decide: async ({ observation }) => {
      if (observation.legalActions.check) return { action: { type: 'check' } };
      if (observation.legalActions.call !== null) return { action: { type: 'call' } };
      return { action: { type: 'fold' } };
    },
  };
}

function options(
  overrides: Partial<OpenGameSessionOptions> = {},
): OpenGameSessionOptions {
  return {
    mode: 'classic',
    config: decisionConfig,
    runSeed: 'GAME-SESSION-RUN-SEED-SENTINEL',
    humanSeatIndex: 0,
    seats: [
      { playerId: 'human', seatIndex: 0 },
      { playerId: 'npc', seatIndex: 1 },
    ],
    participants: [null, passiveParticipant('npc')],
    ...overrides,
  };
}

function act(packet: { readonly kind: string; readonly packetIndex: number }): SessionCommand {
  if (packet.kind !== 'decision' || !('decisionKey' in packet)) {
    throw new Error('fixture requires a decision packet');
  }
  return {
    type: 'act',
    decisionKey: packet.decisionKey as string,
    expectedPacketIndex: packet.packetIndex,
    intent: { type: 'call' },
  };
}

function requireDecision(packet: Readonly<TurnPacket>): Readonly<ClassicDecisionPacket> {
  if (packet.kind !== 'decision') throw new Error('fixture requires a decision packet');
  return packet;
}

beforeEach(() => {
  capture.batches.length = 0;
  capture.commandIndexes.length = 0;
  capture.drivers.length = 0;
  capture.driverOptions.length = 0;
  capture.failDecisionBuilds = 0;
  capture.failHandBuilds = 0;
  capture.failGameBuilds = 0;
});

describe('opaque classic GameSession', () => {
  it('opens at packet zero with an empty frozen opaque handle and no authority secrets', async () => {
    const openingPromise = openGameSession(options());
    expect(openingPromise).toBeInstanceOf(Promise);

    const first = await openingPromise;

    expect(first.packet).toMatchObject({ kind: 'decision', packetIndex: 0 });
    expect(getCurrentPacket(first.handle)).toBe(first.packet);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.handle)).toBe(true);
    expect(Object.keys(first.handle)).toEqual([]);
    expect(Reflect.ownKeys(first.handle)).toEqual([]);
    expect(Object.getOwnPropertyDescriptors(first.handle)).toEqual({});
    expect(JSON.stringify(first.handle)).toBe('{}');
    expect(JSON.stringify(first.packet)).not.toMatch(
      /runSeed|fullOrderedDeck|burnedCards|GAME-SESSION-RUN-SEED-SENTINEL/,
    );
    expect(capture.driverOptions[0]?.pauseSeatIndexes).toEqual([0]);
    expect(capture.driverOptions[0]?.participants[0]).toBeNull();
  });

  it('keeps submit and continue asynchronous while packet reads remain synchronous', async () => {
    const first = await openGameSession(options());
    const packet = getCurrentPacket(first.handle);
    expect(packet).not.toBeInstanceOf(Promise);

    const submitPromise = submitSessionCommand(first.handle, act(first.packet));
    expect(submitPromise).toBeInstanceOf(Promise);
    await submitPromise;

    const continuePromise = continueAfterHandResult(
      first.handle,
      getCurrentPacket(first.handle).packetIndex,
    );
    expect(continuePromise).toBeInstanceOf(Promise);
    await continuePromise;
  });

  it('rejects plain, copied and proxied handles with one fixed error', async () => {
    const first = await openGameSession(options());
    const forgedHandles = [
      {},
      { ...first.handle },
      new Proxy(first.handle as object, {}),
    ] as unknown as GameSessionHandle[];

    for (const handle of forgedHandles) {
      expect(() => getCurrentPacket(handle)).toThrowError('Invalid game session handle');
      await expect(submitSessionCommand(handle, act(first.packet))).rejects.toThrowError(
        'Invalid game session handle',
      );
      await expect(continueAfterHandResult(handle, 0)).rejects.toThrowError(
        'Invalid game session handle',
      );
    }
  });

  it('does not inspect or serialize an invalid handle on the rejection path', async () => {
    const trap = vi.fn(() => { throw new Error('HANDLE-TRAP-SENTINEL'); });
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
    }) as GameSessionHandle;

    expect(() => getCurrentPacket(hostile)).toThrowError('Invalid game session handle');
    await expect(continueAfterHandResult(hostile, 0)).rejects.toThrowError(
      'Invalid game session handle',
    );
    await expect(submitSessionCommand(hostile, { type: 'act' } as SessionCommand))
      .rejects.toThrowError('Invalid game session handle');
    expect(trap).not.toHaveBeenCalled();
  });
});

describe('classic command identity and rejection precedence', () => {
  it('consumes packet zero only after an accepted action and creates packet one', async () => {
    const first = await openGameSession(options());
    const result = await submitSessionCommand(first.handle, act(first.packet));

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('fixture action must be accepted');
    expect(result.step.packet.packetIndex).toBe(1);
    expect(getCurrentPacket(first.handle)).toBe(result.step.packet);
    expect(result.step.packet).not.toBe(first.packet);
  });

  it('returns stale-decision with the identical packet when only the key is stale', async () => {
    const first = await openGameSession(options());
    const packet = requireDecision(first.packet);

    const result = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: `${packet.decisionKey}/stale`,
      expectedPacketIndex: packet.packetIndex,
      intent: { type: 'call' },
    });

    expect(result).toEqual({
      accepted: false,
      handle: first.handle,
      rejection: 'stale-decision',
      packet,
    });
    if (result.accepted) throw new Error('stale command must be rejected');
    expect(result.packet).toBe(packet);
    expect(getCurrentPacket(first.handle)).toBe(packet);
    expect(capture.commandIndexes).toEqual([]);
  });

  it('returns stale-packet before stale-decision when both identities are stale', async () => {
    const first = await openGameSession(options());
    const packet = requireDecision(first.packet);

    const result = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: `${packet.decisionKey}/stale`,
      expectedPacketIndex: packet.packetIndex + 1,
      intent: { type: 'call' },
    });

    expect(result).toMatchObject({ accepted: false, rejection: 'stale-packet' });
    if (result.accepted) throw new Error('stale command must be rejected');
    expect(result.handle).toBe(first.handle);
    expect(result.packet).toBe(packet);
    expect(capture.commandIndexes).toEqual([]);
  });

  it('returns stale-packet for an old index paired with the current decision key', async () => {
    const first = await openGameSession(options());
    const packet = requireDecision(first.packet);

    const result = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: packet.decisionKey,
      expectedPacketIndex: packet.packetIndex + 1,
      intent: { type: 'call' },
    });

    expect(result).toMatchObject({ accepted: false, rejection: 'stale-packet' });
    if (result.accepted) throw new Error('stale command must be rejected');
    expect(result.packet).toBe(packet);
  });

  it.each([
    { ability: 'peek' as const, targetSeatIndex: 1 },
    { ability: 'read' as const, targetSeatIndex: 1 },
    { ability: 'swap' as const, holeCardIndex: 0 as const },
  ])('rejects $ability as wrong-mode before packet, decision or boundary checks', async (ability) => {
    const first = await openGameSession(options());
    const decision = requireDecision(first.packet);
    const stateBeforeAbility = capture.drivers[0]!.getAuthorityState();
    const command = {
      type: 'useAbility' as const,
      decisionKey: `${decision.decisionKey}/stale`,
      expectedPacketIndex: decision.packetIndex + 99,
      ...ability,
    } as SessionCommand;

    const atDecision = await submitSessionCommand(first.handle, command);
    expect(atDecision).toMatchObject({ accepted: false, rejection: 'wrong-mode' });
    if (atDecision.accepted) throw new Error('classic ability must be rejected');
    expect(atDecision.packet).toBe(first.packet);
    expect(capture.drivers[0]!.getAuthorityState()).toBe(stateBeforeAbility);
    expect(capture.commandIndexes).toEqual([]);

    const folded = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'fold' },
    });
    if (!folded.accepted || folded.step.packet.kind !== 'hand-result') {
      throw new Error('fixture fold must reach hand result');
    }
    const atResult = await submitSessionCommand(first.handle, command);
    expect(atResult).toMatchObject({ accepted: false, rejection: 'wrong-mode' });
    if (atResult.accepted) throw new Error('classic ability must be rejected');
    expect(atResult.packet).toBe(folded.step.packet);
  });

  it('returns not-human-turn before stale identities for act at a result boundary', async () => {
    const first = await openGameSession(options());
    const decision = requireDecision(first.packet);
    const folded = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'fold' },
    });
    if (!folded.accepted) throw new Error('fixture fold must be accepted');

    const result = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: 'stale',
      expectedPacketIndex: 999,
      intent: { type: 'call' },
    });

    expect(result).toMatchObject({ accepted: false, rejection: 'not-human-turn' });
    if (result.accepted) throw new Error('result-boundary act must be rejected');
    expect(result.packet).toBe(folded.step.packet);
  });

  it('returns the exact poker rejection without replacing the packet', async () => {
    const first = await openGameSession(options());
    const packet = requireDecision(first.packet);

    const result = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: packet.decisionKey,
      expectedPacketIndex: packet.packetIndex,
      intent: { type: 'check' },
    });

    expect(result).toMatchObject({ accepted: false, rejection: 'action-not-legal' });
    if (result.accepted) throw new Error('illegal action must be rejected');
    expect(result.handle).toBe(first.handle);
    expect(result.packet).toBe(packet);
    expect(getCurrentPacket(first.handle)).toBe(packet);
  });

  it('fails malformed commands closed without preparing or serializing the input', async () => {
    const first = await openGameSession(options());
    const toJSON = vi.fn(() => { throw new Error('COMMAND-JSON-SENTINEL'); });
    const ownKeys = vi.fn(() => { throw new Error('COMMAND-KEYS-SENTINEL'); });
    const malformed = new Proxy({ type: 'act', toJSON }, { ownKeys }) as unknown as SessionCommand;

    const result = await submitSessionCommand(first.handle, malformed);

    expect(result).toMatchObject({ accepted: false, rejection: 'malformed-command' });
    if (result.accepted) throw new Error('malformed command must be rejected');
    expect(result.packet).toBe(first.packet);
    expect(capture.commandIndexes).toEqual([]);
    expect(toJSON).not.toHaveBeenCalled();
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it('uses command indexes 0,0,1,1 while only committed human batches are 0,1', async () => {
    const first = await openGameSession(options());
    const preflop = requireDecision(first.packet);

    const rejectZero = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: preflop.decisionKey,
      expectedPacketIndex: preflop.packetIndex,
      intent: { type: 'check' },
    });
    expect(rejectZero).toMatchObject({ accepted: false, rejection: 'action-not-legal' });

    const acceptZero = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: preflop.decisionKey,
      expectedPacketIndex: preflop.packetIndex,
      intent: { type: 'call' },
    });
    if (!acceptZero.accepted) throw new Error('preflop call must be accepted');
    const flop = requireDecision(acceptZero.step.packet);

    const rejectOne = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: flop.decisionKey,
      expectedPacketIndex: flop.packetIndex,
      intent: { type: 'call' },
    });
    expect(rejectOne).toMatchObject({ accepted: false, rejection: 'action-not-legal' });

    const acceptOne = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: flop.decisionKey,
      expectedPacketIndex: flop.packetIndex,
      intent: { type: 'check' },
    });
    expect(acceptOne.accepted).toBe(true);

    expect(capture.commandIndexes).toEqual([0, 0, 1, 1]);
    expect(capture.batches
      .filter((batch) => batch.source === 'human-poker')
      .map((batch) => batch.commandIndex)).toEqual([0, 1]);
    expect(capture.batches
      .filter((batch) => batch.source === 'automatic' || batch.source === 'npc')
      .every((batch) => batch.commandIndex === null)).toBe(true);
  });
});

describe('hand-result acknowledgement and delivery cursors', () => {
  async function foldToHandResult() {
    const first = await openGameSession(options());
    const decision = requireDecision(first.packet);
    const result = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'fold' },
    });
    if (!result.accepted || result.step.packet.kind !== 'hand-result') {
      throw new Error('fixture fold must reach hand result');
    }
    return { first, hand: result.step.packet };
  }

  it('keeps a hand result pending until explicit acknowledgement', async () => {
    const { first, hand } = await foldToHandResult();
    const committedState = capture.drivers[0]!.getAuthorityState();

    expect(getCurrentPacket(first.handle)).toBe(hand);
    expect(getCurrentPacket(first.handle)).toBe(hand);
    expect(capture.drivers[0]!.getAuthorityState()).toBe(committedState);
    expect(hand.packetIndex).toBe(1);
  });

  it('acknowledges a hand result into the next hand without overlapping delivery ranges', async () => {
    const { first, hand } = await foldToHandResult();

    const result = await continueAfterHandResult(first.handle, hand.packetIndex);

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error('hand acknowledgement must be accepted');
    expect(result.step.packet.kind).toBe('decision');
    expect(result.step.packet.packetIndex).toBe(2);
    expect(result.step.packet.coreEventRange.fromVersionInclusive).toBe(
      hand.coreEventRange.toVersionExclusive,
    );
    expect(getCurrentPacket(first.handle)).toBe(result.step.packet);
    expect(capture.batches
      .filter((batch) => batch.source === 'automatic' || batch.source === 'npc')
      .every((batch) => batch.commandIndex === null)).toBe(true);
  });

  it('does not increment acceptedCommandIndex for acknowledgement', async () => {
    const { first, hand } = await foldToHandResult();
    const continued = await continueAfterHandResult(first.handle, hand.packetIndex);
    if (!continued.accepted) throw new Error('hand acknowledgement must be accepted');
    const decision = requireDecision(continued.step.packet);

    const illegal = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'call' },
    });

    expect(illegal).toMatchObject({ accepted: false, rejection: 'action-not-legal' });
    expect(capture.commandIndexes).toEqual([0, 1]);
  });

  it('rejects duplicate stale acknowledgement before boundary validation without mutation', async () => {
    const { first, hand } = await foldToHandResult();
    const continued = await continueAfterHandResult(first.handle, hand.packetIndex);
    if (!continued.accepted) throw new Error('hand acknowledgement must be accepted');
    const current = continued.step.packet;
    const state = capture.drivers[0]!.getAuthorityState();
    const batchesBefore = capture.batches.length;

    const duplicate = await continueAfterHandResult(first.handle, hand.packetIndex);

    expect(duplicate).toMatchObject({ accepted: false, rejection: 'stale-packet' });
    if (duplicate.accepted) throw new Error('duplicate acknowledgement must be rejected');
    expect(duplicate.handle).toBe(first.handle);
    expect(duplicate.packet).toBe(current);
    expect(getCurrentPacket(first.handle)).toBe(current);
    expect(capture.drivers[0]!.getAuthorityState()).toBe(state);
    expect(capture.batches).toHaveLength(batchesBefore);
  });

  it('returns wrong-boundary for a current decision packet without mutation', async () => {
    const first = await openGameSession(options());
    const state = capture.drivers[0]!.getAuthorityState();

    const result = await continueAfterHandResult(first.handle, first.packet.packetIndex);

    expect(result).toMatchObject({ accepted: false, rejection: 'wrong-boundary' });
    if (result.accepted) throw new Error('decision continue must be rejected');
    expect(result.packet).toBe(first.packet);
    expect(capture.drivers[0]!.getAuthorityState()).toBe(state);
  });

  it('can acknowledge the final hand into game-result and then rejects current continue', async () => {
    const first = await openGameSession(options({
      config: { ...decisionConfig, startingStack: 20 },
      runSeed: 'TURN-PACKET-COMPLETED-SEED-SENTINEL',
    }));
    const decision = requireDecision(first.packet);
    const completed = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'call' },
    });
    if (!completed.accepted || completed.step.packet.kind !== 'hand-result') {
      throw new Error('all-in fixture must complete one hand');
    }

    const final = await continueAfterHandResult(
      first.handle,
      completed.step.packet.packetIndex,
    );

    expect(final.accepted).toBe(true);
    if (!final.accepted) throw new Error('final hand acknowledgement must be accepted');
    expect(final.step.packet.kind).toBe('game-result');
    const wrong = await continueAfterHandResult(first.handle, final.step.packet.packetIndex);
    expect(wrong).toMatchObject({ accepted: false, rejection: 'wrong-boundary' });
    if (wrong.accepted) throw new Error('game continue must be rejected');
    expect(wrong.packet).toBe(final.step.packet);
  });
});

describe('session validation and active-operation guard', () => {
  it.each([
    {
      name: 'human seat outside the table',
      override: { humanSeatIndex: 2 },
    },
    {
      name: 'human seat with a participant provider',
      override: { participants: [passiveParticipant('human'), passiveParticipant('npc')] },
    },
    {
      name: 'NPC seat without a participant provider',
      override: { participants: [null, null] },
    },
    {
      name: 'NPC provider with the wrong playerId',
      override: { participants: [null, passiveParticipant('other')] },
    },
  ])('rejects $name before opening a driver', async ({ override }) => {
    await expect(openGameSession(options(override as Partial<OpenGameSessionOptions>)))
      .rejects.toThrowError('Invalid game session options');
    expect(capture.drivers).toEqual([]);
  });

  it('rejects every concurrent async entry as busy while synchronous reads return the old packet', async () => {
    let releaseDecision!: () => void;
    let reportEntered!: () => void;
    const entered = new Promise<void>((resolve) => { reportEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseDecision = resolve; });
    const blockingParticipant: Participant = {
      playerId: 'npc',
      decide: async ({ observation }) => {
        reportEntered();
        await gate;
        return observation.legalActions.check
          ? { action: { type: 'check' } }
          : { action: { type: 'call' } };
      },
    };
    const first = await openGameSession(options({
      participants: [null, blockingParticipant],
    }));
    const original = first.packet;
    const inFlight = submitSessionCommand(first.handle, act(original));
    await entered;

    expect(getCurrentPacket(first.handle)).toBe(original);
    await expect(submitSessionCommand(
      first.handle,
      { type: 'act' } as SessionCommand,
    )).rejects.toThrowError('Session operation already in progress');
    await expect(continueAfterHandResult(
      first.handle,
      original.packetIndex,
    )).rejects.toThrowError('Session operation already in progress');
    expect(getCurrentPacket(first.handle)).toBe(original);

    releaseDecision();
    const accepted = await inFlight;
    expect(accepted.accepted).toBe(true);
  });

  it('releases the operation guard and driver lease after an awaited participant failure', async () => {
    let attempts = 0;
    const participant: Participant = {
      playerId: 'npc',
      decide: async ({ observation }) => {
        attempts += 1;
        if (attempts === 1) throw new Error('injected participant failure');
        return observation.legalActions.check
          ? { action: { type: 'check' } }
          : { action: { type: 'call' } };
      },
    };
    const first = await openGameSession(options({ participants: [null, participant] }));
    const command = act(first.packet);

    await expect(submitSessionCommand(first.handle, command)).rejects.toThrowError(
      'injected participant failure',
    );
    expect(getCurrentPacket(first.handle)).toBe(first.packet);

    const retry = await submitSessionCommand(first.handle, command);
    expect(retry.accepted).toBe(true);
    expect(capture.commandIndexes).toEqual([0, 0]);
  });
});

describe('prepared-transition packet-build fault atomicity', () => {
  function committedSnapshot(driver: TournamentDriver) {
    const state = driver.getAuthorityState();
    return {
      state,
      version: state.version,
      eventLog: state.eventLog,
      bytes: JSON.stringify(state),
    };
  }

  function expectCommittedSnapshot(
    driver: TournamentDriver,
    snapshot: ReturnType<typeof committedSnapshot>,
  ): void {
    const state = driver.getAuthorityState();
    expect(state).toBe(snapshot.state);
    expect(state.version).toBe(snapshot.version);
    expect(state.eventLog).toBe(snapshot.eventLog);
    expect(JSON.stringify(state)).toBe(snapshot.bytes);
  }

  it('discards an open candidate when the initial decision packet builder throws', async () => {
    capture.failDecisionBuilds = 1;
    let returnedHandle: GameSessionHandle | undefined;

    await expect(openGameSession(options()).then((step) => {
      returnedHandle = step.handle;
    })).rejects.toThrowError('injected decision packet failure');

    expect(returnedHandle).toBeUndefined();
    expect(capture.drivers).toHaveLength(1);
    const driver = capture.drivers[0]!;
    expect(() => driver.getAuthorityState()).toThrowError('Tournament driver is not committed');
    const retry = await driver.prepareOpen();
    expect(retry.candidateBoundary.kind).toBe('decision');
    driver.discardPreparedTransition(retry);
    expect(() => driver.getAuthorityState()).toThrowError('Tournament driver is not committed');
  });

  it('discards an accepted action candidate when the next decision packet builder throws', async () => {
    const first = await openGameSession(options());
    const driver = capture.drivers[0]!;
    const snapshot = committedSnapshot(driver);
    const command = act(first.packet);
    capture.failDecisionBuilds = 1;

    await expect(submitSessionCommand(first.handle, command)).rejects.toThrowError(
      'injected decision packet failure',
    );

    expect(getCurrentPacket(first.handle)).toBe(first.packet);
    expectCommittedSnapshot(driver, snapshot);
    expect(capture.commandIndexes).toEqual([0]);

    const retry = await submitSessionCommand(first.handle, command);
    expect(retry.accepted).toBe(true);
    if (!retry.accepted) throw new Error('action retry must succeed');
    expect(retry.step.packet.packetIndex).toBe(1);
    expect(capture.commandIndexes).toEqual([0, 0]);

    const next = requireDecision(retry.step.packet);
    await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: next.decisionKey,
      expectedPacketIndex: next.packetIndex,
      intent: { type: 'call' },
    });
    expect(capture.commandIndexes).toEqual([0, 0, 1]);
  });

  it('discards an accepted fold candidate when the hand-result packet builder throws', async () => {
    const first = await openGameSession(options());
    const driver = capture.drivers[0]!;
    const snapshot = committedSnapshot(driver);
    const decision = requireDecision(first.packet);
    const command: SessionCommand = {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'fold' },
    };
    capture.failHandBuilds = 1;

    await expect(submitSessionCommand(first.handle, command)).rejects.toThrowError(
      'injected hand packet failure',
    );

    expect(getCurrentPacket(first.handle)).toBe(first.packet);
    expectCommittedSnapshot(driver, snapshot);
    const retry = await submitSessionCommand(first.handle, command);
    expect(retry.accepted).toBe(true);
    if (!retry.accepted) throw new Error('fold retry must succeed');
    expect(retry.step.packet.kind).toBe('hand-result');
    expect(capture.commandIndexes).toEqual([0, 0]);
  });

  it('discards next-hand prepare when its decision packet builder throws', async () => {
    const first = await openGameSession(options());
    const decision = requireDecision(first.packet);
    const folded = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'fold' },
    });
    if (!folded.accepted || folded.step.packet.kind !== 'hand-result') {
      throw new Error('fixture fold must reach hand result');
    }
    const hand = folded.step.packet;
    const driver = capture.drivers[0]!;
    const snapshot = committedSnapshot(driver);
    capture.failDecisionBuilds = 1;

    await expect(continueAfterHandResult(first.handle, hand.packetIndex)).rejects.toThrowError(
      'injected decision packet failure',
    );

    expect(getCurrentPacket(first.handle)).toBe(hand);
    expectCommittedSnapshot(driver, snapshot);
    const retry = await continueAfterHandResult(first.handle, hand.packetIndex);
    expect(retry.accepted).toBe(true);
    if (!retry.accepted) throw new Error('ack retry must succeed');
    expect(retry.step.packet.kind).toBe('decision');
  });

  it('discards final-game prepare when its game-result packet builder throws', async () => {
    const first = await openGameSession(options({
      config: { ...decisionConfig, startingStack: 20 },
      runSeed: 'TURN-PACKET-COMPLETED-SEED-SENTINEL',
    }));
    const decision = requireDecision(first.packet);
    const completed = await submitSessionCommand(first.handle, {
      type: 'act',
      decisionKey: decision.decisionKey,
      expectedPacketIndex: decision.packetIndex,
      intent: { type: 'call' },
    });
    if (!completed.accepted || completed.step.packet.kind !== 'hand-result') {
      throw new Error('fixture must reach final hand result');
    }
    const hand = completed.step.packet;
    const driver = capture.drivers[0]!;
    const snapshot = committedSnapshot(driver);
    capture.failGameBuilds = 1;

    await expect(continueAfterHandResult(first.handle, hand.packetIndex)).rejects.toThrowError(
      'injected game packet failure',
    );

    expect(getCurrentPacket(first.handle)).toBe(hand);
    expectCommittedSnapshot(driver, snapshot);
    const retry = await continueAfterHandResult(first.handle, hand.packetIndex);
    expect(retry.accepted).toBe(true);
    if (!retry.accepted) throw new Error('final ack retry must succeed');
    expect(retry.step.packet.kind).toBe('game-result');
  });
});
