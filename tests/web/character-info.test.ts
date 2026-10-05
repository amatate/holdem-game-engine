import { afterEach, expect, it, vi } from 'vitest';
import { installCharacterInfo } from '../../src/web/character-info.js';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function rig() {
  vi.useFakeTimers();
  class Surface extends EventTarget {
    id = 'character-tooltip'; hidden = true; innerHTML = ''; isConnected = true;
    style = { left: '', top: '' }; dataset: Record<string, string> = {};
    attrs = new Map<string, string>();
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    removeAttribute(k: string) { this.attrs.delete(k); }
    closest() { return this.dataset.characterInfo ? this : null; }
    contains(value: unknown) { return value === this; }
    getBoundingClientRect() { return this.dataset.characterInfo ? { left: 340, width: 64, bottom: 790 } : { width: 290, height: 400 }; }
  }
  vi.stubGlobal('Element', Surface); vi.stubGlobal('Node', Surface);
  const panel = new Surface(), button = new Surface(); button.dataset.characterInfo = 'profile-1';
  const doc = Object.assign(new EventTarget(), { querySelector: () => panel,
    getElementById: () => ({ innerHTML: '<h2>Public profile</h2>' }) });
  const win = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844, setTimeout, clearTimeout });
  const changed = vi.fn();
  const controller = installCharacterInfo(doc as unknown as Document, win as unknown as Window, changed)!;
  function event(type: string, target: Surface = button, extra: Record<string, unknown> = {}) {
    const e = new Event(type);
    for (const [key, value] of Object.entries({ target, ...extra })) Object.defineProperty(e, key, { value });
    doc.dispatchEvent(e);
  }
  return { panel, button, controller, changed, event, outside: new Surface() };
}
it('opens on hover, clamps to the phone viewport, and lets the pointer enter the card', () => {
  const r = rig(); r.event('pointerover', r.button, { pointerType: 'mouse' });
  expect(r.panel.hidden).toBe(false); expect(r.panel.innerHTML).toContain('Public profile');
  expect(r.panel.style).toEqual({ left: '92px', top: '436px' });
  expect(r.button.attrs.get('aria-describedby')).toBe('character-tooltip');
  r.event('pointerout'); r.panel.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(300);
  expect(r.panel.hidden).toBe(false);
  r.panel.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(300); expect(r.panel.hidden).toBe(true);
});
it('supports focus, Escape, touch toggle, outside click and safe reset on redraw', () => {
  const r = rig(); r.event('focusin'); expect(r.panel.hidden).toBe(false);
  r.event('keydown', r.button, { key: 'Escape' }); expect(r.panel.hidden).toBe(true);
  r.event('pointerover', r.button, { pointerType: 'touch' }); expect(r.panel.hidden).toBe(true);
  r.event('click'); expect(r.panel.hidden).toBe(false); r.event('click'); expect(r.panel.hidden).toBe(true);
  r.event('click'); r.event('click', r.outside); expect(r.panel.hidden).toBe(true);
  r.event('focusin'); r.controller.close(); expect(r.panel.hidden).toBe(true);
  expect(r.button.attrs.has('aria-describedby')).toBe(false);
});
