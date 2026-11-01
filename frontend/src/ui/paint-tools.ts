// Select, Transform and Filters for Draw & Paint: the bottom capsule, the
// canvas interactions they take over, and their overlays. Pixel work goes
// through the pure paint modules; each finished action is one PaintDoc undo step.

import type { PaintDoc } from '../paint/doc';
import { clearMask, fillMask } from '../paint/fill';
import { FILTER_DEFAULTS, gaussianBlur, hsb, lensBlur, noise, sharpen } from '../paint/filters';
import { readRect } from '../paint/history';
import { autoMask, combine, ellipseMask, extract, invertMask, isEmpty, maskBounds, maskOutline, polygonMask, rectMask } from '../paint/select';
import { MESH_MAX, MESH_MIN, bendFor, bendHandles, makeGrid, nudgePoints, refineGridBent, resampleGrid, transformMesh, transformQuad, zeroBends, type Bend } from '../paint/transform';
import type { CombineMode, Interpolation, Mask, PaintLayer, Point, Raster, Rect, RGB, SelectMode, TransformMode } from '../paint/types';
import { el, q, setClass, setHidden, setText } from './dom';
import { t as tr } from './i18n';
import { HoldRepeat } from './paint-gestures';
import { sampleAll } from './paint-sample-all';
import { popRow, popSep, Popover, type PopRow } from './popover';
import { drawGridPreview, drawQuadPreview } from './warp-drag-preview';

