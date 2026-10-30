// Filter maths shared by Draw & Paint adjustments (destructive, on a layer) and Keyframe
// live filters (per frame, on a rendered surface). Pure: typed arrays only, no DOM.
//
// Conventions: Rasters are straight-alpha RGBA8. Blurs run on premultiplied float
// buffers so transparent edges do not darken. Every filter writes into `dst` and
// returns it; only pixels inside `rect` (default: the whole image, clamped) are
// written, and blurs read only from inside `rect`. Outside `rect` dst is untouched.

import type { Raster, Rect } from './types';

// ---------------------------------------------------------------- scratch pool

const f32Pool = new Map<string, Float32Array>();
const f64Pool = new Map<string, Float64Array>();
const rasterPool = new Map<string, Raster>();

/** Grow-only Float32Array per slot name; contents are not cleared. */
export function scratchF32(slot: string, n: number): Float32Array {
  let a = f32Pool.get(slot);
  if (!a || a.length < n) { a = new Float32Array(n); f32Pool.set(slot, a); }
  return a;
}

function scratchF64(slot: string, n: number): Float64Array {
  let a = f64Pool.get(slot);
  if (!a || a.length < n) { a = new Float64Array(n); f64Pool.set(slot, a); }
  return a;
}

/** A pooled Raster of exactly w x h (reallocated only when the size changes). */
export function scratchRaster(slot: string, w: number, h: number): Raster {
  let r = rasterPool.get(slot);
  if (!r || r.width !== w || r.height !== h) {
    r = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    rasterPool.set(slot, r);
  }
  return r;
}

/** Drop all pooled buffers (call when a document closes). */
export function releaseScratch(): void {
  f32Pool.clear(); f64Pool.clear(); rasterPool.clear();
}

// ---------------------------------------------------------------- helpers

function clampRect(r: Raster, rect?: Rect): Rect {
  if (!rect) return { x: 0, y: 0, w: r.width, h: r.height };
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(r.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(r.height, Math.ceil(rect.y + rect.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function copyRegion(src: Raster, dst: Raster, q: Rect): void {
  if (src === dst) return;
  const sw = src.width * 4;
  for (let y = q.y; y < q.y + q.h; y++) {
    const o = y * sw + q.x * 4;
    dst.data.set(src.data.subarray(o, o + q.w * 4), o);
  }
}

/** Straight RGBA8 region to premultiplied float RGBA (colour 0..255 scaled by alpha). */
function loadPremult(src: Raster, q: Rect, out: Float32Array, boost = 0, boostPow = 1): void {
  const s = src.data, sw = src.width;
  const lut = new Float32Array(256);
  if (boost > 0) for (let i = 0; i < 256; i++) lut[i] = 1 + boost * Math.pow(i / 255, boostPow);
  let o = 0;
  for (let y = q.y; y < q.y + q.h; y++) {
    let i = (y * sw + q.x) * 4;
    for (let x = 0; x < q.w; x++, i += 4, o += 4) {
      const a = s[i + 3];
      if (a === 0) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; continue; }
      let k = a / 255;
      if (boost > 0) {
        k *= lut[(0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2]) | 0];
      }
      out[o] = s[i] * k; out[o + 1] = s[i + 1] * k; out[o + 2] = s[i + 2] * k; out[o + 3] = a;
    }
  }
}

/** Premultiplied float region back to straight RGBA8 (clamping on store). */
function storeStraight(buf: Float32Array, q: Rect, dst: Raster): void {
  const d = dst.data, dw = dst.width;
  let o = 0;
  for (let y = q.y; y < q.y + q.h; y++) {
    let i = (y * dw + q.x) * 4;
    for (let x = 0; x < q.w; x++, i += 4, o += 4) {
      const a = buf[o + 3];
      if (a < 0.5) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0; continue; }
      const k = 255 / a;
      d[i] = buf[o] * k; d[i + 1] = buf[o + 1] * k; d[i + 2] = buf[o + 2] * k; d[i + 3] = a;
    }
  }
}

// ---------------------------------------------------------------- box passes (zero padded, O(1) per pixel)

/** Horizontal box of half-width r; samples outside the row count as zero. */
function boxH(a: Float32Array, b: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const init = Math.min(r, w - 1);
  for (let y = 0; y < h; y++) {
    const base = y * w * 4;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i <= init; i++) {
      const p = base + i * 4;
      s0 += a[p]; s1 += a[p + 1]; s2 += a[p + 2]; s3 += a[p + 3];
    }
    // Fast middle span where both the entering and leaving pixel exist.
    const mid0 = r, mid1 = w - r - 2;
    for (let x = 0; x < w; x++) {
      const o = base + x * 4;
      b[o] = s0 * inv; b[o + 1] = s1 * inv; b[o + 2] = s2 * inv; b[o + 3] = s3 * inv;
      if (x >= mid0 && x <= mid1) {
        const pi = o + (r + 1) * 4, po = o - r * 4;
        s0 += a[pi] - a[po]; s1 += a[pi + 1] - a[po + 1]; s2 += a[pi + 2] - a[po + 2]; s3 += a[pi + 3] - a[po + 3];
        continue;
      }
      const xi = x + r + 1;
      if (xi < w) { const p = base + xi * 4; s0 += a[p]; s1 += a[p + 1]; s2 += a[p + 2]; s3 += a[p + 3]; }
      const xo = x - r;
      if (xo >= 0) { const p = base + xo * 4; s0 -= a[p]; s1 -= a[p + 1]; s2 -= a[p + 2]; s3 -= a[p + 3]; }
    }
  }
}

