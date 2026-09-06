import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openGameSession, submitSessionCommand, continueAfterHandResult, getCurrentPacket } from '../../src/game/game-session.js';
import type { OpenGameSessionOptions, SessionCommand, SessionMode } from '../../src/game/session-types.js';
import type { DecisionContext } from '../../src/agents/types.js';
import type { AbilityDecisionPacket, TurnPacket } from '../../src/game/turn-packet.js';
import type { TournamentDriver } from '../../src/game/tournament-driver.js';
import { eligiblePeekTargets, type AbilityId } from '../../src/game/peek-ability.js';
import { assertTournamentInvariants } from '../../src/core/invariants.js';
import { advanceTableView } from '../../src/web/view.js';
import { renderLobby, renderTable } from '../../src/web/render.js';
import type { SeatIdentity } from '../../src/web/protocol.js';

const captured = vi.hoisted(() => ({ drivers: [] as TournamentDriver[], failBuild: false }));
vi.mock('../../src/game/tournament-driver.js', async (original) => {
  const actual = await original<typeof import('../../src/game/tournament-driver.js')>();
  return { ...actual, createTournamentDriver: (...args: Parameters<typeof actual.createTournamentDriver>) => {
    const driver = actual.createTournamentDriver(...args);
    captured.drivers.push(driver);
    return driver;
  } };
});
vi.mock('../../src/game/peek-ability.js', async (original) => {
  const actual = await original<typeof import('../../src/game/peek-ability.js')>();
  return { ...actual, createPeekDecisionPacket: (...args: Parameters<typeof actual.createPeekDecisionPacket>) => {
    if (captured.failBuild) throw new Error('injected private packet failure');
    return actual.createPeekDecisionPacket(...args);
  } };
});

const roster: SeatIdentity[] = [
  { seatIndex: 0, playerId: 'human', name: '你', nickname: '玩家', style: '', characterId: 'hero' },
  { seatIndex: 1, playerId: 'npc', name: '林岚', nickname: '猎手', style: '', characterId: 'hunter' },
];
function options(mode: SessionMode = 'ability-lab', contexts: DecisionContext[] = []): OpenGameSessionOptions {
  return { mode, runSeed: 'private-peek-equivalence', humanSeatIndex: 0,
    config: { maxSeats: 2, startingStack: 100, handsPerLevel: 100,
      blindLevels: [{ smallBlind: 1, bigBlind: 2 }], initialButtonSeat: 0 },
    seats: roster.map(({ playerId, seatIndex }) => ({ playerId, seatIndex })),
    participants: [null, { playerId: 'npc', decide: async (context) => {
      contexts.push(context);
      return { action: { type: context.observation.legalActions.check ? 'check' : 'call' } };
    } }],
  };
}
function peekCommand(packet: TurnPacket, targetSeatIndex = 1): SessionCommand {
  if (packet.kind !== 'decision') throw new Error('Expected decision');
  return { type: 'useAbility', ability: 'peek', targetSeatIndex,
    decisionKey: packet.decisionKey, expectedPacketIndex: packet.packetIndex };
}
function pokerCommand(packet: TurnPacket, type: 'fold' | 'call' | 'check' | 'allIn'): SessionCommand {
  if (packet.kind !== 'decision') throw new Error('Expected decision');
  return { type: 'act', intent: { type }, decisionKey: packet.decisionKey, expectedPacketIndex: packet.packetIndex };
}
function abilityPacket(packet: TurnPacket): AbilityDecisionPacket {
  if (packet.kind !== 'decision' || packet.abilities === null) throw new Error('Expected ability decision');
  return packet;
}
beforeEach(() => { captured.drivers = []; captured.failBuild = false; });

function abilityCommand(packet: TurnPacket, ability: AbilityId): SessionCommand {
  if (packet.kind !== 'decision') throw new Error('Expected decision');
  const base = { type: 'useAbility' as const, decisionKey: packet.decisionKey, expectedPacketIndex: packet.packetIndex };
  return ability === 'swap' ? { ...base, ability, holeCardIndex: 1 } : { ...base, ability, targetSeatIndex: 1 };
}

