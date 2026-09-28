import { EN_MESSAGES, EN_TEMPLATES } from './i18n-catalog.js';

export type Locale = 'zh-CN' | 'en';
const han = /[\p{Script=Han}]/u;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entries = [...EN_MESSAGES, ...EN_TEMPLATES].sort((a, b) => b[0].length - a[0].length);
const pattern = new RegExp(entries.map(([source], index) => {
  const body = source.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part)
    ? `(?<e${index}_${part.slice(1, -1)}>[+-]?\\d[\\d,]*(?:\\.\\d+)?)`
    : escapePattern(part)).join('');
  return `(?<e${index}>${body})`;
}).join('|'), 'gu');
const initials: Record<string, string> = { 岚: 'L', 凯: 'K', 叔: 'M', 周: 'Z', 墨: 'C', 蔓: 'S', 烈: 'H' };

/** Text in, text out. The result must only enter text nodes/allowlisted labels, never innerHTML. */
export function translateText(text: string, locale: Locale): string {
  if (locale === 'zh-CN' || !han.test(text)) return text;
  if (initials[text.trim()]) return text.replace(text.trim(), initials[text.trim()]!);
  return text.replace(pattern, (...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    const key = Object.keys(groups).find(key => !key.includes('_') && groups[key] !== undefined)!;
    const translation = entries[Number(key.slice(1))]![1];
    return translation.replace(/\{(\d+)\}/g, (_, slot: string) => groups[`${key}_${slot}`]!);
  }).replaceAll('，', ', ').replaceAll('。', '. ').replaceAll('：', ': ')
    .replaceAll('；', '; ').replaceAll('、', ', ').replaceAll('（', ' (').replaceAll('）', ')')
    .replaceAll('／', ' / ').replaceAll('「', '“').replaceAll('」', '”');
}

export function chooseLocale(query: string | null, saved: string | null, browserLanguage: string): Locale {
  for (const candidate of [query, saved]) {
    if (candidate === 'en') return 'en';
    if (candidate === 'zh' || candidate === 'zh-CN') return 'zh-CN';
  }
  return /^zh(?:-|$)/i.test(browserLanguage) ? 'zh-CN' : 'en';
}

export interface TextSlot { source: string; rendered: string }
/** Preserve the exact Chinese source while accepting fresh text from subsequent renders. */
export function projectSlot(current: string, previous: TextSlot | undefined, locale: Locale): TextSlot {
  const source = previous && current === previous.rendered ? previous.source : current;
  return { source, rendered: translateText(source, locale) };
}

/**
 * A display projection, not a second game state. Switching never recreates controls,
 * sends requests, changes a command value, restarts playback or touches the checkpoint.
 */
export function installLocalization(doc: Document, win: Window): { refresh(): void } {
  // Headless IO-only client tests do not implement a DOM; browser tests cover the real tree.
  if (typeof doc.createTreeWalker !== 'function') return { refresh() {} };
  const control = doc.querySelector<HTMLSelectElement>('#language');
  const texts = new WeakMap<Node, TextSlot>();
  const attributes = new WeakMap<Element, Map<string, TextSlot>>();
  let saved: string | null = null;
  try { saved = win.localStorage.getItem('holdem.locale'); } catch { /* Preference is optional. */ }
  let locale = chooseLocale(new URL(win.location.href).searchParams.get('lang'), saved, win.navigator.language);
  const refresh = () => {
    doc.documentElement.lang = locale;
    if (control) control.value = locale;
    // Numeric constants avoid relying on global NodeFilter in alternate DOM implementations.
    const walker = doc.createTreeWalker(doc.documentElement, 4);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('script,style,textarea,[data-no-i18n]')) continue;
      const slot = projectSlot(node.nodeValue ?? '', texts.get(node), locale);
      if (node.nodeValue !== slot.rendered) node.nodeValue = slot.rendered;
      texts.set(node, slot);
    }
    for (const element of doc.querySelectorAll('[aria-label],[title],[placeholder],[alt],meta[name="description"]')) {
      if (element.closest('[data-no-i18n]')) continue;
      let slots = attributes.get(element);
      if (!slots) { slots = new Map(); attributes.set(element, slots); }
      for (const name of ['aria-label', 'title', 'placeholder', 'alt', ...(element.matches('meta[name="description"]') ? ['content'] : [])]) {
        const current = element.getAttribute(name);
        if (current === null) continue;
        const slot = projectSlot(current, slots.get(name), locale);
        if (current !== slot.rendered) element.setAttribute(name, slot.rendered);
        slots.set(name, slot);
      }
    }
  };
  control?.addEventListener('change', () => {
    locale = control.value === 'en' ? 'en' : 'zh-CN';
    try { win.localStorage.setItem('holdem.locale', locale); } catch { /* Still switches in memory. */ }
    const url = new URL(win.location.href);
    url.searchParams.set('lang', locale === 'en' ? 'en' : 'zh');
    try { win.history.replaceState(null, '', url); } catch { /* Optional shareable URL. */ }
    refresh();
  });
  refresh();
  return { refresh };
}
