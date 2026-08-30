import { describe, expect, it, vi } from 'vitest';

import type { PlayerObservationV1 } from '../../src/agents/types.js';
import {
  DEFAULT_TOURNAMENT_CONFIG,
  main,
  type CliRuntime,
} from '../../src/cli/index.js';
import { parseCard } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';
import type { TournamentState } from '../../src/core/state.js';
import type { RunTournamentOptions } from '../../src/game/tournament-controller.js';

const PLAYER_COUNT_PROMPT = '请选择牌桌人数（2-6，直接回车默认 4）：';
const ACTION_PROMPT = '请选择操作（f/x/c/r <加注到>/a）：';

function observationForSixSeats(
  options: Readonly<RunTournamentOptions>,
): PlayerObservationV1 {
  return {
    schemaVersion: 1,
    handId: 'six-seat-preflop',
    handNumber: 1,
    decisionIndex: 5,
    actorSeatIndex: 0,
    street: 'preflop',
    holeCards: [parseCard('As'), parseCard('Kd')],
    board: [],
    buttonPosition: 4,
    smallBlindSeat: 5,
    bigBlindSeat: 0,
    smallBlind: 1,
    bigBlind: 2,
    potTotal: 12,
    sidePots: [],
    seats: options.participants.map((participant, seatIndex) => ({
      playerId: participant.playerId,
      seatIndex,
      stack: 98,
      status: 'active' as const,
      committedStreet: 2,
      committedHand: 2,
      revealedHoleCards: null,
    })),
    actionHistory: [
      { type: 'playerActed', seatIndex: 1, kind: 'call', paid: 2, betTo: 2, allIn: false },
      { type: 'playerActed', seatIndex: 2, kind: 'call', paid: 2, betTo: 2, allIn: false },
      { type: 'playerActed', seatIndex: 3, kind: 'call', paid: 2, betTo: 2, allIn: false },
      { type: 'playerActed', seatIndex: 4, kind: 'call', paid: 2, betTo: 2, allIn: false },
      { type: 'playerActed', seatIndex: 5, kind: 'call', paid: 1, betTo: 2, allIn: false },
    ],
    legalActions: {
      fold: false,
      check: true,
      call: null,
      raiseTo: { min: 4, max: 100 },
      allIn: { to: 100, mode: 'fullRaise' },
    },
  };
}

function promptWithInputs(
  inputs: readonly string[],
  promptQuestions: string[],
  promptWrites: string[],
  lifecycleOperations: string[],
): CliRuntime['createPrompt'] {
  const queue = [...inputs];
  return () => {
    lifecycleOperations.push('prompt:create');
    return {
      question: async (question) => {
        promptQuestions.push(question);
        lifecycleOperations.push(`prompt:question:${question}`);
        const answer = queue.shift();
        if (answer === undefined) throw new Error('prompt input queue exhausted');
        return answer;
      },
      write: (message) => {
        promptWrites.push(message);
        lifecycleOperations.push(`prompt:write:${message}`);
      },
      close: () => { lifecycleOperations.push('prompt:close'); },
    };
  };
}

function terminalState(): TournamentState {
  return {} as TournamentState;
}

