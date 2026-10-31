// Accessibility layer (Phase 34). One observer gives every control its accessible name and role without each view
// repeating them; keyboard helpers (popover arrows, dialog focus trap, tab arrows), a polite live region, the Timeline's
// description and the commands that move the selected block live here too. It only sets attributes and focus.
import './../styles/a11y.css';
import type { Engine } from '../engine/engine';
import { end, locate } from '../engine/model';
import * as ops from '../engine/ops';
import { timecode } from '../engine/time';
import type { Command } from './commands';
import { t } from './i18n';

/** True when the person asked their system for less motion. */
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let live: HTMLElement | null = null;
let flip = false;

/** Says `text` to assistive technology without showing it. */
export function announce(text: string): void {
  if (!live) return;
  flip = !flip;
  live.textContent = flip ? text : `${text}​`;
}

let keyboardLast = false;
const AUTO = 'data-a11y-auto';

const textOf = (n: Element): string => (n.textContent ?? '').trim();

/** Names an icon-only control from its tooltip (already in the current language) or placeholder. */
function nameIt(n: HTMLElement): void {
  const auto = n.hasAttribute(AUTO);
  if (n.hasAttribute('aria-labelledby') || (n.hasAttribute('aria-label') && !auto)) return;
  const isBtn = n.tagName === 'BUTTON' || n.getAttribute('role') === 'button' || n.getAttribute('role') === 'menuitem' || n.getAttribute('role') === 'tab';
  const isField = n.tagName === 'INPUT' || n.tagName === 'SELECT' || n.tagName === 'TEXTAREA';
  if (isBtn && !auto && textOf(n)) return;
  if (isField && !auto && ((n as HTMLInputElement).labels?.length || n.closest('label'))) return;
  const name = n.getAttribute('title') || n.getAttribute('data-tip') || (isField ? n.getAttribute('placeholder') : '') || '';
  if (!name) return;
  if (n.getAttribute('aria-label') !== name) n.setAttribute('aria-label', name);
  n.setAttribute(AUTO, '');
}

const SELECTOR = 'button, [role="button"], [role="tab"], input, select, textarea';

function roles(n: HTMLElement): void {
  if (n.classList.contains('cv-menubar')) n.setAttribute('role', 'menubar');
  if (n.classList.contains('cv-menu-btn')) { n.setAttribute('role', 'menuitem'); if (!n.hasAttribute('aria-expanded')) n.setAttribute('aria-expanded', 'false'); }
  if (n.classList.contains('cv-tt-btn') || n.classList.contains('cv-st-btn')) {
    const p = n.parentElement;
    if (p && !p.hasAttribute('role')) { p.setAttribute('role', 'toolbar'); p.setAttribute('aria-label', t(n.classList.contains('cv-tt-btn') ? 'Window tools' : 'Status tools')); }
  }
  if (n.classList.contains('cv-dialog')) {
    const title = n.querySelector<HTMLElement>('.cv-dialog-title');
    if (title) { if (!title.id) title.id = `fm-dlg-${Math.random().toString(36).slice(2, 8)}`; n.setAttribute('aria-labelledby', title.id); }
  }
  if (n.classList.contains('fm-pop') && !n.hasAttribute('role')) { n.setAttribute('role', 'group'); n.setAttribute('aria-label', t('Options')); }
  if (n.classList.contains('fm-pop-row') && n.tagName === 'BUTTON' && !n.hasAttribute('role')) n.setAttribute('role', 'menuitem');
  if (n.classList.contains('cv-tabs') && !n.hasAttribute('role')) { n.setAttribute('role', 'tablist'); if (!n.hasAttribute('aria-label')) n.setAttribute('aria-label', t('Movies')); }
  if (n.classList.contains('cv-st-bar') && !n.hasAttribute('aria-label')) n.setAttribute('aria-label', t('Progress'));
  if (n.classList.contains('cv-tab') && !n.hasAttribute('role')) n.setAttribute('role', 'tab');
  if (n.classList.contains('cv-home-main') && !n.hasAttribute('role')) { n.setAttribute('role', 'main'); n.setAttribute('aria-label', t('Movies')); }
  // The Home navigation is one tab stop; arrows move inside it (see onKey).
  if (n.classList.contains('cv-home-nav') && !n.hasAttribute('data-rove')) {
    n.setAttribute('data-rove', '');
    const items = Array.from(n.querySelectorAll<HTMLElement>('.cv-home-nav-item, .cv-home-brand'));
    const stop = n.querySelector<HTMLElement>('.cv-home-nav-item.is-active') ?? items[0];
    for (const i of items) i.tabIndex = i === stop ? 0 : -1;
    n.addEventListener('focusin', (e) => { const f = e.target; if (f instanceof HTMLElement && items.includes(f)) for (const i of items) i.tabIndex = i === f ? 0 : -1; });
  }
  if (n.classList.contains('fm-tl-tracks')) {
    n.tabIndex = 0;
    n.setAttribute('role', 'application');
    n.setAttribute('aria-roledescription', t('Timeline grid'));
    n.setAttribute('aria-label', t('Tracks'));
    n.setAttribute('aria-describedby', 'fm-tl-desc');
  }
}

