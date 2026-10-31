// The authored tip library: 76 stamps of 256 px (pencil leads, charcoal sticks, chalk, flat / round /
// filbert bristle brushes from a bristle simulation, sponges, spatter, airbrush falloffs, ink nibs,
// markers and texture stamps), drawn by seeded code and generated lazily, one tip at a time.
// A brush names one by `tipId`; the stroke engine reads it as a picture tip. Pure maths: no DOM.

import type { TipImage } from './types';
import { fbm, pvn, sstep, worley, WR } from './grains-lib';

export const TIP_SIDE = 256;
const S = TIP_SIDE;
const HALF = S / 2;

type Fill = (b: Float32Array) => void;
interface Def { id: string; name: string; group: string; fill: Fill }
const DEFS: Def[] = [];
function def(id: string, name: string, group: string, fill: Fill): void { DEFS.push({ id, name, group, fill }); }

/** Per-pixel tip: fn gets x, y in -1..1 (y down) and returns coverage 0..1. */
const per = (fn: (x: number, y: number) => number): Fill => (b) => {
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) b[j * S + i] = fn((i + 0.5) / HALF - 1, (j + 0.5) / HALF - 1);
};
const U = (x: number): number => (x + 1) * 0.5;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

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

/** A soft dot in pixel space; `hard` 0 is a gaussian-ish falloff, 1 a crisp disc. Combines by max. */
function dot(b: Float32Array, cx: number, cy: number, r: number, a: number, hard = 0.4): void {
  const k = 1.4 + hard * 8;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(S - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(S - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r) continue;
      const w = Math.min(1, (1 - d / r) * k);
      const v = a * w * w * (3 - 2 * w);
      const i = y * S + x;
      if (v > b[i]) b[i] = v;
    }
  }
}
function stroke(b: Float32Array, x0: number, y0: number, x1: number, y1: number, r: number, a: number, hard = 0.5): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.6, r * 0.5)));
  for (let i = 0; i <= n; i++) dot(b, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, a, hard);
}
const px = (x: number): number => (x + 1) * HALF;

/** Radial roughness: the edge radius wobbles around the circle (periodic in the angle). */
function roughEdge(x: number, y: number, r: number, amp: number, f: number, seed: number, soft = 0.14): number {
  const th = Math.atan2(y, x) / (2 * Math.PI) + 0.5;
  const rad = r * (1 + amp * (pvn(th, 0.37, f, 1, seed) * 2 - 1) + amp * 0.5 * (pvn(th, 0.71, f * 3, 1, seed + 1) * 2 - 1));
  return 1 - sstep(1 - soft, 1, Math.hypot(x, y) / rad);
}
const tooth = (x: number, y: number, f: number, seed: number): number => pvn(U(x), U(y), f, f, seed);
const superEdge = (x: number, y: number, rx: number, ry: number, n: number, soft: number): number =>
  1 - sstep(1 - soft, 1, Math.pow(Math.pow(Math.abs(x) / rx, n) + Math.pow(Math.abs(y) / ry, n), 1 / n));