/** Vertical box, row-wise with one accumulator per column so memory stays sequential. */
function boxV(a: Float32Array, b: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const rowLen = w * 4;
  const acc = scratchF64('acc', rowLen);
  acc.fill(0, 0, rowLen);
  const init = Math.min(r, h - 1);
  for (let y = 0; y <= init; y++) {
    const p = y * rowLen;
    for (let i = 0; i < rowLen; i++) acc[i] += a[p + i];
  }
  for (let y = 0; y < h; y++) {
    const o = y * rowLen;
    const yi = y + r + 1, yo = y - r;
    if (yi < h && yo >= 0) {
      const pi = yi * rowLen, po = yo * rowLen;
      for (let i = 0; i < rowLen; i++) {
        const v = acc[i];
        b[o + i] = v * inv;
        acc[i] = v + a[pi + i] - a[po + i];
      }
    } else {
      for (let i = 0; i < rowLen; i++) b[o + i] = acc[i] * inv;
      if (yi < h) { const p = yi * rowLen; for (let i = 0; i < rowLen; i++) acc[i] += a[p + i]; }
      if (yo >= 0) { const p = yo * rowLen; for (let i = 0; i < rowLen; i++) acc[i] -= a[p + i]; }
    }
  }
}

/** Box along the direction (dx, dy) in {-1,0,1}^2 with half-length r steps; exact, no interpolation. */
function boxLine(a: Float32Array, b: Float32Array, w: number, h: number, dx: number, dy: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const step = (dy * w + dx) * 4;
  const x0 = dx > 0 ? 0 : w - 1, y0 = dy > 0 ? 0 : h - 1;
  const walk = (sx: number, sy: number): void => {
    // Line length: steps until it leaves the image.
    let len = Infinity;
    if (dx > 0) len = Math.min(len, w - sx); else if (dx < 0) len = Math.min(len, sx + 1);
    if (dy > 0) len = Math.min(len, h - sy); else if (dy < 0) len = Math.min(len, sy + 1);
    const base = (sy * w + sx) * 4;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    const init = Math.min(r, len - 1);
    for (let i = 0; i <= init; i++) {
      const p = base + i * step;
      s0 += a[p]; s1 += a[p + 1]; s2 += a[p + 2]; s3 += a[p + 3];
    }
    for (let i = 0; i < len; i++) {
      const o = base + i * step;
      b[o] = s0 * inv; b[o + 1] = s1 * inv; b[o + 2] = s2 * inv; b[o + 3] = s3 * inv;
      const ii = i + r + 1;
      if (ii < len) { const p = base + ii * step; s0 += a[p]; s1 += a[p + 1]; s2 += a[p + 2]; s3 += a[p + 3]; }
      const io = i - r;
      if (io >= 0) { const p = base + io * step; s0 -= a[p]; s1 -= a[p + 1]; s2 -= a[p + 2]; s3 -= a[p + 3]; }
    }
  };
  if (dy !== 0) {
    for (let x = 0; x < w; x++) walk(x, y0);
    if (dx !== 0) for (let y = 0; y < h; y++) if (y !== y0) walk(x0, y);
  } else {
    for (let y = 0; y < h; y++) walk(x0, y);
  }
}

/** Box widths (as half-widths) whose triple pass approximates a Gaussian of the given sigma. */
function boxRadii(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.max(0, ((i < m ? wl : wu) - 1) >> 1));
  return out;
}

