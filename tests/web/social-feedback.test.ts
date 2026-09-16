import { describe, expect, it } from 'vitest';
import { LivingTable } from '../../src/game/living-table.js';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import type { SeatIdentity } from '../../src/web/protocol.js';
import { buildPlaybackFrames } from '../../src/web/playback.js';
import { escapeHtml, renderLobby, renderPlaybackFrame } from '../../src/web/render.js';
import { renderPulse } from '../../src/web/experience-render.js';

const roster: SeatIdentity[] = [
  { seatIndex: 0, playerId: 'hero', name: '你', nickname: '玩家', style: '', characterId: 'hero' },
  { seatIndex: 1, playerId: 'lan', name: '林岚', nickname: '猎手', style: '', characterId: 'hunter' },
];
const events: PublicGameEvent[] = [
  { type: 'gameStarted', maxSeats: 2, startingStack: 100 },
  { type: 'handStarted', handNumber: 1, smallBlind: 1, bigBlind: 2 },
  { type: 'positionsAssigned', buttonPosition: 1, smallBlindSeat: 1, bigBlindSeat: 0 },
  { type: 'playerActed', seatIndex: 0, kind: 'raise', paid: 4, betTo: 4, allIn: false },
  { type: 'playerActed', seatIndex: 1, kind: 'fold', paid: 0, betTo: 0, allIn: false },
  { type: 'uncalledBetReturned', seatIndex: 0, amount: 4 },
  { type: 'handCompleted', finalStacks: [{ seatIndex: 0, stack: 100 }, { seatIndex: 1, stack: 100 }] },
];

describe('visible social feedback', () => {
  it('shows an enabled-by-default homepage checkbox independent of rules', () => {
    const on = renderLobby({}, 6, 'ability-lab');
    expect(on).toContain('id="social-enabled" checked');
    expect(on).toContain('人物记忆与闲聊'); expect(on).toContain('不进入剧情');
    expect(renderLobby({}, 2, 'classic', false)).not.toContain('id="social-enabled" checked');
  });
  it('times speech and memory to their public event, not the final social view', () => {
    const table = new LivingTable({ story: false, people: [{ seatIndex: 1, characterId: 'hunter' }] });
    table.ingest(0, events);
    const feedback = { ...table.view(), packetIndex: 0 };
    const frames = buildPlaybackFrames(null, events, roster, feedback);
    expect(frames[0]?.event.type).toBe('positionsAssigned');
    expect(frames[0]?.view.buttonPosition).toBe(1);
    expect(frames[0]?.memory).toBeUndefined();
    const raised = frames.find((frame) => frame.memory)!;
    expect(raised.event).toEqual(events[3]);
    expect(raised.view.seats[1]?.status).toBe('active'); // Later fold not revealed early.
    expect(raised.holdMs).toBeGreaterThanOrEqual(2400);
    const html = renderPlaybackFrame(raised, roster, 2, frames.length);
    expect(html).toContain('seat-bubble'); expect(html).toContain('林岚记下了你的加注');
    expect(html).not.toContain('已弃牌'); expect(html).not.toContain('data-intent=');
    expect(renderPlaybackFrame(frames[0]!, roster, 1, frames.length)).not.toContain('记下了你的加注');
    // An old packet or an unanchored story reply cannot be replayed as a poker event.
    expect(buildPlaybackFrames(null, events, roster, { ...feedback, packetIndex: 1 }).some((frame) => frame.line || frame.memory)).toBe(false);
    expect(buildPlaybackFrames(null, events, roster, { packetIndex: 0, memories: [], lines: [{ ...feedback.lines[0]!, eventIndex: -1 }] }).some((frame) => frame.line)).toBe(false);
  });
  it('does not reapply chips when two people respond to one action, and mute removes speech only', () => {
    const table = new LivingTable(); table.ingest(0, [events[0]!, events[1]!, events[2]!,
      { type: 'playerActed', seatIndex: 2, kind: 'raise', paid: 4, betTo: 4, allIn: false }, events[3]!]);
    const feedback = { ...table.view(), packetIndex: 0 };
    const input = [events[0]!, events[1]!, events[2]!,
      { type: 'playerActed', seatIndex: 2, kind: 'raise', paid: 4, betTo: 4, allIn: false } as const, events[3]!];
    const frames = buildPlaybackFrames(null, input, roster, feedback);
    const reply = frames.findIndex((frame) => frame.reactionOnly && frame.event.type === 'playerActed');
    expect(reply).toBeGreaterThan(0); expect(frames[reply]?.view).toEqual(frames[reply - 1]?.view);
    const muted = buildPlaybackFrames(null, input, roster, { ...feedback, lines: [] });
    expect(muted.some((frame) => frame.line)).toBe(false);
    expect(muted.some((frame) => frame.memory)).toBe(true);
  });
  it('keeps facts visible after skip/sync, allows replaying the text, and escapes all feedback', () => {
    const table = new LivingTable({ story: false, people: [{ seatIndex: 1, characterId: 'hunter' }] });
    table.ingest(0, events);
    const view = table.view();
    const html = renderPulse(view, escapeHtml);
    expect(html).toContain('桌边动态'); expect(html).toContain('记住了你'); expect(html).toContain('回看桌边记录');
    const muted = renderPulse(view, escapeHtml, true);
    expect(muted).toContain('闲聊已收起'); expect(muted).toContain('林岚记下了你的加注');
    expect(muted).not.toContain('这个价我看见了');
    view.lines[0]!.text = '<script>alert(1)</script>';
    view.lines[0]!.speaker = '<img src=x>';
    view.memories[0]!.fact = '<b>不可信文本</b>';
    const escaped = renderPulse(view, escapeHtml);
    expect(escaped).not.toContain('<script>'); expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;b&gt;');
    // A server started before the upgrade may not provide the new memory cue field.
    const legacy = { lines: view.lines } as Parameters<typeof renderPulse>[0];
    expect(() => renderPulse(legacy, escapeHtml)).not.toThrow();
  });
});
