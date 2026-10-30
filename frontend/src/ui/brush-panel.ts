// Brush panel of Draw & Paint: sets on the left, brushes with a stroke preview on the right.
import { el, patchList, q, setClass, setHidden, setText } from './dom';
import { BRUSHES, BRUSH_SETS, brushById } from '../paint/brushes';
import { renderBrushPreview } from '../paint/preview';
import type { Brush } from '../paint/types';

const RECENT_KEY = 'formmorpheus.brushes.recent';
const RECENT = 'Recent';
const RECENT_MAX = 8;
const PW = 190, PH = 40, SCALE = 2;

const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>';
const ICON_RECENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const ICON_SET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17c3-9 6-9 8-4s5 4 8-5"/></svg>';

type Tool = 'paint' | 'smudge' | 'erase';

export class BrushPanel {
  readonly root: HTMLElement;
  private readonly setsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly clearEl: HTMLElement;
  private readonly previews = new Map<string, HTMLCanvasElement>();
  private recent: string[] = [];
  private activeSet = RECENT;
  private currentId = '';
  private anchor: HTMLElement | null = null;
  private opened = false;
  private freezeRecent = false;

  private readonly onDown = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!t || this.root.contains(t) || this.anchor?.contains(t)) return;
    this.close();
  };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (this.searchEl.value) { this.searchEl.value = ''; this.onSearch(); return; }
    this.close();
  };

  constructor(private readonly opts: { onPick: (brush: Brush) => void }) {
    this.root = el<HTMLElement>(`<div class="fm-bp fm-pp-glass" hidden>
      <div class="fm-bp-head"><div class="fm-bp-title">Brushes</div></div>
      <label class="fm-bp-search"><span class="fm-bp-glass">${ICON_SEARCH}</span><input type="text" placeholder="Search" spellcheck="false" autocomplete="off"><button type="button" class="fm-bp-clear" hidden aria-label="Clear">${ICON_CLEAR}</button></label>
      <div class="fm-bp-cols">
        <div class="fm-bp-sets"></div>
        <div class="fm-bp-lists"><div class="fm-bp-list"></div><div class="fm-bp-empty" hidden></div></div>
      </div>
    </div>`);
    this.setsEl = q(this.root, '.fm-bp-sets');
    this.listEl = q(this.root, '.fm-bp-list');
    this.emptyEl = q(this.root, '.fm-bp-empty');
    this.searchEl = q<HTMLInputElement>(this.root, 'input');
    this.clearEl = q(this.root, '.fm-bp-clear');
    this.loadRecent();

    for (const name of [RECENT, ...BRUSH_SETS]) {
      const row = el<HTMLButtonElement>(`<button type="button" class="fm-bp-set" data-set="${name}"><span class="fm-bp-set-ico">${name === RECENT ? ICON_RECENT : ICON_SET}</span><span class="fm-bp-set-name"></span></button>`);
      setText(q(row, '.fm-bp-set-name'), name);
      this.setsEl.appendChild(row);
    }
    this.setsEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-set');
      if (!row) return;
      this.searchEl.value = '';
      this.activeSet = row.dataset.set ?? RECENT;
      this.freezeRecent = false;
      this.sync();
      this.listEl.scrollTop = 0;
    });
    this.listEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.fm-bp-row');
      const b = row?.dataset.key ? brushById(row.dataset.key) : null;
      if (b) this.pick(b);
    });
    this.searchEl.addEventListener('input', () => this.onSearch());
    this.searchEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = this.items()[0];
      if (first) this.pick(first);
    });
    this.clearEl.addEventListener('click', () => { this.searchEl.value = ''; this.onSearch(); this.searchEl.focus(); });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  open(anchor: HTMLElement, tool: Tool, currentId: string): void {
    this.anchor = anchor;
    this.currentId = currentId;
    this.root.dataset.tool = tool;
    this.searchEl.value = '';
    const b = brushById(currentId);
    this.activeSet = b ? b.set : (this.recent.length ? RECENT : (BRUSH_SETS[0] ?? RECENT));
    this.freezeRecent = false;
    if (!this.root.parentElement) (document.getElementById('overlay-root') ?? document.body).appendChild(this.root);
    this.root.hidden = false;
    this.place();
    this.sync();
    this.opened = true;
    document.addEventListener('pointerdown', this.onDown, true);
    document.addEventListener('keydown', this.onKey, true);
    const sel = this.listEl.querySelector<HTMLElement>('.fm-bp-row.is-selected');
    sel?.scrollIntoView({ block: 'center' });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.hidden = true;
    this.anchor = null;
    document.removeEventListener('pointerdown', this.onDown, true);
    document.removeEventListener('keydown', this.onKey, true);
  }

  isOpen(): boolean { return this.opened; }

  private place(): void {
    const a = this.anchor;
    if (!a) return;
    const host = (this.root.offsetParent as HTMLElement | null) ?? document.body;
    const hr = host.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const w = this.root.offsetWidth || 320;
    const left = Math.max(8, ar.right - hr.left - w);
    const top = ar.bottom - hr.top + 8;
    const height = Math.max(260, host.clientHeight - top - 12);
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.height = `${Math.round(height)}px`;
  }

  private onSearch(): void {
    setHidden(this.clearEl, !this.searchEl.value);
    this.freezeRecent = false;
    this.sync();
    this.listEl.scrollTop = 0;
  }

  private searching(): boolean { return this.searchEl.value.trim().length > 0; }

  private items(): Brush[] {
    if (this.searching()) {
      const s = this.searchEl.value.trim().toLowerCase();
      return BRUSHES.filter((b) => b.name.toLowerCase().includes(s) || b.set.toLowerCase().includes(s));
    }
    if (this.activeSet === RECENT) {
      const out: Brush[] = [];
      for (const id of this.recent) { const b = brushById(id); if (b) out.push(b); }
      return out;
    }
    return BRUSHES.filter((b) => b.set === this.activeSet);
  }

  /** Patches the set rows, the brush rows and the empty note in place. */
  private sync(): void {
    const searching = this.searching();
    setHidden(this.clearEl, !searching);
    setClass(this.setsEl, 'is-dim', searching);
    for (const row of Array.from(this.setsEl.children) as HTMLElement[]) setClass(row, 'is-active', !searching && row.dataset.set === this.activeSet);
    const items = this.items();
    patchList(this.listEl, items, {
      key: (b) => b.id,
      create: (b) => {
        const row = el<HTMLElement>('<div class="fm-bp-row"><span class="fm-bp-name"></span><span class="fm-bp-tag"></span></div>');
        row.insertBefore(this.previewOf(b), row.firstChild);
        setText(q(row, '.fm-bp-name'), b.name);
        setClass(row, 'is-selected', b.id === this.currentId);
        setText(q(row, '.fm-bp-tag'), searching ? b.set : '');
        return row;
      },
      update: (row, b) => {
        setClass(row, 'is-selected', b.id === this.currentId);
        setText(q(row, '.fm-bp-tag'), searching ? b.set : '');
      },
    });
    setHidden(this.emptyEl, items.length > 0);
    setText(this.emptyEl, searching ? 'No brushes found' : 'No recent brushes yet');
  }

  private previewOf(b: Brush): HTMLCanvasElement {
    let c = this.previews.get(b.id);
    if (c) return c;
    c = document.createElement('canvas');
    c.className = 'fm-bp-prev';
    c.width = PW * SCALE;
    c.height = PH * SCALE;
    try {
      const r = renderBrushPreview(b, c.width, c.height, { r: 255, g: 255, b: 255 });
      const img = new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
      c.getContext('2d')?.putImageData(img, 0, 0);
    } catch { /* an empty preview is acceptable */ }
    this.previews.set(b.id, c);
    return c;
  }

  private pick(b: Brush): void {
    this.currentId = b.id;
    this.pushRecent(b.id);
    // Keep the Recent order still while the user is looking at it.
    if (this.activeSet === RECENT && !this.searching()) this.freezeRecent = true;
    for (const row of Array.from(this.listEl.children) as HTMLElement[]) setClass(row, 'is-selected', row.dataset.key === b.id);
    this.opts.onPick(b);
  }

  private pushRecent(id: string): void {
    if (this.freezeRecent && this.recent.includes(id)) return;
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent)); } catch { /* storage may be blocked */ }
  }

  private loadRecent(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(raw)) this.recent = raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX);
    } catch { this.recent = []; }
  }
}
