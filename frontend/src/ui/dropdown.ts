import { el, setClass, setHidden, setText } from './dom';
import { icon } from './icons';

/** A native <select> shown as the target's menu (Phase 21, UI_SPEC.md; s21's blend modes, s23's workspaces): a button
 *  with the chosen label and a chevron; a rounded list with an optional search, the <optgroup>s as small grey headings,
 *  a tick on the chosen item; arrows, Enter and Esc. The <select> stays underneath and stays the truth: a choice sets its
 *  value and fires its change event, so the code that owns it is unchanged; values it is given show on the button.
 *  `onHover`, when given, hears the value under the pointer or the arrow keys as a live preview, and null when the menu
 *  closes or the pointer leaves it without a choice; a choice fires change as ever, and onHover(null) follows it. */
// The one open list, if any. Escape is taken at the window in the capture phase so it closes only the list: no
// tool, selection or card handler downstream hears it.
let openList: (() => void) | null = null;
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openList) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  openList();
}, true);

export function enhanceSelect(select: HTMLSelectElement, opts: { search?: string; onHover?: (value: string | null) => void } = {}): void {
  const btn = el<HTMLButtonElement>(`<button class="cv-dd-btn" type="button" aria-haspopup="listbox"><span class="cv-dd-label"></span>${icon('chevronDown', 12)}</button>`);
  const pop = el(`<div class="cv-dd-pop" role="listbox" hidden>${opts.search ? '<input class="cv-dd-search" type="search">' : ''}<div class="cv-dd-list"></div></div>`);
  const list = pop.querySelector('.cv-dd-list') as HTMLElement, search = pop.querySelector('.cv-dd-search') as HTMLInputElement | null;
  if (search) { search.placeholder = opts.search as string; search.setAttribute('aria-label', opts.search as string); }
  btn.setAttribute('aria-label', select.getAttribute('aria-label') ?? '');
  // The select's own classes size the button as they sized the select.
  for (const c of Array.from(select.classList)) if (c !== 'cv-dd-native') btn.classList.add(c);
  // Options replaced in code (a live list) show on the button too.
  new MutationObserver(() => label()).observe(select, { childList: true, subtree: true });
  btn.title = select.title;
  select.classList.add('cv-dd-native');
  select.tabIndex = -1;   // the button is the one tab stop
  select.after(btn);
  const host = document.getElementById('overlay-root');
  if (host) host.appendChild(pop); else document.body.appendChild(pop);
  let picked = 0;
  const label = (): void => { setText(btn.querySelector('.cv-dd-label') as HTMLElement, select.selectedOptions[0]?.textContent ?? ''); btn.disabled = select.disabled; };
  // Values set in code (not only by the user) show on the button.
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value') as PropertyDescriptor;
  Object.defineProperty(select, 'value', { configurable: true, get() { return proto.get?.call(select); }, set(v) { proto.set?.call(select, v); label(); } });
  const disabled = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled') as PropertyDescriptor;
  Object.defineProperty(select, 'disabled', { configurable: true, get() { return disabled.get?.call(select); }, set(v) { disabled.set?.call(select, v); label(); } });
  select.addEventListener('change', label);
  const rows = new Map<string, HTMLButtonElement>(), heads = new Map<string, HTMLElement>();
  const visible = (): HTMLElement[] => Array.from(list.querySelectorAll<HTMLElement>('.cv-dd-item:not([hidden])'));
  // .cv-dd-item sets display, so the hidden attribute alone would not hide it.
  const show = (n: HTMLElement, on: boolean): void => { setHidden(n, !on); const d = on ? '' : 'none'; if (n.style.display !== d) n.style.display = d; };
  const row = (key: string, o: HTMLOptionElement): HTMLButtonElement => {
    let item = rows.get(key);
    if (!item) {
      const made = el<HTMLButtonElement>(`<button class="cv-dd-item" type="button" role="option"><span></span>${icon('check', 14)}</button>`), v = o.value;
      made.dataset.value = v;
      made.addEventListener('click', () => { if (select.value !== v) { select.value = v; select.dispatchEvent(new Event('change', { bubbles: true })); } close(); });
      made.addEventListener('pointerenter', () => { picked = visible().indexOf(made); mark(); opts.onHover?.(v); });
      rows.set(key, made);
      item = made;
    }
    setText(item.querySelector('span') as HTMLElement, o.textContent ?? '');
    return item;
  };
  const fill = (): void => {
    const q = search?.value.trim().toLowerCase() ?? '';
    const want: HTMLElement[] = [], seen = new Map<string, number>();
    const keyOf = (k: string): string => { const n = seen.get(k) ?? 0; seen.set(k, n + 1); return n ? `${k}\n${n}` : k; };
    for (const node of Array.from(select.children)) {
      const group = node instanceof HTMLOptGroupElement ? node : null;
      if (!group && !(node instanceof HTMLOptionElement)) continue;
      const options = group ? Array.from(group.children).filter((o): o is HTMLOptionElement => o instanceof HTMLOptionElement) : [node as HTMLOptionElement];
      let head: HTMLElement | null = null;
      if (group) {
        const hk = keyOf(`\0${group.label}`);
        head = heads.get(hk) ?? null;
        if (!head) { head = el('<div class="cv-dd-head"></div>'); heads.set(hk, head); }
        setText(head, group.label);
        want.push(head);
      }
      let any = false;
      for (const o of options) {
        const item = row(keyOf(o.value), o), shown = !o.hidden && (!q || (o.textContent ?? '').toLowerCase().includes(q)), chosen = shown && o.value === select.value;
        any ||= shown;
        show(item, shown);
        setClass(item, 'is-chosen', chosen);
        if (item.getAttribute('aria-selected') !== String(chosen)) item.setAttribute('aria-selected', String(chosen));
        want.push(item);
      }
      if (head) show(head, any && !q);
    }
    const keep = new Set(want);
    let cursor = list.firstElementChild;
    for (const n of want) { if (n !== cursor) list.insertBefore(n, cursor); else cursor = cursor.nextElementSibling; }
    for (const map of [rows, heads] as Map<string, HTMLElement>[]) for (const [k, n] of map) if (!keep.has(n)) { n.remove(); map.delete(k); }
    picked = Math.max(0, visible().findIndex((i) => i.classList.contains('is-chosen')));
    if (q) picked = 0;
    mark();
  };
  const mark = (): void => { const vis = visible(); list.querySelectorAll<HTMLElement>('.cv-dd-item').forEach((i) => setClass(i, 'is-picked', i === vis[picked])); };
  const escape = (): void => { close(); btn.focus(); };
  const close = (): void => { setHidden(pop, true); btn.setAttribute('aria-expanded', 'false'); opts.onHover?.(null); if (openList === escape) openList = null; };
  const open = (): void => {
    openList = escape;
    if (search) search.value = '';
    fill();
    setHidden(pop, false);
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
    pop.style.minWidth = `${Math.round(r.width)}px`;
    pop.style.left = `${Math.round(Math.min(r.left, window.innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${Math.round(r.bottom + 4 + h <= window.innerHeight - 4 ? r.bottom + 4 : Math.max(4, r.top - 4 - h))}px`;
    (search ?? (list.querySelector('.is-chosen') as HTMLElement | null) ?? btn).focus();
    (list.querySelector('.is-chosen') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  search?.addEventListener('input', () => { fill(); opts.onHover?.(null); });
  list.addEventListener('pointerleave', () => opts.onHover?.(null));
  pop.addEventListener('keydown', (e) => {
    const items = visible();
    if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { picked = (picked + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; mark(); items[picked].scrollIntoView({ block: 'nearest' }); opts.onHover?.(items[picked].dataset.value ?? null); } return; }
    if (e.key === 'Enter') { e.preventDefault(); items[picked]?.click(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); }, true);
  label();
}

/** Every select in the app shown as the glass list (the owner's walkthrough: native menus cannot be glass, the system
 *  draws them): those present now and any added later (dialogs and bars build theirs as they open). A select can opt
 *  out with data-native; multiple and list-box selects are left as they are. */
export function enhanceAllSelects(root: ParentNode = document): void {
  const pick = (n: ParentNode): void => {
    for (const s of Array.from(n.querySelectorAll<HTMLSelectElement>('select:not(.cv-dd-native):not([multiple]):not([size]):not([data-native])'))) enhanceSelect(s);
  };
  pick(root);
  new MutationObserver((records) => {
    for (const r of records) for (const node of Array.from(r.addedNodes)) {
      if (!(node instanceof HTMLElement)) continue;
      if (node instanceof HTMLSelectElement) { if (!node.classList.contains('cv-dd-native') && !node.multiple && !node.hasAttribute('size') && !node.hasAttribute('data-native')) enhanceSelect(node); }
      else pick(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