// ---------------------------------------------------------------- gaussian blur

/** Reduction used for big blurs: the blur is smooth, so it runs on a box-downsampled copy. */
function pickDown(sigma: number): number {
  if (sigma >= 24) return 4;
  if (sigma >= 6) return 2;
  return 1;
}

/** Downsample a premult region by integer factor f (box average); zero pads the ragged edge. */
function downPremult(a: Float32Array, w: number, h: number, f: number, out: Float32Array, ow: number, oh: number): void {
  const k = 1 / (f * f);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let j = 0; j < f; j++) {
        const yy = y * f + j;
        if (yy >= h) break;
        for (let i = 0; i < f; i++) {
          const xx = x * f + i;
          if (xx >= w) break;
          const p = (yy * w + xx) * 4;
          s0 += a[p]; s1 += a[p + 1]; s2 += a[p + 2]; s3 += a[p + 3];
        }
      }
      const o = (y * ow + x) * 4;
      out[o] = s0 * k; out[o + 1] = s1 * k; out[o + 2] = s2 * k; out[o + 3] = s3 * k;
    }
  }
}

/** Bilinear upsample of a premult buffer (sample centres aligned) into the full-size buffer. */
function upPremult(a: Float32Array, aw: number, ah: number, f: number, out: Float32Array, w: number, h: number): void {
  const xi = new Int32Array(w), xf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / f - 0.5;
    const x0 = Math.floor(sx);
    xf[x] = sx - x0;
    xi[x] = Math.min(aw - 1, Math.max(0, x0));
  }
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / f - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const ya = Math.min(ah - 1, Math.max(0, y0)), yb = Math.min(ah - 1, Math.max(0, y0 + 1));
    const ra = ya * aw * 4, rb = yb * aw * 4;
    let o = y * w * 4;
    for (let x = 0; x < w; x++, o += 4) {
      const x0 = xi[x], x1 = Math.min(aw - 1, x0 + (xf[x] > 0 ? 1 : 0));
      const fx = xf[x];
      const p00 = ra + x0 * 4, p01 = ra + x1 * 4, p10 = rb + x0 * 4, p11 = rb + x1 * 4;
      for (let c = 0; c < 4; c++) {
        const top = a[p00 + c] + (a[p01 + c] - a[p00 + c]) * fx;
        const bot = a[p10 + c] + (a[p11 + c] - a[p10 + c]) * fx;
        out[o + c] = top + (bot - top) * fy;
      }
    }
  }
}

/** Three H/V box passes on a premult buffer `a` (result back in `a`, `b` is scratch). */
function gaussPasses(a: Float32Array, b: Float32Array, w: number, h: number, sigma: number): void {
  const radii = boxRadii(sigma, sigma < 3 ? 2 : 3);
  for (const r of radii) {
    boxH(a, b, w, h, r);
    boxV(b, a, w, h, r);
  }
}

/** Gaussian blur; `radius` is the visible blur reach in pixels (sigma = radius / 2). */
export function gaussianBlur(src: Raster, dst: Raster, radius: number, rect?: Rect): Raster {
  const q = clampRect(src, rect);
  if (q.w === 0 || q.h === 0) return dst;
  const sigma = radius / 2;
  if (sigma < 0.3) { copyRegion(src, dst, q); return dst; }
  const n = q.w * q.h * 4;
  const A = scratchF32('ga', n), B = scratchF32('gb', n);
  loadPremult(src, q, A);
  const f = pickDown(sigma);
  if (f === 1) {
    gaussPasses(A, B, q.w, q.h, sigma);
    storeStraight(A, q, dst);
  } else {
    const ow = Math.ceil(q.w / f), oh = Math.ceil(q.h / f);
    const on = ow * oh * 4;
    const S = scratchF32('gs', on), T = scratchF32('gt', on);
    downPremult(A, q.w, q.h, f, S, ow, oh);
    gaussPasses(S, T, ow, oh, sigma / f);
    upPremult(S, ow, oh, f, A, q.w, q.h);
    storeStraight(A, q, dst);
  }
  return dst;
}

// ---------------------------------------------------------------- sharpen

