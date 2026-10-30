// The floating Flipbook frame strip (Phase 5): rows of frame cells under a ruler, bottom centre of the Draw & Paint view.
// Built once; refresh() patches rows and cells in place by key and never rebuilds a mounted subtree.
import {
  addFlipTrack, clearFrame, cloneFlipTrack, deleteFlipTrack, deleteFrame, deleteFrames, duplicateFrame, fillFrame, flipFrames, insertFlipTrack, insertFrame, moveFlipTrack, moveFrames,
  pasteFrames, pasteIntoFree, patchFlipTrack, pullFrame, pushFrame, setHold, setHolds, splitFrame, type FrameRef,
} from '../engine/flip-ops';
import { flipLength, flipStartOf } from '../engine/model';
import { isMaskRow } from '../engine/flip-draw';
import { flipDuration } from '../engine/flip-ops';
import { FlipPreview } from './flip-preview';
import { FlipSelect, Lasso } from './flip-select';
import { ScrubWheel } from './flip-wheel';
import { loadPrefs } from './prefs';
import { BLEND_MODES, HIGHLIGHTS, type BlendMode, type Content, type FlipTrack, type FlipbookFrame, type Highlight } from '../engine/types';
import { el, patchList, q, setClass, setHidden, setStyleVar, setText } from './dom';
import { icon } from './icons';
import { Popover, popField, popRow, popSep } from './popover';

export interface StripHost {
  content(): Content | null;
  row(): number;
  index(): number;
  select(row: number, index: number): void;
  run(label: string, fn: (c: Content) => Content, merge?: string): void;
  playing(): boolean;
  togglePlay(): void;
  thumb(row: number, index: number, w: number, h: number): CanvasImageSource | null;
  /** A signature of a frame's unsaved painting (open or parked), or '' when it has none: the cell redraws when it changes. */
  liveKey?(row: number, index: number): string;
  fps(): number;
  /** The mini preview: the movie size, and a loop frame drawn (live frame included) into a scaled context. */
  movieSize(): { w: number; h: number } | null;
  drawPreview(ctx: CanvasRenderingContext2D, w: number, h: number, local: number): void;
  /** The movie fps loop frame the open flipbook shows during playback (for the Mini Flipbook). */
  playAt?(): number;
}

const COL = 36;
const CELL_H = 26;
const TW = 68;
const TH = 52;
const LONG_PRESS = 500;

/** Shared across strips: copied frames stay until the next copy. */
let clipboard: FlipbookFrame[] = [];
/** The copied frames by id: an edit first saves the open frame's unsaved painting, so Paste reads the frames from the content it is given, not from the copy-time snapshot. */
let clipRefs: FrameRef[] | null = null;
/** Copied or cut row, for Paste on a track. */
let trackClip: FlipTrack | null = null;
let trackClipId = '';
const HL_LABEL = (h: Highlight): string => h.charAt(0).toUpperCase() + h.slice(1);

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const ICO = {
  cut: svg('<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M7.6 16 18 4M16.4 16 6 4"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8"/>'),
  paste: svg('<rect x="5" y="5" width="14" height="16" rx="2.2"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 12h6M9 16h4"/>'),
  dup: svg('<rect x="3.5" y="7" width="11" height="13" rx="2.2"/><path d="M9 4h9a2.5 2.5 0 0 1 2.5 2.5V16"/>'),
  preview: svg('<rect x="3" y="5" width="18" height="14" rx="2.4"/><path d="M10 9.4v5.2l4.4-2.6z" fill="currentColor"/>'),
  tracks: svg('<rect x="3" y="4" width="18" height="4.4" rx="1.4"/><rect x="3" y="10" width="18" height="4.4" rx="1.4"/><rect x="3" y="16" width="18" height="4.4" rx="1.4"/>'),
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
  multi: svg('<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" stroke-dasharray="2.4 2.4"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" stroke-dasharray="2.4 2.4"/><path d="M14.5 17l2.2 2.2 4-4.4"/>'),
  chev: svg('<path d="M7 10l5 5 5-5"/>'),
  mini: svg('<rect x="3" y="14" width="18" height="6" rx="2"/><path d="M12 11V4m-3 3 3-3 3 3"/>'),
  prev: svg('<path d="M15 6l-6 6 6 6"/>'),
  next: svg('<path d="M9 6l6 6-6 6"/>'),
};
const glyph = (s: string, size = 16): string => `<span class="icon" style="width:${size}px;height:${size}px" aria-hidden="true">${s}</span>`;

interface RowItem { t: FlipTrack; r: number }
interface CellItem { f: FlipbookFrame; r: number; i: number; start: number; t: FlipTrack }

export class FlipStrip {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly playIco: HTMLElement;
  private readonly playLab: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly rulerInner: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly cellMenu: Popover;
  private readonly rowMenu: Popover;
  private readonly shots = new WeakMap<HTMLElement, HTMLCanvasElement>();
  /** True while a drag across the cells scrubs frames (paint-view hides the onions then if asked). */
  scrubbing = false;
  /** Called when scrubbing starts or stops so the Stage can redraw. */
  onScrub?: () => void;
  private sx = 0;
  private laneW = 400;
  private cols = 0;
  private lastSel = '';
  private cellTarget: { track: string; frame: string } | null = null;
  private rowTarget: string | null = null;
  private cellXY = { x: 0, y: 0 };
  private cellOff = 0;
  private reloadTimer = 0;
  private reloaded = false;
  private pressTimer = 0;
  private suppressClick = false;
  private ro: ResizeObserver | null = null;
  readonly preview: FlipPreview;
  private previewBtn: HTMLElement | null = null;
  private readonly cm: {
    cut: ReturnType<typeof tile>; copy: ReturnType<typeof tile>; paste: ReturnType<typeof tile>; dup: ReturnType<typeof tile>;
    hold: ReturnType<typeof popField>; clear: ReturnType<typeof popRow>; del: ReturnType<typeof popRow>; ins: ReturnType<typeof popRow>;
    split: ReturnType<typeof popRow>; fill: ReturnType<typeof popRow>; flip: ReturnType<typeof popRow>; opts: ReturnType<typeof popRow>;
  };
  private readonly rm: {
    rename: ReturnType<typeof popRow>; toggle: ReturnType<typeof popRow>; up: ReturnType<typeof popRow>; down: ReturnType<typeof popRow>; del: ReturnType<typeof popRow>;
    range: HTMLInputElement; pct: HTMLElement;
    maskNone: ReturnType<typeof popRow>; maskClip: ReturnType<typeof popRow>; maskAlpha: ReturnType<typeof popRow>; maskLuma: ReturnType<typeof popRow>; invert: ReturnType<typeof popRow>;
    cut: ReturnType<typeof tile>; copy: ReturnType<typeof tile>; paste: ReturnType<typeof tile>; dup: ReturnType<typeof tile>;
    hlRows: Map<Highlight, ReturnType<typeof popRow>>; blendRows: Map<BlendMode, ReturnType<typeof popRow>>; hl: ReturnType<typeof popRow>; blend: ReturnType<typeof popRow>;
  };
  private readonly subPanels: HTMLElement[] = [];
  readonly sel = new FlipSelect();
  private readonly lasso: Lasso;
  private readonly dropLine: HTMLElement;
  private readonly multiBtn: HTMLElement;
  private readonly body: HTMLElement;
  /** Cells into the open frame's hold the playhead sits at (a click inside a held cell). */
  private within = 0;
  private withinKey = '';
  /** Called when the Mini Flipbook toggle is pressed. */
  onMini: (() => void) | null = null;
  /** Called after every paint; `true` when the thumbnails were thrown away (the Mini Flipbook redraws its own). */
  onPaint: ((invalid: boolean) => void) | null = null;
  private miniBtn: HTMLElement | null = null;
  private stepHeld = false;
  /** The scrub wheel with Scrub Lock in the strip's header. */
  readonly wheel: ScrubWheel;