describe('three-ability session', () => {
  it.each([2, 3, 4, 5, 6])('uses each ability on a separate decision at a %i-seat table and keeps charges spent next hand', async (players) => {
    const contexts: DecisionContext[] = [];
    const base = options();
    const seats = Array.from({ length: players }, (_, seatIndex) => ({ seatIndex, playerId: 'p' + seatIndex }));
    const start = await openGameSession({ ...base, config: { ...base.config, maxSeats: players }, seats,
      participants: seats.map(({ playerId, seatIndex }) => seatIndex === 0 ? null : {
        playerId, decide: async (context: DecisionContext) => {
          contexts.push(context);
          return { action: { type: context.observation.legalActions.check ? 'check' as const : 'call' as const } };
        },
      }),
    });
    const driver = captured.drivers[0]!;
    for (const ability of ['peek', 'read', 'swap'] as const) {
      const before = abilityPacket(getCurrentPacket(start.handle));
      const authority = structuredClone(driver.getAuthorityState());
      const command = abilityCommand(before, ability);
      expect((await submitSessionCommand(start.handle, command)).accepted).toBe(true);
      const after = abilityPacket(getCurrentPacket(start.handle));
      expect(after.decisionKey).toBe(before.decisionKey);
      expect(after.actionPanel).toEqual(before.actionPanel);
      expect(after.abilities.usedThisDecision).toBe(true);
      expect(after.abilities.charges[ability]).toBe(0);
      expect(after.abilities.availableCommands).toEqual([]);
      expect(after.viewerEventsSinceLastPacket).toEqual([]);
      expect(await submitSessionCommand(start.handle, command)).toMatchObject({ accepted: false, rejection: 'stale-packet' });
      if (ability !== 'swap') {
        expect(driver.getAuthorityState()).toEqual(authority);
        expect(after.observation).toEqual(before.observation);
        expect(await submitSessionCommand(start.handle, abilityCommand(after, 'swap')))
          .toMatchObject({ accepted: false, rejection: 'ability-already-used-this-decision' });
      } else {
        expect(after.observation.holeCards).toEqual([before.observation.holeCards[0],
          authority.activeHand!.deck[authority.activeHand!.dealCursor]]);
        expect(after.coreEventRange.toVersionExclusive).toBe(authority.version + 1);
        expect(after.observation.decisionIndex).toBe(before.observation.decisionIndex);
        assertTournamentInvariants(driver.getAuthorityState());
      }
      const invalid = { ...pokerCommand(after, 'check'), intent: { type: 'raiseTo', amount: 0 } } as SessionCommand;
      expect((await submitSessionCommand(start.handle, invalid)).accepted).toBe(false);
      expect(getCurrentPacket(start.handle)).toBe(after);
      await submitSessionCommand(start.handle, pokerCommand(after, after.observation.legalActions.check ? 'check' : 'call'));
    }
    const three = abilityPacket(getCurrentPacket(start.handle));
    expect(three.abilities.charges).toEqual({ peek: 0, read: 0, swap: 0 });
    expect(three.abilities.knowledge.map((entry) => entry.type)).toEqual(['peek', 'read', 'swap']);
    expect(three.abilities.knowledge.find((entry) => entry.type === 'read')).toMatchObject({ street: 'flop' });
    expect(three.observation.street).toBe('river');
    expect(three.abilities.usedThisDecision).toBe(false);
    expect(JSON.stringify(contexts)).not.toMatch(/knowledge|charges|abilityDiscardedCards|HoleCardReplaced|privateEvents/);
    expect(JSON.stringify(three.abilities)).not.toMatch(/equity|deck|sample|runSeed/);
    const finalCards = three.observation.holeCards;
    await submitSessionCommand(start.handle, pokerCommand(three, 'check'));
    const result = getCurrentPacket(start.handle);
    if (result.kind !== 'hand-result') throw new Error('Expected settlement');
    expect(result.handResult.seats[0]!.holeCards).toEqual(finalCards);
    expect(result.privateEventsSinceLastPacket).toEqual([]);
    expect(result.handResult.seats.reduce((total, seat) => total + seat.finalStack, 0)).toBe(players * 100);
    assertTournamentInvariants(driver.getAuthorityState());
    await continueAfterHandResult(start.handle, result.packetIndex);
    const next = abilityPacket(getCurrentPacket(start.handle));
    expect(next.abilities.knowledge).toEqual([]);
    expect(next.abilities.charges).toEqual({ peek: 0, read: 0, swap: 0 });
  });

  it.each(['read', 'swap'] as const)('rolls back authority and charges on %s packet failure, then allows an identical retry', async (ability) => {
    const start = await openGameSession(options());
    const before = structuredClone(captured.drivers[0]!.getAuthorityState());
    const command = abilityCommand(start.packet, ability);
    captured.failBuild = true;
    await expect(submitSessionCommand(start.handle, command)).rejects.toThrow('injected private packet failure');
    expect(getCurrentPacket(start.handle)).toBe(start.packet);
    expect(captured.drivers[0]!.getAuthorityState()).toEqual(before);
    captured.failBuild = false;
    expect((await submitSessionCommand(start.handle, command)).accepted).toBe(true);
    const clean = await openGameSession(options());
    await submitSessionCommand(clean.handle, abilityCommand(clean.packet, ability));
    expect(getCurrentPacket(start.handle)).toEqual(getCurrentPacket(clean.handle));
  });

  it('shows the final swapped pair even if the human folds without public reveal', async () => {
    const start = await openGameSession(options());
    const viewBefore = advanceTableView(null, start.packet, roster);
    await submitSessionCommand(start.handle, abilityCommand(start.packet, 'swap'));
    const swapped = abilityPacket(getCurrentPacket(start.handle));
    const view = advanceTableView(viewBefore, swapped, roster);
    expect(view.holeCards).toEqual(swapped.observation.holeCards);
    expect(view.log).toEqual(viewBefore.log);
    const html = renderTable({ id: 'swap', mode: 'ability-lab', roster, packet: swapped, view });
    expect(html).toContain('第 2 张底牌已更换');
    expect(html).toContain('旧牌退出本手');
    await submitSessionCommand(start.handle, pokerCommand(swapped, 'fold'));
    const result = getCurrentPacket(start.handle);
    if (result.kind !== 'hand-result') throw new Error('Expected settlement');
    expect(result.handResult.seats[0]!.holeCards).toEqual(swapped.observation.holeCards);
    expect(result.handResult.seats[1]!.holeCards).toBeNull();
    expect(result.privateEventsSinceLastPacket).toEqual([]);
  });

  it('rejects every ability in classic mode and invalid swap indices without mutation', async () => {
    const classic = await openGameSession(options('classic'));
    for (const ability of ['peek', 'read', 'swap'] as const) {
      expect(await submitSessionCommand(classic.handle, abilityCommand(classic.packet, ability)))
        .toMatchObject({ accepted: false, rejection: 'wrong-mode' });
    }
    const lab = await openGameSession(options());
    for (const index of [-1, 2, 0.5, NaN]) {
      expect(await submitSessionCommand(lab.handle, { ...abilityCommand(lab.packet, 'swap'), holeCardIndex: index } as SessionCommand))
        .toMatchObject({ accepted: false, rejection: 'invalid-hole-card-index' });
      expect(getCurrentPacket(lab.handle)).toBe(lab.packet);
    }
    expect(await submitSessionCommand(lab.handle, { ...abilityCommand(lab.packet, 'read'), targetSeatIndex: 0 } as SessionCommand))
      .toMatchObject({ accepted: false, rejection: 'invalid-target' });
    expect(getCurrentPacket(lab.handle)).toBe(lab.packet);
  });

  it('keeps read-only play identical to classic, including NPC observation and randomness', async () => {
    const aContexts: DecisionContext[] = [], bContexts: DecisionContext[] = [];
    const a = await openGameSession(options('classic', aContexts));
    const b = await openGameSession(options('ability-lab', bContexts));
    await submitSessionCommand(b.handle, abilityCommand(b.packet, 'read'));
    for (let guard = 0; guard < 10; guard++) {
      const p = getCurrentPacket(a.handle), q = getCurrentPacket(b.handle);
      if (p.kind !== 'decision' || q.kind !== 'decision') break;
      const type = p.observation.legalActions.check ? 'check' : 'call';
      await submitSessionCommand(a.handle, pokerCommand(p, type));
      await submitSessionCommand(b.handle, pokerCommand(q, type));
      expect(captured.drivers[1]!.getAuthorityState()).toEqual(captured.drivers[0]!.getAuthorityState());
    }
    expect(bContexts.map((context) => [context.observation, context.random.seedHash]))
      .toEqual(aContexts.map((context) => [context.observation, context.random.seedHash]));
  });
});

