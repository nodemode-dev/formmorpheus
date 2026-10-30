// Draw & Paint Settings > Canvas > "Crop and resize": gives the open Drawing or Flipbook its own canvas
// (Content.canvas, movie pixels). Crop moves or resizes the canvas edges (growing reaches into the backstage);
// Resample scales the pictures. The pictures of every frame and layer are re-baked as new PNG assets.
import '../styles/paint-crop.css';
import type { Engine } from '../engine/engine';
import { uid } from '../engine/model';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, canvasOf, clampCanvas, withCanvas } from '../engine/canvas';
import type { Asset, CanvasRect, Content, DrawingLayer } from '../engine/types';
import { Dialog } from './dialogs';
import { el, q, setClass, setHidden, setText } from './dom';
import { t } from './i18n';

export type CropMode = 'crop' | 'resample';
export type Interp = 'nearest' | 'bilinear';

export interface CropResult { mode: CropMode; rect: CanvasRect; interp: Interp }

export interface CropAsk {
  /** The Stage, movie pixels. */
  stage: { w: number; h: number; background: string; transparent: boolean };
  /** The canvas now, movie pixels. */
  canvas: CanvasRect;
  /** The pictures of the canvas now, flattened (any size; drawn into `canvas`). */
  picture: CanvasImageSource | null;
  flipbook: boolean;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const int = (v: string, lo: number, hi: number, def: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export class CropResizeDialog extends Dialog {
  private resolve: ((r: CropResult | null) => void) | null = null;
  private mode: CropMode = 'crop';
  private interp: Interp = 'bilinear';
  private ask0: CropAsk | null = null;
  private box: CanvasRect = { x: 0, y: 0, w: 1, h: 1 };
  private lock = false;
  private holdOriginal = false;
  private pct = 100;
  /** Preview mapping: movie px to preview css px. */
  private k = 1;
  private ox = 0;
  private oy = 0;
  private drag: { h: Handle; px: number; py: number; from: CanvasRect } | null = null;
  private readonly view = el<HTMLElement>('<div class="fm-crop-view"><canvas></canvas></div>');
  private readonly cv = q<HTMLCanvasElement>(this.view, 'canvas');
  private readonly modeBtns = (['crop', 'resample'] as const).map((m) => {
    const b = el<HTMLButtonElement>('<button type="button"></button>');
    setText(b, t(m === 'crop' ? 'Crop' : 'Resample'));
    b.addEventListener('click', () => { this.mode = m; this.sync(); });
    return b;
  });
  private readonly fields = (['X', 'Y', 'Width', 'Height'] as const).map((n) => el<HTMLInputElement>(`<input class="cv-input" type="number" step="1" aria-label="${n}">`));
  private readonly scaleIn = el<HTMLInputElement>('<input class="cv-input" type="number" min="5" max="800" step="1" value="100" aria-label="Scale">');
  private readonly interpSel = el<HTMLSelectElement>('<select class="cv-input" aria-label="Interpolation"><option value="bilinear"></option><option value="nearest"></option></select>');
  private readonly linkBox = el<HTMLInputElement>('<input type="checkbox" aria-label="Keep proportions">');
  private readonly cropGrid: HTMLElement;
  private readonly resRow: HTMLElement;
  private readonly interpRow: HTMLElement;
  private readonly linkRow: HTMLElement;
  private readonly note = el<HTMLElement>('<p class="fm-crop-note"></p>');
  private readonly readout = el<HTMLElement>('<p class="fm-crop-note"></p>');
  private readonly doneBtn: HTMLButtonElement;

  constructor() {
    super('Crop and resize', 540);
    const row = (label: string, input: HTMLElement): HTMLElement => {
      const r = el<HTMLElement>('<label class="cv-field"><span></span></label>');
      setText(q(r, 'span'), t(label));
      r.append(input);
      return r;
    };
    const modes = el<HTMLElement>('<div class="fm-crop-modes" role="group"></div>');
    modes.append(...this.modeBtns);
    const hold = el<HTMLButtonElement>('<button class="fm-crop-hold" type="button"></button>');
    setText(hold, t('Hold to see original'));
    const release = (): void => { if (this.holdOriginal) { this.holdOriginal = false; this.draw(); } };
    hold.addEventListener('pointerdown', () => { this.holdOriginal = true; this.draw(); });
    hold.addEventListener('pointerup', release);
    hold.addEventListener('pointerleave', release);
    hold.addEventListener('blur', release);
    const bar = el<HTMLElement>('<div class="fm-crop-bar"><span class="fm-crop-grow"></span></div>');
    bar.prepend(modes);
    bar.append(hold);
    this.cropGrid = el<HTMLElement>('<div class="fm-crop-grid"></div>');
    this.fields.forEach((f, i) => {
      this.cropGrid.append(row(['X', 'Y', 'Width', 'Height'][i], f));
      f.addEventListener('input', () => this.fromFields(i));
    });
    this.linkRow = el<HTMLElement>('<label class="fm-crop-link"></label>');
    this.linkRow.append(this.linkBox, el<HTMLElement>(`<span>${t('Keep proportions')}</span>`));
    this.linkBox.addEventListener('change', () => { this.lock = this.linkBox.checked; });
    this.resRow = row('Scale %', this.scaleIn);
    this.scaleIn.addEventListener('input', () => { this.pct = int(this.scaleIn.value, 5, 800, 100); this.sync(false); });
    q<HTMLOptionElement>(this.interpSel, 'option[value="bilinear"]').textContent = t('Bilinear');
    q<HTMLOptionElement>(this.interpSel, 'option[value="nearest"]').textContent = t('Nearest neighbor');
    this.interpRow = row('Interpolation', this.interpSel);
    this.interpSel.addEventListener('change', () => { this.interp = this.interpSel.value as Interp; });
    this.body.append(this.note, bar, this.view, this.cropGrid, this.linkRow, this.resRow, this.interpRow, this.readout);
    this.button('Reset', 'ghost', () => this.reset()).classList.add('cv-btn-apart');
    this.button('Cancel', 'ghost', () => this.close());
    this.doneBtn = this.button('Done', 'primary', () => this.apply());
    this.onClose = () => { const r = this.resolve; this.resolve = null; r?.(null); };
    this.bindDrag();
    new ResizeObserver(() => this.draw()).observe(this.view);
  }

  private base(): CanvasRect { return (this.ask0 as CropAsk).canvas; }

  private reset(): void {
    this.box = { ...this.base() };
    this.pct = 100;
    this.scaleIn.value = '100';
    this.sync();
  }

  /** The box the Done button would apply. */
  private target(): CanvasRect {
    if (this.mode === 'crop') return this.box;
    const b = this.base(), s = this.pct / 100;
    const w = Math.max(1, Math.round(b.w * s)), h = Math.max(1, Math.round(b.h * s));
    return { x: Math.round(b.x + (b.w - w) / 2), y: Math.round(b.y + (b.h - h) / 2), w, h };
  }

  private fromFields(i: number): void {
    const v = this.fields.map((f) => Number(f.value));
    if (v.some((n) => !Number.isFinite(n))) return;
    const b = { ...this.box };
    const ratio = b.w / b.h;
    if (i === 0) b.x = Math.round(v[0]);
    else if (i === 1) b.y = Math.round(v[1]);
    else if (i === 2) { b.w = Math.max(1, Math.round(v[2])); if (this.lock) b.h = Math.max(1, Math.round(b.w / ratio)); }
    else { b.h = Math.max(1, Math.round(v[3])); if (this.lock) b.w = Math.max(1, Math.round(b.h * ratio)); }
    this.box = this.limit(b);
    this.sync(false);
  }

  /** Keeps the size inside what the browser can hold. */
  private limit(b: CanvasRect): CanvasRect {
    let { w, h } = b;
    w = Math.min(MAX_CANVAS_SIDE, w); h = Math.min(MAX_CANVAS_SIDE, h);
    if (w * h > MAX_CANVAS_AREA) { const s = Math.sqrt(MAX_CANVAS_AREA / (w * h)); w = Math.floor(w * s); h = Math.floor(h * s); }
    return { x: b.x, y: b.y, w, h };
  }

  private sync(writeFields = true): void {
    const crop = this.mode === 'crop';
    this.modeBtns.forEach((b, i) => setClass(b, 'is-active', (i === 0) === crop));
    setHidden(this.cropGrid, !crop);
    setHidden(this.linkRow, !crop);
    setHidden(this.resRow, crop);
    setHidden(this.interpRow, crop);
    if (writeFields) this.fields.forEach((f, i) => { f.value = String([this.box.x, this.box.y, this.box.w, this.box.h][i]); });
    const b = this.target();
    const mp = Math.round((b.w * b.h) / 1e5) / 10;
    setText(this.readout, `${this.base().w} × ${this.base().h}  →  ${b.w} × ${b.h} px · ${mp} MP`);
    this.draw();
  }

  private apply(): void {
    const r = this.resolve;
    this.resolve = null;
    const res: CropResult = { mode: this.mode, rect: clampCanvas(this.target()), interp: this.interp };
    this.close();
    r?.(res);
  }

  /** Opens the dialog; resolves with the choice, or null when cancelled. */
  open2(a: CropAsk): Promise<CropResult | null> {
    this.ask0 = a;
    this.mode = 'crop';
    this.box = { ...a.canvas };
    this.pct = 100;
    this.scaleIn.value = '100';
    this.lock = false;
    this.linkBox.checked = false;
    this.interp = 'bilinear';
    this.interpSel.value = 'bilinear';
    setText(this.note, `${t('Canvas')} ${a.canvas.w} × ${a.canvas.h} · ${t('Stage')} ${a.stage.w} × ${a.stage.h}. ${a.flipbook ? t('Every frame of the Flipbook shares the canvas.') : t('Pixels outside the new edges are cleared; new area is transparent.')}`);
    this.resolve?.(null);
    const p = new Promise<CropResult | null>((res) => { this.resolve = res; });
    this.open(this.doneBtn);
    this.sync();
    return p;
  }

  // ---- preview ----------------------------------------------------------------------------------------------

  private extent(): CanvasRect {
    const a = this.ask0 as CropAsk;
    const b = this.base();
    const x0 = Math.min(0, b.x), y0 = Math.min(0, b.y), x1 = Math.max(a.stage.w, b.x + b.w), y1 = Math.max(a.stage.h, b.y + b.h);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.35;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  private layout(): { w: number; h: number } {
    const r = this.cv.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const e = this.extent();
    this.k = Math.min(w / e.w, h / e.h);
    this.ox = (w - e.w * this.k) / 2 - e.x * this.k;
    this.oy = (h - e.h * this.k) / 2 - e.y * this.k;
    return { w, h };
  }

  private draw(): void {
    const a = this.ask0;
    if (!a || !this.isOpen) return;
    const { w, h } = this.layout();
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (this.cv.width !== pw || this.cv.height !== ph) { this.cv.width = pw; this.cv.height = ph; }
    const g = this.cv.getContext('2d') as CanvasRenderingContext2D;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(this.view);
    g.fillStyle = css.getPropertyValue('--bg-input') || '#1b1b1d';
    g.fillRect(0, 0, w, h);
    const k = this.k, ox = this.ox, oy = this.oy;
    const R = (r: CanvasRect): [number, number, number, number] => [ox + r.x * k, oy + r.y * k, r.w * k, r.h * k];
    const old = this.base();
    const now = this.holdOriginal ? old : this.target();
    g.fillStyle = a.stage.transparent ? '#3a3a3e' : a.stage.background;
    g.fillRect(...R({ x: 0, y: 0, w: a.stage.w, h: a.stage.h }));
    if (a.picture) {
      g.save();
      g.imageSmoothingEnabled = true;
      if (this.mode === 'resample' && !this.holdOriginal) g.drawImage(a.picture, ...R(now));
      else g.drawImage(a.picture, ...R(old));
      g.restore();
    }
    // outside the new edges the picture will be cleared: dim it
    if (!this.holdOriginal) {
      g.save();
      g.beginPath();
      g.rect(0, 0, w, h);
      g.rect(...R(now));
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill('evenodd');
      g.restore();
    }
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.strokeRect(...R({ x: 0, y: 0, w: a.stage.w, h: a.stage.h }));
    g.setLineDash([]);
    g.strokeStyle = '#e8c53a';
    g.strokeRect(...R(old));
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    const [bx, by, bw, bh] = R(now);
    g.strokeRect(bx, by, bw, bh);
    if (this.mode === 'crop' && !this.holdOriginal) {
      g.fillStyle = '#fff';
      for (const hd of HANDLES) { const p = this.handlePt(hd, bx, by, bw, bh); g.fillRect(p[0] - 4, p[1] - 4, 8, 8); }
    }
  }

  private handlePt(h: Handle, x: number, y: number, w: number, hh: number): [number, number] {
    const cx = h.includes('w') ? x : h.includes('e') ? x + w : x + w / 2;
    const cy = h.includes('n') ? y : h.includes('s') ? y + hh : y + hh / 2;
    return [cx, cy];
  }

  private hit(px: number, py: number): Handle | null {
    if (this.mode !== 'crop') return null;
    const b = this.box;
    const x = this.ox + b.x * this.k, y = this.oy + b.y * this.k, w = b.w * this.k, h = b.h * this.k;
    for (const hd of HANDLES) {
      const p = this.handlePt(hd, x, y, w, h);
      if (Math.abs(px - p[0]) <= 8 && Math.abs(py - p[1]) <= 8) return hd;
    }
    return px >= x && px <= x + w && py >= y && py <= y + h ? 'move' : null;
  }

  private bindDrag(): void {
    const local = (e: PointerEvent): [number, number] => { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    this.cv.addEventListener('pointerdown', (e) => {
      const [px, py] = local(e);
      const h = this.hit(px, py);
      if (!h) return;
      this.drag = { h, px, py, from: { ...this.box } };
      this.cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.cv.addEventListener('pointermove', (e) => {
      const [px, py] = local(e);
      if (!this.drag) {
        const h = this.hit(px, py);
        this.cv.style.cursor = !h ? '' : h === 'move' ? 'move' : `${h === 'n' || h === 's' ? 'ns' : h === 'e' || h === 'w' ? 'ew' : h === 'nw' || h === 'se' ? 'nwse' : 'nesw'}-resize`;
        return;
      }
      const d = this.drag;
      this.box = this.limit(this.dragged(d.h, d.from, Math.round((px - d.px) / this.k), Math.round((py - d.py) / this.k)));
      this.sync();
    });
    const end = (): void => { this.drag = null; };
    this.cv.addEventListener('pointerup', end);
    this.cv.addEventListener('pointercancel', end);
  }

  private dragged(h: Handle, f: CanvasRect, dx: number, dy: number): CanvasRect {
    if (h === 'move') return { ...f, x: f.x + dx, y: f.y + dy };
    let l = f.x, r = f.x + f.w, tp = f.y, bt = f.y + f.h;
    if (h.includes('w')) l = Math.min(l + dx, r - 1);
    if (h.includes('e')) r = Math.max(r + dx, l + 1);
    if (h.includes('n')) tp = Math.min(tp + dy, bt - 1);
    if (h.includes('s')) bt = Math.max(bt + dy, tp + 1);
    let w = r - l, hh = bt - tp;
    if (this.lock) {
      const ratio = f.w / f.h;
      const horiz = h.includes('w') || h.includes('e');
      if (horiz) hh = Math.max(1, Math.round(w / ratio)); else w = Math.max(1, Math.round(hh * ratio));
      if (h.includes('w')) l = r - w;
      if (h.includes('n')) tp = bt - hh;
      if (!h.includes('w') && !h.includes('e')) l = f.x + Math.round((f.w - w) / 2);
      if (!h.includes('n') && !h.includes('s')) tp = f.y + Math.round((f.h - hh) / 2);
    }
    return { x: l, y: tp, w, h: hh };
  }
}

// ---- baking ---------------------------------------------------------------------------------------------------

async function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

/** One picture moved into the new canvas: cropped at 1:1, or resampled to fill it. */
function transformBitmap(src: ImageBitmap, from: CanvasRect, to: CanvasRect, r: CropResult, mask: boolean): OffscreenCanvas {
  const out = new OffscreenCanvas(to.w, to.h);
  const g = out.getContext('2d') as OffscreenCanvasRenderingContext2D;
  if (mask) { g.fillStyle = '#fff'; g.fillRect(0, 0, to.w, to.h); }
  g.imageSmoothingEnabled = r.interp !== 'nearest';
  g.imageSmoothingQuality = 'high';
  if (r.mode === 'resample') g.drawImage(src, 0, 0, to.w, to.h);
  else g.drawImage(src, from.x - to.x, from.y - to.y, from.w, from.h);
  return out;
}

/** Re-bakes every layer (and layer mask) of the Drawing or Flipbook into the new canvas; returns the content with the canvas set and the new assets. */
export async function bakeCanvas(engine: Engine, c: Content, r: CropResult): Promise<{ content: Content; assets: { asset: Asset; blob: Blob }[] }> {
  const m = engine.movie;
  if (!m) throw new Error('no movie');
  const from = canvasOf(c, m);
  const to = r.rect;
  const made = new Map<string, string>();
  const assets: { asset: Asset; blob: Blob }[] = [];
  const bake = async (id: string | null | undefined, mask: boolean): Promise<string | null> => {
    if (!id) return null;
    const have = made.get(id);
    if (have) return have;
    const blob = engine.assets.get(id);
    if (!blob) return id;
    const bmp = await decode(blob);
    const cv = transformBitmap(bmp, from, to, r, mask);
    bmp.close();
    const out = await cv.convertToBlob({ type: 'image/png' });
    const asset: Asset = { id: uid('p'), kind: 'pixels', name: 'Crop', mime: 'image/png', width: to.w, height: to.h, frames: 1, size: out.size };
    assets.push({ asset, blob: out });
    made.set(id, asset.id);
    return asset.id;
  };
  const layers = async (list: DrawingLayer[]): Promise<DrawingLayer[]> => {
    const out: DrawingLayer[] = [];
    for (const l of list) out.push({ ...l, pixels: await bake(l.pixels, false), ...(l.mask ? { mask: await bake(l.mask, true) } : {}) });
    return out;
  };
  let next: Content;
  if (c.kind !== 'flipbook') next = { ...c, layers: await layers(c.layers) };
  else {
    const flip = [];
    for (const t of c.flip) {
      const frames = [];
      for (const f of t.frames) frames.push({ ...f, layers: await layers(f.layers) });
      flip.push({ ...t, frames });
    }
    next = { ...c, flip };
  }
  return { content: withCanvas(next, m, to), assets };
}