/** What lies under a full-screen view (Home, Draw & Paint) cannot take focus while that view shows. */
function syncInert(): void {
  const home = document.querySelector<HTMLElement>('.cv-home'), paint = document.querySelector<HTMLElement>('.fm-paint');
  const homeOn = !!home && !home.hidden, paintOn = !!paint && !paint.hidden;
  const set = (sel: string, on: boolean): void => { for (const n of Array.from(document.querySelectorAll<HTMLElement>(sel))) if (n.inert !== on) n.inert = on; };
  // Home sits inside the Stage's wrapper, so under Home only the wrapper's other children and the rest are inert.
  set('.cv-main > :not(.fm-paint):not(.fm-stage-wrap):not(.cv-drop), .cv-status', homeOn || paintOn);
  set('.cv-main > .fm-stage-wrap', paintOn && !homeOn);
  set('.cv-main > .fm-stage-wrap > :not(.cv-home)', homeOn);
  set('.cv-main > .fm-paint', homeOn);
  const skip = document.querySelector<HTMLElement>('.fm-skip'), mode = homeOn ? 'home' : paintOn ? 'paint' : 'timeline';
  if (skip && skip.dataset.mode !== mode) { skip.dataset.mode = mode; skip.textContent = t(homeOn ? 'Skip to movies' : paintOn ? 'Skip to drawing tools' : 'Skip to Timeline'); }
}

function enhance(root: Element): void {
  if (root instanceof HTMLElement) { roles(root); if (root.matches(SELECTOR)) nameIt(root); }
  for (const n of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (n.matches(SELECTOR)) nameIt(n);
    if (n.className && typeof n.className === 'string') roles(n);
  }
}

/** Focusable, enabled rows inside a popover or menu, in order. */
function rowsOf(host: Element): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [role="menuitem"]:not([aria-disabled="true"]), .fm-pop-row[tabindex]')).filter((r) => !r.classList.contains('is-disabled') && r.getClientRects().length > 0 && r.tabIndex >= 0);
}

const openers = new WeakMap<Element, HTMLElement>();

function popToggled(p: HTMLElement): void {
  if (!p.hidden) {
    const from = document.activeElement;
    if (from instanceof HTMLElement && !p.contains(from)) openers.set(p, from);
    if (keyboardLast) requestAnimationFrame(() => { if (!p.hidden && !p.contains(document.activeElement)) rowsOf(p)[0]?.focus(); });
  } else {
    let back = openers.get(p) ?? null;
    const active = document.activeElement;
    openers.delete(p);
    if (!back || back === document.body || !back.getClientRects().length) back = p.classList.contains('fm-paint') ? document.querySelector<HTMLElement>('.fm-tl-tracks') : null;
    if (back?.isConnected && (!active || active === document.body || p.contains(active))) back.focus();
  }
}

