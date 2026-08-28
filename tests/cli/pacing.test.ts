import { describe, expect, it } from 'vitest';

import type { TournamentState } from '../../src/core/state.js';
import { main } from '../../src/cli/index.js';
import { createLinePacer } from '../../src/cli/pacing.js';

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

  it('routes the seed, public event batches, and diagnostics through one pacer', async () => {
    const operations: string[] = [];

    await main(['--seed', 'fixed-seed'], {
      write: (message) => { operations.push(`write:${message}`); },
      sleep: async (milliseconds) => { operations.push(`wait:${milliseconds}`); },
      randomUUID: () => 'unused-random-seed',
      createPrompt: () => ({
        question: async () => 'x',
        write: () => {},
        close: () => {},
      }),
      runTournament: async (options) => {
        await options.onPublicEvents?.([
          { type: 'handStarted', handNumber: 1, smallBlind: 1, bigBlind: 2 },
          { type: 'playerActed', seatIndex: 2, kind: 'check', paid: 0, betTo: 0, allIn: false },
        ]);
        await options.onPublicEvents?.([
          { type: 'gameCompleted', winnerSeat: 0 },
        ]);
        await options.onDiagnostic?.({
          type: 'AgentInvalidAction',
          playerId: '阿凯',
          seatIndex: 2,
          handNumber: 1,
          decisionIndex: 0,
          attemptedType: 'raiseTo',
          rejectionCode: 'malformed-decision',
          fallbackAction: 'fold',
        });
        return {} as TournamentState;
      },
    });

    expect(operations).toEqual([
      'write:本局种子：fixed-seed',
      'wait:1000',
      'write:第 1 手开始，盲注 1/2。',
      'wait:1000',
      'write:座位 2 过牌。',
      'wait:1000',
      'write:比赛结束，座位 0 成为冠军！',
      'wait:1000',
      'write:系统：阿凯 的 raiseTo 未被接受，改为 fold。',
    ]);
  });
});
