import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { arenaAgent, type AgentFactory } from '../../src/arena/agents.js';
import { guardedDecision, runArena, type ArenaOptions, type DecisionHealth } from '../../src/arena/runner.js';
import { blockConfidence95 } from '../../src/arena/statistics.js';
import { renderArenaReport } from '../../src/arena/report.js';
import { projectObservation } from '../../src/agents/observation.js';
import type { DecisionContext, PokerAgent } from '../../src/agents/types.js';
import { createSeededRandom } from '../../src/core/random.js';
import { createTournament, startHand } from '../../src/core/state.js';

function options(overrides: Partial<ArenaOptions> = {}): ArenaOptions {
  return {
    mode: 'cash', seed: 'arena-test-v0', blocks: 3, stackBB: 20, handsPerLevel: 2,
    maxHands: 100, decisionBudgetMs: 5000,
    entrants: [arenaAgent('check-call'), arenaAgent('check-call')], ...overrides,
  };
}

function health(): DecisionHealth {
  return { decisions: 0, errors: 0, invalid: 0, timeouts: 0, fallbacks: 0, durationsMs: [] };
}

function context(): DecisionContext {
  const state = startHand(createTournament({ maxSeats: 2, startingStack: 40,
    initialButtonSeat: 0, handsPerLevel: 10, blindLevels: [{ smallBlind: 1, bigBlind: 2 }] },
  [{ seatIndex: 0, playerId: 'a' }, { seatIndex: 1, playerId: 'b' }], 'guard-test').state).state;
  return { observation: projectObservation(state, state.activeHand!.currentActorSeat!), random: createSeededRandom('policy') };
}

describe('local competitive arena', () => {
  it('rotates duplicate deals, conserves chips, and cancels identical passive policies heads-up', async () => {
    const report = await runArena(options());
    expect(report.games).toBe(6);
    expect(report.hands).toBe(6);
    expect(report.hero.bbPer100).toBe(0);
    expect(report.hero.winRate).toBeNull();
    expect(report.hero.confidence95).toBeNull();
    for (const m of report.matches) expect(m.netChipsByEntrant.reduce((a, b) => a + b, 0)).toBe(0);
    expect(report.matches[0]!.dealSeed).toBe(report.matches[1]!.dealSeed);
    expect(report.matches[0]!.netChipsByEntrant[0]).toBe(-report.matches[1]!.netChipsByEntrant[0]!);
    expect(report.health.every(h => h.fallbacks === 0)).toBe(true);
  });

  it('reproduces actions and scores, excluding wall-clock latency', async () => {
    const settings = options({ entrants: [arenaAgent('random'), arenaAgent('random')] });
    const a = await runArena(settings);
    const b = await runArena(settings);
    expect(a.matches).toEqual(b.matches);
    expect(a.resultDigest).toBe(b.resultDigest);
    expect(a.hero).toEqual(b.hero);
    expect(a.health).toEqual(b.health);
    const c = await runArena({ ...settings, seed: 'another-deal' });
    expect(c.resultDigest).not.toBe(a.resultDigest);
  });

  it('covers every physical seat in six-max, including heterogeneous fields', async () => {
    const report = await runArena(options({ entrants: ['random', 'check-call', 'all-in', 'check-fold', 'random', 'check-call'].map(id => arenaAgent(id)), blocks: 2 }));
    expect(report.games).toBe(12);
    expect(report.matches.slice(0, 6).map(m => m.rotation)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(report.matches.every(m => m.stacksByEntrant.reduce((a, b) => a + b, 0) === 240)).toBe(true);
    expect(report.health.every(h => h.fallbacks === 0)).toBe(true);
  });

  it('runs elimination games to an actual sole survivor', async () => {
    const report = await runArena(options({ mode: 'tournament', entrants: [arenaAgent('all-in'), arenaAgent('all-in')] }));
    expect(report.censoredGames).toBe(0);
    expect(report.hero.bbPer100).toBeNull();
    expect(report.hero.winRate).not.toBeNull();
    for (const m of report.matches) {
      expect(m.winner).not.toBeNull();
      expect(m.stacksByEntrant[m.winner!]).toBe(80);
      expect(m.stacksByEntrant.filter(s => s > 0)).toHaveLength(1);
    }
  });

  it('does not declare a chip leader the winner when the hand cap is hit', async () => {
    const report = await runArena(options({ mode: 'tournament', maxHands: 1,
      entrants: [arenaAgent('check-fold'), arenaAgent('check-fold')] }));
    expect(report.censoredGames).toBe(report.games);
    expect(report.hero.winRate).toBeNull();
    expect(report.hero.confidence95).toBeNull();
    expect(report.hero.winRateBounds).toEqual([0, 1]);
    expect(report.matches.every(m => m.winner === null && m.status === 'hand-cap')).toBe(true);
  });

  it('provides only frozen player observations, with no seed in hand IDs or opponent holes', async () => {
    const observations: string[] = [];
    const spy: AgentFactory = { id: 'spy', description: 'privacy test', equitySamples: null,
      create: () => ({ agentId: 'spy', decide: ({ observation }) => {
        observations.push(JSON.stringify(observation));
        expect(Object.isFrozen(observation)).toBe(true);
        expect(Object.isFrozen(observation.seats)).toBe(true);
        expect(observation.seats.every(s => s.revealedHoleCards === null)).toBe(true);
        return { action: observation.legalActions.check ? { type: 'check' } : { type: 'call' } };
      } }) };
    const report = await runArena(options({ seed: 'private-dealer-seed', entrants: [spy, arenaAgent('check-call')] }));
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every(o => !o.includes('private-dealer-seed') && !o.includes('"deck"') && !o.includes('"runSeed"'))).toBe(true);
    expect(report.health[0]!.errors).toBe(0);
  });

  it('records fallback-contaminated results and withholds strength CI', async () => {
    const broken: AgentFactory = { id: 'broken', description: '', equitySamples: null,
      create: () => ({ agentId: 'broken', decide: () => ({ action: { type: 'raiseTo', amount: -1 } }) }) };
    const report = await runArena(options({ blocks: 30, entrants: [broken, arenaAgent('check-fold')] }));
    expect(report.health[0]!.invalid).toBeGreaterThan(0);
    expect(report.failures.length).toBe(report.health[0]!.fallbacks);
    expect(report.failures[0]).toMatchObject({ block: 0, rotation: 0, hand: 1, kind: 'invalid' });
    expect(report.hero.confidence95).toBeNull();
    expect(renderArenaReport(report)).toContain('not a clean strength comparison');
  });

  it('labels native sampling budgets, preserves the old policy, and rejects unknown agents', () => {
    expect(arenaAgent('hunter-challenge').equitySamples).toBe(600);
    expect(arenaAgent('hunter-standard').equitySamples).toBe(300);
    expect(arenaAgent('hunter-challenge', 24).equitySamples).toBe(24);
    expect(arenaAgent('hunter-challenge').create()).not.toBe(arenaAgent('hunter-challenge').create());
    expect(() => arenaAgent('unknown')).toThrow();
    expect(() => arenaAgent('random', 0)).toThrow();
  });

  it('validates run limits before executing an agent', async () => {
    await expect(runArena(options({ blocks: 0 }))).rejects.toThrow();
    await expect(runArena(options({ blocks: .5 }))).rejects.toThrow();
    await expect(runArena(options({ seed: '' }))).rejects.toThrow();
    await expect(runArena(options({ entrants: [arenaAgent('random')] }))).rejects.toThrow();
  });
});

