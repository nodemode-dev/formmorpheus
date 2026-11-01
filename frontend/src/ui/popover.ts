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
  /** Set by a card that stays open for presses on these targets (it still closes on Escape or any other outside press). */
  keep: ((target: Element) => boolean) | null = null;
  private readonly down =(e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.el.contains(t) || this.anchor?.contains(t)) return;
    // the Color panel opened from a popover is part of it
    if (t instanceof Element && t.closest('.fm-col')) return;
    // the Warp / Distort card stays open while its handles are dragged on the Stage
    if (t instanceof Element && t.closest('.fm-warp-h')) return;
    // a dropdown list opened from a select inside the card sits in the overlay layer, outside the card
    if (t instanceof Element && t.closest('.cv-dd-pop')) return;
    // a card that asked to stay open while the Stage or Timeline is worked (the keyframe parameter card)
    if (t instanceof Element && this.keep?.(t)) return;
    for (const p of this.subs.keys()) if (p.contains(t)) return;
    this.hide();
  };
  private readonly key = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // Escape in an open dropdown list (dropdown.ts) closes only the list
    if (document.querySelector('.cv-dd-pop:not([hidden])')) return;
    e.preventDefault();
    e.stopPropagation();
    // one Escape closes the menu with any submenu the pointer happens to have open (hide closes them)
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
    // offset sizes, not getBoundingClientRect: the open animation scales the card, and that must not shift its place
    const r = anchor.getBoundingClientRect(), h = this.el.offsetHeight;
    this.place(r.left, side === 'above' ? r.top - h - GAP : r.bottom + GAP, r.left + r.width / 2, side === 'above' ? r.top : r.bottom);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.closeSubs();
    // a short exit (90 ms): the card is already out of the way of input (pointer-events none) while it fades
    if (!this.el.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.el.classList.add('is-closing');
      this.closeT = window.setTimeout(() => this.finishClose(), 90);
    } else this.el.hidden = true;
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
    // a submenu opened from a row inside another submenu leaves that parent open (Timeline block menu sections)
    for (const [p, r] of this.subs) if (p !== panel && !p.contains(row)) { p.hidden = true; setClass(r, 'is-open', false); }
    const parent = row.closest<HTMLElement>('.fm-pop');
    if (parent && parent !== this.el && !parent.dataset.nest) {
      parent.dataset.nest = '1';
      // hovering a plain row of a submenu closes the submenus opened from it
      parent.addEventListener('pointerover', (e) => {
        const hit = (e.target as HTMLElement).closest<HTMLElement>('.fm-pop-row');
        if (!hit || hit.hasAttribute('data-sub') || !parent.contains(hit)) return;
        for (const [p, r] of this.subs) if (parent.contains(r) && !p.hidden) { p.hidden = true; setClass(r, 'is-open', false); }
      });
    }
    panel.hidden = false;
    setClass(row, 'is-open', true);
    const r = row.getBoundingClientRect(), bw = panel.offsetWidth, bh = panel.offsetHeight;
    const right = r.right + 2, left = r.left - bw - 2;
    const toRight = right + bw + MARGIN <= window.innerWidth;
    const x = toRight ? right : Math.max(MARGIN, left);
    const y = Math.max(MARGIN, Math.min(r.top - 6, window.innerHeight - bh - MARGIN));
    panel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    // the submenu grows from the row it opened beside
    panel.style.setProperty('--fm-ox', toRight ? '0px' : `${bw}px`);
    panel.style.setProperty('--fm-oy', `${Math.round(Math.max(0, Math.min(bh, r.top + r.height / 2 - y)))}px`);
  }

  closeSubs(): void {
    for (const [p, r] of this.subs) { p.hidden = true; setClass(r, 'is-open', false); }
  }

  private closeT = 0;

  private finishClose(): void {
    this.closeT = 0;
    if (this.open) return;
    this.el.classList.remove('is-closing');
    this.el.hidden = true;
  }

  private reveal(): void {
    if (this.closeT) {
      // shown again while the exit runs: carry on from the card as it stands, with no second entry animation
      window.clearTimeout(this.closeT);
      this.closeT = 0;
      this.el.classList.remove('is-closing');
      this.el.classList.add('is-still');
    } else if (this.el.hidden) this.el.classList.remove('is-still');
    this.el.hidden = false;
    if (this.open) return;
    this.open = true;
    document.addEventListener('pointerdown', this.down, true);
    document.addEventListener('keydown', this.key, true);
    window.addEventListener('blur', this.blur);
  }

  /** `ox, oy` is the point the card grows from (the anchor's edge, or the press point); it defaults to `x, y`. */
  private place(x: number, y: number, ox = x, oy = y): void {
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const nx = Math.round(Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN)));
    const ny = Math.round(Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN)));
    this.el.style.transform = `translate(${nx}px, ${ny}px)`;
    this.el.style.setProperty('--fm-ox', `${Math.round(Math.max(0, Math.min(w, ox - nx)))}px`);
    this.el.style.setProperty('--fm-oy', `${Math.round(Math.max(0, Math.min(h, oy - ny)))}px`);
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
