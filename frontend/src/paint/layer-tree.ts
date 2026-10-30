// Layer groups and masks, drawn: one compositor shared by the Draw & Paint view (PaintDoc) and the
// Stage / export renderer. Entries sit in a flat list, top first; an entry names its group in `parent`.
// A group renders its children on a surface of its own (isolated) and lays that over the rest with its
// opacity and blend; blend 'passthrough' at full opacity draws the children straight onto what is below.
// Needs OffscreenCanvas only. The canvases it draws are in movie pixels (w by h).

import type { BlendMode } from '../engine/types';
import type { Rect } from './types';
import { blendCanvasOnto, blendRect, isPixelBlend } from '../engine/blend';

let scaledScratch: OffscreenCanvas | null = null;

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export const BLEND_OP: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
  difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
  add: 'lighter', passthrough: 'source-over',
  'linear-burn': 'source-over', 'darker-color': 'source-over', 'lighter-color': 'source-over', 'vivid-light': 'source-over', 'linear-light': 'source-over',
  'pin-light': 'source-over', 'hard-mix': 'source-over', subtract: 'source-over', divide: 'source-over',
};

export interface TreeItem {
  id: string;
  parent?: string | null;
  group?: boolean;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  clipping: boolean;
}

/** `local`: a surface the size of a repaint region, drawn in movie coordinates through a translation. */
export interface Surf { c: OffscreenCanvas; x: OffscreenCanvasRenderingContext2D; local?: boolean }

const localCanvases = new WeakSet<object>();

/** Reusable scratch canvases: full-size ones, and small ones for a dirty repaint (a full-size canvas that is drawn from and then edited is copied whole by the browser). */
export class SurfacePool {
  private free: Surf[] = [];
  private freeLocal: Surf[] = [];
  private all: Surf[] = [];

  constructor(readonly width: number, readonly height: number) {}

  /** A cleared surface; with `region` it only covers that area, so a small repaint costs a small area. */
  get(region?: Rect): Surf {
    let s: Surf | undefined;
    if (region) {
      // the smallest free surface that fits, unless it is far bigger than the region (copying it costs more than a new one)
      let best = -1;
      for (let k = 0; k < this.freeLocal.length; k++) {
        const f = this.freeLocal[k].c;
        if (f.width < region.w || f.height < region.h) continue;
        if (best < 0 || f.width * f.height < this.freeLocal[best].c.width * this.freeLocal[best].c.height) best = k;
      }
      const fit = best >= 0 ? this.freeLocal[best].c : null;
      if (fit && fit.width * fit.height <= 4 * region.w * region.h + 16384) s = this.freeLocal.splice(best, 1)[0];
      else {
        const c = new OffscreenCanvas(Math.min(this.width, Math.ceil(region.w / 64) * 64), Math.min(this.height, Math.ceil(region.h / 64) * 64));
        s = { c, x: c.getContext('2d')!, local: true };
        localCanvases.add(c);
        this.all.push(s);
      }
      s.x.setTransform(1, 0, 0, 1, -region.x, -region.y);
      s.x.globalAlpha = 1;
      s.x.globalCompositeOperation = 'source-over';
      s.x.clearRect(region.x, region.y, region.w, region.h);
      return s;
    }
    s = this.free.pop();
    if (!s) {
      const c = new OffscreenCanvas(this.width, this.height);
      s = { c, x: c.getContext('2d')! };
      this.all.push(s);
    }
    s.x.setTransform(1, 0, 0, 1, 0, 0);
    s.x.globalAlpha = 1;
    s.x.globalCompositeOperation = 'source-over';
    s.x.clearRect(0, 0, this.width, this.height);
    return s;
  }

  put(s: Surf): void {
    if (!s.local) { this.free.push(s); return; }
    this.freeLocal.push(s);
    if (this.freeLocal.length > 8) {
      const old = this.freeLocal.shift()!;
      old.c.width = 0;
      this.all.splice(this.all.indexOf(old), 1);
    }
  }

  dispose(): void {
    for (const s of this.all) s.c.width = 0;
    this.all = [];
    this.free = [];
    this.freeLocal = [];
  }
}

export interface TreeHooks<T extends TreeItem> {
  /** Pixels of a leaf; null draws nothing. */
  image(l: T): CanvasImageSource | null;
  /** Mask of an entry as a canvas whose alpha is the mask value; null when it has none or it is off. */
  mask(l: T): CanvasImageSource | null;
  /** False while something the entry needs is still decoding: the entry is skipped. */
  ready?(l: T): boolean;
}

/** A tool preview drawn over the active layer's pixels before its mask and clips apply. */
export interface TreeLive {
  active: string;
  draw(ctx: Ctx): void;
}

/** True when the list holds a group or an applied mask, so the plain per-layer loop is not enough. */
export function hasTree(items: readonly { group?: boolean; mask?: unknown; maskOn?: boolean }[]): boolean {
  for (const l of items) if (l.group || (l.mask && l.maskOn !== false)) return true;
  return false;
}

