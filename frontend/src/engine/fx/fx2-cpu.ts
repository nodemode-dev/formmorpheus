// CPU kernels of the directional / radial blur and the chroma / luma keys. Pure: typed arrays only.
// Rasters are straight-alpha RGBA8. Every kernel mirrors its GLSL twin in fx2-glsl.ts tap for tap
// (texel centres, bilinear taps on premultiplied colour, transparent outside), so the GPU frame matches.
import type { Raster } from '../../paint/types';

let pm = new Float32Array(0);
let matte = new Float32Array(0);
let matte2 = new Float32Array(0);

export function premul(src: Raster): Float32Array {
  const n = src.width * src.height * 4;
  if (pm.length < n) pm = new Float32Array(n);
  const d = src.data;
  for (let i = 0; i < n; i += 4) {
    const a = d[i + 3] / 255;
    pm[i] = (d[i] / 255) * a;
    pm[i + 1] = (d[i + 1] / 255) * a;
    pm[i + 2] = (d[i + 2] / 255) * a;
    pm[i + 3] = a;
  }
  return pm;
}

/** Bilinear tap at continuous position (px, py) in pixel units, texel centres at +0.5; adds weight w into acc. */
export function tap(p: Float32Array, w: number, h: number, x: number, y: number, acc: Float32Array): void {
  const fx = x - 0.5, fy = y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= h) continue;
    const wy = j ? ty : 1 - ty;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= w) continue;
      const k = wy * (i ? tx : 1 - tx);
      const o = (yy * w + xx) * 4;
      acc[0] += p[o] * k;
      acc[1] += p[o + 1] * k;
      acc[2] += p[o + 2] * k;
      acc[3] += p[o + 3] * k;
    }
  }
}

export function store(dst: Raster, o: number, acc: Float32Array, inv: number): void {
  const a = acc[3] * inv;
  const d = dst.data;
  if (a <= 1e-6) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; return; }
  const k = 255 * inv / a;
  d[o] = acc[0] * k + 0.5;
  d[o + 1] = acc[1] * k + 0.5;
  d[o + 2] = acc[2] * k + 0.5;
  d[o + 3] = a * 255 + 0.5;
}

/** Blur along a line through each pixel: `dist` px long, centred, `taps` samples. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/** `shift` moves the line: 0 centred, 0.5 trailing from the pixel, -0.5 leading. */
export function directionalBlurCpu(src: Raster, dst: Raster, angleDeg: number, dist: number, taps: number, shift: number, box: Box): void {
  const { width: w, height: h } = src;
  const p = premul(src);
  const th = (angleDeg * Math.PI) / 180, dx = Math.cos(th) * dist, dy = -Math.sin(th) * dist;
  const n = Math.max(1, Math.round(taps));
  const acc = new Float32Array(4);
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      acc.fill(0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5 + shift;
        tap(p, w, h, x + 0.5 + dx * t, y + 0.5 + dy * t, acc);
      }
      store(dst, (y * w + x) * 4, acc, 1 / n);
    }
  }
}

/** Spin (amount in degrees) or zoom (amount in percent of the radius) about (cx, cy) in pixels. */
export function radialBlurCpu(src: Raster, dst: Raster, zoom: boolean, amount: number, cx: number, cy: number, taps: number, box: Box): void {
  const { width: w, height: h } = src;
  const p = premul(src);
  const n = Math.max(1, Math.round(taps));
  const acc = new Float32Array(4);
  const rad = (amount * Math.PI) / 180, k = amount / 100;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      acc.fill(0);
      const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        if (zoom) {
          const s = 1 + k * t;
          tap(p, w, h, cx + vx * s, cy + vy * s, acc);
        } else {
          const a = rad * t, c = Math.cos(a), sn = Math.sin(a);
          tap(p, w, h, cx + vx * c - vy * sn, cy + vx * sn + vy * c, acc);
        }
      }
      store(dst, (y * w + x) * 4, acc, 1 / n);
    }
  }
}

