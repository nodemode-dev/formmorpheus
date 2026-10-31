// The authored grain library: 56 seamless 512 px greyscale textures (paper tooth, cold press, canvas
// weave, charcoal, graphite, chalk, sponge, spatter, noise families, hatch, linen, concrete, wood,
// watercolour bloom, dry brush and more), generated from seeded noise, Worley cells, fBm, weave maths
// and stroke rasterising. Generated lazily, one grain at a time, and cached: no binary assets ship.
// Pure maths: no DOM. A value near 1 is raised tooth that holds pigment, near 0 is a pit.

import type { Brush } from './types';

export const GRAIN_SIDE = 512;
const N = GRAIN_SIDE;

// ---- seeded noise (all periodic on the unit square, so every tile is seamless) ---------------------

export function h2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};
export { sstep };

/** Periodic value noise with fx x fy cells per unit (integers). */
export function pvn(u: number, v: number, fx: number, fy: number, s: number): number {
  const x = u * fx, y = v * fy;
  const xi = Math.floor(x), yi = Math.floor(y);
  let tx = x - xi, ty = y - yi;
  tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const x0 = mod(xi, fx), y0 = mod(yi, fy);
  const x1 = x0 + 1 === fx ? 0 : x0 + 1, y1 = y0 + 1 === fy ? 0 : y0 + 1;
  const a = h2(x0, y0, s), b = h2(x1, y0, s), c = h2(x0, y1, s), d = h2(x1, y1, s);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal sum of pvn, 0..1. */
export function fbm(u: number, v: number, fx: number, fy: number, oct: number, s: number, gain = 0.5): number {
  let sum = 0, amp = 1, tot = 0, mx = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * pvn(u, v, fx * mx, fy * mx, s + o * 31);
    tot += amp; amp *= gain; mx *= 2;
  }
  return sum / tot;
}

/** Nearest-cell distances of periodic Worley noise, in cell units. */
export const WR = { f1: 0, f2: 0, id: 0 };
export function worley(u: number, v: number, f: number, s: number, jit = 1): void {
  const x = u * f, y = v * f;
  const ci = Math.floor(x), cj = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = ci + ox, gy = cj + oy;
      const wx = mod(gx, f), wy = mod(gy, f);
      const px = gx + 0.5 + (h2(wx, wy, s) - 0.5) * jit;
      const py = gy + 0.5 + (h2(wx, wy, s + 7) - 0.5) * jit;
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d < d1) { d2 = d1; d1 = d; id = h2(wx, wy, s + 13); } else if (d < d2) d2 = d;
    }
  }
  WR.f1 = Math.sqrt(d1); WR.f2 = Math.sqrt(d2); WR.id = id;
}

/** Coverage of random pits: each cell holds a pit with probability `prob` and radius `rad` (cell units). */
function pits(u: number, v: number, f: number, s: number, prob: number, rad: number): number {
  const x = u * f, y = v * f;
  const ci = Math.floor(x), cj = Math.floor(y);
  let best = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const wx = mod(ci + ox, f), wy = mod(cj + oy, f);
      if (h2(wx, wy, s) > prob) continue;
      const px = ci + ox + 0.15 + 0.7 * h2(wx, wy, s + 1), py = cj + oy + 0.15 + 0.7 * h2(wx, wy, s + 2);
      const r = rad * (0.5 + h2(wx, wy, s + 3));
      const c = 1 - sstep(r * 0.4, r, Math.hypot(x - px, y - py));
      if (c > best) best = c;
    }
  }
  return best;
}

// ---- stroke rasterising into a float buffer (wraps at the edges) -------------------------------

function dab(b: Float32Array, cx: number, cy: number, r: number, val: number, add: boolean): void {
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r) continue;
      const w = (1 - d / r);
      const i = mod(y, N) * N + mod(x, N);
      const nv = val * w * w * (3 - 2 * w);
      if (add) b[i] += nv; else if (nv > b[i]) b[i] = nv;
    }
  }
}
function line(b: Float32Array, x0: number, y0: number, x1: number, y1: number, r: number, val: number, add: boolean): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.6)));
  for (let i = 0; i <= n; i++) dab(b, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, val, add);
}
function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- weaves and patterns ------------------------------------------------------------------------

