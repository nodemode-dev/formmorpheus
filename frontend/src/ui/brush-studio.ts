// Brush Studio: the full-screen brush editor. A drawing pad on one side (strokes are replayed through the
// real input pipeline and stroke engine on every change, so the pad shows exactly what the brush will do) and
// the brush's settings in sections on the other. Opened from a brush's menu (Edit Brush) or New brush.
// The studio edits a draft; Done writes the difference into the brush store, Cancel drops it.
// Built once from a template and patched in place (zero flash).

import '../styles/brush-studio.css';
import { el, q, setClass, setHidden, setText } from './dom';
import { dateText, t } from './i18n';
import { brushStore } from './brush-store';
import type { Brush, Raster, RGB, TipImage } from '../paint/types';
import {
  PadRunner, demoStrokes, renderPad, type PadEvent, type PadPaint, type PadStroke,
} from '../paint/studio-render';
import { renderStampPreview } from '../paint/stamp-preview';
import { buildPickRow, type PickRow } from './brush-pick';
import { buildCurvePanel, type CurvePanel } from './brush-studio-curves';
import {
  ABOUT_LABELS, SECTIONS, allParams, brushDiff, cloneBrush,
  type BoolParam, type NumParam, type Param, type SelectParam,
} from './brush-studio-params';

export interface StudioOptions {
  /** Edit this brush, or (mode `new`) start from it. */
  brushId: string;
  mode?: 'edit' | 'new';
  /** Set a new brush goes into. */
  setId?: string;
  /** The brush that was saved (its id), once Done wrote it. */
  onSaved?: (id: string) => void;
}

const OPEN_KEY = 'formmorpheus.studio.open';
const PREFS_KEY = 'formmorpheus.studio.pad';

const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4.5 11.5 9 16M5 11.5h9.5a5 5 0 0 1 0 10H11"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4"/></svg>';
const ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg>';
const ICON_WAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c3-9 6-9 8-3s5 5 10-6"/></svg>';

let current: BrushStudio | null = null;

/** Opens the studio; resolves with the saved brush's id, or null when cancelled. */
export function openBrushStudio(opts: StudioOptions): Promise<string | null> {
  if (current) return Promise.resolve(null);
  const b = brushStore.brush(opts.brushId);
  if (!b) return Promise.resolve(null);
  return new Promise((resolve) => { current = new BrushStudio(opts, b, (id) => { current = null; resolve(id); }); });
}

export function brushStudioOpen(): boolean { return current !== null; }

interface Row {
  param: Param;
  root: HTMLElement;
  range?: HTMLInputElement;
  num?: HTMLInputElement;
  select?: HTMLSelectElement;
  check?: HTMLInputElement;
  info?: HTMLElement;
  remove?: HTMLButtonElement;
  pick?: PickRow;
}

const hexOf = (c: RGB): string => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (hex: string): RGB => ({ r: parseInt(hex.slice(1, 3), 16) || 0, g: parseInt(hex.slice(3, 5), 16) || 0, b: parseInt(hex.slice(5, 7), 16) || 0 });
const fmtNum = (v: number): string => String(Math.round(v * 100) / 100);

class BrushStudio {
  private readonly root: HTMLElement;
  private readonly orig: Brush;
  private draft: Brush;
  private readonly isNew: boolean;
  private readonly builtIn: boolean;
  private hist: Brush[] = [];
  private lastPush = { id: '', at: 0 };
  private readonly rows = new Map<string, Row>();
  private readonly secEls = new Map<string, { sec: HTMLElement; head: HTMLButtonElement; body: HTMLElement; dot: HTMLElement }>();
  private readonly canvas: HTMLCanvasElement;
  private readonly wrap: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: PadStroke[] = demoStrokes();
  private raster: Raster = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  private paint: PadPaint = { color: { r: 59, g: 91, b: 219 }, color2: { r: 247, g: 103, b: 7 }, size: 0.5, opacity: 1 };
  private simulate = true;
  private tool: 'paint' | 'smudge' = 'paint';
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private live: { run: PadRunner; tool: 'paint' | 'smudge'; ev: PadEvent[]; t0: number; seed: number; id: number; travel: number; lx: number; ly: number; lt: number; dir: number } | null = null;
  private readonly nameEl: HTMLInputElement;
  private readonly authorEl: HTMLInputElement;
  private readonly dateEl: HTMLElement;
  private readonly sigEl: HTMLCanvasElement;
  private readonly curves: CurvePanel;
  private sigDown = false;
  private readonly discardBar: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private stampEl: HTMLCanvasElement | null = null;
  private stampKey = '';
  private readonly titleEl: HTMLElement;
  private readonly copyEl: HTMLInputElement;
  private readonly fileEl: HTMLInputElement;
  private fileFor: 'tip' | 'grain' = 'tip';
  private returnFocus: Element | null;
  private done = false;
  private readonly keyHandler = (e: KeyboardEvent): void => this.onKey(e);

