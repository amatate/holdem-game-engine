import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DECK_SKINS, DECK_PREFERENCE_KEY, installDeckSkins, isDeckSkin, readDeckPreference, renderDeckGallery, resolveDeckStyle } from '../../src/web/deck-skins.js';
import { translateText } from '../../src/web/i18n.js';

function rig(raw:string | null = null, blocked = false) {
  class Surface extends EventTarget {
    innerHTML = ''; textContent = ''; value = ''; checked = false; open = false;
    dataset:Record<string,string> = {};
    attrs = new Map<string,string>();
    buttons:Surface[] = [];
    showModal = vi.fn(() => { this.open = true; });
    close = vi.fn(() => { this.open = false; });
    setAttribute(k:string,v:string) { this.attrs.set(k,v); }
    querySelectorAll() { return this.buttons; }
  }
  const controls = Object.fromEntries(['deck-open','deck-close','deck-dialog','deck-gallery','deck-preview','deck-face','deck-back','deck-follow-scene','deck-scene-name'].map(id => [id,new Surface()]));
  const gallery = controls['deck-gallery']!;
  gallery.buttons = DECK_SKINS.map(skin => { const button = new Surface(); button.dataset.deckPreset = skin.id; return button; });
  const root = new Surface();
  const doc = { documentElement:root, querySelector:(selector:string) => controls[selector.slice(1)] };
  const storage = { getItem:vi.fn((_key:string) => raw), setItem:vi.fn((_key:string,_value:string) => { if (blocked) throw new Error('Disabled'); }) };
  const win = { get localStorage() { if (blocked) throw new Error('Disabled'); return storage; } };
  const changed = vi.fn();
  const controller = installDeckSkins(doc as unknown as Document, win as unknown as Window, changed)!;
  const event = (id:string,type:string,value?:string) => {
    if (value !== undefined) controls[id]!.value = value;
    controls[id]!.dispatchEvent(new Event(type));
  };
  return { controls, gallery, root, storage, controller, event, changed };
}