export interface KeyParams {
  r: number; g: number; b: number;
  tolerance: number; softness: number; spill: number; choke: number;
  view: boolean;
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

const cb = (r: number, g: number, b: number): number => -0.168736 * r - 0.331264 * g + 0.5 * b;
const cr = (r: number, g: number, b: number): number => 0.5 * r - 0.418688 * g - 0.081312 * b;

/** Distance of the straight colour's chroma from the key's chroma. */
export function chromaDistance(r: number, g: number, b: number, kr: number, kg: number, kb: number): number {
  return Math.hypot(cb(r, g, b) - cb(kr, kg, kb), cr(r, g, b) - cr(kr, kg, kb));
}

function erode(m: Float32Array, tmp: Float32Array, w: number, h: number, r: number, grow: boolean): void {
  // separable square min (choke) or max (spread), radius r px
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        const q = m[y * w + xx];
        v = grow ? Math.max(v, q) : Math.min(v, q);
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        const q = tmp[yy * w + x];
        v = grow ? Math.max(v, q) : Math.min(v, q);
      }
      m[y * w + x] = v;
    }
  }
}

export function chromaKeyCpu(src: Raster, dst: Raster, p: KeyParams): void {
  const { width: w, height: h } = src;
  const n = w * h;
  if (matte.length < n) { matte = new Float32Array(n); matte2 = new Float32Array(n); }
  const d = src.data;
  const kcb = cb(p.r, p.g, p.b), kcr = cr(p.r, p.g, p.b);
  const thr = p.tolerance * 0.6, soft = Math.max(0.0005, p.softness * 0.6);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dd = Math.hypot(cb(d[o] / 255, d[o + 1] / 255, d[o + 2] / 255) - kcb, cr(d[o] / 255, d[o + 1] / 255, d[o + 2] / 255) - kcr);
    matte[i] = sstep(thr, thr + soft, dd);
  }
  const rr = Math.round(Math.abs(p.choke));
  if (rr > 0) erode(matte, matte2, w, h, Math.min(8, rr), p.choke < 0);
  const kl = Math.hypot(kcb, kcr) || 1, ux = kcb / kl, uy = kcr / kl;
  for (let i = 0; i < n; i++) {
    const o = i * 4, m = matte[i];
    if (p.view) {
      const v = m * 255 * (d[o + 3] / 255) + 0.5;
      dst.data[o] = dst.data[o + 1] = dst.data[o + 2] = v;
      dst.data[o + 3] = 255;
      continue;
    }
    let r = d[o] / 255, g = d[o + 1] / 255, b = d[o + 2] / 255;
    if (p.spill > 0) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const u = cb(r, g, b), v = cr(r, g, b);
      const dot = u * ux + v * uy;
      if (dot > 0) {
        // soft-edge pixels carry the most backdrop colour: spill grows to full strength as the matte falls
        const s = dot * (p.spill + (1 - p.spill) * (1 - m));
        const u2 = u - ux * s, v2 = v - uy * s;
        r = y + 1.402 * v2; g = y - 0.344136 * u2 - 0.714136 * v2; b = y + 1.772 * u2;
      }
    }
    dst.data[o] = Math.min(255, Math.max(0, r * 255 + 0.5));
    dst.data[o + 1] = Math.min(255, Math.max(0, g * 255 + 0.5));
    dst.data[o + 2] = Math.min(255, Math.max(0, b * 255 + 0.5));
    dst.data[o + 3] = d[o + 3] * m + 0.5;
  }
}

export interface LumaParams { threshold: number; softness: number; invert: boolean }

export function lumaKeyCpu(src: Raster, dst: Raster, p: LumaParams): void {
  const n = src.width * src.height, d = src.data;
  const soft = Math.max(0.0005, p.softness);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const l = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
    let m = sstep(p.threshold - soft / 2, p.threshold + soft / 2, l);
    if (p.invert) m = 1 - m;
    dst.data[o] = d[o]; dst.data[o + 1] = d[o + 1]; dst.data[o + 2] = d[o + 2];
    dst.data[o + 3] = d[o + 3] * m + 0.5;
  }
}
