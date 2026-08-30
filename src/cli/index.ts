import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import type { DecisionContext } from '../agents/types.js';
import type { TournamentConfig } from '../core/config.js';
import type { TournamentState } from '../core/state.js';
import { createCharacterParticipant, selectNpcRoster } from '../game/roster.js';
import type { Participant } from '../game/participant.js';
import {
  runTournament,
  type RunTournamentOptions,
} from '../game/tournament-controller.js';
import { promptForLegalAction, type PromptIO } from './prompts.js';
import { parseCliOptions, promptForPlayerCount } from './options.js';
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
  const options = parseCliOptions(argv, runtime.randomUUID);
  const paceLine = createLinePacer(runtime.write, runtime.sleep, 1_000);
  const prompt = await runtime.createPrompt();
  try {
    const playerCount = options.playerCount ?? await promptForPlayerCount(prompt);
    const npcIds = selectNpcRoster(playerCount);
    const participants: Participant[] = [
      new HumanParticipant(prompt),
      ...npcIds.map((characterId) => createCharacterParticipant(characterId)),
    ];
    const config: TournamentConfig = Object.freeze({
      ...DEFAULT_TOURNAMENT_CONFIG,
      maxSeats: playerCount,
    });

    await paceLine(`本局种子：${options.seed}`);
    await paceLine(`本桌对手：${participants.slice(1)
      .map((participant, index) => `座位 ${index + 1} ${participant.playerId}`)
      .join('｜')}`);
    return await runtime.runTournament({
      config,
      participants,
      runSeed: options.seed,
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