  constructor(private readonly host: StripHost) {
    this.root = el<HTMLElement>(
      `<div class="fm-fs" tabindex="0" role="group" aria-label="Flipbook frames">` +
        `<div class="fm-fs-head"><button class="fm-fs-play" type="button"><span class="fm-fs-play-ico"></span><span class="fm-fs-play-lab">Play</span></button>` +
        `<button class="fm-fs-ib fm-fs-step" data-act="prev" type="button" title="Previous drawing (hold for the first)" aria-label="Previous drawing">${glyph(ICO.prev, 16)}</button>` +
        `<button class="fm-fs-ib fm-fs-step" data-act="next" type="button" title="Next drawing (hold for the last)" aria-label="Next drawing">${glyph(ICO.next, 16)}</button>` +
        `<span class="fm-fs-grip" aria-hidden="true"></span><span class="fm-fs-wheelslot"></span>` +
        `<button class="fm-fs-ib has-lab" data-act="mini" type="button" title="Mini Flipbook: a small floating strip with a scrub wheel" aria-label="Mini Flipbook">${glyph(ICO.mini, 18)}<span class="fm-fs-iblab">Mini</span></button>` +
        `<button class="fm-fs-ib has-lab" data-act="preview" type="button" title="Mini preview: watch the loop while you draw" aria-label="Mini preview">${glyph(ICO.preview, 18)}<span class="fm-fs-iblab">Preview</span></button>` +
        `<button class="fm-fs-ib has-lab" data-act="multi" type="button" title="Multi-select (hold to reload the last selection)" aria-label="Multi-select">${glyph(ICO.multi, 18)}<span class="fm-fs-iblab">Select</span></button>` +
        `<button class="fm-fs-ib has-lab" data-act="track" type="button" title="Add track" aria-label="Add track">${glyph(ICO.tracks, 18)}<span class="fm-fs-iblab">Track</span></button>` +
        `<button class="fm-fs-ib has-lab" data-act="frame" type="button" title="Add frame (press and hold, or Alt: add after the hold)" aria-label="Add frame">${icon('plus', 18)}<span class="fm-fs-iblab">Frame</span></button>` +
        `<button class="fm-fs-ib" data-act="hide" type="button" title="Hide or show the frames" aria-label="Hide frames">${glyph(ICO.chev, 16)}</button></div>` +
        `<div class="fm-fs-body"><div class="fm-fs-rulerrow"><div class="fm-fs-corner"></div><div class="fm-fs-ruler"><div class="fm-fs-ruler-in"></div></div></div>` +
        `<div class="fm-fs-rows"></div><div class="fm-fs-drop" hidden></div></div></div>`);
    this.body = q(this.root, '.fm-fs-body');
    this.lasso = new Lasso(this.body);
    this.dropLine = q(this.root, '.fm-fs-drop');
    this.multiBtn = q(this.root, '[data-act="multi"]');
    this.miniBtn = q(this.root, '[data-act="mini"]');
    this.head = q(this.root, '.fm-fs-head');
    this.wheel = new ScrubWheel(this.host);
    this.wheel.onScrub = () => { this.scrubbing = this.wheel.scrubbing; this.onScrub?.(); };
    q(this.root, '.fm-fs-wheelslot').appendChild(this.wheel.root);
    this.playBtn = q(this.root, '.fm-fs-play');
    this.playIco = q(this.root, '.fm-fs-play-ico');
    this.playLab = q(this.root, '.fm-fs-play-lab');
    this.ruler = q(this.root, '.fm-fs-ruler');
    this.rulerInner = q(this.root, '.fm-fs-ruler-in');
    this.rows = q(this.root, '.fm-fs-rows');

    this.cellMenu = new Popover('fm-fs-menu', 232);
    this.rowMenu = new Popover('fm-fs-menu', 232);
    this.cm = this.buildCellMenu();
    this.rm = this.buildRowMenu();
    this.wire();
    this.previewBtn = q(this.root, '[data-act="preview"]');
    this.preview = new FlipPreview({
      size: () => this.host.movieSize(),
      length: () => { const c = this.host.content(); return c ? flipDuration(c) : 0; },
      fps: () => this.host.fps(),
      draw: (ctx, w, h, local) => this.host.drawPreview(ctx, w, h, local),
    });
    this.preview.onChange(() => this.paint());
    this.ro = new ResizeObserver(() => { this.measure(); this.paint(); });
    this.ro.observe(this.ruler);
    this.refresh();
  }

  /** Forget drawn thumbnails so the next refresh draws them all again. */
  invalidate(): void {
    for (const n of Array.from(this.rows.querySelectorAll<HTMLElement>('.fm-fs-cell'))) delete n.dataset.sig;
    this.refresh();
    this.onPaint?.(true);
  }

  refresh(): void { this.paint(); }

  dispose(): void {
    window.clearTimeout(this.pressTimer);
    this.ro?.disconnect();
    this.preview.dispose();
    this.cellMenu.hide();
    this.rowMenu.hide();
    this.cellMenu.el.remove();
    this.rowMenu.el.remove();
    for (const p of this.subPanels) p.remove();
    this.root.remove();
  }

  // ---- painting ----

  private measure(): void {
    const w = this.ruler.clientWidth;
    if (w > 0) this.laneW = w;
  }

  private clampScroll(): void {
    // the ends can reach the centre mark so the first and last frames can be centred too
    const half = Math.floor(this.laneW / 2);
    const max = Math.max(0, this.cols * COL - this.laneW + COL) + half;
    this.sx = Math.max(-half, Math.min(max, this.sx));
  }

