import { describe, expect, it } from 'vitest';
import { createStandardDeck } from '../../src/core/cards.js';
import { createTournament, startHand, reduceDomainEvent, type TournamentState } from '../../src/core/state.js';
import { replaceHoleCard } from '../../src/core/hole-card-replacement.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { projectEventsForViewer } from '../../src/core/public-events.js';
import { projectObservation } from '../../src/agents/observation.js';
import { applyIntent } from '../../src/core/reducer.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import { getLegalActions } from '../../src/core/legal-actions.js';
import { evaluateBest } from '../../src/core/hand-evaluator.js';
import { replayTournament } from '../../src/core/replay.js';

function start(): TournamentState {
  return startHand(createTournament({
    maxSeats: 2, startingStack: 100, handsPerLevel: 8,
    blindLevels: [{ smallBlind: 1, bigBlind: 2 }], initialButtonSeat: 0,
  }, [{ playerId: 'hero', seatIndex: 0 }, { playerId: 'npc', seatIndex: 1 }], 'swap-core').state,
  { fixedDeck: createStandardDeck() }).state;
}
function passive(state: TournamentState): TournamentState {
  const actor = state.activeHand!.currentActorSeat!;
  const action = applyIntent(state, actor, { type: getLegalActions(state, actor).check ? 'check' : 'call' });
  if (!action.accepted) throw new Error('Expected legal action');
  return advanceAutomaticPhases(action.state).state;
}
function provePrefixes(state: TournamentState) {
  let replay: TournamentState | null = null;
  for (const event of state.eventLog) {
    replay = reduceDomainEvent(replay, event);
    assertTournamentInvariants(replay);
  }
  expect(replay).toEqual(state);
}

describe('authoritative hole-card replacement', () => {
  it.each(['preflop', 'flop', 'turn', 'river'] as const)('replaces one card on %s, then settles with the real new pair', (street) => {
    let state = start();
    for (let guard = 0; state.activeHand!.street !== street && guard < 20; guard++) state = passive(state);
    const before = structuredClone(state);
    const hand = state.activeHand!;
    const actor = hand.currentActorSeat!;
    const old = state.seats[actor]!.holeCards![1];
    const { state: replaced, events } = replaceHoleCard(state, actor, 1);
    expect(state).toEqual(before);
    expect(replaced.seats[actor]!.holeCards).toEqual([state.seats[actor]!.holeCards![0], hand.deck[hand.dealCursor]]);
    expect(replaced.activeHand).toEqual({ ...hand, dealCursor: hand.dealCursor + 1, abilityDiscardedCards: [old] });
    expect(replaced.seats.map(({ holeCards: _, ...seat }) => seat)).toEqual(state.seats.map(({ holeCards: _, ...seat }) => seat));
    for (const viewer of [null, 0, 1]) expect(projectEventsForViewer(events, viewer)).toEqual([]);
    expect(projectObservation(replaced, actor).decisionIndex).toBe(projectObservation(state, actor).decisionIndex);
    state = replaced;
    for (let guard = 0; state.activeHand!.phase !== 'hand-complete' && guard < 20; guard++) state = passive(state);
    expect(state.activeHand!.phase).toBe('hand-complete');
    const evaluated = state.eventLog.find((event) => event.type === 'HandEvaluated' && event.seat === actor);
    expect(evaluated).toMatchObject({ rank: evaluateBest([...state.activeHand!.board, ...state.seats[actor]!.holeCards!]) });
    const cards = [...state.seats.flatMap((seat) => seat.holeCards ?? []), ...state.activeHand!.board,
      ...state.activeHand!.burnedCards, ...state.activeHand!.abilityDiscardedCards!];
    expect(new Set(cards.map((card) => card.code)).size).toBe(cards.length);
    expect(state.seats.reduce((sum, seat) => sum + seat.stack, 0)).toBe(200);
    provePrefixes(state);
  });

  it('shifts future burns and board by one and keeps NPC observation ignorant of the swap', () => {
    const original = start();
    const next = replaceHoleCard(original, 0, 0).state;
    const acted = applyIntent(next, 0, { type: 'call' });
    if (!acted.accepted) throw new Error('Expected call');
    const control = applyIntent(original, 0, { type: 'call' });
    if (!control.accepted) throw new Error('Expected control call');
    expect(projectObservation(acted.state, 1)).toEqual(projectObservation(control.state, 1));
    const flop = passive(acted.state);
    expect(flop.activeHand!.burnedCards).toEqual([original.activeHand!.deck[5]]);
    expect(flop.activeHand!.board).toEqual(original.activeHand!.deck.slice(6, 9));
  });

  it('rejects forged cards, targets, indices and damaged card ledgers', () => {
    const state = start();
    const result = replaceHoleCard(state, 0, 0);
    const event = result.events[0]!;
    for (const change of [
      { seat: 1 }, { holeCardIndex: 2 }, { handId: 'wrong' },
      { discardedCard: state.activeHand!.deck[0] }, { replacementCard: state.activeHand!.deck[5] },
    ]) expect(() => reduceDomainEvent(state, { ...event, ...change } as typeof event)).toThrow();
    for (const change of [
      { abilityDiscardedCards: [] }, { dealCursor: 4 },
      { abilityDiscardedCards: [state.activeHand!.deck[0]!] },
    ]) expect(() => assertTournamentInvariants({ ...result.state, activeHand: { ...result.state.activeHand!, ...change } })).toThrow();
    expect(() => assertTournamentInvariants({ ...state, activeHand: { ...state.activeHand!, abilityDiscardedCards: [] } })).toThrow();
    expect(() => replaceHoleCard({ ...state, activeHand: { ...state.activeHand!, dealCursor: 52 } }, 0, 0)).toThrow(/exhausted/);
    const guarded = new Proxy(event, { get: (target, key, receiver) => {
      if (key === 'discardedCard' || key === 'replacementCard') throw new Error('private card accessed');
      return Reflect.get(target, key, receiver);
    } });
    expect(projectEventsForViewer([guarded], null)).toEqual([]);
    expect(() => replayTournament({ containsPrivateData: true, schemaVersion: 1,
      rulesVersion: state.rulesVersion, rngVersion: state.rngVersion, shuffleVersion: state.shuffleVersion,
      strategyVersion: state.strategyVersion, initialConfig: state.config,
      seats: state.seats.map(({ seatIndex, playerId }) => ({ seatIndex, playerId })),
      runSeed: state.runSeed, events: result.state.eventLog,
    })).toThrow(/classic replay/);
  });
});
