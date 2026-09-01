import { describe, expect, it } from 'vitest';

import { parseCard } from '../../src/core/cards.js';
import type { ClassicDecisionPacket } from '../../src/game/turn-packet.js';
import { parseTurnCommand, promptForTurnCommand } from '../../src/cli/turn-command.js';
import type { PromptIO } from '../../src/cli/prompts.js';

function packetWith(
  commands: ClassicDecisionPacket['actionPanel']['commands'],
): ClassicDecisionPacket {
  const packet: ClassicDecisionPacket = {
    schemaVersion: 1,
    kind: 'decision',
    packetIndex: 7,
    decisionKey: 'hand/3/seat/0/decision/4',
    coreEventRange: { fromVersionInclusive: 10, toVersionExclusive: 12 },
    viewerEventsSinceLastPacket: [],
    privateEventsSinceLastPacket: [] as const,
    observation: {
      schemaVersion: 1,
      handId: 'private-hand-id',
      handNumber: 3,
      decisionIndex: 4,
      actorSeatIndex: 0,
      street: 'turn',
      holeCards: [parseCard('Ah'), parseCard('Kd')],
      board: ['7s', '3h', '2h', 'Qc'].map(parseCard),
      buttonPosition: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      smallBlind: 2,
      bigBlind: 4,
      potTotal: 6,
      sidePots: [],
      seats: [],
      actionHistory: [],
      legalActions: {
        fold: true,
        check: false,
        call: { pay: 4, to: 8, isAllIn: false },
        raiseTo: { min: 12, max: 100 },
        allIn: { to: 100, mode: 'fullRaise' },
      },
    },
    actionPanel: {
      currentBetTo: 8,
      facingBet: true,
      tableCommittedTotal: 6,
      heroContestableTotal: 10,
      commands,
    },
    abilities: null,
  };
  return Object.freeze(packet);
}

const facingBet = packetWith([
  { kind: 'fixed', inputs: ['f'], label: '弃牌', intent: { type: 'fold' } },
  { kind: 'fixed', inputs: ['c'], label: '跟注 4', intent: { type: 'call' } },
  {
    kind: 'raise-range', inputPattern: 'r <金额>', label: '加注到', minimum: 12, maximum: 100,
  },
  { kind: 'fixed', inputs: ['a'], label: '全下 100', intent: { type: 'allIn' } },
]);

