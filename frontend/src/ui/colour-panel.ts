// Color panel of Draw & Paint: a popover with five modes (Disc, Classic, Harmony, Value, Palettes), History and a
// default palette. Built once; every update patches values in place. Gradients that depend on the hue are CSS layers
// over canvases that are drawn once, so a drag never repaints a canvas, it only moves reticles and sets variables.

import type { RGB } from '../paint/types';
import '../styles/rw-extras.css';
import '../styles/w16-panels.css';
import { el, q, patchList, setClass, setHidden, setStyleVar, setText, setValue } from './dom';
import { toast } from './toast';
import { downloadBlob } from '../io/api';
import { exportPalette, FORMAT_EXT, parsePaletteFile, paletteFromPixels, type PaletteFormat, type Rgb } from '../io/palette-io';

type Mode = 'disc' | 'classic' | 'harmony' | 'value' | 'palettes';
type Harmony = 'complementary' | 'split' | 'analogous' | 'triadic' | 'tetradic';
interface Palette { id: string; name: string; colors: (RGB | null)[] }

const KEY = 'formmorpheus.colour';
/** Slots in a palette: nine to a row; the panel's footer shows the first three rows (a 3 by 9 grid). */
const SLOTS = 36;
const FOOT_SLOTS = 27;
const HIST_MAX = 10;
const DISC = 224, RING = 22, ROUT = DISC / 2, DISC_IN = ROUT - RING - 6;
const HW = 188, HWR = HW / 2;
const MODES: Mode[] = ['disc', 'classic', 'harmony', 'value', 'palettes'];
const MODE_LABEL: Record<Mode, string> = { disc: 'Disc', classic: 'Classic', harmony: 'Harmony', value: 'Value', palettes: 'Palettes' };
const HARMONY: Record<Harmony, { label: string; off: number[] }> = {
  complementary: { label: 'Complementary', off: [180] },
  split: { label: 'Split complementary', off: [150, 210] },
  analogous: { label: 'Analogous', off: [-30, 30] },
  triadic: { label: 'Triadic', off: [120, 240] },
  tetradic: { label: 'Tetradic', off: [90, 180, 270] },
};

const ICONS: Record<Mode, string> = {
  disc: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="5.5"/></svg>',
  classic: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="2" y="2" width="12" height="12" rx="3"/></svg>',
  harmony: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 14V9M8 9L3.5 4M8 9l4.5-5"/><circle cx="8" cy="13.5" r="1.2" fill="currentColor"/><circle cx="3.5" cy="3.5" r="1.2" fill="currentColor"/><circle cx="12.5" cy="3.5" r="1.2" fill="currentColor"/></svg>',
  value: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="10" cy="4" r="2" fill="currentColor"/><circle cx="5" cy="8" r="2" fill="currentColor"/><circle cx="11" cy="12" r="2" fill="currentColor"/></svg>',
  palettes: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3.5" cy="3.5" r="1.5"/><circle cx="8" cy="3.5" r="1.5"/><circle cx="12.5" cy="3.5" r="1.5"/><circle cx="3.5" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="12.5" cy="8" r="1.5"/><circle cx="3.5" cy="12.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><circle cx="12.5" cy="12.5" r="1.5"/></svg>',
};

const rows = (list: string[]): (RGB | null)[] => list.map((h) => fromHex(h));
const DEFAULTS: Palette[] = [
  { id: 'studio', name: 'Studio', colors: rows(['#ffffff', '#e6e6ea', '#c8c9d0', '#a3a5ae', '#7d808b', '#5a5d68', '#3b3d47', '#22242c', '#0c0d11',
    '#ff4d4d', '#ff8a3d', '#ffc233', '#e8e94a', '#8ee05a', '#35d49a', '#36c5e8', '#4a8bff', '#8d6bff',
    '#ffb3b3', '#ffcfa6', '#ffe9a3', '#f3f5a8', '#cdeeb0', '#a8ead2', '#a9e2f2', '#b5ccff', '#cfc0ff']) },
  { id: 'earth', name: 'Earth', colors: rows(['#f5ecdc', '#e3d2b4', '#cdb48a', '#b0916a', '#8c6e4c', '#6b5238', '#4b3a29', '#31251a', '#1c150e',
    '#c8553d', '#d9803a', '#e0a93b', '#b5a642', '#7a9a45', '#4f8a5b', '#3e7f84', '#4c6e96', '#6a5a8c',
    '#e8a898', '#edc29a', '#efd9a0', '#d4d3a0', '#b5cc9b', '#9fcab0', '#9bc4c7', '#a0b6d0', '#b9aed0']) },
  { id: 'pop', name: 'Pop', colors: rows(['#ff0054', '#ff5400', '#ffbd00', '#aaff00', '#00f5a0', '#00e5ff', '#2979ff', '#7c4dff', '#ff2bd6',
    '#ffe1ec', '#ffe8d6', '#fff6d1', '#f0ffd1', '#d4fff0', '#d2f8ff', '#dbe8ff', '#e6dcff', '#ffd9f7',
    '#8a0030', '#8a2c00', '#8a6600', '#5a8a00', '#008a58', '#007f8a', '#1546a8', '#3f2799', '#8a1773']) },
];

// ---- colour maths ----
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
function fromHex(s: string): RGB | null {
  let t = s.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(t)) return null;
  const n = parseInt(t, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const toHex = (c: RGB): string => '#' + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('');
const css = (c: RGB): string => `rgb(${c.r},${c.g},${c.b})`;
const same = (a: RGB | null, b: RGB | null): boolean => !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
const copy = (c: RGB): RGB => ({ r: c.r, g: c.g, b: c.b });
function hsv2rgb(h: number, s: number, v: number): RGB {
  h = ((h % 360) + 360) % 360;
  const f = (n: number): number => { const k = (n + h / 60) % 6; return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255); };
  return { r: f(5), g: f(3), b: f(1) };
}
function rgb2hsv(c: RGB, keepH: number): { h: number; s: number; v: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = keepH;
  if (d > 0) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}

// Concentric map between the unit square and the unit disc, so the whole S/B plane fits in a circle.
function squareToDisc(a: number, b: number): [number, number] {
  if (a === 0 && b === 0) return [0, 0];
  let r: number, phi: number;
  if (a * a > b * b) { r = a; phi = (Math.PI / 4) * (b / a); } else { r = b; phi = Math.PI / 2 - (Math.PI / 4) * (a / b); }
  return [r * Math.cos(phi), r * Math.sin(phi)];
}
function discToSquare(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y);
  if (r === 0) return [0, 0];
  let p = Math.atan2(y, x);
  if (p < -Math.PI / 4) p += 2 * Math.PI;
  const q4 = 4 / Math.PI;
  if (p <= Math.PI / 4) return [r, r * p * q4];
  if (p <= (3 * Math.PI) / 4) return [r * (Math.PI / 2 - p) * q4, r];
  if (p <= (5 * Math.PI) / 4) return [-r, -r * (p - Math.PI) * q4];
  return [-r * (1.5 * Math.PI - p) * q4, -r];
}

const dpr = (): number => Math.max(1, Math.min(3, window.devicePixelRatio || 1));
function makeCanvas(css_w: number, css_h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData; w: number; h: number } {
  const k = dpr(), w = Math.round(css_w * k), h = Math.round(css_h * k);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.style.width = css_w + 'px'; cv.style.height = css_h + 'px';
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  return { cv, ctx, img: ctx.createImageData(w, h), w, h };
}