/** A menu that is not a menubar's (Create, the layers' menu): focus goes in when it opens by key, and back when it closes. */
function menuToggled(m: HTMLElement): void {
  const barDriven = !!document.querySelector('.cv-menu-btn.is-open');
  const others = Array.from(document.querySelectorAll<HTMLElement>('.cv-menu:not([hidden])')).filter((x) => x !== m);
  if (!m.hidden) {
    if (barDriven || others.length) return;
    const from = document.activeElement;
    if (from instanceof HTMLElement && !m.contains(from)) openers.set(m, from);
    if (keyboardLast) requestAnimationFrame(() => { if (!m.hidden && !m.contains(document.activeElement)) m.querySelector<HTMLElement>('.cv-menu-item:not(:disabled)')?.focus(); });
  } else {
    const back = openers.get(m), active = document.activeElement;
    openers.delete(m);
    if (back?.isConnected && !others.length && (!active || active === document.body || m.contains(active))) back.focus();
  }
}

function menuKey(e: KeyboardEvent, menu: HTMLElement, target: Element): boolean {
  const rows = Array.from(menu.children).filter((n): n is HTMLElement => n instanceof HTMLButtonElement && !n.disabled);
  const at = rows.indexOf(target as HTMLElement);
  const go = (i: number): void => { e.preventDefault(); e.stopPropagation(); rows[(i + rows.length) % rows.length]?.focus(); };
  if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(-1);
  else if (e.key === 'ArrowRight' && at >= 0 && rows[at].hasAttribute('aria-haspopup')) {
    e.preventDefault(); e.stopPropagation();
    rows[at].click();
    requestAnimationFrame(() => { const subs = Array.from(document.querySelectorAll<HTMLElement>('.cv-menu:not([hidden])')).filter((x) => x !== menu); subs[subs.length - 1]?.querySelector<HTMLElement>('.cv-menu-item:not(:disabled)')?.focus(); });
  } else if (e.key === 'ArrowLeft') {
    const row = Array.from(document.querySelectorAll<HTMLElement>('.cv-menu-sub.is-open')).find((r) => !menu.contains(r));
    if (row) { e.preventDefault(); e.stopPropagation(); row.focus(); }
  } else return false;
  return true;
}

function focusables(scope: Element): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')).filter((n) => !(n as HTMLButtonElement).disabled && n.tabIndex >= 0 && n.getClientRects().length > 0);
}

