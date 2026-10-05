import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TableSound, soundPreferences, frameSound, boundarySound, SOUND_PREFERENCE_KEY } from '../../src/web/sound.js';
import { SOUND_FILES, type SoundCue } from '../../src/web/sound-assets.js';
import type { PublicGameEvent } from '../../src/core/public-events.js';
import type { WebTable } from '../../src/web/protocol.js';

function rig(load: (file: string) => Promise<ArrayBuffer> = async () => new ArrayBuffer(8)) {
  let time = 1000, hidden = false;
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>; buffer: unknown; onended: (() => void) | null }[] = [];
  const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = { state: 'suspended', destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    decodeAudioData: vi.fn(async () => ({ duration: 0.5 })),
    createGain: vi.fn(() => {
      const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(gain); return gain;
    }),
    createBufferSource: vi.fn(() => {
      const source = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), buffer: null,
        onended: null as (() => void) | null }; sources.push(source); return source;
    }),
  };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const storage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn() };
  const options = { createContext, load: vi.fn(load), hidden: () => hidden, now: () => time, storage, changed: vi.fn() };
  return { make: () => new TableSound(options), context, sources, gains, options,
    advance: () => { time += 150; }, hide: (value: boolean) => { hidden = value; } };
}

it('normalizes untrusted preferences without changing the game or accepting invalid volumes', () => {
  expect(soundPreferences(null)).toEqual({ muted: false, volume: 0.4 });
  expect(soundPreferences({ muted: true, volume: 99 })).toEqual({ muted: true, volume: 1 });
  expect(soundPreferences({ muted: 'true', volume: -2 })).toEqual({ muted: false, volume: 0 });
  expect(soundPreferences({ volume: NaN }).volume).toBe(0.4);
});
it('loads only after a gesture, drops early cues, and never replays them when loading finishes', async () => {
  const r = rig(), sound = r.make();
  expect(r.options.createContext).not.toHaveBeenCalled();
  expect(sound.play('deal')).toBe(false);
  await sound.unlock();
  expect(r.options.load).toHaveBeenCalledTimes(11);
  expect(sound.loadedCount).toBe(11);
  expect(sound.status).toBe('ready');
  expect(r.sources).toHaveLength(0);
  expect(sound.play('deal')).toBe(true);
  expect(r.sources[0]!.start).toHaveBeenCalledOnce();
  await sound.unlock();
  expect(r.options.load).toHaveBeenCalledTimes(11);
});
it('deduplicates simultaneous loading and caps overlapping voices and same-cue rate', async () => {
  const r = rig(), sound = r.make();
  await Promise.all([sound.unlock(), sound.unlock(), sound.unlock()]);
  expect(r.options.createContext).toHaveBeenCalledOnce();
  expect(r.options.load).toHaveBeenCalledTimes(11);
  expect(sound.play('chips')).toBe(true);
  expect(sound.play('chips')).toBe(false);
  expect(sound.play('deal')).toBe(true);
  expect(sound.play('reveal')).toBe(true);
  expect(r.sources[0]!.stop).toHaveBeenCalledOnce();
  expect(r.sources[1]!.stop).not.toHaveBeenCalled();
});
it('stops immediately on mute, zero volume and skip; persists preferences and preserves source pitch', async () => {
  const r = rig(), sound = r.make();
  await sound.unlock();
  sound.play('allIn'); sound.setMuted(true);
  expect(r.sources[0]!.stop).toHaveBeenCalledOnce();
  expect(sound.play('win')).toBe(false);
  sound.setMuted(false); sound.setVolume(0.2);
  expect(r.gains[0]!.gain.value).toBe(0.2);
  sound.play('turn'); sound.setVolume(0);
  expect(r.sources[1]!.stop).toHaveBeenCalledOnce();
  expect(sound.play('payout')).toBe(false);
  sound.setVolume(0.4); r.advance(); sound.play('turn'); sound.stop();
  expect(r.sources[2]!.stop).toHaveBeenCalledOnce();
  expect(r.options.storage.setItem).toHaveBeenLastCalledWith(SOUND_PREFERENCE_KEY, '{"muted":false,"volume":0.4}');
});
it('respects a saved mute without even loading assets', async () => {
  const r = rig();
  r.options.storage.getItem.mockReturnValue('{"muted":true,"volume":0.25}');
  const sound = r.make();
  expect(sound.preferences).toEqual({ muted: true, volume: 0.25 });
  await sound.unlock();
  expect(r.options.createContext).not.toHaveBeenCalled();
});
it('ignores unavailable storage and stays playable when audio load or browser resume fails', async () => {
  const r = rig(async () => { throw new Error('404'); });
  r.options.storage.getItem.mockImplementation(() => { throw new Error('Blocked'); });
  r.options.storage.setItem.mockImplementation(() => { throw new Error('Blocked'); });
  const sound = r.make();
  await expect(sound.unlock()).resolves.toBe(false);
  expect(sound.status).toBe('unavailable');
  expect(() => sound.setMuted(true)).not.toThrow();
  expect(sound.play('chips')).toBe(false);
  const rejected = rig();
  rejected.context.resume.mockRejectedValue(new Error('Autoplay blocked'));
  await expect(rejected.make().unlock()).resolves.toBe(false);
});
it('keeps other sounds when one sample fails and tolerates missing Web Audio', async () => {
  const r = rig(async file => { if (file === 'win-v1.wav') throw new Error('Unavailable'); return new ArrayBuffer(8); });
  const sound = r.make();
  await sound.unlock();
  expect(sound.status).toBe('partial');
  expect(sound.play('win')).toBe(false);
  expect(sound.play('turn')).toBe(true);
  const unsupported = rig();
  unsupported.options.createContext.mockImplementation(() => { throw new Error('No API'); });
  await expect(unsupported.make().unlock()).resolves.toBe(false);
});
it('does not play in a hidden tab or drain missed sounds after returning', async () => {
  const r = rig(), sound = r.make();
  await sound.unlock();
  r.hide(true); sound.stop();
  expect(sound.play('turn')).toBe(false);
  r.hide(false);
  expect(r.sources).toHaveLength(0);
  expect(sound.play('chips')).toBe(true);
});
it('cancels a pending preview when skipped, muted or destroyed', async () => {
  for (const action of ['stop', 'mute', 'destroy'] as const) {
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const r = rig(async () => { await pending; return new ArrayBuffer(8); }), sound = r.make();
    const preview = sound.preview();
    if (action === 'mute') sound.setMuted(true); else sound[action]();
    resolve(); await preview;
    expect(r.sources).toHaveLength(0);
  }
});

