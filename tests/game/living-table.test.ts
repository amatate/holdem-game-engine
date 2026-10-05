import { describe, expect, it, vi } from 'vitest';
import { LivingTable } from '../../src/game/living-table.js';
import { TableMemory, adaptProfile, LivingParticipant } from '../../src/agents/table-memory.js';
import { ParametricHoldemAgent } from '../../src/agents/parametric-agent.js';
import { CHARACTERS } from '../../src/agents/characters.js';
import { parseCard } from '../../src/core/cards.js';
import { createSeededRandom } from '../../src/core/random.js';
import type { PublicActionEvent, PublicGameEvent } from '../../src/core/public-events.js';
import { openGameSession } from '../../src/game/game-session.js';
import { DEFAULT_TOURNAMENT_CONFIG } from '../../src/cli/index.js';
import { selectNpcRoster } from '../../src/game/roster.js';

const action = (seatIndex = 0, kind: 'fold' | 'raise' | 'call' = 'raise'): PublicActionEvent =>
  ({ type: 'playerActed', seatIndex, kind, paid: kind === 'fold' ? 0 : 4, betTo: 4, allIn: false });
const start = (handNumber: number): PublicGameEvent => ({ type: 'handStarted', handNumber, smallBlind: 1, bigBlind: 2 });
const finish = (stacks = [100, 100, 100, 100]): PublicGameEvent =>
  ({ type: 'handCompleted', finalStacks: stacks.map((stack, seatIndex) => ({ seatIndex, stack })) });

describe('public table memory', () => {
  it('deduplicates full prefixes, copies inputs, and expires the eight-hand window', () => {
    const memory = new TableMemory();
    const events = [action()];
    memory.observe(1, events); memory.observe(1, events); memory.observe(1, []);
    events.push(action(0, 'call'));
    expect(memory.evidence(0)).toMatchObject({ hands: 1, actions: 1, raises: 1 });
    memory.observe(1, events);
    expect(memory.evidence(0).actions).toBe(2);
    memory.observe(9, [action()]); memory.observe(1, [action(), action(), action()]);
    expect(memory.evidence(0)).toMatchObject({ hands: 1, actions: 1 });
  });
  it('requires at least three prior hands, bounds adjustments and preserves the base profile', () => {
    const memory = new TableMemory();
    const base = CHARACTERS.hunter.profile;
    memory.observe(1, [action()]); memory.observe(2, [action()]);
    expect(adaptProfile(base, memory.evidence(0), 0, false, 0)).toEqual(base);
    for (let hand = 3; hand <= 6; hand++) memory.observe(hand, [action()]);
    const adapted = adaptProfile(base, memory.evidence(0), 0, false, 0);
    expect(adapted.stickiness).toBeCloseTo(base.stickiness + 0.08);
    const cautious = adaptProfile(base, memory.evidence(0), 99, true, -1);
    expect(cautious.bluffing).toBeCloseTo(base.bluffing - 0.1);
    expect(base.stickiness).toBe(0.42);
    expect(memory.evidence(0, 3).hands).toBe(2);
  });
  it('wires evidence into real NPC policy, not only dialogue', async () => {
    const memory = new TableMemory();
    for (let hand = 1; hand <= 5; hand++) memory.observe(hand, [action(1)]);
    const { packet } = await openGameSession({ mode: 'classic', config: { ...DEFAULT_TOURNAMENT_CONFIG, maxSeats: 2, initialButtonSeat: 0 },
      humanSeatIndex: 0, runSeed: 'memory-policy', seats: [{ seatIndex: 0, playerId: 'hero' }, { seatIndex: 1, playerId: 'npc' }],
      participants: [null, { playerId: 'npc', decide: async () => ({ action: { type: 'fold' } }) }] });
    if (packet.kind !== 'decision') throw new Error('Expected decision');
    const spy = vi.spyOn(ParametricHoldemAgent.prototype, 'decide');
    try {
      const npc = new LivingParticipant('hunter', memory, () => 0);
      const decision = await npc.decide({ observation: { ...packet.observation, handNumber: 6 }, random: createSeededRandom('policy') });
      expect((spy.mock.contexts[0] as ParametricHoldemAgent).profile.stickiness).toBeGreaterThan(CHARACTERS.hunter.profile.stickiness);
      expect(['fold', 'call', 'raiseTo', 'allIn']).toContain(decision.action.type);
    } finally { spy.mockRestore(); }
  });
});

