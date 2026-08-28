import { describe, expect, it } from 'vitest';

import type { ActionIntent, LegalActionSet } from '../../src/core/legal-actions.js';
import { promptForLegalAction, type PromptIO } from '../../src/cli/prompts.js';

function ioFor(inputs: readonly string[]): { io: PromptIO; writes: string[] } {
  const queue = [...inputs];
  const writes: string[] = [];
  return {
    io: {
      question: async () => queue.shift() ?? '',
      write: (message) => { writes.push(message); },
    },
    writes,
  };
}

const facingBet: LegalActionSet = {
  fold: true,
  check: false,
  call: { pay: 4, to: 8, isAllIn: false },
  raiseTo: { min: 12, max: 40 },
  allIn: { to: 40, mode: 'fullRaise' },
};

describe('legal action prompt', () => {
  it.each<[string, LegalActionSet, ActionIntent]>([
    ['f', facingBet, { type: 'fold' }],
    ['c', facingBet, { type: 'call' }],
    ['r 12', facingBet, { type: 'raiseTo', amount: 12 }],
    ['a', facingBet, { type: 'allIn' }],
    ['x', { ...facingBet, fold: false, check: true, call: null }, { type: 'check' }],
  ])('accepts exact legal command %s', async (input, legal, expected) => {
    const { io } = ioFor([`  ${input}  `]);
    await expect(promptForLegalAction(legal, io)).resolves.toEqual(expected);
  });

  it('rejects malformed, unavailable, unsafe, and out-of-range commands before reprompting', async () => {
    const { io, writes } = ioFor([
      'x', 'fold now', 'r', 'r 12 13', 'r 12.5', 'r -1',
      'r 9007199254740992', 'r 11', 'r 41', 'r 20',
    ]);

    await expect(promptForLegalAction(facingBet, io))
      .resolves.toEqual({ type: 'raiseTo', amount: 20 });
    expect(writes).toHaveLength(9);
    expect(writes.every((message) => /无效|合法|请输入/.test(message))).toBe(true);
  });
});
