import { SOUND_ASSETS, SOUND_FILES, type SoundCue } from './sound-assets.js';
import type { PlaybackFrame } from './playback.js';
import type { WebTable } from './protocol.js';

export interface SoundPreferences { muted: boolean; volume: number }
export const SOUND_PREFERENCE_KEY = 'holdem.sound.v1';
export function soundPreferences(value: unknown): SoundPreferences {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { muted: typeof record.muted === 'boolean' ? record.muted : false,
    volume: typeof record.volume === 'number' && Number.isFinite(record.volume)
      ? Math.max(0, Math.min(1, record.volume)) : 0.4 };
}

/** Only the visible timeline: no precomputed future state and no character-reaction duplicates. */
export function frameSound(frame: Pick<PlaybackFrame, 'event' | 'reactionOnly'>): SoundCue | null {
  if (frame.reactionOnly) return null;
  const event = frame.event;
  switch (event.type) {
    case 'ownHoleCardsDealt': return 'deal';
    case 'communityCardsDealt':
    case 'holeCardsRevealed': return 'reveal';
    case 'blindPosted': return event.amount > 0 ? 'chips' : null;
    case 'uncalledBetReturned':
    case 'potAwarded': return 'payout';
    case 'playerActed':
      if (event.kind === 'fold') return 'fold';
      if (event.kind === 'check') return 'check';
      return event.paid > 0 ? event.allIn ? 'allIn' : 'chips' : null;
    default: return null;
  }
}

/** Call only after a successful, user-requested mutation and its visible playback, never sync/restore. */
export function boundarySound(previous: WebTable | null, next: WebTable): SoundCue | null {
  const same = previous?.id === next.id;
  if (same && next.packet.packetIndex <= previous.packet.packetIndex) return null;
  if (next.packet.kind === 'decision') {
    if (!same || previous.packet.kind !== 'decision' || previous.packet.decisionKey !== next.packet.decisionKey) return 'turn';
    return next.packet.privateEventsSinceLastPacket.length > 0 ? 'ability' : null;
  }
  if (next.packet.kind === 'hand-result') {
    if (same && previous.packet.kind === 'hand-result' && previous.packet.handNumber === next.packet.handNumber) return null;
    return (next.packet.handResult.seats.find(seat => seat.seatIndex === 0)?.net ?? 0) > 0 ? 'win' : null;
  }
  return next.packet.winnerSeatIndex === 0 ? 'win' : null;
}

interface SoundOptions {
  createContext(): AudioContext;
  load(file: string): Promise<ArrayBuffer>;
  hidden(): boolean;
  now(): number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  changed?(): void;
}
type SoundStatus = 'locked' | 'loading' | 'ready' | 'partial' | 'unavailable';

/** Best-effort presentation side effect: never waits on, mutates or retries a poker action. */
export class TableSound {
  preferences: SoundPreferences;
  status: SoundStatus = 'locked';
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private loading: Promise<boolean> | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Map<AudioBufferSourceNode, GainNode>();
  private readonly lastPlayed = new Map<SoundCue, number>();
  private readonly variants = new Map<SoundCue, number>();
  private generation = 0;
  private destroyed = false;
  private attemptedLoad = false;

  constructor(private readonly options: SoundOptions) {
    let saved: unknown;
    try { saved = JSON.parse(options.storage?.getItem(SOUND_PREFERENCE_KEY) ?? 'null'); } catch { /* Optional preference. */ }
    this.preferences = soundPreferences(saved);
  }
  get loadedCount(): number { return this.buffers.size; }
  private changed(): void { this.options.changed?.(); }
  private persist(): void {
    try { this.options.storage?.setItem(SOUND_PREFERENCE_KEY, JSON.stringify(this.preferences)); } catch { /* Still works in memory. */ }
    if (this.master) this.master.gain.value = this.preferences.muted ? 0 : this.preferences.volume;
    this.changed();
  }
  setMuted(muted: boolean): void {
    this.preferences = { ...this.preferences, muted };
    if (muted) this.stop();
    this.persist();
  }
  setVolume(volume: number): void {
    this.preferences = soundPreferences({ ...this.preferences, volume });
    if (this.preferences.volume === 0) this.stop();
    this.persist();
  }

  /** Must be entered from a real user gesture. Loading has no queue of historical cues. */
  async unlock(): Promise<boolean> {
    if (this.destroyed || this.preferences.muted || this.options.hidden()) return false;
    if (this.loading) return this.loading;
    try {
      if (!this.context) {
        this.context = this.options.createContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.preferences.volume;
        this.master.connect(this.context.destination);
      }
      const context = this.context;
      // Invoke resume synchronously within the gesture, before waiting for fetch/decode.
      const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
      if (this.attemptedLoad) {
        await resumed;
        const status = context.state !== 'running' ? 'locked' : this.buffers.size === SOUND_FILES.length ? 'ready'
          : this.buffers.size ? 'partial' : 'unavailable';
        if (status !== this.status) { this.status = status; this.changed(); }
        return !this.destroyed && context.state === 'running' && this.buffers.size > 0;
      }
      this.attemptedLoad = true;
      this.status = 'loading'; this.changed();
      this.loading = Promise.all([
        resumed,
        Promise.allSettled(SOUND_FILES.map(async file => {
          const buffer = await context.decodeAudioData(await this.options.load(file));
          if (!this.destroyed) this.buffers.set(file, buffer);
        })),
      ]).then(() => {
        if (this.destroyed) return false;
        this.status = context.state !== 'running' ? 'locked'
          : this.buffers.size === SOUND_FILES.length ? 'ready' : this.buffers.size ? 'partial' : 'unavailable';
        this.changed();
        return context.state === 'running' && this.buffers.size > 0;
      }).catch(() => {
        if (!this.destroyed) { this.status = 'unavailable'; this.changed(); }
        return false;
      }).finally(() => { this.loading = null; });
      return this.loading;
    } catch {
      this.status = 'unavailable'; this.changed();
      return false;
    }
  }

