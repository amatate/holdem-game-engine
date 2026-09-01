import { describe, expect, it, vi } from 'vitest';

import { main } from '../../src/cli/index.js';
import { createLinePacer } from '../../src/cli/pacing.js';
import { parseCard } from '../../src/core/cards.js';
import type { GameSessionHandle } from '../../src/game/session-types.js';
import type {
  ClassicDecisionPacket,
  GameResultPacket,
  HandResultPacket,
} from '../../src/game/turn-packet.js';

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

function decisionPacket(): Readonly<ClassicDecisionPacket> {
  return freezeRecursively({
    schemaVersion: 1,
    kind: 'decision',
    packetIndex: 0,
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
        raiseTo: null,
        allIn: null,
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
  });
}

function handResultPacket(): Readonly<HandResultPacket> {
  return freezeRecursively({
    schemaVersion: 1,
    kind: 'hand-result',
    packetIndex: 1,
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

function gameResultPacket(): Readonly<GameResultPacket> {
  return freezeRecursively({
    schemaVersion: 1,
    kind: 'game-result',
    packetIndex: 2,
    winnerSeatIndex: 0,
    finalStacks: [{ seatIndex: 0, stack: 200 }, { seatIndex: 1, stack: 0 }],
    coreEventRange: { fromVersionInclusive: 10, toVersionExclusive: 11 },
    viewerEventsSinceLastPacket: [{ type: 'gameCompleted', winnerSeat: 0 }],
    privateEventsSinceLastPacket: [],
  });
}

describe('terminal line pacing', () => {
  it('writes the first line immediately and waits before later lines across batches', async () => {
    const operations: string[] = [];
    const pace = createLinePacer(
      (line) => { operations.push(`write:${line}`); },
      async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
      1_000,
    );

    await pace('seed\nfirst event');
    await pace('second event');

    expect(operations).toEqual([
      'write:seed',
      'wait:1000',
      'write:first event',
      'wait:1000',
      'write:second event',
    ]);
  });

  it('does not turn empty input or a terminal separator into paced lines', async () => {
    const operations: string[] = [];
    const pace = createLinePacer(
      (line) => { operations.push(`write:${line}`); },
      async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
      1_000,
    );

    await pace('');
    await pace('first\n');
    await pace('');

    expect(operations).toEqual(['write:first']);
  });

  it('preserves internal empty lines and gives each one a full interval', async () => {
    const operations: string[] = [];
    const pace = createLinePacer(
      (line) => { operations.push(`write:${line}`); },
      async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
      1_000,
    );

    await pace('first\n\nthird');

    expect(operations).toEqual([
      'write:first',
      'wait:1000',
      'write:',
      'wait:1000',
      'write:third',
    ]);
  });

  it('plays the packet loop in exact semantic order without pacing startup lines', async () => {
    const decision = decisionPacket();
    const settlement = handResultPacket();
    const gameResult = gameResultPacket();
    const handle = Object.freeze({}) as GameSessionHandle;
    const operations: string[] = [];
    const createPrompt = vi.fn(() => ({
      question: async () => {
        operations.push('prompt:question');
        return 'x';
      },
      write: (message: string) => { operations.push(`prompt:write:${message}`); },
      close: () => { operations.push('prompt:close'); },
    }));

    const returned = await main(['--players', '6', '--seed', 'fixed-seed'], {
      write: (message) => {
        if (message.startsWith('第 1 手｜')) operations.push('write:decision');
        else if (message.startsWith('第 1 手结算')) operations.push('write:settlement');
        else if (message.startsWith('比赛结束')) operations.push('write:game-result');
        else operations.push(`write:${message}`);
      },
      sleep: async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
      randomUUID: () => 'unused-random-seed',
      createPrompt,
      openGameSession: async (options) => {
        operations.push('session:open');
        expect(options.mode).toBe('classic');
        return { handle, packet: decision };
      },
      submitSessionCommand: async () => {
        operations.push('session:submit');
        return { accepted: true, step: { handle, packet: settlement } };
      },
      continueAfterHandResult: async () => {
        operations.push('session:continue');
        return { accepted: true, step: { handle, packet: gameResult } };
      },
    });

    expect(returned).toBe(gameResult);
    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(operations).toEqual([
      'write:本局种子：fixed-seed',
      'write:本桌对手：座位 1 老周“岩石”｜座位 2 林岚“猎手”｜座位 3 阿凯“疯狗”｜座位 4 苏蔓“伏蛇”｜座位 5 韩烈“重锤”',
      'session:open',
      'write:decision',
      'prompt:question',
      'session:submit',
      'wait:1000',
      'write:settlement',
      'session:continue',
      'write:game-result',
      'prompt:close',
    ]);
  });
});
