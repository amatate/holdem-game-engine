import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TableMusic, MUSIC_KEY, MUSIC_FILE } from '../../src/web/music.js';
function rig(saved: string | null = null) {
  let hidden = false;
  const audio = { loop: false, preload: '' as HTMLAudioElement['preload'], volume: 1, play: vi.fn(async () => {}), pause: vi.fn() };
  const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
  const factory = vi.fn(() => audio);
  const music = new TableMusic({ audio: factory, hidden: () => hidden, storage, changed: vi.fn() });
  return { music, audio, storage, factory, hide(value: boolean) { hidden = value; music.visibility(); } };
}
it('defaults to off, creates no audio until requested, and leaves SFX settings alone', async () => {
  const r = rig(); await r.music.unlock(); expect(r.factory).not.toHaveBeenCalled();
  await r.music.setEnabled(true); expect(r.audio.play).toHaveBeenCalledOnce(); expect(r.audio.loop).toBe(true);
  expect(r.audio.volume).toBe(.2); expect(r.music.status).toBe('playing');
  r.music.setVolume(.35); expect(r.audio.volume).toBe(.35);
  await r.music.setEnabled(false); expect(r.audio.pause).toHaveBeenCalled();
  expect(r.storage.setItem.mock.calls.every(call => call[0] === MUSIC_KEY)).toBe(true);
});
it('restores an enabled preference only after a gesture, pauses in background and resumes once', async () => {
  const r = rig('{"enabled":true,"volume":0.1}');
  expect(r.music.status).toBe('waiting'); expect(r.factory).not.toHaveBeenCalled();
  await r.music.unlock(); await r.music.unlock(); expect(r.audio.play).toHaveBeenCalledOnce();
  r.hide(true); expect(r.music.status).toBe('paused'); r.hide(false);
  await Promise.resolve(); expect(r.audio.play).toHaveBeenCalledTimes(2);
});
it('contains playback failures and a delayed play cannot undo a user turning music off', async () => {
  const r = rig(); r.audio.play.mockRejectedValueOnce(new Error('blocked'));
  await r.music.setEnabled(true); expect(r.music.status).toBe('error'); expect(r.music.enabled).toBe(false);
  let complete!: () => void;
  r.audio.play.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const playing = r.music.setEnabled(true);
  await r.music.setEnabled(false); complete(); await playing;
  expect(r.music.status).toBe('off'); expect(r.music.enabled).toBe(false); expect(r.audio.pause).toHaveBeenCalled();
});
it('bundles the credited original rather than a remote URL at runtime', async () => {
  const bytes = await readFile(new URL('../../src/web/audio/' + MUSIC_FILE, import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('86e5afb1f71da4c45927bb693cc32e2f72954137cf010599a912fa89cfd4db2e');
  const credit = await readFile(new URL('../../src/web/audio/MUSIC-CREDITS.txt', import.meta.url), 'utf8');
  expect(credit).toContain('CC BY 4.0'); expect(credit).toContain('Kevin MacLeod');
  expect(credit).toContain('https://creativecommons.org/licenses/by/4.0/');
  const html = await readFile(new URL('../../src/web/index.html', import.meta.url), 'utf8');
  expect(html).toContain('Cool Vibes · Kevin MacLeod (incompetech.com)');
  expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
});
