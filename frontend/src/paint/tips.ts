// Procedural brush tips and the paper grain. Pure maths: no DOM.
// A tip is an N x N alpha map (0..255) of the dab at a bucketed diameter,
// roundness and angle; the stroke engine resamples it to the exact dab size.

import { memory } from '../platform/ipad-memory';
import type { TipImage, TipShape } from './types';

export interface Tip {
  /** Side of the square alpha map. */
  size: number;
  /** The diameter (long axis) the map was drawn at. */
  diameter: number;
  data: Uint8Array;
}

const MAX_TIP = 384;
/** Capped by bytes, not count: a brush that turns every dab (random angle, 3 degree buckets) misses a 96-entry cache each time and rebuilds a tip per dab. */
const CACHE_MIN = 96;
let cacheBytes = 0;
const ANGLE_STEP = 3;
const cache = new Map<string, Tip>();

function smooth(a: number, b: number, x: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Integer hash to 0..1. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise on an unbounded lattice. */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function bucketDiameter(d: number): number {
  const c = Math.min(MAX_TIP, Math.max(1, d));
  if (c <= 32) return Math.max(1, Math.round(c));
  return Math.min(MAX_TIP, Math.round(Math.pow(2, Math.round(Math.log2(c) * 12) / 12)));
}

export function bucketAngle(rad: number): number {
  const step = (ANGLE_STEP * Math.PI) / 180;
  const twoPi = Math.PI * 2;
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  return Math.round(a / step) * step;
}

export function bucketRoundness(r: number): number {
  return Math.min(1, Math.max(0.05, Math.round(r * 20) / 20));
}

export function getTip(shape: TipShape, diameter: number, softness: number, roundness: number, angle: number, image?: TipImage): Tip {
  const d = bucketDiameter(diameter);
  const soft = Math.round(Math.min(1, Math.max(0, softness)) * 20) / 20;
  const rn = bucketRoundness(roundness);
  const ang = bucketAngle(angle);
  const img = shape === 'sampled' ? image : undefined;
  const key = `${shape}${img ? ':' + img.key : ''}|${d}|${soft}|${rn}|${ang.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const tip = buildTip(shape, d, soft, rn, ang, img);
  cache.set(key, tip);
  cacheBytes += tip.data.byteLength;
  shedTips(memory.get('tipCache'));
  return tip;
}

function shedTips(cap: number): void {
  while (cache.size > CACHE_MIN && cacheBytes > cap) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cacheBytes -= cache.get(first)!.data.byteLength;
    cache.delete(first);
  }
}

if (memory.kind === 'ipad') memory.watch('tipCache', shedTips);

/** Bilinear coverage of a picture tip at fractional pixel (x, y); 0 outside. */
function sampleImage(im: TipImage, x: number, y: number): number {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= im.w || j >= im.h ? 0 : im.data[j * im.w + i]);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return (top + (bot - top) * fy) / 255;
}

function buildTip(shape: TipShape, d: number, soft: number, rn: number, ang: number, img?: TipImage): Tip {
  const n = Math.ceil(d) + 2;
  const data = new Uint8Array(n * n);
  const a = d / 2;
  const b = Math.max(0.6, a * rn);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const half = n / 2;
  const aaN = 1.1 / Math.max(0.8, Math.sqrt(a * b));
  const outer = 1 + aaN * 0.5;
  const w = Math.max(aaN, soft);
  const inner = outer - w;
  const bristles = Math.max(5, Math.min(44, Math.round(d / 2.6)));
  const cell = Math.max(2.2, d / 9);
  const toothCell = Math.max(1.4, d / 26);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i + 0.5 - half, y = j + 0.5 - half;
      const xr = x * cos + y * sin;
      const yr = -x * sin + y * cos;
      const u = xr / a, v = yr / b;
      const r = Math.sqrt(u * u + v * v);
      let alpha = 0;
      switch (shape) {
        case 'round':
          alpha = 1 - smooth(inner, outer, r);
          break;
        case 'square': {
          const s = Math.max(Math.abs(u), Math.abs(v));
          alpha = 1 - smooth(inner, outer, s);
          break;
        }
        case 'chisel': {
          const u2 = u * u, v2 = v * v;
          const s = Math.sqrt(Math.sqrt(u2 * u2 + v2 * v2));
          alpha = 1 - smooth(inner, outer, s);
          break;
        }
        case 'grain-round': {
          const env = 1 - smooth(inner, outer, r);
          if (env > 0) {
            const t = vnoise(xr / toothCell, yr / toothCell, 11) * 0.7 + vnoise(xr / (toothCell * 2.3), yr / (toothCell * 2.3), 12) * 0.3;
            alpha = env * (0.12 + 0.88 * smooth(0.34, 0.66, t));
          }
          break;
        }
        case 'speckle': {
          // A wide soft envelope so no hard disc edge shows through the scatter.
          const env = 1 - smooth(0.45, 1.02, r);
          if (env > 0) {
            const gx = xr / cell, gy = yr / cell;
            const cx0 = Math.floor(gx), cy0 = Math.floor(gy);
            let best = 0;
            for (let oy = -1; oy <= 1; oy++) {
              for (let ox = -1; ox <= 1; ox++) {
                const ci = cx0 + ox, cj = cy0 + oy;
                if (hash2(ci, cj, 21) > 0.58) continue;
                const px = ci + 0.2 + hash2(ci, cj, 22) * 0.6;
                const py = cj + 0.2 + hash2(ci, cj, 23) * 0.6;
                const rad = 0.16 + hash2(ci, cj, 24) * 0.22;
                const dist = Math.hypot(gx - px, gy - py);
                const cov = 1 - smooth(rad - 0.5 / cell, rad + 0.5 / cell, dist);
                if (cov > best) best = cov;
              }
            }
            alpha = best * env;
          }
          break;
        }
        case 'bristle': {
          const env = 1 - smooth(inner, outer, r);
          if (env > 0) {
            const fu = (u * 0.5 + 0.5) * bristles;
            const si = Math.min(bristles - 1, Math.max(0, Math.floor(fu)));
            const frac = fu - si;
            const dens = 0.45 + hash2(si, 3, 31) * 0.55;
            const stripe = smooth(0.05, 0.22, frac) * (1 - smooth(0.78, 0.95, frac));
            // Dry breaks along the bristle.
            const brk = vnoise(si * 7.1, v * (2.5 + hash2(si, 4, 32) * 3), 33);
            const on = smooth(dens - 0.3, dens - 0.05, 1 - brk + 0.15 * (1 - dens));
            alpha = env * stripe * (0.25 + 0.75 * on);
          }
          break;
        }
        case 'chalk': {
          const hf = vnoise(xr / 1.3, yr / 1.3, 41) * 0.6 + vnoise(xr / 3.1, yr / 3.1, 42) * 0.4;
          const th = Math.atan2(v, u);
          const edge = 1 - 0.1 * vnoise(th * 2.2 + 5, 0.5, 43) - 0.05 * vnoise(th * 6, 1.5, 44);
          const rr = r / edge;
          const t = hf - rr * 0.5 + 0.28 + (1 - soft) * 0.08;
          alpha = smooth(0.08, 0.34, t) * (1 - smooth(0.9, 1.05, rr));
          break;
        }
        case 'sponge': {
          const env = 1 - smooth(inner, outer, r);
          if (env > 0) {
            const c = Math.max(2, d / 6);
            const nz = vnoise(xr / c, yr / c, 51) * 0.6 + vnoise(xr / (c * 0.45), yr / (c * 0.45), 52) * 0.4;
            alpha = env * smooth(0.4, 0.54, nz);
          }
          break;
        }
        case 'ring':
          alpha = (1 - smooth(inner, outer, r)) * smooth(0.5, 0.68, r);
          break;
        case 'hatch': {
          const env = 1 - smooth(inner, outer, r);
          if (env > 0) {
            const k = Math.max(3, Math.round(d / 5));
            const f = (v * 0.5 + 0.5) * k;
            const fr = f - Math.floor(f);
            alpha = env * smooth(0.08, 0.22, fr) * (1 - smooth(0.5, 0.64, fr));
          }
          break;
        }
        case 'star': {
          const th = Math.atan2(v, u);
          const rr = 0.36 + 0.64 * Math.pow(Math.abs(Math.cos(2.5 * th)), 1.4);
          alpha = 1 - smooth(inner * rr, outer * rr + aaN * 0.3, r);
          break;
        }
        case 'leaf': {
          const hw = 1 - u * u;
          alpha = hw <= 0.001 ? 0 : 1 - smooth(inner, outer, Math.abs(v) / hw);
          break;
        }
        case 'splat': {
          const th = Math.atan2(v, u);
          const core = 1 - smooth(0.34, 0.46 + 0.06 * Math.sin(3 * th + 1), r);
          let best = core;
          for (let k = 0; k < 9; k++) {
            const pa = hash2(k, 1, 71) * Math.PI * 2, pd = 0.5 + hash2(k, 2, 72) * 0.42, pr = 0.04 + hash2(k, 3, 73) * 0.1;
            const dist = Math.hypot(u - Math.cos(pa) * pd, v - Math.sin(pa) * pd);
            const cov = 1 - smooth(pr - aaN, pr + aaN, dist);
            if (cov > best) best = cov;
          }
          alpha = best;
          break;
        }
        case 'fibre': {
          const env = 1 - smooth(inner, outer, r);
          if (env > 0) {
            const n2 = Math.max(10, Math.min(70, Math.round(d / 1.7)));
            const fu = (u * 0.5 + 0.5) * n2;
            const si = Math.min(n2 - 1, Math.max(0, Math.floor(fu)));
            const frac = fu - si;
            const stripe = smooth(0.1, 0.4, frac) * (1 - smooth(0.6, 0.9, frac));
            const brk = vnoise(si * 5.3, v * 1.6, 74);
            alpha = env * stripe * smooth(0.2, 0.5, brk + 0.25 * hash2(si, 5, 75));
          }
          break;
        }
        case 'dots': {
          const env = 1 - smooth(inner, outer, r);
          if (env > 0) {
            const c = Math.max(2.5, d / 6);
            const ca = 0.866, sa = 0.5;
            const gx = (xr * ca + yr * sa) / c, gy = (-xr * sa + yr * ca) / c;
            const dist = Math.hypot(gx - Math.round(gx), gy - Math.round(gy));
            alpha = env * (1 - smooth(0.26, 0.42, dist));
          }
          break;
        }
        case 'cross': {
          const s = Math.max(Math.abs(u), Math.abs(v));
          const arm = Math.min(Math.abs(u), Math.abs(v));
          alpha = (1 - smooth(inner, outer, s)) * (1 - smooth(0.12, 0.2, arm));
          break;
        }
        case 'grunge': {
          const c = Math.max(2, d / 5);
          const n1 = vnoise(xr / c, yr / c, 81) * 0.55 + vnoise(xr / (c * 0.4), yr / (c * 0.4), 82) * 0.45;
          const env = 1 - smooth(0.5, 1.0, r + (n1 - 0.5) * 0.7);
          alpha = env * smooth(0.32, 0.48, n1);
          break;
        }
        case 'pixel': {
          const c = Math.max(2, d / 8);
          const ci = Math.floor(xr / c), cj = Math.floor(yr / c);
          const inside = Math.max(Math.abs(u), Math.abs(v)) < 1 ? 1 : 0;
          alpha = hash2(ci, cj, 61) > 0.4 ? inside * (0.5 + 0.5 * hash2(ci, cj, 62)) : 0;
          break;
        }
        case 'comb': {
          const env = 1 - smooth(inner, outer, Math.max(Math.abs(u), Math.abs(v)));
          const t = (u * 0.5 + 0.5) * 5;
          const du = Math.abs(t - Math.floor(t) - 0.5);
          alpha = env * (1 - smooth(0.2, 0.34, du)) * (0.7 + 0.3 * hash2(Math.floor(t), 6, 76));
          break;
        }
        case 'blade': {
          const t = v * 0.5 + 0.5;
          const taper = Math.max(0, 1 - t * 0.95);
          let best = 0;
          for (let k = -1; k <= 1; k++) {
            const cu = k * 0.52 + Math.sin(t * 3 + k) * 0.06;
            const hw = 0.2 * taper;
            const cov = hw > 0.003 ? 1 - smooth(hw * 0.5, hw, Math.abs(u - cu)) : 0;
            if (cov > best) best = cov;
          }
          alpha = best * (1 - smooth(0.85, 1, Math.abs(v)));
          break;
        }
        case 'sampled': {
          if (!img) break;
          const wide = img.w >= img.h;
          const ix = wide ? (u * 0.5 + 0.5) * img.w : img.w / 2 + (u * img.h) / 2;
          const iy = wide ? img.h / 2 + (v * img.w) / 2 : (v * 0.5 + 0.5) * img.h;
          alpha = sampleImage(img, ix, iy);
          break;
        }
        case 'blob': {
          const th = Math.atan2(v, u);
          const rr = 0.8 + 0.1 * Math.sin(2 * th + 0.7) + 0.06 * Math.sin(3 * th + 2.1) + 0.04 * Math.sin(5 * th + 4.2);
          alpha = 1 - smooth(inner * rr, outer * rr + aaN * 0.3, r);
          break;
        }
      }
      data[j * n + i] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  return { size: n, diameter: d, data };
}

// ---- paper grain -----------------------------------------------------------

const GRAIN_TILE = 256;
const grainTables = new Map<number, Float32Array>();

function buildGrain(seed: number): Float32Array {
  const out = new Float32Array(GRAIN_TILE * GRAIN_TILE);
  const layers = [
    { cell: 2, w: 0.38 },
    { cell: 4, w: 0.32 },
    { cell: 8, w: 0.2 },
    { cell: 32, w: 0.1 },
  ];
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < GRAIN_TILE; y++) {
    for (let x = 0; x < GRAIN_TILE; x++) {
      let sum = 0;
      for (let li = 0; li < layers.length; li++) {
        const { cell, w } = layers[li];
        const per = GRAIN_TILE / cell;
        const fx = x / cell, fy = y / cell;
        const xi = Math.floor(fx), yi = Math.floor(fy);
        const tx = fx - xi, ty = fy - yi;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const x0 = xi % per, x1 = (xi + 1) % per, y0 = yi % per, y1 = (yi + 1) % per;
        const s = seed + li * 97;
        const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), dd = hash2(x1, y1, s);
        sum += w * (a + (b - a) * sx + (c - a) * sy + (a - b - c + dd) * sx * sy);
      }
      out[y * GRAIN_TILE + x] = sum;
      if (sum < min) min = sum;
      if (sum > max) max = sum;
    }
  }
  const k = 1 / Math.max(1e-6, max - min);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) * k;
  return out;
}

/** Tileable paper grain in canvas space, 0..1, roughly centred on 0.5. */
export function grainAt(x: number, y: number, seed: number): number {
  const s = seed | 0;
  let t = grainTables.get(s);
  if (!t) {
    t = buildGrain(s);
    grainTables.set(s, t);
    if (grainTables.size > 6) {
      const first = grainTables.keys().next().value;
      if (first !== undefined) grainTables.delete(first);
    }
  }
  return t[((y | 0) & 255) * GRAIN_TILE + ((x | 0) & 255)];
}

/** The grain table for a seed, for hot loops that index it directly (256 x 256, row-major). */
export function grainTable(seed: number): Float32Array {
  grainAt(0, 0, seed);
  return grainTables.get(seed | 0)!;
}
