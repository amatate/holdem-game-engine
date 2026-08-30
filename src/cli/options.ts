import type { PromptIO } from './prompts.js';

export interface ParsedCliOptions {
  readonly seed: string;
  readonly playerCount: number | null;
}

const PLAYER_COUNT_PROMPT = '请选择牌桌人数（2-6，直接回车默认 4）：';
const INVALID_PLAYER_COUNT = '人数无效，请输入 2 到 6 的整数。';

function parsePlayerCount(value: string): number {
  if (!/^[2-6]$/.test(value)) {
    throw new Error('--players 需要 2 到 6 的整数');
  }
  return Number(value);
}

export function parseCliOptions(
  argv: readonly string[],
  createSeed: () => string,
): ParsedCliOptions {
  let seed: string | undefined;
  let playerCount: number | null = null;
  let sawPlayers = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--seed') {
      if (seed !== undefined) throw new Error('--seed 只能使用一次');
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw new Error('--seed 需要一个非空值');
      }
      seed = value;
      index += 1;
      continue;
    }
    if (argument === '--players') {
      if (sawPlayers) throw new Error('--players 只能使用一次');
      const value = argv[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw new Error('--players 需要 2 到 6 的整数');
      }
      playerCount = parsePlayerCount(value);
      sawPlayers = true;
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${argument ?? ''}`);
  }

  const resolvedSeed = seed ?? createSeed();
  if (typeof resolvedSeed !== 'string' || resolvedSeed.length === 0) {
    throw new Error('随机种子必须是非空文本');
  }
  return Object.freeze({ seed: resolvedSeed, playerCount });
}

export async function promptForPlayerCount(io: Readonly<PromptIO>): Promise<number> {
  while (true) {
    const answer = (await io.question(PLAYER_COUNT_PROMPT)).trim();
    if (answer === '') return 4;
    if (/^[2-6]$/.test(answer)) return Number(answer);
    io.write(INVALID_PLAYER_COUNT);
  }
}
