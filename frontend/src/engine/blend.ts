// Blend modes the browser canvas has no operation for, composited per pixel (a surface pass) with the standard
// formula (W3C Compositing and Blending): the source over the backdrop, where the part of the source covering
// backdrop shows B(backdrop, source). Channels 0 to 1. engine/gpu/shaders.ts repeats the same maths. No DOM.

import type { BlendMode } from './types';

export const PIXEL_BLENDS: ReadonlySet<BlendMode> = new Set<BlendMode>(['linear-burn', 'darker-color', 'lighter-color', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'subtract', 'divide']);

export function isPixelBlend(m: BlendMode): boolean {
  return PIXEL_BLENDS.has(m);
}

const burn = (b: number, s: number): number => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
const dodge = (b: number, s: number): number => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

type Sep = (b: number, s: number) => number;
export const SEPARABLE: Partial<Record<BlendMode, Sep>> = {
  'linear-burn': (b, s) => clamp01(b + s - 1),
  'vivid-light': (b, s) => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * (s - 0.5))),
  'linear-light': (b, s) => clamp01(b + 2 * s - 1),
  'pin-light': (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  'hard-mix': (b, s) => (b + s >= 1 ? 1 : 0),
  subtract: (b, s) => clamp01(b - s),
  divide: (b, s) => (s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s)),
};

/** Blends `src` onto `dst` in place (both RGBA, same size) with `mode` at `opacity`. */
export function blendPixels(dst: Uint8ClampedArray, src: Uint8ClampedArray, mode: BlendMode, opacity: number): void {
  const sep = SEPARABLE[mode];
  const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;
  for (let i = 0; i < dst.length; i += 4) {
    const as = (src[i + 3] / 255) * opacity;
    if (as <= 0) continue;
    const ab = dst[i + 3] / 255;
    const sr = src[i] / 255, sg = src[i + 1] / 255, sb = src[i + 2] / 255;
    const br = dst[i] / 255, bg = dst[i + 1] / 255, bb = dst[i + 2] / 255;
    // canvas pixels are premultiplied in storage but read back straight; ab = 0 leaves the source as is
    let rr: number, rg: number, rb: number;
    if (sep) { rr = sep(br, sr); rg = sep(bg, sg); rb = sep(bb, sb); }
    else {
      const darker = lum(sr, sg, sb) < lum(br, bg, bb);
      const takeSource = mode === 'darker-color' ? darker : !darker;
      if (takeSource) { rr = sr; rg = sg; rb = sb; } else { rr = br; rg = bg; rb = bb; }
    }
    const ao = as + ab * (1 - as);
    if (ao <= 0) continue;
    const k1 = as * (1 - ab), k2 = as * ab, k3 = (1 - as) * ab;
    dst[i] = Math.round(((k1 * sr + k2 * rr + k3 * br) / ao) * 255);
    dst[i + 1] = Math.round(((k1 * sg + k2 * rg + k3 * bg) / ao) * 255);
    dst[i + 2] = Math.round(((k1 * sb + k2 * rb + k3 * bb) / ao) * 255);
    dst[i + 3] = Math.round(ao * 255);
  }
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

let scratch: OffscreenCanvas | null = null;

/** Blends the canvas `src` (identity placement at the origin, its own size; callers pass `dst`-sized surfaces) onto `dst` at `alpha`; the transform of `dst` is ignored. */
export function blendCanvasOnto(dst: Ctx, src: CanvasImageSource, mode: BlendMode, alpha: number): void {
  const w = dst.canvas.width, h = dst.canvas.height;
  if (w < 1 || h < 1 || alpha <= 0) return;
  if (!scratch) scratch = new OffscreenCanvas(w, h);
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const sx = scratch.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.globalAlpha = 1;
  sx.globalCompositeOperation = 'copy';
  // placed at its own size (identity), never stretched: a source of another size lines up at the origin
  sx.drawImage(src, 0, 0);
  sx.globalCompositeOperation = 'source-over';
  const a = sx.getImageData(0, 0, w, h);
  const b = dst.getImageData(0, 0, w, h);
  blendPixels(b.data, a.data, mode, alpha);
  dst.putImageData(b, 0, 0);
}

/** The same for a rectangle in device pixels of two contexts (layer groups repaint a dirty region). */
export function blendRect(dst: Ctx, dx: number, dy: number, src: Ctx, sx0: number, sy0: number, w: number, h: number, mode: BlendMode, alpha: number): void {
  if (w < 1 || h < 1 || alpha <= 0) return;
  const a = src.getImageData(sx0, sy0, w, h);
  const b = dst.getImageData(dx, dy, w, h);
  blendPixels(b.data, a.data, mode, alpha);
  dst.putImageData(b, dx, dy);
}