describe('cosmetic deck skins', () => {
  it.each([null, '', '{bad', 'null','[]','{}','{"face":"../../private","back":"jade","followScene":true}','{"face":"jade","back":"night","followScene":"yes"}'])('ignores invalid preference %s', raw => {
    expect(readDeckPreference(raw)).toEqual({face:'night',back:'night',followScene:false});
  });
  it('keeps every manual face/back combination across scene changes', () => {
    for (const face of DECK_SKINS) for (const back of DECK_SKINS) for (const scene of DECK_SKINS) {
      expect(resolveDeckStyle({face:face.id,back:back.id,followScene:false},scene.id)).toEqual({face:face.id,back:back.id});
      expect(resolveDeckStyle({face:face.id,back:back.id,followScene:true},scene.id)).toEqual({face:scene.id,back:scene.id});
    }
    expect(isDeckSkin('__proto__')).toBe(false);
    expect(resolveDeckStyle({face:'jade',back:'lantern',followScene:true},'unknown')).toEqual({face:'jade',back:'lantern'});
  });
  it('defaults to the existing deck without writing storage', () => {
    const r = rig();
    expect(r.root.dataset).toEqual({cardFace:'night',cardBack:'night'});
    expect(r.storage.setItem).not.toHaveBeenCalled();
    expect(r.controls['deck-preview']!.innerHTML).toContain('aria-label="10♦"');
    expect(r.controls['deck-preview']!.innerHTML).not.toContain('card-from-hole');
  });
  it('applies a preset, supports mixing, and writes only the cosmetic preference key', () => {
    const r = rig();
    r.gallery.buttons[1]!.dispatchEvent(new Event('click'));
    expect(r.root.dataset).toEqual({cardFace:'lantern',cardBack:'lantern'});
    expect(r.gallery.buttons[1]!.attrs.get('aria-pressed')).toBe('true');
    r.event('deck-back','change','jade');
    expect(r.root.dataset).toEqual({cardFace:'lantern',cardBack:'jade'});
    expect(r.gallery.buttons.every(button => button.attrs.get('aria-pressed') === 'false')).toBe(true);
    expect(r.storage.setItem.mock.calls.every(call => call[0] === DECK_PREFERENCE_KEY)).toBe(true);
    r.controller.setSceneDeck('blue-hour');
    expect(r.root.dataset.cardBack).toBe('jade');
    const stored = r.storage.setItem.mock.calls.at(-1)!;
    expect(readDeckPreference(stored[1])).toEqual({face:'lantern',back:'jade',followScene:false});
  });
  it('follows public scene presets only when opted in, without saving on redraw', () => {
    const r = rig(JSON.stringify({face:'jade',back:'night',followScene:true}));
    r.controller.setSceneDeck('blue-hour');
    expect(r.root.dataset).toEqual({cardFace:'blue-hour',cardBack:'blue-hour'});
    expect(r.storage.setItem).not.toHaveBeenCalled();
    r.controls['deck-follow-scene']!.checked = false; r.event('deck-follow-scene','change');
    expect(r.root.dataset).toEqual({cardFace:'jade',cardBack:'night'});
    r.event('deck-face','change','lantern');
    expect(r.controls['deck-follow-scene']!.checked).toBe(false);
  });
  it('works with unavailable storage and supports native modal opening/closing', () => {
    const r = rig(null,true);
    r.event('deck-face','change','jade');
    expect(r.root.dataset.cardFace).toBe('jade');
    r.event('deck-open','click'); r.event('deck-open','click');
    expect(r.controls['deck-dialog']!.showModal).toHaveBeenCalledTimes(1);
    r.event('deck-close','click');
    expect(r.controls['deck-dialog']!.open).toBe(false);
  });
  it('keeps the currently visible back when overriding only the face of a scene deck', () => {
    const r = rig(JSON.stringify({face:'night',back:'night',followScene:true}));
    r.controller.setSceneDeck('blue-hour');
    r.event('deck-face','change','jade');
    expect(r.root.dataset).toEqual({cardFace:'jade',cardBack:'blue-hour'});
    expect(r.controls['deck-follow-scene']!.checked).toBe(false);
  });
  it('ignores unsupported control values rather than using them as asset URLs', () => {
    const r = rig();
    r.event('deck-face','change','url(https://outside.example/card)');
    expect(r.root.dataset.cardFace).toBe('night');
    expect(r.storage.setItem).not.toHaveBeenCalled();
  });
  it('restores and mixes the dark tribute deck without changing existing defaults', () => {
    const r = rig(JSON.stringify({face:'ghost',back:'ghost',followScene:false}));
    expect(r.root.dataset).toEqual({cardFace:'ghost',cardBack:'ghost'});
    r.controller.setSceneDeck('lantern');
    expect(r.root.dataset.cardFace).toBe('ghost');
    r.event('deck-back','change','jade');
    expect(r.root.dataset).toEqual({cardFace:'ghost',cardBack:'jade'});
    r.event('deck-face','change','night');
    expect(r.root.dataset).toEqual({cardFace:'night',cardBack:'jade'});
    expect(readDeckPreference(null)).toEqual({face:'night',back:'night',followScene:false});
  });
  it('translates the picker and references local, versioned two-panel atlases', () => {
    const index = readFileSync(new URL('../../src/web/index.html', import.meta.url),'utf8');
    const dialog = index.slice(index.indexOf('<dialog id="deck-dialog"'),index.indexOf('</dialog>',index.indexOf('<dialog id="deck-dialog"')));
    const html = dialog + renderDeckGallery();
    const texts = [...html.matchAll(/>([^<>]*)</g),...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].map(match => match[1]!);
    expect(texts.map(text => translateText(text,'en')).filter(text => /[\p{Script=Han}]/u.test(text))).toEqual([]);
    const css = readFileSync(new URL('../../src/web/deck-skins.css', import.meta.url),'utf8');
    for (const {atlas} of DECK_SKINS) {
      if (!atlas) continue;
      const png = readFileSync(new URL('../../src/web/art/'+atlas, import.meta.url));
      expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
      expect(png.readUInt32BE(16)/png.readUInt32BE(20)).toBeCloseTo(10/7,2);
      expect(css).toContain(`url('/art/${atlas}')`);
    }
  });
});
