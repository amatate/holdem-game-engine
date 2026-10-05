import { cardFace } from './poker-cards.js';
import type { Card } from '../core/types.js';

export const DECK_SKINS = [
  { id:'night', name:'夜局', description:'紫金像素 · 原版', atlas:null },
  { id:'lantern', name:'红馆', description:'红白线雕 · 灯与藤蔓', atlas:'deck-lantern-v1.png' },
  { id:'blue-hour', name:'蓝调', description:'靛蓝唱片 · 留声机', atlas:'deck-blue-hour-v1.png' },
  { id:'jade', name:'翡翠', description:'绿金植物 · 银杏', atlas:'deck-jade-v1.png' },
  { id:'ghost', name:'幽影', description:'黑幽灵 I 致敬 · 银白蚀刻', atlas:'deck-ghost-v1.png' },
] as const;
export type DeckSkinId = typeof DECK_SKINS[number]['id'];
export interface DeckPreference { face:DeckSkinId; back:DeckSkinId; followScene:boolean }
export const DECK_PREFERENCE_KEY = 'holdem.deck-style.v1';
const DEFAULT: DeckPreference = { face:'night', back:'night', followScene:false };
export function isDeckSkin(value: unknown): value is DeckSkinId {
  return DECK_SKINS.some(skin => skin.id === value);
}
export function readDeckPreference(raw: string | null): DeckPreference {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<DeckPreference> | null;
    if (value && isDeckSkin(value.face) && isDeckSkin(value.back) && typeof value.followScene === 'boolean') {
      return { face:value.face, back:value.back, followScene:value.followScene };
    }
  } catch { /* A cosmetic preference is optional, not a game-save error. */ }
  return { ...DEFAULT };
}
export function resolveDeckStyle(preference: DeckPreference, scene: unknown): Pick<DeckPreference, 'face' | 'back'> {
  return preference.followScene && isDeckSkin(scene) ? { face:scene, back:scene }
    : { face:preference.face, back:preference.back };
}
// Fixed samples, never the current hand or hidden NPC cards.
const SAMPLE_CARDS: readonly Card[] = [
  { code:'As', rank:14, suit:'s' }, { code:'Kh', rank:13, suit:'h' }, { code:'Td', rank:10, suit:'d' },
];
export function renderDeckGallery(): string {
  return DECK_SKINS.map(skin => `<button type="button" class="deck-preset" data-deck-preset="${skin.id}" aria-pressed="false">
    <span class="deck-pair" data-card-face="${skin.id}" data-card-back="${skin.id}" aria-hidden="true">${cardFace(null)}${cardFace(SAMPLE_CARDS[1]!)}</span>
    <strong>${skin.name}</strong><small>${skin.description}</small></button>`).join('');
}

/** Cosmetic only: no game redraw, command, RNG or checkpoint write.
 * A level may supply a PUBLIC preset through setSceneDeck. */
export function installDeckSkins(doc: Document, win: Window, changed: () => void): { setSceneDeck(id:DeckSkinId): void } | null {
  const open = doc.querySelector<HTMLButtonElement>('#deck-open');
  const dialog = doc.querySelector<HTMLDialogElement>('#deck-dialog');
  const gallery = doc.querySelector<HTMLElement>('#deck-gallery');
  const preview = doc.querySelector<HTMLElement>('#deck-preview');
  const face = doc.querySelector<HTMLSelectElement>('#deck-face');
  const back = doc.querySelector<HTMLSelectElement>('#deck-back');
  const follow = doc.querySelector<HTMLInputElement>('#deck-follow-scene');
  const sceneLabel = doc.querySelector<HTMLElement>('#deck-scene-name');
  if (!open || !dialog || !gallery || !preview || !face || !back || !follow || !sceneLabel) return null;
  let storage: Storage | undefined;
  let preference = { ...DEFAULT };
  try { storage = win.localStorage; preference = readDeckPreference(storage.getItem(DECK_PREFERENCE_KEY)); } catch { /* Private mode still works. */ }
  let scene: DeckSkinId = 'night';
  gallery.innerHTML = renderDeckGallery();
  const options = DECK_SKINS.map(skin => `<option value="${skin.id}">${skin.name}</option>`).join('');
  face.innerHTML = options; back.innerHTML = options;
  preview.innerHTML = `${SAMPLE_CARDS.map(card => cardFace(card)).join('')}${cardFace(null)}`;
  const render = () => {
    const style = resolveDeckStyle(preference, scene);
    doc.documentElement.dataset.cardFace = style.face;
    doc.documentElement.dataset.cardBack = style.back;
    face.value = style.face; back.value = style.back;
    follow.checked = preference.followScene;
    sceneLabel.textContent = DECK_SKINS.find(skin => skin.id === scene)!.name;
    for (const button of gallery.querySelectorAll<HTMLButtonElement>('[data-deck-preset]')) {
      button.setAttribute('aria-pressed', String(style.face === button.dataset.deckPreset && style.back === button.dataset.deckPreset));
    }
    changed();
  };
  const saveAndRender = () => {
    try { storage?.setItem(DECK_PREFERENCE_KEY, JSON.stringify(preference)); } catch { /* Apply even if persistence fails. */ }
    render();
  };
  for (const button of gallery.querySelectorAll<HTMLButtonElement>('[data-deck-preset]')) {
    button.addEventListener('click', () => {
      const id = button.dataset.deckPreset;
      if (!isDeckSkin(id)) return;
      preference = { face:id, back:id, followScene:false }; saveAndRender();
    });
  }
  for (const [control, part] of [[face,'face'],[back,'back']] as const) {
    control.addEventListener('change', () => {
      if (!isDeckSkin(control.value)) return;
      preference = { ...resolveDeckStyle(preference, scene), [part]:control.value, followScene:false }; saveAndRender();
    });
  }
  follow.addEventListener('change', () => {
    preference = { ...preference, followScene:follow.checked }; saveAndRender();
  });
  open.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); });
  doc.querySelector('#deck-close')?.addEventListener('click', () => dialog.close());
  // Native dialog handles focus trapping, Escape and returning focus to the trigger.
  render();
  return { setSceneDeck(id) {
    if (!isDeckSkin(id) || scene === id) return;
    scene = id; render();
  } };
}
