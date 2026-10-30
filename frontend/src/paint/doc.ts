// The layers of the Drawing (or Flipbook frame) open in Draw & Paint: pixels,
// structure edits with undo, compositing through cached per-layer canvases, and
// PNG encode / decode. Needs OffscreenCanvas only, so it also runs in a worker.

import type { Asset, BlendMode, DrawingLayer } from '../engine/types';
import type { PaintLayer, PixelPatch, Raster, Rect } from './types';
import { PaintHistory, readRect, writeRect } from './history';
import type { LayerSnapshot, PaintEntry, PaintHost, SnapLayer } from './history';

export { PaintHistory } from './history';
export type { LayerSnapshot, PaintEntry } from './history';

export type LayerProps = Partial<Pick<PaintLayer, 'name' | 'visible' | 'opacity' | 'blend' | 'alphaLock' | 'clipping'>>;

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const BLEND_OP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  add: 'lighter', passthrough: 'source-over',
};

/** Canvas mirror of one raster; ImageData shares the raster's buffer. */
interface Mirror {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  img: ImageData;
  dirty: Rect | null;
}

const mirrors = new WeakMap<Raster, Mirror>();
let counter = 1;

function newRaster(w: number, h: number): Raster {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

const ALPHA_MASK = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0xff000000 : 0xff;

function u32(r: Raster): Uint32Array | null {
  const d = r.data;
  return d.byteOffset % 4 === 0 ? new Uint32Array(d.buffer, d.byteOffset, d.length >> 2) : null;
}

/** Bounding box of pixels with alpha > 0, or null when fully transparent. */
function alphaBounds(r: Raster): Rect | null {
  const w = r.width, h = r.height;
  const u = u32(r);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const on = u ? (u[row + x] & ALPHA_MASK) !== 0 : r.data[(row + x) * 4 + 3] !== 0;
      if (on) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function isTransparent(r: Raster): boolean {
  const u = u32(r);
  if (u) {
    for (let i = 0; i < u.length; i++) if ((u[i] & ALPHA_MASK) !== 0) return false;
    return true;
  }
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] !== 0) return false;
  return true;
}

function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return 'l' + c.randomUUID().slice(0, 8);
  return 'l' + Math.random().toString(36).slice(2, 10);
}

function meta(l: PaintLayer): SnapLayer {
  return {
    id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend,
    alphaLock: l.alphaLock, clipping: l.clipping, source: l.source, raster: l.raster,
  };
}

export class PaintDoc implements PaintHost {
  readonly width: number;
  readonly height: number;
  layers: PaintLayer[];
  active: string;
  readonly history: PaintHistory;
  onChange: ((what: 'pixels' | 'layers' | 'active', rect?: Rect) => void) | null = null;

  private baseline: PaintEntry | null = null;
  private scratch: { c: OffscreenCanvas; x: OffscreenCanvasRenderingContext2D } | null = null;
  private scratch2: { c: OffscreenCanvas; x: OffscreenCanvasRenderingContext2D } | null = null;
  private reader: { c: OffscreenCanvas; x: OffscreenCanvasRenderingContext2D } | null = null;
  private flat: { key: string; raster: Raster } | null = null;
  private thumbs = new Map<string, { key: string; canvas: OffscreenCanvas }>();
  private disposed = false;
  /** Pixels marked dirty by a live stroke whose patch is not yet in history. */
  private uncommitted = false;

  constructor(width: number, height: number, layers: PaintLayer[]) {
    this.width = width;
    this.height = height;
    this.layers = layers.length ? layers : [this.makeLayer('Layer 1')];
    this.active = this.layers[0].id;
    this.history = new PaintHistory(this);
  }

