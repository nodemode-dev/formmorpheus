// The layers of the Drawing (or Flipbook frame) open in Draw & Paint: pixels,
// structure edits with undo, compositing through cached per-layer canvases, and
// PNG encode / decode. Needs OffscreenCanvas only, so it also runs in a worker.

import type { Asset, DrawingLayer } from '../engine/types';
import type { PaintLayer, PaintMask, PixelPatch, Raster, Rect } from './types';
import { PaintHistory, readRect, writeRect } from './history';
import type { LayerSnapshot, PaintEntry, PaintHost, SnapLayer } from './history';
import { BLEND_OP, SurfacePool, blockEnd, drawTree, isInside } from './layer-tree';
import type { TreeHooks } from './layer-tree';

export { PaintHistory } from './history';
export type { LayerSnapshot, PaintEntry } from './history';

export type LayerProps = Partial<Pick<PaintLayer, 'name' | 'visible' | 'opacity' | 'blend' | 'alphaLock' | 'clipping'>>;

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Canvas copy of a mask raster whose alpha is the mask value; ImageData is its own buffer. */
interface AlphaMirror {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  img: ImageData;
  dirty: Rect | null;
}

const alphaMirrors = new WeakMap<Raster, AlphaMirror>();

function markAlpha(r: Raster, rect: Rect): void {
  const a = alphaMirrors.get(r);
  if (a) a.dirty = unionRect(a.dirty, rect);
}

/** An opaque grey raster of one value. */
function maskRaster(w: number, h: number, value: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: w, height: h, data };
}

export type MaskFill = 'reveal' | 'hide';

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
    group: l.group, parent: l.parent, collapsed: l.collapsed, mask: l.mask, maskSource: l.maskSource,
  };
}

/** Decodes a PNG into a raster of the movie's size (straight alpha). */
async function decodeRaster(blob: Blob, width: number, height: number, ctx: OffscreenCanvasRenderingContext2D): Promise<Raster> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const r = newRaster(width, height);
  r.data.set(ctx.getImageData(0, 0, width, height).data);
  return r;
}

export class PaintDoc implements PaintHost {
  readonly width: number;
  readonly height: number;
  layers: PaintLayer[];
  active: string;
  readonly history: PaintHistory;
  onChange: ((what: 'pixels' | 'layers' | 'active', rect?: Rect) => void) | null = null;

  private baseline: PaintEntry | null = null;
  private pool: SurfacePool | null = null;
  private reader: { c: OffscreenCanvas; x: OffscreenCanvasRenderingContext2D } | null = null;
  /** The mask of the active layer is the paint target (not the pixels). */
  private maskEdit = false;
  /** Fold state changed since the last save (it is not an undo step). */
  private metaDirty = false;
  private flat: { key: string; raster: Raster } | null = null;
  private thumbs = new Map<string, { key: string; canvas: OffscreenCanvas }>();
  private mthumbs = new Map<string, { key: string; canvas: OffscreenCanvas }>();
  private readonly hooks: TreeHooks<PaintLayer> = {
    image: (l) => (l.group ? null : this.mirror(l.raster).canvas),
    mask: (l) => (l.mask && l.mask.on ? this.alphaOf(l.mask) : null),
  };
  private disposed = false;
  /** Pixels marked dirty by a live stroke whose patch is not yet in history. */
  private uncommitted = false;
  private dirtCount = 0;

  constructor(width: number, height: number, layers: PaintLayer[]) {
    this.width = width;
    this.height = height;
    this.layers = layers.length ? layers : [this.makeLayer('Layer 1')];
    this.active = (this.layers.find((l) => !l.group) ?? this.layers[0]).id;
    this.history = new PaintHistory(this);
  }