export interface Interaction {
  down(e: PointerEvent): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ToolHost {
  doc(): PaintDoc | null;
  selection(): Mask | null;
  setSelection(m: Mask | null): void;
  color(): RGB;
  toCanvas(clientX: number, clientY: number): { x: number; y: number };
  view(): { scale: number; ox: number; oy: number };
  /** Point relative to the canvas element to the unrotated space overlays are drawn in. */
  unrotate?(x: number, y: number): { x: number; y: number };
  setLive(fn: ((ctx: Ctx) => void) | null): void;
  redraw(): void;
  setInteraction(h: Interaction | null): void;
  say(text: string): void;
  modeChanged(): void;
  /** The Copy & Paste menu at a screen point. */
  clipMenu?(x: number, y: number): void;
  /** Bring back the selection that was active before the current one. */
  reloadSelection?(): void;
  /** Ids of the layers picked together in the Layers panel (empty or one: just the active layer). */
  layerSelection?(): string[];
}

export type ToolMode = 'paint' | 'select' | 'transform' | 'filters';
type FilterId = 'hsb' | 'blur' | 'sharpen' | 'noise' | 'lens';

interface Param { id: string; label: string; min: number; max: number; step: number; def: number; unit: string; scale: number }

const FILTERS: { id: FilterId; label: string; params: Param[] }[] = [
  { id: 'hsb', label: 'Hue, Saturation, Brightness', params: [
    { id: 'hue', label: 'Hue', min: -180, max: 180, step: 1, def: 0, unit: '°', scale: 1 },
    { id: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, def: 0, unit: '%', scale: 100 },
    { id: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, def: 0, unit: '%', scale: 100 },
  ] },
  { id: 'blur', label: 'Gaussian Blur', params: [{ id: 'radius', label: 'Amount', min: 0, max: 1, step: 0.005, def: 0, unit: '%', scale: 100 }] },
  { id: 'sharpen', label: 'Sharpen', params: [{ id: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0, unit: '%', scale: 100 }] },
  { id: 'noise', label: 'Noise', params: [
    { id: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0, unit: '%', scale: 100 },
    { id: 'scale', label: 'Scale', min: 4, max: 800, step: 1, def: 120, unit: 'px', scale: 1 },
    { id: 'octaves', label: 'Octaves', min: 1, max: 8, step: 1, def: 4, unit: '', scale: 1 },
    { id: 'turbulence', label: 'Turbulence', min: 0, max: 1, step: 0.01, def: 0.3, unit: '%', scale: 100 },
  ] },
  { id: 'lens', label: 'Lens Blur', params: [
    { id: 'radius', label: 'Radius', min: 0, max: 1, step: 0.005, def: 0, unit: '%', scale: 100 },
    { id: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, def: 0.2, unit: '%', scale: 100 },
    { id: 'contrast', label: 'Contrast', min: 0, max: 1, step: 0.01, def: 0.3, unit: '%', scale: 100 },
  ] },
];

const SELECT_MODES: { id: SelectMode; label: string }[] = [
  { id: 'automatic', label: 'Automatic' }, { id: 'freehand', label: 'Freehand' }, { id: 'rectangle', label: 'Rectangle' }, { id: 'ellipse', label: 'Ellipse' },
];
const tile = (body: string): string => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** The filter screen's right-hand tiles. */
const TILE_ICONS: Record<string, string> = {
  apply: tile('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  undo: tile('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  preview: tile('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  cancel: tile('<path d="M6 6l12 12M18 6 6 18"/>'),
  reset: tile('<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/>'),
};

const SEL_TIPS: Record<string, string> = {
  clear: 'Erase the pixels inside the selection',
  none: 'Clear selection: drop the outline and keep the pixels',
  all: 'Pick colors from every layer, not only the active one',
};
const TRANSFORM_MODES: { id: TransformMode; label: string }[] = [
  { id: 'freeform', label: 'Freeform' }, { id: 'uniform', label: 'Uniform' }, { id: 'distort', label: 'Distort' }, { id: 'warp', label: 'Warp' },
];
const INTERP: Interpolation[] = ['nearest', 'bilinear', 'bicubic'];
const INTERP_LABEL: Record<Interpolation, string> = { nearest: 'Nearest', bilinear: 'Bilinear', bicubic: 'Bicubic' };

const NUDGE: Record<string, [number, number]> = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };
const ARROW: Record<string, string> = {
  l: 'M10.5 3 5.5 8l5 5',
  r: 'M5.5 3l5 5-5 5',
  u: 'M3 10.5 8 5.5l5 5',
  d: 'M3 5.5l5 5 5-5',
};
const nudgePad = (): string => `<span class="fm-ptools-nudge" title="${tr('Nudge 1 px (Shift 10 px; arrow keys too)')}">${(['l', 'u', 'd', 'r'] as const).map((k) => `<button type="button" data-nudge="${k}" aria-label="${tr({ l: 'Nudge left', r: 'Nudge right', u: 'Nudge up', d: 'Nudge down' }[k])}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${ARROW[k]}"/></svg></button>`).join('')}</span>`;
const htmlOf = (html: string): HTMLElement => el<HTMLElement>(`<div>${html}</div>`);

const TEMPLATE = `<div class="fm-ptools" hidden>
<div class="fm-ptools-modes"></div>
<div class="fm-ptools-actions"></div>
<div class="fm-ptools-params" hidden></div>
</div>`;

/** A further layer lifted with the first when several are selected: it moves with the same box. */
interface Part { layer: string; orig: Uint8ClampedArray; src: Raster; canvas: OffscreenCanvas; preview: { canvas: OffscreenCanvas; rect: Rect } | null }

interface Float {
  more?: Part[];
  layer: string;
  orig: Uint8ClampedArray;
  src: Raster;
  srcRect: Rect;
  canvas: OffscreenCanvas;
  quad: Point[];          // tl, tr, br, bl in canvas pixels
  grid: Point[][] | null; // warp control points (n x n, 4 to 8)
  bend: Bend[][] | null;  // per-node bending of the warp, null until a handle is used
  preview: { canvas: OffscreenCanvas; rect: Rect } | null;
}

export class PaintTools {
  readonly root: HTMLElement;
  private readonly host: ToolHost;
  private current: ToolMode = 'paint';
  private selectMode: SelectMode = 'automatic';
  /** Automatic: the region the current threshold would select, tinted while the threshold slides. */
  private cand: OffscreenCanvas | null = null;
  private candReq = 0;
  private readonly thrEl: HTMLElement;
  private readonly fthr: HTMLElement;
  private combineMode: CombineMode = 'replace';
  private transformMode: TransformMode = 'uniform';
  private interp: Interpolation = 'bilinear';
  private threshold = 0.3;
  /** Freehand polygon being built by taps, the pointer for its rubber band, and the last tap (double tap closes). */
  private poly: Point[] = [];
  private hover: Point | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  /** Filter state: noise choices, the value undo stack and the tap menu. */
  private fopts = { style: 'clouds' as 'clouds' | 'billows' | 'ridges', additive: false, multichannel: false };
  private readonly valueUndo: Record<string, number>[] = [];
  private fmenu: Popover | null = null;
  private more: { pop: Popover; all: PopRow } | null = null;
  private previewing = false;
  /** The transform box hugs the content (tight) or spans the whole layer (canvas). */
  private fit: 'tight' | 'canvas' = 'tight';
  private drag: { kind: string; start: Point; last: Point; pts: Point[]; i: number; j: number; quad0: Point[]; grid0: Point[][] | null; th0: number; cx: number } | null = null;
  private float: Float | null = null;
  private meshN = MESH_MIN;
  private node: { i: number; j: number } | null = null;
  private handle0: Point = { x: 0, y: 0 };
  private readonly repeat = new HoldRepeat(380, 60);
  private filter: FilterId | null = null;
  private values: Record<string, number> = {};
  private filterOrig: Uint8ClampedArray | null = null;
  private filterLayer = '';
  private filterReq = 0;
  private readonly modes: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly params: HTMLElement;
  private readonly filterMenu: HTMLElement;

  constructor(host: ToolHost) {
    this.host = host;
    this.root = el<HTMLElement>(TEMPLATE);
    this.modes = q(this.root, '.fm-ptools-modes');
    this.actions = q(this.root, '.fm-ptools-actions');
    this.params = q(this.root, '.fm-ptools-params');
    // the list reads Hue Saturation Brightness, Lens Blur, Gaussian Blur, Noise, Sharpen
    const order: FilterId[] = ['hsb', 'lens', 'blur', 'noise', 'sharpen'];
    const listed = [...FILTERS].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    this.filterMenu = el<HTMLElement>(`<div class="fm-pfilters fm-pop" hidden><div class="fm-pfilters-title">${tr('Adjustment filters')}</div>${listed.map((f) => `<button class="fm-pop-row" type="button" data-f="${f.id}">${f.label}</button>`).join('')}</div>`);
    // the filter screen's title chip: the filter's name and its live value over a progress line
    this.fthr = el<HTMLElement>('<div class="fm-thr fm-fthr" role="status" hidden><div class="fm-thr-row"><span class="fm-thr-title"></span><span class="fm-thr-val"></span></div><div class="fm-thr-line"><i></i></div></div>');
    this.root.appendChild(this.fthr);
    this.root.addEventListener('click', (e) => this.click(e));
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="preview"]')) { this.preview(true); return; }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-nudge]');
      if (!b || e.button !== 0) return;
      const [dx, dy] = NUDGE[b.dataset.nudge as string] ?? [0, 0];
      const step = (): void => { this.nudge(dx, dy, e.shiftKey); };
      try { b.setPointerCapture(e.pointerId); } catch { /* released already */ }
      this.repeat.start(step);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(t, () => { this.repeat.stop(); this.preview(false); });
    window.addEventListener('blur', () => this.preview(false));
    this.filterMenu.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-f]')?.dataset.f as FilterId | undefined;
      this.filterMenu.hidden = true;
      if (id) this.startFilter(id);
    });
    document.addEventListener('pointerdown', (e) => { if (!this.filterMenu.hidden && !this.filterMenu.contains(e.target as Node)) this.filterMenu.hidden = true; }, true);
    this.thrEl = el<HTMLElement>(`<div class="fm-thr" role="status" hidden><div class="fm-thr-row"><span class="fm-thr-title">${tr('Selection Threshold')}</span><span class="fm-thr-val"></span></div><div class="fm-thr-line"><i></i></div></div>`);
    queueMicrotask(() => { this.root.parentElement?.appendChild(this.filterMenu); this.root.parentElement?.appendChild(this.thrEl); });
  }

  /** The Automatic threshold readout (title, percent, progress line) and the candidate tint under it. */
  private showThreshold(on: boolean): void {
    setHidden(this.thrEl, !on);
    if (!on) { this.cand = null; return; }
    setText(q(this.thrEl, '.fm-thr-val'), `${Math.round(this.threshold * 100)}%`);
    this.thrEl.style.setProperty('--v', String(this.threshold));
    if (this.candReq) return;
    this.candReq = requestAnimationFrame(() => { this.candReq = 0; this.makeCandidate(); });
  }

  private makeCandidate(): void {
    const d = this.drag, doc = this.host.doc();
    if (!d || d.kind !== 'automatic' || !doc) { this.cand = null; return; }
    const x = Math.floor(d.start.x), y = Math.floor(d.start.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) { this.cand = null; return; }
    const m = autoMask(sampleAll.on ? doc.flattened() : doc.activeLayer().raster, x, y, this.threshold);
    const cv = this.cand && this.cand.width === m.width && this.cand.height === m.height ? this.cand : new OffscreenCanvas(m.width, m.height);
    const g = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const img = g.createImageData(m.width, m.height);
    const px = img.data;
    for (let i = 0, p = 0; i < m.data.length; i++, p += 4) {
      const a = m.data[i];
      if (!a) continue;
      px[p] = 0; px[p + 1] = 214; px[p + 2] = 255; px[p + 3] = (a * 110) / 255;
    }
    g.putImageData(img, 0, 0);
    this.cand = cv;
    this.host.redraw();
  }

  mode(): ToolMode { return this.current; }

  outlineOf(m: Mask): Point[][] { return maskOutline(m); }

  /** Move the floating piece by whole pixels (Shift multiplies by 10). False when nothing is floating. */
  nudge(dx: number, dy: number, big = false): boolean {
    const f = this.float;
    if (this.current !== 'transform' || !f) return false;
    const k = big ? 10 : 1;
    f.quad = nudgePoints(f.quad, dx * k, dy * k);
    if (f.grid) f.grid = f.grid.map((row) => nudgePoints(row, dx * k, dy * k));
    // whole-pixel steps move a resampled preview exactly, so it is shifted instead of resampled
    if (f.preview) { f.preview = { canvas: f.preview.canvas, rect: { ...f.preview.rect, x: f.preview.rect.x + dx * k, y: f.preview.rect.y + dy * k } }; this.host.redraw(); }
    else if (f.grid || this.transformMode === 'distort') this.refreshPreview();
    else this.host.setLive((ctx) => this.drawFloat(ctx));
    return true;
  }

  setMode(m: ToolMode): void {
    if (m === this.current) return;
    this.finish();
    this.current = m;
    if (m === 'transform') this.fit = 'tight';
    if (m === 'transform' && !this.lift()) { this.current = 'paint'; }
    this.build();
    this.host.setInteraction(this.current === 'select' || this.current === 'transform' || this.current === 'filters' ? this.interaction() : null);
    this.host.modeChanged();
  }

  openFilters(anchor: HTMLElement): void {
    if (!this.filterMenu.parentElement) this.root.parentElement?.appendChild(this.filterMenu);
    const host = (this.filterMenu.offsetParent as HTMLElement | null) ?? this.root.parentElement;
    const a = anchor.getBoundingClientRect(), h = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
    this.filterMenu.hidden = false;
    this.filterMenu.style.transform = `translate(${Math.round(a.left - h.left)}px, ${Math.round(a.bottom - h.top + 6)}px)`;
  }

  /** Commits whatever is in progress (transform, filter). */
  finish(): void {
    if (this.current === 'select') this.closePoly();
    if (this.current === 'transform') this.commitFloat();
    if (this.current === 'filters') this.applyFilter();
    if (this.current !== 'paint') {
      this.current = 'paint';
      this.build();
      this.host.setInteraction(null);
      this.host.setLive(null);
      this.host.modeChanged();
    }
  }

  cancel(): void {
    if (this.poly.length) { this.poly = []; this.host.redraw(); if (this.current === 'select') return; }
    if (this.current === 'transform') this.dropFloat();
    if (this.current === 'filters') this.cancelFilter();
    if (this.current !== 'paint') {
      this.current = 'paint';
      this.build();
      this.host.setInteraction(null);
      this.host.setLive(null);
      this.host.modeChanged();
    }
  }

  // ------------------------------------------------------------ capsule

  private build(): void {
    this.showThreshold(false);
    // the filter screen: the interface dims, a title chip sits on top, the sliders in a bottom pill, the actions on the right
    this.root.classList.toggle('is-filters', this.current === 'filters');
    this.root.parentElement?.classList.toggle('is-filtering', this.current === 'filters');
    setHidden(this.fthr, this.current !== 'filters');
    setHidden(this.root, this.current === 'paint');
    setHidden(this.params, this.current !== 'filters');
    setHidden(this.modes, this.current === 'filters');
    if (this.current === 'select') {
      this.variant(this.modes, 'select', () => htmlOf(SELECT_MODES.map((m) => `<button type="button" class="fm-ptools-mode" data-sel="${m.id}">${tr(m.label)}</button>`).join('')));
      // the six reference actions, then an overflow for the extras (Sample all layers, Reload, Deselect) and Done
      this.variant(this.actions, 'select', () => htmlOf([
        ['add', 'Add'], ['remove', 'Remove'], ['invert', 'Invert'], ['copy', 'Copy & Paste'], ['fill', 'Color Fill'], ['clear', 'Clear'],
      ].map(([id, label]) => `<button type="button" class="fm-ptools-act" data-act="${id}"${SEL_TIPS[id] ? ` title="${tr(SEL_TIPS[id])}"` : ''}>${tr(label)}</button>`).join('')
        + `<button type="button" class="fm-ptools-act fm-ptools-more" data-act="more" title="${tr('More: sample all layers, reload, deselect')}" aria-label="${tr('More')}"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button>`
        + `<button type="button" class="fm-ptools-act" data-act="done">${tr('Done')}</button>`));
      for (const b of this.modes.querySelectorAll<HTMLElement>('[data-sel]')) b.classList.toggle('is-active', b.dataset.sel === this.selectMode);
      for (const b of this.actions.querySelectorAll<HTMLElement>('[data-act="add"],[data-act="remove"]')) b.classList.toggle('is-active', b.dataset.act === this.combineMode);
      for (const b of this.actions.querySelectorAll<HTMLElement>('[data-act="more"]')) b.classList.toggle('has-on', sampleAll.on);
    } else if (this.current === 'transform') {
      this.variant(this.modes, 'transform', () => htmlOf(TRANSFORM_MODES.map((m) => `<button type="button" class="fm-ptools-mode" data-tr="${m.id}">${tr(m.label)}</button>`).join('')));
      this.variant(this.actions, 'transform', () => htmlOf(nudgePad() + [
        ['flipH', 'Flip horizontal'], ['flipV', 'Flip vertical'], ['rot', 'Rotate 45°'], ['interp', ''], ['mesh', ''], ['reset', 'Reset'], ['cancel', 'Cancel'], ['done', 'Done'],
      ].map(([id, label]) => `<button type="button" class="fm-ptools-act" data-act="${id}">${label ? tr(label) : ''}</button>`).join('')));
      for (const b of this.modes.querySelectorAll<HTMLElement>('[data-tr]')) b.classList.toggle('is-active', b.dataset.tr === this.transformMode);
      setText(this.actions.querySelector('[data-act="interp"]'), tr(INTERP_LABEL[this.interp]));
      const mesh = this.actions.querySelector<HTMLElement>('[data-act="mesh"]');
      // Advanced Mesh is dim outside Warp, as the reference shows it
      if (mesh) { setClass(mesh, 'is-dim', this.transformMode !== 'warp'); (mesh as HTMLButtonElement).disabled = this.transformMode !== 'warp'; setText(mesh, tr('Mesh {n} x {n}').replace(/\{n\}/g, String(this.meshN))); }
    } else if (this.current === 'filters' && this.filter) {
      const f = FILTERS.find((x) => x.id === this.filter)!;
      this.variant(this.params, f.id, () => {
        const hint = f.id === 'hsb' ? tr('tap the canvas for the menu') : tr('drag on the canvas to set {name}').replace('{name}', tr(f.params[0].label).toLowerCase());
        const choices = f.id === 'noise'
          ? `<div class="fm-ptools-choices">${(['clouds', 'billows', 'ridges'] as const).map((s) => `<button type="button" class="fm-ptools-mode" data-ns="${s}">${tr({ clouds: 'Clouds', billows: 'Billows', ridges: 'Ridges' }[s])}</button>`).join('')}<span class="fm-ptools-gap"></span><button type="button" class="fm-ptools-mode" data-nt="additive" title="${tr('Off fills all the empty paintable area')}">${tr('Additive')}</button><button type="button" class="fm-ptools-mode" data-nt="multichannel">${tr('Multichannel')}</button></div>`
          : '';
        const v = htmlOf(`<div class="fm-ptools-title">${tr(f.label)} <span>${hint}</span></div>${choices}${f.params.map((p) => `<label class="fm-ptools-param"><span>${tr(p.label)}</span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}" data-p="${p.id}"><output data-o="${p.id}"></output></label>`).join('')}`);
        for (const input of v.querySelectorAll<HTMLInputElement>('input[data-p]')) {
          input.addEventListener('pointerdown', () => this.pushUndo());
          input.addEventListener('input', () => { this.values[input.dataset.p as string] = Number(input.value); this.syncOutputs(); this.scheduleFilter(); });
        }
        for (const b of v.querySelectorAll<HTMLButtonElement>('[data-ns]')) b.addEventListener('click', () => { this.fopts.style = b.dataset.ns as 'clouds' | 'billows' | 'ridges'; this.syncChoices(); this.scheduleFilter(); });
        for (const b of v.querySelectorAll<HTMLButtonElement>('[data-nt]')) b.addEventListener('click', () => { const k = b.dataset.nt as 'additive' | 'multichannel'; this.fopts[k] = !this.fopts[k]; this.syncChoices(); this.scheduleFilter(); });
        return v;
      });
      setText(q(this.fthr, '.fm-thr-title'), tr(f.label));
      this.variant(this.actions, 'filters', () => htmlOf([['apply', 'Apply'], ['undo', 'Undo'], ['preview', 'Preview'], ['cancel', 'Cancel'], ['reset', 'Reset']].map(([id, label]) => `<button type="button" class="fm-ptools-act fm-ptools-tile" data-act="${id}" title="${id === 'preview' ? tr('Hold to see the original') : tr(label)}">${TILE_ICONS[id]}<span>${tr(label)}</span></button>`).join('')));
      this.syncChoices();
      this.syncOutputs();
    }
  }

  /** Shows the named child of a capsule row, making it the first time only; the others stay mounted, hidden. */
  private variant(parent: HTMLElement, key: string, make: () => HTMLElement): void {
    let found = false;
    for (const c of Array.from(parent.children) as HTMLElement[]) {
      const on = c.dataset.v === key;
      if (on) found = true;
      const d = on ? 'contents' : 'none';
      if (c.style.display !== d) c.style.display = d;
    }
    if (found) return;
    const v = make();
    v.dataset.v = key;
    v.style.display = 'contents';
    parent.appendChild(v);
  }

  private syncChoices(): void {
    for (const b of this.params.querySelectorAll<HTMLElement>('[data-ns]')) b.classList.toggle('is-active', b.dataset.ns === this.fopts.style);
    for (const b of this.params.querySelectorAll<HTMLElement>('[data-nt]')) b.classList.toggle('is-active', this.fopts[b.dataset.nt as 'additive' | 'multichannel']);
  }

  /** Remember the values before a change so Undo can step back through them. */
  private pushUndo(): void {
    this.valueUndo.push({ ...this.values });
    if (this.valueUndo.length > 40) this.valueUndo.shift();
  }

  private undoValue(): void {
    const prev = this.valueUndo.pop();
    if (!prev) { this.host.say(tr('Nothing to undo')); return; }
    this.values = prev;
    this.syncOutputs();
    this.scheduleFilter();
  }

  /** Hold Preview: the original shows while held, the filtered result returns on release. */
  private preview(on: boolean): void {
    const doc = this.host.doc();
    const layer = doc?.layer(this.filterLayer);
    if (this.current !== 'filters' || !doc || !layer || !this.filterOrig || this.previewing === on) return;
    this.previewing = on;
    if (on) {
      if (this.filterReq) { cancelAnimationFrame(this.filterReq); this.filterReq = 0; }
      layer.raster.data.set(this.filterOrig);
      doc.markDirty(layer.id, { x: 0, y: 0, w: doc.width, h: doc.height });
    } else this.runFilter();
  }

  private openFilterMenu(x: number, y: number): void {
    if (!this.fmenu) {
      const pop = new Popover('fm-pfmenu', 190);
      const row = (label: string, run: () => void): ReturnType<typeof popRow> => {
        const r = popRow(null, tr(label));
        r.el.addEventListener('click', () => { pop.hide(); run(); });
        return r;
      };
      const prev = popRow(null, tr('Preview'));
      prev.setValue(tr('hold'));
      prev.el.addEventListener('pointerdown', () => this.preview(true));
      for (const t of ['pointerup', 'pointerleave', 'pointercancel']) prev.el.addEventListener(t, () => this.preview(false));
      pop.el.append(row('Apply', () => this.finish()).el, row('Undo', () => this.undoValue()).el, row('Reset', () => { this.pushUndo(); this.values = {}; this.syncOutputs(); this.scheduleFilter(); }).el, popSep(), prev.el, popSep(), row('Cancel', () => this.cancel()).el);
      pop.onHide(() => this.preview(false));
      this.fmenu = pop;
    }
    this.fmenu.showAt(x, y);
  }

  private syncOutputs(): void {
    const f = FILTERS.find((x) => x.id === this.filter);
    if (!f) return;
    const scope = this.params.querySelector<HTMLElement>(`[data-v="${f.id}"]`) ?? this.params;
    // the title chip shows the first slider's value, and its progress line follows it
    const p0 = f.params[0];
    const v0 = this.values[p0.id] ?? p0.def;
    setText(q(this.fthr, '.fm-thr-val'), f.id === 'hsb' ? '' : `${Math.round(v0 * p0.scale)}${p0.unit}`);
    this.fthr.style.setProperty('--v', String(Math.max(0, Math.min(1, (v0 - p0.min) / (p0.max - p0.min || 1)))));
    for (const p of f.params) {
      const v = this.values[p.id] ?? p.def;
      setText(scope.querySelector(`[data-o="${p.id}"]`), `${Math.round(v * p.scale)}${p.unit}`);
      const input = scope.querySelector<HTMLInputElement>(`input[data-p="${p.id}"]`);
      if (input && Number(input.value) !== v) input.value = String(v);
    }
  }

  private click(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.sel) { this.selectMode = t.dataset.sel as SelectMode; this.build(); return; }
    if (t.dataset.tr) { this.setTransformMode(t.dataset.tr as TransformMode); return; }
    if (t.dataset.act === 'more') { this.openMore(t); return; }
    this.runAct(t.dataset.act, t);
  }

  /** The Select bar's overflow: the extras that are not among the six reference actions. */
  private openMore(anchor: HTMLElement): void {
    if (!this.more) {
      const pop = new Popover('fm-pmore', 220);
      const row = (id: string, label: string, tip: string, check = false): PopRow => {
        const r = popRow(null, tr(label), { check });
        r.el.title = tr(tip);
        r.el.addEventListener('click', () => { pop.hide(); this.runAct(id, anchor); });
        return r;
      };
      const all = row('all', 'Sample all layers', SEL_TIPS.all, true);
      const reload = row('reload', 'Reload', 'Bring back the previous selection of this session');
      const none = row('none', 'Deselect', SEL_TIPS.none);
      pop.el.append(all.el, reload.el, popSep(), none.el);
      pop.onHide(() => { setClass(anchor, 'is-open', false); });
      this.more = { pop, all };
    }
    this.more.all.setChecked(sampleAll.on);
    setClass(anchor, 'is-open', true);
    this.more.pop.showFor(anchor, 'above');
  }

  private runAct(act: string | undefined, t: HTMLElement): void {
    const doc = this.host.doc();
    if (!act || !doc) return;
    const sel = this.host.selection();
    const layer = doc.activeLayer();
    switch (act) {
      case 'add': this.combineMode = this.combineMode === 'add' ? 'replace' : 'add'; this.build(); break;
      case 'remove': this.combineMode = this.combineMode === 'remove' ? 'replace' : 'remove'; this.build(); break;
      case 'all': sampleAll.on = !sampleAll.on; this.build(); break;
      case 'invert': this.host.setSelection(sel ? invertMask(sel) : null); break;
      case 'none': this.host.setSelection(null); break;
      case 'fill': {
        const m = sel ?? rectMask(doc.width, doc.height, { x: 0, y: 0, w: doc.width, h: doc.height });
        const p = fillMask(layer.raster, m, this.host.color(), layer.id);
        if (p.rect.w && p.rect.h) { doc.markDirty(layer.id, p.rect); doc.commitPatch(p, 'Fill'); }
        break;
      }
      case 'clear': {
        if (!sel) { this.host.say('Select an area first'); break; }
        const p = clearMask(layer.raster, sel, layer.id);
        if (p.rect.w && p.rect.h) { doc.markDirty(layer.id, p.rect); doc.commitPatch(p, 'Clear'); }
        break;
      }
      case 'reload': this.host.reloadSelection?.(); break;
      case 'undo': this.undoValue(); break;
      case 'copy': {
        if (this.host.clipMenu) { const r = t.getBoundingClientRect(); this.host.clipMenu(r.left, r.top - 190); break; }
        if (!sel) { this.host.say('Select an area first'); break; }
        const piece = extract(layer.raster, sel);
        if (!piece.rect.w) break;
        const fresh = doc.addLayer(layer.id, `${layer.name} copy`);
        const before = readRect(fresh.raster, piece.rect);
        writeOver(fresh.raster, piece.raster, piece.rect.x, piece.rect.y);
        doc.markDirty(fresh.id, piece.rect);
        doc.commitPatch({ layer: fresh.id, rect: piece.rect, before, after: readRect(fresh.raster, piece.rect) }, 'Copy and paste');
        break;
      }
      case 'flipH': case 'flipV': case 'rot': this.quadOp(act); break;
      case 'interp': this.interp = INTERP[(INTERP.indexOf(this.interp) + 1) % INTERP.length]; this.build(); this.refreshPreview(); break;
      case 'reset':
        if (this.current === 'transform' && this.float) { this.float.quad = rectQuad(this.float.srcRect); this.float.grid = this.transformMode === 'warp' ? makeGrid(this.float.quad, this.meshN) : null; this.float.bend = null; this.node = null; this.refreshPreview(); }
        if (this.current === 'filters') { this.pushUndo(); this.values = {}; this.syncOutputs(); this.scheduleFilter(); }
        break;
      case 'mesh': {
        this.meshN = this.meshN >= MESH_MAX ? MESH_MIN : this.meshN + 1;
        setText(t, tr('Mesh {n} x {n}').replace(/\{n\}/g, String(this.meshN)));
        const f = this.float;
        if (f?.grid) { f.grid = resampleGrid(f.grid, this.meshN); f.bend = null; this.node = null; this.refreshPreview(); }
        break;
      }
      case 'cancel': this.cancel(); break;
      case 'done': case 'apply': this.finish(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ interactions

  private interaction(): Interaction {
    return {
      down: (e) => this.down(e),
      move: (e) => this.move(e),
      up: (e) => this.up(e),
    };
  }

  private down(e: PointerEvent): void {
    const p = this.host.toCanvas(e.clientX, e.clientY);
    const base = { start: p, last: p, pts: [p], i: -1, j: -1, quad0: this.float?.quad.map((x) => ({ ...x })) ?? [], grid0: this.float?.grid?.map((r) => r.map((x) => ({ ...x }))) ?? null, th0: this.threshold, cx: e.clientX };
    if (this.current === 'select') {
      this.drag = { kind: this.selectMode, ...base };
      if (this.selectMode === 'automatic') this.showThreshold(true);
      return;
    }
    if (this.current === 'filters') { this.drag = { kind: 'filter', ...base, th0: this.values[this.firstParam()] ?? FILTERS.find((x) => x.id === this.filter)?.params[0]?.def ?? 0 }; return; }
    if (this.current === 'transform' && this.float) {
      const hit = this.hitHandle(e);
      if (hit.kind === 'fit') { this.toggleFit(); return; }
      this.drag = { kind: hit.kind, ...base, i: hit.i, j: hit.j };
      if (hit.kind === 'grid') this.node = { i: hit.i, j: hit.j };
      if ((hit.kind === 'bendu' || hit.kind === 'bendv') && this.float?.grid) {
        const h = bendHandles(this.float.grid, this.float.bend, hit.i, hit.j);
        this.handle0 = hit.kind === 'bendu' ? h.u : h.v;
      }
      this.host.redraw();
    }
  }

  private move(e: PointerEvent): void {
    if (this.poly.length) { this.hover = this.host.toCanvas(e.clientX, e.clientY); this.host.redraw(); }
    const d = this.drag;
    if (!d) return;
    let p = this.host.toCanvas(e.clientX, e.clientY);
    if (this.current === 'select' && e.shiftKey && (d.kind === 'rectangle' || d.kind === 'ellipse')) p = squareTo(d.start, p);
    d.last = p;
    if (this.current === 'select') {
      if (d.kind === 'freehand') d.pts.push(p);
      if (d.kind === 'automatic') { this.threshold = clamp(d.th0 + (e.clientX - d.cx) / 400, 0.01, 1); this.showThreshold(true); return; }
      this.host.redraw();
      return;
    }
    if (this.current === 'filters') {
      const f = FILTERS.find((x) => x.id === this.filter);
      const prm = f?.params[0];
      if (!prm || f?.id === 'hsb') return;
      if (d.i < 0 && Math.abs(e.clientX - d.cx) > 3) { d.i = 1; this.pushUndo(); }
      this.values[prm.id] = clamp(d.th0 + ((e.clientX - d.cx) / 600) * (prm.max - prm.min), prm.min, prm.max);
      this.syncOutputs();
      this.scheduleFilter();
      return;
    }
    if (this.current === 'transform' && this.float) this.dragTransform(d, p, e.shiftKey);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'automatic') { this.showThreshold(false); this.host.redraw(); }
    const doc = this.host.doc();
    if (!d || !doc) return;
    let p = this.host.toCanvas(e.clientX, e.clientY);
    if (this.current === 'filters') {
      if (d.i < 0 && Math.abs(e.clientX - d.cx) <= 3) this.openFilterMenu(e.clientX, e.clientY);
      return;
    }
    if (this.current === 'select' && e.shiftKey && (d.kind === 'rectangle' || d.kind === 'ellipse')) p = squareTo(d.start, p);
    if (this.current === 'select' && d.kind === 'freehand' && this.tapPoly(d, p)) return;
    if (this.current === 'select') {
      let m: Mask | null = null;
      const r = normRect(d.start, p);
      if (d.kind === 'rectangle' && r.w > 1 && r.h > 1) m = rectMask(doc.width, doc.height, r);
      else if (d.kind === 'ellipse' && r.w > 1 && r.h > 1) m = ellipseMask(doc.width, doc.height, r);
      else if (d.kind === 'freehand' && d.pts.length > 2) m = polygonMask(doc.width, doc.height, d.pts);
      else if (d.kind === 'automatic') {
        const x = Math.floor(d.start.x), y = Math.floor(d.start.y);
        if (x >= 0 && y >= 0 && x < doc.width && y < doc.height) m = autoMask(sampleAll.on ? doc.flattened() : doc.activeLayer().raster, x, y, this.threshold);
      } else if (this.combineMode === 'replace') { this.host.setSelection(null); return; }
      if (!m) { this.host.redraw(); return; }
      const next = combine(this.host.selection(), m, this.combineMode);
      this.host.setSelection(isEmpty(next) ? null : next);
      return;
    }
    if (this.current === 'transform' && d.kind === 'move' && e.pointerType === 'touch' && this.edgeTap(d, p)) return;
    if (this.current === 'transform' && (this.transformMode === 'distort' || this.transformMode === 'warp')) this.refreshPreview();
  }

  /** Touch: a tap just outside an outer edge nudges the content 1 px toward it, outside a corner diagonally. */
  private edgeTap(d: NonNullable<PaintTools['drag']>, p: Point): boolean {
    const s = this.host.view().scale;
    if (!d.quad0.length || Math.hypot(p.x - d.start.x, p.y - d.start.y) * s > 5) return false;
    const xs = d.quad0.map((a) => a.x), ys = d.quad0.map((a) => a.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const dx = d.start.x < x0 ? -1 : d.start.x > x1 ? 1 : 0, dy = d.start.y < y0 ? -1 : d.start.y > y1 ? 1 : 0;
    if (!dx && !dy) return false;
    const gx = dx < 0 ? x0 - d.start.x : dx > 0 ? d.start.x - x1 : 0, gy = dy < 0 ? y0 - d.start.y : dy > 0 ? d.start.y - y1 : 0;
    if (Math.max(gx, gy) * s > 44) return false;
    return this.nudge(dx, dy);
  }

  /** A Freehand tap adds a polygon corner; tapping the first dot or double tapping closes it. False when the press was a trace. */
  private tapPoly(d: NonNullable<PaintTools['drag']>, p: Point): boolean {
    const s = this.host.view().scale;
    const tap = d.pts.length < 4 && Math.hypot(p.x - d.start.x, p.y - d.start.y) * s < 6;
    if (!tap) { this.poly = []; this.hover = null; return false; }
    const now = performance.now();
    const again = now - this.lastTap.t < 380 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) * s < 10;
    this.lastTap = { t: now, x: p.x, y: p.y };
    if (this.poly.length >= 3 && (again || Math.hypot(p.x - this.poly[0].x, p.y - this.poly[0].y) * s < 12)) { this.closePoly(); return true; }
    if (!again) this.poly.push({ x: d.start.x, y: d.start.y });
    this.hover = p;
    this.host.redraw();
    return true;
  }

  /** Turns the tapped corners into a selection (choosing another tool does this too). */
  private closePoly(): void {
    const doc = this.host.doc();
    const pts = this.poly;
    this.poly = [];
    this.hover = null;
    if (!doc || pts.length < 3) { this.host.redraw(); return; }
    const next = combine(this.host.selection(), polygonMask(doc.width, doc.height, pts), this.combineMode);
    this.host.setSelection(isEmpty(next) ? null : next);
  }

  private firstParam(): string {
    return FILTERS.find((x) => x.id === this.filter)?.params[0].id ?? 'amount';
  }

  /** Screen-space overlay: the selection being drawn, the transform box and handles. */
  drawOverlay(ctx: CanvasRenderingContext2D, v: { scale: number; ox: number; oy: number }): void {
    const S = (p: Point): Point => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale });
    const d = this.drag;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent();
    if (this.current === 'select' && d && d.kind === 'automatic' && this.cand) {
      const o = S({ x: 0, y: 0 });
      ctx.drawImage(this.cand, o.x, o.y, this.cand.width * v.scale, this.cand.height * v.scale);
    }
    if (this.current === 'select' && d) {
      ctx.beginPath();
      if (d.kind === 'freehand') d.pts.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      else if (d.kind === 'rectangle' || d.kind === 'ellipse') {
        const a = S(d.start), b = S(d.last);
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
        if (d.kind === 'rectangle') ctx.rect(x, y, w, h); else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      }
      // a moving black and white line while the selection is drawn (it advances with every pointer move)
      ctx.lineWidth = 1.25;
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.stroke();
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -(performance.now() / 45) % 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.95)';
      ctx.stroke();
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = accent();
      ctx.lineWidth = 1.5;
    }
    if (this.current === 'select' && this.poly.length) {
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      this.poly.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      if (this.hover) { const h = S(this.hover); ctx.lineTo(h.x, h.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      const first = S(this.poly[0]);
      ctx.fillStyle = '#9a9aa2';
      dot(ctx, first, 6);
      for (const p of this.poly.slice(1)) dot(ctx, S(p), 3.5);
    }
    const f = this.float;
    if (this.current === 'transform' && f) {
      ctx.setLineDash([4, 4]);
      const q4 = f.quad.map(S);
      ctx.beginPath();
      q4.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      if (f.grid && this.transformMode === 'warp') {
        ctx.beginPath();
        for (const row of f.grid) row.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
        for (let c = 0; c < f.grid[0].length; c++) f.grid.forEach((row, i) => { const s = S(row[c]); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
        ctx.stroke();
        for (const row of f.grid) for (const p of row) dot(ctx, S(p), 5);
        const n = this.node;
        if (n && f.grid[n.i]?.[n.j]) {
          const h = bendHandles(f.grid, f.bend, n.i, n.j);
          const c = S(f.grid[n.i][n.j]);
          ctx.fillStyle = accent();
          dot(ctx, c, 6.5);
          ctx.fillStyle = '#ffffff';
          for (const hp of [S(h.u), S(h.v)]) {
            ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(hp.x, hp.y); ctx.stroke();
            ctx.fillStyle = '#30c46c';
            ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
      } else {
        // small filled round dots; the amber node below the box fits it to the content (tight) or the whole layer
        for (const p of q4) dot(ctx, p, 4.5);
        for (let i = 0; i < 4; i++) dot(ctx, mid(q4[i], q4[(i + 1) % 4]), 3.5);
        const fn = fitNode(q4);
        const fb = mid(q4[2], q4[3]);
        ctx.beginPath(); ctx.moveTo(fb.x, fb.y); ctx.lineTo(fn.x, fn.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(fn.x, fn.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#f2a900'; ctx.fill(); ctx.stroke();
        if (this.transformMode !== 'distort') {
          const r = this.rotateHandle(q4);
          ctx.beginPath(); ctx.moveTo(r.from.x, r.from.y); ctx.lineTo(r.at.x, r.at.y); ctx.stroke();
          ctx.fillStyle = '#30c46c';
          ctx.beginPath(); ctx.arc(r.at.x, r.at.y, 6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ transform

  private lift(): boolean {
    const doc = this.host.doc();
    if (!doc) return false;
    const picked = (this.host.layerSelection?.() ?? []).map((id) => doc.layer(id)).filter((l): l is PaintLayer => !!l && !l.group && l.visible);
    if (picked.length > 1 && this.liftMany(doc, picked)) return true;
    const layer = doc.activeLayer();
    const sel = this.host.selection();
    const mask = sel ?? alphaMask(layer.raster);
    const bounds = mask ? maskBounds(mask) : null;
    if (!mask || !bounds) { this.host.say('Nothing to transform on this layer'); return false; }
    const orig = new Uint8ClampedArray(layer.raster.data);
    const piece = this.fit === 'canvas' ? extractIn(layer.raster, mask, { x: 0, y: 0, w: doc.width, h: doc.height }) : extract(layer.raster, mask);
    clearMask(layer.raster, mask, layer.id);
    doc.markDirty(layer.id, bounds);
    const canvas = new OffscreenCanvas(Math.max(1, piece.raster.width), Math.max(1, piece.raster.height));
    (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(piece.raster.data), piece.raster.width, piece.raster.height), 0, 0);
    this.float = { layer: layer.id, orig, src: piece.raster, srcRect: piece.rect, canvas, quad: rectQuad(piece.rect), grid: null, bend: null, preview: null };
    this.transformMode = this.transformMode === 'warp' ? 'freeform' : this.transformMode;
    this.host.setLive((ctx) => this.drawFloat(ctx));
    return true;
  }

  /** Lifts the same area of several layers at once; one box, one undo step. False when none has content there. */
  private liftMany(doc: PaintDoc, layers: PaintLayer[]): boolean {
    const sel = this.host.selection();
    const items = layers.map((layer) => ({ layer, mask: sel ?? alphaMask(layer.raster) })).filter((x) => x.mask && maskBounds(x.mask));
    if (!items.length) return false;
    let box: Rect | null = null;
    for (const it of items) { const b = maskBounds(it.mask as Mask) as Rect; box = box ? unite(box, b) : b; }
    const rect = this.fit === 'canvas' ? { x: 0, y: 0, w: doc.width, h: doc.height } : (box as Rect);
    const parts: Part[] = items.map((it) => {
      const mask = it.mask as Mask;
      const orig = new Uint8ClampedArray(it.layer.raster.data);
      const piece = extractIn(it.layer.raster, mask, rect);
      clearMask(it.layer.raster, mask, it.layer.id);
      doc.markDirty(it.layer.id, maskBounds(mask) as Rect);
      const canvas = new OffscreenCanvas(Math.max(1, piece.raster.width), Math.max(1, piece.raster.height));
      (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(piece.raster.data), piece.raster.width, piece.raster.height), 0, 0);
      return { layer: it.layer.id, orig, src: piece.raster, canvas, preview: null };
    });
    const first = parts[0];
    this.float = { layer: first.layer, orig: first.orig, src: first.src, srcRect: rect, canvas: first.canvas, quad: rectQuad(rect), grid: null, bend: null, preview: null, more: parts.slice(1) };
    this.transformMode = this.transformMode === 'warp' ? 'freeform' : this.transformMode;
    this.host.setLive((ctx) => this.drawFloat(ctx));
    return true;
  }

  /** The amber node: the box hugs the content, or spans the whole layer. */
  private toggleFit(): void {
    const f = this.float;
    const doc = this.host.doc();
    const layer = f && doc ? doc.layer(f.layer) : null;
    if (!f || !doc || !layer) return;
    layer.raster.data.set(f.orig);
    doc.markDirty(layer.id, { x: 0, y: 0, w: doc.width, h: doc.height });
    this.restoreMore(f, doc);
    this.fit = this.fit === 'tight' ? 'canvas' : 'tight';
    this.float = null;
    if (!this.lift()) this.fit = 'tight';
    this.node = null;
    this.host.say(tr(this.fit === 'canvas' ? 'The box fits the whole layer' : 'The box fits the content'));
    this.refreshPreview();
  }

  /** Puts the other lifted layers back as they were. */
  private restoreMore(f: Float, doc: PaintDoc): void {
    for (const p of f.more ?? []) {
      const l = doc.layer(p.layer);
      if (!l) continue;
      l.raster.data.set(p.orig);
      doc.markDirty(l.id, { x: 0, y: 0, w: doc.width, h: doc.height });
    }
  }

  private drawFloat(ctx: Ctx): void {
    const f = this.float;
    if (!f) return;
    if (f.preview && (this.transformMode === 'distort' || this.transformMode === 'warp' || f.grid)) {
      ctx.drawImage(f.preview.canvas, f.preview.rect.x, f.preview.rect.y);
      for (const p of f.more ?? []) if (p.preview) ctx.drawImage(p.preview.canvas, p.preview.rect.x, p.preview.rect.y);
      return;
    }
    if (f.grid || this.transformMode === 'distort') {
      // mid-drag: a cheap triangle mesh; the full resample runs on release
      const pieces = [f.canvas, ...(f.more ?? []).map((p) => p.canvas)];
      if (f.grid) drawGridPreview(ctx, pieces, f.grid, f.bend); else drawQuadPreview(ctx, pieces, f.quad);
      return;
    }
    const [a, b, , d] = f.quad;
    const r = f.srcRect;
    ctx.save();
    ctx.transform((b.x - a.x) / r.w, (b.y - a.y) / r.w, (d.x - a.x) / r.h, (d.y - a.y) / r.h, a.x, a.y);
    ctx.imageSmoothingEnabled = this.interp !== 'nearest';
    ctx.drawImage(f.canvas, 0, 0);
    for (const p of f.more ?? []) ctx.drawImage(p.canvas, 0, 0);
    ctx.restore();
  }

  /** Distort and warp previews are resampled for real (they are not affine). */
  private refreshPreview(): void {
    const f = this.float;
    const doc = this.host.doc();
    if (!f || !doc) { this.host.redraw(); return; }
    if (!(this.transformMode === 'distort' || this.transformMode === 'warp')) { f.preview = null; for (const p of f.more ?? []) p.preview = null; this.host.redraw(); return; }
    const one = (src: Raster): { canvas: OffscreenCanvas; rect: Rect } | null => {
      const dst: Raster = { width: doc.width, height: doc.height, data: new Uint8ClampedArray(doc.width * doc.height * 4) };
      const rect = f.grid ? transformMesh(src, refineGridBent(f.grid, f.bend, 4), dst, this.interp) : transformQuad(src, quad4(f.quad), dst, this.interp);
      if (!rect) return null;
      const cv = new OffscreenCanvas(rect.w, rect.h);
      (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(readRect(dst, rect)), rect.w, rect.h), 0, 0);
      return { canvas: cv, rect };
    };
    f.preview = one(f.src);
    for (const p of f.more ?? []) p.preview = one(p.src);
    if (!f.preview) { this.host.redraw(); return; }
    this.host.setLive((ctx) => this.drawFloat(ctx));
  }

  private setTransformMode(m: TransformMode): void {
    const f = this.float;
    this.transformMode = m;
    if (f) {
      if (m === 'warp') f.grid = f.grid ?? makeGrid(f.quad, this.meshN);
      else if (f.grid) { f.grid = null; f.bend = null; f.quad = rectQuad(f.srcRect); }
      this.node = null;
      if (m === 'freeform' || m === 'uniform') f.preview = null;
    }
    this.build();
    this.refreshPreview();
  }

  private hitHandle(e: PointerEvent): { kind: string; i: number; j: number } {
    const f = this.float as Float;
    const v = this.host.view();
    const S = (p: Point): Point => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale });
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const rel = { x: e.clientX - r.left, y: e.clientY - r.top };
    const m = this.host.unrotate ? this.host.unrotate(rel.x, rel.y) : rel;
    const near = (p: Point): boolean => Math.hypot(p.x - m.x, p.y - m.y) < 14;
    if (f.grid && this.transformMode === 'warp') {
      const n = this.node;
      if (n && f.grid[n.i]?.[n.j]) {
        const h = bendHandles(f.grid, f.bend, n.i, n.j);
        const du = Math.hypot(S(h.u).x - m.x, S(h.u).y - m.y), dv = Math.hypot(S(h.v).x - m.x, S(h.v).y - m.y);
        if (Math.min(du, dv) < 14) return { kind: du <= dv ? 'bendu' : 'bendv', i: n.i, j: n.j };
      }
      for (let i = 0; i < f.grid.length; i++) for (let j = 0; j < f.grid[i].length; j++) if (near(S(f.grid[i][j]))) return { kind: 'grid', i, j };
      return { kind: 'move', i: -1, j: -1 };
    }
    const q4 = f.quad.map(S);
    if (near(fitNode(q4))) return { kind: 'fit', i: -1, j: -1 };
    if (this.transformMode !== 'distort' && near(this.rotateHandle(q4).at)) return { kind: 'rotate', i: -1, j: -1 };
    for (let i = 0; i < 4; i++) if (near(q4[i])) return { kind: 'corner', i, j: -1 };
    for (let i = 0; i < 4; i++) if (near(mid(q4[i], q4[(i + 1) % 4]))) return { kind: this.transformMode === 'distort' ? 'shear' : 'edge', i, j: -1 };
    return { kind: 'move', i: -1, j: -1 };
  }

  private rotateHandle(q4: Point[]): { from: Point; at: Point } {
    const top = mid(q4[0], q4[1]);
    const c = centre(q4);
    const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
    return { from: top, at: { x: top.x + ((top.x - c.x) / len) * 28, y: top.y + ((top.y - c.y) / len) * 28 } };
  }

  private dragTransform(d: NonNullable<PaintTools['drag']>, p: Point, shift: boolean): void {
    const f = this.float as Float;
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    const q0 = d.quad0;
    if (d.kind === 'move') {
      f.quad = q0.map((x) => ({ x: x.x + dx, y: x.y + dy }));
      if (f.grid && d.grid0) f.grid = d.grid0.map((row) => row.map((x) => ({ x: x.x + dx, y: x.y + dy })));
    } else if (d.kind === 'grid' && f.grid && d.grid0) {
      f.grid = d.grid0.map((row, i) => row.map((x, j) => (i === d.i && j === d.j ? { x: x.x + dx, y: x.y + dy } : x)));
    } else if ((d.kind === 'bendu' || d.kind === 'bendv') && f.grid) {
      const w = d.kind === 'bendu' ? 'u' : 'v';
      f.bend = f.bend ?? zeroBends(f.grid.length, f.grid[0].length);
      const cur = f.bend[d.i][d.j];
      f.bend[d.i][d.j] = { ...cur, [w]: bendFor(f.grid, d.i, d.j, w, { x: this.handle0.x + dx, y: this.handle0.y + dy }) };
    } else if (d.kind === 'rotate') {
      const c = centre(q0);
      let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.start.y - c.y, d.start.x - c.x);
      if (shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      f.quad = q0.map((x) => rotate(x, c, a));
    } else if (d.kind === 'corner' && this.transformMode === 'distort') {
      f.quad = q0.map((x, i) => (i === d.i ? { x: x.x + dx, y: x.y + dy } : x));
    } else if (d.kind === 'shear') {
      // the edge's two corners slide together along the edge: a shear of the box
      const a = q0[d.i], b = q0[(d.i + 1) % 4];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const k = (dx * (b.x - a.x) + dy * (b.y - a.y)) / len / len;
      f.quad = q0.map((x, i) => (i === d.i || i === (d.i + 1) % 4 ? { x: x.x + (b.x - a.x) * k, y: x.y + (b.y - a.y) * k } : x));
    } else if (d.kind === 'fit') {
      return;
    } else if (d.kind === 'corner' || d.kind === 'edge') {
      f.quad = scaleQuad(q0, d.kind, d.i, p, this.transformMode === 'uniform' !== shift);
    }
    if (this.transformMode === 'distort' || f.grid) { f.preview = null; this.host.setLive(null); }
    this.host.setLive((ctx) => this.drawFloat(ctx));
  }

  private quadOp(op: string): void {
    const f = this.float;
    if (!f) return;
    const c = centre(f.quad);
    if (op === 'rot') f.quad = f.quad.map((x) => rotate(x, c, Math.PI / 4));
    if (op === 'flipH') f.quad = [f.quad[1], f.quad[0], f.quad[3], f.quad[2]];
    if (op === 'flipV') f.quad = [f.quad[3], f.quad[2], f.quad[1], f.quad[0]];
    if (f.grid) { f.grid = makeGrid(f.quad, this.meshN); f.bend = null; this.node = null; }
    this.refreshPreview();
  }

  private commitFloat(): void {
    const f = this.float;
    const doc = this.host.doc();
    this.float = null;
    this.host.setLive(null);
    if (!f || !doc) return;
    const layer = doc.layer(f.layer);
    if (!layer) return;
    const r = f.grid ? transformMesh(f.src, refineGridBent(f.grid, f.bend, 4), layer.raster, this.interp) : transformQuad(f.src, quad4(f.quad), layer.raster, this.interp);
    const union = r ? unite(f.srcRect, r) : f.srcRect;
    const rect = clipRect(union, doc.width, doc.height);
    if (!rect) return;
    const before = readRect({ width: doc.width, height: doc.height, data: f.orig }, rect);
    doc.markDirty(layer.id, rect);
    const patches = [{ layer: layer.id, rect, before, after: readRect(layer.raster, rect) }];
    for (const p of f.more ?? []) {
      const l = doc.layer(p.layer);
      if (!l) continue;
      f.grid ? transformMesh(p.src, refineGridBent(f.grid, f.bend, 4), l.raster, this.interp) : transformQuad(p.src, quad4(f.quad), l.raster, this.interp);
      doc.markDirty(l.id, rect);
      patches.push({ layer: l.id, rect, before: readRect({ width: doc.width, height: doc.height, data: p.orig }, rect), after: readRect(l.raster, rect) });
    }
    doc.commitPatches(patches, 'Transform');
    if (this.host.selection()) this.host.setSelection(null);
  }

  private dropFloat(): void {
    const f = this.float;
    const doc = this.host.doc();
    this.float = null;
    this.host.setLive(null);
    if (!f || !doc) return;
    const layer = doc.layer(f.layer);
    if (!layer) return;
    layer.raster.data.set(f.orig);
    doc.markDirty(layer.id, { x: 0, y: 0, w: doc.width, h: doc.height });
    this.restoreMore(f, doc);
    doc.settle();
  }

  // ------------------------------------------------------------ filters

  private startFilter(id: FilterId): void {
    const doc = this.host.doc();
    if (!doc) return;
    this.finish();
    this.filter = id;
    this.values = {};
    this.valueUndo.length = 0;
    this.previewing = false;
    const layer = doc.activeLayer();
    this.filterLayer = layer.id;
    this.filterOrig = new Uint8ClampedArray(layer.raster.data);
    this.current = 'filters';
    this.build();
    this.host.setInteraction(this.interaction());
    this.host.modeChanged();
  }

  private scheduleFilter(): void {
    if (this.filterReq) return;
    this.filterReq = requestAnimationFrame(() => { this.filterReq = 0; this.runFilter(); });
  }

  private runFilter(): void {
    const doc = this.host.doc();
    const orig = this.filterOrig;
    const layer = doc?.layer(this.filterLayer);
    if (!doc || !orig || !this.filter || !layer || this.previewing) return;
    const src: Raster = { width: doc.width, height: doc.height, data: orig };
    const dst = layer.raster;
    const v = (id: string): number => this.values[id] ?? FILTERS.find((x) => x.id === this.filter)!.params.find((p) => p.id === id)!.def;
    const side = Math.max(doc.width, doc.height) * 0.05;
    switch (this.filter) {
      case 'hsb': hsb(src, dst, v('hue'), v('saturation'), v('brightness')); break;
      case 'blur': gaussianBlur(src, dst, v('radius') * side); break;
      case 'sharpen': sharpen(src, dst, v('amount')); break;
      case 'noise': noise(src, dst, { ...FILTER_DEFAULTS.noise, style: this.fopts.style, amount: v('amount'), scale: v('scale'), octaves: v('octaves'), turbulence: v('turbulence'), offsetX: 0, offsetY: 0, travel: 0, additive: this.fopts.additive, multichannel: this.fopts.multichannel }, 11); break;
      case 'lens': lensBlur(src, dst, v('radius') * side, v('brightness'), v('contrast')); break;
    }
    const sel = this.host.selection();
    if (sel) {
      const a = orig, b = dst.data, m = sel.data;
      for (let i = 0, p = 0; i < m.length; i++, p += 4) {
        const k = m[i];
        if (k === 255) continue;
        const t = k / 255;
        b[p] = a[p] + (b[p] - a[p]) * t; b[p + 1] = a[p + 1] + (b[p + 1] - a[p + 1]) * t; b[p + 2] = a[p + 2] + (b[p + 2] - a[p + 2]) * t; b[p + 3] = a[p + 3] + (b[p + 3] - a[p + 3]) * t;
      }
    }
    doc.markDirty(layer.id, { x: 0, y: 0, w: doc.width, h: doc.height });
  }

  private applyFilter(): void {
    const doc = this.host.doc();
    this.previewing = false;
    if (this.filterReq) { cancelAnimationFrame(this.filterReq); this.filterReq = 0; }
    this.runFilter();
    const orig = this.filterOrig;
    this.filterOrig = null;
    const layer = doc?.layer(this.filterLayer);
    if (!doc || !orig || !this.filter || !layer) return;
    const rect = { x: 0, y: 0, w: doc.width, h: doc.height };
    const label = FILTERS.find((x) => x.id === this.filter)?.label ?? 'Filter';
    this.filter = null;
    if (sameBytes(orig, layer.raster.data)) { doc.settle(); return; }
    doc.commitPatch({ layer: layer.id, rect, before: orig, after: new Uint8ClampedArray(layer.raster.data) }, label);
  }

  private cancelFilter(): void {
    const doc = this.host.doc();
    const orig = this.filterOrig;
    this.filterOrig = null;
    this.filter = null;
    if (this.filterReq) { cancelAnimationFrame(this.filterReq); this.filterReq = 0; }
    const layer = doc?.layer(this.filterLayer);
    if (!doc || !orig || !layer) return;
    layer.raster.data.set(orig);
    doc.markDirty(layer.id, { x: 0, y: 0, w: doc.width, h: doc.height });
    doc.settle();
  }
}

// ------------------------------------------------------------ helpers

function accent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#f97316';
}

function dot(ctx: CanvasRenderingContext2D, p: Point, r: number): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
}

function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }
function mid(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function centre(q4: Point[]): Point { return { x: q4.reduce((s, p) => s + p.x, 0) / q4.length, y: q4.reduce((s, p) => s + p.y, 0) / q4.length }; }
function rotate(p: Point, c: Point, a: number): Point {
  const cos = Math.cos(a), sin = Math.sin(a), x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}
function quad4(q: Point[]): [Point, Point, Point, Point] {
  return [q[0], q[1], q[2], q[3]];
}
function rectQuad(r: Rect): Point[] {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}
function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
function unite(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}
function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2), y = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** A mask of where the layer has any alpha (the whole layer is what Transform moves when nothing is selected). */
function alphaMask(r: Raster): Mask | null {
  const m = new Uint8Array(r.width * r.height);
  let any = false;
  for (let i = 0, p = 3; i < m.length; i++, p += 4) if (r.data[p]) { m[i] = 255; any = true; }
  return any ? { width: r.width, height: r.height, data: m } : null;
}

/** Scales a quad from a corner or edge handle, keeping the opposite side fixed, in the quad's own axes. */
function scaleQuad(q0: Point[], kind: string, i: number, p: Point, uniform: boolean): Point[] {
  const ux = { x: q0[1].x - q0[0].x, y: q0[1].y - q0[0].y };
  const uy = { x: q0[3].x - q0[0].x, y: q0[3].y - q0[0].y };
  const w = Math.hypot(ux.x, ux.y) || 1, h = Math.hypot(uy.x, uy.y) || 1;
  const ex = { x: ux.x / w, y: ux.y / w }, ey = { x: uy.x / h, y: uy.y / h };
  // local coords: corner 0 at (0,0), 1 (w,0), 2 (w,h), 3 (0,h); edge i runs from corner i to i+1
  const local = (pt: Point): Point => ({ x: (pt.x - q0[0].x) * ex.x + (pt.y - q0[0].y) * ex.y, y: (pt.x - q0[0].x) * ey.x + (pt.y - q0[0].y) * ey.y });
  const lp = local(p);
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (kind === 'corner') {
    if (i === 0) { x0 = lp.x; y0 = lp.y; } else if (i === 1) { x1 = lp.x; y0 = lp.y; } else if (i === 2) { x1 = lp.x; y1 = lp.y; } else { x0 = lp.x; y1 = lp.y; }
    if (uniform) {
      const s = Math.max((x1 - x0) / w, (y1 - y0) / h);
      if (i === 0) { x0 = x1 - w * s; y0 = y1 - h * s; } else if (i === 1) { x1 = x0 + w * s; y0 = y1 - h * s; } else if (i === 2) { x1 = x0 + w * s; y1 = y0 + h * s; } else { x0 = x1 - w * s; y1 = y0 + h * s; }
    }
  } else {
    if (i === 0) y0 = lp.y; else if (i === 1) x1 = lp.x; else if (i === 2) y1 = lp.y; else x0 = lp.x;
  }
  const P = (lx: number, ly: number): Point => ({ x: q0[0].x + ex.x * lx + ey.x * ly, y: q0[0].y + ex.y * lx + ey.y * ly });
  return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
}

/** Where the amber fit node sits: just outside the box's first corner. */
function fitNode(q4: Point[]): Point {
  // below the bottom edge, mirrored from the green node above the top edge
  const b = mid(q4[2], q4[3]), c = centre(q4);
  const dx = b.x - c.x, dy = b.y - c.y, len = Math.hypot(dx, dy) || 1;
  return { x: b.x + (dx / len) * 28, y: b.y + (dy / len) * 28 };
}

/** The point on a 45 degree diagonal from `a` that is nearest `p`: a square or a circle for the box. */
function squareTo(a: Point, p: Point): Point {
  const dx = p.x - a.x, dy = p.y - a.y, s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + (dx < 0 ? -s : s), y: a.y + (dy < 0 ? -s : s) };
}

/** Like extract, but over a given rectangle (outside the mask stays transparent). */
function extractIn(r: Raster, m: Mask, rect: Rect): { raster: Raster; rect: Rect } {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = (rect.y + y) * r.width + rect.x + x, mv = m.data[i];
      if (!mv) continue;
      const s = i << 2, o = (y * rect.w + x) << 2;
      out[o] = r.data[s]; out[o + 1] = r.data[s + 1]; out[o + 2] = r.data[s + 2];
      out[o + 3] = mv === 255 ? r.data[s + 3] : (r.data[s + 3] * mv) / 255;
    }
  }
  return { raster: { width: rect.w, height: rect.h, data: out }, rect };
}

function writeOver(dst: Raster, src: Raster, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (dy * dst.width + dx) * 4;
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1]; dst.data[d + 2] = src.data[s + 2]; dst.data[d + 3] = src.data[s + 3];
    }
  }
}