  static async load(width: number, height: number, layers: DrawingLayer[], blobOf: (assetId: string) => Blob | undefined): Promise<PaintDoc> {
    const out: PaintLayer[] = [];
    let x: OffscreenCanvasRenderingContext2D | null = null;
    for (const d of layers) {
      const raster = newRaster(width, height);
      let source: string | null = null;
      const blob = d.pixels ? blobOf(d.pixels) : undefined;
      if (blob) {
        try {
          const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
          if (!x) x = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
          x.clearRect(0, 0, width, height);
          x.drawImage(bmp, 0, 0);
          bmp.close();
          raster.data.set(x.getImageData(0, 0, width, height).data);
          source = d.pixels;
        } catch {
          source = null;
        }
      }
      out.push({
        id: d.id, name: d.name, visible: d.visible, opacity: d.opacity, blend: d.blend,
        alphaLock: d.alphaLock, clipping: d.clipping, source, raster, version: counter++,
      });
    }
    return new PaintDoc(width, height, out);
  }

  static blank(width: number, height: number): PaintDoc {
    return new PaintDoc(width, height, []);
  }

  private makeLayer(name: string): PaintLayer {
    return {
      id: newId(), name, visible: true, opacity: 1, blend: 'normal', alphaLock: false, clipping: false,
      source: null, raster: newRaster(this.width, this.height), version: counter++,
    };
  }

  // ---- lookup ----

  layer(id: string): PaintLayer | null {
    return this.layers.find((l) => l.id === id) ?? null;
  }

  layerById(id: string): PaintLayer | null {
    return this.layer(id);
  }

  activeLayer(): PaintLayer {
    return this.layer(this.active) ?? this.layers[0];
  }

  setActive(id: string): void {
    if (id === this.active || !this.layer(id)) return;
    this.active = id;
    this.onChange?.('active');
  }

  // ---- history host ----

  private snap(): LayerSnapshot {
    return { layers: this.layers.map(meta), active: this.active };
  }

  restore(s: LayerSnapshot): void {
    this.layers = s.layers.map((m) => ({ ...m, version: counter++ }));
    this.active = this.layers.some((l) => l.id === s.active) ? s.active : this.layers[0].id;
  }

  touch(raster: Raster, rect: Rect): void {
    const m = mirrors.get(raster);
    if (m) m.dirty = unionRect(m.dirty, rect);
    for (const l of this.layers) if (l.raster === raster) { l.version = counter++; l.source = null; }
  }

  changed(what: 'pixels' | 'layers', rect?: Rect): void {
    this.onChange?.(what, rect);
  }

  private record(label: string, before: LayerSnapshot, patches?: PixelPatch[], tag?: string): void {
    this.history.push({ kind: 'layers', label, before, after: this.snap(), tag, patches });
    this.onChange?.('layers');
  }

  // ---- structure ----

  addLayer(above?: string, name?: string): PaintLayer {
    const before = this.snap();
    let n = this.layers.length + 1;
    const used = new Set(this.layers.map((l) => l.name));
    while (!name && used.has('Layer ' + n)) n++;
    const l = this.makeLayer(name ?? 'Layer ' + n);
    const i = this.layers.findIndex((x) => x.id === (above ?? this.active));
    this.layers.splice(i < 0 ? 0 : i, 0, l);
    this.active = l.id;
    this.record('Add layer', before);
    return l;
  }

  deleteLayer(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    if (this.layers.length === 1) { this.clearLayer(id); return; }
    const before = this.snap();
    this.layers.splice(i, 1);
    if (this.active === id) this.active = this.layers[Math.min(i, this.layers.length - 1)].id;
    this.record('Delete layer', before);
  }

  duplicateLayer(id: string): PaintLayer {
    const src = this.layer(id) ?? this.activeLayer();
    const before = this.snap();
    const l: PaintLayer = {
      ...src, id: newId(), name: src.name + ' copy', source: null,
      raster: { width: src.raster.width, height: src.raster.height, data: src.raster.data.slice() },
      version: counter++,
    };
    this.layers.splice(this.layers.indexOf(src), 0, l);
    this.active = l.id;
    this.record('Duplicate layer', before);
    return l;
  }