  constructor(private readonly opts: StudioOptions, base: Brush, private readonly finish: (id: string | null) => void) {
    this.isNew = opts.mode === 'new';
    this.builtIn = !this.isNew && !base.custom;
    this.orig = cloneBrush(base);
    if (this.isNew) {
      this.orig.name = brushStore.uniqueName('New brush');
      this.orig.created = Date.now();
    }
    this.draft = cloneBrush(this.orig);
    this.returnFocus = document.activeElement;
    this.loadPrefs();

    this.root = el<HTMLElement>(`<div class="fm-bs" role="dialog" aria-modal="true" aria-label="Brush Studio" tabindex="-1">
      <header class="fm-bs-bar">
        <button type="button" class="fm-bs-btn" data-a="cancel">Cancel</button>
        <div class="fm-bs-title"><span class="fm-bs-kicker">Brush Studio</span><span class="fm-bs-name"></span></div>
        <label class="fm-bs-copy" hidden><input type="checkbox" checked><span>Save as a copy</span></label>
        <button type="button" class="fm-bs-btn" data-a="undo" title="Undo last change" aria-label="Undo last change">${ICON_UNDO}<span>Undo last change</span></button>
        <button type="button" class="fm-bs-btn" data-a="reset" title="Reset brush" aria-label="Reset brush">${ICON_RESET}<span>Reset brush</span></button>
        <button type="button" class="fm-bs-btn is-primary" data-a="done">Done</button>
      </header>
      <div class="fm-bs-discard" hidden><span>Discard your changes to this brush?</span><button type="button" class="fm-bs-btn" data-a="keep">Keep editing</button><button type="button" class="fm-bs-btn is-danger" data-a="discard">Discard</button></div>
      <div class="fm-bs-body">
        <section class="fm-bs-padcol" aria-label="Drawing pad">
          <div class="fm-bs-padwrap is-paper"><canvas class="fm-bs-pad" aria-label="Drawing pad. Draw here to test the brush."></canvas></div>
          <div class="fm-bs-padbar">
            <label class="fm-bs-pf"><span>Size</span><input type="range" min="0" max="1" step="0.01" data-p="size"><output data-o="size"></output></label>
            <label class="fm-bs-pf"><span>Opacity</span><input type="range" min="0" max="1" step="0.01" data-p="opacity"><output data-o="opacity"></output></label>
            <label class="fm-bs-pf is-swatch"><span>Color</span><input type="color" data-p="c1" aria-label="Color"></label>
            <label class="fm-bs-pf is-swatch"><span>Secondary color</span><input type="color" data-p="c2" aria-label="Secondary color"></label>
            <label class="fm-bs-pf is-select"><span>Tool</span><select data-p="tool"><option value="paint">Paint</option><option value="smudge">Smudge</option></select></label>
            <label class="fm-bs-pf is-select"><span>Paper</span><select data-p="paper"><option value="paper">Light</option><option value="dark">Dark</option></select></label>
            <label class="fm-bs-pf is-check"><input type="checkbox" data-p="sim"><span>Simulate pen pressure</span></label>
            <canvas class="fm-bs-stamp" width="72" height="72" style="width:36px;height:36px;border-radius:4px" title="Stamp preview" aria-label="Stamp preview"></canvas>
            <span class="fm-bs-grow"></span>
            <button type="button" class="fm-bs-btn" data-a="sample" title="Add the sample strokes">${ICON_WAVE}<span>Sample strokes</span></button>
            <button type="button" class="fm-bs-btn" data-a="clear" title="Clear pad">${ICON_CLEAR}<span>Clear pad</span></button>
          </div>
        </section>
        <aside class="fm-bs-side" aria-label="Brush settings"></aside>
      </div>
      <input type="file" class="fm-bs-file" accept="image/*" hidden>
    </div>`);

    this.titleEl = q(this.root, '.fm-bs-name');
    this.undoBtn = q(this.root, '[data-a="undo"]');
    this.resetBtn = q(this.root, '[data-a="reset"]');
    this.discardBar = q(this.root, '.fm-bs-discard');
    this.copyEl = q(this.root, '.fm-bs-copy input');
    this.fileEl = q(this.root, '.fm-bs-file');
    this.wrap = q(this.root, '.fm-bs-padwrap');
    this.canvas = q(this.root, '.fm-bs-pad');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;

    const side = q(this.root, '.fm-bs-side');
    this.curves = buildCurvePanel((id, fn) => this.edit(id, fn));
    for (const s of SECTIONS) {
      this.buildSection(side, s.id, s.label, s.params);
      if (s.id === 'pencil') this.buildShell(side, 'curves', t('Pressure curves'), this.curves.root);
    }
    // About this brush: name, author, date, a signature
    const about = el<HTMLElement>(`<div class="fm-bs-about">
      <label class="fm-bs-field"><span>${ABOUT_LABELS[0]}</span><input type="text" data-f="name" maxlength="60" spellcheck="false" autocomplete="off"></label>
      <label class="fm-bs-field"><span>${ABOUT_LABELS[1]}</span><input type="text" data-f="author" maxlength="80" spellcheck="false" autocomplete="off"></label>
      <div class="fm-bs-field"><span>${ABOUT_LABELS[2]}</span><span class="fm-bs-date"></span></div>
      <div class="fm-bs-field is-sig"><span>${ABOUT_LABELS[3]}</span><canvas class="fm-bs-sig" width="360" height="110" aria-label="Signature. Sign here."></canvas><button type="button" class="fm-bs-btn is-small" data-a="sigclear">Clear signature</button></div>
    </div>`);
    this.nameEl = q(about, '[data-f="name"]');
    this.authorEl = q(about, '[data-f="author"]');
    this.dateEl = q(about, '.fm-bs-date');
    this.sigEl = q(about, '.fm-bs-sig');
    this.buildShell(side, 'about', 'About this brush', about);

    this.wire();
    document.body.appendChild(this.root);
    window.addEventListener('keydown', this.keyHandler, true);
    setHidden(q(this.root, '.fm-bs-copy'), !this.builtIn);
    this.applyPadPrefs();
    this.syncAll();
    this.loadSignature();
    this.root.focus({ preventScroll: true });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    this.resize();
  }