describe('living table expression', () => {
  it('shares public memory across all present NPCs and rotates visible witnesses without extra notices', () => {
    const table = new LivingTable({ story: false });
    for (let hand = 1; hand <= 3; hand++) table.ingest(hand, [start(hand), action(), action()]);
    const notices = table.view().memories;
    expect(notices.filter(n => n.kind === 'action').map(n => n.speaker)).toEqual(['林岚', '阿凯', '莫叔']);
    expect(notices.filter(n => n.kind === 'pressure').map(n => n.speaker)).toEqual(['阿凯', '莫叔', '林岚']);
    expect(notices).toHaveLength(6);
    expect(table.memory.evidence(0)).toMatchObject({ hands: 3, raises: 6 });
    table.ingest(4, [start(4), ...[1, 2, 3].map(seatIndex => ({ type: 'playerEliminated' as const, seatIndex })), action()]);
    expect(table.view().memories).toEqual(notices);
  });
  it('leaves routine calls and folds quiet, but keeps their public memory', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), action(0, 'call'), action(0, 'fold')]);
    expect(table.view().lines.filter(line => line.kind === 'speech')).toHaveLength(1); // Greeting only.
    expect(table.view().memories).toHaveLength(1);
  });
  it('rotates accepted reactions without repeating them or consuming a new random source', () => {
    const table = new LivingTable({ story: false });
    for (let hand = 1; hand <= 5; hand++) table.ingest(hand, [start(hand), action()]);
    const replies = table.view().lines.filter(line => line.kind === 'speech' && line.speaker === '林岚').slice(1);
    expect(replies.map(line => line.text)).toEqual(['加这么多啊。', '你这一下，倒不犹豫。', '加这么多啊。']);
  });
  it.each([2, 3, 4, 5, 6])('uses only the actual %i-player roster for speech and observations', (count) => {
    const people = selectNpcRoster(count).map((characterId, index) => ({ characterId, seatIndex: index + 1 }));
    const table = new LivingTable({ story: false, people });
    table.ingest(0, [start(1), action(), action(0, 'fold'), action(2)]);
    const view = table.view();
    expect(view.notes.map((person) => person.name)).toEqual(people.map((person) => CHARACTERS[person.characterId].displayName));
    for (const line of view.lines) expect(view.notes.some((person) => person.name === line.speaker && person.seatIndex === line.seatIndex)).toBe(true);
    expect(view.memories[0]?.speaker).toBe(view.notes[0]?.name);
    expect(view.prompt).toBeNull(); expect(view.limit).toBeNull(); expect(view.story).toBe(false);
    expect(table.reply('opening', 'warm', view.revision)).toBe(false);
  });
  it('keeps free social tables playing after six hands and after hero elimination', () => {
    const table = new LivingTable({ story: false });
    for (let hand = 1; hand <= 10; hand++) table.ingest(hand, [start(hand), action(), finish()]);
    expect(table.view()).toMatchObject({ ended: false, prompt: null, ending: null, hand: 10 });
    expect(table.view().memories).toHaveLength(8);
    expect(table.view().memories[0]?.hand).toBe(3);
    table.ingest(11, [{ type: 'playerEliminated', seatIndex: 0 }, finish([0, 200, 100, 100])]);
    expect(table.view().ended).toBe(false);
  });
  it('anchors memory to the observed action without consuming chatter quota or later NPC prefixes', () => {
    const table = new LivingTable();
    table.ingest(0, [start(1), action(2)]); // Kai and Mo have used both incidental slots.
    table.memory.observe(1, [action(2), action(0, 'call'), action(), action()]); // Already computed later decisions.
    table.ingest(1, [action(0, 'call'), action()]);
    const memory = table.view().memories[0]!;
    expect(memory).toMatchObject({ packetIndex: 1, eventIndex: 0, hand: 1, title: '林岚记下了你的跟注' });
    expect(memory.fact).toContain('0 手主动下注／加注');
    expect(memory.inference).toContain('至少观察三手');
    expect(table.view().memories).toHaveLength(1); // One fact cue per hand, despite repeated actions.
    table.ingest(1, [action()]);
    expect(table.view().memories).toEqual([memory]);
    table.ingest(2, [finish([70, 130, 100, 100])]);
    expect(table.view().lines.at(-1)?.text).toBe('这回算我运气好。');
  });
  it('waits for three observed hands for an impression and never assigns it to an absent player', () => {
    const table = new LivingTable({ story: false });
    for (let hand = 1; hand <= 3; hand++) table.ingest(hand, [start(hand), action()]);
    expect(table.view().memories.at(-1)?.inference).toContain('样本较少');
    table.ingest(4, [{ type: 'playerEliminated', seatIndex: 1 }, start(4), action(0, 'fold')]);
    expect(table.view().memories.at(-1)?.speaker).toBe('莫叔');
    expect(table.view().lines.filter((line) => line.hand === 4).some((line) => line.speaker === '林岚')).toBe(false);
  });
  it('ignores private cards and does not re-ingest packets on refresh', () => {
    const left = new LivingTable(); const right = new LivingTable();
    left.ingest(0, [start(1), { type: 'ownHoleCardsDealt', cards: [parseCard('As'), parseCard('Ah')] }, action()]);
    right.ingest(0, [start(1), { type: 'ownHoleCardsDealt', cards: [parseCard('2s'), parseCard('3h')] }, action()]);
    expect(left.view()).toEqual(right.view());
    const before = left.view(); left.ingest(0, [action()]);
    expect(left.view()).toEqual(before);
    expect(JSON.stringify(before)).not.toContain('As');
  });
  it('limits incidental speech and cools the same event across hands', () => {
    const table = new LivingTable(); table.ingest(0, [start(1)]);
    table.ingest(1, [action(), action(), action(), action(2), action(2)]);
    expect(table.view().lines.filter((line) => line.speaker === '林岚')).toHaveLength(2); // intro + event
    expect(table.view().lines.filter((line) => line.kind !== 'observation')).toHaveLength(5); // intro + incidental speech
    expect(table.view().lines.filter((line) => line.kind === 'observation').length).toBeLessThanOrEqual(2);
    table.ingest(2, [finish(), start(2), action()]);
    expect(table.view().lines.filter((line) => line.text === '加这么多啊。')).toHaveLength(1);
  });
  it('keeps choices idempotent, distinguishes fact from inference and completes six hands', () => {
    const table = new LivingTable(); table.ingest(0, [start(1)]);
    const opening = table.view();
    expect(table.reply('opening', 'warm', opening.revision)).toBe(true);
    expect(table.reply('opening', 'warm', opening.revision)).toBe(false);
    expect(table.view().notes[2]!.relationship).toBe('愿意多说一点');
    expect(table.view().notes[0]!.inference).toContain('暂不判断');
    for (let hand = 1; hand <= 6; hand++) {
      table.ingest(hand, [...(hand > 1 ? [start(hand)] : []), action(1), finish()]);
      if (hand === 3) expect(table.view().prompt?.id).toBe('middle');
    }
    const view = table.view();
    expect(view.ended).toBe(true); expect(view.prompt?.id).toBe('ending');
    expect(view.notes[0]!.fact).toContain('下注／加注 6 次');
    expect(view.notes[0]!.inference).toContain('不代表这次一定有强牌');
    expect(table.reply('ending', 'direct', view.revision)).toBe(true);
    expect(table.view().ending).toContain('邀请');
  });
  it('fails forward on elimination and decays result emotion with new hands', () => {
    const table = new LivingTable(); table.ingest(0, [start(1), finish([70, 130, 100, 100])]);
    expect(table.mood(1)).toBe(1);
    table.ingest(1, [start(2)]); expect(table.mood(1)).toBe(0.5);
    table.ingest(2, [{ type: 'playerEliminated', seatIndex: 0 }, finish([0, 200, 100, 100])]);
    expect(table.view()).toMatchObject({ ended: true, prompt: { id: 'ending' } });
  });

  it('keeps visible gestures factual, anchored, rate limited and independent of hidden cards', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), { type: 'bettingRoundStarted', street: 'flop', actor: 1, currentBetTo: 0 },
      { type: 'playerActed', seatIndex: 1, kind: 'check', paid: 0, betTo: 0, allIn: false },
      { type: 'playerActed', seatIndex: 2, kind: 'check', paid: 0, betTo: 0, allIn: false },
      { type: 'playerActed', seatIndex: 3, kind: 'bet', paid: 4, betTo: 4, allIn: false }, action(1, 'fold')]);
    const gestures = table.view().lines.filter((line) => line.kind === 'observation');
    expect(gestures).toHaveLength(1); // Quiet actions cannot use the reserved encounter slot.
    expect(gestures[0]).toMatchObject({ speaker: '林岚', seatIndex: 1, text: '轻敲桌面，过牌。', packetIndex: 0, eventIndex: 2 });
    const before = table.view(); table.ingest(0, [action(3)]);
    expect(table.view()).toEqual(before);
    table.ingest(1, [start(2), action(1, 'fold')]);
    expect(table.view().lines.filter((line) => line.hand === 2 && line.kind === 'observation')).toHaveLength(0);
    table.ingest(2, [{ type: 'bettingRoundStarted', street: 'flop', actor: 1, currentBetTo: 0 }, action(1, 'fold')]);
    expect(table.view().lines.at(-1)?.text).toContain('把牌扣下');
  });

  it('skips routine preflop actions and reserves observations for a reraise and later all-in', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), action(1, 'fold'), action(2, 'call'), action(3)]);
    expect(table.view().lines.filter((line) => line.kind === 'observation')).toHaveLength(0);
    table.ingest(1, [{ type: 'playerActed', seatIndex: 2, kind: 'raise', paid: 8, betTo: 12, allIn: false }]);
    const first = table.view().lines.filter((line) => line.kind === 'observation');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ seatIndex: 2, packetIndex: 1, eventIndex: 0 });
    table.ingest(2, [{ type: 'bettingRoundStarted', street: 'flop', actor: 3, currentBetTo: 0 },
      { type: 'playerActed', seatIndex: 3, kind: 'check', paid: 0, betTo: 0, allIn: false }]);
    expect(table.view().lines.filter((line) => line.kind === 'observation')).toEqual(first);
    table.ingest(3, [{ type: 'playerActed', seatIndex: 2, kind: 'bet', paid: 88, betTo: 88, allIn: true },
      { type: 'playerActed', seatIndex: 3, kind: 'call', paid: 88, betTo: 88, allIn: true }]);
    const gestures = table.view().lines.filter((line) => line.kind === 'observation');
    expect(gestures).toHaveLength(2);
    expect(gestures[0]).toEqual(first[0]); // Previously emitted anchors never move or disappear.
    expect(gestures[1]).toMatchObject({ seatIndex: 2, packetIndex: 3, eventIndex: 0,
      text: '把剩余 88 筹码全部推入，本轮到 88。' });
  });

  it('can show a quiet postflop gesture and then an important action by the same NPC without using hidden cards', () => {
    const tables = [new LivingTable({ story: false }), new LivingTable({ story: false })];
    for (const [index, table] of tables.entries()) {
      table.ingest(0, [start(1), { type: 'ownHoleCardsDealt', cards: index
        ? [parseCard('As'), parseCard('Ah')] : [parseCard('2s'), parseCard('3h')] },
      { type: 'bettingRoundStarted', street: 'flop', actor: 1, currentBetTo: 0 },
      { type: 'playerActed', seatIndex: 1, kind: 'check', paid: 0, betTo: 0, allIn: false },
      { type: 'playerActed', seatIndex: 2, kind: 'check', paid: 0, betTo: 0, allIn: false }]);
      const earlier = table.view().lines.filter((line) => line.kind === 'observation');
      expect(earlier).toHaveLength(1);
      table.ingest(1, [{ type: 'playerActed', seatIndex: 0, kind: 'bet', paid: 50, betTo: 50, allIn: false },
        { type: 'playerActed', seatIndex: 1, kind: 'call', paid: 40, betTo: 40, allIn: true }]);
      const gestures = table.view().lines.filter((line) => line.kind === 'observation');
      expect(gestures).toHaveLength(2);
      expect(gestures[0]).toEqual(earlier[0]);
      expect(gestures[1]).toMatchObject({ seatIndex: 1, packetIndex: 1, eventIndex: 1,
        text: '把剩余 40 筹码全部推入，本轮到 40。' });
    }
    expect(tables[0]!.view()).toEqual(tables[1]!.view());
  });

  it('recognizes a large-pot decision from the current public contributions, not a future packet suffix', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), ...[0, 1, 2].map((seatIndex) => ({ type: 'playerActed' as const,
      seatIndex, kind: 'call' as const, paid: 12, betTo: 12, allIn: false })),
    { type: 'bettingRoundStarted', street: 'flop', actor: 1, currentBetTo: 0 },
    { type: 'playerActed', seatIndex: 1, kind: 'check', paid: 0, betTo: 0, allIn: false }]);
    expect(table.view().lines.filter((line) => line.kind === 'observation')).toHaveLength(1);
    table.ingest(1, [{ type: 'playerActed', seatIndex: 0, kind: 'bet', paid: 4, betTo: 4, allIn: false }, action(1, 'call')]);
    const gestures = table.view().lines.filter((line) => line.kind === 'observation');
    expect(gestures).toHaveLength(2);
    expect(gestures[1]).toMatchObject({ seatIndex: 1, packetIndex: 1, eventIndex: 1,
      text: '补入 4 筹码跟注，本轮到 4。' });
  });

  it('resets same-street pressure at a new betting round and never lets quiet gestures spend both slots', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), action(), action(1, 'call'),
      { type: 'bettingRoundStarted', street: 'flop', actor: 2, currentBetTo: 0 },
      { type: 'playerActed', seatIndex: 2, kind: 'bet', paid: 4, betTo: 4, allIn: false }, action(3, 'call'),
      { type: 'bettingRoundStarted', street: 'turn', actor: 3, currentBetTo: 0 },
      { type: 'playerActed', seatIndex: 3, kind: 'bet', paid: 4, betTo: 4, allIn: false }]);
    const earlier = table.view().lines.filter((line) => line.kind === 'observation');
    expect(earlier).toHaveLength(1);
    expect(earlier[0]).toMatchObject({ seatIndex: 2, packetIndex: 0, eventIndex: 4 });
    table.ingest(1, [{ type: 'playerActed', seatIndex: 1, kind: 'raise', paid: 8, betTo: 8, allIn: false }]);
    const gestures = table.view().lines.filter((line) => line.kind === 'observation');
    expect(gestures).toHaveLength(2);
    expect(gestures[1]).toMatchObject({ seatIndex: 1, packetIndex: 1, eventIndex: 0 });
  });

  it('adds one important encounter after the first action without repeatedly recording the same pressure', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), action(0, 'call'), action(), action(), action()]);
    expect(table.view().memories).toHaveLength(2);
    expect(table.view().memories[1]).toMatchObject({ kind: 'pressure', packetIndex: 0, eventIndex: 3 });
    expect(table.view().memories[1]?.fact).toContain('第 2 次');
    expect(table.memory.keyEvidence(0, 1).pressureHands).toBe(0);
    expect(table.memory.keyEvidence(0, 2).pressureHands).toBe(1);
  });

  it('records only publicly revealed showdowns, without calling a high-card bet a proven bluff', () => {
    const table = new LivingTable({ story: false });
    const evaluated: PublicGameEvent = { type: 'handEvaluated', seatIndex: 0, category: 'high-card',
      bestFive: [parseCard('As'), parseCard('Jh'), parseCard('9c'), parseCard('7s'), parseCard('4h')] };
    table.ingest(0, [start(1), action(), evaluated]);
    expect(table.view().memories.some((notice) => notice.kind === 'showdown')).toBe(false);
    expect(table.memory.keyEvidence(0, 2).shownHighCardAggression).toBe(0);
    table.ingest(1, [{ type: 'holeCardsRevealed', seatIndex: 0, reason: 'showdown', cards: [parseCard('As'), parseCard('Jh')] }, evaluated]);
    expect(table.view().memories.at(-1)?.fact).toContain('不能仅凭结果断定先前的下注意图');
    expect(table.memory.keyEvidence(0, 2).shownHighCardAggression).toBe(1);
    expect(table.view().memories.at(-1)?.fact).not.toContain('As');
  });

  it('backs a large-pot memory and recap with actual investments, refunds and final public stacks', () => {
    const table = new LivingTable({ story: false });
    table.ingest(0, [start(1), { type: 'playerActed', seatIndex: 0, kind: 'raise', paid: 50, betTo: 50, allIn: false },
      { type: 'playerActed', seatIndex: 1, kind: 'call', paid: 40, betTo: 40, allIn: true },
      { type: 'uncalledBetReturned', seatIndex: 0, amount: 10 }]);
    expect(table.memory.lastSignificantOutcome(1, 2)).toBeNull();
    table.ingest(1, [finish([140, 60, 100, 100])]);
    expect(table.view().memories.at(-1)?.kind).toBe('big-pot');
    expect(table.view().recap?.text).toContain('你本手实际投入 40，林岚实际投入 40');
    expect(table.view().recap?.text).toContain('净赢 40');
    expect(table.memory.lastSignificantOutcome(1, 2)).toEqual({ hand: 1, net: -40, bigBlind: 2 });
    table.ingest(2, [start(2)]); expect(table.view().recap).toBeNull();
  });
});
