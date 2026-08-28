import type { ActionIntent, LegalActionSet } from '../core/legal-actions.js';

export interface PromptIO {
  question(prompt: string): Promise<string>;
  write(message: string): void;
}

const INVALID_ACTION_MESSAGE = '无效操作，请输入当前合法命令。';

export async function promptForLegalAction(
  legal: Readonly<LegalActionSet>,
  io: Readonly<PromptIO>,
): Promise<ActionIntent> {
  while (true) {
    const answer = (await io.question('请选择操作（f/x/c/r <加注到>/a）：')).trim();
    if (answer === 'f' && legal.fold) return { type: 'fold' };
    if (answer === 'x' && legal.check) return { type: 'check' };
    if (answer === 'c' && legal.call !== null) return { type: 'call' };
    if (answer === 'a' && legal.allIn !== null) return { type: 'allIn' };

    const raise = /^r ([0-9]+)$/.exec(answer);
    if (raise !== null && legal.raiseTo !== null) {
      const amount = Number(raise[1]);
      if (Number.isSafeInteger(amount)
        && amount > 0
        && amount >= legal.raiseTo.min
        && amount <= legal.raiseTo.max) {
        return { type: 'raiseTo', amount };
      }
    }
    io.write(INVALID_ACTION_MESSAGE);
  }
}