describe('terminal table composition', () => {
  it('assembles six selected seats and renders only public human-table data', async () => {
    const promptQuestions: string[] = [];
    const promptWrites: string[] = [];
    const pacedOperations: string[] = [];
    const lifecycleOperations: string[] = [];
    let captured: Readonly<RunTournamentOptions> | undefined;

    await main(['--players', '6', '--seed', 'six-seat'], {
      write: (message) => {
        pacedOperations.push(`write:${message}`);
        lifecycleOperations.push(`paced:write:${message}`);
      },
      sleep: async (milliseconds) => {
        pacedOperations.push(`wait:${milliseconds}`);
        lifecycleOperations.push(`paced:wait:${milliseconds}`);
      },
      randomUUID: () => 'unused-random-seed',
      createPrompt: promptWithInputs(
        ['x'],
        promptQuestions,
        promptWrites,
        lifecycleOperations,
      ),
      runTournament: async (options) => {
        captured = options;
        lifecycleOperations.push('controller:start');
        const human = options.participants[0];
        if (human === undefined) throw new Error('human participant missing');
        const observation = observationForSixSeats(options);
        expect(observation.decisionIndex).toBe(5);
        expect(observation.potTotal).toBe(12);
        expect(observation.sidePots).toEqual([]);
        expect(observation.seats).toEqual(options.participants.map((participant, seatIndex) => ({
          playerId: participant.playerId,
          seatIndex,
          stack: 98,
          status: 'active',
          committedStreet: 2,
          committedHand: 2,
          revealedHoleCards: null,
        })));
        expect(observation.actionHistory).toEqual([
          { type: 'playerActed', seatIndex: 1, kind: 'call', paid: 2, betTo: 2, allIn: false },
          { type: 'playerActed', seatIndex: 2, kind: 'call', paid: 2, betTo: 2, allIn: false },
          { type: 'playerActed', seatIndex: 3, kind: 'call', paid: 2, betTo: 2, allIn: false },
          { type: 'playerActed', seatIndex: 4, kind: 'call', paid: 2, betTo: 2, allIn: false },
          { type: 'playerActed', seatIndex: 5, kind: 'call', paid: 1, betTo: 2, allIn: false },
        ]);
        expect(observation.legalActions).toEqual({
          fold: false,
          check: true,
          call: null,
          raiseTo: { min: 4, max: 100 },
          allIn: { to: 100, mode: 'fullRaise' },
        });
        await expect(human.decide({
          observation,
          random: createSeededRandom('six-seat-human'),
        })).resolves.toEqual({ action: { type: 'check' } });
        return terminalState();
      },
    });

    if (captured === undefined) throw new Error('tournament options were not captured');
    expect(captured.config.maxSeats).toBe(6);
    expect(DEFAULT_TOURNAMENT_CONFIG.maxSeats).toBe(4);
    expect(captured.participants.map((participant) => participant.playerId)).toEqual([
      '你',
      '老周“岩石”',
      '林岚“猎手”',
      '阿凯“疯狗”',
      '苏蔓“伏蛇”',
      '韩烈“重锤”',
    ]);
    expect(promptQuestions).toEqual([ACTION_PROMPT]);
    expect(pacedOperations).toContain('write:本局种子：six-seat');
    expect(pacedOperations).toContain(
      'write:本桌对手：座位 1 老周“岩石”｜座位 2 林岚“猎手”｜座位 3 阿凯“疯狗”｜座位 4 苏蔓“伏蛇”｜座位 5 韩烈“重锤”',
    );

    const table = promptWrites.join('\n');
    for (let seatIndex = 0; seatIndex < 6; seatIndex += 1) {
      expect(table).toContain(`座位 ${seatIndex}`);
    }
    expect(table).not.toContain('座位 6');
    for (const npcName of captured.participants.slice(1).map((participant) => participant.playerId)) {
      expect(table).toContain(npcName);
    }
    for (const privateKey of [
      'aggression',
      'bluffing',
      'slowPlay',
      'privateTrace',
      'fullOrderedDeck',
      'runSeed',
    ]) {
      expect(table).not.toContain(privateKey);
    }
  });

  it('retries the interactive player count before pacing the selected table', async () => {
    const promptQuestions: string[] = [];
    const promptWrites: string[] = [];
    const pacedOperations: string[] = [];
    const lifecycleOperations: string[] = [];
    const randomUUID = vi.fn(() => 'unused-random-seed');
    const createPrompt = vi.fn(promptWithInputs(
      ['bad', '5'],
      promptQuestions,
      promptWrites,
      lifecycleOperations,
    ));
    let captured: Readonly<RunTournamentOptions> | undefined;

    await main(['--seed', 'interactive'], {
      write: (message) => {
        pacedOperations.push(`write:${message}`);
        lifecycleOperations.push(`paced:write:${message}`);
      },
      sleep: async (milliseconds) => {
        pacedOperations.push(`wait:${milliseconds}`);
        lifecycleOperations.push(`paced:wait:${milliseconds}`);
      },
      randomUUID,
      createPrompt,
      runTournament: async (options) => {
        captured = options;
        lifecycleOperations.push('controller:start');
        return terminalState();
      },
    });

    if (captured === undefined) throw new Error('tournament options were not captured');
    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(randomUUID).not.toHaveBeenCalled();
    expect(promptQuestions).toEqual([PLAYER_COUNT_PROMPT, PLAYER_COUNT_PROMPT]);
    expect(promptWrites).toEqual(['人数无效，请输入 2 到 6 的整数。']);
    expect(captured.participants.map((participant) => participant.playerId)).toEqual([
      '你',
      '老周“岩石”',
      '林岚“猎手”',
      '程墨“小刀”',
      '韩烈“重锤”',
    ]);
    expect(pacedOperations).toEqual([
      'write:本局种子：interactive',
      'wait:1000',
      'write:本桌对手：座位 1 老周“岩石”｜座位 2 林岚“猎手”｜座位 3 程墨“小刀”｜座位 4 韩烈“重锤”',
    ]);
    expect(lifecycleOperations).toEqual([
      'prompt:create',
      `prompt:question:${PLAYER_COUNT_PROMPT}`,
      'prompt:write:人数无效，请输入 2 到 6 的整数。',
      `prompt:question:${PLAYER_COUNT_PROMPT}`,
      'paced:write:本局种子：interactive',
      'paced:wait:1000',
      'paced:write:本桌对手：座位 1 老周“岩石”｜座位 2 林岚“猎手”｜座位 3 程墨“小刀”｜座位 4 韩烈“重锤”',
      'controller:start',
      'prompt:close',
    ]);
  });

  it('uses the legacy four-person roster for an empty interactive count and closes once', async () => {
    const promptQuestions: string[] = [];
    const promptWrites: string[] = [];
    const lifecycleOperations: string[] = [];
    let captured: Readonly<RunTournamentOptions> | undefined;

    await main(['--seed', 'legacy-four'], {
      write: () => {},
      sleep: async () => {},
      randomUUID: () => 'unused-random-seed',
      createPrompt: promptWithInputs([''], promptQuestions, promptWrites, lifecycleOperations),
      runTournament: async (options) => {
        captured = options;
        lifecycleOperations.push('controller:start');
        return terminalState();
      },
    });

    if (captured === undefined) throw new Error('tournament options were not captured');
    expect(captured.participants.map((participant) => participant.playerId)).toEqual([
      '你',
      '林岚“猎手”',
      '阿凯“疯狗”',
      '莫叔“跟注站”',
    ]);
    expect(promptQuestions).toEqual([PLAYER_COUNT_PROMPT]);
    expect(promptWrites).toEqual([]);
    expect(lifecycleOperations.filter((operation) => operation === 'prompt:close')).toHaveLength(1);
  });

  it('closes the prompt once while preserving a controller rejection', async () => {
    const promptQuestions: string[] = [];
    const promptWrites: string[] = [];
    const lifecycleOperations: string[] = [];
    const sentinel = new Error('controller failed');

    await expect(main(['--players', '4', '--seed', 'failing'], {
      write: () => {},
      sleep: async () => {},
      randomUUID: () => 'unused-random-seed',
      createPrompt: promptWithInputs([], promptQuestions, promptWrites, lifecycleOperations),
      runTournament: async () => {
        lifecycleOperations.push('controller:start');
        throw sentinel;
      },
    })).rejects.toThrow(sentinel);

    expect(lifecycleOperations.filter((operation) => operation === 'prompt:close')).toHaveLength(1);
  });
});