  static async load(width: number, height: number, layers: DrawingLayer[], blobOf: (assetId: string) => Blob | undefined): Promise<PaintDoc> {
    const out: PaintLayer[] = [];
    let x: OffscreenCanvasRenderingContext2D | null = null;
    const ctx = (): OffscreenCanvasRenderingContext2D => (x ??= new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!);
    for (const d of layers) {
      let raster = newRaster(d.group ? 1 : width, d.group ? 1 : height);
      let source: string | null = null;
      const blob = !d.group && d.pixels ? blobOf(d.pixels) : undefined;
      if (blob) {
        try {
          raster = await decodeRaster(blob, width, height, ctx());
          source = d.pixels;
        } catch {
          source = null;
        }
      }
      const layer: PaintLayer = {
        id: d.id, name: d.name, visible: d.visible, opacity: d.opacity, blend: d.blend,
        alphaLock: d.alphaLock, clipping: d.clipping, source, raster, version: counter++,
      };
      if (d.group) layer.group = true;
      if (d.parent) layer.parent = d.parent;
      if (d.collapsed) layer.collapsed = true;
      if (d.mask) {
        const mb = blobOf(d.mask);
        if (mb) {
          try {
            const mr = await decodeRaster(mb, width, height, ctx());
            for (let i = 3; i < mr.data.length; i += 4) mr.data[i] = 255;
            layer.mask = { raster: mr, on: d.maskOn !== false, linked: d.maskLinked !== false };
            layer.maskSource = d.mask;
          } catch { /* a mask that will not decode leaves the layer whole */ }
        }
      }
      out.push(layer);
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

  /** A layer by id; `mask:<id>` is that layer's mask seen as a layer (what the history patches target). */
  layerById(id: string): PaintLayer | null {
    if (id.startsWith('mask:')) {
      const o = this.layer(id.slice(5));
      return o && o.mask ? { ...o, id, raster: o.mask.raster } : null;
    }
    return this.layer(id);
  }

  activeLayer(): PaintLayer {
    return this.layer(this.active) ?? this.layers.find((l) => !l.group) ?? this.layers[0];
  }

  setActive(id: string): void {
    const l = this.layer(id);
    if (!l || l.group) return;
    if (id === this.active) return;
    this.active = id;
    this.maskEdit = false;
    this.onChange?.('active');
  }

  // ---- mask editing ----

  /** True while the active layer's mask (not its pixels) takes the brush. */
  maskEditing(): boolean {
    return this.maskEdit && !!this.activeLayer().mask;
  }

  setMaskEdit(on: boolean): void {
    const want = on && !!this.activeLayer().mask;
    if (want === this.maskEdit) return;
    this.maskEdit = want;
    this.onChange?.('active');
  }

  /** What a stroke, fill or smudge paints on: the active layer's pixels, or its mask when that is selected. Null for a group. */
  paintTarget(): { id: string; raster: Raster; alphaLock: boolean; mask: boolean } | null {
    const l = this.activeLayer();
    if (this.maskEdit && l.mask) return { id: 'mask:' + l.id, raster: l.mask.raster, alphaLock: false, mask: true };
    if (l.group) return null;
    return { id: l.id, raster: l.raster, alphaLock: l.alphaLock, mask: false };
  }

  // ---- history host ----

  private snap(): LayerSnapshot {
    return { layers: this.layers.map(meta), active: this.active };
  }

  restore(s: LayerSnapshot): void {
    const fold = new Map(this.layers.map((l) => [l.id, l.collapsed]));
    this.layers = s.layers.map((m) => {
      const c = fold.has(m.id) ? fold.get(m.id) : m.collapsed;
      return { ...m, collapsed: c, version: counter++ };
    });
    this.active = this.layers.some((l) => l.id === s.active) ? s.active : (this.layers.find((l) => !l.group) ?? this.layers[0]).id;
    if (!this.activeLayer().mask) this.maskEdit = false;
  }

  touch(raster: Raster, rect: Rect): void {
    const m = mirrors.get(raster);
    if (m) m.dirty = unionRect(m.dirty, rect);
    markAlpha(raster, rect);
    for (const l of this.layers) {
      if (l.raster === raster) { l.version = counter++; l.source = null; }
      else if (l.mask && l.mask.raster === raster) { l.version = counter++; l.maskSource = null; }
    }
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
    if (i >= 0 && this.layers[i].parent) l.parent = this.layers[i].parent;
    this.layers.splice(i < 0 ? 0 : i, 0, l);
    this.active = l.id;
    this.maskEdit = false;
    this.record('Add layer', before);
    return l;
  }

  deleteLayer(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    const end = blockEnd(this.layers, i);
    const rest = [...this.layers.slice(0, i), ...this.layers.slice(end)];
    if (!rest.some((l) => !l.group)) {
      if (!this.layers[i].group) { this.clearLayer(id); return; }
      const f = this.makeLayer('Layer 1');
      if (this.layers[i].parent) f.parent = this.layers[i].parent;
      rest.splice(i, 0, f);
    }
    const before = this.snap();
    const gone = new Set(this.layers.slice(i, end).map((l) => l.id));
    this.layers = rest;
    if (gone.has(this.active)) {
      const leaf = (l: PaintLayer): boolean => !l.group;
      this.active = (rest.slice(i).find(leaf) ?? rest.slice(0, i).reverse().find(leaf) ?? rest[0]).id;
      this.maskEdit = false;
    }
    this.record(before.layers[i].group ? 'Delete group' : 'Delete layer', before);
  }

  duplicateLayer(id: string): PaintLayer {
    const src = this.layer(id) ?? this.activeLayer();
    const before = this.snap();
    const at = this.layers.indexOf(src);
    const end = blockEnd(this.layers, at);
    const map = new Map<string, string>();
    for (let k = at; k < end; k++) map.set(this.layers[k].id, newId());
    const copies = this.layers.slice(at, end).map((o, k): PaintLayer => {
      const c: PaintLayer = {
        ...o, id: map.get(o.id)!, source: null, version: counter++,
        raster: o.group ? newRaster(1, 1) : { width: o.raster.width, height: o.raster.height, data: o.raster.data.slice() },
      };
      if (k === 0) c.name = o.name + (o.group ? ' copy' : ' copy');
      if (o.parent && map.has(o.parent)) c.parent = map.get(o.parent);
      if (o.mask) {
        c.mask = { ...o.mask, raster: { width: o.mask.raster.width, height: o.mask.raster.height, data: o.mask.raster.data.slice() } };
        c.maskSource = null;
      }
      return c;
    });
    this.layers.splice(at, 0, ...copies);
    const lead = copies.find((c) => !c.group);
    if (lead) this.active = lead.id;
    this.maskEdit = false;
    this.record(src.group ? 'Duplicate group' : 'Duplicate layer', before);
    return copies[0];
  }

  // ---- groups ----

  /** Wraps the layer (or group) in a new group placed where it was. */
  addGroup(id?: string): PaintLayer | null {
    const t = this.layer(id ?? this.active);
    if (!t) return null;
    const before = this.snap();
    const used = new Set(this.layers.map((l) => l.name));
    let n = 1;
    while (used.has('Group ' + n)) n++;
    const g: PaintLayer = {
      id: newId(), name: 'Group ' + n, visible: true, opacity: 1, blend: 'normal', alphaLock: false, clipping: false,
      source: null, raster: newRaster(1, 1), version: counter++, group: true,
    };
    if (t.parent) g.parent = t.parent;
    t.parent = g.id;
    t.clipping = false;
    this.layers.splice(this.layers.indexOf(t), 0, g);
    this.record('New group', before);
    return g;
  }

  /** Dissolves a group: its content stays where it is, one level up. */
  ungroup(id: string): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0 || !this.layers[i].group) return;
    const before = this.snap();
    const g = this.layers[i];
    for (const l of this.layers) if (l.parent === id) { if (g.parent) l.parent = g.parent; else delete l.parent; }
    this.layers.splice(i, 1);
    this.record('Ungroup', before);
  }