function weave(u: number, v: number, n: number, slub: number, s: number, twill: boolean, gap: number): number {
  const x = u * n, y = v * n;
  const i = Math.floor(x), j = Math.floor(y);
  const fu = x - i, fv = y - j;
  const pu = Math.pow(Math.sin(Math.PI * fu), 0.7), pv = Math.pow(Math.sin(Math.PI * fv), 0.7);
  const over = twill ? mod(i + j, 4) < 3 : ((i + j) & 1) === 0;
  const sv = 1 - slub * pvn(i / n, v, n, 7, s);
  const sh = 1 - slub * pvn(u, j / n, 7, n, s + 5);
  const val = over ? pu * (0.78 + 0.22 * pv) * sv : pv * (0.78 + 0.22 * pu) * sh;
  return gap > 0 ? val - gap * (1 - pu * pv) : val;
}

// ---- the library -----------------------------------------------------------------------------------

type Fill = (b: Float32Array) => void;
interface Def { id: string; name: string; group: string; std: number; fill: Fill }

const per = (fn: (u: number, v: number) => number): Fill => (b) => {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[y * N + x] = fn((x + 0.5) / N, (y + 0.5) / N);
};

const DEFS: Def[] = [];
function def(id: string, name: string, group: string, fill: Fill, std = 0.15): void { DEFS.push({ id, name, group, std, fill }); }

function fibres(b: Float32Array, count: number, minL: number, maxL: number, w: number, s: number, ang: number, spread: number): void {
  const r = rnd(s);
  for (let k = 0; k < count; k++) {
    const x = r() * N, y = r() * N, a = ang + (r() - 0.5) * spread, l = minL + r() * (maxL - minL);
    const cx = Math.cos(a), cy = Math.sin(a), bend = (r() - 0.5) * 0.6;
    const mx = x + cx * l * 0.5 - cy * l * bend, my = y + cy * l * 0.5 + cx * l * bend;
    line(b, x, y, mx, my, w, 0.35 + r() * 0.65, false);
    line(b, mx, my, x + cx * l, y + cy * l, w, 0.35 + r() * 0.65, false);
  }
}
function after(a: Fill, ...more: Fill[]): Fill { return (b) => { a(b); for (const m of more) m(b); }; }

