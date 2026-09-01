import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import type { TournamentConfig } from '../core/config.js';
import { createCharacterParticipant, selectNpcRoster } from '../game/roster.js';
import {
  continueAfterHandResult,
  openGameSession,
  submitSessionCommand,
} from '../game/game-session.js';
import type { GameResultPacket } from '../game/turn-packet.js';
import { type PromptIO } from './prompts.js';
import { parseCliOptions, promptForPlayerCount } from './options.js';
import { playRenderBlocks } from './semantic-pacing.js';
import { promptForTurnCommand } from './turn-command.js';
import { renderSessionRejection, renderTurnPacket } from './turn-renderer.js';

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
  openGameSession: typeof openGameSession;
  submitSessionCommand: typeof submitSessionCommand;
  continueAfterHandResult: typeof continueAfterHandResult;
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
    openGameSession,
    submitSessionCommand,
    continueAfterHandResult,
  };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  runtime: Readonly<CliRuntime> = defaultRuntime(),
): Promise<Readonly<GameResultPacket>> {
  const options = parseCliOptions(argv, runtime.randomUUID);
  const prompt = await runtime.createPrompt();
  try {
    const playerCount = options.playerCount ?? await promptForPlayerCount(prompt);
    const npcIds = selectNpcRoster(playerCount);
    const npcParticipants = npcIds.map((characterId) => createCharacterParticipant(characterId));
    const seats = Object.freeze([
      Object.freeze({ playerId: '你', seatIndex: 0 }),
      ...npcParticipants.map((participant, index) => Object.freeze({
        playerId: participant.playerId,
        seatIndex: index + 1,
      })),
    ]);
    const participants = Object.freeze([null, ...npcParticipants]);
    const config: TournamentConfig = Object.freeze({
      ...DEFAULT_TOURNAMENT_CONFIG,
      maxSeats: playerCount,
    });

    runtime.write(`本局种子：${options.seed}`);
    runtime.write(`本桌对手：${npcParticipants
      .map((participant, index) => `座位 ${index + 1} ${participant.playerId}`)
      .join('｜')}`);
    let { handle, packet } = await runtime.openGameSession({
      mode: 'classic',
      config,
      seats,
      participants,
      runSeed: options.seed,
      invalidAgentActionMode: 'fallback',
      humanSeatIndex: 0,
    });

    while (true) {
      if (packet.kind === 'decision') {
        await playRenderBlocks(renderTurnPacket(packet), runtime);
        const command = await promptForTurnCommand(packet, prompt);
        const result = await runtime.submitSessionCommand(handle, command);
        if (!result.accepted) {
          prompt.write(renderSessionRejection(result.rejection));
          packet = result.packet;
        } else {
          ({ handle, packet } = result.step);
        }
      } else if (packet.kind === 'hand-result') {
        await playRenderBlocks(renderTurnPacket(packet), runtime);
        const continued = await runtime.continueAfterHandResult(handle, packet.packetIndex);
        if (!continued.accepted) {
          throw new Error('Session rejected its current hand result');
        }
        ({ handle, packet } = continued.step);
      } else {
        await playRenderBlocks(renderTurnPacket(packet), runtime);
        return packet;
      }
    }
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