  /** Folds or opens a group in the panel. Saved with the file but not an undo step. */
  setCollapsed(id: string, on: boolean): void {
    const g = this.layer(id);
    if (!g || !g.group || !!g.collapsed === on) return;
    g.collapsed = on;
    this.metaDirty = true;
    this.onChange?.('layers');
  }

  /**
   * Moves a layer or group (with its content) into `parent` (null for the top level), above the entry `beforeId`
   * or, when that is null, at the bottom of the parent. A group cannot move into itself.
   */
  moveEntry(id: string, parent: string | null, beforeId: string | null): void {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    if (parent && (parent === id || isInside(this.layers, parent, id))) return;
    if (beforeId && (beforeId === id || isInside(this.layers, beforeId, id))) return;
    const key = (): string => this.layers.map((l) => l.id + '>' + (l.parent ?? '')).join('|');
    const was = key();
    const before = this.snap();
    const end = blockEnd(this.layers, i);
    const block = this.layers.splice(i, end - i);
    if (parent) block[0].parent = parent; else delete block[0].parent;
    let k: number;
    if (beforeId) k = this.layers.findIndex((l) => l.id === beforeId);
    else if (parent) k = blockEnd(this.layers, this.layers.findIndex((l) => l.id === parent));
    else k = this.layers.length;
    if (k < 0) k = this.layers.length;
    this.layers.splice(k, 0, ...block);
    if (key() === was) { this.layers = before.layers.map((m) => ({ ...m, version: counter++ })); return; }
    this.record(block[0].group ? 'Move group' : 'Move layer', before);
  }

