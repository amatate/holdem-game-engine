import { describe, expect, it } from 'vitest';

import type { PokerAgent } from '../../src/agents/types.js';
import { projectObservation } from '../../src/agents/observation.js';
import { createStandardDeck, parseCard } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import { projectEventsForViewer } from '../../src/core/public-events.js';
import { createSeededRandom } from '../../src/core/random.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  createTournament,
  startHand,
  type TournamentState,
} from '../../src/core/state.js';
import type { CardCode } from '../../src/core/types.js';

const MASTER_SEED_SENTINEL = 'MASTER-SEED-SENTINEL';

function config(maxSeats = 2, startingStack = 100): TournamentConfig {
  return {
    maxSeats,
    startingStack,
    handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
    initialButtonSeat: 0,
  };
}

function deckWithPrefix(codes: readonly CardCode[]) {
  const standard = createStandardDeck();
  const byCode = new Map(standard.map((card) => [card.code, card] as const));
  return [
    ...codes.map((code) => byCode.get(code)!),
    ...standard.filter((card) => !codes.includes(card.code)),
  ];
}

function startedPrivateWorld(opponentCards: readonly [CardCode, CardCode], burn: CardCode): TournamentState {
  const tableConfig = config();
  const created = createTournament(
    tableConfig,
    [{ playerId: 'opponent', seatIndex: 0 }, { playerId: 'hero', seatIndex: 1 }],
    MASTER_SEED_SENTINEL,
  ).state;
  return startHand(created, {
    fixedDeck: deckWithPrefix([
      'Ah', opponentCards[0], 'Ad', opponentCards[1], burn,
      '3d', '4h', '5s', '6c', '7c', '8d', '9h',
    ]),
  }).state;
}

