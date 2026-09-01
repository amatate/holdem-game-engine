import { describe, expect, it } from 'vitest';

import type { RenderBlock } from '../../src/cli/turn-renderer.js';
import { playRenderBlocks } from '../../src/cli/semantic-pacing.js';

describe('semantic render-block pacing', () => {
  it('waits before major boundaries and writes each complete block exactly once', async () => {
    const blocks: readonly RenderBlock[] = [
      { kind: 'ordinary-actions', delayBeforeMs: 0, text: '座位 1 过牌。\n座位 2 过牌。' },
      { kind: 'street-reveal', delayBeforeMs: 1000, text: '翻牌：7♠ 3♥ 2♥。' },
      { kind: 'decision', delayBeforeMs: 0, text: '当前桌面投入 6；你当前可争夺 6。\n操作：x/c 过牌 | r 4-100 下注到 | a 全下 100' },
    ];
    const operations: string[] = [];

    await playRenderBlocks(blocks, {
      write: (message) => { operations.push(`write:${message}`); },
      sleep: async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
    });

    expect(operations).toEqual([
      'write:座位 1 过牌。\n座位 2 过牌。',
      'wait:1000',
      'write:翻牌：7♠ 3♥ 2♥。',
      'write:当前桌面投入 6；你当前可争夺 6。\n操作：x/c 过牌 | r 4-100 下注到 | a 全下 100',
    ]);
  });

  it('does not carry timing state across packet playback calls', async () => {
    const operations: string[] = [];
    const runtime = {
      write: (message: string) => { operations.push(`write:${message}`); },
      sleep: async (milliseconds: number) => { operations.push(`wait:${milliseconds}`); },
    };

    await playRenderBlocks([
      { kind: 'settlement', delayBeforeMs: 1000, text: '第 1 手结算' },
    ], runtime);
    await playRenderBlocks([
      { kind: 'ordinary-actions', delayBeforeMs: 0, text: '第 2 手开始' },
    ], runtime);

    expect(operations).toEqual([
      'wait:1000',
      'write:第 1 手结算',
      'write:第 2 手开始',
    ]);
  });

  it('does no work for an empty block list', async () => {
    const operations: string[] = [];

    await playRenderBlocks([], {
      write: (message) => { operations.push(`write:${message}`); },
      sleep: async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
    });

    expect(operations).toEqual([]);
  });
});