  // ---- masks ----

  /** Adds a mask to a layer: revealing everything (white) or hiding everything (black). The mask becomes the paint target. */
  addMask(id: string, fill: MaskFill = 'reveal'): void {
    const l = this.layer(id);
    if (!l || l.group || l.mask) return;
    const before = this.snap();
    l.mask = { raster: maskRaster(this.width, this.height, fill === 'reveal' ? 255 : 0), on: true, linked: true };
    l.maskSource = null;
    l.version = counter++;
    this.active = id;
    this.maskEdit = true;
    this.record('Add mask', before);
  }

  deleteMask(id: string): void {
    const l = this.layer(id);
    if (!l || !l.mask) return;
    const before = this.snap();
    l.mask = null;
    l.maskSource = null;
    l.version = counter++;
    if (l.id === this.active) this.maskEdit = false;
    this.record('Delete mask', before);
  }

  /** Bakes the mask into the layer's alpha, then removes it. */
  applyMask(id: string): void {
    const l = this.layer(id);
    if (!l || l.group || !l.mask) return;
    const before = this.snap();
    const patches: PixelPatch[] = [];
    const b = alphaBounds(l.raster);
    if (b) {
      const was = readRect(l.raster, b);
      const now = new Uint8ClampedArray(was);
      const m = l.mask.raster.data, w = l.raster.width;
      for (let y = 0; y < b.h; y++) {
        let o = y * b.w * 4 + 3, mo = ((b.y + y) * w + b.x) * 4;
        for (let x = 0; x < b.w; x++, o += 4, mo += 4) now[o] = (now[o] * m[mo] + 127) / 255;
      }
      writeRect(l.raster, b, now);
      patches.push({ layer: l.id, rect: b, before: was, after: now });
      this.touch(l.raster, b);
    }
    l.mask = null;
    l.maskSource = null;
    l.version = counter++;
    if (l.id === this.active) this.maskEdit = false;
    this.record('Apply mask', before, patches);
  }

  invertMask(id: string): void {
    const l = this.layer(id);
    if (!l || !l.mask) return;
    const r = l.mask.raster;
    const rect = { x: 0, y: 0, w: r.width, h: r.height };
    const was = readRect(r, rect);
    const now = new Uint8ClampedArray(was);
    for (let i = 0; i < now.length; i += 4) { const v = 255 - now[i]; now[i] = v; now[i + 1] = v; now[i + 2] = v; }
    writeRect(r, rect, now);
    this.touch(r, rect);
    this.onChange?.('pixels', rect);
    this.commitPatch({ layer: 'mask:' + id, rect, before: was, after: now }, 'Invert mask');
  }

  /** Turns the mask on or off, or links it to the layer or not. */
  setMask(id: string, p: { on?: boolean; linked?: boolean }): void {
    const l = this.layer(id);
    if (!l || !l.mask) return;
    const on = p.on ?? l.mask.on, linked = p.linked ?? l.mask.linked;
    if (on === l.mask.on && linked === l.mask.linked) return;
    const before = this.snap();
    const label = p.on !== undefined ? (on ? 'Enable mask' : 'Disable mask') : 'Link mask';
    l.mask = { raster: l.mask.raster, on, linked };
    l.version = counter++;
    this.record(label, before);
  }