// Paper
def('paper-fine', 'Fine paper', 'Paper', per((u, v) => fbm(u, v, 96, 96, 3, 1, 0.65)), 0.14);
def('paper-hot-press', 'Hot press', 'Paper', per((u, v) => fbm(u, v, 160, 160, 2, 2, 0.4)), 0.09);
def('paper-cold-press', 'Cold press', 'Paper', per((u, v) => {
  const wu = u + 0.02 * pvn(u, v, 6, 6, 3), wv = v + 0.02 * pvn(u, v, 6, 6, 4);
  worley(wu, wv, 26, 5);
  return 0.75 * (1 - Math.pow(Math.min(1, WR.f1 * 1.15), 1.6)) + 0.25 * fbm(u, v, 90, 90, 2, 6);
}), 0.16);
def('paper-rough', 'Rough paper', 'Paper', per((u, v) => {
  worley(u + 0.03 * pvn(u, v, 5, 5, 7), v + 0.03 * pvn(u, v, 5, 5, 8), 14, 9);
  const rid = 1 - Math.abs(2 * fbm(u, v, 12, 12, 4, 10) - 1);
  return 0.5 * (1 - WR.f1) + 0.5 * rid;
}), 0.17);
def('paper-laid', 'Laid paper', 'Paper', per((u, v) => {
  const lines = 0.5 + 0.5 * Math.sin(2 * Math.PI * v * 150);
  const chain = 0.5 + 0.5 * Math.cos(2 * Math.PI * u * 12);
  return 0.35 * lines + 0.15 * Math.pow(chain, 6) + 0.5 * fbm(u, v, 110, 110, 3, 11);
}), 0.13);
def('paper-fibre', 'Fibre paper', 'Paper', after(per((u, v) => 0.3 * fbm(u, v, 80, 80, 3, 12)), (b) => fibres(b, 1800, 10, 40, 0.9, 13, 0, 6.28)), 0.15);
def('paper-pastel', 'Pastel paper', 'Paper', per((u, v) => {
  worley(u, v, 118, 14, 1);
  return h2(Math.floor(u * 118), Math.floor(v * 118), 15) * 0.35 + 0.65 * (1 - Math.pow(WR.f1, 1.3)) * (0.5 + 0.5 * WR.id);
}), 0.18);
def('paper-newsprint', 'Newsprint', 'Paper', after(per((u, v) => fbm(u, v, 36, 36, 4, 16, 0.6) * 0.6 + 0.4 * pvn(u, v, 200, 200, 17)), (b) => fibres(b, 900, 14, 50, 0.8, 18, 0.2, 1.2)), 0.12);
def('paper-kraft', 'Kraft', 'Paper', after(per((u, v) => 0.4 * fbm(u, v, 14, 14, 4, 19) + 0.2 * pvn(u, v, 3, 130, 20)), (b) => fibres(b, 1500, 20, 70, 1.1, 21, 0, 1.5)), 0.15);

// Fabric
def('canvas-weave', 'Canvas weave', 'Fabric', per((u, v) => weave(u, v, 64, 0.25, 30, false, 0) * (0.85 + 0.3 * fbm(u, v, 30, 30, 2, 31))), 0.17);
def('canvas-coarse', 'Coarse canvas', 'Fabric', per((u, v) => weave(u, v, 32, 0.4, 32, false, 0.1) * (0.8 + 0.4 * fbm(u, v, 20, 20, 3, 33))), 0.19);
def('linen', 'Linen', 'Fabric', per((u, v) => weave(u, v, 96, 0.7, 34, false, 0) * (0.8 + 0.4 * pvn(u, v, 4, 4, 35))), 0.16);
def('burlap', 'Burlap', 'Fabric', per((u, v) => weave(u + 0.01 * pvn(u, v, 6, 6, 36), v + 0.01 * pvn(u, v, 6, 6, 37), 20, 0.5, 38, false, 0.55)), 0.22);
def('denim', 'Denim twill', 'Fabric', per((u, v) => weave(u, v, 96, 0.3, 39, true, 0) * (0.85 + 0.3 * fbm(u, v, 24, 24, 2, 40))), 0.16);
def('twill-coarse', 'Coarse twill', 'Fabric', per((u, v) => weave(u, v, 48, 0.2, 41, true, 0.05)), 0.18);
def('mesh', 'Screen mesh', 'Fabric', per((u, v) => {
  const gx = Math.pow(Math.abs(Math.sin(Math.PI * u * 48)), 0.5), gy = Math.pow(Math.abs(Math.sin(Math.PI * v * 48)), 0.5);
  return 1 - (1 - gx * 0.9) * (1 - gy * 0.9) * (0.9 + 0.2 * pvn(u, v, 20, 20, 42));
}), 0.2);

