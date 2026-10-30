// Boil: a pure displacement of a raster by a smooth 2D value-noise field, as hand-redrawn lines wiggle.
// The field is a hash lattice (spacing `scale` px) with smoothstep blending; a seed picks one of the redraws.
// engine/gpu/shaders.ts (FS_BOIL) repeats the same hash and blending so both paths agree within rounding.
import type { Raster } from './types';

export interface BoilParams {
  /** Largest displacement in pixels. */
  amount: number;
  /** Lattice spacing of the field in pixels (feature size). */
  scale: number;
  /** Which redraw: any integer, each one a different field. */
  seed: number;
}

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Lattice value in 0..1 (24 bits, exact in float32). `ch` 0 is the x field, 1 the y field. */
export function boilHash(ix: number, iy: number, seed: number, ch: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed * 2 + ch + 1, 0x9e3779b1 | 0);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b | 0);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35 | 0);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/** The seed a frame uses: it cycles through `variations` seeds, changing every `rate` frames. */
export function boilSeed(local: number, rate: number, variations: number): number {
  const r = Math.max(1, Math.round(rate)), v = Math.max(1, Math.round(variations));
  const k = Math.floor(local / r);
  return ((k % v) + v) % v;
}

const T = 16;
let colW = new Int32Array(0);
let colF = new Float32Array(0);
let occ = new Uint8Array(0);
let dil = new Uint8Array(0);