  // ---- building (once) ------------------------------------------------------------------

  private openSet(): Set<string> {
    try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null'); if (Array.isArray(v)) return new Set(v.filter((x) => typeof x === 'string')); } catch { /* storage may be blocked */ }
    return new Set(['path', 'shape']);
  }
  private saveOpen(): void {
    const open = [...this.secEls].filter(([, s]) => !s.body.hidden).map(([id]) => id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* storage may be blocked */ }
  }
  private loadPrefs(): void {
    try {
      const v = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (v && typeof v === 'object') {
        if (typeof v.c1 === 'string' && /^#[0-9a-f]{6}$/i.test(v.c1)) this.paint.color = rgbOf(v.c1);
        if (typeof v.c2 === 'string' && /^#[0-9a-f]{6}$/i.test(v.c2)) this.paint.color2 = rgbOf(v.c2);
        if (typeof v.size === 'number') this.paint.size = Math.min(1, Math.max(0, v.size));
        if (typeof v.opacity === 'number') this.paint.opacity = Math.min(1, Math.max(0.05, v.opacity));
        if (typeof v.sim === 'boolean') this.simulate = v.sim;
        if (v.paper === 'dark') this.wrapPaper = 'dark';
      }
    } catch { /* storage may be blocked */ }
  }
  private wrapPaper: 'paper' | 'dark' = 'paper';
  private savePrefs(): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ c1: hexOf(this.paint.color), c2: hexOf(this.paint.color2), size: this.paint.size, opacity: this.paint.opacity, sim: this.simulate, paper: this.wrapPaper })); } catch { /* storage may be blocked */ }
  }

  private buildShell(side: HTMLElement, id: string, label: string, content: HTMLElement): void {
    const open = this.openSet().has(id);
    const sec = el<HTMLElement>(`<section class="fm-bs-sec" data-sec="${id}">
      <button type="button" class="fm-bs-sec-head" aria-expanded="${open}"><span class="fm-bs-sec-name">${label}</span><span class="fm-bs-dot" hidden></span>${ICON_CHEV}</button>
      <div class="fm-bs-sec-body"${open ? '' : ' hidden'}></div>
    </section>`);
    const body = q(sec, '.fm-bs-sec-body');
    body.appendChild(content);
    const head = q<HTMLButtonElement>(sec, '.fm-bs-sec-head');
    setClass(sec, 'is-open', open);
    head.addEventListener('click', () => {
      const show = body.hidden !== false;
      body.hidden = !show;
      head.setAttribute('aria-expanded', String(show));
      setClass(sec, 'is-open', show);
      this.saveOpen();
    });
    side.appendChild(sec);
    this.secEls.set(id, { sec, head, body, dot: q(sec, '.fm-bs-dot') });
  }

  private buildSection(side: HTMLElement, id: string, label: string, params: Param[]): void {
    const box = el<HTMLElement>('<div class="fm-bs-rows"></div>');
    for (const p of params) {
      const row = this.buildRow(p);
      box.appendChild(row.root);
      this.rows.set(p.id, row);
    }
    this.buildShell(side, id, label, box);
  }

  private buildRow(p: Param): Row {
    if (p.kind === 'group') return { param: p, root: el(`<div class="fm-bs-group">${p.label}</div>`) };
    if (p.kind === 'num') {
      const root = el<HTMLElement>(`<div class="fm-bs-row" data-id="${p.id}"><span class="fm-bs-lab" title="Double-click to reset">${p.label}</span>
        <input type="range" class="fm-bs-range" min="${p.min}" max="${p.max}" step="${p.step}" aria-label="${p.label}">
        <input type="number" class="fm-bs-num" min="${fmtNum(p.min * p.mul)}" max="${fmtNum(p.max * p.mul)}" step="${fmtNum(p.step * p.mul)}" aria-label="${p.label} value"><span class="fm-bs-unit">${p.unit}</span></div>`);
      return { param: p, root, range: q(root, '.fm-bs-range'), num: q(root, '.fm-bs-num') };
    }
    if (p.kind === 'bool') {
      const root = el<HTMLElement>(`<label class="fm-bs-row is-check" data-id="${p.id}"><span class="fm-bs-lab">${p.label}</span><input type="checkbox" class="fm-bs-chk"></label>`);
      return { param: p, root, check: q(root, '.fm-bs-chk') };
    }
    if (p.kind === 'select') {
      const root = el<HTMLElement>(`<label class="fm-bs-row is-select" data-id="${p.id}"><span class="fm-bs-lab">${p.label}</span><select class="fm-bs-sel">${p.options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select></label>`);
      return { param: p, root, select: q(root, '.fm-bs-sel') };
    }
    if (p.kind === 'pick') {
      const pr = buildPickRow(p.id, p.label, p.what, (id) => this.edit(p.id, (b) => p.set(b, id)));
      return { param: p, root: pr.root, pick: pr };
    }
    const root = el<HTMLElement>(`<div class="fm-bs-row is-file" data-id="${p.id}"><span class="fm-bs-lab">${p.label}</span><span class="fm-bs-info"></span>
      <button type="button" class="fm-bs-btn is-small" data-a="import">Import picture</button><button type="button" class="fm-bs-btn is-small" data-a="remove" hidden>Remove</button></div>`);
    return { param: p, root, info: q(root, '.fm-bs-info'), remove: q(root, '[data-a="remove"]') };
  }

  // ---- wiring ------------------------------------------------------------------------------

  private wire(): void {
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'cancel') this.cancel();
      else if (a === 'done') void this.save();
      else if (a === 'undo') this.undo();
      else if (a === 'reset') this.reset();
      else if (a === 'keep') setHidden(this.discardBar, true);
      else if (a === 'discard') this.close(null);
      else if (a === 'clear') { this.strokes = []; this.scheduleDraw(); }
      else if (a === 'sample') { this.strokes = demoStrokes(); this.scheduleDraw(); }
      else if (a === 'sigclear') { this.clearSignature(); }
      else if (a === 'import' || a === 'remove') {
        const row = b.closest<HTMLElement>('.fm-bs-row');
        const p = row ? this.rows.get(row.dataset.id ?? '')?.param : null;
        if (p && p.kind === 'file') { if (a === 'import') { this.fileFor = p.what; this.fileEl.value = ''; this.fileEl.click(); } else this.removeFile(p.what); }
      }
    });
    this.fileEl.addEventListener('change', () => { const f = this.fileEl.files?.[0]; if (f) void this.importFile(f, this.fileFor); });
    this.copyEl.addEventListener('change', () => this.refreshTitle());

    for (const [id, row] of this.rows) {
      const p = row.param;
      if (p.kind === 'num' && row.range && row.num) {
        const lab = q(row.root, '.fm-bs-lab');
        lab.addEventListener('dblclick', () => this.edit(id, (b) => p.set(b, p.def)));
        row.range.addEventListener('input', () => this.edit(id, (b) => p.set(b, row.range!.valueAsNumber)));
        row.num.addEventListener('change', () => {
          const v = row.num!.valueAsNumber;
          if (!Number.isFinite(v)) { this.syncRow(row); return; }
          this.edit(id, (b) => p.set(b, Math.min(p.max, Math.max(p.min, v / p.mul))));
        });
      } else if (p.kind === 'bool' && row.check) row.check.addEventListener('change', () => this.edit(id, (b) => p.set(b, row.check!.checked)));
      else if (p.kind === 'select' && row.select) row.select.addEventListener('change', () => this.edit(id, (b) => p.set(b, row.select!.value)));
    }

    this.nameEl.addEventListener('input', () => { this.pushHist('name'); this.draft.name = this.nameEl.value; this.refreshTitle(); });
    this.authorEl.addEventListener('input', () => { this.pushHist('author'); if (this.authorEl.value) this.draft.author = this.authorEl.value; else delete this.draft.author; this.syncChrome(); });

    // pad toolbar
    const bar = q(this.root, '.fm-bs-padbar');
    const inp = (k: string): HTMLInputElement => q(bar, `[data-p="${k}"]`);
    inp('size').addEventListener('input', () => { this.paint.size = inp('size').valueAsNumber; this.padChanged(); });
    inp('opacity').addEventListener('input', () => { this.paint.opacity = Math.max(0.05, inp('opacity').valueAsNumber); this.padChanged(); });
    inp('c1').addEventListener('input', () => { this.paint.color = rgbOf(inp('c1').value); this.padChanged(); });
    inp('c2').addEventListener('input', () => { this.paint.color2 = rgbOf(inp('c2').value); this.padChanged(); });
    inp('sim').addEventListener('change', () => { this.simulate = inp('sim').checked; this.savePrefs(); });
    q<HTMLSelectElement>(bar, '[data-p="tool"]').addEventListener('change', (e) => { this.tool = (e.target as HTMLSelectElement).value === 'smudge' ? 'smudge' : 'paint'; });
    q<HTMLSelectElement>(bar, '[data-p="paper"]').addEventListener('change', (e) => {
      this.wrapPaper = (e.target as HTMLSelectElement).value === 'dark' ? 'dark' : 'paper';
      this.applyPadPrefs();
      this.savePrefs();
    });

    // drawing on the pad
    this.canvas.addEventListener('pointerdown', (e) => this.padDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.padMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.padUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.padUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // signature
    this.sigEl.addEventListener('pointerdown', (e) => {
      this.sigDown = true;
      this.sigEl.setPointerCapture(e.pointerId);
      const g = this.sigEl.getContext('2d')!;
      g.strokeStyle = getComputedStyle(this.sigEl).color;
      g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
      const p = this.sigPoint(e);
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 0.01, p.y); g.stroke();
      g.beginPath(); g.moveTo(p.x, p.y);
    });
    this.sigEl.addEventListener('pointermove', (e) => {
      if (!this.sigDown) return;
      const g = this.sigEl.getContext('2d')!;
      const p = this.sigPoint(e);
      g.lineTo(p.x, p.y); g.stroke(); g.beginPath(); g.moveTo(p.x, p.y);
    });
    const sigEnd = (): void => {
      if (!this.sigDown) return;
      this.sigDown = false;
      this.pushHist('signature', true);
      try { this.draft.signature = this.sigEl.toDataURL('image/png'); } catch { /* a tainted canvas cannot happen here */ }
      this.syncChrome();
    };
    this.sigEl.addEventListener('pointerup', sigEnd);
    this.sigEl.addEventListener('pointercancel', sigEnd);
  }

  private sigPoint(e: PointerEvent): { x: number; y: number } {
    const r = this.sigEl.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.sigEl.width, y: ((e.clientY - r.top) / r.height) * this.sigEl.height };
  }

  private loadSignature(): void {
    const g = this.sigEl.getContext('2d')!;
    g.clearRect(0, 0, this.sigEl.width, this.sigEl.height);
    const s = this.draft.signature;
    if (!s) return;
    const img = new Image();
    img.onload = () => { g.clearRect(0, 0, this.sigEl.width, this.sigEl.height); g.drawImage(img, 0, 0, this.sigEl.width, this.sigEl.height); };
    img.src = s;
  }

  private clearSignature(): void {
    this.pushHist('signature', true);
    delete this.draft.signature;
    this.sigEl.getContext('2d')!.clearRect(0, 0, this.sigEl.width, this.sigEl.height);
    this.syncChrome();
  }

  // ---- state ---------------------------------------------------------------------------------

  /** Records the draft before a change; changes of one control within a moment share one undo step. */
  private pushHist(id: string, force = false): void {
    const now = performance.now();
    if (!force && this.lastPush.id === id && now - this.lastPush.at < 700) { this.lastPush.at = now; return; }
    this.lastPush = { id, at: now };
    this.hist.push(cloneBrush(this.draft));
    if (this.hist.length > 100) this.hist.shift();
  }

  private edit(id: string, fn: (b: Brush) => void): void {
    this.pushHist(id);
    fn(this.draft);
    this.syncAll();
    this.scheduleDraw();
  }

  private undo(): void {
    const prev = this.hist.pop();
    if (!prev) return;
    this.draft = prev;
    this.lastPush = { id: '', at: 0 };
    this.syncAll();
    this.loadSignature();
    this.scheduleDraw();
  }

  private reset(): void {
    this.pushHist('reset', true);
    this.draft = cloneBrush(this.orig);
    this.syncAll();
    this.loadSignature();
    this.scheduleDraw();
  }

  private dirty(): boolean {
    return Object.keys(brushDiff(this.orig, this.draft)).length > 0 || this.draft.name !== this.orig.name;
  }

  private syncAll(): void {
    const b = this.draft;
    const flags = new Map<string, boolean>();
    for (const row of this.rows.values()) this.syncRow(row, b, flags);
    this.curves.sync(b);
    if (b.curves) flags.set('curves', true);
    for (const [id, s] of this.secEls) setHidden(s.dot, !flags.get(id));
    if (document.activeElement !== this.nameEl && this.nameEl.value !== b.name) this.nameEl.value = b.name;
    if (document.activeElement !== this.authorEl && this.authorEl.value !== (b.author ?? '')) this.authorEl.value = b.author ?? '';
    this.syncChrome();
  }

  private syncChrome(): void {
    const b = this.draft;
    setText(this.dateEl, b.created ? dateText(b.created) : t('Not saved yet'));
    this.undoBtn.disabled = this.hist.length === 0;
    this.resetBtn.disabled = !this.dirty();
    this.refreshTitle();
    this.drawStamp();
  }

  /** The stamp preview: one dab of the draft brush at full pressure, redrawn only when the brush or colors change. */
  private drawStamp(): void {
    const cv = this.stampEl ?? (this.stampEl = q<HTMLCanvasElement>(this.root, '.fm-bs-stamp'));
    const c = this.paint.color;
    const key = `${JSON.stringify(this.draft, (k, v) => (k === 'data' || k === 'grainImage' || k === 'signature' ? undefined : v))}|${c.r},${c.g},${c.b}|${this.wrap.classList.contains('is-paper')}`;
    if (key === this.stampKey) return;
    this.stampKey = key;
    const g = cv.getContext('2d');
    if (!g) return;
    const r = renderStampPreview(this.draft, cv.width, c);
    g.fillStyle = this.wrap.classList.contains('is-paper') ? '#f4f1ea' : '#26262b';
    g.fillRect(0, 0, cv.width, cv.height);
    const tmp = document.createElement('canvas');
    tmp.width = r.width; tmp.height = r.height;
    tmp.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
    g.drawImage(tmp, 0, 0);
  }

  private refreshTitle(): void {
    const keep = this.builtIn && this.copyEl.checked;
    setText(this.titleEl, this.draft.name + (this.isNew ? ` · ${t('New brush')}` : keep ? ` · ${t('copy')}` : ''));
  }

  private syncRow(row: Row, b: Brush = this.draft, flags?: Map<string, boolean>): void {
    const p = row.param;
    if (p.kind === 'num' && row.range && row.num) {
      const v = p.get(b);
      const rv = String(Math.round(v * 1e6) / 1e6);
      if (row.range.valueAsNumber !== v && row.range.value !== rv) row.range.value = rv;
      const nv = fmtNum(v * p.mul);
      if (document.activeElement !== row.num && row.num.value !== nv) row.num.value = nv;
      const set = Math.abs(v - p.def) > 1e-9;
      setClass(row.root, 'is-set', set);
      if (set && flags) flags.set(this.sectionOf(p.id), true);
    } else if (p.kind === 'bool' && row.check) {
      const v = p.get(b);
      if (row.check.checked !== v) row.check.checked = v;
      setClass(row.root, 'is-set', v);
      if (v && flags) flags.set(this.sectionOf(p.id), true);
    } else if (p.kind === 'select' && row.select) {
      let v = p.get(b);
      if (!p.options.some((o) => o.value === v)) v = p.options[0].value;
      if (row.select.value !== v) row.select.value = v;
      const set = v !== p.options[0].value && !(p.id === 'grainMode' && v === 'texturized') && !(p.id === 'tip' && v === 'round');
      setClass(row.root, 'is-set', set);
      if (set && flags) flags.set(this.sectionOf(p.id), true);
    } else if (p.kind === 'pick' && row.pick) {
      row.pick.sync(b);
      if (flags && (p.what === 'tip' ? b.tipId : b.grainId)) flags.set(this.sectionOf(p.id), true);
    } else if (p.kind === 'file') {
      const has = p.what === 'tip' ? !!b.tipImage : !!b.grainImage;
      setText(row.info!, has ? (p.what === 'tip' ? t('Picture in use') : t('Picture in use')) : t('None'));
      setHidden(row.remove!, !has);
      setClass(row.root, 'is-set', has);
      if (has && flags) flags.set(this.sectionOf(p.id), true);
    }
  }

  private sectionOf(id: string): string {
    for (const s of SECTIONS) if (s.params.some((p) => p.id === id)) return s.id;
    return '';
  }

  // ---- pictures ------------------------------------------------------------------------------

  private async importFile(file: File, what: 'tip' | 'grain'): Promise<void> {
    try {
      const bmp = await createImageBitmap(file);
      const side = 256;
      let w = bmp.width, h = bmp.height;
      if (what === 'grain') { w = side; h = side; } else if (Math.max(w, h) > side) { const k = side / Math.max(w, h); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const px = g.getImageData(0, 0, w, h).data;
      let hasAlpha = false;
      for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { hasAlpha = true; break; }
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) {
        const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        // a stamp: dark is paint (or the cut-out's alpha); a grain: light is the raised part
        out[i] = what === 'tip' ? (hasAlpha ? px[i * 4 + 3] : Math.round(255 - lum)) : Math.round(hasAlpha ? lum * (px[i * 4 + 3] / 255) : lum);
      }
      this.edit(what === 'tip' ? 'tipFile' : 'grainFile', (b) => {
        if (what === 'tip') {
          const img: TipImage = { w, h, data: out, key: `studio-${Date.now().toString(36)}` };
          b.tipImage = img; b.tip = 'sampled'; delete b.tipId;
        } else {
          b.grainImage = out; delete b.grainId;
          if (b.grain <= 0) b.grain = 0.7;
        }
      });
    } catch { /* an unreadable picture leaves the brush as it was */ }
  }

  private removeFile(what: 'tip' | 'grain'): void {
    this.edit(what === 'tip' ? 'tipFile' : 'grainFile', (b) => {
      if (what === 'tip') { delete b.tipImage; if (b.tip === 'sampled') b.tip = 'round'; } else delete b.grainImage;
    });
  }

  // ---- the pad ---------------------------------------------------------------------------

  private applyPadPrefs(): void {
    setClass(this.wrap, 'is-paper', this.wrapPaper === 'paper');
    setClass(this.wrap, 'is-dark', this.wrapPaper === 'dark');
    const bar = q(this.root, '.fm-bs-padbar');
    const set = (k: string, v: string): void => { const n = q<HTMLInputElement>(bar, `[data-p="${k}"]`); if (n.value !== v) n.value = v; };
    set('size', String(this.paint.size)); set('opacity', String(this.paint.opacity));
    set('c1', hexOf(this.paint.color)); set('c2', hexOf(this.paint.color2));
    set('paper', this.wrapPaper);
    q<HTMLInputElement>(bar, '[data-p="sim"]').checked = this.simulate;
    setText(q(bar, '[data-o="size"]'), `${Math.round(this.paint.size * 100)}%`);
    setText(q(bar, '[data-o="opacity"]'), `${Math.round(this.paint.opacity * 100)}%`);
  }

  private padChanged(): void {
    this.applyPadPrefs();
    this.savePrefs();
    this.scheduleDraw();
  }

  private resize(): void {
    const r = this.wrap.getBoundingClientRect();
    const w = Math.max(64, Math.round(r.width)), h = Math.max(64, Math.round(r.height));
    if (this.canvas.width === w && this.canvas.height === h && this.raster.width === w) return;
    this.canvas.width = w; this.canvas.height = h;
    this.draw();
  }

  private scheduleDraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  private draw(): void {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const w = this.canvas.width, h = this.canvas.height;
    this.raster = renderPad(this.draft, this.strokes, w, h, this.paint);
    this.ctx.putImageData(new ImageData(this.raster.data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  }

  private toPadEvent(e: PointerEvent, st: NonNullable<BrushStudio['live']>): PadEvent {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const t = e.timeStamp - st.t0;
    const pen = e.pointerType === 'pen';
    if (pen || !this.simulate) {
      return { x, y, p: pen ? (e.pressure > 0 ? e.pressure : 0.5) : 1, tx: pen ? e.tiltX || 0 : 0, ty: pen ? e.tiltY || 0 : 0, tw: pen ? e.twist || 0 : 0, t, k: pen ? 'pen' : (e.pointerType === 'touch' ? 'touch' : 'mouse') };
    }
    // a mouse has no pressure or tilt: make a plausible pen from distance travelled, speed and heading
    const px = x * r.width, py = y * r.height;
    const dx = px - st.lx, dy = py - st.ly, dt = Math.max(1, t - st.lt);
    const d = Math.hypot(dx, dy);
    st.travel += d;
    if (d > 0.5) st.dir = Math.atan2(dy, dx);
    const speed = d / dt;
    st.lx = px; st.ly = py; st.lt = t;
    const p = Math.min(1, Math.max(0.08, 0.25 + 0.75 * Math.min(1, st.travel / 70) - 0.4 * Math.min(1, speed / 2.4)));
    return { x, y, p, tx: Math.round(36 * Math.cos(st.dir)), ty: Math.round(36 * Math.sin(st.dir)), tw: 0, t, k: 'pen' };
  }

  private padDown(e: PointerEvent): void {
    if (this.live || e.button > 0) return;
    if (this.raf) this.draw();
    this.canvas.setPointerCapture(e.pointerId);
    const seed = (Math.random() * 0x7fffffff) | 0;
    const r = this.canvas.getBoundingClientRect();
    const run = new PadRunner(this.raster, this.draft, this.paint, seed, this.tool);
    const st = { run, tool: this.tool, ev: [] as PadEvent[], t0: e.timeStamp, seed, id: e.pointerId, travel: 0, lx: e.clientX - r.left, ly: e.clientY - r.top, lt: 0, dir: 0 };
    this.live = st;
    const pe = this.toPadEvent(e, st);
    st.ev.push(pe);
    this.blit(run.down(pe));
  }

  private padMove(e: PointerEvent): void {
    const st = this.live;
    if (!st || e.pointerId !== st.id) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of list.length ? list : [e]) {
      const pe = this.toPadEvent(ev, st);
      st.ev.push(pe);
      this.blit(st.run.move(pe));
    }
  }

  private padUp(e: PointerEvent): void {
    const st = this.live;
    if (!st || e.pointerId !== st.id) return;
    this.live = null;
    const pe = this.toPadEvent(e, st);
    st.ev.push(pe);
    this.blit(st.run.up(pe));
    this.strokes.push(st.tool === 'smudge' ? { seed: st.seed, ev: st.ev, tool: 'smudge' } : { seed: st.seed, ev: st.ev });
  }

  private blit(rect: { x: number; y: number; w: number; h: number } | null): void {
    if (!rect) return;
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const w = Math.min(this.raster.width - x, rect.w), h = Math.min(this.raster.height - y, rect.h);
    if (w <= 0 || h <= 0) return;
    this.ctx.putImageData(new ImageData(this.raster.data as Uint8ClampedArray<ArrayBuffer>, this.raster.width, this.raster.height), 0, 0, x, y, w, h);
  }

  // ---- finishing -----------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.done) return;
    const inText = e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number');
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.discardBar.hidden) setHidden(this.discardBar, true); else this.cancel();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inText) {
      e.preventDefault();
      this.undo();
    }
    // the drawing behind does not get the studio's keys
    if (!(e.target instanceof Node) || this.root.contains(e.target)) e.stopPropagation();
  }

  private cancel(): void {
    if (this.dirty()) setHidden(this.discardBar, false); else this.close(null);
  }

  private async save(): Promise<void> {
    const d = this.draft;
    if (!d.name.trim()) d.name = this.orig.name;
    let id = this.opts.brushId;
    if (this.isNew) {
      const nid = brushStore.duplicate(id);
      if (!nid) { this.close(null); return; }
      id = nid;
      if (this.opts.setId && brushStore.set(this.opts.setId)) brushStore.move(id, this.opts.setId);
    } else if (this.builtIn && this.copyEl.checked) {
      if (!this.dirty()) { this.close(null); return; }
      const nid = brushStore.duplicate(id);
      if (!nid) { this.close(null); return; }
      id = nid;
    }
    if (!d.created) d.created = Date.now();
    const target = brushStore.brush(id);
    if (!target) { this.close(null); return; }
    const patch = brushDiff(target, d) as Record<string, unknown>;
    // an original starter brush keeps its saved edits as a patch on top of the starter, so a removed field is written as its default
    if (!target.custom) {
      for (const k of Object.keys(patch)) {
        if (patch[k] !== undefined) continue;
        const p = allParams().find((x) => x.id === k);
        if (p?.kind === 'num') patch[k] = p.def;
        else if (p?.kind === 'bool') patch[k] = false;
        else if (k === 'blend') patch[k] = 'normal';
        else if (k === 'grainBlend') patch[k] = 'multiply';
        else if (k === 'colorDyn') patch[k] = {};
      }
    }
    if (Object.keys(patch).length) brushStore.edit(id, patch as Partial<Brush>);
    // a copy keeps the store's "copy" name until the person types another
    if (this.isNew ? d.name !== target.name : d.name !== this.orig.name) brushStore.rename(id, d.name);
    this.opts.onSaved?.(id);
    this.close(id);
  }

  private close(id: string | null): void {
    if (this.done) return;
    this.done = true;
    window.removeEventListener('keydown', this.keyHandler, true);
    this.ro?.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.root.remove();
    const f = this.returnFocus;
    if (f instanceof HTMLElement && f.isConnected) f.focus({ preventScroll: true });
    this.finish(id);
  }
}

// Kept so the parameter check can build the same list the editor shows.
export type StudioParam = NumParam | BoolParam | SelectParam;
