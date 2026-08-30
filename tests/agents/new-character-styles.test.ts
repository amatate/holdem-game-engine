import { describe, expect, it } from 'vitest';

import {
  CHARACTER_IDS,
  createCharacterAgent,
  type CharacterId,
} from '../../src/agents/characters.js';
import type { EquityProvider } from '../../src/agents/parametric-agent.js';
import type { PlayerObservationV1, PublicSeatState } from '../../src/agents/types.js';
import type { ActionIntent, LegalActionSet } from '../../src/core/legal-actions.js';
import { createSeededRandom } from '../../src/core/random.js';
import { parseCard } from '../../src/core/cards.js';

const OBSERVATIONS_PER_SCENARIO = 512;
const NEW_STYLE_SCENARIOS = Object.freeze({
  weak: 90,
  mediumValue: 150,
  strong: 270,
} as const);

const fixedProvider = (wins: number): EquityProvider => (_observation, samples) => ({
  equity: wins / samples,
  wins,
  ties: 0,
  losses: samples - wins,
  samples,
});

interface StyleMetrics {
  readonly aggressiveCount: number;
  readonly aggressiveRate: number;
  readonly passiveCount: number;
  readonly passiveRate: number;
  readonly averageAggressiveTarget: number;
  readonly potOrAllInRate: number;
}

function facingBetObservation(): PlayerObservationV1 {
  const legalActions: LegalActionSet = {
    fold: true,
    check: false,
    call: { pay: 4, to: 4, isAllIn: false },
    raiseTo: { min: 8, max: 100 },
    allIn: { to: 100, mode: 'fullRaise' },
  };
  const seats: PublicSeatState[] = Array.from({ length: 4 }, (_, seatIndex) => ({
    playerId: `player-${seatIndex}`,
    seatIndex,
    stack: 100,
    status: 'active',
    committedStreet: 0,
    committedHand: 0,
    revealedHoleCards: null,
  }));
  return {
    schemaVersion: 1,
    handId: 'new-style-benchmark',
    handNumber: 1,
    decisionIndex: 0,
    actorSeatIndex: 3,
    street: 'preflop',
    holeCards: [parseCard('Ah'), parseCard('Kd')],
    board: [],
    buttonPosition: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    smallBlind: 1,
    bigBlind: 2,
    potTotal: 12,
    sidePots: [],
    seats,
    actionHistory: [],
    legalActions,
  };
}

function assertLegal(action: ActionIntent, legal: LegalActionSet): void {
  if (action.type === 'fold') expect(legal.fold).toBe(true);
  if (action.type === 'check') expect(legal.check).toBe(true);
  if (action.type === 'call') expect(legal.call).not.toBeNull();
  if (action.type === 'allIn') expect(legal.allIn).not.toBeNull();
  if (action.type === 'raiseTo') {
    expect(legal.raiseTo).not.toBeNull();
    expect(action.amount).toBeGreaterThanOrEqual(legal.raiseTo!.min);
    expect(action.amount).toBeLessThanOrEqual(legal.raiseTo!.max);
  }
}

function aggressiveTarget(action: ActionIntent, legal: LegalActionSet): number | null {
  if (action.type === 'raiseTo') return action.amount;
  if (action.type === 'allIn' && legal.allIn !== null && legal.allIn.mode !== 'call') {
    return legal.allIn.to;
  }
  return null;
}

function isPassive(action: ActionIntent): boolean {
  return action.type === 'call' || action.type === 'check';
}