  private paint(): void {
    const c = this.host.content();
    const list = c?.flip ?? [];
    if (c) this.sel.prune(c);
    const ar = this.host.row();
    const ai = this.host.index();
    this.cols = list.reduce((m, t) => Math.max(m, flipLength(t)), 0);
    const active = list[ar];
    const aStart = active ? flipStartOf(active, ai) : 0;
    const aHold = active?.frames[ai] ? Math.max(1, active.frames[ai].hold) : 1;

    const playing = this.host.playing();
    this.playBtn.classList.toggle('is-playing', playing);
    if (this.playIco.dataset.on !== (playing ? '1' : '0')) {
      this.playIco.dataset.on = playing ? '1' : '0';
      this.playIco.replaceChildren(el(glyph(playing ? ICO.pause : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5z"/></svg>', 14)));
    }
    setText(this.playLab, playing ? 'Pause' : 'Play');

    this.measure();
    const sel = `${active?.id ?? ''}:${ai}:${this.laneW}`;
    if (sel !== this.lastSel) {
      this.lastSel = sel;
      // centre-locked: the open frame sits mid-strip and the frames scroll under it
      const from = aStart * COL;
      const to = (aStart + aHold) * COL;
      this.sx = Math.round((from + to) / 2 - this.laneW / 2);
    }
    this.clampScroll();
    setStyleVar(this.root, '--sx', `${-this.sx}px`);

    // ruler: one tiny node per column, keyed by column number
    const nums: number[] = [];
    for (let n = 1; n <= this.cols; n++) nums.push(n);
    patchList(this.rulerInner, nums, {
      key: (n) => String(n),
      create: (n) => { const s = el(`<span class="fm-fs-num">${n}</span>`); setClass(s, 'is-cur', n > aStart && n <= aStart + aHold); return s; },
      update: (node, n) => setClass(node, 'is-cur', n > aStart && n <= aStart + aHold),
    });
    setStyleVar(this.rulerInner, 'width', `${this.cols * COL}px`);

    const items: RowItem[] = list.map((t, r) => ({ t, r }));
    patchList(this.rows, items, {
      key: (it) => it.t.id,
      create: (it) => { const n = this.createRow(it); this.updateRow(n, it, ar, ai); return n; },
      update: (node, it) => this.updateRow(node, it, ar, ai),
    });
    setClass(this.rows, 'is-scroll', list.length > 3);
    setClass(this.multiBtn, 'is-on', this.sel.multi);
    setClass(this.root, 'is-multi', this.sel.multi);
    setHidden(this.root, !c);
    if (this.previewBtn) setClass(this.previewBtn, 'is-on', this.preview.isOn());
    this.preview.sync(!!c);
    this.onPaint?.(false);
  }

  private createRow(_it: RowItem): HTMLElement {
    return el<HTMLElement>(
      `<div class="fm-fs-row"><div class="fm-fs-label"><input class="fm-fs-vis" type="checkbox" aria-label="Visible">` +
        `<span class="fm-fs-name"></span><button class="fm-fs-opts" type="button" tabindex="-1" title="Track options" aria-label="Track options">${glyph(ICO.chev, 12)}</button>` +
        `<input class="fm-fs-rename" type="text" spellcheck="false" hidden></div>` +
        `<div class="fm-fs-lane"><div class="fm-fs-lane-in"></div></div></div>`);
  }

  private updateRow(node: HTMLElement, it: RowItem, ar: number, ai: number): void {
    const { t, r } = it;
    const label = q<HTMLElement>(node, '.fm-fs-label');
    const vis = q<HTMLInputElement>(node, '.fm-fs-vis');
    if (vis.checked !== !t.hidden) vis.checked = !t.hidden;
    setText(q(node, '.fm-fs-name'), t.name);
    setClass(label, 'is-active', r === ar);
    setClass(node, 'is-hidden', t.hidden);
    setClass(node, 'is-mask', isMaskRow(t));
    setClass(node, 'is-clip', t.mask === 'clipping');
    setClass(node, 'is-blend', t.blend !== 'normal');
    if (label.dataset.hl !== t.highlight) label.dataset.hl = t.highlight;
    const inner = q<HTMLElement>(node, '.fm-fs-lane-in');
    const lo = Math.floor(this.sx / COL) - 6;
    const hi = Math.ceil((this.sx + this.laneW) / COL) + 6;
    let start = 0;
    const cells: CellItem[] = t.frames.map((f, i) => {
      const it2 = { f, r, i, start, t };
      start += Math.max(1, f.hold);
      return it2;
    });
    const upd = (cell: HTMLElement, c: CellItem): void => {
      const hold = Math.max(1, c.f.hold);
      setStyleVar(cell, 'width', `${hold * COL - 2}px`);
      setClass(cell, 'is-cur', c.r === ar && c.i === ai);
      setClass(cell, 'is-held', hold > 1);
      setClass(cell, 'is-sel', this.sel.has(t.id, c.f.id));
      if ((cell.dataset.name ?? '') !== (c.f.name ?? '')) { if (c.f.name) { cell.dataset.name = c.f.name; cell.title = c.f.name; } else { delete cell.dataset.name; cell.removeAttribute('title'); } }
      setText(q(cell, '.fm-fs-hold'), hold > 1 ? `×${hold}` : '');
      if (c.start + hold >= lo && c.start <= hi) this.drawCell(cell, c);
    };
    patchList(inner, cells, {
      key: (c) => c.f.id,
      create: (c) => { const n = el<HTMLElement>(`<div class="fm-fs-cell"><span class="fm-fs-hold"></span><span class="fm-fs-trim" title="Drag to change how long the frame is held"></span></div>`); upd(n, c); return n; },
      update: upd,
    });
  }

  private drawCell(cell: HTMLElement, c: CellItem): void {
    const sig = c.f.layers.map((l) => `${l.id}:${l.pixels ?? ''}:${l.visible ? 1 : 0}:${l.opacity}:${l.blend}:${l.parent ?? ''}:${l.mask ?? ''}${l.maskOn === false ? 'off' : ''}`).join('|') + `#${Math.max(1, c.f.hold)}`;
    const live = this.host.liveKey?.(c.r, c.i) ?? '';
    const sigAll = live ? `${sig}~${live}` : sig;
    if (cell.dataset.sig === sigAll) return;
    let cv = this.shots.get(cell);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = TW;
      cv.height = TH;
      cv.className = 'fm-fs-shot';
      cell.insertBefore(cv, cell.firstChild);
      this.shots.set(cell, cv);
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (!live && c.f.layers.every((l) => l.pixels === null)) {
      ctx.clearRect(0, 0, TW, TH);
      cell.dataset.sig = sigAll;
      return;
    }
    const src = this.host.thumb(c.r, c.i, TW, TH);
    if (!src) return;
    const s = src as unknown as { width: number; height: number };
    const k = Math.min(TW / (s.width || TW), TH / (s.height || TH));
    const w = (s.width || TW) * k;
    const h = (s.height || TH) * k;
    ctx.clearRect(0, 0, TW, TH);
    ctx.drawImage(src, (TW - w) / 2, (TH - h) / 2, w, h);
    cell.dataset.sig = sigAll;
  }

  // ---- lookup ----

  private find(trackId: string, frameId?: string): { c: Content; r: number; i: number; t: FlipTrack } | null {
    const c = this.host.content();
    if (!c) return null;
    const r = c.flip.findIndex((t) => t.id === trackId);
    if (r < 0) return null;
    const t = c.flip[r];
    const i = frameId ? t.frames.findIndex((f) => f.id === frameId) : -1;
    return { c, r, i, t };
  }

  private cellAt(n: HTMLElement | null): { track: string; frame: string } | null {
    const cell = n?.closest<HTMLElement>('.fm-fs-cell');
    const row = cell?.closest<HTMLElement>('.fm-fs-row');
    if (!cell || !row || !cell.dataset.key || !row.dataset.key) return null;
    return { track: row.dataset.key, frame: cell.dataset.key };
  }

  // ---- edits ----

  private clampSel(r: number, i: number): void {
    const c = this.host.content();
    if (!c || !c.flip.length) return;
    const row = Math.max(0, Math.min(c.flip.length - 1, r));
    this.host.select(row, Math.max(0, Math.min(c.flip[row].frames.length - 1, i)));
  }

  /** Cells into the open frame's hold the playhead was put at; 0 once the open frame changed by other means. */
  private curWithin(): number {
    const t = this.host.content()?.flip[this.host.row()];
    return this.withinKey === `${t?.id ?? ''}:${this.host.index()}` ? this.within : 0;
  }

  /** Add Frame: inside a hold it ends the hold at the playhead (Alt keeps the hold and adds after it); on the last frame of a row it adds to every row. */
  private addFrame(alt = false): void {
    const c = this.host.content();
    const r = this.host.row(), i = this.host.index();
    const t = c?.flip[r];
    const f = t?.frames[i];
    if (!c || !t || !f) return;
    const w = this.curWithin();
    if (!alt && f.hold > 1 && w < f.hold - 1) {
      this.host.run('Add frame', (x) => insertFrame(setHold(x, r, i, w + 1), r, i));
    } else if (i === t.frames.length - 1 && c.flip.length > 1) {
      this.host.run('Add frame', (x) => x.flip.reduce((acc, row, k) => insertFrame(acc, k, row.frames.length - 1), x));
    } else this.host.run('Add frame', (x) => insertFrame(x, r, i));
    this.clampSel(r, i + 1);
  }

  private addTrack(): void {
    const fps = this.host.fps();
    this.host.run('Add track', (c) => addFlipTrack(c, fps));
    this.clampSel(0, this.host.index());
  }

  private step(d: number): void {
    const c = this.host.content();
    const t = c?.flip[this.host.row()];
    if (!t) return;
    const i = Math.max(0, Math.min(t.frames.length - 1, this.host.index() + d));
    if (i !== this.host.index()) this.host.select(this.host.row(), i);
  }

  /** Index the active frame ends up at after the frame list of the active row changed at `at`. */
  /** The frames of a set, row by row from the top, each row in time order. */
  private framesOf(refs: FrameRef[], from?: Content): FlipbookFrame[] {
    const c = from ?? this.host.content();
    if (!c) return [];
    const out: FlipbookFrame[] = [];
    for (const t of c.flip) {
      const ref = refs.find((x) => x.track === t.id);
      if (ref) for (const f of t.frames) if (ref.frames.includes(f.id)) out.push(f);
    }
    return out;
  }

  /** Cut, Copy, Duplicate, Flip, Clear and Delete over the whole selection; true when handled. */
  private multiAction(kind: string): boolean {
    const refs = this.sel.refs();
    const c = this.host.content();
    if (!c) return false;
    const act = this.host.index();
    const keep = (): void => this.clampSel(this.host.row(), act);
    switch (kind) {
      case 'copy': clipboard = this.framesOf(refs); clipRefs = refs; return true;
      case 'cut': this.host.run('Cut frames', (x) => { clipboard = this.framesOf(refs, x); clipRefs = null; return deleteFrames(x, refs); }); keep(); return true;
      case 'del': this.host.run('Delete frames', (x) => deleteFrames(x, refs)); keep(); return true;
      case 'flip': this.host.run('Flip frames', (x) => flipFrames(x, refs)); return true;
      case 'clear': this.host.run('Clear frames', (x) => refs.reduce((acc, ref) => {
        const row = acc.flip.findIndex((t) => t.id === ref.track);
        return acc.flip[row].frames.reduce((a, f, i) => (ref.frames.includes(f.id) ? clearFrame(a, row, i) : a), acc);
      }, x)); return true;
      case 'dup': this.host.run('Duplicate frames', (x) => refs.reduce((acc, ref) => {
        const row = acc.flip.findIndex((t) => t.id === ref.track);
        const t = acc.flip[row];
        const own = t.frames.filter((f) => ref.frames.includes(f.id));
        const last = t.frames.findIndex((f) => f.id === own[own.length - 1].id);
        return pasteFrames(acc, row, last, own);
      }, x)); return true;
      default: return false;
    }
  }

  private cellAction(kind: 'cut' | 'copy' | 'paste' | 'dup' | 'ins' | 'clear' | 'del' | 'split' | 'fill' | 'flip' | 'opts'): void {
    const tg = this.cellTarget;
    const hit = tg ? this.find(tg.track, tg.frame) : null;
    this.cellMenu.hide();
    if (!hit || hit.i < 0 || !tg) return;
    if (this.sel.count > 0 && this.sel.has(tg.track, tg.frame) && this.multiAction(kind)) return;
    const { r, i, t } = hit;
    if (kind === 'flip') return;
    if (kind === 'opts') { this.openRowMenu(tg.track, this.cellXY.x, this.cellXY.y); return; }
    if (kind === 'split') { this.host.run('Split content', (c) => splitFrame(c, r, i, Math.max(1, this.cellOff))); return; }
    if (kind === 'fill') { this.host.run('Fill duration', (c) => fillFrame(c, r, i)); return; }
    const onRow = r === this.host.row();
    const act = this.host.index();
    const frame = t.frames[i];
    const afterInsert = (n: number): void => {
      // frames were added after i: the active frame shifts only when it sits after the target
      const base = onRow && act > i ? act + n : onRow ? act : this.host.index();
      this.clampSel(r, onRow && act === i ? i + 1 : base);
    };
    switch (kind) {
      case 'copy': clipboard = [frame]; clipRefs = [{ track: t.id, frames: [frame.id] }]; break;
      case 'cut':
        this.host.run('Cut frame', (c) => { const f = c.flip[r]?.frames[i]; if (f) { clipboard = [f]; clipRefs = null; } return deleteFrame(c, r, i); });
        this.clampSel(r, onRow ? (act > i ? act - 1 : Math.min(act, i)) : this.host.index());
        break;
      case 'paste':
        if (!clipboard.length) return;
        { const snap = clipboard, refs = clipRefs; this.host.run('Paste frames', (c) => { const live = refs ? this.framesOf(refs, c) : []; return pasteIntoFree(c, r, i, live.length === snap.length ? live : snap); }); }
        break;
      case 'dup': this.host.run('Duplicate frame', (c) => duplicateFrame(c, r, i)); afterInsert(1); break;
      case 'ins': this.host.run('Insert frame', (c) => insertFrame(c, r, i)); afterInsert(1); break;
      case 'clear': this.host.run('Clear frame', (c) => clearFrame(c, r, i)); this.host.select(r, onRow ? act : i); break;
      case 'del':
        this.host.run('Delete frame', (c) => deleteFrame(c, r, i));
        this.clampSel(r, onRow ? (act > i ? act - 1 : Math.min(act, i)) : this.host.index());
        break;
    }
  }

  private commitHold(): void {
    const tg = this.cellTarget;
    const hit = tg ? this.find(tg.track, tg.frame) : null;
    const n = parseInt(this.cm.hold.input.value, 10);
    this.cellMenu.hide();
    if (!hit || hit.i < 0 || !Number.isFinite(n)) return;
    if (tg && this.sel.count > 0 && this.sel.has(tg.track, tg.frame)) { const refs = this.sel.refs(); this.host.run('Frame duration', (c) => setHolds(c, refs, n)); return; }
    this.host.run('Frame duration', (c) => setHold(c, hit.r, hit.i, n));
    this.host.select(this.host.row(), this.host.index());
  }

  private rowAction(kind: 'rename' | 'toggle' | 'up' | 'down' | 'del'): void {
    const id = this.rowTarget;
    const hit = id ? this.find(id) : null;
    this.rowMenu.hide();
    if (!hit) return;
    const { r, t } = hit;
    const wasActive = r === this.host.row();
    const activeId = this.host.content()?.flip[this.host.row()]?.id ?? '';
    const follow = (): void => {
      const c = this.host.content();
      const nr = c ? c.flip.findIndex((x) => x.id === activeId) : -1;
      if (nr >= 0 && c && nr !== this.host.row()) this.clampSel(nr, this.host.index());
    };
    switch (kind) {
      case 'rename': this.startRename(id as string); break;
      case 'toggle': this.host.run(t.hidden ? 'Show track' : 'Hide track', (c) => patchFlipTrack(c, r, { hidden: !t.hidden })); break;
      case 'up': if (r > 0) { this.host.run('Move track up', (c) => moveFlipTrack(c, r, r - 1)); follow(); } break;
      case 'down': this.host.run('Move track down', (c) => moveFlipTrack(c, r, r + 1)); follow(); break;
      case 'del':
        if (hit.c.flip.length <= 1) return;
        this.host.run('Delete track', (c) => deleteFlipTrack(c, r));
        if (wasActive) this.clampSel(Math.min(r, hit.c.flip.length - 2), 0);
        else follow();
        break;
    }
  }

  private startRename(id: string): void {
    const row = this.rows.querySelector<HTMLElement>(`.fm-fs-row[data-key="${CSS.escape(id)}"]`);
    const hit = this.find(id);
    if (!row || !hit) return;
    const inp = q<HTMLInputElement>(row, '.fm-fs-rename');
    const name = q<HTMLElement>(row, '.fm-fs-name');
    inp.value = hit.t.name;
    inp.hidden = false;
    name.hidden = true;
    inp.focus();
    inp.select();
    let done = false;
    const end = (commit: boolean): void => {
      if (done) return;
      done = true;
      inp.removeEventListener('keydown', onKey);
      inp.removeEventListener('blur', onBlur);
      const v = inp.value.trim();
      inp.hidden = true;
      name.hidden = false;
      const cur = this.find(id);
      if (commit && v && cur && v !== cur.t.name) this.host.run('Rename track', (c) => patchFlipTrack(c, cur.r, { name: v }));
      this.root.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      else if (e.key === 'Escape') { e.preventDefault(); end(false); }
    };
    const onBlur = (): void => end(true);
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('blur', onBlur);
  }

  // ---- menus ----

  private buildCellMenu(): FlipStrip['cm'] {
    const tiles = el<HTMLElement>('<div class="fm-cm-tiles"></div>');
    const cut = tile(ICO.cut, 'Cut', () => this.cellAction('cut'));
    const copy = tile(ICO.copy, 'Copy', () => this.cellAction('copy'));
    const paste = tile(ICO.paste, 'Paste', () => this.cellAction('paste'));
    const dup = tile(ICO.dup, 'Duplicate', () => this.cellAction('dup'));
    tiles.append(cut.el, copy.el, paste.el, dup.el);
    const ins = popRow('plus', 'Insert frame');
    ins.el.addEventListener('click', () => this.cellAction('ins'));
    const hold = popField('film', 'Frame duration', () => this.commitHold());
    hold.input.inputMode = 'numeric';
    hold.el.append(el('<span class="fm-pop-val">frames</span>'));
    const clear = popRow('eraser', 'Clear frame');
    clear.el.addEventListener('click', () => this.cellAction('clear'));
    const del = popRow('delete', 'Delete frame', { danger: true });
    del.el.addEventListener('click', () => this.cellAction('del'));
    const split = popRow('split', 'Split content');
    split.el.addEventListener('click', () => this.cellAction('split'));
    const fill = popRow('fillDuration', 'Fill duration');
    fill.el.addEventListener('click', () => this.cellAction('fill'));
    const flip = popRow('flipbook', 'Flip frames');
    flip.el.addEventListener('click', () => this.cellAction('flip'));
    const opts = popRow('sliders', 'Track options');
    opts.el.addEventListener('click', () => this.cellAction('opts'));
    this.cellMenu.body.append(tiles, popSep(), ins.el, split.el, fill.el, flip.el, hold.el, opts.el, popSep(), clear.el, del.el);
    return { cut, copy, paste, dup, hold, clear, del, ins, split, fill, flip, opts };
  }

  private buildRowMenu(): FlipStrip['rm'] {
    const rename = popRow('typeTool', 'Rename');
    rename.el.addEventListener('click', () => this.rowAction('rename'));
    const op = el<HTMLElement>(
      `<div class="fm-cm-opacity"><div class="fm-cm-opacity-head"><span>Opacity</span><span class="fm-cm-pct">100%</span></div>` +
        `<input class="fm-cm-range" type="range" min="0" max="100" step="1" value="100" aria-label="Track opacity"></div>`);
    const range = q<HTMLInputElement>(op, 'input');
    const pct = q<HTMLElement>(op, '.fm-cm-pct');
    range.addEventListener('input', () => {
      const id = this.rowTarget;
      const hit = id ? this.find(id) : null;
      const v = Number(range.value);
      setText(pct, `${v}%`);
      setStyleVar(range, '--fm-pct', `${v}%`);
      if (hit) this.host.run('Track opacity', (c) => patchFlipTrack(c, hit.r, { opacity: v / 100 }), `fs-op-${hit.t.id}`);
    });
    const toggle = popRow('eyeOff', 'Hide');
    toggle.el.addEventListener('click', () => this.rowAction('toggle'));
    const up = popRow('chevronUp', 'Move up');
    up.el.addEventListener('click', () => this.rowAction('up'));
    const down = popRow('chevronDown', 'Move down');
    down.el.addEventListener('click', () => this.rowAction('down'));
    const del = popRow('delete', 'Delete track', { danger: true });
    del.el.addEventListener('click', () => this.rowAction('del'));
    // a masking row cuts the row below it and is not drawn itself
    const setMask = (mask: 'none' | 'clipping' | 'alpha' | 'luminance'): void => {
      const id = this.rowTarget;
      const hit = id ? this.find(id) : null;
      this.rowMenu.hide();
      if (hit) this.host.run('Row mask', (c) => patchFlipTrack(c, hit.r, { mask }));
    };
    const maskNone = popRow(null, 'No mask', { check: true });
    maskNone.el.addEventListener('click', () => setMask('none'));
    const maskClip = popRow(null, 'Clipping mask', { check: true });
    maskClip.el.addEventListener('click', () => setMask('clipping'));
    const maskAlpha = popRow(null, 'Alpha mask', { check: true });
    maskAlpha.el.addEventListener('click', () => setMask('alpha'));
    const maskLuma = popRow(null, 'Luminance mask', { check: true });
    maskLuma.el.addEventListener('click', () => setMask('luminance'));
    const invert = popRow(null, 'Invert mask', { check: true });
    invert.el.addEventListener('click', () => {
      const id = this.rowTarget;
      const hit = id ? this.find(id) : null;
      this.rowMenu.hide();
      if (hit) this.host.run('Invert row mask', (c) => patchFlipTrack(c, hit.r, { maskInvert: !hit.t.maskInvert }));
    });
    // Cut / Copy / Paste / Duplicate of the whole row
    const tiles = el<HTMLElement>('<div class="fm-cm-tiles"></div>');
    const rowOp = (kind: 'cut' | 'copy' | 'paste' | 'dup'): void => this.trackAction(kind);
    const cut = tile(ICO.cut, 'Cut', () => rowOp('cut'));
    const copy = tile(ICO.copy, 'Copy', () => rowOp('copy'));
    const paste = tile(ICO.paste, 'Paste', () => rowOp('paste'));
    const dup = tile(ICO.dup, 'Duplicate', () => rowOp('dup'));
    tiles.append(cut.el, copy.el, paste.el, dup.el);
    // Highlight (eight colors) and Blend mode, as submenus
    const hl = popRow('highlight', 'Highlight', { sub: true });
    const hlPanel = Popover.panel('fm-pop fm-cm-sub fm-pop-sub');
    this.subPanels.push(hlPanel);
    const hlRows = new Map<Highlight, ReturnType<typeof popRow>>();
    for (const h of HIGHLIGHTS) {
      const r = popRow(null, HL_LABEL(h), { check: true });
      r.ico.appendChild(el<HTMLElement>(`<span class="fm-cm-dot" data-hl="${h}"></span>`));
      r.el.addEventListener('click', () => {
        const id = this.rowTarget;
        const hit = id ? this.find(id) : null;
        this.rowMenu.hide();
        if (hit) this.host.run('Track highlight', (c) => patchFlipTrack(c, hit.r, { highlight: h }));
      });
      hlRows.set(h, r);
      hlPanel.appendChild(r.el);
    }
    this.rowMenu.attachSub(hl.el, hlPanel);
    const blend = popRow('blendN', 'Blend mode', { sub: true });
    const blendPanel = Popover.panel('fm-pop fm-cm-sub fm-cm-blend fm-pop-sub');
    this.subPanels.push(blendPanel);
    const blendRows = new Map<BlendMode, ReturnType<typeof popRow>>();
    for (const b of BLEND_MODES) {
      const r = popRow(null, b.label, { check: true });
      r.setValue(b.short);
      r.el.addEventListener('click', () => {
        const id = this.rowTarget;
        const hit = id ? this.find(id) : null;
        this.rowMenu.hide();
        if (hit) this.host.run('Track blend mode', (c) => patchFlipTrack(c, hit.r, { blend: b.id }));
      });
      blendRows.set(b.id, r);
      blendPanel.appendChild(r.el);
    }
    this.rowMenu.attachSub(blend.el, blendPanel);
    this.rowMenu.body.append(tiles, popSep(), rename.el, op, toggle.el, hl.el, blend.el, popSep(), maskNone.el, maskClip.el, maskAlpha.el, maskLuma.el, invert.el, popSep(), up.el, down.el, popSep(), del.el);
    return { rename, toggle, up, down, del, range, pct, maskNone, maskClip, maskAlpha, maskLuma, invert, cut, copy, paste, dup, hlRows, blendRows, hl, blend };
  }

  /** Row clipboard: Cut, Copy, Paste and Duplicate; a pasted or duplicated row lands directly above the row it was made from. */
  private trackAction(kind: 'cut' | 'copy' | 'paste' | 'dup'): void {
    const id = this.rowTarget;
    const hit = id ? this.find(id) : null;
    this.rowMenu.hide();
    if (!hit) return;
    const { r, t } = hit;
    const activeId = this.host.content()?.flip[this.host.row()]?.id ?? '';
    const follow = (): void => {
      const c = this.host.content();
      const nr = c ? c.flip.findIndex((x) => x.id === activeId) : -1;
      if (nr >= 0) this.clampSel(nr, this.host.index());
    };
    switch (kind) {
      case 'copy': trackClip = cloneFlipTrack(t); trackClipId = t.id; break;
      case 'cut':
        if (hit.c.flip.length <= 1) return;
        this.host.run('Cut track', (c) => { const live = c.flip[r]; trackClip = cloneFlipTrack(live ?? t); trackClipId = ''; return deleteFlipTrack(c, r); });
        follow();
        break;
      case 'paste': { const clip = trackClip, from = trackClipId; if (!clip) return; this.host.run('Paste track', (c) => insertFlipTrack(c, r, c.flip.find((x) => x.id === from) ?? clip)); follow(); break; }
      case 'dup': this.host.run('Duplicate track', (c) => insertFlipTrack(c, r, t)); follow(); break;
    }
  }

  private openCellMenu(tg: { track: string; frame: string }, x: number, y: number, off = 0): void {
    const hit = this.find(tg.track, tg.frame);
    if (!hit || hit.i < 0) return;
    this.rowMenu.hide();
    this.cellTarget = tg;
    this.cellXY = { x, y };
    this.cellOff = off;
    // a right-click on a frame outside the selection leaves multi-select; inside it the menu works on the whole set
    if (this.sel.count > 0 && !this.sel.has(tg.track, tg.frame)) { this.sel.clear(); this.paint(); }
    const many = this.sel.count > 1 && this.sel.has(tg.track, tg.frame);
    const held = Math.max(1, hit.t.frames[hit.i].hold) > 1;
    setClass(this.cm.ins.el, 'is-gone', many);
    setClass(this.cm.split.el, 'is-gone', many || !held);
    setClass(this.cm.fill.el, 'is-gone', many);
    setClass(this.cm.flip.el, 'is-gone', !many);
    setClass(this.cm.opts.el, 'is-gone', many);
    this.cm.hold.set(String(Math.max(1, hit.t.frames[hit.i].hold)));
    this.cm.paste.setDisabled(!clipboard.length || many);
    this.cellMenu.showAt(x, y);
  }

  private openRowMenu(id: string, x: number, y: number): void {
    const hit = this.find(id);
    if (!hit) return;
    this.cellMenu.hide();
    this.rowTarget = id;
    const pct = Math.round(hit.t.opacity * 100);
    this.rm.range.value = String(pct);
    setText(this.rm.pct, `${pct}%`);
    setStyleVar(this.rm.range, '--fm-pct', `${pct}%`);
    this.rm.toggle.setLabel(hit.t.hidden ? 'Show' : 'Hide');
    const mk = hit.t.mask ?? 'none';
    this.rm.maskNone.setChecked(mk === 'none');
    this.rm.maskClip.setChecked(mk === 'clipping');
    this.rm.maskAlpha.setChecked(mk === 'alpha');
    this.rm.maskLuma.setChecked(mk === 'luminance');
    this.rm.invert.setChecked(!!hit.t.maskInvert);
    this.rm.invert.setDisabled(mk === 'none' || mk === 'clipping');
    for (const [h, r] of this.rm.hlRows) r.setChecked(h === hit.t.highlight);
    for (const [b, r] of this.rm.blendRows) r.setChecked(b === hit.t.blend);
    this.rm.hl.setValue(HL_LABEL(hit.t.highlight));
    this.rm.paste.setDisabled(!trackClip);
    this.rm.cut.setDisabled(hit.c.flip.length <= 1);    this.rm.up.setDisabled(hit.r === 0);
    this.rm.down.setDisabled(hit.r === hit.c.flip.length - 1);
    this.rm.del.setDisabled(hit.c.flip.length <= 1);
    this.rowMenu.showAt(x, y);
  }

  // ---- gestures ----

  private track(win: (m: PointerEvent) => void, done: (m: PointerEvent | null) => void): void {
    const up = (m: PointerEvent): void => { off(); done(m); };
    const cancel = (): void => { off(); done(null); };
    const off = (): void => {
      window.removeEventListener('pointermove', win);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    window.addEventListener('pointermove', win);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  private eat(): void {
    this.suppressClick = true;
    window.setTimeout(() => { this.suppressClick = false; }, 80);
  }

  private cellEls(): HTMLElement[] { return Array.from(this.rows.querySelectorAll<HTMLElement>('.fm-fs-cell')); }

  private rowEls(): HTMLElement[] { return Array.from(this.rows.querySelectorAll<HTMLElement>('.fm-fs-row')); }

  /** The set a gesture on this cell works on: the whole selection when the cell belongs to it. */
  private setFor(tg: { track: string; frame: string }): FrameRef[] {
    return this.sel.count > 0 && this.sel.has(tg.track, tg.frame) ? this.sel.refs() : [{ track: tg.track, frames: [tg.frame] }];
  }

  private gesture(e: PointerEvent, cancelPress: () => void): void {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.fm-fs-rename, .fm-fs-vis, .fm-fs-opts')) return;
    if (t.classList.contains('fm-fs-trim')) { this.startTrim(e, t); return; }
    const nameEl = t.closest<HTMLElement>('.fm-fs-name');
    if (nameEl) { this.startRowDrag(e, nameEl.closest<HTMLElement>('.fm-fs-row')?.dataset.key ?? ''); return; }
    const tg = this.cellAt(t);
    const hit = tg ? this.find(tg.track, tg.frame) : null;
    if (!tg || !hit || hit.i < 0) {
      if (t.closest('.fm-fs-lane')) this.startLasso(e, e.shiftKey || e.ctrlKey || e.metaKey);
      return;
    }
    const x0 = e.clientX, y0 = e.clientY;
    const selected = this.sel.has(tg.track, tg.frame);
    if (e.altKey || (this.sel.multi && !selected)) { this.startLasso(e, e.shiftKey || e.ctrlKey || e.metaKey); return; }
    const s = loadPrefs().scrubSpeed;
    const k = s === 'precise' ? 0.4 : s === 'fast' ? 2 : 1;
    const r = hit.r, i0 = hit.i;
    let mode: '' | 'scrub' | 'drag' = '';
    let last = i0;
    const drag = this.makeDrag(tg);
    // touch and pen ride the strip under the finger (drag left advances); the mouse keeps the slider feel
    const sign = e.pointerType === 'mouse' ? 1 : -1;
    const samples: { t: number; x: number }[] = [];
    this.track((m) => {
      const dx = m.clientX - x0, dy = m.clientY - y0;
      samples.push({ t: m.timeStamp, x: m.clientX });
      while (samples.length > 2 && m.timeStamp - samples[0].t > 80) samples.shift();
      if (!mode) {
        if (Math.hypot(dx, dy) < 5) return;
        mode = (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) || (this.sel.multi && selected) ? 'drag' : 'scrub';
        this.suppressClick = true;
        cancelPress();
        if (mode === 'scrub') { this.scrubbing = true; this.onScrub?.(); }
        if (mode === 'scrub' && this.sel.clear()) this.paint();
        if (mode === 'drag') drag.begin();
      }
      if (mode === 'drag') { drag.move(m); return; }
      const row = this.host.content()?.flip[r];
      if (!row) return;
      const to = Math.max(0, Math.min(row.frames.length - 1, i0 + Math.round((sign * dx * k) / COL)));
      if (to !== last) { last = to; this.host.select(r, to); }
    }, (m) => {
      if (mode === 'drag') drag.end(m);
      const fling = m && mode === 'scrub' && sign < 0 && samples.length > 1 ? this.flingFrom(samples, last, r, k) : false;
      if (!fling && this.scrubbing) { this.scrubbing = false; this.onScrub?.(); }
      if (mode) this.eat();
    });
  }

  /** Flick momentum: carries the scrub on after release and settles on a whole frame; true while it runs. */
  private flingFrom(samples: { t: number; x: number }[], from: number, r: number, k: number): boolean {
    const a = samples[0], b = samples[samples.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 100) return false;
    let v = (-(b.x - a.x) / dt) * k / COL; // frames per ms, left swipe positive
    if (Math.abs(v) < 0.004) return false;
    let pos = from, t0 = performance.now();
    const tick = (now: number): void => {
      const row = this.host.content()?.flip[r];
      const step = now - t0;
      t0 = now;
      v *= Math.pow(0.994, step);
      pos += v * step;
      const to = row ? Math.max(0, Math.min(row.frames.length - 1, Math.round(pos))) : 0;
      const atEnd = !row || to !== Math.round(pos);
      if (row && to !== this.host.index()) this.host.select(r, to);
      if (Math.abs(v) < 0.0015 || atEnd) { this.scrubbing = false; this.onScrub?.(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  }

  /** Dragging frames to another row, to a spot in a row, or between rows (a new row); a drop line shows where. */
  private makeDrag(tg: { track: string; frame: string }): { begin(): void; move(m: PointerEvent): void; end(m: PointerEvent | null): void } {
    const refs = this.setFor(tg);
    const moving = new Set(refs.flatMap((x) => x.frames));
    type Drop = { track: string | null; after: number; newAt: number } | null;
    let drop: Drop = null;
    const place = (x: number, y: number, w: number, h: number): void => {
      const b = this.body.getBoundingClientRect();
      setStyleVar(this.dropLine, 'left', `${x - b.left}px`);
      setStyleVar(this.dropLine, 'top', `${y - b.top}px`);
      setStyleVar(this.dropLine, 'width', `${w}px`);
      setStyleVar(this.dropLine, 'height', `${h}px`);
      setHidden(this.dropLine, false);
    };
    const find = (m: PointerEvent): Drop => {
      const rows = this.rowEls();
      const box = this.rows.getBoundingClientRect();
      if (m.clientY < box.top - 8 || m.clientY > box.bottom + 8) return null;
      // a band about 14 px tall around each gap between rows (and the top and bottom edges) wins over the rows' own edges
      for (let r = 1; r < rows.length; r++) {
        const gap = (rows[r - 1].getBoundingClientRect().bottom + rows[r].getBoundingClientRect().top) / 2;
        if (Math.abs(m.clientY - gap) <= 7) {
          const lane = q<HTMLElement>(rows[r], '.fm-fs-lane').getBoundingClientRect();
          place(lane.left, gap - 1, lane.width, 3);
          return { track: null, after: -1, newAt: r };
        }
      }
      for (let r = 0; r < rows.length; r++) {
        const rb = rows[r].getBoundingClientRect();
        const lane = q<HTMLElement>(rows[r], '.fm-fs-lane').getBoundingClientRect();
        // the strip between two rows (and above the first, below the last) makes a new row
        if (Math.abs(m.clientY - rb.top) <= 7) { place(lane.left, rb.top - 1, lane.width, 3); return { track: null, after: -1, newAt: r }; }
        if (r === rows.length - 1 && Math.abs(m.clientY - rb.bottom) <= 7) { place(lane.left, rb.bottom - 1, lane.width, 3); return { track: null, after: -1, newAt: r + 1 }; }
        if (m.clientY >= rb.top && m.clientY < rb.bottom) {
          const cells = Array.from(rows[r].querySelectorAll<HTMLElement>('.fm-fs-cell'));
          let after = -1, px = lane.left;
          cells.forEach((c, i) => {
            const cb = c.getBoundingClientRect();
            if (cb.left + cb.width / 2 < m.clientX && !moving.has(c.dataset.key ?? '')) { after = i; px = cb.right + 1; }
          });
          place(px - 1, rb.top + 2, 3, rb.height - 4);
          return { track: rows[r].dataset.key ?? null, after, newAt: 0 };
        }
      }
      return null;
    };
    return {
      begin: () => { this.root.classList.add('is-moving'); },
      move: (m) => { drop = find(m); if (!drop) setHidden(this.dropLine, true); },
      end: (m) => {
        this.root.classList.remove('is-moving');
        setHidden(this.dropLine, true);
        const d = drop;
        if (!m || !d) return;
        this.host.run('Move frames', (c) => moveFrames(c, refs, d.track, d.after, d.newAt));
      },
    };
  }

  /** Free trim: a handle at the right edge of a cell; the drag changes the hold of the cell, or of every selected cell together. */
  private startTrim(e: PointerEvent, handle: HTMLElement): void {
    const cell = handle.closest<HTMLElement>('.fm-fs-cell');
    const tg = this.cellAt(handle);
    if (!cell || !tg) return;
    e.preventDefault();
    const refs = this.setFor(tg);
    const ids = new Set(refs.flatMap((x) => x.frames));
    const live = this.cellEls().filter((c) => ids.has(c.dataset.key ?? ''));
    const base = live.map((c) => ({ c, hold: Math.max(1, Math.round((parseFloat(c.style.width) + 2) / COL)) }));
    const x0 = e.clientX;
    let delta = 0;
    this.root.classList.add('is-trimming');
    this.suppressClick = true;
    this.track((m) => {
      delta = Math.round((m.clientX - x0) / COL);
      for (const b of base) {
        const h = Math.max(1, Math.min(999, b.hold + delta));
        setStyleVar(b.c, 'width', `${h * COL - 2}px`);
        setText(q(b.c, '.fm-fs-hold'), h > 1 ? `×${h}` : '');
      }
    }, (m) => {
      this.root.classList.remove('is-trimming');
      this.eat();
      if (m && delta !== 0) this.host.run('Frame duration', (c) => setHolds(c, refs, delta, true));
      else this.paint();
    });
  }

  /** Lasso: a box dragged over the lanes selects the cells it touches; Shift or Ctrl adds. */
  private startLasso(e: PointerEvent, additive: boolean): void {
    const onCell = !!this.cellAt(e.target as HTMLElement);
    const base = additive ? this.sel.refs() : [];
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    this.track((m) => {
      if (!moved) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
        moved = true;
        this.suppressClick = true;
        this.lasso.begin(x0, y0);
      }
      const box = this.lasso.move(m.clientX, m.clientY);
      const refs = new Map<string, Set<string>>(base.map((b) => [b.track, new Set(b.frames)]));
      for (const row of this.rowEls()) {
        const lane = q<HTMLElement>(row, '.fm-fs-lane').getBoundingClientRect();
        for (const c of Array.from(row.querySelectorAll<HTMLElement>('.fm-fs-cell'))) {
          const cb = c.getBoundingClientRect();
          const hitX = cb.right > box.left && cb.left < box.right && cb.right > lane.left && cb.left < lane.right;
          if (hitX && cb.bottom > box.top && cb.top < box.bottom) {
            const tid = row.dataset.key ?? '';
            let s = refs.get(tid);
            if (!s) refs.set(tid, (s = new Set()));
            s.add(c.dataset.key ?? '');
          }
        }
      }
      this.sel.set(Array.from(refs, ([track, s]) => ({ track, frames: Array.from(s) })));
      this.sel.multi = true;
      for (const row of this.rowEls()) {
        const s = refs.get(row.dataset.key ?? '');
        for (const c of Array.from(row.querySelectorAll<HTMLElement>('.fm-fs-cell'))) setClass(c, 'is-sel', !!s?.has(c.dataset.key ?? ''));
      }
    }, () => {
      this.lasso.end();
      // a plain click on empty lane space clears; a click on a cell is left to the click handler
      if (!moved && !additive && !onCell && this.sel.clear()) this.paint();
      else if (moved) { this.paint(); this.eat(); }
    });
  }

  /** Drag a row by its name to reorder it. */
  private startRowDrag(e: PointerEvent, id: string): void {
    const y0 = e.clientY;
    let active = false;
    let to = -1;
    this.track((m) => {
      if (!active) {
        if (Math.abs(m.clientY - y0) < 6) return;
        active = true;
        this.suppressClick = true;
      }
      const rows = this.rowEls();
      let idx = rows.length - 1;
      for (let r = 0; r < rows.length; r++) if (m.clientY < rows[r].getBoundingClientRect().bottom) { idx = r; break; }
      to = idx;
      const rb = rows[idx].getBoundingClientRect();
      const lane = q<HTMLElement>(rows[idx], '.fm-fs-lane').getBoundingClientRect();
      const b = this.body.getBoundingClientRect();
      const from = rows.findIndex((x) => x.dataset.key === id);
      const y = idx >= from ? rb.bottom : rb.top;
      setStyleVar(this.dropLine, 'left', `${rb.left - b.left}px`);
      setStyleVar(this.dropLine, 'top', `${y - b.top - 1}px`);
      setStyleVar(this.dropLine, 'width', `${lane.right - rb.left}px`);
      setStyleVar(this.dropLine, 'height', '3px');
      setHidden(this.dropLine, false);
    }, (m) => {
      setHidden(this.dropLine, true);
      this.eat();
      if (!m || !active || to < 0) return;
      const hit = this.find(id);
      if (!hit || hit.r === to) return;
      const activeId = this.host.content()?.flip[this.host.row()]?.id ?? '';
      this.host.run('Move track', (c) => moveFlipTrack(c, hit.r, to));
      const c = this.host.content();
      const nr = c ? c.flip.findIndex((x) => x.id === activeId) : -1;
      if (nr >= 0) this.clampSel(nr, this.host.index());
    });
  }

  // ---- input ----

  private wire(): void {
    this.playBtn.addEventListener('click', () => this.host.togglePlay());
    // Add frame: a press and hold adds after the hold, like Alt
    let frameHeld = false;
    let frameTimer = 0;
    const frameBtn = q(this.root, '[data-act="frame"]');
    frameBtn.addEventListener('pointerdown', () => {
      frameHeld = false;
      window.clearTimeout(frameTimer);
      frameTimer = window.setTimeout(() => { frameHeld = true; this.addFrame(true); }, LONG_PRESS);
    });
    const stopFrame = (): void => window.clearTimeout(frameTimer);
    frameBtn.addEventListener('pointerup', stopFrame);
    frameBtn.addEventListener('pointerleave', stopFrame);
    this.head.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'preview') this.preview.toggle();
      else if (act === 'frame') { if (frameHeld) { frameHeld = false; return; } this.addFrame(e.altKey); }
      else if (act === 'track') this.addTrack();
      else if (act === 'mini') this.onMini?.();
      else if (act === 'hide') setClass(this.root, 'is-collapsed', !this.root.classList.contains('is-collapsed'));
      else if (act === 'prev' || act === 'next') { if (this.stepHeld) { this.stepHeld = false; return; } this.step(act === 'next' ? 1 : -1); }
      else if (act === 'multi') {
        if (this.reloaded) { this.reloaded = false; return; }
        this.sel.multi = !this.sel.multi;
        if (!this.sel.multi) this.sel.clear();
        this.paint();
      }
    });
    // Previous / Next Drawing: a long press jumps to the first or last drawing
    for (const act of ['prev', 'next'] as const) {
      const b = q(this.root, `[data-act="${act}"]`);
      let timer = 0;
      b.addEventListener('pointerdown', () => {
        this.stepHeld = false;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          this.stepHeld = true;
          const t = this.host.content()?.flip[this.host.row()];
          if (t) this.host.select(this.host.row(), act === 'next' ? t.frames.length - 1 : 0);
        }, LONG_PRESS);
      });
      const stop = (): void => window.clearTimeout(timer);
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
    }
    // press and hold Multi-select brings the previous selection back
    this.multiBtn.addEventListener('pointerdown', () => {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => {
        const c = this.host.content();
        if (c && this.sel.reload(c)) { this.sel.multi = true; this.reloaded = true; this.paint(); }
      }, LONG_PRESS);
    });
    const stopReload = (): void => window.clearTimeout(this.reloadTimer);
    this.multiBtn.addEventListener('pointerup', stopReload);
    this.multiBtn.addEventListener('pointerleave', stopReload);

    this.rows.addEventListener('click', (e) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const t = e.target as HTMLElement;
      if (t.classList.contains('fm-fs-vis')) {
        const id = t.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
        const hit = id ? this.find(id) : null;
        if (hit) this.host.run(hit.t.hidden ? 'Show track' : 'Hide track', (c) => patchFlipTrack(c, hit.r, { hidden: !hit.t.hidden }));
        return;
      }
      if (t.classList.contains('fm-fs-rename')) return;
      const optsBtn = t.closest<HTMLElement>('.fm-fs-opts');
      if (optsBtn) {
        const id = optsBtn.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
        const r = optsBtn.getBoundingClientRect();
        if (id) this.openRowMenu(id, r.left, r.bottom + 4);
        return;
      }
      const tg = this.cellAt(t);
      if (tg) {
        const hit = this.find(tg.track, tg.frame);
        this.root.focus({ preventScroll: true });
        if (!hit || hit.i < 0) return;
        if (e.shiftKey) { this.sel.range(hit.c, tg.track, tg.frame); this.paint(); return; }
        if (e.ctrlKey || e.metaKey || this.sel.multi) { this.sel.toggle(tg.track, tg.frame); this.paint(); return; }
        if (this.sel.clear()) this.paint();
        const cell = t.closest<HTMLElement>('.fm-fs-cell');
        const rect = cell?.getBoundingClientRect();
        // a click inside a hold puts the playhead there (for Split content); Alt-click jumps to the end of the hold
        const held = Math.max(1, hit.t.frames[hit.i].hold);
        this.within = rect ? Math.max(0, Math.min(held - 1, Math.floor((e.clientX - rect.left) / COL))) : 0;
        if (e.altKey) this.within = held - 1;
        this.withinKey = `${tg.track}:${hit.i}`;
        this.host.select(hit.r, hit.i);
        return;
      }
      if (t.closest('.fm-fs-label')) {
        const id = t.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
        const hit = id ? this.find(id) : null;
        if (hit) this.host.select(hit.r, Math.min(this.host.index(), hit.t.frames.length - 1));
        this.root.focus({ preventScroll: true });
      }
    });

    this.rows.addEventListener('contextmenu', (e) => {
      const t = e.target as HTMLElement;
      const tg = this.cellAt(t);
      if (tg) {
        e.preventDefault();
        const rect = t.closest<HTMLElement>('.fm-fs-cell')?.getBoundingClientRect();
        this.openCellMenu(tg, e.clientX, e.clientY, rect ? Math.floor((e.clientX - rect.left) / COL) : 0);
        return;
      }
      const lab = t.closest('.fm-fs-label');
      const id = lab?.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
      if (id) { e.preventDefault(); this.openRowMenu(id, e.clientX, e.clientY); }
    });

    // press and hold a track's visibility checkbox opens Track options
    let visTimer = 0, visHeld = false;
    this.rows.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!t.classList.contains('fm-fs-vis') || e.button !== 0) return;
      const id = t.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
      const x = e.clientX, y = e.clientY;
      visHeld = false;
      window.clearTimeout(visTimer);
      visTimer = window.setTimeout(() => { if (id) { visHeld = true; this.openRowMenu(id, x, y); } }, LONG_PRESS);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.rows.addEventListener(ev, () => window.clearTimeout(visTimer));
    this.rows.addEventListener('click', (e) => {
      if (!visHeld) return;
      visHeld = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);

    // long press opens the cell menu on touch and pen
    let sx = 0, sy = 0;
    this.rows.addEventListener('pointerdown', (e) => {
      const tg = this.cellAt(e.target as HTMLElement);
      if (!tg || e.button !== 0 || e.pointerType === 'mouse') return;
      sx = e.clientX; sy = e.clientY;
      window.clearTimeout(this.pressTimer);
      this.pressTimer = window.setTimeout(() => {
        this.suppressClick = true;
        this.openCellMenu(tg, sx, sy);
      }, LONG_PRESS);
    });
    const cancel = (): void => window.clearTimeout(this.pressTimer);
    // drag across the frame cells to scrub through frames; the Scrub speed setting scales frames per distance
    this.rows.addEventListener('pointerdown', (e) => this.gesture(e, cancel));
    this.rows.addEventListener('pointerup', cancel);
    this.rows.addEventListener('pointercancel', cancel);
    this.rows.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 6) cancel(); });

    // horizontal pan: wheel over lanes and ruler, drag on the ruler
    this.root.addEventListener('wheel', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.fm-fs-lane, .fm-fs-ruler, .fm-fs-corner')) return;
      const over = t.closest('.fm-fs-lane');
      const dy = e.deltaY, dx = e.deltaX;
      if (over && !e.shiftKey && Math.abs(dy) > Math.abs(dx) && this.rows.scrollHeight > this.rows.clientHeight + 1) return;
      e.preventDefault();
      this.sx += (Math.abs(dx) > Math.abs(dy) ? dx : dy);
      this.paint();
    }, { passive: false });

    this.ruler.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.ruler.setPointerCapture(e.pointerId);
      let last = e.clientX;
      const move = (m: PointerEvent): void => { this.sx -= m.clientX - last; last = m.clientX; this.paint(); };
      const up = (): void => { this.ruler.removeEventListener('pointermove', move); this.ruler.removeEventListener('pointerup', up); this.ruler.removeEventListener('pointercancel', up); };
      this.ruler.addEventListener('pointermove', move);
      this.ruler.addEventListener('pointerup', up);
      this.ruler.addEventListener('pointercancel', up);
    });

    // drag by the header
    this.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const box = this.root.getBoundingClientRect();
      const par = (this.root.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      const dx0 = parseFloat(this.root.style.getPropertyValue('--dx')) || 0;
      const dy0 = parseFloat(this.root.style.getPropertyValue('--dy')) || 0;
      const x0 = e.clientX, y0 = e.clientY;
      this.head.setPointerCapture(e.pointerId);
      this.root.classList.add('is-dragging');
      const move = (m: PointerEvent): void => {
        let dx = dx0 + m.clientX - x0, dy = dy0 + m.clientY - y0;
        if (par) {
          dx = Math.max(par.left - box.left + dx0, Math.min(par.right - box.right + dx0, dx));
          dy = Math.max(par.top - box.top + dy0, Math.min(par.bottom - box.bottom + dy0, dy));
        }
        this.root.style.setProperty('--dx', `${Math.round(dx)}px`);
        this.root.style.setProperty('--dy', `${Math.round(dy)}px`);
      };
      const up = (): void => {
        this.root.classList.remove('is-dragging');
        this.head.removeEventListener('pointermove', move);
        this.head.removeEventListener('pointerup', up);
        this.head.removeEventListener('pointercancel', up);
      };
      this.head.addEventListener('pointermove', move);
      this.head.addEventListener('pointerup', up);
      this.head.addEventListener('pointercancel', up);
    });

    this.root.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === ',') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'ArrowRight' || e.key === '.') { e.preventDefault(); this.step(1); }
      else if (this.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
    });
    this.head.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('button')) this.onMini?.(); });
    this.rows.addEventListener('dblclick', (e) => {
      const t = e.target as HTMLElement;
      if (!t.classList.contains('fm-fs-vis')) return;
      const id = t.closest<HTMLElement>('.fm-fs-row')?.dataset.key;
      if (id) this.openRowMenu(id, e.clientX, e.clientY);
    });
  }

  /** Delete, Extend, Contract, Push, Pull, Contract to one frame and Fill duration on the open frame or the selection. */
  handleKey(e: KeyboardEvent): boolean {
    const c = this.host.content();
    const row = this.host.row(), idx = this.host.index();
    const t = c?.flip[row];
    const cur = t?.frames[idx];
    if (!c || !t || !cur) return false;
    const refs: FrameRef[] = this.sel.count > 0 ? this.sel.refs() : [{ track: t.id, frames: [cur.id] }];
    switch (e.key) {
      case 'Delete': case 'Backspace':
        this.host.run('Delete frames', (x) => deleteFrames(x, refs));
        this.clampSel(row, idx);
        return true;
      case ']': this.host.run('Extend frame', (x) => setHolds(x, refs, 1, true)); return true;
      case '[': this.host.run('Contract frame', (x) => setHolds(x, refs, -1, true)); return true;
      case '\\': this.host.run('Contract to one frame', (x) => setHolds(x, refs, 1)); return true;
      case '}': this.host.run('Push frame', (x) => pushFrame(x, row, idx)); this.clampSel(row, idx + 1); return true;
      case '{': this.host.run('Pull frame', (x) => pullFrame(x, row, idx)); return true;
      case 'f': case 'F': this.host.run('Fill duration', (x) => fillFrame(x, row, idx)); return true;
      case 'Escape':
        if (this.sel.multi || this.sel.count) { this.sel.multi = false; this.sel.clear(); this.paint(); return true; }
        return false;
      default: return false;
    }
  }

  /** Closes the frame and track menus; true when one was open (Escape then stops there). */
  closeMenus(): boolean {
    const was = this.cellMenu.isOpen || this.rowMenu.isOpen;
    this.cellMenu.hide();
    this.rowMenu.hide();
    return was;
  }

  /** Cells into the open frame's hold the playhead sits at. */
  playheadWithin(): number { return this.curWithin(); }
}

function tile(svgStr: string, label: string, on: () => void): { el: HTMLButtonElement; setDisabled(v: boolean): void } {
  const b = el<HTMLButtonElement>(`<button class="fm-cm-tile" type="button">${glyph(svgStr, 18)}<span>${label}</span></button>`);
  b.addEventListener('click', on);
  return { el: b, setDisabled: (v) => setClass(b, 'is-disabled', v) };
}