function useOp(l: TreeItem, op: GlobalCompositeOperation): GlobalCompositeOperation {
  return l.blend === 'normal' || l.blend === 'passthrough' ? op : BLEND_OP[l.blend];
}

/** Draws the entries onto ctx; the caller's globalAlpha and composite operation act as the base (a Flipbook row, a member). */
export function drawTree<T extends TreeItem>(
  ctx: Ctx, items: readonly T[], w: number, h: number, hooks: TreeHooks<T>, pool: SurfacePool, live?: TreeLive, region?: Rect,
): void {
  const baseAlpha = ctx.globalAlpha, baseOp = ctx.globalCompositeOperation;
  // Only this part of the picture is drawn (a dirty repaint): every copy below is limited to it.
  const R: Rect = region ?? { x: 0, y: 0, w, h };
  const put = (dst: Ctx, src: CanvasImageSource): void => {
    if (localCanvases.has(src)) { dst.drawImage(src, 0, 0, R.w, R.h, R.x, R.y, R.w, R.h); return; }
    const sw = (src as { width: number }).width || w, sh = (src as { height: number }).height || h;
    const kx = sw / w, ky = sh / h;
    dst.drawImage(src, R.x * kx, R.y * ky, R.w * kx, R.h * ky, R.x, R.y, R.w, R.h);
  };
  // Modes the canvas lacks are blended per pixel over the region; any other mode keeps dst's alpha and operation.
  const putBlend = (dst: Ctx, src: CanvasImageSource, mode: BlendMode, a: number): void => {
    if (!isPixelBlend(mode)) { put(dst, src); return; }
    const m = dst.getTransform();
    if (m.a === 1 && m.d === 1 && m.b === 0 && m.c === 0) {
      const t = pool.get(R);
      put(t.x, src);
      const tm = t.x.getTransform();
      blendRect(dst, R.x + m.e, R.y + m.f, t.x, R.x + tm.e, R.y + tm.f, R.w, R.h, mode, a);
      pool.put(t);
      return;
    }
    // a scaled target (the Stage draws at view size): draw through its transform, then blend the whole canvas
    const cw = dst.canvas.width, ch = dst.canvas.height;
    const tmp = (scaledScratch ??= new OffscreenCanvas(cw, ch));
    if (tmp.width !== cw || tmp.height !== ch) { tmp.width = cw; tmp.height = ch; }
    const tx = tmp.getContext('2d')!;
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.clearRect(0, 0, cw, ch);
    tx.setTransform(m);
    put(tx, src);
    blendCanvasOnto(dst, tmp, mode, a);
  };
  const ids = new Set<string>();
  for (const l of items) ids.add(l.id);
  const kids = new Map<string | null, T[]>();
  const byId = new Map<string, T>();
  for (const l of items) {
    byId.set(l.id, l);
    const p = l.parent && ids.has(l.parent) && l.parent !== l.id ? l.parent : null;
    const list = kids.get(p);
    if (list) list.push(l); else kids.set(p, [l]);
  }
  // groups on the way from the live layer to the top: a preview forces them to isolate
  const liveChain = new Set<string>();
  if (live) {
    let n = byId.get(live.active);
    for (let guard = 0; n && guard < 64; guard++) {
      liveChain.add(n.id);
      n = n.parent ? byId.get(n.parent) : undefined;
    }
  }

  const ok = (l: T): boolean => (hooks.ready ? hooks.ready(l) : true);

  const clipOnto = (s: Surf, c: T): void => {
    const img = hooks.image(c);
    if (!img || !ok(c)) return;
    const m = hooks.mask(c);
    let src: CanvasImageSource = img;
    let tmp: Surf | null = null;
    if (m) {
      tmp = pool.get(R);
      put(tmp.x, img);
      tmp.x.globalCompositeOperation = 'destination-in';
      put(tmp.x, m);
      tmp.x.globalCompositeOperation = 'source-over';
      src = tmp.c;
    }
    const x = s.x;
    if (c.blend === 'normal' || c.blend === 'passthrough') {
      x.globalAlpha = c.opacity;
      x.globalCompositeOperation = 'source-atop';
      put(x, src);
    } else {
      // Blend into a copy, then lay that copy over the base only where the base has alpha.
      const s2 = pool.get(R);
      put(s2.x, s.c);
      s2.x.globalAlpha = c.opacity;
      s2.x.globalCompositeOperation = BLEND_OP[c.blend];
      putBlend(s2.x, src, c.blend, c.opacity);
      s2.x.globalAlpha = 1;
      s2.x.globalCompositeOperation = 'source-over';
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-atop';
      put(x, s2.c);
      pool.put(s2);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    if (tmp) pool.put(tmp);
  };

  const level = (cx: Ctx, parent: string | null, alpha: number, op: GlobalCompositeOperation): void => {
    const L = kids.get(parent);
    if (!L) return;
    let i = L.length - 1;
    while (i >= 0) {
      const b = L[i];
      let j = i - 1;
      while (j >= 0 && L[j].clipping && !L[j].group) j--;
      const next = j;
      if (b.visible && b.opacity > 0 || b.visible && b.group) {
        const clipped: T[] = [];
        for (let k = i - 1; k > j; k--) if (L[k].visible && !L[k].group) clipped.push(L[k]);   // lowest first
        const mask = ok(b) ? hooks.mask(b) : null;
        const a = alpha * b.opacity;
        const bop = useOp(b, op);
        const hasLive = !!live && (liveChain.has(b.id) || clipped.some((c) => c.id === live.active));
        if (b.group) {
          if (b.blend === 'passthrough' && b.opacity >= 0.999 && !mask && !clipped.length) {
            level(cx, b.id, alpha, op);
          } else if (ok(b)) {
            const s = pool.get(R);
            level(s.x, b.id, 1, 'source-over');
            finish(cx, s, b, clipped, mask, a, bop);
          }
        } else if (b.opacity > 0 || hasLive) {
          const img = hooks.image(b);
          if (img && ok(b)) {
            if (!clipped.length && !mask && !hasLive) {
              cx.globalAlpha = a;
              cx.globalCompositeOperation = bop;
              putBlend(cx, img, b.blend, a);
            } else {
              const s = pool.get(R);
              put(s.x, img);
              finish(cx, s, b, clipped, mask, a, bop);
            }
          }
        }
      }
      i = next;
    }
    cx.globalAlpha = alpha;
    cx.globalCompositeOperation = op;
  };

  // The entry's own content is in s; add the preview, the clipped layers and the mask, lay s over cx, release s.
  const finish = (cx: Ctx, s: Surf, b: T, clipped: T[], mask: CanvasImageSource | null, a: number, bop: GlobalCompositeOperation): void => {
    if (live && !b.group && b.id === live.active) live.draw(s.x);
    for (const c of clipped) {
      clipOnto(s, c);
      if (live && c.id === live.active) live.draw(s.x);
    }
    if (mask) {
      s.x.globalAlpha = 1;
      s.x.globalCompositeOperation = 'destination-in';
      put(s.x, mask);
      s.x.globalCompositeOperation = 'source-over';
    }
    cx.globalAlpha = a;
    cx.globalCompositeOperation = bop;
    putBlend(cx, s.c, b.blend, a);
    pool.put(s);
  };

  level(ctx, null, baseAlpha, baseOp);
  ctx.globalAlpha = baseAlpha;
  ctx.globalCompositeOperation = baseOp;
}

const alphaOfBitmap = new WeakMap<object, OffscreenCanvas>();

/** A greyscale mask picture as a canvas whose alpha is the grey value (the renderer's mask source). */
export function maskAlphaCanvas(src: ImageBitmap): OffscreenCanvas {
  const have = alphaOfBitmap.get(src);
  if (have) return have;
  const c = new OffscreenCanvas(src.width, src.height);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) { d[p + 3] = d[p]; d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; }
  x.putImageData(img, 0, 0);
  alphaOfBitmap.set(src, c);
  return c;
}