// Stone and surface
def('concrete', 'Concrete', 'Surface', per((u, v) => 0.55 * fbm(u, v, 8, 8, 5, 43, 0.55) + 0.25 * pvn(u, v, 140, 140, 44) - 0.45 * pits(u, v, 64, 45, 0.3, 0.34)), 0.17);
def('sandstone', 'Sandstone', 'Surface', per((u, v) => 0.5 * fbm(u, v, 120, 120, 3, 46, 0.6) + 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (v * 22 + 1.5 * pvn(u, v, 4, 4, 47)))) + 0.2 * fbm(u, v, 10, 10, 3, 48)), 0.15);
def('plaster', 'Plaster', 'Surface', per((u, v) => 0.5 * fbm(u, v, 5, 5, 3, 49) + 0.5 * pvn(u + 3 * v, v, 3, 70, 50) + 0.15 * pvn(u, v, 180, 180, 51)), 0.13);
def('stucco', 'Stucco', 'Surface', per((u, v) => { worley(u, v, 15, 52, 0.9); return 0.7 * (1 - WR.f1) + 0.3 * fbm(u, v, 60, 60, 3, 53); }), 0.17);
def('gravel', 'Gravel', 'Surface', per((u, v) => { worley(u, v, 22, 54, 0.85); return (0.3 + 0.7 * WR.id) * (0.45 + 0.55 * (1 - sstep(0.15, 0.7, WR.f1))) - 0.3 * sstep(0.05, 0.0, WR.f2 - WR.f1); }), 0.2);
def('cracked', 'Cracked earth', 'Surface', per((u, v) => {
  worley(u + 0.025 * pvn(u, v, 7, 7, 55), v + 0.025 * pvn(u, v, 7, 7, 56), 9, 57);
  const edge = sstep(0.0, 0.07, WR.f2 - WR.f1);
  return edge * (0.7 + 0.3 * fbm(u, v, 40, 40, 3, 58));
}), 0.2);
def('brushed-metal', 'Brushed metal', 'Surface', per((u, v) => 0.6 * pvn(u, v, 3, 420, 59) + 0.4 * pvn(u, v, 7, 190, 60)), 0.15);
def('hammered', 'Hammered metal', 'Surface', per((u, v) => { worley(u, v, 18, 61, 0.9); return 0.5 + 0.5 * Math.cos(Math.min(1, WR.f1 * 1.6) * Math.PI * 0.9) * 0.9 + 0.1 * fbm(u, v, 100, 100, 2, 62); }), 0.17);
def('leather', 'Leather', 'Surface', per((u, v) => {
  worley(u + 0.015 * pvn(u, v, 8, 8, 63), v + 0.015 * pvn(u, v, 8, 8, 64), 44, 65);
  return sstep(0.0, 0.16, WR.f2 - WR.f1) * (0.75 + 0.25 * WR.id) + 0.15 * fbm(u, v, 16, 16, 2, 66);
}), 0.19);
def('cork', 'Cork', 'Surface', per((u, v) => { worley(u, v, 34, 67, 1); return (0.35 + 0.65 * WR.id) * (1 - 0.5 * sstep(0.3, 0.8, WR.f1)) - 0.35 * pits(u, v, 90, 68, 0.2, 0.4); }), 0.19);
def('bark', 'Bark', 'Surface', per((u, v) => { const w = pvn(u, v, 5, 5, 69); return 1 - Math.abs(2 * fbm(u + 0.06 * w, v, 8, 2, 4, 70) - 1) * 0.9; }), 0.2);
def('wood-grain', 'Wood grain', 'Surface', per((u, v) => {
  const t = v * 12 + 2.2 * fbm(u, v, 2, 3, 3, 71) + 0.5 * pvn(u, v, 2, 12, 72);
  return 0.55 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t)) + 0.45 * pvn(u, v, 3, 260, 73);
}), 0.17);
def('wood-plank', 'Plank wood', 'Surface', per((u, v) => 0.45 * pvn(u, v, 2, 90, 74) + 0.35 * pvn(u, v, 6, 380, 75) + 0.2 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (v * 30 + 3 * fbm(u, v, 2, 4, 2, 76))))), 0.15);
def('marble', 'Marble veins', 'Surface', per((u, v) => {
  const t = 3 * u + 2 * v + 2.5 * fbm(u, v, 3, 3, 5, 77);
  return 1 - 0.8 * Math.pow(1 - Math.abs(Math.sin(Math.PI * t)), 5) + 0.1 * fbm(u, v, 50, 50, 2, 78);
}), 0.15);