function onKey(e: KeyboardEvent): void {
  keyboardLast = true;
  if (e.defaultPrevented) return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  // A modal dialog keeps Tab inside itself.
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const scrims = Array.from(document.querySelectorAll<HTMLElement>('.cv-scrim:not([hidden])'));
    const top = scrims[scrims.length - 1];
    if (top) {
      const list = focusables(top);
      if (!list.length) { e.preventDefault(); return; }
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); e.stopPropagation(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && (at === list.length - 1 || at < 0)) { e.preventDefault(); e.stopPropagation(); list[0].focus(); }
      return;
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const menu = target.closest<HTMLElement>('.cv-menu');
  if (menu && !document.querySelector('.cv-menu-btn.is-open') && menuKey(e, menu, target)) return;
  // Roving focus through an open popover.
  const pop = target.closest<HTMLElement>('.fm-pop:not([hidden])');
  if (pop && !(target instanceof HTMLInputElement && target.type !== 'range' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') && !(target instanceof HTMLSelectElement)) {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: -0 };
    if (e.key in keys && !(target instanceof HTMLInputElement && target.type === 'range' && (e.key === 'Home' || e.key === 'End'))) {
      const rows = rowsOf(pop), at = rows.indexOf(target as HTMLElement);
      if (rows.length) {
        e.preventDefault(); e.stopPropagation();
        const to = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (at + keys[e.key] + rows.length) % rows.length;
        rows[to].focus();
      }
      return;
    }
  }
  // Home: arrows through the navigation column and across the file cards; Delete removes a card from its list.
  const nav = target.closest<HTMLElement>('.cv-home-nav[data-rove]');
  const card = target.closest<HTMLElement>('.cv-hf-open');
  if (nav || card) {
    const list = nav ? Array.from(nav.querySelectorAll<HTMLElement>('.cv-home-nav-item, .cv-home-brand')).filter((x) => x.getClientRects().length > 0)
      : Array.from(card!.closest('.cv-home-page')?.querySelectorAll<HTMLElement>('.cv-hf-open') ?? []).filter((x) => x.getClientRects().length > 0);
    const at = list.indexOf(target as HTMLElement);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (at >= 0 && step && !(nav && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      e.preventDefault(); e.stopPropagation();
      list[(at + step + list.length) % list.length].focus();
      return;
    }
    if (card && e.key === 'Delete') {
      const rm = card.parentElement?.querySelector<HTMLElement>('.cv-hf-remove');
      if (rm && !rm.hidden) { e.preventDefault(); rm.click(); }
      return;
    }
  }
  // Arrow keys across tabs.
  const tab = target.closest<HTMLElement>('[role="tab"]');
  if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
    const list = tab.closest<HTMLElement>('[role="tablist"]');
    const tabs = list ? Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter((x) => x.getClientRects().length > 0) : [];
    const at = tabs.indexOf(tab);
    if (at >= 0 && tabs.length > 1) {
      e.preventDefault(); e.stopPropagation();
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[to].focus();
      tabs[to].click();
    }
  }
}

/** Makes a pointer-only 0..1 slider a keyboard slider: focusable, role slider with its value in percent; arrows step 1%,
 *  Shift or Page keys 10%, Home and End the ends. `title` supplies the name. */
export function keyboardSlider(node: HTMLElement, o: { value: () => number; set: (v: number) => void; done: () => void }): void {
  node.tabIndex = 0;
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-orientation', 'vertical');
  node.setAttribute('aria-valuemin', '0');
  node.setAttribute('aria-valuemax', '100');
  const sync = (): void => {
    const pct = Math.round(o.value() * 100);
    if (node.getAttribute('aria-valuenow') !== String(pct)) { node.setAttribute('aria-valuenow', String(pct)); node.setAttribute('aria-valuetext', `${pct}%`); }
    const name = node.getAttribute('title');
    if (name && node.getAttribute('aria-label') !== name) node.setAttribute('aria-label', name);
  };
  node.addEventListener('focus', sync);
  node.addEventListener('pointerup', sync);
  new MutationObserver(sync).observe(node, { attributes: true, attributeFilter: ['style', 'title'], subtree: true });
  node.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const big = e.shiftKey ? 0.1 : 0.01, now = o.value();
    const to = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? now + big : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? now - big
      : e.key === 'PageUp' ? now + 0.1 : e.key === 'PageDown' ? now - 0.1 : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : null;
    if (to === null) return;
    e.preventDefault(); e.stopPropagation();
    o.set(Math.max(0, Math.min(1, to)));
    sync();
    announce(`${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('aria-valuetext') ?? ''}`.trim());
  });
  node.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key.startsWith('Page') || e.key === 'Home' || e.key === 'End') o.done(); });
  sync();
}

/** The shortcuts the Timeline and the live region add. */
export function a11yCommands(engine: Engine): Command[] {
  const sel = (): boolean => engine.selection.content.length > 0;
  const move = (label: string, dx: number, dy: number) => (): void => {
    const ids = engine.selection.content.slice();
    engine.run(label, (m) => ops.moveContent(m, ids, dx, dy));
  };
  return [
    { id: 'nudge-content-up', label: 'Move Content to Track Above', keys: ['Shift+Mod+Up'], enabled: sel, run: move('Move Content', 0, -1) },
    { id: 'nudge-content-down', label: 'Move Content to Track Below', keys: ['Shift+Mod+Down'], enabled: sel, run: move('Move Content', 0, 1) },
    { id: 'announce-timecode', label: 'Say Playhead Time', keys: ['Alt+T'], enabled: () => !!engine.movie, run: () => { const m = engine.movie; if (m) announce(`${t('Playhead')} ${timecode(engine.frame, m.fps)}, ${t('frame')} ${engine.frame + 1} / ${m.duration}`); } },
  ];
}

/** What the selected block is, in words. */
function describe(engine: Engine): string {
  const m = engine.movie;
  if (!m) return t('No movie open');
  const ids = engine.selection.content;
  if (!ids.length) return `${t('Nothing selected')}. ${t('Tracks')}: ${m.tracks.length}.`;
  if (ids.length > 1) return `${ids.length} ${t('blocks selected')}.`;
  const at = locate(m, ids[0]);
  if (!at) return t('Nothing selected');
  const c = at.content;
  return `${c.name || t('Block')}, ${t('track')} ${at.trackIndex + 1} / ${m.tracks.length}, ${t('frames')} ${c.start + 1} - ${end(c)}.`;
}