// ---- pencil leads ---------------------------------------------------------------------------------
def('lead-hard', 'Hard lead', 'Pencil', per((x, y) => roughEdge(x, y, 0.3, 0.05, 6, 1, 0.3) * (0.55 + 0.45 * sstep(0.3, 0.7, tooth(x, y, 90, 2)))));
def('lead-hb', 'HB lead', 'Pencil', per((x, y) => roughEdge(x, y, 0.45, 0.06, 7, 3, 0.35) * (0.4 + 0.6 * sstep(0.28, 0.68, tooth(x, y, 80, 4)))));
def('lead-2b', '2B lead', 'Pencil', per((x, y) => roughEdge(x, y, 0.62, 0.08, 6, 5, 0.5) * (0.3 + 0.7 * sstep(0.25, 0.65, 0.6 * tooth(x, y, 60, 6) + 0.4 * tooth(x, y, 140, 7)))));
def('lead-6b', '6B lead', 'Pencil', per((x, y) => {
  const g = Math.exp(-Math.hypot(x, y) * Math.hypot(x, y) * 3.2) * (1 - sstep(0.8, 1, Math.hypot(x, y)));
  return g * (0.25 + 0.75 * sstep(0.3, 0.62, tooth(x, y, 110, 8)));
}));
def('lead-flat', 'Flat lead', 'Pencil', per((x, y) => superEdge(x, y, 0.92, 0.2, 6, 0.2) * (0.45 + 0.55 * sstep(0.3, 0.7, tooth(x, y, 100, 9)))));
def('lead-mechanical', 'Mechanical lead', 'Pencil', per((x, y) => (1 - sstep(0.14, 0.2, Math.hypot(x, y))) * (0.85 + 0.15 * tooth(x, y, 60, 10))));
def('lead-coloured', 'Coloured pencil', 'Pencil', per((x, y) => roughEdge(x, y, 0.5, 0.04, 5, 11, 0.22) * (0.55 + 0.45 * sstep(0.35, 0.65, pvn(U(x) + U(y) * 2, U(y), 70, 40, 12)))));
def('lead-worn', 'Worn lead', 'Pencil', per((x, y) => {
  const e = 1 - sstep(0.85, 1, Math.hypot(x / 0.8, y / 0.5)); const cut = sstep(-0.42, -0.34, y);
  return e * (0.4 + 0.6 * cut) * (0.4 + 0.6 * sstep(0.3, 0.66, tooth(x, y, 90, 13)));
}));

// ---- charcoal ---------------------------------------------------------------------------------------
def('charcoal-vine', 'Vine charcoal', 'Charcoal', per((x, y) => roughEdge(x, y, 0.64, 0.14, 7, 20, 0.2) * (0.35 + 0.65 * sstep(0.3, 0.6, 0.6 * tooth(x, y, 40, 21) + 0.4 * tooth(x, y, 120, 22)))));
def('charcoal-compressed', 'Compressed charcoal', 'Charcoal', per((x, y) => superEdge(x, y, 0.72, 0.72, 4, 0.22) * (0.5 + 0.5 * sstep(0.25, 0.55, fbm(U(x), U(y), 30, 30, 3, 23))) * (0.9 + 0.1 * roughEdge(x, y, 1, 0.1, 6, 24))));
def('charcoal-willow', 'Willow charcoal', 'Charcoal', per((x, y) => roughEdge(x, y, 0.38, 0.12, 9, 25, 0.3) * (0.3 + 0.7 * sstep(0.3, 0.6, pvn(U(x), U(y), 24, 90, 26)))));
def('charcoal-side', 'Charcoal side', 'Charcoal', per((x, y) => superEdge(x, y, 0.95, 0.4, 3, 0.35) * (0.25 + 0.75 * sstep(0.28, 0.6, pvn(U(x), U(y), 4, 120, 27))) * (0.6 + 0.4 * tooth(x, y, 90, 28))));
def('charcoal-chunk', 'Charcoal chunk', 'Charcoal', per((x, y) => roughEdge(x, y, 0.62, 0.3, 4, 29, 0.12) * (0.55 + 0.45 * sstep(0.3, 0.55, fbm(U(x), U(y), 24, 24, 3, 30)))));
def('charcoal-powder', 'Charcoal powder', 'Charcoal', per((x, y) => Math.exp(-(x * x + y * y) * 2.4) * (1 - sstep(0.8, 1, Math.hypot(x, y))) * sstep(0.42, 0.62, 0.5 * tooth(x, y, 150, 31) + 0.5 * tooth(x, y, 60, 32))));