function accepted(
  state: TournamentState,
  seatIndex: number,
  intent: Parameters<typeof applyIntent>[2],
): TournamentState {
  const result = applyIntent(state, seatIndex, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

function flopWorld(opponentCards: readonly [CardCode, CardCode], burn: CardCode): TournamentState {
  let state = startedPrivateWorld(opponentCards, burn);
  state = accepted(state, 0, { type: 'call' });
  state = accepted(state, 1, { type: 'check' });
  state = advanceAutomaticPhases(state).state;
  expect(state.activeHand?.street).toBe('flop');
  expect(state.activeHand?.currentActorSeat).toBe(1);
  return state;
}

function authorityGraphForFreezeProof(): TournamentState {
  const tableConfig = config(4);
  const created = createTournament(
    tableConfig,
    Array.from({ length: 4 }, (_, seatIndex) => ({ playerId: `player-${seatIndex}`, seatIndex })),
    MASTER_SEED_SENTINEL,
  ).state;
  const started = startHand(created, { fixedDeck: createStandardDeck() }).state;
  const revealedSeat = started.seats[1]!;
  if (revealedSeat.holeCards === null) throw new Error('test fixture lacks cards');
  const reveal = {
    type: 'HoleCardsRevealed' as const,
    schemaVersion: 1 as const,
    eventIndex: started.version,
    handId: started.activeHand!.handId,
    seat: 1,
    cards: [revealedSeat.holeCards[0], revealedSeat.holeCards[1]] as const,
    reason: 'showdown' as const,
  };

  return {
    ...started,
    version: started.version + 1,
    eventLog: [...started.eventLog, reveal],
    seats: started.seats.map((seat) => {
      if (seat.seatIndex === 0) {
        return { ...seat, stack: 50, status: 'active' as const, committedStreet: 50, committedHand: 50 };
      }
      if (seat.seatIndex === 1) {
        return { ...seat, stack: 0, status: 'all-in' as const, committedStreet: 40, committedHand: 40 };
      }
      if (seat.seatIndex === 2) {
        return { ...seat, stack: 0, status: 'folded' as const, committedStreet: 40, committedHand: 40 };
      }
      return { ...seat, stack: 100, status: 'active' as const, committedStreet: 30, committedHand: 30 };
    }),
    activeHand: {
      ...started.activeHand!,
      phase: 'flop',
      street: 'flop',
      board: [parseCard('As')],
      revealedHoleCardSeats: [1],
      currentActorSeat: 3,
      currentBetTo: 50,
      lastFullRaiseSize: 2,
      pendingActors: [3],
    },
  };
}

describe('hidden-information isolation', () => {
  it('makes two private worlds indistinguishable to observation, public events, and a same-seed probe agent', async () => {
    const worldA = flopWorld(['Kc', 'Qc'], '2c');
    const worldB = flopWorld(['9c', '8c'], '2d');

    expect(worldA.seats[0]?.holeCards).not.toEqual(worldB.seats[0]?.holeCards);
    expect(worldA.activeHand?.burnedCards).not.toEqual(worldB.activeHand?.burnedCards);
    expect(worldA.activeHand?.deck.slice(worldA.activeHand.dealCursor)).not.toEqual(
      worldB.activeHand?.deck.slice(worldB.activeHand.dealCursor),
    );

    const observationA = projectObservation(worldA, 1);
    const observationB = projectObservation(worldB, 1);
    const publicA = projectEventsForViewer(worldA.eventLog, 1);
    const publicB = projectEventsForViewer(worldB.eventLog, 1);

    expect(observationA).toEqual(observationB);
    expect(publicA).toEqual(publicB);

    const probe: PokerAgent = {
      agentId: 'deterministic-probe',
      decide: ({ observation, random }) => {
        const raise = observation.legalActions.raiseTo;
        return {
          action: random.nextFloat() < 0.5 || raise === null
            ? { type: 'check' }
            : { type: 'raiseTo', amount: raise.min },
          privateTrace: {
            intent: 'potControl',
            equityBand: 'medium',
            potOddsBand: 'low',
            positionAdjustment: 0,
            sizingReason: raise === null ? 'none' : 'minimum',
          },
        };
      },
    };

    const decisionA = await probe.decide({
      observation: observationA,
      random: createSeededRandom('same-private-probe'),
    });
    const decisionB = await probe.decide({
      observation: observationB,
      random: createSeededRandom('same-private-probe'),
    });
    expect(decisionA).toEqual(decisionB);
  });

  it('shows private deals only to their owner, keeps mucked cards hidden, and publishes legal reveals afterward', () => {
    const started = startedPrivateWorld(['Kc', 'Qc'], '2c');
    const heroEvents = projectEventsForViewer(started.eventLog, 1);
    const opponentEvents = projectEventsForViewer(started.eventLog, 0);
    const spectatorEvents = projectEventsForViewer(started.eventLog, null);

    expect(heroEvents.filter((event) => event.type === 'ownHoleCardsDealt')).toEqual([
      { type: 'ownHoleCardsDealt', cards: [parseCard('Ah'), parseCard('Ad')] },
    ]);
    expect(opponentEvents.filter((event) => event.type === 'ownHoleCardsDealt')).toEqual([
      { type: 'ownHoleCardsDealt', cards: [parseCard('Kc'), parseCard('Qc')] },
    ]);
    expect(spectatorEvents.some((event) => event.type === 'ownHoleCardsDealt')).toBe(false);
    expect(JSON.stringify(heroEvents)).not.toMatch(/Kc|Qc/);
    expect(JSON.stringify(spectatorEvents)).not.toMatch(/Ah|Ad|Kc|Qc/);

    let mucked = accepted(started, 0, { type: 'fold' });
    mucked = advanceAutomaticPhases(mucked).state;
    const muckedPublic = projectEventsForViewer(mucked.eventLog, 1);
    expect(muckedPublic.some((event) => event.type === 'holeCardsRevealed')).toBe(false);
    expect(JSON.stringify(muckedPublic)).not.toMatch(/Kc|Qc/);

    let revealed = startedPrivateWorld(['Kc', 'Qc'], '2c');
    revealed = accepted(revealed, 0, { type: 'allIn' });
    revealed = accepted(revealed, 1, { type: 'call' });
    const beforeReveal = projectEventsForViewer(revealed.eventLog, 1);
    expect(JSON.stringify(beforeReveal)).not.toMatch(/Kc|Qc/);
    revealed = advanceAutomaticPhases(revealed).state;
    const afterReveal = projectEventsForViewer(revealed.eventLog, 1);
    expect(afterReveal).toContainEqual({
      type: 'holeCardsRevealed',
      seatIndex: 0,
      cards: [parseCard('Kc'), parseCard('Qc')],
      reason: 'all-in',
    });
  });

  it('never serializes the master seed or authority hand ID', () => {
    const world = flopWorld(['Kc', 'Qc'], '2c');
    const observation = projectObservation(world, 1);
    const publicEvents = projectEventsForViewer(world.eventLog, 1);

    expect(observation.handId).toBe('hand/1');
    expect(JSON.stringify(observation)).not.toContain(MASTER_SEED_SENTINEL);
    expect(JSON.stringify(publicEvents)).not.toContain(MASTER_SEED_SENTINEL);
    expect(JSON.stringify(publicEvents)).not.toContain(world.activeHand!.handId);
  });

  it('deep-freezes every projected branch while preserving an unfrozen, unchanged authority graph', () => {
    const authority = authorityGraphForFreezeProof();
    const before = structuredClone(authority);
    const authorityBoardCard = authority.activeHand!.board[0]!;
    const authorityHoleCard = authority.seats[3]!.holeCards![0];
    const authorityRevealEvent = authority.eventLog.at(-1)!;

    expect(Object.isFrozen(authority)).toBe(false);
    expect(Object.isFrozen(authority.activeHand)).toBe(false);
    expect(Object.isFrozen(authorityBoardCard)).toBe(false);
    expect(Object.isFrozen(authorityHoleCard)).toBe(false);
    expect(Object.isFrozen(authorityRevealEvent)).toBe(false);

    const observation = projectObservation(authority, 3);
    const revealed = observation.seats[1]!.revealedHoleCards;
    const sidePot = observation.sidePots[0];
    const action = observation.actionHistory[0];
    const call = observation.legalActions.call;
    const raise = observation.legalActions.raiseTo;
    const allIn = observation.legalActions.allIn;
    if (revealed === null || sidePot === undefined || action === undefined
      || call === null || raise === null || allIn === null) {
      throw new Error('freeze fixture is missing a required nested branch');
    }

    const mutations: readonly [string, () => void][] = [
      ['root', () => { (observation as unknown as { schemaVersion: number }).schemaVersion = 2; }],
      ['board array', () => { (observation.board as unknown as unknown[]).push(parseCard('2s')); }],
      ['board card', () => { (observation.board[0] as unknown as { rank: number }).rank = 2; }],
      ['hole tuple', () => { (observation.holeCards as unknown as unknown[])[0] = parseCard('2s'); }],
      ['hole card', () => { (observation.holeCards[0] as unknown as { rank: number }).rank = 2; }],
      ['seats array', () => { (observation.seats as unknown as unknown[]).push({}); }],
      ['seat', () => { (observation.seats[0] as unknown as { stack: number }).stack = 1; }],
      ['revealed tuple', () => { (revealed as unknown as unknown[])[0] = parseCard('2s'); }],
      ['revealed card', () => { (revealed[0] as unknown as { rank: number }).rank = 2; }],
      ['side pots array', () => { (observation.sidePots as unknown as unknown[]).push({}); }],
      ['side pot', () => { (sidePot as unknown as { amount: number }).amount = 1; }],
      ['eligibility', () => { (sidePot.eligibleSeatIndexes as unknown as number[]).push(3); }],
      ['history array', () => { (observation.actionHistory as unknown as unknown[]).push({}); }],
      ['history action', () => { (action as unknown as { amount: number }).amount = 99; }],
      ['legal root', () => { (observation.legalActions as unknown as { fold: boolean }).fold = false; }],
      ['legal call', () => { (call as unknown as { pay: number }).pay = 0; }],
      ['legal raise', () => { (raise as unknown as { min: number }).min = 0; }],
      ['legal all-in', () => { (allIn as unknown as { mode: string }).mode = 'call'; }],
    ];
    for (const [name, mutation] of mutations) {
      expect(mutation, name).toThrow(TypeError);
    }

    expect(authority).toEqual(before);
    expect(Object.isFrozen(authority)).toBe(false);
    expect(Object.isFrozen(authority.activeHand)).toBe(false);
    expect(Object.isFrozen(authorityBoardCard)).toBe(false);
    expect(Object.isFrozen(authorityHoleCard)).toBe(false);
    expect(Object.isFrozen(authorityRevealEvent)).toBe(false);
  });

  it('allocates equal but non-aliased nested projections across calls and authority', () => {
    const authority = authorityGraphForFreezeProof();
    const first = projectObservation(authority, 3);
    const second = projectObservation(authority, 3);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.board).not.toBe(second.board);
    expect(first.board[0]).not.toBe(second.board[0]);
    expect(first.board).not.toBe(authority.activeHand!.board);
    expect(first.board[0]).not.toBe(authority.activeHand!.board[0]);
    expect(first.holeCards).not.toBe(second.holeCards);
    expect(first.holeCards[0]).not.toBe(second.holeCards[0]);
    expect(first.holeCards).not.toBe(authority.seats[3]!.holeCards);
    expect(first.holeCards[0]).not.toBe(authority.seats[3]!.holeCards![0]);
    expect(first.seats).not.toBe(second.seats);
    expect(first.seats[0]).not.toBe(second.seats[0]);
    expect(first.seats).not.toBe(authority.seats);
    expect(first.seats[0]).not.toBe(authority.seats[0]);
    expect(first.seats[1]!.revealedHoleCards).not.toBe(second.seats[1]!.revealedHoleCards);
    expect(first.seats[1]!.revealedHoleCards).not.toBe(authority.seats[1]!.holeCards);
    expect(first.sidePots).not.toBe(second.sidePots);
    expect(first.sidePots[0]).not.toBe(second.sidePots[0]);
    expect(first.sidePots[0]!.eligibleSeatIndexes).not.toBe(second.sidePots[0]!.eligibleSeatIndexes);
    expect(first.actionHistory).not.toBe(second.actionHistory);
    expect(first.actionHistory[0]).not.toBe(second.actionHistory[0]);
    expect(first.legalActions).not.toBe(second.legalActions);
    expect(first.legalActions.call).not.toBe(second.legalActions.call);
    expect(first.legalActions.raiseTo).not.toBe(second.legalActions.raiseTo);
    expect(first.legalActions.allIn).not.toBe(second.legalActions.allIn);
  });
});