const action = (kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', paid = 0, allIn = false): PublicGameEvent =>
  ({ type:'playerActed', seatIndex:2, kind, paid, allIn, betTo:paid });
it.each([
  [action('fold'), 'fold'], [action('check'), 'check'], [action('call', 3), 'chips'],
  [action('raise', 100, true), 'allIn'], [action('bet', 12), 'chips'],
  [{type:'potAwarded',potId:'pot-0',winners:[2],amounts:[20],oddChipRecipients:[]}, 'payout'],
  [{type:'uncalledBetReturned',seatIndex:2,amount:7}, 'payout'],
  [{type:'communityCardsDealt',street:'river',cards:[]}, 'reveal'],
  [{type:'ownHoleCardsDealt',cards:[]}, 'deal'],
] as [PublicGameEvent, SoundCue][])('maps a visible %j to %s without repeating reaction frames', (event, cue) => {
  const before = structuredClone(event);
  expect(frameSound({event})).toBe(cue);
  expect(frameSound({event,reactionOnly:true})).toBeNull();
  expect(event).toEqual(before);
});
it('ignores setup/analysis frames and zero-chip calls', () => {
  expect(frameSound({event:{type:'showdownStarted',revealOrder:[1,2]}})).toBeNull();
  expect(frameSound({event:action('call',0)})).toBeNull();
});

// Minimal presentation fixtures: cue selection never reads the rules state.
const decision = (key = 'd1', index = 1) => ({id:'table',packet:{kind:'decision',decisionKey:key,packetIndex:index,privateEventsSinceLastPacket:[]}} as unknown as WebTable);
it('notifies only for a new decision, not duplicate packets, dialogue or an unchanged turn', () => {
  const before = decision(), after = decision('d2',2);
  expect(boundarySound(null,before)).toBe('turn');
  expect(boundarySound(before,after)).toBe('turn');
  expect(boundarySound(before,before)).toBeNull();
  expect(boundarySound(before,decision('d1',2))).toBeNull();
});
it('celebrates net profit, not a side-pot payout in a losing hand', () => {
  const result = (net: number) => ({id:'table',packet:{kind:'hand-result',packetIndex:2,handNumber:1,
    handResult:{seats:[{seatIndex:0,net,potWon:40}]}}} as unknown as WebTable);
  expect(boundarySound(decision(),result(-10))).toBeNull();
  expect(boundarySound(decision(),result(0))).toBeNull();
  expect(boundarySound(decision(),result(20))).toBe('win');
  expect(boundarySound(result(20),result(20))).toBeNull();
});
it('bundles exactly the licensed manifest samples with safe PCM headers and matching hashes', async () => {
  const root = new URL('../../src/web/audio/',import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  expect(manifest.license).toBe('CC0-1.0');
  expect(manifest.files.map((entry: {file:string})=>entry.file).sort()).toEqual([...SOUND_FILES].sort());
  let total = 0;
  for (const entry of manifest.files) {
    const bytes = await readFile(new URL(entry.file,root)); total += bytes.length;
    expect(bytes.toString('ascii',0,4)).toBe('RIFF');
    expect(bytes.toString('ascii',8,12)).toBe('WAVE');
    expect(bytes.readUInt16LE(20)).toBe(1); // PCM.
    expect(bytes.readUInt16LE(22)).toBe(1); // Mono.
    expect(bytes.readUInt32LE(24)).toBe(44100);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(entry.peakDb).toBeLessThanOrEqual(-6);
    expect(entry.duration).toBeLessThan(1);
  }
  expect(total).toBeLessThan(450_000);
  for (const name of ['casino','interface']) expect(await readFile(new URL(`LICENSE-${name}.txt`,root),'utf8')).toContain('CC0');
});
