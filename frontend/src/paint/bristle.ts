// Bristle bundle: a brush made of many hairs, each laying its own continuous line and carrying its own paint.
// A stroke shows per-hair streaks along the path (each hair has its own tone, length and wobble), the hairs
// lift (dry skip) at a light touch or when the paint runs low, and each hair picks up the paint already on the
// canvas under it, so the stroke smears and mixes in streaks. Moving grain travels with the stroke.
// Pure maths on typed arrays. Every random number comes from the stroke's seeded generator.

import { ksToRgb, rgbToKs, steer } from './wet';
import type { WetMix } from './types';

const NB = 6;
const DEC = new Float32Array(256);
const ENCB = new Uint8Array(4097);
for (let i = 0; i < 256; i++) { const c = i / 255; DEC[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
for (let i = 0; i <= 4096; i++) { const l = i / 4096; ENCB[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); }

const sstep = (a: number, b: number, x: number): number => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

export interface BristleCfg { count: number; lenVar: number; tone: number; clump: number }

/** The layer and stroke buffers a bundle paints into. */
export interface BristleCtx {
  w: number; h: number;
  data: Uint8ClampedArray;
  cov: Uint16Array;
  snap: (Uint8ClampedArray | undefined)[];
  tilesX: number;
  sel: Uint8Array | null;
  lock: boolean;
  tooth: Float32Array | null;
  bump: number;
  burnt: number;
  /** Tells the stroke which rectangle is about to change (undo tiles, dirty box). */
  touch: (x0: number, y0: number, x1: number, y1: number) => void;
}

/** One step of the bundle along the path. */
export interface BristleStep {
  cx: number; cy: number; dia: number;
  /** Unit direction of travel. */
  dx: number; dy: number;
  /** Effective pressure 0..1 and pen speed 0..1. */
  pressure: number; speed: number;
  flow: number; opacity: number;
  /** Distance travelled since the stroke began, and since the previous step. */
  travel: number; ds: number;
  /** Grain depth 0..1, whether the grain moves with the stroke, and how much it renews (1 = canvas anchored). */
  grain: number; moving: boolean; movement: number;
  /** Extra wobble amplitude, in diameters. */
  wobble: number;
}

/** A light 3 x 3 smoothing of the stroke's coverage over a rectangle, so the lit relief shows ridges, not one-pixel cliffs at every hair. */
export function smoothCov(cov: Uint16Array, w: number, x0: number, y0: number, x1: number, y1: number): void {
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 3 || rh < 3) return;
  const tmp = new Uint16Array(rw);
  const prev = new Uint16Array(rw), cur = new Uint16Array(rw);
  for (let y = 0; y < rh; y++) {
    const o = (y0 + y) * w + x0;
    for (let x = 0; x < rw; x++) cur[x] = cov[o + x];
    // horizontal pass of the current row into tmp, then blend with the previous (unsmoothed) row and the next one
    for (let x = 0; x < rw; x++) tmp[x] = (cur[x > 0 ? x - 1 : 0] + 2 * cur[x] + cur[x < rw - 1 ? x + 1 : rw - 1]) >> 2;
    const nxt = y < rh - 1 ? o + w : o;
    for (let x = 0; x < rw; x++) {
      const p = y > 0 ? prev[x] : cur[x], n2 = cov[nxt + x];
      cov[o + x] = (p + 2 * tmp[x] + n2) >> 2;
    }
    prev.set(cur);
  }
}

export class Bristle {
  private readonly n: number;
  private readonly u: Float32Array;
  private readonly wf: Float32Array;
  private readonly len: Float32Array;
  private readonly tone: Float32Array;
  private readonly phase: Float32Array;
  private readonly start: Float32Array;
  private readonly amt: Float32Array;
  private readonly ks: Float32Array;
  private readonly kbT: Float32Array;
  private readonly rgb: Float32Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly hx: Float32Array;
  private readonly hy: Float32Array;
  private readonly hw: Float32Array;
  private readonly cap: Float32Array;
  private has = false;
  private readonly kb = new Float32Array(NB);
  private bR = -1; private bG = -1; private bB = -1;
  private readonly kc = new Float32Array(NB);
  private readonly km = new Float32Array(NB);
  private readonly tmp = [0, 0, 0];
  private readonly wet: WetMix;
  private started = false;

  constructor(cfg: BristleCfg, baseDia: number, wet: WetMix, private readonly c: BristleCtx, rng: () => number) {
    this.wet = wet;
    const auto = Math.max(10, Math.min(72, Math.round(baseDia / 2.4)));
    const n = cfg.count > 0 ? Math.max(4, Math.min(96, Math.round(cfg.count))) : auto;
    this.n = n;
    this.u = new Float32Array(n); this.wf = new Float32Array(n); this.len = new Float32Array(n);
    this.tone = new Float32Array(n); this.phase = new Float32Array(n); this.start = new Float32Array(n);
    this.amt = new Float32Array(n).fill(1);
    this.ks = new Float32Array(n * NB); this.kbT = new Float32Array(n * NB); this.rgb = new Float32Array(n * 3);
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.hx = new Float32Array(n); this.hy = new Float32Array(n);
    this.hw = new Float32Array(n); this.cap = new Float32Array(n);
    // clumps of 3 to 5 hairs share a tone, so the stroke shows chunky streaks rather than fine noise
    let clumpLeft = 0, clumpTone = 0;
    for (let i = 0; i < n; i++) {
      this.u[i] = -1 + (2 * (i + 0.2 + 0.6 * rng())) / n;
      this.wf[i] = 1.7 + 0.9 * rng();
      this.len[i] = 1 - cfg.lenVar * rng();
      if (clumpLeft <= 0) { clumpLeft = 3 + Math.floor(rng() * 3); clumpTone = (rng() - 0.5) * cfg.tone; }
      clumpLeft--;
      this.tone[i] = (rng() - 0.5) * cfg.tone * (1 - cfg.clump) + clumpTone * cfg.clump;
      this.phase[i] = rng() * 100;
      this.start[i] = rng() * 0.8;
    }
  }

  setColour(r: number, g: number, b: number): void {
    if (r === this.bR && g === this.bG && b === this.bB) return;
    this.bR = r; this.bG = g; this.bB = b;
    rgbToKs(r, g, b, this.kb, 0);
    for (let i = 0; i < this.n; i++) {
      const k = 1 + this.tone[i] * 1.2;
      for (let j = 0; j < NB; j++) this.kbT[i * NB + j] = this.kb[j] * k;
      if (!this.started) for (let j = 0; j < NB; j++) this.ks[i * NB + j] = this.kbT[i * NB + j];
    }
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < this.n; i++) this.refreshRgb(i);
    }
  }

  private refreshRgb(i: number): void {
    ksToRgb(this.ks, i * NB, this.tmp);
    this.rgb[i * 3] = this.tmp[0]; this.rgb[i * 3 + 1] = this.tmp[1]; this.rgb[i * 3 + 2] = this.tmp[2];
  }

  /** The canvas as it was before the stroke, premultiplied in linear light, averaged over three taps across a hair. */
  private sample(x: number, y: number, nx: number, ny: number, q: number, out: Float32Array): number {
    const { w, h, data, snap, tilesX } = this.c;
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let t = -1; t <= 1; t++) {
      const xx = Math.min(w - 1, Math.max(0, Math.round(x + nx * q * t))), yy = Math.min(h - 1, Math.max(0, Math.round(y + ny * q * t)));
      const tile = snap[(yy >> 6) * tilesX + (xx >> 6)];
      const src = tile ?? data, di = tile ? ((((yy & 63) << 6) | (xx & 63)) << 2) : (yy * w + xx) << 2, a = src[di + 3];
      if (a === 0) continue;
      const af = a / 255;
      sr += DEC[src[di]] * af; sg += DEC[src[di + 1]] * af; sb += DEC[src[di + 2]] * af; sa += af;
    }
    if (sa < 0.1) return 0;
    rgbToKs(ENCB[((sr / sa) * 4096) | 0], ENCB[((sg / sa) * 4096) | 0], ENCB[((sb / sa) * 4096) | 0], out, 0);
    return sa / 3;
  }

  step(s: BristleStep): void {
    const c = this.c, n = this.n, wet = this.wet;
    const { cx, cy, dia, dx, dy, pressure: P, travel, ds } = s;
    const nx = -dy, ny = dx;
    const half = dia * 0.5 * (1 + 0.2 * P);
    const amp = (0.04 + s.wobble) * dia;
    const kk = travel / (2.5 * Math.max(4, dia));
    const decay = (1 - wet.charge) * ds / (dia * 20);
    const pullT = 1 - Math.exp(-wet.pull * 1.6 * ds / dia);
    const atkT = wet.attack > 0 ? (1 - Math.exp(-wet.attack * 1.2 * ds / dia)) * 1.5 * Math.exp(-travel / (3 * dia)) : 0;
    const refill = (1 - Math.exp(-ds / (dia * 3))) * (1 - 0.7 * wet.pull) * 0.5;
    const dilK = 1 - wet.dilution * 0.5;
    const sk = s.speed * 0.3;
    const kc = this.kc, ks = this.ks;
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (let i = 0; i < n; i++) {
      const lat = this.u[i] * half + amp * (Math.sin(kk + this.phase[i]) * 0.6 + Math.sin(kk * 2.3 + this.phase[i] * 1.7) * 0.4);
      const hx = cx + nx * lat, hy = cy + ny * lat, wi = Math.max(1.3, (dia / n) * this.wf[i]);
      this.hx[i] = hx; this.hy[i] = hy; this.hw[i] = wi;
      // contact: stiff (short) hairs touch only at a harder press; a fast stroke lifts more of them
      const L = this.len[i];
      const contact = sstep(0, 0.3, P * (0.5 + 0.5 * L) - (1 - L) * 0.35 - sk);
      const ramp = sstep(this.start[i] * dia, this.start[i] * dia + 0.5 * dia, travel);
      // the paint on this hair: pick up the canvas under it, refill from the brush, run low with distance
      if (this.has && ds > 0) {
        if ((pullT > 0.001 || atkT > 0.001)) {
          const ac = this.sample(hx, hy, nx, ny, wi * 0.5, kc);
          if (ac > 0.02) {
            let pg = (kc[0] + kc[1] + kc[2] + kc[3] + kc[4] + kc[5]) * 0.4;
            pg = pg > 1 ? 1 : pg < 0.05 ? 0.05 : pg;
            // bare paper is no paint: it is not picked up (it would only turn the hair white)
            const p = Math.min(0.95, ac * (pullT + atkT) * sstep(0.008, 0.16, (kc[0] + kc[1] + kc[2] + kc[3] + kc[4] + kc[5]) / 6));
            const wo = (1 - p) * steer(ks, i * NB), wn = p * steer(kc, 0), iw = 1 / (wo + wn);
            for (let j = 0; j < NB; j++) ks[i * NB + j] = (ks[i * NB + j] * wo + kc[j] * wn) * iw;
            this.amt[i] = Math.min(1, this.amt[i] + 0.5 * p * pg);
          }
        }
        if (refill > 0.001) {
          const wo = (1 - refill) * steer(ks, i * NB), wn = refill * steer(this.kbT, i * NB), iw = 1 / (wo + wn);
          for (let j = 0; j < NB; j++) ks[i * NB + j] = (ks[i * NB + j] * wo + this.kbT[i * NB + j] * wn) * iw;
        }
        this.amt[i] = Math.max(0, this.amt[i] - decay);
        this.refreshRgb(i);
      }
      const a = this.amt[i];
      // a loaded brush lays paint close to opaque (flow is the paint on the brush, not a film of it)
      this.cap[i] = contact * ramp * Math.pow(a, 0.6) * Math.min(1, s.flow * dilK * 1.45);
      const r = wi * 0.5 + 2;
      const ax = this.has ? this.px[i] : hx, ay = this.has ? this.py[i] : hy;
      if (hx - r < bx0) bx0 = hx - r; if (ax - r < bx0) bx0 = ax - r;
      if (hy - r < by0) by0 = hy - r; if (ay - r < by0) by0 = ay - r;
      if (hx + r > bx1) bx1 = hx + r; if (ax + r > bx1) bx1 = ax + r;
      if (hy + r > by1) by1 = hy + r; if (ay + r > by1) by1 = ay + r;
    }
    const X0 = Math.max(0, Math.floor(bx0)), Y0 = Math.max(0, Math.floor(by0)), X1 = Math.min(c.w, Math.ceil(bx1)), Y1 = Math.min(c.h, Math.ceil(by1));
    if (X1 > X0 && Y1 > Y0) {
      c.touch(X0, Y0, X1, Y1);
      this.lay(s);
    }
    for (let i = 0; i < n; i++) { this.px[i] = this.hx[i]; this.py[i] = this.hy[i]; }
    this.has = true;
  }

  /** Lay every hair's capsule from its previous centre to its new one. */
  private lay(s: BristleStep): void {
    const c = this.c, n = this.n, { w, h, data, cov, sel, lock, tooth } = c;
    const kc = this.kc, km = this.km, tmp = this.tmp;
    const gk = s.grain, moving = s.moving, mv = s.movement, dx = s.dx, dy = s.dy;
    // grain coordinate: world anchored at movement 1; at lower values it slides with the brush and stretches along the path
    const ox = moving ? (1 - mv) * s.cx : 0, oy = moving ? (1 - mv) * s.cy : 0;
    const stretch = moving ? 1 + 2 * (1 - mv) : 1, inv = 1 / stretch;
    const bump = c.bump > 0 && tooth ? c.bump * 70 : 0, burnt = c.burnt;
    const opacity = s.opacity;
    let lastKey = -1, cSteer = 1, cPig = 0;
    for (let i = 0; i < n; i++) {
      const cap = this.cap[i];
      const ax = this.has ? this.px[i] : this.hx[i], ay = this.has ? this.py[i] : this.hy[i], bx = this.hx[i], by = this.hy[i];
      const rad = this.hw[i] * 0.5;
      if (cap < 0.004) continue;
      const a = this.amt[i];
      const dry = a < 0.35 ? sstep(0.1, 0.35, a) : 1, dryMix = a < 0.35;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, iL2 = L2 > 1e-6 ? 1 / L2 : 0;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad - 1)), x1 = Math.min(w, Math.ceil(Math.max(ax, bx) + rad + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad - 1)), y1 = Math.min(h, Math.ceil(Math.max(ay, by) + rad + 1));
      const hr = this.rgb[i * 3], hg = this.rgb[i * 3 + 1], hb = this.rgb[i * 3 + 2];
      const ksI = i * NB;
      for (let py = y0; py < y1; py++) {
        const dyp = py + 0.5 - ay;
        for (let px = x0; px < x1; px++) {
          const dxp = px + 0.5 - ax;
          let t = iL2 ? (dxp * vx + dyp * vy) * iL2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = dxp - vx * t, qy = dyp - vy * t;
          let cvg = rad + 0.5 - Math.sqrt(qx * qx + qy * qy);
          if (cvg <= 0) continue;
          if (cvg > 1) cvg = 1;
          let d = cap * cvg;
          if (tooth && (gk > 0 || dryMix)) {
            let tx = px, ty = py;
            if (moving && mv < 0.9) {
              const rx = px - ox, ry = py - oy;
              tx = ((rx * dx + ry * dy) * inv) | 0; ty = (-rx * dy + ry * dx) | 0;
            }
            // mirrored at the tile's edges, so a tile that is not seamless shows no seam along the stroke
            let mx = tx & 511, my = ty & 511;
            if (mx > 255) mx = 511 - mx;
            if (my > 255) my = 511 - my;
            const tv = tooth[(my << 8) | mx];
            d *= 1 - gk * 0.75 + gk * 0.75 * tv;
            if (dryMix) d *= dry * (0.5 + 0.5 * tv);
          }
          const idx = py * w + px;
          const c0 = cov[idx] / 65535;
          const delta = d - c0;
          if (delta < 0.004) continue;
          cov[idx] = (d * 65535 + 0.5) | 0;
          let wgt = (delta * opacity) / (1 - c0 * opacity);
          if (sel) wgt *= sel[idx] / 255;
          if (wgt <= 0.002) continue;
          if (wgt > 1) wgt = 1;
          const di = idx << 2, ca = data[di + 3] / 255;
          if (lock && ca === 0) continue;
          let pr = hr, pg = hg, pb = hb;
          if (ca > 0.004 && wgt < 0.985) {
            const cr = data[di], cg = data[di + 1], cb = data[di + 2], key = cr | (cg << 8) | (cb << 16);
            if (key !== lastKey) {
              rgbToKs(cr, cg, cb, kc, 0); lastKey = key;
              cSteer = steer(kc, 0);
              cPig = (kc[0] + kc[1] + kc[2] + kc[3] + kc[4] + kc[5]) * 0.25; if (cPig > 1) cPig = 1;
            }
            // pigment mix of the live pixel and the hair: its own earlier hairs are overwritten like real paint
            const wc = ca * (1 - wgt) * (1 + (cSteer - 1) * cPig), wn = wgt * steer(this.ks, ksI), iw = 1 / (wc + wn);
            let dd = 0, sm = 0.5;
            for (let j = 0; j < NB; j++) {
              const kh = this.ks[ksI + j];
              km[j] = (wc * kc[j] + wn * kh) * iw;
              dd += Math.abs(kc[j] - kh); sm += kc[j] + kh;
            }
            ksToRgb(km, 0, tmp);
            pr = tmp[0]; pg = tmp[1]; pb = tmp[2];
            // a coarse spectrum greys a mix of two different pigments: give a share of the chroma back
            const share = wgt * ca, lift = 1 + 1.4 * share * (1 - share) * (cPig * 3 > 1 ? 1 : cPig * 3) * (dd / sm);
            if (lift > 1.001) { const L = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb; pr = L + (pr - L) * lift; pg = L + (pg - L) * lift; pb = L + (pb - L) * lift; }
          }
          if (bump) { const dd2 = (tooth![((py & 255) << 8) | (px & 255)] - 0.5) * bump * wgt; pr += dd2; pg += dd2; pb += dd2; }
          if (burnt > 0) { const kb = 1 - (burnt * 0.85 * Math.pow(1 - cvg, 0.6)) * wgt; pr *= kb; pg *= kb; pb *= kb; }
          data[di] = pr; data[di + 1] = pg; data[di + 2] = pb;
          if (!lock) data[di + 3] = (ca + (1 - ca) * wgt) * 255 + 0.5;
        }
      }
    }
  }
}
