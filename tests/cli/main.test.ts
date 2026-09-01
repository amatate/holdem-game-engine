import { describe, expect, it, vi } from 'vitest';

import * as publicApi from '../../src/index.js';
import {
  DEFAULT_TOURNAMENT_CONFIG,
  main,
  type CliPrompt,
  type CliRuntime,
} from '../../src/cli/index.js';
import { parseCard } from '../../src/core/cards.js';
import type {
  GameSessionHandle,
  OpenGameSessionOptions,
} from '../../src/game/session-types.js';
import type {
  ClassicDecisionPacket,
  GameResultPacket,
  HandResultPacket,
} from '../../src/game/turn-packet.js';

const PLAYER_COUNT_PROMPT = '请选择牌桌人数（2-6，直接回车默认 4）：';
const ACTION_PROMPT = '请选择操作（f/x/c/r <加注到>/a）：';

function freezeRecursively<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return value as Readonly<T>;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      freezeRecursively(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function decisionPacket(packetIndex = 0): Readonly<ClassicDecisionPacket> {
  return freezeRecursively({
    schemaVersion: 1,
    kind: 'decision',
    packetIndex,
    decisionKey: 'hand/1/seat/0/decision/0',
    coreEventRange: { fromVersionInclusive: 0, toVersionExclusive: 4 },
    viewerEventsSinceLastPacket: [],
    privateEventsSinceLastPacket: [],
    observation: {
      schemaVersion: 1,
      handId: 'viewer-safe-hand',
      handNumber: 1,
      decisionIndex: 0,
      actorSeatIndex: 0,
      street: 'preflop',
      holeCards: [parseCard('As'), parseCard('Kd')],
      board: [],
      buttonPosition: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      smallBlind: 1,
      bigBlind: 2,
      potTotal: 3,
      sidePots: [],
      seats: [
        { playerId: '你', seatIndex: 0, stack: 99, status: 'active', committedStreet: 1, committedHand: 1, revealedHoleCards: null },
        { playerId: '老周“岩石”', seatIndex: 1, stack: 98, status: 'active', committedStreet: 2, committedHand: 2, revealedHoleCards: null },
      ],
      actionHistory: [],
      legalActions: {
        fold: false,
        check: true,
        call: null,
        raiseTo: { min: 4, max: 100 },
        allIn: { to: 100, mode: 'fullBet' },
      },
    },
    actionPanel: {
      currentBetTo: 2,
      facingBet: false,
      tableCommittedTotal: 3,
      heroContestableTotal: 3,
      commands: [
        { kind: 'fixed', inputs: ['x', 'c'], label: '过牌', intent: { type: 'check' } },
      ],
    },
    abilities: null,
    runSeed: 'PACKET-SEED-MUST-NOT-BE-PRINTED',
  } as ClassicDecisionPacket & { runSeed: string });
}

function handResultPacket(packetIndex = 1): Readonly<HandResultPacket> {
  return freezeRecursively({
    schemaVersion: 1,
    kind: 'hand-result',
    packetIndex,
    handNumber: 1,
    coreEventRange: { fromVersionInclusive: 4, toVersionExclusive: 10 },
    viewerEventsSinceLastPacket: [],
    privateEventsSinceLastPacket: [],
    handResult: {
      handNumber: 1,
      seats: [
        { seatIndex: 0, playerId: '你', holeCards: [parseCard('As'), parseCard('Kd')], category: null, bestFive: null, potWon: 3, invested: 1, returned: 0, net: 2, finalStack: 102 },
        { seatIndex: 1, playerId: '老周“岩石”', holeCards: null, category: null, bestFive: null, potWon: 0, invested: 2, returned: 0, net: -2, finalStack: 98 },
      ],
      pots: [
        { potId: 'main', label: '主池', amount: 3, eligibleSeatIndexes: [0, 1], winnerSeatIndexes: [0], awards: [3] },
      ],
    },
  });
}

function gameResultPacket(packetIndex = 2): Readonly<GameResultPacket> {
  return freezeRecursively({
    schemaVersion: 1,
    kind: 'game-result',
    packetIndex,
    winnerSeatIndex: 0,
    finalStacks: [{ seatIndex: 0, stack: 200 }, { seatIndex: 1, stack: 0 }],
    coreEventRange: { fromVersionInclusive: 10, toVersionExclusive: 11 },
    viewerEventsSinceLastPacket: [{ type: 'gameCompleted', winnerSeat: 0 }],
    privateEventsSinceLastPacket: [],
  });
}

function promptFromInputs(
  inputs: readonly string[],
  questions: string[],
  writes: string[],
  close: () => void,
): CliPrompt {
  const queue = [...inputs];
  return {
    question: async (question) => {
      questions.push(question);
      const input = queue.shift();
      if (input === undefined) throw new Error('prompt input queue exhausted');
      return input;
    },
    write: (message) => { writes.push(message); },
    close,
  };
}

describe('terminal GameSession composition', () => {
  it('opens one classic six-seat session with separate viewer seats and NPC providers', async () => {
    const first = decisionPacket();
    const settled = handResultPacket();
    const completed = gameResultPacket();
    const handle = Object.freeze({}) as GameSessionHandle;
    const writes: string[] = [];
    const questions: string[] = [];
    const promptWrites: string[] = [];
    const close = vi.fn();
    const createPrompt = vi.fn(() => promptFromInputs(['x'], questions, promptWrites, close));
    let captured: Readonly<OpenGameSessionOptions> | undefined;

    const result = await main(['--players', '6', '--seed', 'six-seat'], {
      write: (message) => { writes.push(message); },
      sleep: async () => {},
      randomUUID: () => 'unused-random-seed',
      createPrompt,
      openGameSession: async (options) => {
        captured = options;
        return { handle, packet: first };
      },
      submitSessionCommand: async (receivedHandle, command) => {
        expect(receivedHandle).toBe(handle);
        expect(command).toEqual({
          type: 'act',
          decisionKey: first.decisionKey,
          expectedPacketIndex: first.packetIndex,
          intent: { type: 'check' },
        });
        return { accepted: true, step: { handle, packet: settled } };
      },
      continueAfterHandResult: async (receivedHandle, packetIndex) => {
        expect(receivedHandle).toBe(handle);
        expect(packetIndex).toBe(settled.packetIndex);
        return { accepted: true, step: { handle, packet: completed } };
      },
    });

    if (captured === undefined) throw new Error('session options were not captured');
    expect(result).toBe(completed);
    expect(Object.isFrozen(result)).toBe(true);
    expect(captured).toMatchObject({
      mode: 'classic',
      runSeed: 'six-seat',
      humanSeatIndex: 0,
      invalidAgentActionMode: 'fallback',
    });
    expect(captured.config).toEqual({ ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 6 });
    expect(DEFAULT_TOURNAMENT_CONFIG.maxSeats).toBe(4);
    expect(captured.seats).toEqual([
      { playerId: '你', seatIndex: 0 },
      { playerId: '老周“岩石”', seatIndex: 1 },
      { playerId: '林岚“猎手”', seatIndex: 2 },
      { playerId: '阿凯“疯狗”', seatIndex: 3 },
      { playerId: '苏蔓“伏蛇”', seatIndex: 4 },
      { playerId: '韩烈“重锤”', seatIndex: 5 },
    ]);
    expect(captured.participants[0]).toBeNull();
    expect(captured.participants.slice(1).map((participant) => participant?.playerId)).toEqual(
      captured.seats.slice(1).map((seat) => seat.playerId),
    );
    expect(questions).toEqual([ACTION_PROMPT]);
    expect(promptWrites).toEqual([]);
    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    const terminalSurface = [...writes, ...questions, ...promptWrites].join('\n');
    expect(writes).toContain('本局种子：six-seat');
    expect(terminalSurface).not.toContain('PACKET-SEED-MUST-NOT-BE-PRINTED');
    for (const hiddenCommand of ['ability-lab', 'u peek', 'u read', 'u swap']) {
      expect(terminalSurface).not.toContain(hiddenCommand);
    }
  });

  it('retries a missing player count through the same prompt before opening the session', async () => {
    const completed = gameResultPacket(0);
    const handle = Object.freeze({}) as GameSessionHandle;
    const questions: string[] = [];
    const promptWrites: string[] = [];
    const close = vi.fn();
    const createPrompt = vi.fn(() => promptFromInputs(
      ['bad', '5'],
      questions,
      promptWrites,
      close,
    ));
    const randomUUID = vi.fn(() => 'unused-random-seed');
    let captured: Readonly<OpenGameSessionOptions> | undefined;

    await main(['--seed', 'interactive'], {
      write: () => {},
      sleep: async () => {},
      randomUUID,
      createPrompt,
      openGameSession: async (options) => {
        captured = options;
        return { handle, packet: completed };
      },
      submitSessionCommand: async () => { throw new Error('unexpected submit'); },
      continueAfterHandResult: async () => { throw new Error('unexpected continue'); },
    });

    if (captured === undefined) throw new Error('session options were not captured');
    expect(randomUUID).not.toHaveBeenCalled();
    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(questions).toEqual([PLAYER_COUNT_PROMPT, PLAYER_COUNT_PROMPT]);
    expect(promptWrites).toEqual(['人数无效，请输入 2 到 6 的整数。']);
    expect(captured.seats.map((seat) => seat.playerId)).toEqual([
      '你',
      '老周“岩石”',
      '林岚“猎手”',
      '程墨“小刀”',
      '韩烈“重锤”',
    ]);
  });

  it('prints a safe rejection, retains the rejected packet, and asks again', async () => {
    const first = decisionPacket();
    const completed = gameResultPacket(1);
    const handle = Object.freeze({}) as GameSessionHandle;
    const questions: string[] = [];
    const promptWrites: string[] = [];
    const submittedPackets: number[] = [];
    const close = vi.fn();

    await main(['--players', '2', '--seed', 'rejection'], {
      write: () => {},
      sleep: async () => {},
      randomUUID: () => 'unused',
      createPrompt: () => promptFromInputs(['u peek 1', 'x'], questions, promptWrites, close),
      openGameSession: async () => ({ handle, packet: first }),
      submitSessionCommand: async (receivedHandle, command) => {
        expect(receivedHandle).toBe(handle);
        submittedPackets.push(command.expectedPacketIndex);
        if (submittedPackets.length === 1) {
          return {
            accepted: false,
            handle,
            rejection: 'wrong-mode',
            packet: first,
          };
        }
        return { accepted: true, step: { handle, packet: completed } };
      },
      continueAfterHandResult: async () => { throw new Error('unexpected continue'); },
    });

    expect(submittedPackets).toEqual([first.packetIndex, first.packetIndex]);
    expect(questions).toEqual([ACTION_PROMPT, ACTION_PROMPT]);
    expect(promptWrites).toEqual(['经典模式不能使用能力。']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws on a rejected current hand result and still closes the prompt once', async () => {
    const settled = handResultPacket(7);
    const handle = Object.freeze({}) as GameSessionHandle;
    const close = vi.fn();

    await expect(main(['--players', '2', '--seed', 'bad-continue'], {
      write: () => {},
      sleep: async () => {},
      randomUUID: () => 'unused',
      createPrompt: () => promptFromInputs([], [], [], close),
      openGameSession: async () => ({ handle, packet: settled }),
      submitSessionCommand: async () => { throw new Error('unexpected submit'); },
      continueAfterHandResult: async () => ({
        accepted: false,
        handle,
        rejection: 'wrong-boundary',
        packet: settled,
      }),
    })).rejects.toThrow('Session rejected its current hand result');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the prompt once while preserving an open-session failure', async () => {
    const close = vi.fn();
    const sentinel = new Error('session failed');

    await expect(main(['--players', '2', '--seed', 'failing'], {
      write: () => {},
      sleep: async () => {},
      randomUUID: () => 'unused',
      createPrompt: () => promptFromInputs([], [], [], close),
      openGameSession: async () => { throw sentinel; },
      submitSessionCommand: async () => { throw new Error('unexpected submit'); },
      continueAfterHandResult: async () => { throw new Error('unexpected continue'); },
    })).rejects.toThrow(sentinel);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('offers no mode selector in milestone A', async () => {
    const createPrompt = vi.fn<CliRuntime['createPrompt']>();

    await expect(main(['--mode', 'ability-lab'], {
      write: () => {},
      sleep: async () => {},
      randomUUID: () => 'unused',
      createPrompt,
      openGameSession: async () => { throw new Error('unexpected open'); },
      submitSessionCommand: async () => { throw new Error('unexpected submit'); },
      continueAfterHandResult: async () => { throw new Error('unexpected continue'); },
    })).rejects.toThrow('未知参数：--mode');

    expect(createPrompt).not.toHaveBeenCalled();
  });
});

describe('public package surface', () => {
  it('exports viewer-safe session operations without driver authority hooks', () => {
    expect(publicApi).toMatchObject({
      openGameSession: expect.any(Function),
      getCurrentPacket: expect.any(Function),
      submitSessionCommand: expect.any(Function),
      continueAfterHandResult: expect.any(Function),
    });

    const exportedNames = Object.keys(publicApi);
    for (const forbiddenName of [
      'TournamentDriver',
      'PreparedDriverTransition',
      'createTournamentDriver',
      'openTournamentDriver',
      'getAuthorityState',
      'prepareAuthorityTransition',
      'onAcceptedTransition',
      'SessionAuthorityCapability',
      'exportSessionReplay',
    ]) {
      expect(exportedNames).not.toContain(forbiddenName);
    }
  });
});
