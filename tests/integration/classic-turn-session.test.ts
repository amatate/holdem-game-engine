import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TournamentConfig } from '../../src/core/config.js';
import type { ActionIntent } from '../../src/core/legal-actions.js';
import type { Participant } from '../../src/game/participant.js';
import {
  continueAfterHandResult,
  openGameSession,
  submitSessionCommand,
} from '../../src/game/game-session.js';
import type { GameSessionHandle } from '../../src/game/session-types.js';
import { runTournament } from '../../src/game/tournament-controller.js';
import type {
  TournamentDriver,
  TournamentDriverOptions,
} from '../../src/game/tournament-driver.js';
import type {
  ClassicDecisionPacket,
  RenderableCommand,
  TurnPacket,
} from '../../src/game/turn-packet.js';

const capture = vi.hoisted(() => ({
  drivers: [] as TournamentDriver[],
}));

vi.mock('../../src/game/tournament-driver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/game/tournament-driver.js')>();
  return {
    ...actual,
    createTournamentDriver(options: Readonly<TournamentDriverOptions>) {
      const real = actual.createTournamentDriver(options);
      capture.drivers.push(real);
      return new Proxy(real, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

const MAX_COMMANDS = 20_000;

type RandomTrace = Readonly<{
  seatIndex: number;
  decisionIndex: number;
  seedHash: number;
  draws: readonly [number, number];
}>;

interface SessionRun {
  readonly handle: GameSessionHandle;
  readonly packets: readonly Readonly<TurnPacket>[];
  readonly acknowledgedHandPacketIndexes: readonly number[];
}

function tournamentConfig(playerCount: number): TournamentConfig {
  return {
    maxSeats: playerCount,
    startingStack: 20,
    handsPerLevel: 3,
    blindLevels: [
      { smallBlind: 1, bigBlind: 2 },
      { smallBlind: 2, bigBlind: 4 },
      { smallBlind: 4, bigBlind: 8 },
      { smallBlind: 8, bigBlind: 16 },
      { smallBlind: 16, bigBlind: 32 },
    ],
    initialButtonSeat: 0,
  };
}

function passiveIntent(packet: Readonly<ClassicDecisionPacket>): ActionIntent {
  const legal = packet.observation.legalActions;
  if (legal.check) return { type: 'check' };
  if (legal.call !== null) return { type: 'call' };
  return { type: 'fold' };
}

function commandSupportsIntent(
  command: Readonly<RenderableCommand>,
  intent: Readonly<ActionIntent>,
): boolean {
  if (command.kind === 'raise-range') {
    return intent.type === 'raiseTo'
      && intent.amount >= command.minimum
      && intent.amount <= command.maximum;
  }
  return command.intent.type === intent.type;
}

function createPassiveParticipants(
  playerCount: number,
  trace?: RandomTrace[],
): Participant[] {
  return Array.from({ length: playerCount }, (_, seatIndex) => ({
    playerId: `player-${seatIndex}`,
    decide: async ({ observation, random }) => {
      if (trace !== undefined) {
        trace.push({
          seatIndex: observation.actorSeatIndex,
          decisionIndex: observation.decisionIndex,
          seedHash: random.seedHash,
          draws: [random.nextUint32(), random.nextUint32()],
        });
      }
      const legal = observation.legalActions;
      if (legal.check) return { action: { type: 'check' } };
      if (legal.call !== null) return { action: { type: 'call' } };
      return { action: { type: 'fold' } };
    },
  }));
}

async function runClassicSession(
  config: TournamentConfig,
  runSeed: string,
  participants: readonly Participant[],
): Promise<SessionRun> {
  const seats = participants.map((participant, seatIndex) => ({
    playerId: participant.playerId,
    seatIndex,
  }));
  let { handle, packet } = await openGameSession({
    mode: 'classic',
    config,
    runSeed,
    humanSeatIndex: 0,
    seats,
    participants: [null, ...participants.slice(1)],
    maxTransitions: MAX_COMMANDS,
  });
  const packets: Readonly<TurnPacket>[] = [];
  const acknowledgedHandPacketIndexes: number[] = [];
  let commandCount = 0;

  while (true) {
    packets.push(packet);
    if (packet.kind === 'game-result') break;
    commandCount += 1;
    if (commandCount > MAX_COMMANDS) {
      throw new Error(`classic session exceeded ${MAX_COMMANDS} commands`);
    }

    if (packet.kind === 'decision') {
      const intent = passiveIntent(packet);
      expect(packet.actionPanel.commands.some((command) => commandSupportsIntent(command, intent)))
        .toBe(true);
      const result = await submitSessionCommand(handle, {
        type: 'act',
        decisionKey: packet.decisionKey,
        expectedPacketIndex: packet.packetIndex,
        intent,
      });
      expect(result.accepted).toBe(true);
      if (!result.accepted) throw new Error(`passive intent rejected: ${result.rejection}`);
      ({ handle, packet } = result.step);
      continue;
    }

    acknowledgedHandPacketIndexes.push(packet.packetIndex);
    const result = await continueAfterHandResult(handle, packet.packetIndex);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(`hand result acknowledgement rejected: ${result.rejection}`);
    ({ handle, packet } = result.step);
  }

  return { handle, packets, acknowledgedHandPacketIndexes };
}

function expectCompletePacketDelivery(run: Readonly<SessionRun>, initialChipTotal: number): void {
  expect(run.packets.map((packet) => packet.packetIndex))
    .toEqual(run.packets.map((_, index) => index));
  expect(run.packets[0]?.coreEventRange.fromVersionInclusive).toBe(0);
  for (const packet of run.packets) {
    expect(packet.coreEventRange.toVersionExclusive)
      .toBeGreaterThanOrEqual(packet.coreEventRange.fromVersionInclusive);
  }
  for (let index = 1; index < run.packets.length; index += 1) {
    expect(run.packets[index]!.coreEventRange.fromVersionInclusive)
      .toBe(run.packets[index - 1]!.coreEventRange.toVersionExclusive);
  }

  const handPacketIndexes = run.packets
    .filter((packet) => packet.kind === 'hand-result')
    .map((packet) => packet.packetIndex);
  expect(run.acknowledgedHandPacketIndexes).toEqual(handPacketIndexes);
  expect(new Set(run.acknowledgedHandPacketIndexes).size)
    .toBe(run.acknowledgedHandPacketIndexes.length);

  const gameResult = run.packets.at(-1);
  expect(gameResult?.kind).toBe('game-result');
  if (gameResult?.kind !== 'game-result') throw new Error('session did not finish at game result');
  expect(gameResult.finalStacks.reduce((sum, seat) => sum + seat.stack, 0))
    .toBe(initialChipTotal);
  expect(gameResult.finalStacks.filter((seat) => seat.stack > 0)).toEqual([
    { seatIndex: gameResult.winnerSeatIndex, stack: initialChipTotal },
  ]);
}

beforeEach(() => {
  capture.drivers.length = 0;
});

describe('classic TurnPacket tournament sessions', () => {
  it.each([2, 6])(
    'delivers one contiguous, acknowledged packet stream for a real %i-seat session',
    async (playerCount) => {
      const config = tournamentConfig(playerCount);
      const run = await runClassicSession(
        config,
        `classic-turn-session-${playerCount}`,
        createPassiveParticipants(playerCount),
      );

      expectCompletePacketDelivery(run, playerCount * config.startingStack);
    },
    30_000,
  );

  it('preserves legacy authority, participant RNG paths, and the opaque public handle', async () => {
    const playerCount = 4;
    const config = tournamentConfig(playerCount);
    const runSeed = 'classic-session-authority-equivalence-v1';
    const legacyTrace: RandomTrace[] = [];
    const sessionTrace: RandomTrace[] = [];
    const legacyParticipants = createPassiveParticipants(playerCount, legacyTrace);
    const sessionParticipants = createPassiveParticipants(playerCount, sessionTrace);

    for (let index = 0; index < playerCount; index += 1) {
      expect(sessionParticipants[index]).not.toBe(legacyParticipants[index]);
    }

    const legacyState = await runTournament({
      config,
      participants: legacyParticipants,
      runSeed,
      maxTransitions: MAX_COMMANDS,
    });
    const sessionRun = await runClassicSession(config, runSeed, sessionParticipants);
    expectCompletePacketDelivery(sessionRun, playerCount * config.startingStack);

    expect(capture.drivers).toHaveLength(1);
    const sessionAuthority = capture.drivers[0]!.getAuthorityState();
    expect(sessionRun.packets.at(-1)?.coreEventRange.toVersionExclusive)
      .toBe(sessionAuthority.version);
    expect(sessionAuthority.eventLog).toEqual(legacyState.eventLog);
    expect(sessionAuthority.seats).toEqual(legacyState.seats);
    expect(sessionAuthority.version).toBe(legacyState.version);
    expect(sessionAuthority.runSeed).toBe(legacyState.runSeed);
    expect(sessionTrace).toEqual(legacyTrace.filter((entry) => entry.seatIndex !== 0));

    expect(Object.keys(sessionRun.handle)).toEqual([]);
    expect(Reflect.ownKeys(sessionRun.handle)).toEqual([]);
    expect(Object.getOwnPropertyDescriptors(sessionRun.handle)).toEqual({});
    expect(JSON.stringify(sessionRun.handle)).toBe('{}');

    const rootSource = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    expect(rootSource).not.toMatch(/tournament-driver(?:\.js|\.ts)?/);
  }, 30_000);
});