// Drawing media
def('graphite-tooth', 'Graphite tooth', 'Media', per((u, v) => 0.55 * pvn(u + v, v, 230, 140, 79) + 0.45 * fbm(u, v, 130, 130, 3, 80, 0.55)), 0.15);
def('charcoal-grit', 'Charcoal grit', 'Media', per((u, v) => 0.6 * fbm(u, v, 22, 22, 3, 81, 0.6) + 0.4 * pvn(u, v, 190, 190, 82) - 0.2 * pits(u, v, 70, 83, 0.3, 0.4)), 0.2);
def('chalk-pits', 'Chalk pits', 'Media', per((u, v) => 0.5 * fbm(u, v, 56, 56, 3, 84, 0.6) + 0.35 * pvn(u, v, 170, 170, 85) - 0.5 * pits(u, v, 48, 86, 0.45, 0.45)), 0.2);
def('pastel-grit', 'Pastel grit', 'Media', per((u, v) => { worley(u, v, 84, 87, 1); return (0.25 + 0.75 * WR.id) * (1 - Math.pow(Math.min(1, WR.f1), 1.4)); }), 0.2);
def('crayon-wax', 'Crayon wax', 'Media', per((u, v) => 0.5 * pvn(u + 2 * v, v, 4, 80, 88) + 0.3 * pvn(u, v, 120, 120, 89) - 0.45 * pits(u, v, 70, 90, 0.25, 0.4) + 0.2 * fbm(u, v, 18, 18, 2, 91)), 0.17);
def('sponge', 'Sponge pores', 'Media', per((u, v) => {
  const wu = u + 0.03 * pvn(u, v, 5, 5, 92), wv = v + 0.03 * pvn(u, v, 5, 5, 93);
  worley(wu, wv, 12, 94); const a = WR.f1;
  worley(wu, wv, 30, 95); const c = WR.f1;
  return 0.6 * sstep(0.12, 0.62, a) + 0.4 * sstep(0.1, 0.6, c);
}), 0.22);
def('spatter', 'Spatter', 'Media', after(per(() => 0), (b) => {
  const r = rnd(96);
  for (let k = 0; k < 1500; k++) dab(b, r() * N, r() * N, 0.8 + Math.pow(r(), 3) * 9, 0.5 + r() * 0.5, false);
}), 0.22);
def('speckle-fine', 'Fine speckle', 'Media', after(per((u, v) => 0.2 * pvn(u, v, 90, 90, 97)), (b) => {
  const r = rnd(98);
  for (let k = 0; k < 7000; k++) dab(b, r() * N, r() * N, 0.7 + r() * 1.2, 0.4 + r() * 0.6, false);
}), 0.2);
def('stipple', 'Stipple dots', 'Media', per((u, v) => {
  const f = 80, x = u * f, y = v * f, i = Math.floor(x), j = Math.floor(y);
  const px = i + 0.5 + (h2(mod(i, f), mod(j, f), 99) - 0.5) * 0.6, py = j + 0.5 + (h2(mod(i, f), mod(j, f), 100) - 0.5) * 0.6;
  return 1 - sstep(0.2, 0.4, Math.hypot(x - px, y - py));
}), 0.25);
def('halftone', 'Halftone dots', 'Media', per((u, v) => {
  const n = 48, s = n * (u + v), t = n * (u - v);
  const a = Math.abs(s - Math.round(s)), c = Math.abs(t - Math.round(t));
  return 1 - sstep(0.22, 0.4, Math.hypot(a, c));
}), 0.3);
def('hatch-lines', 'Hatch lines', 'Media', per((u, v) => {
  const t = 70 * (u + v) + 1.2 * pvn(u, v, 6, 6, 101);
  return 1 - sstep(0.1, 0.4, Math.abs(t - Math.round(t)));
}), 0.3);
def('crosshatch', 'Crosshatch', 'Media', per((u, v) => {
  const a = 56 * (u + v) + pvn(u, v, 8, 8, 102), c = 56 * (u - v) + pvn(u, v, 8, 8, 103);
  return Math.max(1 - sstep(0.1, 0.35, Math.abs(a - Math.round(a))), 1 - sstep(0.1, 0.35, Math.abs(c - Math.round(c))));
}), 0.28);
def('watercolour-bloom', 'Watercolour bloom', 'Media', per((u, v) => {
  worley(u + 0.05 * fbm(u, v, 3, 3, 3, 104), v + 0.05 * fbm(u, v, 3, 3, 3, 105), 5, 106, 0.9);
  const rim = sstep(0.28, 0.62, WR.f1);
  return 0.45 * fbm(u, v, 4, 4, 5, 107, 0.55) + 0.4 * rim + 0.18 * pvn(u, v, 220, 220, 108);
}), 0.15);
def('dry-brush', 'Dry brush', 'Media', per((u, v) => {
  const row = Math.floor(v * 190);
  const lane = 0.35 + 0.65 * h2(row, 0, 109);
  const run = pvn(u, (row + 0.5) / 190, 4 + (row % 3), 190, 110);
  return sstep(0.25, 0.7, lane * (0.4 + 0.9 * run)) * (0.7 + 0.3 * pvn(u, v, 40, 190, 111));
}), 0.24);
def('bristle-drag', 'Bristle drag', 'Media', per((u, v) => {
  const row = Math.floor(v * 110);
  return 0.35 * h2(row, 1, 112) + 0.4 * pvn(u, (row + 0.5) / 110, 3, 110, 113) + 0.25 * pvn(u, v, 8, 110, 114);
}), 0.2);