// ---- chalk --------------------------------------------------------------------------------------------
def('chalk-stick', 'Chalk stick', 'Chalk', per((x, y) => roughEdge(x, y, 0.62, 0.1, 8, 40, 0.16) * sstep(0.18, 0.46, 0.6 * tooth(x, y, 70, 41) + 0.4 * tooth(x, y, 160, 42))));
def('chalk-side', 'Chalk side', 'Chalk', per((x, y) => superEdge(x, y, 0.95, 0.5, 4, 0.2) * sstep(0.2, 0.5, 0.5 * pvn(U(x), U(y), 6, 60, 43) + 0.5 * tooth(x, y, 130, 44))));
def('pastel-crumb', 'Pastel crumbs', 'Chalk', (b) => {
  const r = rnd(45);
  for (let k = 0; k < 22; k++) { const a = r() * 6.28, d = Math.sqrt(r()) * 0.7; dot(b, px(Math.cos(a) * d), px(Math.sin(a) * d), 5 + r() * 14, 0.6 + r() * 0.4, 0.7); }
});
def('pastel-soft', 'Soft pastel', 'Chalk', per((x, y) => (1 - sstep(0.15, 0.95, Math.hypot(x, y) + 0.12 * (tooth(x, y, 30, 46) - 0.5))) * (0.5 + 0.5 * sstep(0.2, 0.55, tooth(x, y, 110, 47)))));
def('chalk-board', 'Blackboard chalk', 'Chalk', per((x, y) => roughEdge(x, y, 0.55, 0.16, 10, 48, 0.12) * sstep(0.3, 0.5, 0.5 * pvn(U(x) + U(y), U(y), 50, 12, 49) + 0.5 * tooth(x, y, 140, 50))));
def('chalk-dust', 'Chalk dust', 'Chalk', (b) => {
  const r = rnd(51);
  for (let k = 0; k < 900; k++) { const a = r() * 6.28, d = Math.pow(r(), 0.8) * 0.9; dot(b, px(Math.cos(a) * d), px(Math.sin(a) * d), 1 + r() * 2.2, (1 - d) * (0.4 + 0.6 * r()), 0.5); }
});

