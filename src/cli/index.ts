import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { createCharacterAgent } from '../agents/characters.js';
import type { DecisionContext } from '../agents/types.js';
import type { TournamentConfig } from '../core/config.js';
import type { TournamentState } from '../core/state.js';
import { AgentParticipant, type Participant } from '../game/participant.js';
import {
  runTournament,
  type RunTournamentOptions,
} from '../game/tournament-controller.js';
import { promptForLegalAction, type PromptIO } from './prompts.js';
import { createLinePacer } from './pacing.js';
import { renderPublicEvents, renderTable } from './renderer.js';

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = Object.freeze({
  maxSeats: 4,
  startingStack: 100,
  handsPerLevel: 8,
  blindLevels: Object.freeze([
    Object.freeze({ smallBlind: 1, bigBlind: 2 }),
    Object.freeze({ smallBlind: 2, bigBlind: 4 }),
    Object.freeze({ smallBlind: 3, bigBlind: 6 }),
    Object.freeze({ smallBlind: 5, bigBlind: 10 }),
    Object.freeze({ smallBlind: 10, bigBlind: 20 }),
    Object.freeze({ smallBlind: 20, bigBlind: 40 }),
    Object.freeze({ smallBlind: 40, bigBlind: 80 }),
    Object.freeze({ smallBlind: 80, bigBlind: 160 }),
  ]),
  initialButtonSeat: 0,
});

export interface CliPrompt extends PromptIO {
  close(): void | Promise<void>;
}

export interface CliRuntime {
  write(message: string): void;
  sleep(milliseconds: number): Promise<void>;
  randomUUID(): string;
  createPrompt(): CliPrompt | Promise<CliPrompt>;
  runTournament(options: Readonly<RunTournamentOptions>): Promise<TournamentState>;
}

function defaultRuntime(): CliRuntime {
  return {
    write: (message) => { process.stdout.write(message.endsWith('\n') ? message : `${message}\n`); },
    sleep,
    randomUUID,
    createPrompt: () => {
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      return {
        question: (prompt) => readline.question(prompt),
        write: (message) => { process.stdout.write(message.endsWith('\n') ? message : `${message}\n`); },
        close: () => { readline.close(); },
      };
    },
    runTournament,
  };
}

function parseSeed(argv: readonly string[], uuid: () => string): string {
  let seed: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--seed') throw new Error(`未知参数：${argument ?? ''}`);
    if (seed !== undefined) throw new Error('--seed 只能使用一次');
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new Error('--seed 需要一个非空值');
    }
    seed = value;
    index += 1;
  }
  return seed ?? uuid();
}

class HumanParticipant implements Participant {
  public readonly playerId = '你';
  readonly #io: Readonly<PromptIO>;

  public constructor(io: Readonly<PromptIO>) {
    this.#io = io;
  }

  public async decide(context: Readonly<DecisionContext>) {
    this.#io.write(renderTable(context.observation));
    return { action: await promptForLegalAction(context.observation.legalActions, this.#io) };
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  runtime: Readonly<CliRuntime> = defaultRuntime(),
): Promise<TournamentState> {
  const seed = parseSeed(argv, runtime.randomUUID);
  const paceLine = createLinePacer(runtime.write, runtime.sleep, 1_000);
  await paceLine(`本局种子：${seed}`);
  const prompt = await runtime.createPrompt();
  try {
    const participants: Participant[] = [
      new HumanParticipant(prompt),
      new AgentParticipant('林岚“猎手”', createCharacterAgent('hunter')),
      new AgentParticipant('阿凯“疯狗”', createCharacterAgent('maniac')),
      new AgentParticipant('莫叔“跟注站”', createCharacterAgent('calling-station')),
    ];
    return await runtime.runTournament({
      config: DEFAULT_TOURNAMENT_CONFIG,
      participants,
      runSeed: seed,
      invalidAgentActionMode: 'fallback',
      publicViewerSeatIndex: 0,
      onPublicEvents: async (events) => {
        const rendered = renderPublicEvents(events);
        if (rendered.length > 0) await paceLine(rendered);
      },
      onDiagnostic: async (event) => {
        await paceLine(`系统：${event.playerId} 的 ${event.attemptedType} 未被接受，改为 ${event.fallbackAction}。`);
      },
    });
  } finally {
    await prompt.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '未知错误';
    process.stderr.write(`错误：${message}\n`);
    process.exitCode = 1;
  });
}