  moveLayer(id: string, toIndex: number): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const to = Math.max(0, Math.min(this.layers.length - 1, Math.round(toIndex)));
    if (to === i) return;
    const before = this.snap();
    const [l] = this.layers.splice(i, 1);
    this.layers.splice(to, 0, l);
    this.record('Move layer', before);
  }

  mergeDown(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0 || i >= this.layers.length - 1) return;
    const upper = this.layers[i];
    const lower = this.layers[i + 1];
    const before = this.snap();
    const patches: PixelPatch[] = [];
    const bounds = upper.visible ? alphaBounds(upper.raster) : null;
    if (bounds) {
      const r = this.readerCtx();
      r.globalAlpha = 1;
      r.globalCompositeOperation = 'copy';
      r.drawImage(this.mirror(lower.raster).canvas, 0, 0);
      r.globalAlpha = upper.opacity;
      r.globalCompositeOperation = upper.clipping ? 'source-atop' : BLEND_OP[upper.blend];
      r.drawImage(this.mirror(upper.raster).canvas, 0, 0);
      r.globalAlpha = 1;
      r.globalCompositeOperation = 'source-over';
      const got = r.getImageData(bounds.x, bounds.y, bounds.w, bounds.h).data;
      const patch: PixelPatch = { layer: lower.id, rect: bounds, before: readRect(lower.raster, bounds), after: got };
      writeRect(lower.raster, bounds, got);
      patches.push(patch);
      this.touch(lower.raster, bounds);
    }
    this.layers.splice(i, 1);
    this.active = lower.id;
    this.record('Merge down', before, patches);
  }

  flatten(): void {
    const vis = this.layers.filter((l) => l.visible);
    if (this.layers.length === 1 && this.layers[0].blend === 'normal' && this.layers[0].opacity === 1) return;
    const before = this.snap();
    const raster = vis.length ? this.renderRaster() : newRaster(this.width, this.height);
    const base = vis.length ? vis[vis.length - 1] : this.layers[this.layers.length - 1];
    const l: PaintLayer = {
      id: newId(), name: base.name, visible: true, opacity: 1, blend: 'normal', alphaLock: false, clipping: false,
      source: null, raster, version: counter++,
    };
    this.layers = [l];
    this.active = l.id;
    this.record('Flatten', before);
  }

  clearLayer(id: string): void {
    const l = this.layer(id);
    if (!l) return;
    const b = alphaBounds(l.raster);
    if (!b) return;
    const before = readRect(l.raster, b);
    const after = new Uint8ClampedArray(before.length);
    writeRect(l.raster, b, after);
    this.markDirty(id, b);
    this.commitPatch({ layer: id, rect: b, before, after }, 'Clear layer');
  }

  setProps(id: string, props: LayerProps, mergeTag?: string): void {
    const l = this.layer(id);
    if (!l) return;
    const p: LayerProps = { ...props };
    if (p.opacity !== undefined) p.opacity = Math.max(0, Math.min(1, p.opacity));
    let diff = false;
    for (const k of Object.keys(p) as (keyof LayerProps)[]) if (l[k] !== p[k]) diff = true;
    if (!diff) return;
    const before = this.snap();
    Object.assign(l, p);
    l.version = counter++;
    const label = p.opacity !== undefined ? 'Layer opacity'
      : p.name !== undefined ? 'Rename layer'
      : p.visible !== undefined ? 'Layer visibility'
      : p.blend !== undefined ? 'Layer blend'
      : 'Layer options';
    this.record(label, before, undefined, mergeTag);
  }

  // ---- pixels ----

  markDirty(layerId: string, rect: Rect): void {
    const l = this.layer(layerId);
    if (!l) return;
    const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(this.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(this.height, Math.ceil(rect.y + rect.h));
    if (x1 <= x0 || y1 <= y0) return;
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    l.version = counter++;
    l.source = null;
    this.uncommitted = true;
    const m = mirrors.get(l.raster);
    if (m) m.dirty = unionRect(m.dirty, r);
    this.onChange?.('pixels', r);
  }

  commitPatch(patch: PixelPatch, label = 'Paint'): void {
    this.uncommitted = false;
    this.history.push({ kind: 'pixels', label, patch });
  }

  undo(): boolean { return this.history.undo(); }
  redo(): boolean { return this.history.redo(); }
  canUndo(): boolean { return this.history.canUndo(); }
  canRedo(): boolean { return this.history.canRedo(); }
  undoLabel(): string | null { return this.history.undoLabel(); }
  redoLabel(): string | null { return this.history.redoLabel(); }

  isChanged(): boolean {
    return this.uncommitted || this.history.top() !== this.baseline || (this.baseline === null && this.history.hasDropped());
  }

  // ---- compositing ----

  private mirror(r: Raster): Mirror {
    let m = mirrors.get(r);
    if (!m) {
      const canvas = new OffscreenCanvas(r.width, r.height);
      const ctx = canvas.getContext('2d')!;
      const img = new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height);
      ctx.putImageData(img, 0, 0);
      m = { canvas, ctx, img, dirty: null };
      mirrors.set(r, m);
    } else if (m.dirty) {
      const d = m.dirty;
      const x = Math.max(0, d.x), y = Math.max(0, d.y);
      const w = Math.min(r.width, d.x + d.w) - x, h = Math.min(r.height, d.y + d.h) - y;
      if (w > 0 && h > 0) m.ctx.putImageData(m.img, 0, 0, x, y, w, h);
      m.dirty = null;
    }
    return m;
  }

  private surface(which: 'scratch' | 'scratch2'): { c: OffscreenCanvas; x: OffscreenCanvasRenderingContext2D } {
    let s = this[which];
    if (!s) {
      const c = new OffscreenCanvas(this.width, this.height);
      s = { c, x: c.getContext('2d')! };
      this[which] = s;
    }
    s.x.setTransform(1, 0, 0, 1, 0, 0);
    return s;
  }

  private readerCtx(): OffscreenCanvasRenderingContext2D {
    if (!this.reader) {
      const c = new OffscreenCanvas(this.width, this.height);
      this.reader = { c, x: c.getContext('2d', { willReadFrequently: true })! };
    }
    return this.reader.x;
  }

  private drawClipped(into: OffscreenCanvasRenderingContext2D, l: PaintLayer): void {
    const src = this.mirror(l.raster).canvas;
    if (l.blend === 'normal' || l.blend === 'passthrough') {
      into.globalAlpha = l.opacity;
      into.globalCompositeOperation = 'source-atop';
      into.drawImage(src, 0, 0);
    } else {
      // Blend into a copy, then lay that copy over the base only where the base has alpha.
      const s2 = this.surface('scratch2').x;
      s2.globalAlpha = 1;
      s2.globalCompositeOperation = 'copy';
      s2.drawImage(this.surface('scratch').c, 0, 0);
      s2.globalAlpha = l.opacity;
      s2.globalCompositeOperation = BLEND_OP[l.blend];
      s2.drawImage(src, 0, 0);
      s2.globalAlpha = 1;
      s2.globalCompositeOperation = 'source-over';
      into.globalAlpha = 1;
      into.globalCompositeOperation = 'source-atop';
      into.drawImage(this.scratch2!.c, 0, 0);
    }
    into.globalAlpha = 1;
    into.globalCompositeOperation = 'source-over';
  }

  composite(ctx: Ctx, live?: (ctx: Ctx) => void): void {
    const L = this.layers;
    const act = this.active;
    ctx.save();
    let i = L.length - 1;
    while (i >= 0) {
      const base = L[i];
      let j = i - 1;
      while (j >= 0 && L[j].clipping) j--;
      const next = j;
      if (base.visible) {
        const clipped: PaintLayer[] = [];
        for (let k = i - 1; k > j; k--) if (L[k].visible) clipped.push(L[k]);
        const hasLive = !!live && (base.id === act || clipped.some((c) => c.id === act));
        if (!clipped.length && !hasLive) {
          ctx.globalAlpha = base.opacity;
          ctx.globalCompositeOperation = BLEND_OP[base.blend];
          ctx.drawImage(this.mirror(base.raster).canvas, 0, 0);
        } else {
          const s = this.surface('scratch');
          s.x.globalAlpha = 1;
          s.x.globalCompositeOperation = 'source-over';
          s.x.clearRect(0, 0, this.width, this.height);
          s.x.drawImage(this.mirror(base.raster).canvas, 0, 0);
          if (hasLive && base.id === act) live!(s.x);
          for (let k = clipped.length - 1; k >= 0; k--) {
            this.drawClipped(s.x, clipped[k]);
            if (hasLive && clipped[k].id === act) live!(s.x);
          }
          ctx.globalAlpha = base.opacity;
          ctx.globalCompositeOperation = BLEND_OP[base.blend];
          ctx.drawImage(s.c, 0, 0);
        }
      }
      i = next;
    }
    ctx.restore();
  }

  private renderRaster(): Raster {
    const r = this.readerCtx();
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalAlpha = 1;
    r.globalCompositeOperation = 'source-over';
    r.clearRect(0, 0, this.width, this.height);
    this.composite(r);
    const img = r.getImageData(0, 0, this.width, this.height);
    return { width: this.width, height: this.height, data: img.data };
  }

  flattened(): Raster {
    const key = this.layers.map((l) => `${l.id}:${l.version}:${+l.visible}:${l.opacity}:${l.blend}:${+l.clipping}`).join('|');
    if (!this.flat || this.flat.key !== key) this.flat = { key, raster: this.renderRaster() };
    return this.flat.raster;
  }

  sampleColor(x: number, y: number, allLayers: boolean): { r: number; g: number; b: number; a: number } {
    const px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return { r: 0, g: 0, b: 0, a: 0 };
    const d = allLayers ? this.flattened().data : this.activeLayer().raster.data;
    const o = (py * this.width + px) * 4;
    return { r: d[o], g: d[o + 1], b: d[o + 2], a: d[o + 3] };
  }

  thumbnail(layerId: string, w: number, h: number): OffscreenCanvas {
    const l = this.layer(layerId);
    let t = this.thumbs.get(layerId);
    const key = `${l ? l.version : 0}:${w}x${h}`;
    if (t && t.key === key) return t.canvas;
    if (!t) {
      t = { key, canvas: new OffscreenCanvas(w, h) };
      this.thumbs.set(layerId, t);
    }
    t.key = key;
    if (t.canvas.width !== w || t.canvas.height !== h) { t.canvas.width = w; t.canvas.height = h; }
    const x = t.canvas.getContext('2d')!;
    x.clearRect(0, 0, w, h);
    if (l) {
      const s = Math.min(w / this.width, h / this.height);
      const dw = this.width * s, dh = this.height * s;
      x.imageSmoothingQuality = 'high';
      x.drawImage(this.mirror(l.raster).canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    return t.canvas;
  }

  // ---- save ----

  async encode(newAssetId: () => string): Promise<{ layers: DrawingLayer[]; assets: { asset: Asset; blob: Blob }[] }> {
    const layers: DrawingLayer[] = [];
    const assets: { asset: Asset; blob: Blob }[] = [];
    const sources = new Map<string, string | null>();
    for (const l of this.layers) {
      let pixels: string | null = null;
      if (l.source) {
        pixels = l.source;
      } else if (!isTransparent(l.raster)) {
        const blob = await this.mirror(l.raster).canvas.convertToBlob({ type: 'image/png' });
        const asset: Asset = {
          id: newAssetId(), kind: 'pixels', name: l.name, mime: 'image/png',
          width: this.width, height: this.height, frames: 0, size: blob.size,
        };
        assets.push({ asset, blob });
        pixels = asset.id;
      }
      sources.set(l.id, pixels);
      layers.push({
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend,
        alphaLock: l.alphaLock, clipping: l.clipping, pixels,
      });
    }
    for (const l of this.layers) l.source = sources.get(l.id) ?? null;
    this.baseline = this.history.top();
    this.uncommitted = false;
    return { layers, assets };
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.layers) {
      const m = mirrors.get(l.raster);
      if (m) { m.canvas.width = 0; mirrors.delete(l.raster); }
    }
    for (const s of [this.scratch, this.scratch2, this.reader]) if (s) s.c.width = 0;
    this.scratch = this.scratch2 = this.reader = null;
    this.thumbs.clear();
    this.flat = null;
  }
}