function runScenario(
  wins: number,
  scenario: string,
  characterOrder: readonly CharacterId[],
): Readonly<Record<CharacterId, StyleMetrics>> {
  const observation = facingBetObservation();
  const counts = Object.fromEntries(CHARACTER_IDS.map((id) => [id, {
    aggressive: 0,
    passive: 0,
    aggressiveTargetTotal: 0,
    potOrAllIn: 0,
  }])) as Record<CharacterId, {
    aggressive: number;
    passive: number;
    aggressiveTargetTotal: number;
    potOrAllIn: number;
  }>;
  const provider = fixedProvider(wins);

  for (const characterId of characterOrder) {
    for (let index = 0; index < OBSERVATIONS_PER_SCENARIO; index += 1) {
      const action = createCharacterAgent(characterId, { equityProvider: provider }).decide({
        observation,
        random: createSeededRandom('new-style-benchmark-v1', `${scenario}/${index}`),
      }).action;
      assertLegal(action, observation.legalActions);
      const target = aggressiveTarget(action, observation.legalActions);
      if (target !== null) {
        counts[characterId].aggressive += 1;
        counts[characterId].aggressiveTargetTotal += target;
        if (target >= 20) counts[characterId].potOrAllIn += 1;
      }
      if (isPassive(action)) counts[characterId].passive += 1;
    }
  }

  return Object.fromEntries(CHARACTER_IDS.map((id) => {
    const count = counts[id];
    return [id, {
      aggressiveCount: count.aggressive,
      aggressiveRate: count.aggressive / OBSERVATIONS_PER_SCENARIO,
      passiveCount: count.passive,
      passiveRate: count.passive / OBSERVATIONS_PER_SCENARIO,
      averageAggressiveTarget: count.aggressive === 0 ? 0 : count.aggressiveTargetTotal / count.aggressive,
      potOrAllInRate: count.aggressive === 0 ? 0 : count.potOrAllIn / count.aggressive,
    }];
  })) as unknown as Readonly<Record<CharacterId, StyleMetrics>>;
}

function assertNewCharacterGates(metrics: Readonly<Record<keyof typeof NEW_STYLE_SCENARIOS, Readonly<Record<CharacterId, StyleMetrics>>>>): void {
  const { weak, mediumValue, strong } = metrics;

  expect(weak['small-ball'].aggressiveRate - weak.rock.aggressiveRate)
    .toBeGreaterThanOrEqual(0.08);
  expect(weak.hunter.aggressiveRate - weak['value-bettor'].aggressiveRate)
    .toBeGreaterThanOrEqual(0.03);

  expect(mediumValue['small-ball'].aggressiveCount).toBeGreaterThanOrEqual(32);
  expect(mediumValue.maniac.aggressiveCount).toBeGreaterThanOrEqual(32);
  expect(mediumValue.maniac.averageAggressiveTarget
    - mediumValue['small-ball'].averageAggressiveTarget)
    .toBeGreaterThanOrEqual(15);
  expect(mediumValue.maniac.potOrAllInRate
    - mediumValue['small-ball'].potOrAllInRate)
    .toBeGreaterThanOrEqual(0.50);

  expect(strong.trapper.passiveCount).toBeGreaterThanOrEqual(32);
  expect(strong.trapper.passiveRate
    - Math.max(...CHARACTER_IDS.filter((id) => id !== 'trapper')
      .map((id) => strong[id].passiveRate)))
    .toBeGreaterThanOrEqual(0.07);

  expect(mediumValue['value-bettor'].aggressiveRate
    - mediumValue.rock.aggressiveRate)
    .toBeGreaterThanOrEqual(0.75);
  expect(mediumValue['value-bettor'].potOrAllInRate
    - mediumValue.hunter.potOrAllInRate)
    .toBeGreaterThanOrEqual(0.50);
}

describe('new parameter-driven character style benchmarks', () => {
  it('meets the fixed-matrix relative behavior gates independent of character order', () => {
    const normal = Object.fromEntries(Object.entries(NEW_STYLE_SCENARIOS).map(([scenario, wins]) => [
      scenario,
      runScenario(wins, scenario, CHARACTER_IDS),
    ])) as Readonly<Record<keyof typeof NEW_STYLE_SCENARIOS, Readonly<Record<CharacterId, StyleMetrics>>>>;
    const reversed = Object.fromEntries(Object.entries(NEW_STYLE_SCENARIOS).map(([scenario, wins]) => [
      scenario,
      runScenario(wins, scenario, [...CHARACTER_IDS].reverse()),
    ])) as Readonly<Record<keyof typeof NEW_STYLE_SCENARIOS, Readonly<Record<CharacterId, StyleMetrics>>>>;

    assertNewCharacterGates(normal);
    assertNewCharacterGates(reversed);
    expect(reversed).toEqual(normal);
  });
});