// ---- bristle simulation: positions inside a ferrule profile, one soft dot per hair ---------------
interface Bristle { rmin: number; rmax: number; gap: number; dry: number; splay: number; ragged: number; seed: number }
// Each hair is a streak along the tip's y axis (the stroke direction when the brush follows the stroke), one hair
// per stratified column across the width, so a dab never leaves a bare column (a white seam) or a bead chain:
// neighbouring dabs lay the streaks end to end into continuous bristle lines.
function bristles(shape: 'flat' | 'round' | 'filbert', n: number, o: Bristle): Fill {
  return (b) => {
    const r = rnd(o.seed);
    const xm = shape === 'flat' ? 0.9 : shape === 'round' ? 0.707 : 0.88;
    const cols = Math.max(6, Math.round(n * (shape === 'round' ? 0.8 : 1)));
    const colW = (2 * xm) / cols;
    for (let i = 0; i < cols; i++) {
      if (r() < o.dry) continue;
      const x = -xm + (i + 0.5 + (r() - 0.5) * 0.5) * colW;
      const prof = shape === 'flat' ? 0.2 : shape === 'round' ? Math.sqrt(Math.max(0, 0.5 - x * x)) : 0.56 * Math.sqrt(Math.max(0, 1 - (x / 0.88) ** 2));
      const h = Math.max(0.05, prof);
      // hair thickness from the preset (thin hog hairs read as finer lines), never so thin that columns separate
      const thick = (o.rmin + r() * (o.rmax - o.rmin)) / 0.05;
      const rad = Math.max(2.2, colW * HALF * (0.62 + 0.22 * thick) * (0.9 + 0.2 * r()));
      const a = 0.5 + 0.5 * r() * r() * 1.0 + 0.0;
      const y0 = -h * (0.9 + 0.1 * r()) + (r() - 0.5) * o.ragged * 0.4;
      let y1 = h * (0.9 + 0.1 * r()) + (r() - 0.5) * o.ragged * 0.4;
      let x1 = x;
      if (o.splay > 0) { const len = o.splay * r(); x1 = x * (1 + len); y1 *= 1 + len * 0.5; }
      stroke(b, px(x), px(y0), px(x1), px(y1), rad, a, 0.25);
    }
  };
}
const BR = (extra: Partial<Bristle>, seed: number, base: Bristle = { rmin: 0.03, rmax: 0.05, gap: 0.06, dry: 0, splay: 0, ragged: 0, seed }): Bristle => ({ ...base, ...extra, seed });
def('flat-fine', 'Flat fine bristle', 'Bristle', bristles('flat', 60, BR({ rmin: 0.022, rmax: 0.034, gap: 0.05, ragged: 0.06 }, 60)));
def('flat-medium', 'Flat bristle', 'Bristle', bristles('flat', 34, BR({ rmin: 0.04, rmax: 0.06, gap: 0.08, ragged: 0.1 }, 61)));
def('flat-coarse', 'Flat hog bristle', 'Bristle', bristles('flat', 18, BR({ rmin: 0.06, rmax: 0.09, gap: 0.12, ragged: 0.14 }, 62)));
def('flat-dry', 'Flat dry bristle', 'Bristle', bristles('flat', 44, BR({ rmin: 0.025, rmax: 0.05, gap: 0.05, dry: 0.4, ragged: 0.16 }, 63)));
def('flat-splay', 'Flat splayed', 'Bristle', bristles('flat', 30, BR({ rmin: 0.03, rmax: 0.05, gap: 0.08, splay: 0.35, ragged: 0.1 }, 64)));
def('round-fine', 'Round fine bristle', 'Bristle', bristles('round', 70, BR({ rmin: 0.022, rmax: 0.034, gap: 0.065 }, 65)));
def('round-medium', 'Round bristle', 'Bristle', bristles('round', 38, BR({ rmin: 0.04, rmax: 0.06, gap: 0.1 }, 66)));
def('round-coarse', 'Round hog bristle', 'Bristle', bristles('round', 20, BR({ rmin: 0.06, rmax: 0.09, gap: 0.16 }, 67)));
def('round-dry', 'Round dry bristle', 'Bristle', bristles('round', 50, BR({ rmin: 0.025, rmax: 0.05, gap: 0.07, dry: 0.4 }, 68)));
def('round-tuft', 'Round tuft', 'Bristle', bristles('round', 26, BR({ rmin: 0.035, rmax: 0.055, gap: 0.09, splay: 0.4 }, 69)));
def('filbert-fine', 'Filbert fine bristle', 'Bristle', bristles('filbert', 64, BR({ rmin: 0.022, rmax: 0.034, gap: 0.06 }, 70)));
def('filbert-medium', 'Filbert bristle', 'Bristle', bristles('filbert', 36, BR({ rmin: 0.04, rmax: 0.06, gap: 0.09 }, 71)));
def('filbert-coarse', 'Filbert hog bristle', 'Bristle', bristles('filbert', 20, BR({ rmin: 0.06, rmax: 0.09, gap: 0.15 }, 72)));
def('filbert-dry', 'Filbert dry bristle', 'Bristle', bristles('filbert', 48, BR({ rmin: 0.025, rmax: 0.05, gap: 0.06, dry: 0.4 }, 73)));
def('filbert-worn', 'Filbert worn', 'Bristle', bristles('filbert', 40, BR({ rmin: 0.03, rmax: 0.055, gap: 0.08, ragged: 0.2, dry: 0.15 }, 74)));

// ---- sponges --------------------------------------------------------------------------------------
const spongeFn = (f: number, lo: number, hi: number, seed: number, r: number): Fill => per((x, y) => {
  worley(U(x) + 0.05 * (tooth(x, y, 5, seed + 1) - 0.5), U(y) + 0.05 * (tooth(x, y, 5, seed + 2) - 0.5), f, seed);
  return roughEdge(x, y, r, 0.12, 6, seed + 3, 0.2) * sstep(lo, hi, WR.f1);
});
def('sponge-natural', 'Natural sponge', 'Sponge', spongeFn(9, 0.14, 0.4, 80, 0.68));
def('sponge-sea', 'Sea sponge', 'Sponge', spongeFn(6, 0.2, 0.5, 81, 0.72));
def('sponge-foam', 'Foam sponge', 'Sponge', per((x, y) => { worley(U(x), U(y), 14, 82); return roughEdge(x, y, 0.7, 0.06, 6, 83, 0.15) * sstep(0.28, 0.4, WR.f1) * 0.95; }));
def('sponge-stipple', 'Stipple sponge', 'Sponge', per((x, y) => roughEdge(x, y, 0.66, 0.1, 6, 84, 0.2) * sstep(0.5, 0.62, 0.55 * tooth(x, y, 36, 85) + 0.45 * tooth(x, y, 90, 86))));