// Noise families
def('noise-fine', 'Fine noise', 'Noise', per((u, v) => fbm(u, v, 170, 170, 2, 115, 0.5)), 0.15);
def('noise-medium', 'Medium noise', 'Noise', per((u, v) => fbm(u, v, 48, 48, 3, 116, 0.5)), 0.15);
def('noise-coarse', 'Coarse noise', 'Noise', per((u, v) => fbm(u, v, 14, 14, 2, 117, 0.5)), 0.15);
def('cloud', 'Cloud', 'Noise', per((u, v) => fbm(u, v, 4, 4, 6, 118, 0.58)), 0.16);
def('noise-ridged', 'Ridged noise', 'Noise', per((u, v) => 1 - Math.abs(2 * fbm(u, v, 6, 6, 5, 119, 0.55) - 1)), 0.17);
def('noise-billow', 'Billow noise', 'Noise', per((u, v) => Math.abs(2 * fbm(u, v, 6, 6, 5, 120, 0.55) - 1)), 0.17);
def('smoke', 'Smoke', 'Noise', per((u, v) => fbm(u + 0.25 * fbm(u, v, 3, 3, 3, 121), v + 0.25 * fbm(u, v, 3, 3, 3, 122), 4, 4, 5, 123, 0.55)), 0.16);
def('film-grain', 'Film grain', 'Noise', per((u, v) => 0.6 * pvn(u, v, 256, 256, 124) + 0.4 * pvn(u, v, 340, 340, 125)), 0.14);
const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
def('ordered-dither', 'Ordered dither', 'Noise', per((u, v) => BAYER[(Math.floor(v * N / 4) & 7) * 8 + (Math.floor(u * N / 4) & 7)] / 63), 0.29);

export interface GrainInfo { id: string; name: string; group: string }
export const GRAIN_LIST: GrainInfo[] = DEFS.map((d) => ({ id: d.id, name: d.name, group: d.group }));
const byId = new Map(DEFS.map((d) => [d.id, d]));
export function hasGrain(id: string): boolean { return byId.has(id); }
export function grainName(id: string): string { return byId.get(id)?.name ?? id; }

const store = new Map<string, Uint8Array>();

