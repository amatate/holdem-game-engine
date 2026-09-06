import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openGameSession, submitSessionCommand, continueAfterHandResult, getCurrentPacket } from '../../src/game/game-session.js';
import type { OpenGameSessionOptions, SessionCommand, SessionMode } from '../../src/game/session-types.js';
import type { DecisionContext } from '../../src/agents/types.js';
import type { AbilityDecisionPacket, TurnPacket } from '../../src/game/turn-packet.js';
import type { TournamentDriver } from '../../src/game/tournament-driver.js';
import { eligiblePeekTargets } from '../../src/game/peek-ability.js';
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

describe('one-shot private peek', () => {
  it('reveals exactly one real card without advancing poker, exposes no authority, and rejects duplicate clicks', async () => {
    const start = await openGameSession(options());
    const before = abilityPacket(start.packet);
    const state = structuredClone(captured.drivers[0]!.getAuthorityState());
    expect(before.abilities.charges.peek).toBe(1);
    expect(before.abilities.availableCommands).toEqual([{ ability: 'peek', targetSeatIndex: 1 }]);
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

  it('blocks classic mode, unavailable abilities, stale decisions and non-decision use', async () => {
    const classic = await openGameSession(options('classic'));
    expect(await submitSessionCommand(classic.handle, peekCommand(classic.packet)))
      .toMatchObject({ accepted: false, rejection: 'wrong-mode' });
    expect(getCurrentPacket(classic.handle)).toBe(classic.packet);
    const lab = await openGameSession(options());
    const peek = peekCommand(lab.packet);
    expect(await submitSessionCommand(lab.handle, { ...peek, decisionKey: 'old' }))
      .toMatchObject({ accepted: false, rejection: 'stale-decision' });
    expect(await submitSessionCommand(lab.handle, { ...peek, ability: 'read' } as SessionCommand))
      .toMatchObject({ accepted: false, rejection: 'ability-unavailable' });
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