describe('one-shot private peek', () => {
  it('reveals exactly one real card without advancing poker, exposes no authority, and rejects duplicate clicks', async () => {
    const start = await openGameSession(options());
    const before = abilityPacket(start.packet);
    const state = structuredClone(captured.drivers[0]!.getAuthorityState());
    expect(before.abilities.charges.peek).toBe(1);
    expect(before.abilities.availableCommands).toEqual([
      { ability: 'peek', targetSeatIndex: 1 }, { ability: 'read', targetSeatIndex: 1 },
      { ability: 'swap', holeCardIndex: 0 }, { ability: 'swap', holeCardIndex: 1 },
    ]);
    const command = peekCommand(before);
    const result = await submitSessionCommand(start.handle, command);
    expect(result.accepted).toBe(true);
    const after = abilityPacket(getCurrentPacket(start.handle));
    expect(after.packetIndex).toBe(before.packetIndex + 1);
    expect(after.decisionKey).toBe(before.decisionKey);
    expect(after.observation).toEqual(before.observation);
    expect(after.actionPanel).toEqual(before.actionPanel);
    expect(after.viewerEventsSinceLastPacket).toEqual([]);
    expect(after.coreEventRange).toEqual({ fromVersionInclusive: state.version, toVersionExclusive: state.version });
    expect(after.privateEventsSinceLastPacket).toHaveLength(1);
    expect(after.abilities.knowledge).toEqual(after.privateEventsSinceLastPacket);
    expect(after.abilities.charges.peek).toBe(0);
    expect(after.abilities.availableCommands).toEqual([]);
    const known = after.abilities.knowledge[0]!;
    if (known.type !== 'peek') throw new Error('Expected peek');
    expect(state.seats[1]!.holeCards).toContainEqual(known.card);
    expect(Object.isFrozen(known.card)).toBe(true);
    expect(JSON.stringify(after)).not.toMatch(/runSeed|deck|burnedCards|seedHash|private-peek-equivalence/);
    expect(captured.drivers[0]!.getAuthorityState()).toEqual(state);
    expect(await submitSessionCommand(start.handle, command)).toMatchObject({ accepted: false, rejection: 'stale-packet' });
    expect(await submitSessionCommand(start.handle, peekCommand(after))).toMatchObject({ accepted: false, rejection: 'ability-spent' });
    expect(getCurrentPacket(start.handle)).toBe(after);
  });

  it.each([0, -1, 2, 1.5, Number.NaN])('rejects target %s without consuming a charge or changing the packet', async (target) => {
    const start = await openGameSession(options());
    expect(await submitSessionCommand(start.handle, peekCommand(start.packet, target)))
      .toMatchObject({ accepted: false, rejection: 'invalid-target' });
    expect(getCurrentPacket(start.handle)).toBe(start.packet);
    expect(abilityPacket(start.packet).abilities.charges.peek).toBe(1);
  });

  it('blocks classic mode, stale decisions and non-decision use', async () => {
    const classic = await openGameSession(options('classic'));
    expect(await submitSessionCommand(classic.handle, peekCommand(classic.packet)))
      .toMatchObject({ accepted: false, rejection: 'wrong-mode' });
    expect(getCurrentPacket(classic.handle)).toBe(classic.packet);
    const lab = await openGameSession(options());
    const peek = peekCommand(lab.packet);
    expect(await submitSessionCommand(lab.handle, { ...peek, decisionKey: 'old' }))
      .toMatchObject({ accepted: false, rejection: 'stale-decision' });
    expect(getCurrentPacket(lab.handle)).toBe(lab.packet);
    await submitSessionCommand(lab.handle, pokerCommand(lab.packet, 'fold'));
    expect(await submitSessionCommand(lab.handle, { ...peek, expectedPacketIndex: getCurrentPacket(lab.handle).packetIndex }))
      .toMatchObject({ accepted: false, rejection: 'not-human-turn' });
  });

  it('keeps all-in targets eligible but excludes folded, eliminated or publicly revealed targets', async () => {
    await openGameSession(options());
    const state = captured.drivers[0]!.getAuthorityState();
    const hand = state.activeHand!;
    for (const status of ['active', 'all-in', 'folded', 'eliminated'] as const) {
      const changed = { ...state, seats: state.seats.map((seat) => seat.seatIndex === 1 ? { ...seat, status } : seat) };
      expect(eligiblePeekTargets(changed, 0)).toEqual(status === 'active' || status === 'all-in' ? [1] : []);
    }
    expect(eligiblePeekTargets({ ...state, activeHand: { ...hand, revealedHoleCardSeats: [1] } }, 0)).toEqual([]);
    expect(eligiblePeekTargets({ ...state, activeHand: { ...hand, currentActorSeat: 1 } }, 0)).toEqual([]);
  });

  it('commits nothing when private packet construction fails and retries deterministically', async () => {
    const start = await openGameSession(options());
    const command = peekCommand(start.packet);
    captured.failBuild = true;
    await expect(submitSessionCommand(start.handle, command)).rejects.toThrow('injected private packet failure');
    expect(getCurrentPacket(start.handle)).toBe(start.packet);
    captured.failBuild = false;
    await submitSessionCommand(start.handle, command);
    const known = abilityPacket(getCurrentPacket(start.handle)).abilities.knowledge;
    const other = await openGameSession(options());
    await submitSessionCommand(other.handle, peekCommand(other.packet));
    expect(abilityPacket(getCurrentPacket(other.handle)).abilities.knowledge).toEqual(known);
  });

  it('preserves poker and NPC randomness, carries intel between decisions and clears it at hand end without recharging', async () => {
    const classicContexts: DecisionContext[] = [];
    const labContexts: DecisionContext[] = [];
    const classic = await openGameSession(options('classic', classicContexts));
    const lab = await openGameSession(options('ability-lab', labContexts));
    await submitSessionCommand(lab.handle, peekCommand(lab.packet));
    for (let step = 0; step < 20; step++) {
      const a = getCurrentPacket(classic.handle);
      const b = getCurrentPacket(lab.handle);
      expect(b.kind).toBe(a.kind);
      if (a.kind !== 'decision' || b.kind !== 'decision') break;
      expect(b.observation).toEqual(a.observation);
      expect(abilityPacket(b).abilities.knowledge).toHaveLength(1);
      if (step > 0) expect(b.privateEventsSinceLastPacket).toEqual([]);
      const type = a.observation.legalActions.check ? 'check' : 'call';
      await submitSessionCommand(classic.handle, pokerCommand(a, type));
      await submitSessionCommand(lab.handle, pokerCommand(b, type));
      expect(captured.drivers[1]!.getAuthorityState()).toEqual(captured.drivers[0]!.getAuthorityState());
    }
    const result = getCurrentPacket(lab.handle);
    expect(result.kind).toBe('hand-result');
    expect(result.privateEventsSinceLastPacket).toEqual([]);
    expect('abilities' in result).toBe(false);
    expect(labContexts.map((context) => context.observation)).toEqual(classicContexts.map((context) => context.observation));
    expect(JSON.stringify(labContexts)).not.toMatch(/knowledge|charges|privateEvents|"peek"/);
    await continueAfterHandResult(lab.handle, result.packetIndex);
    const next = abilityPacket(getCurrentPacket(lab.handle));
    expect(next.observation.handNumber).toBe(2);
    expect(next.abilities.knowledge).toEqual([]);
    expect(next.abilities.charges.peek).toBe(0);
  });

  it('renders the secret only in its own panel, never on the public seat, and keeps the classic UI clean', async () => {
    const start = await openGameSession(options());
    const before = advanceTableView(null, start.packet, roster);
    await submitSessionCommand(start.handle, peekCommand(start.packet));
    const packet = getCurrentPacket(start.handle);
    const view = advanceTableView(before, packet, roster);
    expect(view.seats[1]!.cards).toBeNull();
    expect(view.log).toEqual(before.log);
    const html = renderTable({ id: 'lab', mode: 'ability-lab', roster, packet, view });
    expect(html).toContain('本手私有情报');
    expect(html).toContain('本场剩余 0 / 1');
    expect(html).not.toContain('data-action="peek"');
    expect(html).toContain('data-intent="call"');
    const publicSeat = html.match(/<article[^>]+data-seat="1"[\s\S]*?<\/article>/)?.[0];
    expect(publicSeat?.match(/未公开的底牌/g)).toHaveLength(2);
    const classic = await openGameSession(options('classic'));
    expect(renderTable({ id: 'classic', mode: 'classic', roster, packet: classic.packet,
      view: advanceTableView(null, classic.packet, roster) })).not.toContain('偷看能力');
    expect(renderLobby({ 2: roster }, 2, 'ability-lab')).toContain('value="ability-lab" selected');
  });
});