/** Angle 0 at the top, clockwise, in degrees. */
const angleOf = (dx: number, dy: number): number => (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;

function drawRing(cv: HTMLCanvasElement): void {
  const k = dpr(), n = Math.round(DISC * k), ctx = cv.getContext('2d') as CanvasRenderingContext2D, img = ctx.createImageData(n, n), d = img.data;
  const c = n / 2, ro = ROUT * k, ri = (ROUT - RING) * k;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy);
    const a = clamp(Math.min(ro - r, r - ri) + 0.5, 0, 1);
    if (a <= 0) continue;
    const col = hsv2rgb(angleOf(dx, dy), 1, 1), i = (y * n + x) * 4;
    d[i] = col.r; d[i + 1] = col.g; d[i + 2] = col.b; d[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
}

/** Two alpha layers: white fading with saturation and black fading with brightness, over a flat hue colour. */
function drawDiscLayers(sat: HTMLCanvasElement, val: HTMLCanvasElement, size: number): void {
  const k = dpr(), n = Math.round(size * k);
  const cs = sat.getContext('2d') as CanvasRenderingContext2D, cvv = val.getContext('2d') as CanvasRenderingContext2D;
  const is = cs.createImageData(n, n), iv = cvv.createImageData(n, n), c = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ux = (x + 0.5 - c) / c, uy = -(y + 0.5 - c) / c;
    if (ux * ux + uy * uy > 1) continue;
    const [a, b] = discToSquare(ux, uy), s = (a + 1) / 2, v = (b + 1) / 2, i = (y * n + x) * 4;
    is.data[i] = is.data[i + 1] = is.data[i + 2] = 255; is.data[i + 3] = Math.round(clamp(1 - s, 0, 1) * 255);
    iv.data[i + 3] = Math.round(clamp(1 - v, 0, 1) * 255);
  }
  cs.putImageData(is, 0, 0); cvv.putImageData(iv, 0, 0);
}

function drawHueWheel(cv: HTMLCanvasElement): void {
  const k = dpr(), n = Math.round(HW * k), ctx = cv.getContext('2d') as CanvasRenderingContext2D, img = ctx.createImageData(n, n), d = img.data, c = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy) / c;
    if (r > 1.004) continue;
    const col = hsv2rgb(angleOf(dx, dy), Math.min(1, r), 1), i = (y * n + x) * 4;
    d[i] = col.r; d[i + 1] = col.g; d[i + 2] = col.b; d[i + 3] = Math.round(clamp((1 - r) * c + 0.5, 0, 1) * 255);
  }
  ctx.putImageData(img, 0, 0);
}

function drag(node: HTMLElement, fn: (e: PointerEvent, final: boolean, start: boolean) => void): void {
  let on = false;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    on = true; node.setPointerCapture(e.pointerId); e.preventDefault();
    fn(e, false, true);
  });
  node.addEventListener('pointermove', (e) => { if (on) fn(e, false, false); });
  const end = (e: PointerEvent): void => { if (!on) return; on = false; fn(e, true, false); };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}

interface Slider { root: HTMLElement; set(p: number, a?: string, b?: string): void }
function makeSlider(kind: string, onInput: (p: number, final: boolean) => void): Slider {
  const root = el(`<div class="fm-col-sl is-${kind}"><div class="fm-col-sl-track"></div><i class="fm-col-sl-thumb"></i></div>`);
  let rect: DOMRect | null = null;
  const at = (e: PointerEvent): number => { const r = rect as DOMRect; return clamp((e.clientX - r.left - 8) / Math.max(1, r.width - 16), 0, 1); };
  drag(root, (e, final, start) => { if (start) rect = root.getBoundingClientRect(); onInput(at(e), final); });
  return {
    root,
    set(p, a, b) {
      setStyleVar(root, '--p', String(Math.round(p * 1000) / 1000));
      if (a !== undefined) setStyleVar(root, '--ga', a);
      if (b !== undefined) setStyleVar(root, '--gb', b);
    },
  };
}

function place(node: HTMLElement, x: number, y: number): void {
  setStyleVar(node, '--x', x.toFixed(1) + 'px');
  setStyleVar(node, '--y', y.toFixed(1) + 'px');
}

const TEMPLATE = `
<div class="fm-col" hidden role="dialog" aria-label="Color" data-mode="disc">
  <div class="fm-col-grip" title="Drag to detach and move the panel; double-click to dock it again"></div>
  <button type="button" class="fm-col-x" aria-label="Close" title="Close" hidden><svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
  <div class="fm-col-head">
    <div class="fm-col-titles">
      <div class="fm-col-title">Color</div>
      <div class="fm-col-sub"><span class="fm-col-hexlabel"></span><button type="button" class="fm-col-harm" aria-label="Harmony style" hidden><span></span><svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5L5 6.5L8 3.5"/></svg></button></div>
    </div>
    <div class="fm-col-chips">
      <button type="button" class="fm-col-chip is-primary" title="Primary (the left half is the previous color: click to go back)" aria-label="Previous color"></button>
      <button type="button" class="fm-col-chip is-secondary" title="Secondary color: click to pick it, click again to go back" aria-label="Edit the secondary color"></button>
      <button type="button" class="fm-col-swap" title="Swap primary and secondary" aria-label="Swap colors"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h8M8 2l2 2-2 2M10 8H2M4 6l-2 2 2 2"/></svg></button>
    </div>
  </div>
  <div class="fm-col-bodies">
    <section class="fm-col-body" data-pane="disc">
      <div class="fm-col-disc">
        <div class="fm-col-dwrap"><i class="fm-col-dbase"></i></div>
        <i class="fm-col-ret is-ring"></i><i class="fm-col-ret is-sb"></i>
        <span class="fm-col-zoom" hidden title="Fine control: Ctrl+scroll or pinch changes it, double-click snaps"></span>
      </div>
    </section>
    <section class="fm-col-body" data-pane="classic" hidden>
      <div class="fm-col-sq"><i class="fm-col-ret is-sb"></i></div>
      <div class="fm-col-sls" data-sls="classic"></div>
    </section>
    <section class="fm-col-body" data-pane="harmony" hidden>
      <div class="fm-col-hw"><i class="fm-col-hdim"></i><i class="fm-col-ret is-hp"></i><i class="fm-col-ret is-hx"></i><i class="fm-col-ret is-hx"></i><i class="fm-col-ret is-hx"></i></div>
      <div class="fm-col-sls" data-sls="harmony"></div>
    </section>
    <section class="fm-col-body" data-pane="value" hidden>
      <div class="fm-col-vals"></div>
      <label class="fm-col-hexrow"><span class="fm-col-vl">Hex</span><input class="fm-col-hex" type="text" spellcheck="false" maxlength="7" aria-label="Hexadecimal"></label>
    </section>
    <section class="fm-col-body fm-col-pals" data-pane="palettes" hidden>
      <div class="fm-col-palbar">
        <div class="fm-col-seg" role="tablist"><button type="button" class="is-on" data-view="compact">Compact</button><button type="button" data-view="cards">Cards</button></div>
        <button type="button" class="fm-col-plus" title="New palette from History" aria-label="New palette from History">+</button>
      </div>
      <div class="fm-col-palio">
        <button type="button" class="fm-col-iob" data-io="import" title="Import a palette file (.swatches, .ase, .gpl, .fmpal)">Import</button>
        <button type="button" class="fm-col-iob" data-io="export" title="Export the default palette">Export</button>
        <select class="fm-col-fmt" aria-label="Export format"><option value="swatches">swatches</option><option value="ase">ase</option><option value="gpl">gpl</option><option value="fmpal">fmpal</option></select>
        <button type="button" class="fm-col-iob" data-io="image" title="New palette from the colors of a picture">Image</button>
        <input class="fm-col-kn" type="number" min="5" max="30" step="1" value="16" aria-label="Number of colors from the image" title="Colors">
        <input class="fm-col-file" type="file" hidden>
      </div>
      <div class="fm-col-phist">
        <div class="fm-col-lab"><span>History</span><button type="button" class="fm-col-pclear">Clear</button></div>
        <div class="fm-col-hstrip fm-col-pstrip"></div>
      </div>
      <div class="fm-col-pl"></div>
    </section>
  </div>
  <div class="fm-col-foot">
    <div class="fm-col-hist">
      <div class="fm-col-lab"><span>History</span><button type="button" class="fm-col-clear">Clear</button></div>
      <div class="fm-col-hstrip"></div>
    </div>
    <div class="fm-col-defpal">
      <div class="fm-col-lab"><button type="button" class="fm-col-palname" title="Next palette"></button></div>
      <div class="fm-col-grid"></div>
    </div>
  </div>
  <nav class="fm-col-tabs"></nav>
  <div class="fm-col-menu fm-col-hmenu" hidden></div>
  <div class="fm-col-menu" hidden><button type="button" data-act="set">Set to current</button><button type="button" data-act="del" class="is-danger">Delete</button></div>
</div>`;

