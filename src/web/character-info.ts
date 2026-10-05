/** Only reads renderer-projected public text. No engine, packet, or private card access. */
export function installCharacterInfo(doc: Document, win: Window, changed: () => void) {
  const panel = doc.querySelector<HTMLElement>('#character-tooltip');
  if (!panel) return null;
  let anchor: HTMLButtonElement | null = null, timer = 0, pinned = false;
  const cancel = () => win.clearTimeout(timer);
  const close = () => {
    cancel(); anchor?.setAttribute('aria-expanded', 'false'); anchor?.removeAttribute('aria-describedby');
    anchor = null; pinned = false; panel.hidden = true;
  };
  const position = () => {
    if (!anchor?.isConnected) { close(); return; }
    const r = anchor.getBoundingClientRect(), p = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(win.innerWidth - p.width - 8, r.left + r.width / 2 - p.width / 2))}px`;
    panel.style.top = `${Math.max(8, Math.min(win.innerHeight - p.height - 8, r.bottom + 8))}px`;
  };
  const show = (button: HTMLButtonElement) => {
    cancel();
    if (anchor !== button) {
      close();
      const template = doc.getElementById(button.dataset.characterInfo!) as HTMLTemplateElement | null;
      if (!template) return;
      anchor = button; panel.innerHTML = template.innerHTML; panel.hidden = false;
      button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-describedby', panel.id);
      changed();
    }
    position();
  };
  const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-character-info]') : null);
  const leave = () => { if (!pinned) { cancel(); timer = win.setTimeout(close, 180); } };
  doc.addEventListener('pointerover', event => { const button = target(event); if (button && event.pointerType !== 'touch') show(button); });
  doc.addEventListener('pointerout', event => { if (target(event)) leave(); });
  doc.addEventListener('focusin', event => { const button = target(event); if (button) show(button); });
  doc.addEventListener('focusout', event => { if (target(event)) leave(); });
  doc.addEventListener('click', event => {
    const button = target(event);
    if (button) { if (anchor === button && pinned) close(); else { show(button); pinned = true; } }
    else if (!(event.target instanceof Node && panel.contains(event.target))) close();
  });
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  doc.addEventListener('change', event => { if (event.target instanceof Element && event.target.id === 'language') close(); });
  panel.addEventListener('pointerenter', cancel); panel.addEventListener('pointerleave', leave);
  win.addEventListener('resize', position); win.addEventListener('scroll', close, true);
  return { close };
}