  canMergeDown(id: string): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    if (i < 0 || this.layers[i].group) return false;
    const lower = this.layers[i + 1];
    return !!lower && !lower.group && (lower.parent ?? null) === (this.layers[i].parent ?? null);
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
    if (i < 0 || !this.canMergeDown(id)) return;
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
      let src: CanvasImageSource = this.mirror(upper.raster).canvas;
      let tmp: ReturnType<SurfacePool['get']> | null = null;
      if (upper.mask && upper.mask.on) {
        // the upper layer's mask goes into the merged pixels
        tmp = this.surfaces().get();
        tmp.x.drawImage(src, 0, 0);
        tmp.x.globalCompositeOperation = 'destination-in';
        tmp.x.drawImage(this.alphaOf(upper.mask), 0, 0);
        tmp.x.globalCompositeOperation = 'source-over';
        src = tmp.c;
      }
      r.drawImage(src, 0, 0);
      if (tmp) this.surfaces().put(tmp);
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
    const leaves = this.layers.filter((l) => !l.group);
    const vis = leaves.filter((l) => l.visible);
    if (this.layers.length === 1 && this.layers[0].blend === 'normal' && this.layers[0].opacity === 1 && !this.layers[0].mask) return;
    const before = this.snap();
    const raster = vis.length ? this.renderRaster() : newRaster(this.width, this.height);
    const base = vis.length ? vis[vis.length - 1] : leaves[leaves.length - 1];
    this.maskEdit = false;
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
    if (!l || l.group) return;
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
    const isMask = layerId.startsWith('mask:');
    const l = this.layer(isMask ? layerId.slice(5) : layerId);
    const raster = isMask ? l?.mask?.raster : l?.raster;
    if (!l || !raster) return;
    const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(this.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(this.height, Math.ceil(rect.y + rect.h));
    if (x1 <= x0 || y1 <= y0) return;
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    l.version = counter++;
    if (isMask) { l.maskSource = null; markAlpha(raster, r); } else l.source = null;
    this.uncommitted = true;
    this.dirtCount++;
    const m = mirrors.get(raster);
    if (m) m.dirty = unionRect(m.dirty, r);
    this.onChange?.('pixels', r);
  }