/** Starts the observer, the live region and the Timeline description once the app is built. */
export function installA11y(engine: Engine): void {
  if (live) return;
  const host = document.createElement('div');
  host.className = 'fm-a11y-live';
  host.innerHTML = '<div role="status" aria-live="polite" aria-atomic="true"></div><p id="fm-tl-desc"></p>';
  document.body.appendChild(host);
  live = host.firstElementChild as HTMLElement;
  const desc = host.lastElementChild as HTMLElement;
  // A skip link, the first tab stop: past the menu bar and navigation straight to the movie cards (Home) or the Timeline.
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'fm-skip';
  skip.textContent = t('Skip to movies');
  document.body.insertBefore(skip, document.body.firstChild);
  skip.addEventListener('click', () => {
    const home = document.querySelector<HTMLElement>('.cv-home');
    const paint = document.querySelector<HTMLElement>('.fm-paint');
    // in Draw & Paint the Timeline is inert under the drawing surface: the link goes to the tools
    const pick = home && !home.hidden
      ? Array.from(home.querySelectorAll<HTMLElement>('.cv-home-page:not([hidden]) .cv-hf-open, .cv-home-page:not([hidden]) .cv-home-action, .cv-home-page:not([hidden]) .cv-th-select')).find((x) => x.getClientRects().length > 0)
      : paint && !paint.hidden
        ? Array.from(paint.querySelectorAll<HTMLElement>('.fm-paint-mode, .fm-paint-tool')).find((x) => x.getClientRects().length > 0)
        : document.querySelector<HTMLElement>('.fm-tl-tracks');
    pick?.focus();
  });
  const toasts = document.getElementById('toast-root');
  if (toasts) { toasts.setAttribute('role', 'log'); toasts.setAttribute('aria-live', 'polite'); toasts.setAttribute('aria-relevant', 'additions'); }

  const pending = new Set<Element>();
  let queued = 0;
  const flush = (): void => {
    queued = 0;
    const list = Array.from(pending);
    pending.clear();
    for (const n of list) if (n.isConnected) enhance(n);
    syncInert();
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') { r.addedNodes.forEach((n) => { if (n instanceof Element) pending.add(n); }); continue; }
      const n = r.target;
      if (!(n instanceof HTMLElement)) continue;
      if (r.attributeName === 'hidden') {
        if (n.classList.contains('fm-paint')) syncInert();
        if (n.classList.contains('fm-pop') || n.classList.contains('fm-paint')) popToggled(n);
        if (n.classList.contains('cv-home') || n.classList.contains('fm-paint')) syncInert();
        // A dialog closed with nothing to hand focus back to leaves it on the Timeline, not the page.
        if (n.classList.contains('cv-scrim') && n.hidden) requestAnimationFrame(() => {
          const a = document.activeElement, tl = document.querySelector<HTMLElement>('.fm-tl-tracks');
          if ((!a || a === document.body) && tl && !tl.closest('[inert]') && tl.getClientRects().length && !document.querySelector('.cv-scrim:not([hidden])')) tl.focus();
        });
        if (n.classList.contains('cv-menu')) menuToggled(n);
        if (n.classList.contains('cv-menu')) for (const b of Array.from(document.querySelectorAll<HTMLElement>('.cv-menu-btn'))) b.setAttribute('aria-expanded', String(b.classList.contains('is-open')));
      } else if (r.attributeName === 'title' || r.attributeName === 'data-tip') nameIt(n);
    }
    if (pending.size && !queued) queued = requestAnimationFrame(flush);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'title', 'data-tip'] });
  enhance(document.body);
  syncInert();

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', () => { keyboardLast = false; }, true);

  let last = '';
  let timer = 0;
  const update = (say: boolean): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const d = describe(engine);
      if (d === last) return;
      last = d;
      desc.textContent = d;
      if (say && engine.selection.content.length) announce(d);
    }, 120);
  };
  engine.on('selection', () => update(true));
  engine.on('movie', () => update(true));
  update(false);
}