// ---- spatter ----------------------------------------------------------------------------------------
function scatter(n: number, seed: number, rmin: number, rmax: number, spread: number, falloff = 1): Fill {
  return (b) => {
    const r = rnd(seed);
    for (let k = 0; k < n; k++) { const a = r() * 6.28, d = Math.pow(r(), falloff) * spread; dot(b, px(Math.cos(a) * d), px(Math.sin(a) * d), rmin + Math.pow(r(), 2.5) * (rmax - rmin), 0.6 + 0.4 * r(), 0.8); }
  };
}
def('spatter-mist', 'Spatter mist', 'Spatter', scatter(700, 90, 0.8, 3, 0.92, 0.7));
def('spatter-coarse', 'Coarse spatter', 'Spatter', scatter(70, 91, 2, 13, 0.88, 0.6));
def('spatter-splash', 'Splash', 'Spatter', (b) => {
  const r = rnd(92);
  const core = per((x, y) => roughEdge(x, y, 0.36, 0.28, 6, 93, 0.12));
  core(b);
  for (let k = 0; k < 16; k++) {
    const a = r() * 6.28, d = 0.45 + r() * 0.42, rad = 3 + r() * 9;
    stroke(b, px(Math.cos(a) * 0.3), px(Math.sin(a) * 0.3), px(Math.cos(a) * d), px(Math.sin(a) * d), rad * 0.4, 0.9, 0.8);
    dot(b, px(Math.cos(a) * d), px(Math.sin(a) * d), rad, 1, 0.9);
  }
  scatter(60, 94, 1, 4, 0.9)(b);
});
def('spatter-flick', 'Flick', 'Spatter', (b) => {
  const r = rnd(95);
  for (let k = 0; k < 80; k++) { const t = Math.pow(r(), 1.4); const x = -0.8 + t * 1.6, y = (r() - 0.5) * (0.15 + t * 0.9); dot(b, px(x), px(y), 1.5 + (1 - t) * 9 * r(), 0.6 + 0.4 * r(), 0.85); }
});

// ---- airbrush falloffs --------------------------------------------------------------------------------
const rad = (x: number, y: number): number => Math.min(1.2, Math.hypot(x, y));
def('air-linear', 'Linear falloff', 'Airbrush', per((x, y) => clamp01(1 - rad(x, y))));
def('air-gauss', 'Gaussian falloff', 'Airbrush', per((x, y) => Math.exp(-rad(x, y) * rad(x, y) * 4.5) * (1 - sstep(0.85, 1, rad(x, y)))));
def('air-smooth', 'Smooth falloff', 'Airbrush', per((x, y) => 1 - sstep(0, 1, rad(x, y))));
def('air-core', 'Hard core halo', 'Airbrush', per((x, y) => Math.max(1 - sstep(0.18, 0.3, rad(x, y)), 0.35 * (1 - sstep(0.3, 1, rad(x, y))))));
def('air-sharp', 'Sharp falloff', 'Airbrush', per((x, y) => Math.pow(clamp01(1 - rad(x, y)), 3)));
def('air-halo', 'Ring halo', 'Airbrush', per((x, y) => { const d = rad(x, y); return clamp01(1 - sstep(0.55, 1, d)) * (0.35 + 0.65 * sstep(0.1, 0.62, d)); }));
def('air-spray', 'Particle spray', 'Airbrush', (b) => {
  const r = rnd(96);
  for (let k = 0; k < 1700; k++) {
    // gaussian-ish radius so the cloud is denser at the middle
    const d = Math.min(0.97, Math.abs((r() + r() + r() - 1.5) * 0.9)), a = r() * 6.28;
    dot(b, px(Math.cos(a) * d), px(Math.sin(a) * d), 0.9 + r() * 1.3, 0.55 + 0.45 * r(), 0.6);
  }
});