export interface SwatchDragEvent { color: RGB; x: number; y: number; phase: 'start' | 'move' | 'end' | 'cancel' }

export interface ColourPanelOptions {
  onPick: (rgb: RGB, final: boolean) => void;
  onSecondary?: (rgb: RGB) => void;
  keepColours?: boolean;
  /** A swatch dragged out of the panel (SwatchDrop onto the canvas). */
  onSwatchDrag?: (e: SwatchDragEvent) => void;
}

export class ColourPanel {
  readonly root: HTMLElement;
  private opts: ColourPanelOptions;
  private h = 24; private s = 0.9; private v = 0.97;
  private cur: RGB = { r: 247, g: 120, b: 22 };
  /** The colour the last settled pick started from, and the one before it (Previous color). */
  private base: RGB = { r: 247, g: 120, b: 22 };
  private prev: RGB | null = null;
  /** The panel was pulled off its anchor by the grip (Color Companion): it stays open while painting. */
  private detached = false;
  private sec: RGB = { r: 255, g: 255, b: 255 };
  /** The secondary follows the previous color until the person sets or swaps it. */
  private secCustom = false;
  /** While the secondary is being picked, the real primary waits here and the pickers work on `cur`. */
  private held: { cur: RGB; prev: RGB | null; base: RGB } | null = null;
  private mode: Mode = 'disc';
  /** Inner-disc magnification for fine control (1 = off). */
  private dzoom = 1;
  private harm: Harmony = 'complementary';
  private view: 'compact' | 'cards' = 'compact';
  private pals: Palette[] = DEFAULTS.map((p) => ({ id: p.id, name: p.name, colors: p.colors.map((c) => (c ? copy(c) : null)) }));
  private active = 0;
  private hist: RGB[] = [];
  private opened = false;
  private anchor: HTMLElement | null = null;
  private saveTimer = 0;
  private lp: { timer: number; fired: boolean; x: number; y: number } = { timer: 0, fired: false, x: 0, y: 0 };
  private menuTarget: { pal: string; i: number } | null = null;

  // cached nodes
  private n!: {
    primary: HTMLElement; secondary: HTMLElement; hexLabel: HTMLElement; harmSel: HTMLButtonElement; hmenu: HTMLElement;
    dbase: HTMLElement; ringRet: HTMLElement; dsb: HTMLElement;
    sq: HTMLElement; sqRet: HTMLElement; hw: HTMLElement; hdim: HTMLElement; hp: HTMLElement; hx: HTMLElement[];
    hex: HTMLInputElement; tabs: HTMLButtonElement[]; menu: HTMLElement;
    hstrip: HTMLElement; grid: HTMLElement; palname: HTMLElement; pl: HTMLElement; segs: HTMLButtonElement[];
    hsw: HTMLElement[]; gsw: HTMLElement[]; x: HTMLButtonElement;
  };
  private cl: { h: Slider; s: Slider; b: Slider } | null = null;
  private hb: Slider | null = null;
  private vs: { k: string; sl: Slider; num: HTMLInputElement; max: number }[] = [];

  /** `keepColours`: a second panel (the Stage background) shares history and palettes but leaves the stored brush colours alone. */
  constructor(opts: ColourPanelOptions) {
    this.opts = {
      ...opts,
      // while the secondary is open, every picker result goes to it and the brush color stays put
      onPick: (c, f) => {
        if (!this.held) { opts.onPick(c, f); return; }
        this.sec = copy(c); this.secCustom = true;
        this.render();
        opts.onSecondary?.(copy(c));
        if (f) this.save();
      },
    };
    this.load();
    this.base = copy(this.cur);
    this.root = el(TEMPLATE);
    this.build();
    this.render();
    this.renderHistory();
    this.renderPalettes();
    this.applyMode();
  }

  isOpen(): boolean { return this.opened; }
  get(): RGB { return copy(this.cur); }
  secondary(): RGB { return copy(this.sec); }

  /** Sets the primary (an eyedropper sample, a drop); the secondary pick ends first. */
  set(rgb: RGB): void {
    this.endSecondary();
    this.put(rgb);
  }

  private put(rgb: RGB): void {
    this.cur = copy(rgb);
    if (this.held) { this.sec = copy(rgb); this.secCustom = true; }
    const t = rgb2hsv(rgb, this.h);
    this.h = t.h; this.s = t.s; this.v = t.v;
    this.settle();
    this.render();
    this.save();
  }

  /** A pick is final: the colour it started from becomes the previous one. */
  private settle(): void {
    if (this.held || same(this.cur, this.base)) return;
    this.prev = copy(this.base);
    this.base = copy(this.cur);
    if (!this.secCustom) { this.sec = copy(this.prev); this.opts.onSecondary?.(copy(this.sec)); }
  }

  isEditingSecondary(): boolean { return this.held !== null; }

  /** Picks the secondary with the same pickers; calling again returns to the primary. */
  toggleSecondary(): void {
    if (this.held) { this.endSecondary(); return; }
    this.held = { cur: copy(this.cur), prev: this.prev ? copy(this.prev) : null, base: copy(this.base) };
    this.cur = copy(this.sec);
    const t = rgb2hsv(this.cur, this.h);
    this.h = t.h; this.s = t.s; this.v = t.v;
    this.render();
  }

  private endSecondary(): void {
    const k = this.held;
    if (!k) return;
    this.held = null;
    this.cur = k.cur; this.prev = k.prev; this.base = k.base;
    const t = rgb2hsv(this.cur, this.h);
    this.h = t.h; this.s = t.s; this.v = t.v;
    this.render();
    this.save();
  }

  hasPrevious(): boolean { return this.prev !== null; }

  /** Swap to the colour used before the current one; calling it again swaps back. */
  togglePrevious(): boolean {
    const p = this.prev;
    if (!p || this.held) return false;
    const c = copy(this.cur);
    this.set(p);
    this.prev = c;
    this.base = copy(p);
    this.opts.onPick(copy(p), true);
    return true;
  }

  isDetached(): boolean { return this.detached; }

  swap(): void {
    this.endSecondary();
    this.secCustom = true;
    const t = this.sec;
    this.sec = this.cur;
    this.set(t);
    this.opts.onSecondary?.(copy(this.sec));
    this.opts.onPick(copy(this.cur), true);
  }

  commit(rgb: RGB): void {
    if (this.hist.length && same(this.hist[0], rgb)) return;
    this.hist = [copy(rgb), ...this.hist.filter((c) => !same(c, rgb))].slice(0, HIST_MAX);
    this.renderHistory();
    this.save();
  }

