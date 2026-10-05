export const MUSIC_FILE = 'cool-vibes-v1.mp3';
export const MUSIC_KEY = 'holdem.music.v1';
type MusicStatus = 'off' | 'waiting' | 'playing' | 'paused' | 'error';
type MusicAudio = Pick<HTMLAudioElement, 'loop' | 'preload' | 'volume' | 'play' | 'pause'>;
export class TableMusic {
  enabled = false;
  volume = 0.2;
  status: MusicStatus = 'off';
  #audio: MusicAudio | null = null;
  #generation = 0;
  #unlocked = false;
  constructor(private readonly options: { audio: () => MusicAudio; hidden: () => boolean;
    storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined; changed: () => void }) {
    try {
      const p = JSON.parse(options.storage?.getItem(MUSIC_KEY) ?? 'null');
      this.enabled = p?.enabled === true;
      if (typeof p?.volume === 'number' && Number.isFinite(p.volume)) this.volume = Math.min(1, Math.max(0, p.volume));
    } catch { /* Music must never block a hand. */ }
    this.status = this.enabled ? 'waiting' : 'off';
  }
  #notify() {
    try { this.options.storage?.setItem(MUSIC_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); } catch { /* Optional. */ }
    this.options.changed();
  }
  async unlock(): Promise<void> {
    if (this.#unlocked) return;
    this.#unlocked = true;
    if (this.enabled) await this.#play();
  }
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) { this.#generation++; this.#audio?.pause(); this.status = 'off'; this.#notify(); return; }
    // Called by the explicit music button (a trusted user gesture).
    this.#unlocked = true;
    await this.#play();
  }
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.#audio) this.#audio.volume = this.volume;
    this.#notify();
  }
  async #play(): Promise<void> {
    const generation = ++this.#generation;
    if (!this.enabled || this.options.hidden() || !this.#unlocked) { this.status = this.enabled ? 'paused' : 'off'; this.#notify(); return; }
    try {
      this.#audio ??= this.options.audio();
      this.#audio.preload = 'none'; this.#audio.loop = true; this.#audio.volume = this.volume;
      this.status = 'waiting'; this.#notify();
      await this.#audio.play();
      if (!this.enabled || this.options.hidden()) this.#audio.pause();
      if (generation !== this.#generation) return;
      this.status = this.options.hidden() ? 'paused' : 'playing';
    } catch {
      if (generation !== this.#generation) return;
      this.#audio?.pause(); this.enabled = false; this.status = 'error';
    }
    this.#notify();
  }
  visibility(): void {
    if (this.options.hidden()) { this.#generation++; this.#audio?.pause(); this.status = this.enabled ? 'paused' : 'off'; this.#notify(); }
    else if (this.enabled && this.#unlocked) void this.#play();
  }
  stop(): void { this.#generation++; this.#audio?.pause(); }
}

export function installMusicControls(doc: Document, win: Window, changed: () => void): TableMusic | null {
  const toggle = doc.querySelector<HTMLButtonElement>('#music-toggle');
  const volume = doc.querySelector<HTMLInputElement>('#music-volume');
  const label = doc.querySelector<HTMLElement>('#music-label');
  const status = doc.querySelector<HTMLElement>('#music-status');
  if (!toggle || !volume || !label || !status) return null;
  let storage: Storage | undefined;
  try { storage = win.localStorage; } catch { /* Optional. */ }
  const render = () => {
    toggle.textContent = music.enabled ? '关闭音乐' : '播放音乐'; toggle.setAttribute('aria-pressed', String(music.enabled));
    volume.value = String(Math.round(music.volume * 100)); label.textContent = music.enabled ? '音乐：开' : '音乐：关';
    status.textContent = { off: '轻柔爵士 · 点击播放', waiting: '等待播放', playing: '正在播放 Cool Vibes',
      paused: '已暂停 · 返回页面后继续', error: '音乐暂未播放，点击重试；不影响牌局。' }[music.status];
    changed();
  };
  const music = new TableMusic({ audio: () => {
    const audio = doc.createElement('audio'); audio.src = new URL('./audio/' + MUSIC_FILE, doc.baseURI).href; return audio;
  }, hidden: () => doc.hidden, storage, changed: render });
  toggle.addEventListener('click', () => { void music.setEnabled(!music.enabled); });
  volume.addEventListener('input', () => music.setVolume(Number(volume.value) / 100));
  const unlock = (event: Event) => { if (event.isTrusted) void music.unlock(); };
  doc.addEventListener('pointerdown', unlock, { passive: true }); doc.addEventListener('keydown', unlock);
  doc.addEventListener('visibilitychange', () => music.visibility());
  win.addEventListener('pagehide', () => music.stop());
  win.addEventListener('pageshow', () => music.visibility());
  render(); return music;
}