// ---- list structure (pure, on any entries with id / parent / group) ----

export interface Node { id: string; parent?: string | null; group?: boolean }

/** Index one past the last descendant of the entry at `i` (the entry's block is i .. result - 1). */
export function blockEnd(list: readonly Node[], i: number): number {
  const id = list[i].id;
  if (!list[i].group) return i + 1;
  const inside = new Set<string>([id]);
  let k = i + 1;
  while (k < list.length && list[k].parent && inside.has(list[k].parent!)) { inside.add(list[k].id); k++; }
  return k;
}

/** Nesting depth of the entry (0 at the top). */
export function depthOf(list: readonly Node[], id: string): number {
  const by = new Map(list.map((l) => [l.id, l]));
  let d = 0;
  let n = by.get(id);
  while (n && n.parent && by.has(n.parent) && d < 64) { d++; n = by.get(n.parent); }
  return d;
}

/** True when `id` is `ancestor` or sits inside it. */
export function isInside(list: readonly Node[], id: string, ancestor: string): boolean {
  const by = new Map(list.map((l) => [l.id, l]));
  let n = by.get(id);
  for (let g = 0; n && g < 64; g++) {
    if (n.id === ancestor) return true;
    n = n.parent ? by.get(n.parent) : undefined;
  }
  return false;
}

/** True when some ancestor of the entry is collapsed (its row is hidden in the panel). */
export function hiddenByFold(list: readonly (Node & { collapsed?: boolean })[], id: string): boolean {
  const by = new Map(list.map((l) => [l.id, l]));
  let n = by.get(id);
  n = n && n.parent ? by.get(n.parent) : undefined;
  for (let g = 0; n && g < 64; g++) {
    if (n.collapsed) return true;
    n = n.parent ? by.get(n.parent) : undefined;
  }
  return false;
}