/** Unsharp mask. `amount` 0..1 scales the detail added back, `radius` is the blur reach in px. */
export function sharpen(src: Raster, dst: Raster, amount: number, radius = 1.5, rect?: Rect): Raster {
  const q = clampRect(src, rect);
  if (q.w === 0 || q.h === 0) return dst;
  if (amount <= 0) { copyRegion(src, dst, q); return dst; }
  const tmp = scratchRaster('sharp', src.width, src.height);
  gaussianBlur(src, tmp, radius, q);
  const k = Math.min(1, amount) * 3;
  const s = src.data, b = tmp.data, d = dst.data, w = src.width;
  for (let y = q.y; y < q.y + q.h; y++) {
    let i = (y * w + q.x) * 4;
    for (let x = 0; x < q.w; x++, i += 4) {
      const a = s[i + 3];
      if (a === 0) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 0; continue; }
      d[i] = s[i] + (s[i] - b[i]) * k;
      d[i + 1] = s[i + 1] + (s[i + 1] - b[i + 1]) * k;
      d[i + 2] = s[i + 2] + (s[i + 2] - b[i + 2]) * k;
      d[i + 3] = a;
    }
  }
  return dst;
}

// ---------------------------------------------------------------- noise

export interface NoiseParams {
  style: 'clouds' | 'billows' | 'ridges';
  /** 0..1 strength. */
  amount: number;
  /** Feature size in pixels. */
  scale: number;
  /** 1..8 fBm layers. */
  octaves: number;
  /** 0..1 domain warp. */
  turbulence: number;
  offsetX: number;
  offsetY: number;
  /** Animates the field over time (z offset, 1 = one feature size). */
  travel: number;
  /** Add around mid grey instead of blending toward the noise. */
  additive: boolean;
  /** Separate field per colour channel. */
  multichannel: boolean;
}

// Gradient noise on a seeded permutation table, cached for the last seed.
const perm = new Uint8Array(512);
let permSeed = NaN;

function mix32(z: number): number {
  z = (z + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

function seedPerm(seed: number): void {
  if (seed === permSeed) return;
  permSeed = seed;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = mix32(seed | 0);
  for (let i = 255; i > 0; i--) {
    s = mix32(s);
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

// The 12 edge gradients (padded to 16) so a lookup replaces the branchy classic form.
const GX = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, -1, 0, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1]);
const GZ = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, -1, 1]);

function grad(h: number, x: number, y: number, z: number): number {
  const k = h & 15;
  return GX[k] * x + GY[k] * y + GZ[k] * z;
}

/** 3D gradient noise, about -1..1. */
function noise3(x: number, y: number, z: number): number {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx; y -= fy; z -= fz;
  const u = x * x * x * (x * (x * 6 - 15) + 10);
  const v = y * y * y * (y * (y * 6 - 15) + 10);
  const w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  const l0 = grad(perm[AA], x, y, z), l1 = grad(perm[BA], x1, y, z);
  const l2 = grad(perm[AB], x, y1, z), l3 = grad(perm[BB], x1, y1, z);
  const l4 = grad(perm[AA + 1], x, y, z1), l5 = grad(perm[BA + 1], x1, y, z1);
  const l6 = grad(perm[AB + 1], x, y1, z1), l7 = grad(perm[BB + 1], x1, y1, z1);
  const a0 = l0 + u * (l1 - l0), a1 = l2 + u * (l3 - l2);
  const b0 = l4 + u * (l5 - l4), b1 = l6 + u * (l7 - l6);
  const c0 = a0 + v * (a1 - a0), c1 = b0 + v * (b1 - b0);
  return c0 + w * (c1 - c0);
}

const STYLE_CLOUDS = 0, STYLE_BILLOWS = 1;

/** fBm value in 0..1 at a point. */
function fbm(x: number, y: number, z: number, octaves: number, style: number, norm: number): number {
  let sum = 0, amp = 1, fr = 1;
  for (let o = 0; o < octaves; o++) {
    let n = noise3(x * fr + o * 31.7, y * fr + o * 17.3, z * fr + o * 7.9) * 1.6;
    if (n > 1) n = 1; else if (n < -1) n = -1;
    if (style === STYLE_CLOUDS) sum += amp * n;
    else if (style === STYLE_BILLOWS) sum += amp * (n < 0 ? -n : n);
    else { const r = 1 - (n < 0 ? -n : n); sum += amp * r * r; }
    amp *= 0.5; fr *= 2;
  }
  sum *= norm;
  if (style === STYLE_CLOUDS) sum = sum * 0.5 + 0.5;
  return sum < 0 ? 0 : sum > 1 ? 1 : sum;
}