/** The 512 x 512 tile of a library grain (0..255, higher is raised), or null for an unknown id. */
export function getGrain(id: string): Uint8Array | null {
  const hit = store.get(id);
  if (hit) return hit;
  const d = byId.get(id);
  if (!d) return null;
  const b = new Float32Array(N * N);
  d.fill(b);
  let sum = 0;
  for (let i = 0; i < b.length; i++) sum += b[i];
  const mean = sum / b.length;
  let vs = 0;
  for (let i = 0; i < b.length; i++) vs += (b[i] - mean) * (b[i] - mean);
  const k = d.std / Math.max(1e-6, Math.sqrt(vs / b.length));
  const out = new Uint8Array(N * N);
  for (let i = 0; i < b.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, 0.5 + (b[i] - mean) * k)) * 255);
  store.set(id, out);
  return out;
}

const tiles = new Map<string, Float32Array>();

/** A library grain at the paint engine's 256 px, 0..1 (2 x 2 box average of the master). */
export function grainTile256(id: string): Float32Array | null {
  const hit = tiles.get(id);
  if (hit) return hit;
  const g = getGrain(id);
  if (!g) return null;
  const out = new Float32Array(65536);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = y * 2 * N + x * 2;
      out[y * 256 + x] = (g[i] + g[i + 1] + g[i + N] + g[i + N + 1]) / 1020;
    }
  }
  tiles.set(id, out);
  return out;
}

/** Cross-fades a tile with itself shifted by half its side, so any picture tiles without a seam. */
export function makeSeamless(src: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const h = n >> 1;
  for (let y = 0; y < n; y++) {
    const wy = Math.abs(y - h) / h; // 0 at the middle row, 1 at the edge
    for (let x = 0; x < n; x++) {
      const wx = Math.abs(x - h) / h;
      const w = Math.max(wx, wy);
      const a = src[y * n + x], s = src[((y + h) % n) * n + ((x + h) % n)];
      const t = Math.min(1, w * w * (3 - 2 * w));
      out[y * n + x] = a * (1 - t) + s * t;
    }
  }
  return out;
}

const resolved = new Map<string, Float32Array>();

/**
 * The 256 px tooth table a brush paints with, or null to keep the shared paper grain. Applies the
 * library grain or the brush's own picture, then invert, seamless blend and auto-repeat. Cached by
 * recipe for library grains.
 */
export function brushGrain(b: Brush): Float32Array | null {
  const id = b.grainId && hasGrain(b.grainId) ? b.grainId : '';
  const pic = !id && b.grainImage && b.grainImage.length === 65536 ? b.grainImage : null;
  const rep = Math.max(1, Math.min(8, Math.round(b.grainRepeat ?? 1)));
  if (!id && !pic) return null;
  const plain = !b.grainInvert && !b.grainSeamless && rep === 1;
  if (id && plain) return grainTile256(id);
  const key = `${id}|${b.grainInvert ? 1 : 0}|${b.grainSeamless ? 1 : 0}|${rep}`;
  if (id) { const hit = resolved.get(key); if (hit) return hit; }
  let g: Float32Array = id ? grainTile256(id)! : Float32Array.from(pic!, (v) => v / 255);
  if (b.grainSeamless) g = makeSeamless(g, 256);
  if (rep > 1) {
    const o = new Float32Array(65536);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) o[(y << 8) | x] = g[(((y * rep) & 255) << 8) | ((x * rep) & 255)];
    g = o;
  }
  if (b.grainInvert) {
    const o = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) o[i] = 1 - g[i];
    g = o;
  }
  if (id) {
    resolved.set(key, g);
    if (resolved.size > 12) { const first = resolved.keys().next().value; if (first !== undefined) resolved.delete(first); }
  }
  return g;
}

/** Grain thumbnail pixels (0..255, `side` square) for pickers: the master tile cropped to its top-left quarter. */
export function grainThumb(id: string, side: number): Uint8Array | null {
  const g = getGrain(id);
  if (!g) return null;
  const out = new Uint8Array(side * side);
  const span = N / 2;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) out[y * side + x] = g[Math.floor((y * span) / side) * N + Math.floor((x * span) / side)];
  return out;
}