  open(anchor: HTMLElement): void {
    if (this.opened && this.detached) return;
    this.anchor = anchor;
    this.root.hidden = false;
    this.opened = true;
    this.reposition();
    this.render();
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.reposition);
  }

  /** A detached panel (Color Companion) stays up unless `force`. */
  close(force = false): void {
    if (!this.opened) return;
    if (this.detached && !force) return;
    this.opened = false;
    this.detached = false;
    this.endSecondary();
    setClass(this.root, 'is-detached', false);
    setHidden(this.n.x, true);
    this.root.hidden = true;
    setHidden(this.n.menu, true);
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.reposition);
  }

  private reposition = (): void => {
    const a = this.anchor;
    if (!a || this.detached) return;
    const host = (this.root.offsetParent as HTMLElement | null) ?? document.body;
    const hr = host.getBoundingClientRect(), ar = a.getBoundingClientRect(), w = this.root.offsetWidth || 280;
    const left = clamp(ar.right - hr.left - w - host.clientLeft + host.scrollLeft, 8, Math.max(8, host.clientWidth - w - 8));
    const top = ar.bottom - hr.top - host.clientTop + host.scrollTop + 8;
    this.root.style.left = left + 'px';
    this.root.style.top = top + 'px';
  };

  private onOutside = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (!this.n.menu.hidden && !this.n.menu.contains(t)) setHidden(this.n.menu, true);
    if (!this.n.hmenu.hidden && !this.n.hmenu.contains(t) && !this.n.harmSel.contains(t)) setHidden(this.n.hmenu, true);
    if (this.root.contains(t) || this.anchor?.contains(t)) return;
    this.close();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (this.detached && this.n.menu.hidden) return;
    if (!this.n.menu.hidden) setHidden(this.n.menu, true); else this.close();
    e.stopPropagation();
  };

  /** Pull the panel off its anchor (grip drag) or put it back (double-click). */
  private detach(on: boolean): void {
    this.detached = on;
    setClass(this.root, 'is-detached', on);
    setHidden(this.n.x, !on);
    if (!on) this.reposition();
  }

  private gripDrag(): void {
    const grip = q(this.root, '.fm-col-grip');
    let st: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.root.offsetLeft, top: this.root.offsetTop, moved: false };
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      const s = st;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.moved && Math.hypot(dx, dy) < 4) return;
      if (!s.moved) { s.moved = true; this.detach(true); }
      const host = (this.root.offsetParent as HTMLElement | null) ?? document.body;
      const left = clamp(s.left + dx, 4, Math.max(4, host.clientWidth - this.root.offsetWidth - 4));
      const top = clamp(s.top + dy, 4, Math.max(4, host.clientHeight - 60));
      this.root.style.left = left + 'px';
      this.root.style.top = top + 'px';
    });
    const end = (e: PointerEvent): void => { if (st && st.id === e.pointerId) st = null; };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => this.detach(false));
    this.n.x.addEventListener('click', () => this.close(true));
  }

  // ---- build ----
  private build(): void {
    const r = this.root;
    const n = this.n = {
      primary: q(r, '.is-primary'), secondary: q(r, '.is-secondary'), hexLabel: q(r, '.fm-col-hexlabel'), harmSel: q<HTMLButtonElement>(r, '.fm-col-harm'), hmenu: q(r, '.fm-col-hmenu'),
      dbase: q(r, '.fm-col-dbase'), ringRet: q(r, '.fm-col-disc .is-ring'), dsb: q(r, '.fm-col-disc .is-sb'),
      sq: q(r, '.fm-col-sq'), sqRet: q(r, '.fm-col-sq .is-sb'), hw: q(r, '.fm-col-hw'), hdim: q(r, '.fm-col-hdim'), hp: q(r, '.is-hp'),
      hx: Array.from(r.querySelectorAll<HTMLElement>('.is-hx')),
      hex: q<HTMLInputElement>(r, '.fm-col-hex'), tabs: [] as HTMLButtonElement[], menu: q(r, '.fm-col-menu:not(.fm-col-hmenu)'),
      hstrip: q(r, '.fm-col-foot .fm-col-hstrip'), grid: q(r, '.fm-col-grid'), palname: q(r, '.fm-col-palname'), pl: q(r, '.fm-col-pl'),
      segs: Array.from(r.querySelectorAll<HTMLButtonElement>('.fm-col-seg button')), hsw: [] as HTMLElement[], gsw: [] as HTMLElement[], x: q<HTMLButtonElement>(r, '.fm-col-x'),
    };

    n.secondary.addEventListener('click', () => this.toggleSecondary());
    q(r, '.fm-col-swap').addEventListener('click', () => this.swap());
    n.primary.addEventListener('click', () => { if (this.togglePrevious()) this.render(); });
    this.gripDrag();
    for (const k of Object.keys(HARMONY) as Harmony[]) n.hmenu.append(el(`<button type="button" data-h="${k}">${HARMONY[k].label}</button>`));
    n.harmSel.addEventListener('click', () => {
      setHidden(n.menu, true);
      n.hmenu.hidden = !n.hmenu.hidden;
      n.hmenu.style.left = '12px'; n.hmenu.style.top = '62px';
    });
    n.hmenu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      setHidden(n.hmenu, true);
      if (!b) return;
      this.harm = b.dataset.h as Harmony; this.render(); this.save();
    });

    // tabs
    const tabs = q(r, '.fm-col-tabs');
    for (const m of MODES) {
      const b = el<HTMLButtonElement>(`<button type="button" class="fm-col-tab" data-mode="${m}" aria-label="${MODE_LABEL[m]}">${ICONS[m]}<span>${MODE_LABEL[m]}</span></button>`);
      b.addEventListener('click', () => { this.mode = m; this.applyMode(); this.render(); this.save(); });
      tabs.append(b); n.tabs.push(b);
    }

    // disc: static canvases, then reticles and a hue-coloured base
    const disc = q(r, '.fm-col-disc'), wrap = q(r, '.fm-col-dwrap');
    const ring = makeCanvas(DISC, DISC);
    ring.cv.className = 'fm-col-ring'; drawRing(ring.cv); disc.prepend(ring.cv);
    const inner = DISC_IN * 2, sat = makeCanvas(inner, inner), val = makeCanvas(inner, inner);
    drawDiscLayers(sat.cv, val.cv, inner);
    wrap.append(sat.cv, val.cv);
    let lock: 'hue' | 'sb' = 'hue', drect: DOMRect;
    // fine control: the inner disc is magnified around the picked point, so the same pointer travel moves the color less
    let from = { a: 0, b: 0, s: 0, v: 0 };
    const zoomBadge = q(r, '.fm-col-zoom');
    drag(disc, (e, final, start) => {
      if (start) {
        drect = disc.getBoundingClientRect();
      }
      const k = DISC / drect.width, dx = (e.clientX - drect.left) * k - DISC / 2, dy = (e.clientY - drect.top) * k - DISC / 2;
      if (start) lock = Math.hypot(dx, dy) >= DISC_IN + 3 ? 'hue' : 'sb';
      if (lock === 'hue') this.pick(angleOf(dx, dy), this.s, this.v, final);
      else {
        const l = Math.hypot(dx, dy), f = l > DISC_IN ? DISC_IN / l : 1;
        const [a, b] = discToSquare((dx * f) / DISC_IN, -(dy * f) / DISC_IN);
        if (this.dzoom > 1) {
          if (start) from = { a, b, s: this.s, v: this.v };
          this.pick(this.h, clamp(from.s + (a - from.a) / 2 / this.dzoom, 0, 1), clamp(from.v + (b - from.b) / 2 / this.dzoom, 0, 1), final);
        } else this.pick(this.h, clamp((a + 1) / 2, 0, 1), clamp((b + 1) / 2, 0, 1), final);
      }
    });
    // double tap inside the disc: snap to white, black, mid gray, half or full saturation (whichever is nearest)
    let dcStep = -1, dcAt = 0, dcV = 1;
    disc.addEventListener('pointerdown', () => { if (performance.now() - dcAt > 700) dcV = this.v; });
    disc.addEventListener('dblclick', (e) => {
      const rc = disc.getBoundingClientRect(), kk = DISC / rc.width;
      const dx = (e.clientX - rc.left) * kk - DISC / 2, dy = (e.clientY - rc.top) * kk - DISC / 2;
      if (Math.hypot(dx, dy) >= DISC_IN + 3) return;
      const now = performance.now();
      if (now - dcAt > 2500) dcStep = -1;
      dcAt = now;
      dcStep = (dcStep + 1) % 5;
      const bright = Math.max(dcV, 0.7);
      const cyc: [number, number][] = [[0, 1], [0, 0], [0, 0.5], [0.5, bright], [1, bright]];
      this.pick(this.h, cyc[dcStep][0], cyc[dcStep][1], true);
    });
    // Ctrl+scroll (a trackpad pinch arrives the same way) magnifies the inner disc for fine control
    disc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.dzoom = clamp(Math.round((this.dzoom * Math.exp(-e.deltaY * 0.01)) * 4) / 4, 1, 8);
      setHidden(zoomBadge, this.dzoom <= 1);
      setText(zoomBadge, `${this.dzoom}x`);
    }, { passive: false });

    // classic square
    let srect: DOMRect;
    drag(n.sq, (e, final, start) => {
      if (start) srect = n.sq.getBoundingClientRect();
      this.pick(this.h, clamp((e.clientX - srect.left) / srect.width, 0, 1), clamp(1 - (e.clientY - srect.top) / srect.height, 0, 1), final);
    });
    const csl = q(r, '[data-sls="classic"]');
    this.cl = {
      h: makeSlider('hue', (p, f) => this.pick(p * 360, this.s, this.v, f)),
      s: makeSlider('grad', (p, f) => this.pick(this.h, p, this.v, f)),
      b: makeSlider('grad', (p, f) => this.pick(this.h, this.s, p, f)),
    };
    csl.append(this.cl.h.root, this.cl.s.root, this.cl.b.root);

    // harmony wheel
    const hwc = makeCanvas(HW, HW); hwc.cv.className = 'fm-col-hwc'; drawHueWheel(hwc.cv); n.hw.prepend(hwc.cv);
    let hrect: DOMRect, hmode: 'drag' | 'none' = 'drag';
    drag(n.hw, (e, final, start) => {
      if (start) {
        hrect = n.hw.getBoundingClientRect(); hmode = 'drag';
        const k = HW / hrect.width, px = (e.clientX - hrect.left) * k, py = (e.clientY - hrect.top) * k;
        const offs = HARMONY[this.harm].off;
        for (let i = 0; i < offs.length; i++) {
          const [x, y] = this.wheelPos(this.h + offs[i]);
          if (Math.hypot(px - x, py - y) < 11) { hmode = 'none'; this.pick(this.h + offs[i], this.s, this.v, true); return; }
        }
      }
      if (hmode === 'none') return;
      const k = HW / hrect.width, dx = (e.clientX - hrect.left) * k - HWR, dy = (e.clientY - hrect.top) * k - HWR;
      this.pick(angleOf(dx, dy), clamp(Math.hypot(dx, dy) / HWR, 0, 1), this.v, final);
    });
    this.hb = makeSlider('grad', (p, f) => this.pick(this.h, this.s, p, f));
    q(r, '[data-sls="harmony"]').append(this.hb.root);

    // value rows
    const vals = q(r, '.fm-col-vals');
    const defs: { k: string; label: string; max: number; unit: string; kind: string }[] = [
      { k: 'h', label: 'H', max: 360, unit: '°', kind: 'hue' }, { k: 's', label: 'S', max: 100, unit: '%', kind: 'grad' }, { k: 'v', label: 'B', max: 100, unit: '%', kind: 'grad' },
      { k: 'r', label: 'R', max: 255, unit: '', kind: 'grad' }, { k: 'g', label: 'G', max: 255, unit: '', kind: 'grad' }, { k: 'b', label: 'B', max: 255, unit: '', kind: 'grad' },
    ];
    for (const d of defs) {
      const row = el(`<div class="fm-col-vrow"><span class="fm-col-vl">${d.label}</span><span class="fm-col-num"><input type="text" inputmode="numeric" spellcheck="false" aria-label="${d.label}"><i>${d.unit}</i></span></div>`);
      const num = q<HTMLInputElement>(row, 'input');
      const sl = makeSlider(d.kind, (p, f) => this.setChannel(d.k, Math.round(p * d.max), f));
      row.insertBefore(sl.root, row.lastElementChild);
      const apply = (): void => { const x = Number(num.value.replace(/[^\d.-]/g, '')); if (Number.isFinite(x)) this.setChannel(d.k, clamp(Math.round(x), 0, d.max), true); this.render(); };
      num.addEventListener('change', apply);
      num.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { apply(); num.blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.setChannel(d.k, clamp(Math.round(Number(num.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1), 0, d.max), true); }
      });
      vals.append(row); this.vs.push({ k: d.k, sl, num, max: d.max });
    }
    const hexApply = (): void => { const c = fromHex(n.hex.value); if (c) { this.put(c); this.opts.onPick(copy(c), true); } else this.render(); };
    n.hex.addEventListener('change', hexApply);
    n.hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { hexApply(); n.hex.blur(); } });

    // history and default palette: fixed slot counts, so built once
    for (let i = 0; i < HIST_MAX; i++) { const b = el(`<button type="button" class="fm-col-sw" data-h="${i}" aria-label="History ${i + 1}"></button>`); n.hstrip.append(b); n.hsw.push(b); }
    const pstrip = q(r, '.fm-col-pstrip');
    for (let i = 0; i < HIST_MAX; i++) { const b = el(`<button type="button" class="fm-col-sw" data-h="${i}" aria-label="History ${i + 1}"></button>`); pstrip.append(b); n.hsw.push(b); }
    q(r, '.fm-col-pclear').addEventListener('click', () => { this.hist = []; this.renderHistory(); this.save(); });
    for (let i = 0; i < FOOT_SLOTS; i++) { const b = el(`<button type="button" class="fm-col-sw" data-i="${i}"></button>`); n.grid.append(b); n.gsw.push(b); }
    q(r, '.fm-col-clear').addEventListener('click', () => { this.hist = []; this.renderHistory(); this.save(); });
    n.palname.addEventListener('click', () => { this.active = (this.active + 1) % this.pals.length; this.renderPalettes(); this.save(); });

    // palettes pane
    for (const b of n.segs) b.addEventListener('click', () => { this.view = b.dataset.view as 'compact' | 'cards'; this.applyView(); this.save(); });
    q(r, '.fm-col-plus').addEventListener('click', () => {
      const id = 'u' + Date.now().toString(36);
      const colors: (RGB | null)[] = Array.from({ length: SLOTS }, (_, i) => (this.hist[i] ? copy(this.hist[i]) : null));
      let k = this.pals.length + 1;
      while (this.pals.some((p) => p.name === 'Palette ' + k)) k++;
      this.pals.push({ id, name: 'Palette ' + k, colors });
      this.renderPalettes(); this.save();
      n.pl.scrollTop = n.pl.scrollHeight;
    });
    this.wirePaletteIo(r);

    // swatch clicks, long press and context menu (delegated)
    r.addEventListener('click', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.fm-col-sw');
      if (!sw) return;
      if (this.lp.fired) { this.lp.fired = false; return; }
      const c = this.swatchColor(sw);
      if (c) { this.put(c); this.opts.onPick(copy(c), true); }
    });
    r.addEventListener('contextmenu', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.fm-col-sw[data-pal], .fm-col-grid .fm-col-sw');
      if (!sw) return;
      e.preventDefault(); this.openMenu(sw);
    });
    r.addEventListener('pointerdown', (e) => {
      this.lp.fired = false;
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.fm-col-sw[data-pal], .fm-col-grid .fm-col-sw');
      if (!sw || e.button !== 0) return;
      this.lp.fired = false; this.lp.x = e.clientX; this.lp.y = e.clientY;
      clearTimeout(this.lp.timer);
      this.lp.timer = window.setTimeout(() => { this.lp.fired = true; this.openMenu(sw); }, 480);
    });
    const cancelLp = (): void => clearTimeout(this.lp.timer);
    r.addEventListener('pointerup', cancelLp);
    r.addEventListener('pointercancel', cancelLp);
    r.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - this.lp.x, e.clientY - this.lp.y) > 6) cancelLp(); });
    // SwatchDrop: a swatch dragged out of the panel is handed to the host, which fills the canvas with it
    let sd: { id: number; color: RGB; x: number; y: number; on: boolean } | null = null;
    let ghost: HTMLElement | null = null;
    const swatchEnd = (e: PointerEvent, phase: 'end' | 'cancel'): void => {
      const s = sd;
      if (!s || s.id !== e.pointerId) return;
      sd = null;
      setClass(r, 'is-swatchdrag', false);
      if (ghost) ghost.hidden = true;
      if (!s.on) return;
      this.lp.fired = true;
      window.setTimeout(() => { this.lp.fired = false; }, 0);
      this.opts.onSwatchDrag?.({ color: s.color, x: e.clientX, y: e.clientY, phase });
    };
    r.addEventListener('pointerdown', (e) => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.fm-col-sw');
      const c = sw ? this.swatchColor(sw) : null;
      if (!c || e.button !== 0 || !this.opts.onSwatchDrag) return;
      sd = { id: e.pointerId, color: c, x: e.clientX, y: e.clientY, on: false };
    });
    r.addEventListener('pointermove', (e) => {
      const s = sd;
      if (!s || s.id !== e.pointerId) return;
      if (!s.on) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) return;
        s.on = true;
        cancelLp();
        r.setPointerCapture(e.pointerId);
        setClass(r, 'is-swatchdrag', true);
        if (!ghost) { ghost = el('<div class="fm-col-ghost" hidden></div>'); document.body.appendChild(ghost); }
        ghost.style.setProperty('--c', css(s.color));
        ghost.hidden = false;
        this.opts.onSwatchDrag?.({ color: s.color, x: e.clientX, y: e.clientY, phase: 'start' });
      }
      if (ghost) ghost.style.transform = `translate(${Math.round(e.clientX + 10)}px, ${Math.round(e.clientY + 10)}px)`;
      this.opts.onSwatchDrag?.({ color: s.color, x: e.clientX, y: e.clientY, phase: 'move' });
    });
    r.addEventListener('pointerup', (e) => swatchEnd(e, 'end'));
    r.addEventListener('pointercancel', (e) => swatchEnd(e, 'cancel'));
    n.menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      const t = this.menuTarget;
      setHidden(n.menu, true);
      if (!b || !t) return;
      const p = this.pals.find((x) => x.id === t.pal);
      if (!p) return;
      p.colors[t.i] = b.dataset.act === 'set' ? copy(this.cur) : null;
      this.renderPalettes(); this.save();
    });
    this.applyView();
  }

  private openMenu(sw: HTMLElement): void {
    const pal = sw.dataset.pal ?? this.pals[this.active]?.id;
    if (!pal) return;
    this.menuTarget = { pal, i: Number(sw.dataset.i) };
    const rr = this.root.getBoundingClientRect(), sr = sw.getBoundingClientRect(), m = this.n.menu;
    m.hidden = false;
    const w = m.offsetWidth;
    m.style.left = clamp(sr.left - rr.left, 6, rr.width - w - 6) + 'px';
    m.style.top = Math.min(sr.bottom - rr.top + 4, rr.height - m.offsetHeight - 6) + 'px';
    this.lp.fired = true;
  }

  private swatchColor(sw: HTMLElement): RGB | null {
    if (sw.dataset.h !== undefined) return this.hist[Number(sw.dataset.h)] ?? null;
    const p = this.pals.find((x) => x.id === (sw.dataset.pal ?? this.pals[this.active]?.id));
    return p?.colors[Number(sw.dataset.i)] ?? null;
  }

  private applyMode(): void {
    const m = this.mode;
    this.root.dataset.mode = m;
    for (const sec of Array.from(this.root.querySelectorAll<HTMLElement>('.fm-col-body'))) setHidden(sec, sec.dataset.pane !== m);
    for (const t of this.n.tabs) setClass(t, 'is-on', t.dataset.mode === m);
    setHidden(this.n.harmSel, m !== 'harmony');
    setHidden(this.n.hmenu, true);
    setHidden(this.n.hexLabel, m === 'harmony');
  }

  private applyView(): void {
    setClass(this.n.pl, 'is-cards', this.view === 'cards');
    for (const b of this.n.segs) setClass(b, 'is-on', b.dataset.view === this.view);
  }

  // ---- picking ----
  private pick(h: number, s: number, v: number, final: boolean): void {
    this.h = ((h % 360) + 360) % 360; this.s = s; this.v = v;
    this.cur = hsv2rgb(this.h, s, v);
    if (final) this.settle();
    this.render();
    this.opts.onPick(copy(this.cur), final);
    if (final) this.save();
  }

  private setChannel(k: string, val: number, final: boolean): void {
    if (k === 'h') return this.pick(val, this.s, this.v, final);
    if (k === 's') return this.pick(this.h, val / 100, this.v, final);
    if (k === 'v') return this.pick(this.h, this.s, val / 100, final);
    const c = copy(this.cur);
    (c as unknown as Record<string, number>)[k] = val;
    this.cur = c;
    const t = rgb2hsv(c, this.h);
    this.h = t.h; this.s = t.s; this.v = t.v;
    if (final) this.settle();
    this.render();
    this.opts.onPick(copy(c), final);
    if (final) this.save();
  }

  private wheelPos(h: number): [number, number] {
    const a = (h * Math.PI) / 180, r = this.s * HWR;
    return [HWR + Math.sin(a) * r, HWR - Math.cos(a) * r];
  }

  // ---- patching ----
  private render(): void {
    const { h, s, v, cur, n } = this;
    const hue = css(hsv2rgb(h, 1, 1)), me = css(cur);
    const shown = this.held ? css(this.held.cur) : me;
    setStyleVar(n.primary, '--c', shown);
    setStyleVar(n.primary, '--p', this.prev && !this.held ? css(this.prev) : shown);
    setClass(n.primary, 'has-prev', this.prev !== null && !this.held);
    setStyleVar(n.secondary, '--c', css(this.sec));
    setClass(n.secondary, 'is-editing', this.held !== null);
    setText(n.hexLabel, toHex(cur).toUpperCase());
    const m = this.mode;
    if (m === 'disc') {
      setStyleVar(n.dbase, '--c', hue);
      const a = (h * Math.PI) / 180, rr = ROUT - RING / 2;
      place(n.ringRet, ROUT + Math.sin(a) * rr, ROUT - Math.cos(a) * rr);
      setStyleVar(n.ringRet, '--c', hue);
      const [x, y] = squareToDisc(s * 2 - 1, v * 2 - 1);
      place(n.dsb, ROUT + x * DISC_IN, ROUT - y * DISC_IN);
      setStyleVar(n.dsb, '--c', me);
      // the reticle's left half is the previous color (the secondary before any pick), the right half the current one
      setStyleVar(n.dsb, '--p', css(this.prev && !this.held ? this.prev : this.sec));
    } else if (m === 'classic' && this.cl) {
      setStyleVar(n.sq, '--c', hue);
      place(n.sqRet, s * n.sq.offsetWidth, (1 - v) * n.sq.offsetHeight);
      setStyleVar(n.sqRet, '--c', me);
      this.cl.h.set(h / 360);
      this.cl.s.set(s, css(hsv2rgb(h, 0, v)), css(hsv2rgb(h, 1, v)));
      this.cl.b.set(v, '#000', css(hsv2rgb(h, s, 1)));
    } else if (m === 'harmony' && this.hb) {
      setText(q(n.harmSel, 'span'), HARMONY[this.harm].label);
      setStyleVar(n.hdim, '--o', String(Math.round((1 - v) * 1000) / 1000));
      const [px, py] = this.wheelPos(h);
      place(n.hp, px, py); setStyleVar(n.hp, '--c', me);
      const offs = HARMONY[this.harm].off;
      n.hx.forEach((node, i) => {
        const on = i < offs.length;
        setHidden(node, !on);
        if (!on) return;
        const [x, y] = this.wheelPos(h + offs[i]);
        place(node, x, y); setStyleVar(node, '--c', css(hsv2rgb(h + offs[i], s, v)));
      });
      this.hb.set(v, '#000', css(hsv2rgb(h, s, 1)));
    } else if (m === 'value') {
      const vals: Record<string, number> = { h, s: s * 100, v: v * 100, r: cur.r, g: cur.g, b: cur.b };
      for (const r of this.vs) {
        const x = vals[r.k];
        let a: string | undefined, b: string | undefined;
        if (r.k === 's') { a = css(hsv2rgb(h, 0, v)); b = css(hsv2rgb(h, 1, v)); }
        else if (r.k === 'v') { a = '#000'; b = css(hsv2rgb(h, s, 1)); }
        else if (r.k === 'r') { a = css({ ...cur, r: 0 }); b = css({ ...cur, r: 255 }); }
        else if (r.k === 'g') { a = css({ ...cur, g: 0 }); b = css({ ...cur, g: 255 }); }
        else if (r.k === 'b') { a = css({ ...cur, b: 0 }); b = css({ ...cur, b: 255 }); }
        r.sl.set(x / r.max, a, b);
        setValue(r.num, String(Math.round(x)));
      }
      setValue(n.hex, toHex(cur).toUpperCase());
    }
    this.markSelected();
  }

  private paint(node: HTMLElement, c: RGB | null): void {
    const k = c ? toHex(c) : '';
    if (node.dataset.c === k) return;
    node.dataset.c = k;
    if (c) node.style.setProperty('--c', css(c)); else node.style.removeProperty('--c');
    setClass(node, 'is-empty', !c);
  }

  private markSelected(): void {
    const sel = (node: HTMLElement): void => setClass(node, 'is-sel', !!node.dataset.c && node.dataset.c === toHex(this.cur));
    if (this.mode === 'palettes') { for (const node of Array.from(this.n.pl.querySelectorAll<HTMLElement>('.fm-col-sw'))) sel(node); this.n.hsw.forEach(sel); }
    else { this.n.hsw.forEach(sel); this.n.gsw.forEach(sel); }
  }

  private renderHistory(): void {
    // two strips (the footer's and the Palettes tab's) show the same ten colors
    this.n.hsw.forEach((node, i) => this.paint(node, this.hist[i % HIST_MAX] ?? null));
    this.markSelected();
  }

  private renderPalettes(): void {
    const n = this.n, act = this.pals[this.active] ?? this.pals[0];
    setText(n.palname, act.name);
    n.gsw.forEach((node, i) => this.paint(node, act.colors[i] ?? null));
    const fill = (card: HTMLElement, p: Palette): void => {
      if (card.dataset.renaming !== '1') setText(q(card, '.fm-col-cname'), p.name);
      setClass(card, 'is-default', this.pals.indexOf(p) === this.active);
      setHidden(q(card, '.fm-col-del'), !p.id.startsWith('u'));
      setHidden(q(card, '.fm-col-def'), this.pals.indexOf(p) === this.active);
      card.querySelectorAll<HTMLElement>('.fm-col-sw').forEach((node, i) => this.paint(node, p.colors[i] ?? null));
    };
    patchList(n.pl, this.pals, {
      key: (p) => p.id,
      create: (p) => {
        const card = el(`<div class="fm-col-card"><div class="fm-col-chead"><span class="fm-col-drag" title="Drag to reorder" aria-label="Reorder palette"><svg viewBox="0 0 10 14" width="8" height="12" fill="currentColor"><circle cx="2.5" cy="3" r="1.2"/><circle cx="7.5" cy="3" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11" r="1.2"/><circle cx="7.5" cy="11" r="1.2"/></svg></span><span class="fm-col-cname" title="Click to rename"></span><input class="fm-col-crename" type="text" maxlength="32" spellcheck="false" aria-label="Palette name" hidden><span class="fm-col-tick" title="The active palette" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5l2.4 2.4 4.6-5.3"/></svg></span><button type="button" class="fm-col-more" title="Palette menu" aria-label="Palette menu" aria-haspopup="menu"><svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor"><circle cx="3" cy="7" r="1.25"/><circle cx="7" cy="7" r="1.25"/><circle cx="11" cy="7" r="1.25"/></svg></button><div class="fm-col-pm" role="menu" hidden><button type="button" class="fm-col-def" role="menuitem">Set as active</button><button type="button" class="fm-col-dup" role="menuitem">Duplicate</button><button type="button" class="fm-col-del is-danger" role="menuitem">Delete</button></div></div><div class="fm-col-cgrid"></div></div>`);
        this.wireCard(card, p.id);
        // the ellipsis opens Set as active, Duplicate and Delete; a pick or a press elsewhere closes it
        const pm = q(card, '.fm-col-pm');
        q(card, '.fm-col-more').addEventListener('click', (ev) => { ev.stopPropagation(); setHidden(pm, !pm.hidden); });
        pm.addEventListener('click', () => setHidden(pm, true));
        card.addEventListener('pointerleave', () => setHidden(pm, true));
        const g = q(card, '.fm-col-cgrid');
        for (let i = 0; i < SLOTS; i++) g.append(el(`<button type="button" class="fm-col-sw" data-pal="${p.id}" data-i="${i}"></button>`));
        q(card, '.fm-col-def').addEventListener('click', () => { const ix = this.pals.findIndex((x) => x.id === p.id); if (ix >= 0) { this.active = ix; this.renderPalettes(); this.save(); } });
        q(card, '.fm-col-del').addEventListener('click', () => {
          const ix = this.pals.findIndex((x) => x.id === p.id);
          if (ix < 0 || this.pals.length < 2) return;
          this.pals.splice(ix, 1);
          this.active = clamp(this.active > ix ? this.active - 1 : this.active, 0, this.pals.length - 1);
          this.renderPalettes(); this.save();
        });
        fill(card, p);
        return card;
      },
      update: fill,
    });
    this.markSelected();
  }

  /** Palette files in and out and a palette from a picture (io/palette-io.ts). Wired once at creation. */
  private wirePaletteIo(r: HTMLElement): void {
    const file = q<HTMLInputElement>(r, '.fm-col-file'), fmt = q<HTMLSelectElement>(r, '.fm-col-fmt'), kn = q<HTMLInputElement>(r, '.fm-col-kn');
    let mode: 'import' | 'image' = 'import';
    const add = (name: string, cols: Rgb[]): void => {
      let nm = name.slice(0, 32) || 'Palette', k = 2;
      while (this.pals.some((x) => x.name === nm)) nm = `${name.slice(0, 28)} ${k++}`;
      const colors: (RGB | null)[] = Array.from({ length: SLOTS }, (_, i) => (cols[i] ? { r: cols[i].r, g: cols[i].g, b: cols[i].b } : null));
      this.pals.push({ id: 'u' + Date.now().toString(36) + this.pals.length, name: nm, colors });
    };
    for (const b of Array.from(r.querySelectorAll<HTMLButtonElement>('.fm-col-iob'))) {
      b.addEventListener('click', () => {
        const act = b.dataset.io;
        if (act === 'export') {
          const p = this.pals[this.active] ?? this.pals[0];
          const f = fmt.value as PaletteFormat;
          const cols = p.colors.filter((c): c is RGB => !!c);
          if (!cols.length) { toast('This palette has no colors to export.', 'error'); return; }
          const bytes = exportPalette({ name: p.name, colors: cols }, f);
          downloadBlob(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }), `${p.name.replace(/[\\/:*?"<>|]/g, '_') || 'Palette'}.${FORMAT_EXT[f]}`);
          return;
        }
        mode = act === 'image' ? 'image' : 'import';
        file.accept = mode === 'image' ? 'image/*' : '.swatches,.ase,.gpl,.fmpal,.json,.zip';
        file.value = '';
        file.click();
      });
    }
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void (async () => {
        try {
          if (mode === 'image') {
            const bmp = await createImageBitmap(f);
            const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            if (!g) throw new Error('The picture could not be read.');
            g.drawImage(bmp, 0, 0, w, h); bmp.close();
            const cols = paletteFromPixels(g.getImageData(0, 0, w, h).data, w, h, clamp(parseInt(kn.value, 10) || 16, 5, 30));
            if (!cols.length) throw new Error('The picture has no colors.');
            add(f.name.replace(/\.[^.]+$/, ''), cols);
          } else {
            for (const p of parsePaletteFile(new Uint8Array(await f.arrayBuffer()), f.name)) add(p.name, p.colors);
          }
          this.active = this.pals.length - 1;
          this.renderPalettes(); this.save();
          this.n.pl.scrollTop = this.n.pl.scrollHeight;
        } catch (e) { toast(e instanceof Error ? e.message : 'The file could not be read.', 'error'); }
      })();
    });
  }

  /** Rename on click, Duplicate, and drag-to-reorder for one palette card. Wired once at creation. */
  private wireCard(card: HTMLElement, id: string): void {
    const name = q(card, '.fm-col-cname'), input = q<HTMLInputElement>(card, '.fm-col-crename');
    const stop = (save: boolean): void => {
      if (card.dataset.renaming !== '1') return;
      card.dataset.renaming = '0';
      const p = this.pals.find((x) => x.id === id);
      const v = input.value.trim();
      if (save && p && v && v !== p.name) { p.name = v; this.save(); }
      setHidden(input, true);
      setHidden(name, false);
      this.renderPalettes();
    };
    name.addEventListener('click', () => {
      const p = this.pals.find((x) => x.id === id);
      if (!p) return;
      card.dataset.renaming = '1';
      input.value = p.name;
      setHidden(name, true);
      setHidden(input, false);
      input.focus();
      input.select();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') stop(true);
      else if (e.key === 'Escape') stop(false);
    });
    input.addEventListener('blur', () => stop(true));
    q(card, '.fm-col-dup').addEventListener('click', () => {
      const ix = this.pals.findIndex((x) => x.id === id);
      if (ix < 0) return;
      const src = this.pals[ix];
      let nm = src.name + ' copy', k = 2;
      while (this.pals.some((x) => x.name === nm)) nm = `${src.name} copy ${k++}`;
      this.pals.splice(ix + 1, 0, { id: 'u' + Date.now().toString(36), name: nm, colors: src.colors.map((c) => (c ? copy(c) : null)) });
      if (this.active > ix) this.active++;
      this.renderPalettes(); this.save();
    });
    // reorder: the card shows a drop line while the handle is dragged, the order changes on release
    const grip = q(card, '.fm-col-drag');
    let st: { pid: number; to: number } | null = null;
    const slot = (y: number): number => {
      const kids = Array.from(this.n.pl.children) as HTMLElement[];
      let to = kids.length;
      for (let i = 0; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { to = i; break; } }
      return to;
    };
    const mark = (to: number): void => {
      const kids = Array.from(this.n.pl.children) as HTMLElement[];
      kids.forEach((k, i) => { setClass(k, 'is-drop-before', i === to); setClass(k, 'is-drop-after', to === kids.length && i === kids.length - 1); });
    };
    const lift = (pid: number): void => {
      st = { pid, to: -1 };
      grip.setPointerCapture(pid);
      setClass(card, 'is-lifted', true);
    };
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      lift(e.pointerId);
      e.preventDefault();
    });
    // tap and hold anywhere on the palette's title row picks the card up too; a short tap still renames or presses a button
    const head = q(card, '.fm-col-chead');
    let hold = 0;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, .fm-col-drag, .fm-col-pm')) return;
      const pid = e.pointerId, x0 = e.clientX, y0 = e.clientY;
      window.clearTimeout(hold);
      const cancel = (m: PointerEvent): void => { if (m.pointerId === pid && Math.hypot(m.clientX - x0, m.clientY - y0) > 6) stopHold(); };
      const stopHold = (): void => { window.clearTimeout(hold); head.removeEventListener('pointermove', cancel); head.removeEventListener('pointerup', stopHold); head.removeEventListener('pointercancel', stopHold); };
      head.addEventListener('pointermove', cancel);
      head.addEventListener('pointerup', stopHold);
      head.addEventListener('pointercancel', stopHold);
      hold = window.setTimeout(() => { head.removeEventListener('pointermove', cancel); lift(pid); this.lp.fired = true; }, 450);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!st || st.pid !== e.pointerId) return;
      st.to = slot(e.clientY);
      mark(st.to);
    });
    const end = (e: PointerEvent, cancel: boolean): void => {
      const s = st;
      if (!s || s.pid !== e.pointerId) return;
      st = null;
      setClass(card, 'is-lifted', false);
      mark(-1);
      if (cancel || s.to < 0) return;
      const from = this.pals.findIndex((x) => x.id === id);
      if (from < 0) return;
      const activeId = this.pals[this.active]?.id;
      const [moved] = this.pals.splice(from, 1);
      this.pals.splice(s.to > from ? s.to - 1 : s.to, 0, moved);
      this.active = Math.max(0, this.pals.findIndex((x) => x.id === activeId));
      this.renderPalettes(); this.save();
    };
    grip.addEventListener('pointerup', (e) => end(e, false));
    grip.addEventListener('pointercancel', (e) => end(e, true));
  }

  // ---- persistence ----
  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        let cur: RGB = this.held ? this.held.cur : this.cur, sec: RGB = this.sec;
        if (this.opts.keepColours) {
          const old = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { cur?: RGB; sec?: RGB };
          if (old.cur) cur = old.cur;
          if (old.sec) sec = old.sec;
        }
        localStorage.setItem(KEY, JSON.stringify({
          mode: this.mode, harm: this.harm, view: this.view, active: this.active, h: this.h,
          cur, sec, secCustom: this.secCustom, hist: this.hist,
          pals: this.pals.map((p) => ({ id: p.id, name: p.name, colors: p.colors.map((c) => (c ? toHex(c) : null)) })),
        }));
      } catch { /* storage blocked */ }
    }, 250);
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const t = rgb2hsv(this.cur, this.h); this.h = t.h; this.s = t.s; this.v = t.v; return; }
      const d = JSON.parse(raw) as Record<string, unknown>;
      const rgb = (x: unknown): RGB | null => { const o = x as RGB | null; return o && typeof o.r === 'number' && typeof o.g === 'number' && typeof o.b === 'number' ? { r: clamp(o.r | 0, 0, 255), g: clamp(o.g | 0, 0, 255), b: clamp(o.b | 0, 0, 255) } : null; };
      if (MODES.includes(d.mode as Mode)) this.mode = d.mode as Mode;
      if (typeof d.harm === 'string' && d.harm in HARMONY) this.harm = d.harm as Harmony;
      if (d.view === 'cards' || d.view === 'compact') this.view = d.view;
      if (typeof d.h === 'number') this.h = d.h;
      const c = rgb(d.cur); if (c) this.cur = c;
      const s2 = rgb(d.sec); if (s2) this.sec = s2;
      this.secCustom = d.secCustom === true;
      if (Array.isArray(d.hist)) this.hist = (d.hist as unknown[]).map(rgb).filter((x): x is RGB => !!x).slice(0, HIST_MAX);
      if (Array.isArray(d.pals)) {
        const out: Palette[] = [];
        for (const p of d.pals as { id?: unknown; name?: unknown; colors?: unknown }[]) {
          if (typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.colors)) continue;
          const colors = (p.colors as unknown[]).slice(0, SLOTS).map((x) => (typeof x === 'string' ? fromHex(x) : null));
          while (colors.length < SLOTS) colors.push(null);
          out.push({ id: p.id, name: p.name, colors });
        }
        if (out.length) this.pals = out;
      }
      if (typeof d.active === 'number') this.active = clamp(d.active | 0, 0, this.pals.length - 1);
      const t = rgb2hsv(this.cur, this.h);
      this.h = t.h; this.s = t.s; this.v = t.v;
    } catch { /* corrupt or blocked storage: defaults stand */ }
  }
}