/** fBm noise laid over the image. Alpha is untouched. */
export function noise(src: Raster, dst: Raster, p: NoiseParams, seed: number, rect?: Rect): Raster {
  const q = clampRect(src, rect);
  if (q.w === 0 || q.h === 0) return dst;
  if (p.amount <= 0) { copyRegion(src, dst, q); return dst; }
  seedPerm(seed);
  const style = p.style === 'clouds' ? STYLE_CLOUDS : p.style === 'billows' ? STYLE_BILLOWS : 2;
  const scale = Math.max(1, p.scale);
  // Layers finer than about 4 px are barely visible (amplitude 1/16 or less) and cost the most, so they are dropped.
  const maxOct = Math.max(1, Math.floor(Math.log2(scale / 4)) + 1);
  const oct = Math.max(1, Math.min(8, Math.round(p.octaves), maxOct));
  let total = 0, amp = 1;
  for (let o = 0; o < oct; o++) { total += amp; amp *= 0.5; }
  const norm = 1 / total;
  const inv = 1 / scale;
  const warp = Math.max(0, Math.min(1, p.turbulence)) * 1.5;
  const amount = Math.min(1, p.amount);
  const z0 = p.travel;
  const s = src.data, d = dst.data, w = src.width;
  const chans = p.multichannel ? 3 : 1;

  // The field is evaluated on a coarse grid (step g, fine enough for the smallest layer)
  // and bilinearly filled in between.
  const finest = scale / (1 << (oct - 1));
  const g = Math.max(1, Math.min(8, Math.floor(finest / 2)));
  const gw = Math.ceil(q.w / g) + 1, gh = Math.ceil(q.h / g) + 1;
  const plane = gw * gh;
  const grid = scratchF32('noise', plane * chans);
  for (let c = 0; c < chans; c++) {
    const cz = z0 + c * 11.31;
    for (let gy = 0; gy < gh; gy++) {
      const cy = (q.y + gy * g + p.offsetY) * inv + c * 29.1;
      let o = c * plane + gy * gw;
      for (let gx = 0; gx < gw; gx++, o++) {
        const cx = (q.x + gx * g + p.offsetX) * inv + c * 53.7;
        let px = cx, py = cy;
        if (warp > 0) {
          px += warp * noise3(cx * 0.5 + 100, cy * 0.5, cz);
          py += warp * noise3(cx * 0.5, cy * 0.5 + 100, cz);
        }
        grid[o] = fbm(px, py, cz, oct, style, norm);
      }
    }
  }
  const add = p.additive, k2 = 2 * amount * 255;
  for (let y = 0; y < q.h; y++) {
    const gy = Math.floor(y / g), fy = (y - gy * g) / g;
    let i = ((q.y + y) * w + q.x) * 4;
    for (let x = 0; x < q.w; x++, i += 4) {
      const gx = Math.floor(x / g), fx = (x - gx * g) / g;
      for (let c = 0; c < 3; c++) {
        const base = (chans === 1 ? 0 : c * plane) + gy * gw + gx;
        const top = grid[base] + (grid[base + 1] - grid[base]) * fx;
        const bot = grid[base + gw] + (grid[base + gw + 1] - grid[base + gw]) * fx;
        const f = top + (bot - top) * fy;
        const o = s[i + c];
        d[i + c] = add ? o + (f - 0.5) * k2 : o + (f * 255 - o) * amount;
      }
      d[i + 3] = s[i + 3];
    }
  }
  return dst;
}

// ---------------------------------------------------------------- hue / saturation / brightness