// ---- ink nibs ---------------------------------------------------------------------------------------
def('nib-point', 'Pointed nib', 'Ink', per((x, y) => 1 - sstep(0.26, 0.32, Math.hypot(x, y))));
def('nib-chisel', 'Chisel nib', 'Ink', per((x, y) => superEdge(x, y, 0.9, 0.12, 12, 0.08)));
def('nib-italic', 'Italic nib', 'Ink', per((x, y) => {
  const c = Math.cos(0.6), s = Math.sin(0.6), u = x * c + y * s, v = -x * s + y * c;
  return superEdge(u, v, 0.9, 0.18, 8, 0.08);
}));
def('nib-brush-pen', 'Brush pen tip', 'Ink', per((x, y) => {
  const t = (x + 0.8) / 1.6; if (t < 0 || t > 1) return 0;
  const hw = 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) + 0.02;
  return 1 - sstep(hw * 0.88, hw, Math.abs(y));
}));
def('nib-bleed', 'Ink bleed', 'Ink', per((x, y) => {
  const n = fbm(U(x), U(y), 10, 10, 4, 100, 0.6);
  return 1 - sstep(0.46, 0.6, Math.hypot(x, y) + (n - 0.5) * 0.5);
}));
def('nib-broad', 'Broad calligraphy nib', 'Ink', per((x, y) => {
  const c = Math.cos(0.75), s = Math.sin(0.75), u = x * c + y * s, v = -x * s + y * c;
  const body = superEdge(u, v, 0.88, 0.16, 6, 0.06);
  return Math.max(body, 0.5 * superEdge(u, v, 0.95, 0.025, 4, 0.2));
}));

// ---- markers ----------------------------------------------------------------------------------------
def('marker-chisel', 'Chisel marker', 'Marker', per((x, y) => superEdge(x, y, 0.92, 0.36, 8, 0.07) * (0.9 + 0.1 * tooth(x, y, 80, 110))));
def('marker-bullet', 'Bullet marker', 'Marker', per((x, y) => 1 - sstep(0.5, 0.54, Math.hypot(x, y))));
def('marker-felt', 'Felt tip', 'Marker', per((x, y) => roughEdge(x, y, 0.5, 0.03, 14, 111, 0.1) * (0.88 + 0.12 * sstep(0.3, 0.7, tooth(x, y, 120, 112)))));
def('marker-highlighter', 'Highlighter tip', 'Marker', per((x, y) => superEdge(x, y, 0.95, 0.52, 5, 0.06)));