  /** After a cancelled stroke, transform or filter has put the exact pixels back: nothing is left to save. */
  settle(): void {
    this.uncommitted = false;
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
    return this.uncommitted || this.metaDirty || this.history.top() !== this.baseline || (this.baseline === null && this.history.hasDropped());
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

  private surfaces(): SurfacePool {
    return (this.pool ??= new SurfacePool(this.width, this.height));
  }

  /** The mask as a canvas whose alpha is the mask value; only the rows touched since the last call are converted. */
  private alphaOf(m: PaintMask): CanvasImageSource {
    const r = m.raster;
    let a = alphaMirrors.get(r);
    if (!a) {
      const canvas = new OffscreenCanvas(r.width, r.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      a = { canvas, ctx, img: new ImageData(r.width, r.height), dirty: { x: 0, y: 0, w: r.width, h: r.height } };
      alphaMirrors.set(r, a);
    }
    const d = a.dirty;
    if (d) {
      const x = Math.max(0, d.x), y = Math.max(0, d.y);
      const w = Math.min(r.width, d.x + d.w) - x, h = Math.min(r.height, d.y + d.h) - y;
      if (w > 0 && h > 0) {
        const src = r.data, dst = a.img.data;
        for (let yy = y; yy < y + h; yy++) {
          let o = (yy * r.width + x) * 4;
          for (let xx = 0; xx < w; xx++, o += 4) dst[o + 3] = src[o];
        }
        a.ctx.putImageData(a.img, 0, 0, x, y, w, h);
      }
      a.dirty = null;
    }
    return a.canvas;
  }

  private readerCtx(): OffscreenCanvasRenderingContext2D {
    if (!this.reader) {
      const c = new OffscreenCanvas(this.width, this.height);
      this.reader = { c, x: c.getContext('2d', { willReadFrequently: true })! };
    }
    return this.reader.x;
  }

  /** Draws the layers, groups and masks. `live` previews a tool over the active layer's pixels. */
  composite(ctx: Ctx, live?: (ctx: Ctx) => void, region?: Rect): void {
    ctx.save();
    drawTree(ctx, this.layers, this.width, this.height, this.hooks, this.surfaces(), live ? { active: this.active, draw: live } : undefined, region);
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
    const key = this.layers.map((l) => `${l.id}:${l.version}:${+l.visible}:${l.opacity}:${l.blend}:${+l.clipping}:${l.parent ?? ''}:${l.mask?.on ? 1 : 0}`).join('|');
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
    if (l && !l.group) {
      const s = Math.min(w / this.width, h / this.height);
      const dw = this.width * s, dh = this.height * s;
      x.imageSmoothingQuality = 'high';
      x.drawImage(this.mirror(l.raster).canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    return t.canvas;
  }

  /** Thumbnail of a layer's mask (grey), cached on the layer's version. */
  maskThumbnail(layerId: string, w: number, h: number): OffscreenCanvas {
    const l = this.layer(layerId);
    let t = this.mthumbs.get(layerId);
    const key = `${l ? l.version : 0}:${w}x${h}:${l?.mask ? 1 : 0}`;
    if (t && t.key === key) return t.canvas;
    if (!t) {
      t = { key, canvas: new OffscreenCanvas(w, h) };
      this.mthumbs.set(layerId, t);
    }
    t.key = key;
    if (t.canvas.width !== w || t.canvas.height !== h) { t.canvas.width = w; t.canvas.height = h; }
    const x = t.canvas.getContext('2d')!;
    x.clearRect(0, 0, w, h);
    if (l && l.mask) {
      const s = Math.min(w / this.width, h / this.height);
      const dw = this.width * s, dh = this.height * s;
      x.imageSmoothingQuality = 'high';
      x.drawImage(this.mirror(l.mask.raster).canvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    return t.canvas;
  }

  // ---- save ----

  async encode(newAssetId: () => string): Promise<{ layers: DrawingLayer[]; assets: { asset: Asset; blob: Blob }[] }> {
    const layers: DrawingLayer[] = [];
    const assets: { asset: Asset; blob: Blob }[] = [];
    const sources = new Map<string, string | null>();
    // edits can land while the blobs encode (a frame reopened during a background save): remember what was
    // encoded and only mark as saved what did not change meanwhile
    const list = [...this.layers];
    const versions = new Map(list.map((l) => [l.id, l.version]));
    const top = this.history.top();
    const dirt = this.dirtCount;
    const maskSources = new Map<string, string | null>();
    for (const l of list) {
      let pixels: string | null = null;
      let mask: string | null = null;
      if (l.mask) {
        if (l.maskSource) mask = l.maskSource;
        else {
          const blob = await this.mirror(l.mask.raster).canvas.convertToBlob({ type: 'image/png' });
          const asset: Asset = {
            id: newAssetId(), kind: 'pixels', name: l.name + ' mask', mime: 'image/png',
            width: this.width, height: this.height, frames: 0, size: blob.size,
          };
          assets.push({ asset, blob });
          mask = asset.id;
        }
        maskSources.set(l.id, mask);
      }
      if (l.group) {
        pixels = null;
      } else if (l.source) {
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
      const out: DrawingLayer = {
        id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend,
        alphaLock: l.alphaLock, clipping: l.clipping, pixels,
      };
      // optional fields only when set, so a file without groups or masks is byte-for-byte as before
      if (l.group) out.group = true;
      if (l.parent) out.parent = l.parent;
      if (l.collapsed) out.collapsed = true;
      if (l.mask && mask) { out.mask = mask; out.maskOn = l.mask.on; out.maskLinked = l.mask.linked; }
      layers.push(out);
    }
    for (const l of this.layers) {
      if (versions.get(l.id) !== l.version) continue;
      if (sources.has(l.id) && !l.group) l.source = sources.get(l.id) ?? null;
      if (maskSources.has(l.id)) l.maskSource = maskSources.get(l.id) ?? null;
    }
    this.baseline = top;
    this.metaDirty = false;
    if (this.dirtCount === dirt) this.uncommitted = false;
    return { layers, assets };
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.layers) {
      for (const r of l.mask ? [l.raster, l.mask.raster] : [l.raster]) {
        const m = mirrors.get(r);
        if (m) { m.canvas.width = 0; mirrors.delete(r); }
        const a = alphaMirrors.get(r);
        if (a) { a.canvas.width = 0; alphaMirrors.delete(r); }
      }
    }
    if (this.reader) this.reader.c.width = 0;
    this.reader = null;
    this.pool?.dispose();
    this.pool = null;
    this.thumbs.clear();
    this.mthumbs.clear();
    this.flat = null;
  }
}
