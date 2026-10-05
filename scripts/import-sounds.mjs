// One-time/reproducible asset preparation. Requires ffmpeg + ffprobe, not at game runtime.
// Pass directories containing the original extracted Kenney packs (Audio/ + License.txt).
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const [casinoDir, interfaceDir] = process.argv.slice(2);
if (!casinoDir || !interfaceDir) throw new Error('Usage: node scripts/import-sounds.mjs <casino-pack> <interface-pack>');
const packs = {
  casino: { directory: resolve(casinoDir), name: 'Casino Audio 1.1', url: 'https://kenney.nl/assets/casino-audio' },
  interface: { directory: resolve(interfaceDir), name: 'Interface Sounds 1.0', url: 'https://kenney.nl/assets/interface-sounds' },
};
const selection = [
  ['deal-1-v1.wav', 'casino', 'card-slide-1.ogg'],
  ['deal-2-v1.wav', 'casino', 'card-slide-2.ogg'],
  ['reveal-v1.wav', 'casino', 'card-place-1.ogg'],
  ['fold-v1.wav', 'casino', 'card-shove-1.ogg'],
  ['chips-v1.wav', 'casino', 'chip-lay-1.ogg'],
  ['all-in-v1.wav', 'casino', 'chips-handle-1.ogg'],
  ['payout-v1.wav', 'casino', 'chips-stack-1.ogg'],
  ['check-v1.wav', 'interface', 'click_001.ogg'],
  ['turn-v1.wav', 'interface', 'question_002.ogg'],
  ['win-v1.wav', 'interface', 'confirmation_001.ogg'],
  ['ability-v1.wav', 'interface', 'maximize_001.ogg'],
];
const out = resolve('src/web/audio');
await mkdir(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration:stream=channels,sample_rate', '-of', 'json', file], { encoding: 'utf8' }));
// spawnSync retains stderr on a successful conversion.
const { spawnSync } = await import('node:child_process');
const peakDb = file => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Audio analysis failed: ' + file);
  const match = result.stderr.match(/max_volume: ([-.\d]+) dB/);
  if (!match) throw new Error('Missing audio peak: ' + file);
  return Number(match[1]);
};
const entries = [];
for (const [file, pack, original] of selection) {
  const source = join(packs[pack].directory, 'Audio', original), destination = join(out, file);
  const sourcePeak = peakDb(source), gain = Math.min(12, -6 - sourcePeak);
  const duration = Number(probe(source).format.duration);
  if (!(duration > 0 && duration <= 2)) throw new Error('Expected a short, non-silent one-shot');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', source, '-map_metadata', '-1', '-ac', '1', '-ar', '44100',
    '-af', `volume=${gain.toFixed(2)}dB,afade=t=in:d=0.003,afade=t=out:st=${Math.max(0, duration - 0.008).toFixed(6)}:d=0.008`,
    '-c:a', 'pcm_s16le', destination]);
  const bytes = await readFile(destination), actual = probe(destination);
  entries.push({ file, pack: packs[pack].name, source: 'Audio/' + original, sourcePage: packs[pack].url,
    sourceSha256: hash(await readFile(source)), sha256: hash(bytes), bytes: bytes.length,
    duration: Number(actual.format.duration), sampleRate: Number(actual.streams[0].sample_rate),
    channels: actual.streams[0].channels, peakDb: peakDb(destination), gainDb: Number(gain.toFixed(2)) });
}
for (const [key, pack] of Object.entries(packs)) await copyFile(join(pack.directory, 'License.txt'), join(out, `LICENSE-${key}.txt`));
await writeFile(join(out, 'manifest.json'), JSON.stringify({
  author: 'Kenney', license: 'CC0-1.0', verifiedAt: '2026-09-28',
  processing: 'OGG to mono 44.1 kHz PCM16 WAV; peak target -6 dBFS (boost capped at 12 dB); 3 ms in / 8 ms out fades.',
  files: entries,
}, null, 2) + '\n');
console.log(JSON.stringify({ files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  sounds: entries.map(({ file, duration, peakDb }) => ({ file, duration, peakDb })) }, null, 2));