// ---- texture stamps ---------------------------------------------------------------------------------
def('stamp-leaf', 'Leaf', 'Stamp', per((x, y) => {
  const t = (x + 0.9) / 1.8; if (t < 0 || t > 1) return 0;
  const hw = 0.42 * Math.pow(Math.sin(Math.PI * t), 0.85);
  const body = 1 - sstep(hw * 0.9, hw, Math.abs(y));
  const vein = Math.abs(y) < 0.012 ? 0.5 : 0;
  const side = Math.abs(Math.abs(y) - Math.abs(((t * 9) % 1) - 0.5) * 0.9 * hw * 1.6) < 0.01 ? 0.3 : 0;
  return clamp01(body * 0.9 - vein - side);
}));
def('stamp-grass', 'Grass blades', 'Stamp', (b) => {
  const r = rnd(120);
  for (let k = 0; k < 9; k++) {
    const x0 = -0.8 + r() * 1.6, h = 0.5 + r() * 0.45, lean = (r() - 0.5) * 0.7;
    for (let s = 0; s <= 40; s++) { const t = s / 40; stroke(b, px(x0 + lean * t * t), px(0.9 - h * 1.9 * t), px(x0 + lean * t * t), px(0.9 - h * 1.9 * t), 0.5 + 5 * (1 - t) * (1 - t), 1, 0.9); }
  }
});
def('stamp-fern', 'Fern', 'Stamp', (b) => {
  stroke(b, px(0), px(0.9), px(0.05), px(-0.9), 2.2, 1, 0.9);
  for (let k = 0; k < 16; k++) {
    const t = k / 16, y = 0.85 - t * 1.7, len = 0.5 * Math.sin(Math.PI * (0.1 + t * 0.85));
    for (const sgn of [-1, 1]) stroke(b, px(0.05 * t), px(y), px(0.05 * t + sgn * len), px(y - 0.18 * len), 2.2 * (1 - t * 0.5), 1, 0.9);
  }
});
def('stamp-crack', 'Cracks', 'Stamp', per((x, y) => { worley(U(x), U(y), 4, 121, 0.9); return roughEdge(x, y, 0.9, 0.05, 6, 122, 0.1) * (1 - sstep(0.0, 0.05, WR.f2 - WR.f1)); }));
def('stamp-dotgrid', 'Dot grid', 'Stamp', per((x, y) => { const f = 6, a = U(x) * f, c = U(y) * f; return (1 - sstep(0.18, 0.26, Math.hypot(a - Math.floor(a) - 0.5, c - Math.floor(c) - 0.5))) * (Math.max(Math.abs(x), Math.abs(y)) < 0.92 ? 1 : 0); }));
def('stamp-halftone', 'Halftone dots', 'Stamp', per((x, y) => {
  const n = 7, s = n * (U(x) + U(y)), t = n * (U(x) - U(y));
  const g = 1 - sstep(0.2, 0.3, Math.hypot(Math.abs(s - Math.round(s)), Math.abs(t - Math.round(t))) * (0.5 + 0.9 * (1 - rad(x, y))));
  return g * (1 - sstep(0.85, 0.95, rad(x, y)));
}));
def('stamp-crosshatch', 'Crosshatch', 'Stamp', per((x, y) => {
  const a = 9 * (U(x) + U(y)), c = 9 * (U(x) - U(y));
  const l = Math.max(1 - sstep(0.08, 0.16, Math.abs(a - Math.round(a))), 1 - sstep(0.08, 0.16, Math.abs(c - Math.round(c))));
  return l * (1 - sstep(0.8, 0.92, Math.max(Math.abs(x), Math.abs(y))));
}));
def('stamp-scribble', 'Scribble', 'Stamp', (b) => {
  const r = rnd(123);
  let x = 0, y = 0;
  for (let k = 0; k < 26; k++) { const nx = (r() * 2 - 1) * 0.8, ny = (r() * 2 - 1) * 0.8; stroke(b, px(x), px(y), px(nx), px(ny), 2.4, 1, 0.9); x = nx; y = ny; }
});
def('stamp-cells', 'Hex cells', 'Stamp', per((x, y) => { worley(U(x), U(y), 5, 124, 0.7); return (1 - sstep(0.02, 0.06, WR.f2 - WR.f1)) * (1 - sstep(0.85, 0.95, rad(x, y))); }));
def('stamp-stardust', 'Star dust', 'Stamp', (b) => {
  const r = rnd(125);
  for (let k = 0; k < 40; k++) { const a = r() * 6.28, d = Math.sqrt(r()) * 0.9, c = px(Math.cos(a) * d), e = px(Math.sin(a) * d), s = 2 + r() * 7; stroke(b, c - s, e, c + s, e, 0.9, 1, 0.9); stroke(b, c, e - s, c, e + s, 0.9, 1, 0.9); dot(b, c, e, 1.6, 1, 0.9); }
});
def('stamp-cloud', 'Cloud puff', 'Stamp', per((x, y) => {
  const f = fbm(U(x), U(y), 5, 5, 4, 126, 0.55);
  return clamp01((1 - rad(x, y) * 1.15) * 1.6 * (0.5 + f)) * (1 - sstep(0.7, 0.98, rad(x, y)));
}));
def('stamp-torn', 'Torn paper', 'Stamp', per((x, y) => {
  const e = 0.7 + 0.14 * (fbm(U(x), 0.5, 7, 1, 4, 127) - 0.5) * 4 + 0.05 * (tooth(x, y, 120, 128) - 0.5);
  return (1 - sstep(e - 0.03, e, y)) * (1 - sstep(0.85, 0.95, Math.abs(x))) * (0.85 + 0.15 * tooth(x, y, 90, 129));
}));
def('stamp-stipple-ring', 'Stipple ring', 'Stamp', (b) => {
  const r = rnd(130);
  for (let k = 0; k < 130; k++) { const a = r() * 6.28, d = 0.55 + (r() - 0.5) * 0.3; dot(b, px(Math.cos(a) * d), px(Math.sin(a) * d), 1.4 + r() * 2.4, 0.7 + 0.3 * r(), 0.8); }
});
def('stamp-rake', 'Rake comb', 'Stamp', (b) => {
  const r = rnd(131);
  for (let k = 0; k < 6; k++) { const x = -0.78 + k * 0.312 + (r() - 0.5) * 0.04; stroke(b, px(x), px(-0.12 - r() * 0.04), px(x), px(0.12 + r() * 0.04), 7 + r() * 3, 0.85 + 0.15 * r(), 0.7); }
});
def('stamp-rake-fine', 'Fine rake comb', 'Stamp', (b) => {
  const r = rnd(132);
  for (let k = 0; k < 14; k++) { const x = -0.85 + k * 0.131 + (r() - 0.5) * 0.03; stroke(b, px(x), px(-0.1 - r() * 0.05), px(x), px(0.1 + r() * 0.05), 3 + r() * 2, 0.75 + 0.25 * r(), 0.7); }
});
def('stamp-wire', 'Wire brush', 'Stamp', (b) => {
  const r = rnd(133);
  for (let k = 0; k < 70; k++) { const x = (r() * 2 - 1) * 0.85, y = (r() * 2 - 1) * 0.3, a = (r() - 0.5) * 0.5; stroke(b, px(x), px(y), px(x + a * 0.5), px(y + 0.35), 1.1, 0.5 + 0.5 * r(), 0.8); }
});
def('stamp-scratch', 'Scratches', 'Stamp', (b) => {
  const r = rnd(134);
  for (let k = 0; k < 14; k++) { const x = (r() * 2 - 1) * 0.8, y = (r() * 2 - 1) * 0.8, a = 0.3 + (r() - 0.5) * 0.3, l = 0.2 + r() * 0.6; stroke(b, px(x), px(y), px(x + Math.cos(a) * l), px(y + Math.sin(a) * l), 0.9, 0.5 + 0.5 * r(), 0.8); }
});
def('stamp-rain', 'Rain streaks', 'Stamp', (b) => {
  const r = rnd(135);
  for (let k = 0; k < 18; k++) { const x = (r() * 2 - 1) * 0.85, y = (r() * 2 - 1) * 0.7, l = 0.1 + r() * 0.22; stroke(b, px(x), px(y), px(x - l * 0.25), px(y + l), 1 + r() * 0.8, 0.6 + 0.4 * r(), 0.9); }
});
def('stamp-snow', 'Snowflake', 'Stamp', (b) => {
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
    stroke(b, px(0), px(0), px(c * 0.85), px(s * 0.85), 2.2, 1, 0.9);
    for (const m of [0.35, 0.6]) for (const d of [-0.5, 0.5]) stroke(b, px(c * m), px(s * m), px(c * m + Math.cos(a + d) * 0.2), px(s * m + Math.sin(a + d) * 0.2), 1.6, 1, 0.9);
  }
});

export interface TipInfo { id: string; name: string; group: string }
export const TIP_LIST: TipInfo[] = DEFS.map((d) => ({ id: d.id, name: d.name, group: d.group }));
const byId = new Map(DEFS.map((d) => [d.id, d]));
export function hasTip(id: string): boolean { return byId.has(id); }
export function tipName(id: string): string { return byId.get(id)?.name ?? id; }

const store = new Map<string, TipImage>();

/** A library stamp as a picture tip (256 x 256 coverage), or undefined for an unknown id. */
export function libTipImage(id: string): TipImage | undefined {
  const hit = store.get(id);
  if (hit) return hit;
  const d = byId.get(id);
  if (!d) return undefined;
  const b = new Float32Array(S * S);
  d.fill(b);
  const data = new Uint8Array(S * S);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp01(b[i]) * 255);
  // The picture is sampled with bilinear taps and zero outside; pin the border so no hard edge shows.
  for (let k = 0; k < S; k++) { data[k] = 0; data[(S - 1) * S + k] = 0; data[k * S] = 0; data[k * S + S - 1] = 0; }
  const img: TipImage = { w: S, h: S, data, key: `lib:${id}` };
  store.set(id, img);
  return img;
}
