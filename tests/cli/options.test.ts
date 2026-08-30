import { describe, expect, it, vi } from 'vitest';

import {
  parseCliOptions,
  promptForPlayerCount,
} from '../../src/cli/options.js';
import type { PromptIO } from '../../src/cli/prompts.js';

function ioFor(inputs: readonly string[]): { io: PromptIO; prompts: string[]; writes: string[] } {
  const queue = [...inputs];
  const prompts: string[] = [];
  const writes: string[] = [];
  return {
    io: {
      question: async (prompt) => {
        prompts.push(prompt);
        const answer = queue.shift();
        if (answer === undefined) throw new Error('prompt input queue exhausted');
        return answer;
      },
      write: (message) => { writes.push(message); },
    },
    prompts,
    writes,
  };
}

describe('CLI options parser', () => {
  it.each([
    [['--players', '2', '--seed', 'alpha'], { seed: 'alpha', playerCount: 2 }, 0],
    [['--seed', 'alpha', '--players', '4'], { seed: 'alpha', playerCount: 4 }, 0],
    [['--players', '6'], { seed: 'generated-seed', playerCount: 6 }, 1],
    [['--seed', 'alpha'], { seed: 'alpha', playerCount: null }, 0],
    [[], { seed: 'generated-seed', playerCount: null }, 1],
  ] as const)('parses %j without generating a seed before validation', (argv, expected, seedCalls) => {
    const createSeed = vi.fn(() => 'generated-seed');

    expect(parseCliOptions(argv, createSeed)).toEqual(expected);
    expect(createSeed).toHaveBeenCalledTimes(seedCalls);
  });

  it.each([
    [['--unknown'], '未知参数：--unknown'],
    [['hello'], '未知参数：hello'],
    [['--seed', 'alpha', '--seed', 'beta'], '--seed 只能使用一次'],
    [['--players', '2', '--players', '3'], '--players 只能使用一次'],
    [['--seed'], '--seed 需要一个非空值'],
    [['--seed', ''], '--seed 需要一个非空值'],
    [['--seed', '--players', '2'], '--seed 需要一个非空值'],
    [['--players'], '--players 需要 2 到 6 的整数'],
    [['--players', ''], '--players 需要 2 到 6 的整数'],
    [['--players', '--seed', 'alpha'], '--players 需要 2 到 6 的整数'],
    [['--players', '1'], '--players 需要 2 到 6 的整数'],
    [['--players', '7'], '--players 需要 2 到 6 的整数'],
    [['--players', '2.5'], '--players 需要 2 到 6 的整数'],
    [['--players', '02'], '--players 需要 2 到 6 的整数'],
    [['--players', 'abc'], '--players 需要 2 到 6 的整数'],
    [['--players', 'NaN'], '--players 需要 2 到 6 的整数'],
    [['--players', 'Infinity'], '--players 需要 2 到 6 的整数'],
  ] as const)('rejects %j before generating a seed', (argv, message) => {
    const createSeed = vi.fn(() => 'generated-seed');

    expect(() => parseCliOptions(argv, createSeed)).toThrow(message);
    expect(createSeed).not.toHaveBeenCalled();
  });
});

describe('player-count prompt', () => {
  it.each([
    ['', 4],
    ['2', 2],
    ['6', 6],
  ])('accepts %j as %i', async (input, expected) => {
    await expect(promptForPlayerCount(ioFor([input]).io)).resolves.toBe(expected);
  });

  it('retries invalid answers with the exact prompt and error', async () => {
    const { io, prompts, writes } = ioFor(['1', '2.5', 'abc', '5']);

    await expect(promptForPlayerCount(io)).resolves.toBe(5);
    expect(prompts).toEqual([
      '请选择牌桌人数（2-6，直接回车默认 4）：',
      '请选择牌桌人数（2-6，直接回车默认 4）：',
      '请选择牌桌人数（2-6，直接回车默认 4）：',
      '请选择牌桌人数（2-6，直接回车默认 4）：',
    ]);
    expect(writes).toEqual([
      '人数无效，请输入 2 到 6 的整数。',
      '人数无效，请输入 2 到 6 的整数。',
      '人数无效，请输入 2 到 6 的整数。',
    ]);
  });
});