/** Writes the displaced `src` into `dst` (same size, no aliasing); returns the box that can hold content, or null when `src` is empty. Only tiles near content are visited. */
export function boil(src: Raster, dst: Raster, p: BoilParams): Bounds | null {
  const { width: w, height: h } = src;
  dst.data.fill(0);
  // which 16 px tiles hold any alpha
  const tw = Math.ceil(w / T), th = Math.ceil(h / T);
  if (occ.length < tw * th) { occ = new Uint8Array(tw * th); dil = new Uint8Array(tw * th); }
  occ.fill(0, 0, tw * th);
  const px = new Uint32Array(src.data.buffer, src.data.byteOffset, w * h);
  let any = false;
  for (let y = 0; y < h; y++) {
    const o = y * w, tr = (y >> 4) * tw;
    for (let x = 0; x < w; x++) if (px[o + x] >>> 24) { occ[tr + (x >> 4)] = 1; any = true; x = (x | 15); }
  }
  if (!any) return null;
  if (!(p.amount > 0)) {
    dst.data.set(src.data);
    return { x0: 0, y0: 0, x1: w, y1: h };
  }
  const s = Math.max(2, p.scale);
  const m = Math.ceil(p.amount) + 1;
  const rad = Math.ceil(m / T);
  // tiles whose pixels can read from a tile with content
  let tx0 = tw, tx1 = -1, ty0 = th, ty1 = -1;
  dil.fill(0, 0, tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      if (!occ[ty * tw + tx]) continue;
      for (let j = Math.max(0, ty - rad); j <= Math.min(th - 1, ty + rad); j++) for (let i = Math.max(0, tx - rad); i <= Math.min(tw - 1, tx + rad); i++) dil[j * tw + i] = 1;
    }
  }
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) if (dil[ty * tw + tx]) { if (tx < tx0) tx0 = tx; if (tx > tx1) tx1 = tx; if (ty < ty0) ty0 = ty; if (ty > ty1) ty1 = ty; }
  const rx0 = tx0 * T, rx1 = Math.min(w, (tx1 + 1) * T), ry0 = ty0 * T, ry1 = Math.min(h, (ty1 + 1) * T);
  const lx0 = Math.floor(rx0 / s), lx1 = Math.floor((rx1 - 1) / s) + 1;
  const ly0 = Math.floor(ry0 / s), ly1 = Math.floor((ry1 - 1) / s) + 1;
  const gw = lx1 - lx0 + 1, gh = ly1 - ly0 + 1;
  const gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      gx[j * gw + i] = (boilHash(lx0 + i, ly0 + j, p.seed, 0) * 2 - 1) * p.amount;
      gy[j * gw + i] = (boilHash(lx0 + i, ly0 + j, p.seed, 1) * 2 - 1) * p.amount;
    }
  }
  // per column: lattice cell and smoothstep weight
  if (colW.length < w) { colW = new Int32Array(w); colF = new Float32Array(w); }
  for (let x = rx0; x < rx1; x++) {
    const u = x / s, i = Math.floor(u), f = u - i;
    colW[x] = i - lx0;
    colF[x] = f * f * (3 - 2 * f);
  }
  const sd = src.data, dd = dst.data;
  for (let ty = ty0; ty <= ty1; ty++) {
    const yEnd = Math.min(h, (ty + 1) * T);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!dil[ty * tw + tx]) continue;
      const xEnd = Math.min(w, (tx + 1) * T);
      for (let y = ty * T; y < yEnd; y++) {
        const v = y / s, j = Math.floor(v), fy0 = v - j, wy = fy0 * fy0 * (3 - 2 * fy0), jr = j - ly0;
        const row0 = jr * gw, row1 = (jr + 1) * gw;
        for (let x = tx * T; x < xEnd; x++) {
          const c = colW[x], wx = colF[x];
          const a0 = row0 + c, a1 = row1 + c;
          const tx0v = gx[a0] + (gx[a0 + 1] - gx[a0]) * wx, tx1v = gx[a1] + (gx[a1 + 1] - gx[a1]) * wx;
          const ty0v = gy[a0] + (gy[a0 + 1] - gy[a0]) * wx, ty1v = gy[a1] + (gy[a1 + 1] - gy[a1]) * wx;
          const sx = x + tx0v + (tx1v - tx0v) * wy, sy = y + ty0v + (ty1v - ty0v) * wy;
          const ix = Math.floor(sx), iy = Math.floor(sy);
          const fx = sx - ix, fy = sy - iy;
          const ox0 = ix >= 0 && ix < w, ox1 = ix + 1 >= 0 && ix + 1 < w;
          const oy0 = iy >= 0 && iy < h, oy1 = iy + 1 >= 0 && iy + 1 < h;
          // out-of-range taps read texel 0 with weight 0
          const p00 = oy0 && ox0 ? (iy * w + ix) * 4 : 0, p10 = oy0 && ox1 ? (iy * w + ix + 1) * 4 : 0;
          const p01 = oy1 && ox0 ? ((iy + 1) * w + ix) * 4 : 0, p11 = oy1 && ox1 ? ((iy + 1) * w + ix + 1) * 4 : 0;
          const a00 = oy0 && ox0 ? sd[p00 + 3] : 0, a10 = oy0 && ox1 ? sd[p10 + 3] : 0;
          const a01 = oy1 && ox0 ? sd[p01 + 3] : 0, a11 = oy1 && ox1 ? sd[p11 + 3] : 0;
          if ((a00 | a10 | a01 | a11) === 0) continue;
          const w00 = (1 - fx) * (1 - fy) * a00, w10 = fx * (1 - fy) * a10, w01 = (1 - fx) * fy * a01, w11 = fx * fy * a11;
          const wa = w00 + w10 + w01 + w11;
          const o = (y * w + x) * 4;
          const inv = 1 / wa;
          dd[o] = (sd[p00] * w00 + sd[p10] * w10 + sd[p01] * w01 + sd[p11] * w11) * inv + 0.5;
          dd[o + 1] = (sd[p00 + 1] * w00 + sd[p10 + 1] * w10 + sd[p01 + 1] * w01 + sd[p11 + 1] * w11) * inv + 0.5;
          dd[o + 2] = (sd[p00 + 2] * w00 + sd[p10 + 2] * w10 + sd[p01 + 2] * w01 + sd[p11 + 2] * w11) * inv + 0.5;
          dd[o + 3] = wa + 0.5;
        }
      }
    }
  }
  return { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
}
