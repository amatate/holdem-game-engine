import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Participant } from '../../src/game/participant.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { createSeededRandom } from '../../src/core/random.js';
import { runTournament } from '../../src/game/tournament-controller.js';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isRecursivelyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((child) => isRecursivelyFrozen(child, seen));
}

const config: TournamentConfig = {
  maxSeats: 2,
  startingStack: 2,
  handsPerLevel: 100,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};

describe('classic controller golden contract', () => {
  it('preserves the deterministic one-hand state, events, callbacks, and decision RNG', async () => {
    const authorityBatches: string[][] = [];
    const publicBatches: string[][] = [];
    const callbackOrder: string[] = [];
    const decisions: Array<{ seatIndex: number; decisionIndex: number; seedHash: number }> = [];
    let authorityIndex = 0;
    let publicIndex = 0;
    const callbackFreezeChecks: boolean[] = [];

    const participants: Participant[] = [0, 1].map((seatIndex) => ({
      playerId: `p${seatIndex}`,
      decide: async ({ observation, random }) => {
        decisions.push({
          seatIndex: observation.actorSeatIndex,
          decisionIndex: observation.decisionIndex,
          seedHash: random.seedHash,
        });
        const legal = observation.legalActions;
        if (legal.call !== null) return { action: { type: 'call' } };
        if (legal.check) return { action: { type: 'check' } };
        return { action: { type: 'fold' } };
      },
    }));

    const state = await runTournament({
      config,
      participants,
      runSeed: 'classic-driver-golden-v1',
      publicViewerSeatIndex: 0,
      onAuthorityEvents: async (events) => {
        const index = authorityIndex++;
        callbackOrder.push(`authority:start:${index}`);
        authorityBatches.push(events.map((event) => event.type));
        callbackFreezeChecks.push(Object.isFrozen(events));
        callbackFreezeChecks.push(events.every((event) => isRecursivelyFrozen(event)));
        await Promise.resolve();
        callbackOrder.push(`authority:end:${index}`);
      },
      onPublicEvents: async (events) => {
        const index = publicIndex++;
        callbackOrder.push(`public:start:${index}`);
        publicBatches.push(events.map((event) => event.type));
        callbackFreezeChecks.push(Object.isFrozen(events));
        callbackFreezeChecks.push(events.every((event) => isRecursivelyFrozen(event)));
        await Promise.resolve();
        callbackOrder.push(`public:end:${index}`);
      },
    });

    expect(sha256(state)).toBe(
      'd27136aa7fcfa842740d6237a7b46aa15b21e7611861ca4596c0a272ab459631',
    );
    expect(sha256(state.eventLog)).toBe(
      'd3ea69c1f12366020c60077f741faa0009a068237d7ea67d5bb351bcc17ca341',
    );
    expect(state.version).toBe(32);
    expect(state.seats.map((seat) => seat.stack)).toEqual([4, 0]);
    expect(Object.isFrozen(state)).toBe(false);
    expect(Object.isFrozen(state.seats)).toBe(false);
    expect(Object.isFrozen(state.eventLog)).toBe(false);
    expect(state.eventLog.map((event) => event.type)).toEqual([
      'GameStarted', 'HandStarted', 'PositionsAssigned', 'BlindPosted', 'BlindPosted',
      'DeckPrepared', 'HoleCardsDealt', 'BettingRoundStarted', 'PlayerActed',
      'HoleCardsRevealed', 'HoleCardsRevealed', 'BettingRoundClosed', 'CardBurned',
      'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
      'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
      'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed',
      'ShowdownStarted', 'PotConstructed', 'HandEvaluated', 'HandEvaluated',
      'PotAwarded', 'PlayerEliminated', 'HandCompleted', 'GameCompleted',
    ]);
    expect(authorityBatches).toEqual([
      ['GameStarted'],
      ['HandStarted', 'PositionsAssigned', 'BlindPosted', 'BlindPosted', 'DeckPrepared', 'HoleCardsDealt', 'BettingRoundStarted'],
      ['PlayerActed'],
      ['HoleCardsRevealed', 'HoleCardsRevealed', 'BettingRoundClosed', 'CardBurned',
        'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
        'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed', 'CardBurned',
        'CommunityCardsDealt', 'BettingRoundStarted', 'BettingRoundClosed',
        'ShowdownStarted', 'PotConstructed', 'HandEvaluated', 'HandEvaluated',
        'PotAwarded', 'PlayerEliminated', 'HandCompleted'],
      ['GameCompleted'],
    ]);
    expect(publicBatches).toEqual([
      ['gameStarted'],
      ['handStarted', 'positionsAssigned', 'blindPosted', 'blindPosted', 'ownHoleCardsDealt', 'bettingRoundStarted'],
      ['playerActed'],
      ['holeCardsRevealed', 'holeCardsRevealed', 'bettingRoundClosed', 'communityCardsDealt',
        'bettingRoundStarted', 'bettingRoundClosed', 'communityCardsDealt', 'bettingRoundStarted',
        'bettingRoundClosed', 'communityCardsDealt', 'bettingRoundStarted', 'bettingRoundClosed',
        'showdownStarted', 'potConstructed', 'handEvaluated', 'handEvaluated', 'potAwarded',
        'playerEliminated', 'handCompleted'],
      ['gameCompleted'],
    ]);
    expect(callbackOrder).toEqual([
      'authority:start:0', 'authority:end:0', 'public:start:0', 'public:end:0',
      'authority:start:1', 'authority:end:1', 'public:start:1', 'public:end:1',
      'authority:start:2', 'authority:end:2', 'public:start:2', 'public:end:2',
      'authority:start:3', 'authority:end:3', 'public:start:3', 'public:end:3',
      'authority:start:4', 'authority:end:4', 'public:start:4', 'public:end:4',
    ]);
    expect(callbackFreezeChecks.every(Boolean)).toBe(true);
    expect(decisions[0]).toEqual({
      seatIndex: 0,
      decisionIndex: 0,
      seedHash: createSeededRandom('classic-driver-golden-v1', 'agent/1/0/0').seedHash,
    });
  });
});
