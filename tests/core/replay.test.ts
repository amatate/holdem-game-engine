import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStandardDeck } from '../../src/core/cards.js';
import type { TournamentConfig } from '../../src/core/config.js';
import { advanceAutomaticPhases } from '../../src/core/dealing.js';
import { TournamentInvariantError } from '../../src/core/invariants.js';
import { applyIntent } from '../../src/core/reducer.js';
import {
  ReplayHeaderError,
  ReplayVersionError,
  replayTournament,
  type ReplayEnvelopeV1,
} from '../../src/core/replay.js';
import {
  createTournament,
  reduceDomainEvent,
  startHand,
  startNextHand,
  type TournamentSeatInput,
  type TournamentState,
} from '../../src/core/state.js';

const CONFIG: TournamentConfig = {
  maxSeats: 2,
  startingStack: 4,
  handsPerLevel: 8,
  blindLevels: [{ smallBlind: 1, bigBlind: 2 }],
  initialButtonSeat: 0,
};
const SEATS: readonly TournamentSeatInput[] = [
  { playerId: 'button', seatIndex: 0 },
  { playerId: 'big-blind', seatIndex: 1 },
];

function fixedWinningDeck() {
  const prefix = ['2c', 'Ah', '3d', 'Ad', '4s', '4c', '5d', '7h', '8s', '9s', 'Ts', 'Jc'];
  const byCode = new Map(createStandardDeck().map((card) => [card.code, card] as const));
  return [
    ...prefix.map((code) => byCode.get(code as never)!),
    ...createStandardDeck().filter((card) => !prefix.includes(card.code)),
  ];
}

function accepted(
  state: TournamentState,
  seat: number,
  intent: Parameters<typeof applyIntent>[2],
): TournamentState {
  const result = applyIntent(state, seat, intent);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.rejection.message);
  return result.state;
}

function completedEnvelope(): {
  readonly state: TournamentState;
  readonly envelope: ReplayEnvelopeV1;
  readonly liveSnapshots: ReadonlyMap<number, TournamentState>;
} {
  const snapshots = new Map<number, TournamentState>();
  const created = createTournament(CONFIG, SEATS, 'replay-fixed');
  let state = created.state;
  snapshots.set(state.version - 1, structuredClone(state));

  const capture = (before: TournamentState, transition: { readonly state: TournamentState; readonly events: TournamentState['eventLog'] }) => {
    let prefix = before;
    for (const event of transition.events) {
      prefix = reduceDomainEvent(prefix, event);
      snapshots.set(event.eventIndex, structuredClone(prefix));
    }
    expect(prefix).toEqual(transition.state);
    return transition.state;
  };

  const started = startHand(state, { fixedDeck: fixedWinningDeck() });
  state = capture(state, started);
  const buttonAllIn = applyIntent(state, 0, { type: 'allIn' });
  expect(buttonAllIn.accepted).toBe(true);
  if (!buttonAllIn.accepted) throw new Error(buttonAllIn.rejection.message);
  state = capture(state, buttonAllIn);
  const bigBlindCall = applyIntent(state, 1, { type: 'call' });
  expect(bigBlindCall.accepted).toBe(true);
  if (!bigBlindCall.accepted) throw new Error(bigBlindCall.rejection.message);
  state = capture(state, bigBlindCall);
  const automatic = advanceAutomaticPhases(state);
  state = capture(state, automatic);
  const gameCompleted = startNextHand(state);
  state = capture(state, gameCompleted);
  return {
    state,
    liveSnapshots: snapshots,
    envelope: {
      containsPrivateData: true,
      schemaVersion: 1,
      rulesVersion: 'holdem-v1',
      rngVersion: 'mulberry32-v1',
      shuffleVersion: 'fisher-yates-v1',
      strategyVersion: 'parametric-v1',
      initialConfig: CONFIG,
      seats: SEATS,
      runSeed: 'replay-fixed',
      events: state.eventLog,
    },
  };
}