describe('decision health and uncertainty', () => {
  it('falls back safely on illegal decisions and exceptions', async () => {
    const invalid = health();
    expect(await guardedDecision({ agentId: 'invalid', decide: () => ({ action: { type: 'raiseTo', amount: NaN } }) }, context(), 5000, invalid)).toEqual({ type: 'fold' });
    expect(invalid.invalid).toBe(1);
    const errors = health();
    await guardedDecision({ agentId: 'throws', decide: () => { throw new Error('no'); } }, context(), 5000, errors);
    expect(errors.errors).toBe(1);
    expect(errors.fallbacks).toBe(1);
  });

  it('times out asynchronous nonresponses without fabricating a successful decision', async () => {
    const h = health();
    const hanging: PokerAgent = { agentId: 'hang', decide: () => new Promise(() => {}) };
    expect(await guardedDecision(hanging, context(), 5, h)).toEqual({ type: 'fold' });
    expect(h.timeouts).toBe(1);
    expect(h.errors).toBe(0);
    expect(h.fallbacks).toBe(1);
  });

  it('rejects synchronous answers that return after the soft deadline', async () => {
    const h = health();
    const late: PokerAgent = { agentId: 'late', decide: () => {
      const finish = performance.now() + 8;
      while (performance.now() < finish) { /* exercise synchronous post-return check */ }
      return { action: { type: 'call' } };
    } };
    expect(await guardedDecision(late, context(), 1, h)).toEqual({ type: 'fold' });
    expect(h.timeouts).toBe(1);
    expect(h.fallbacks).toBe(1);
  });

  it('keeps a short all-in call distinct from an illegal raise', async () => {
    const base = context();
    const short: DecisionContext = { ...base, observation: { ...base.observation,
      legalActions: { fold: true, check: false, call: { pay: 3, to: 5, isAllIn: true },
        raiseTo: null, allIn: { to: 5, mode: 'call' } } } };
    const h = health();
    expect(await guardedDecision({ agentId: 'call', decide: () => ({ action: { type: 'call' } }) }, short, 5000, h)).toEqual({ type: 'call' });
    expect(h.fallbacks).toBe(0);
    expect(await guardedDecision({ agentId: 'raise', decide: () => ({ action: { type: 'raiseTo', amount: 5 } }) }, short, 5000, h)).toEqual({ type: 'fold' });
    expect(h.invalid).toBe(1);
  });

  it('bootstraps whole blocks reproducibly and withholds tiny-sample intervals', () => {
    expect(blockConfidence95([1, -1], 'x')).toBeNull();
    const blocks = Array.from({ length: 60 }, (_, i) => i % 2 ? 5 : -5);
    const ci = blockConfidence95(blocks, 'x')!;
    expect(ci[0]).toBeLessThan(0);
    expect(ci[1]).toBeGreaterThan(0);
    expect(blockConfidence95(blocks, 'x')).toEqual(ci);
    expect(blockConfidence95(Array(30).fill(7), 'x')).toEqual([7, 7]);
  });
});