  play(cue: SoundCue | null): boolean {
    if (!cue || this.destroyed || this.preferences.muted || this.preferences.volume === 0 || this.options.hidden()
      || !this.context || this.context.state !== 'running' || !this.master) return false;
    const now = this.options.now();
    if (now - (this.lastPlayed.get(cue) ?? -Infinity) < 100) return false;
    const asset = SOUND_ASSETS[cue], variant = this.variants.get(cue) ?? 0;
    const buffer = this.buffers.get(asset.files[variant % asset.files.length]!);
    if (!buffer) return false; // Never play a late sound after its frame has passed.
    try {
      // Two short voices at most: high playback speeds must not build a wall of sound.
      if (this.voices.size >= 2) this.endVoice(this.voices.keys().next().value!);
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = buffer;
      gain.gain.value = asset.gain;
      source.connect(gain); gain.connect(this.master);
      source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
      this.voices.set(source, gain);
      source.start();
      this.lastPlayed.set(cue, now);
      this.variants.set(cue, variant + 1); // Presentation-only rotation; never consumes the game's RNG.
      return true;
    } catch { this.stop(); return false; }
  }
  private endVoice(source: AudioBufferSourceNode): void {
    const gain = this.voices.get(source);
    this.voices.delete(source);
    source.onended = null;
    try { source.stop(); } catch { /* Already ended. */ }
    source.disconnect(); gain?.disconnect();
  }
  stop(): void {
    this.generation++;
    for (const source of this.voices.keys()) this.endVoice(source);
  }
  async preview(): Promise<void> {
    const generation = this.generation;
    if (await this.unlock() && generation === this.generation) this.play('turn');
  }
  destroy(): void {
    this.destroyed = true; this.stop(); this.buffers.clear();
    void this.context?.close().catch(() => {});
  }
}

export function installSoundControls(doc: Document, win: Window, refreshLabels: () => void): TableSound | null {
  const toggle = doc.querySelector<HTMLButtonElement>('#sound-toggle');
  const volume = doc.querySelector<HTMLInputElement>('#sound-volume');
  const preview = doc.querySelector<HTMLButtonElement>('#sound-preview');
  const label = doc.querySelector('#sound-label'), status = doc.querySelector('#sound-status');
  if (!toggle || !volume || !preview || !label || !status) return null;
  let storage: Storage | undefined;
  try { storage = win.localStorage; } catch { /* Private/blocked storage is optional. */ }
  const audioWindow = win as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const sound = new TableSound({
    createContext() {
      const Context = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
      if (!Context) throw new Error('Web Audio unavailable');
      return new Context();
    },
    async load(file) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(new URL('./audio/' + file, doc.baseURI), { signal: controller.signal });
        if (!response.ok) throw new Error('Sound unavailable');
        return await response.arrayBuffer();
      } finally { clearTimeout(timeout); }
    },
    hidden: () => doc.hidden, now: () => performance.now(), storage,
    changed: () => render(),
  });
  function render(): void {
    const { muted, volume: level } = sound.preferences;
    label!.textContent = muted ? '音效：关' : '音效：开';
    toggle!.textContent = muted ? '开启音效' : '静音';
    toggle!.setAttribute('aria-pressed', String(!muted));
    volume!.value = String(Math.round(level * 100));
    status!.textContent = muted ? '已静音' : level === 0 ? '音量为零' : sound.status === 'locked' ? '点击或按键后播放'
      : sound.status === 'loading' ? '正在加载音效…' : sound.status === 'unavailable' ? '音效暂不可用，不影响打牌。'
      : sound.status === 'partial' ? '部分音效不可用，其余可继续播放。' : '音效就绪';
    refreshLabels();
  }
  const gesture = (event: Event) => { if (event.isTrusted) void sound.unlock(); };
  win.addEventListener('pointerdown', gesture, { capture: true });
  win.addEventListener('keydown', gesture, { capture: true });
  toggle.addEventListener('click', () => {
    sound.setMuted(!sound.preferences.muted);
    if (!sound.preferences.muted) void sound.unlock();
  });
  volume.addEventListener('input', () => sound.setVolume(Number(volume.value) / 100));
  preview.addEventListener('click', () => { sound.setMuted(false); void sound.preview(); });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) sound.stop(); });
  win.addEventListener('pagehide', () => {
    win.removeEventListener('pointerdown', gesture, { capture: true });
    win.removeEventListener('keydown', gesture, { capture: true });
    sound.destroy();
  }, { once: true });
  render();
  return sound;
}