describe('private exact replay', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reduces GameStarted from null exactly once and deep-equals authoritative prefix states', () => {
    const { state: completed, envelope, liveSnapshots } = completedEnvelope();
    const checkpoints = new Set<number>();
    const types = envelope.events.map((event) => event.type);
    checkpoints.add(types.indexOf('DeckPrepared'));
    checkpoints.add(types.indexOf('HoleCardsDealt'));
    checkpoints.add(types.indexOf('CommunityCardsDealt'));
    checkpoints.add(types.lastIndexOf('HoleCardsRevealed'));
    checkpoints.add(types.lastIndexOf('CommunityCardsDealt'));
    checkpoints.add(types.lastIndexOf('HandCompleted'));
    checkpoints.add(types.lastIndexOf('GameCompleted'));
    expect([...checkpoints], types.join(',')).not.toContain(-1);

    for (const [index, event] of envelope.events.entries()) {
      if (!checkpoints.has(index)) continue;
      const replayed = replayTournament({ ...envelope, events: envelope.events.slice(0, index + 1) });

      expect(replayed).toEqual(liveSnapshots.get(event.eventIndex));
      expect(replayed.eventLog).toEqual(envelope.events.slice(0, index + 1));
      expect(replayed.version).toBe(index + 1);
    }

    expect(replayTournament(envelope)).toEqual(completed);
    expect(completed.eventLog.filter((event) => event.type === 'GameStarted')).toHaveLength(1);
  });

  it('does not consult ambient random or time sources during replay', () => {
    const { envelope } = completedEnvelope();
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('ambient random forbidden'); });
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('ambient time forbidden'); });

    expect(() => replayTournament(envelope)).not.toThrow();
  });

  it.each([
    ['schemaVersion', 2],
    ['rulesVersion', 'holdem-v2'],
    ['rngVersion', 'other-rng'],
    ['shuffleVersion', 'other-shuffle'],
    ['strategyVersion', 'other-strategy'],
  ] as const)('rejects an unknown %s before reduction', (field, value) => {
    const { envelope } = completedEnvelope();
    const incompatible = { ...envelope, [field]: value } as unknown as ReplayEnvelopeV1;

    expect(() => replayTournament(incompatible)).toThrow(ReplayVersionError);
  });

  it.each([
    ['initialConfig', { ...CONFIG, startingStack: 5 }],
    ['seats', [{ playerId: 'renamed', seatIndex: 0 }, SEATS[1]]],
    ['runSeed', 'different-seed'],
  ] as const)('rejects when envelope %s disagrees with GameStarted', (field, value) => {
    const { envelope } = completedEnvelope();
    const inconsistent = { ...envelope, [field]: value } as ReplayEnvelopeV1;

    expect(() => replayTournament(inconsistent)).toThrow(ReplayHeaderError);
  });

  it('rejects a non-private replay envelope', () => {
    const { envelope } = completedEnvelope();
    const publicEnvelope = { ...envelope, containsPrivateData: false } as unknown as ReplayEnvelopeV1;

    expect(() => replayTournament(publicEnvelope)).toThrow(ReplayHeaderError);
  });

  it.each([
    ['missing GameStarted', (envelope: ReplayEnvelopeV1): ReplayEnvelopeV1 => ({
      ...envelope,
      events: envelope.events.slice(1),
    })],
    ['duplicate GameStarted', (envelope: ReplayEnvelopeV1): ReplayEnvelopeV1 => ({
      ...envelope,
      events: [...envelope.events, { ...envelope.events[0]!, eventIndex: envelope.events.length }],
    })],
    ['non-contiguous index', (envelope: ReplayEnvelopeV1): ReplayEnvelopeV1 => ({
      ...envelope,
      events: envelope.events.map((event, index) => index === 2
        ? { ...event, eventIndex: event.eventIndex + 1 }
        : event),
    })],
    ['event schema mismatch', (envelope: ReplayEnvelopeV1): ReplayEnvelopeV1 => ({
      ...envelope,
      events: envelope.events.map((event, index) => index === 2
        ? { ...event, schemaVersion: 2 as 1 }
        : event),
    })],
    ['deck shuffle mismatch', (envelope: ReplayEnvelopeV1): ReplayEnvelopeV1 => ({
      ...envelope,
      events: envelope.events.map((event) => event.type === 'DeckPrepared'
        ? { ...event, shuffleVersion: 'other-shuffle' as 'fisher-yates-v1' }
        : event),
    })],
  ] as const)('rejects malformed event stream: %s', (_name, mutate) => {
    const { envelope } = completedEnvelope();
    expect(() => replayTournament(mutate(envelope))).toThrow(ReplayHeaderError);
  });

  it('rejects GameStarted version identifiers that disagree with the envelope', () => {
    const { envelope } = completedEnvelope();
    const inconsistent: ReplayEnvelopeV1 = {
      ...envelope,
      events: envelope.events.map((event) => event.type === 'GameStarted'
        ? { ...event, rulesVersion: 'holdem-v2' as 'holdem-v1' }
        : event),
    };

    expect(() => replayTournament(inconsistent)).toThrow(ReplayHeaderError);
  });

  it('rejects an invalid tournament header even when GameStarted agrees with it', () => {
    const { envelope } = completedEnvelope();
    const invalidConfig = { ...CONFIG, maxSeats: 7 };
    const invalid = {
      ...envelope,
      initialConfig: invalidConfig,
      events: envelope.events.map((event) => event.type === 'GameStarted'
        ? { ...event, config: invalidConfig }
        : event),
    } as ReplayEnvelopeV1;

    expect(() => replayTournament(invalid)).toThrow(ReplayHeaderError);
  });

  it('rejects a forged duplicate future deck card even when the consumed prefix is unchanged', () => {
    const { envelope } = completedEnvelope();
    const forged: ReplayEnvelopeV1 = {
      ...envelope,
      events: envelope.events.map((event) => event.type === 'DeckPrepared'
        ? {
          ...event,
          fullOrderedDeck: [
            ...event.fullOrderedDeck.slice(0, 51),
            event.fullOrderedDeck[0]!,
          ],
        }
        : event),
    };

    expect(() => replayTournament(forged)).toThrow(TournamentInvariantError);
  });

  it.each([
    ['handNumber', 2],
    ['logicalBlindLevel', 1],
    ['smallBlind', 2],
    ['bigBlind', 3],
  ] as const)('rejects forged HandStarted %s chronology', (field, value) => {
    const { envelope } = completedEnvelope();
    const forged: ReplayEnvelopeV1 = {
      ...envelope,
      events: envelope.events.map((event) => event.type === 'HandStarted'
        ? { ...event, [field]: value }
        : event),
    };

    expect(() => replayTournament(forged)).toThrow(/hand|blind|level|chronology/i);
  });

  it('rejects an out-of-range physical position at the PositionsAssigned prefix', () => {
    const { envelope } = completedEnvelope();
    const positionIndex = envelope.events.findIndex((event) => event.type === 'PositionsAssigned');
    const forged: ReplayEnvelopeV1 = {
      ...envelope,
      events: envelope.events.slice(0, positionIndex + 1).map((event) =>
        event.type === 'PositionsAssigned'
          ? { ...event, buttonPosition: 9 }
          : event),
    };

    expect(() => replayTournament(forged)).toThrow(TournamentInvariantError);
  });
});
