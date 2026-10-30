import { el, q, setClass, setText } from './dom';
import { icon } from './icons';
import './icons-morph';

const MARGIN = 8;
const GAP = 6;

const root = (): HTMLElement => document.getElementById('overlay-root') ?? document.body;

export class Popover {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private anchor: HTMLElement | null = null;
  private readonly subs = new Map<HTMLElement, HTMLElement>();
  private readonly hideFns: Array<() => void> = [];
  private open = false;
  private readonly down = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.el.contains(t) || this.anchor?.contains(t)) return;
    // the Color panel opened from a popover is part of it
    if (t instanceof Element && t.closest('.fm-col')) return;
    // the Warp / Distort card stays open while its handles are dragged on the Stage
    if (t instanceof Element && t.closest('.fm-warp-h')) return;
    // a dropdown list opened from a select inside the card sits in the overlay layer, outside the card
    if (t instanceof Element && t.closest('.cv-dd-pop')) return;
    for (const p of this.subs.keys()) if (p.contains(t)) return;
    this.hide();
  };
  private readonly key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Escape in an open dropdown list (dropdown.ts) closes only the list
    if (document.querySelector('.cv-dd-pop:not([hidden])')) return;
    e.preventDefault();
    e.stopPropagation();
    // a submenu in view closes first; the menu itself on the next Escape
    for (const p of this.subs.keys()) if (!p.hidden) { this.closeSubs(); return; }
    this.hide();
  };
  private readonly blur = (): void => this.hide();

  constructor(cls = '', width = 0) {
    this.el = Popover.panel(`fm-pop ${cls}`.trim());
    if (width) this.el.style.width = `${width}px`;
    this.body = this.el;
    this.el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    this.el.addEventListener('pointerover', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-pop-row, .fm-cm-tile');
      if (row && this.el.contains(row) && !row.hasAttribute('data-sub')) this.closeSubs();
    });
  }

  static panel(cls: string): HTMLElement {
    const p = el<HTMLElement>(`<div class="${cls}" hidden></div>`);
    root().appendChild(p);
    return p;
  }

  get isOpen(): boolean { return this.open; }

  onHide(fn: () => void): void { this.hideFns.push(fn); }

  showAt(x: number, y: number): void {
    this.anchor = null;
    this.reveal();
    this.place(x, y);
  }

  showFor(anchor: HTMLElement, side: 'above' | 'below'): void {
    this.anchor = anchor;
    this.reveal();
    const r = anchor.getBoundingClientRect(), box = this.el.getBoundingClientRect();
    this.place(r.left, side === 'above' ? r.top - box.height - GAP : r.bottom + GAP);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.closeSubs();
    this.el.hidden = true;
    this.anchor = null;
    document.removeEventListener('pointerdown', this.down, true);
    document.removeEventListener('keydown', this.key, true);
    window.removeEventListener('blur', this.blur);
    for (const fn of this.hideFns) fn();
  }

  attachSub(row: HTMLElement, panel: HTMLElement, onOpen?: () => void): void {
    row.setAttribute('data-sub', '');
    const show = (): void => { onOpen?.(); this.openSub(row, panel); };
    row.addEventListener('pointerenter', show);
    row.addEventListener('click', show);
  }

  openSub(row: HTMLElement, panel: HTMLElement): void {
    this.subs.set(panel, row);
    for (const [p, r] of this.subs) if (p !== panel) { p.hidden = true; setClass(r, 'is-open', false); }
    panel.hidden = false;
    setClass(row, 'is-open', true);
    const r = row.getBoundingClientRect(), box = panel.getBoundingClientRect();
    const right = r.right + 2, left = r.left - box.width - 2;
    const x = right + box.width + MARGIN <= window.innerWidth ? right : Math.max(MARGIN, left);
    const y = Math.max(MARGIN, Math.min(r.top - 6, window.innerHeight - box.height - MARGIN));
    panel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  closeSubs(): void {
    for (const [p, r] of this.subs) { p.hidden = true; setClass(r, 'is-open', false); }
  }

  private reveal(): void {
    this.el.hidden = false;
    if (this.open) return;
    this.open = true;
    document.addEventListener('pointerdown', this.down, true);
    document.addEventListener('keydown', this.key, true);
    window.addEventListener('blur', this.blur);
  }

  private place(x: number, y: number): void {
    const box = this.el.getBoundingClientRect();
    const nx = Math.max(MARGIN, Math.min(x, window.innerWidth - box.width - MARGIN));
    const ny = Math.max(MARGIN, Math.min(y, window.innerHeight - box.height - MARGIN));
    this.el.style.transform = `translate(${Math.round(nx)}px, ${Math.round(ny)}px)`;
  }
}

export interface PopRow {
  readonly el: HTMLButtonElement;
  readonly ico: HTMLElement;
  setLabel(text: string): void;
  setValue(text: string): void;
  setDisabled(on: boolean): void;
  setChecked(on: boolean): void;
}

export interface PopRowOptions { sub?: boolean; danger?: boolean; check?: boolean }

export function popRow(iconName: string | null, label: string, opts: PopRowOptions = {}): PopRow {
  const tail = opts.sub ? icon('chevronRight', 14) : opts.check ? icon('check', 14) : '';
  const node = el<HTMLButtonElement>(
    `<button class="fm-pop-row" type="button"><span class="fm-pop-ico">${iconName ? icon(iconName, 16) : ''}</span>` +
    `<span class="fm-pop-label"></span><span class="fm-pop-val"></span><span class="fm-pop-tail">${tail}</span></button>`);
  const ico = q<HTMLElement>(node, '.fm-pop-ico');
  const lab = q<HTMLElement>(node, '.fm-pop-label');
  const val = q<HTMLElement>(node, '.fm-pop-val');
  setText(lab, label);
  if (opts.danger) node.classList.add('is-danger');
  if (opts.check) node.classList.add('has-check');
  return {
    el: node,
    ico,
    setLabel: (text) => setText(lab, text),
    setValue: (text) => setText(val, text),
    setDisabled: (on) => { setClass(node, 'is-disabled', on); node.tabIndex = on ? -1 : 0; },
    setChecked: (on) => setClass(node, 'is-checked', on),
  };
}

export function popSep(): HTMLElement {
  return el<HTMLElement>('<div class="fm-pop-sep" role="separator"></div>');
}

export interface PopField {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  set(text: string): void;
  setDisabled(on: boolean): void;
}

export function popField(iconName: string, placeholder: string, commit: (value: string) => void): PopField {
  const node = el<HTMLElement>(`<div class="fm-pop-row fm-pop-fieldrow"><span class="fm-pop-ico">${icon(iconName, 16)}</span><input class="fm-pop-input" type="text" spellcheck="false" autocomplete="off"></div>`);
  const input = q<HTMLInputElement>(node, 'input');
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commit(input.value);
  });
  node.addEventListener('click', () => input.focus());
  return {
    el: node,
    input,
    set: (text) => { if (input.value !== text) input.value = text; },
    setDisabled: (on) => setClass(node, 'is-disabled', on),
  };
}
