/** Versioned, locally bundled CC0 one-shots. Source/license details live in audio/manifest.json. */
export const SOUND_ASSETS = {
  deal: { files: ['deal-1-v1.wav', 'deal-2-v1.wav'], gain: 0.65 },
  reveal: { files: ['reveal-v1.wav'], gain: 0.7 },
  fold: { files: ['fold-v1.wav'], gain: 0.5 },
  chips: { files: ['chips-v1.wav'], gain: 0.65 },
  allIn: { files: ['all-in-v1.wav'], gain: 0.85 },
  check: { files: ['check-v1.wav'], gain: 0.4 },
  payout: { files: ['payout-v1.wav'], gain: 0.75 },
  turn: { files: ['turn-v1.wav'], gain: 0.55 },
  win: { files: ['win-v1.wav'], gain: 0.7 },
  ability: { files: ['ability-v1.wav'], gain: 0.5 },
} as const;
export type SoundCue = keyof typeof SOUND_ASSETS;
export const SOUND_FILES: readonly string[] = Object.values(SOUND_ASSETS).flatMap(asset => [...asset.files]);
export const AUDIO_CREDIT_FILES = ['CREDITS.txt', 'LICENSE-casino.txt', 'LICENSE-interface.txt', 'manifest.json', 'MUSIC-CREDITS.txt'] as const;