describe('turn command parser', () => {
  it.each([
    ['f', { type: 'fold' }],
    ['x', { type: 'check' }],
    ['c', { type: 'call' }],
    ['r 12', { type: 'raiseTo', amount: 12 }],
    ['a', { type: 'allIn' }],
  ] as const)('builds a plain trusted act command for %s from the action panel', (input, intent) => {
    const packet = input === 'x'
      ? packetWith([{ kind: 'fixed', inputs: ['x', 'c'], label: '过牌', intent: { type: 'check' } }])
      : facingBet;

    const result = parseTurnCommand(input, packet);

    expect(result).toEqual({
      ok: true,
      command: {
        type: 'act',
        decisionKey: packet.decisionKey,
        expectedPacketIndex: packet.packetIndex,
        intent,
      },
    });
    if (result.ok) {
      expect(Object.getPrototypeOf(result.command)).toBe(Object.prototype);
      if (result.command.type !== 'act') throw new Error('expected act command');
      expect(Object.getPrototypeOf(result.command.intent)).toBe(Object.prototype);
    }
  });

  it('uses c as the check alias only when the panel assigns c to check', () => {
    const checking = packetWith([
      { kind: 'fixed', inputs: ['x', 'c'], label: 'HOSTILE LABEL', intent: { type: 'check' } },
    ]);

    expect(parseTurnCommand('c', checking)).toMatchObject({
      ok: true,
      command: { type: 'act', intent: { type: 'check' } },
    });
  });

  it('does not reconstruct poker legality from labels or observation legal actions', () => {
    const emptyPanel = packetWith([]);
    const hostileLabel = packetWith([
      { kind: 'fixed', inputs: ['f'], label: 'c 跟注 4 | a 全下 100', intent: { type: 'fold' } },
    ]);

    expect(parseTurnCommand('c', emptyPanel)).toEqual({
      ok: false, message: '无效操作，请输入当前合法命令。',
    });
    expect(parseTurnCommand('a', hostileLabel)).toEqual({
      ok: false, message: '无效操作，请输入当前合法命令。',
    });
  });

  it('keeps call-all-in on c and rejects the absent a synonym', () => {
    const callAllIn = packetWith([
      { kind: 'fixed', inputs: ['c'], label: '跟注 4（全下）', intent: { type: 'call' } },
    ]);

    expect(parseTurnCommand('c', callAllIn)).toMatchObject({ ok: true, command: { intent: { type: 'call' } } });
    expect(parseTurnCommand('a', callAllIn)).toEqual({
      ok: false, message: '无效操作，请输入当前合法命令。',
    });
  });

  it('gives the fixed facing-bet guidance for x', () => {
    expect(parseTurnCommand('x', facingBet)).toEqual({
      ok: false,
      message: '当前不能过牌，请跟注或弃牌。',
    });
  });

  it('derives the x rejection only from command intents, not action-panel flags', () => {
    const contradictory = {
      ...facingBet,
      actionPanel: { ...facingBet.actionPanel, facingBet: false },
    };

    expect(parseTurnCommand('x', contradictory)).toEqual({
      ok: false,
      message: '当前不能过牌，请跟注或弃牌。',
    });
  });

  it.each([
    'r', 'r 12 13', 'r 12.5', 'r -12', 'r +12', 'r 9007199254740992', 'r 11', 'r 101',
  ])('rejects malformed, unsafe, or out-of-range raise %s', (input) => {
    expect(parseTurnCommand(input, facingBet)).toEqual({
      ok: false, message: '无效操作，请输入当前合法命令。',
    });
  });

  it.each([
    ['u peek 2', { ability: 'peek', targetSeatIndex: 2 }],
    ['u read 3', { ability: 'read', targetSeatIndex: 3 }],
    ['u swap 1', { ability: 'swap', holeCardIndex: 0 }],
    ['u swap 2', { ability: 'swap', holeCardIndex: 1 }],
  ] as const)('parses ability grammar in classic for session-level rejection: %s', (input, abilityFields) => {
    expect(parseTurnCommand(input, facingBet)).toEqual({
      ok: true,
      command: {
        type: 'useAbility',
        decisionKey: facingBet.decisionKey,
        expectedPacketIndex: facingBet.packetIndex,
        ...abilityFields,
      },
    });
  });

  it.each([
    'u peek', 'u peek 2 now', 'u peek -1', 'u peek 2.5', 'u peek 9007199254740992',
    'u read', 'u read +3', 'u swap', 'u swap 0', 'u swap 3', 'u swap 1 now', 'u unknown 1',
  ])('rejects malformed ability grammar %s', (input) => {
    expect(parseTurnCommand(input, facingBet)).toEqual({
      ok: false, message: '无效操作，请输入当前合法命令。',
    });
  });

  it('reprompts with safe parser messages and never advertises abilities', async () => {
    const answers = ['x', 'u nope 1', 'c'];
    const prompts: string[] = [];
    const writes: string[] = [];
    const io: PromptIO = {
      question: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? '';
      },
      write: (message) => { writes.push(message); },
    };

    await expect(promptForTurnCommand(facingBet, io)).resolves.toEqual({
      type: 'act',
      decisionKey: facingBet.decisionKey,
      expectedPacketIndex: facingBet.packetIndex,
      intent: { type: 'call' },
    });
    expect(writes).toEqual([
      '当前不能过牌，请跟注或弃牌。',
      '无效操作，请输入当前合法命令。',
    ]);
    expect(prompts).toEqual(Array(3).fill('请选择操作（f/x/c/r <加注到>/a）：'));
    expect(prompts.join('')).not.toContain('u ');
  });
});
