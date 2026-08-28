import { describe, expect, it } from 'vitest';

import type { TournamentConfig } from '../../src/core/config.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import type { LegalActionSet } from '../../src/core/legal-actions.js';
import { createSeededRandom } from '../../src/core/random.js';
import { chooseRandomLegalAction, runRandomHand } from '../../src/core/simulation.js';

const CONFIGURATIONS = [
  { startingStack: 1, smallBlind: 1, bigBlind: 2 },
  { startingStack: 3, smallBlind: 1, bigBlind: 2 },
  { startingStack: 10, smallBlind: 1, bigBlind: 2 },
  { startingStack: 40, smallBlind: 1, bigBlind: 2 },
  { startingStack: 100, smallBlind: 1, bigBlind: 2 },
  { startingStack: 100, smallBlind: 2, bigBlind: 5 },
] as const;

const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;
const CASES = PLAYER_COUNTS.flatMap((playerCount) => Array.from({ length: 20 }, (_, seedIndex) => ({
  playerCount,
  seedIndex,
  seed: `random-gate-${playerCount}-${seedIndex.toString().padStart(2, '0')}`,
  configuration: CONFIGURATIONS[seedIndex % CONFIGURATIONS.length]!,
})));

describe('deterministic legal action sampling', () => {
  it('returns only actions represented by the legal set and bounds every raise target', () => {
    const legal: LegalActionSet = {
      fold: true,
      check: false,
      call: { pay: 3, to: 5, isAllIn: false },
      raiseTo: { min: 8, max: 20 },
      allIn: { to: 20, mode: 'fullRaise' },
    };
    const first = Array.from({ length: 100 }, (_, index) => chooseRandomLegalAction(
      legal,
      createSeededRandom(`sampler-${index}`),
    ));
    const second = Array.from({ length: 100 }, (_, index) => chooseRandomLegalAction(
      legal,
      createSeededRandom(`sampler-${index}`),
    ));

    expect(first).toEqual(second);
    for (const action of first) {
      expect(['fold', 'call', 'raiseTo', 'allIn']).toContain(action.type);
      if (action.type === 'raiseTo') {
        expect([8, 14, 20]).toContain(action.amount);
      }
    }
  });
});

describe('100-hand randomized invariant gate', () => {
  it('runs exactly 20 fixed seeds for each supported player count across all stack/blind configs', () => {
    expect(CASES).toHaveLength(100);
    expect(new Set(CASES.map(({ seed }) => seed)).size).toBe(100);
    for (const playerCount of PLAYER_COUNTS) {
      expect(CASES.filter((testCase) => testCase.playerCount === playerCount)).toHaveLength(20);
    }
    expect(new Set(CASES.map(({ configuration }) =>
      `${configuration.startingStack}/${configuration.smallBlind}/${configuration.bigBlind}`)))
      .toEqual(new Set(['1/1/2', '3/1/2', '10/1/2', '40/1/2', '100/1/2', '100/2/5']));

    const results = CASES.map(({ playerCount, seed, configuration }) => {
      const tableConfig: TournamentConfig = {
        maxSeats: playerCount,
        startingStack: configuration.startingStack,
        handsPerLevel: 8,
        blindLevels: [{
          smallBlind: configuration.smallBlind,
          bigBlind: configuration.bigBlind,
        }],
        initialButtonSeat: 0,
      };
      return runRandomHand(
        tableConfig,
        Array.from({ length: playerCount }, (_, seatIndex) => ({
          playerId: `p${seatIndex}`,
          seatIndex,
        })),
        seed,
      );
    });

    expect(results).toHaveLength(100);
    expect(new Set(results.map(({ seed }) => seed)).size).toBe(100);
    for (const playerCount of PLAYER_COUNTS) {
      expect(results.filter((result) => result.playerCount === playerCount)).toHaveLength(20);
    }
    expect(new Set(results.map(({ configurationKey }) => configurationKey)))
      .toEqual(new Set(['1/1/2', '3/1/2', '10/1/2', '40/1/2', '100/1/2', '100/2/5']));
    for (const result of results) {
      expect(result.state.activeHand?.phase).toBe('hand-complete');
      expect(result.transitionCount).toBeLessThanOrEqual(500);
      expect(result.eventCount).toBe(result.state.eventLog.length);
      expect(result.invariantCheckCount).toBe(result.eventCount);
      expect(result.transitionReplayCheckCount).toBeGreaterThan(0);
      expect(result.seed).toMatch(/^random-gate-[2-6]-\d{2}$/);
      expect(result.playerCount).toBeGreaterThanOrEqual(2);
      expect(result.playerCount).toBeLessThanOrEqual(6);
      expect(new Set([
        '1/1/2', '3/1/2', '10/1/2', '40/1/2', '100/1/2', '100/2/5',
      ])).toContain(result.configurationKey);
      expect(() => assertTournamentInvariants(result.state)).not.toThrow();
    }
  });
});