/** Hue rotation (degrees), saturation and brightness (-1..1, 0 neutral). dst may equal src. */
export function hsb(src: Raster, dst: Raster, hue: number, saturation: number, brightness: number, rect?: Rect): Raster {
  const q = clampRect(src, rect);
  if (q.w === 0 || q.h === 0) return dst;
  if (hue === 0 && saturation === 0 && brightness === 0) { copyRegion(src, dst, q); return dst; }
  const t = (hue * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  const H = [
    0.213 + c * 0.787 - sn * 0.213, 0.715 - c * 0.715 - sn * 0.715, 0.072 - c * 0.072 + sn * 0.928,
    0.213 - c * 0.213 + sn * 0.143, 0.715 + c * 0.285 + sn * 0.140, 0.072 - c * 0.072 - sn * 0.283,
    0.213 - c * 0.213 - sn * 0.787, 0.715 - c * 0.715 + sn * 0.715, 0.072 + c * 0.928 + sn * 0.072,
  ];
  const sat = saturation < 0 ? 1 + saturation : 1 + 2 * saturation;
  const L = [0.2126, 0.7152, 0.0722];
  const S: number[] = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) S.push((r === k ? sat : 0) + (1 - sat) * L[k]);
  const M: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) M.push(H[r * 3] * S[k] + H[r * 3 + 1] * S[3 + k] + H[r * 3 + 2] * S[6 + k]);
  }
  const gain = brightness > 0 ? 1 - brightness : 1 + brightness;
  const off = brightness > 0 ? 255 * brightness : 0;
  for (let i = 0; i < 9; i++) M[i] *= gain;
  const s = src.data, d = dst.data, w = src.width;
  for (let y = q.y; y < q.y + q.h; y++) {
    let i = (y * w + q.x) * 4;
    for (let x = 0; x < q.w; x++, i += 4) {
      const r = s[i], g = s[i + 1], b = s[i + 2];
      d[i] = M[0] * r + M[1] * g + M[2] * b + off;
      d[i + 1] = M[3] * r + M[4] * g + M[5] * b + off;
      d[i + 2] = M[6] * r + M[7] * g + M[8] * b + off;
      d[i + 3] = s[i + 3];
    }
  }
  return dst;
}

// ---------------------------------------------------------------- lens blur

/**
 * Disc bokeh approximation: four exact line blurs (0, 90, 45, 135 degrees) whose
 * convolution is an octagon, after boosting highlights so bright points bloom into discs.
 * `brightness` 0..1 is the bloom strength, `contrast` 0..1 how selectively it picks highlights.
 */
export function lensBlur(src: Raster, dst: Raster, radius: number, brightness: number, contrast: number, rect?: Rect): Raster {
  const q = clampRect(src, rect);
  if (q.w === 0 || q.h === 0) return dst;
  if (radius < 0.5) { copyRegion(src, dst, q); return dst; }
  const n = q.w * q.h * 4;
  const A = scratchF32('la', n), B = scratchF32('lb', n);
  const boost = Math.max(0, Math.min(1, brightness)) * 6;
  const pw = 3 + Math.max(0, Math.min(1, contrast)) * 9;
  loadPremult(src, q, A, boost, pw);
  const f = radius >= 40 ? 4 : radius >= 6 ? 2 : 1;
  let w = q.w, h = q.h, a = A, b = B;
  let ow = 0, oh = 0;
  if (f > 1) {
    ow = Math.ceil(q.w / f); oh = Math.ceil(q.h / f);
    const S = scratchF32('ls', ow * oh * 4), T = scratchF32('lt', ow * oh * 4);
    downPremult(A, q.w, q.h, f, S, ow, oh);
    a = S; b = T; w = ow; h = oh;
  }
  const R = radius / f;
  const ax = Math.max(0, Math.round((R * 1.25) / 2.414));
  const dg = Math.max(0, Math.round(ax / 1.414));
  boxH(a, b, w, h, ax);
  boxV(b, a, w, h, ax);
  boxLine(a, b, w, h, 1, 1, dg);
  boxLine(b, a, w, h, 1, -1, dg);
  if (f > 1) upPremult(a, ow, oh, f, A, q.w, q.h);
  storeStraight(A, q, dst);
  return dst;
}

// ---------------------------------------------------------------- opacity

/** Scale alpha by `amount` (0..1). dst may equal src. */
export function opacity(src: Raster, dst: Raster, amount: number, rect?: Rect): Raster {
  const q = clampRect(src, rect);
  if (q.w === 0 || q.h === 0) return dst;
  const k = Math.max(0, Math.min(1, amount));
  const s = src.data, d = dst.data, w = src.width;
  for (let y = q.y; y < q.y + q.h; y++) {
    let i = (y * w + q.x) * 4;
    for (let x = 0; x < q.w; x++, i += 4) {
      if (s !== d) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; }
      d[i + 3] = s[i + 3] * k;
    }
  }
  return dst;
}

// ---------------------------------------------------------------- defaults

export const FILTER_DEFAULTS = {
  gaussianBlur: { radius: 0 },
  sharpen: { amount: 0, radius: 1.5 },
  noise: {
    style: 'clouds', amount: 0, scale: 64, octaves: 4, turbulence: 0,
    offsetX: 0, offsetY: 0, travel: 0, additive: false, multichannel: false, seed: 1,
  } as NoiseParams & { seed: number },
  hsb: { hue: 0, saturation: 0, brightness: 0 },
  lensBlur: { radius: 0, brightness: 0.4, contrast: 0.4 },
  opacity: { amount: 1 },
};
