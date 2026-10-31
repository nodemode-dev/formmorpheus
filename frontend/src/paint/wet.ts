// Wet paint: a per-stroke reservoir (charge, dilution) that picks up the canvas colour under the stamp area,
// deposits into the canvas and drags paint along (pull), with pigments mixed in a pigment-like space.
//
// Colour mixing is a small Kubelka-Munk model written from the published idea: an RGB colour is lifted to a
// 6-band reflectance spectrum from three smooth basis curves that sum to white, reflectance is turned into
// K/S = (1 - R)^2 / 2R, pigments mix linearly in K/S, and the mix is turned back to RGB with the basis'
// pseudo-inverse. Blue and yellow therefore mix to green, not to grey. No outside code or data is used.
//
// The reservoir is a coarse grid in the stamp's own frame (like a brush's bristles carrying paint): each cell
// holds a K/S vector and an amount. Pure maths on typed arrays; the stroke engine calls prepare() then paint().

import type { RenderAlgo } from './render-modes';
import type { WetMix } from './types';

const NB = 6;
const FLOOR = 0.03;
const BR = [0.05, 0, 0.1, 0.22, 0.82, 0.9];
const BG = [0.05, 0.4, 0.7, 0.78, 0.15, 0];
const BB = [0.9, 0.6, 0.2, 0, 0.03, 0.1];

// M: pseudo-inverse of the 6 x 3 basis (3 x 6), so lift then lower is the identity on unclamped colours.
const M = new Float64Array(18);
(function init(): void {
  const B = [BR, BG, BB];
  const g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < NB; k++) s += B[i][k] * B[j][k]; g[i * 3 + j] = s; }
  const [a, b, c, d, e, f, gg, h, i2] = g;
  const det = a * (e * i2 - f * h) - b * (d * i2 - f * gg) + c * (d * h - e * gg);
  const inv = [
    (e * i2 - f * h) / det, (c * h - b * i2) / det, (b * f - c * e) / det,
    (f * gg - d * i2) / det, (a * i2 - c * gg) / det, (c * d - a * f) / det,
    (d * h - e * gg) / det, (b * gg - a * h) / det, (a * e - b * d) / det,
  ];
  for (let r = 0; r < 3; r++) for (let k = 0; k < NB; k++) M[r * NB + k] = inv[r * 3] * BR[k] + inv[r * 3 + 1] * BG[k] + inv[r * 3 + 2] * BB[k];
})();

const DEC = new Float32Array(256);
const ENC = new Uint8Array(4097);
for (let i = 0; i < 256; i++) { const c = i / 255; DEC[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
for (let i = 0; i <= 4096; i++) { const l = i / 4096; ENC[i] = Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); }

const byte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0);

/** RGB bytes to a K/S vector (6 values) at out[o..]. */
export function rgbToKs(r: number, g: number, b: number, out: ArrayLike<number> & { [i: number]: number }, o: number): void {
  const lr = DEC[byte(r)], lg = DEC[byte(g)], lb = DEC[byte(b)];
  for (let k = 0; k < NB; k++) {
    const s = FLOOR + (1 - FLOOR) * (lr * BR[k] + lg * BG[k] + lb * BB[k]);
    const t = s < FLOOR ? FLOOR : s > 1 ? 1 : s;
    out[o + k] = ((1 - t) * (1 - t)) / (2 * t);
  }
}

/** K/S vector at ks[o..] to RGB bytes in out[0..2]. */
export function ksToRgb(ks: ArrayLike<number>, o: number, out: { [i: number]: number }): void {
  let l0 = 0, l1 = 0, l2 = 0;
  for (let k = 0; k < NB; k++) {
    const x = ks[o + k];
    const R = 1 + x - Math.sqrt(x * x + 2 * x);
    const s0 = (R - FLOOR) / (1 - FLOOR);
    l0 += M[k] * s0; l1 += M[NB + k] * s0; l2 += M[2 * NB + k] * s0;
  }
  out[0] = ENC[l0 <= 0 ? 0 : l0 >= 1 ? 4096 : (l0 * 4096 + 0.5) | 0];
  out[1] = ENC[l1 <= 0 ? 0 : l1 >= 1 ? 4096 : (l1 * 4096 + 0.5) | 0];
  out[2] = ENC[l2 <= 0 ? 0 : l2 >= 1 ? 4096 : (l2 * 4096 + 0.5) | 0];
}

/** How strongly a pigment steers a mix: light, thin pigments (a yellow) steer more than dense dark ones, so yellow plus blue reads green. */
export function steer(ks: ArrayLike<number>, o: number): number {
  // x^-0.75 with two square roots (a pow call per pixel is too slow)
  const x = 0.25 + (ks[o] + ks[o + 1] + ks[o + 2] + ks[o + 3] + ks[o + 4] + ks[o + 5]) * (1 / 6);
  const r = Math.sqrt(x);
  return 1 / (r * Math.sqrt(r));
}

/** Mix two colours (bytes) by pigment: t is the share of b. Used by tests and previews. */
export function mixPigment(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const ka = new Float32Array(NB), kb = new Float32Array(NB), km = new Float32Array(NB), o = [0, 0, 0];
  rgbToKs(a[0], a[1], a[2], ka, 0); rgbToKs(b[0], b[1], b[2], kb, 0);
  const wa = (1 - t) * steer(ka, 0), wb = t * steer(kb, 0);
  for (let k = 0; k < NB; k++) km[k] = (ka[k] * wa + kb[k] * wb) / (wa + wb);
  ksToRgb(km, 0, o);
  return [o[0], o[1], o[2]];
}

/** What the stroke engine hands to paint() for one stamp. */
export interface WetStamp {
  x0: number; y0: number; x1: number; y1: number;
  ab: Float32Array; bw: number;
  cov: Uint16Array; w: number;
  sel: Uint8Array | null;
  lock: boolean;
  opacity: number;
  cx: number; cy: number;
  /** Relief tooth tile (256 x 256) and its strength in bytes, or null. */
  tooth: Float32Array | null; bump: number;
  burnt: number;
  /** The stamp's full alpha, for the burnt-edge falloff. */
  peak: number;
  /** The stroke's 64 px undo tiles: the untouched pixels, which a glaze film is laid over. */
  snap: (Uint8ClampedArray | undefined)[];
  tilesX: number;
}

export interface WetOptions {
  algo: RenderAlgo;
  wet: WetMix | null;
  wetEdges: number;
  baseDia: number;
  rng: () => number;
}

const DENSE_MIN = 0.0004;
/** Floats per reservoir cell. */
const CS = 10;

export class WetPaint {
  private readonly G: number;
  private readonly cell: Float32Array;       // G * G * 10: six K/S values, the amount, then the cell's colour (bytes) for cheap drags
  private readonly fixed: boolean;           // no grid: the reservoir is just the brush colour
  private readonly algo: RenderAlgo;
  private readonly wet: WetMix;
  private readonly we: number;
  private readonly rng: () => number;
  private readonly kb = new Float32Array(NB);
  private bR = -1; private bG = -1; private bB = -1;
  private started = false;
  private load = 1;
  private span = 1;
  private cx = 0; private cy = 0;
  private stepF = 1;
  private dilScale = 1;
  private dragRate = 0;
  private colI = new Int32Array(0);
  private colW = new Float32Array(0);
  private readonly kr = new Float32Array(NB);
  private readonly kc = new Float32Array(NB);
  private readonly km = new Float32Array(NB);
  private readonly rgb = [0, 0, 0];

  constructor(private readonly w: number, private readonly h: number, private readonly data: Uint8ClampedArray, o: WetOptions) {
    this.algo = o.algo;
    this.wet = o.wet ?? o.algo.wet ?? { dilution: 0, charge: 1, attack: 0, pull: 0, grade: 0.5 };
    this.we = o.wetEdges;
    this.rng = o.rng;
    // glaze films never pick paint up, so without a wet mix of their own they need no grid
    this.fixed = this.algo.glaze && !o.wet;
    this.G = this.fixed ? 1 : Math.max(5, Math.min(32, Math.ceil((o.baseDia * 1.2) / 4)));
    this.cell = new Float32Array(this.G * this.G * CS);
  }

  /** Set the colour of the paint on the brush (called per dab, colour dynamics move it). */
  setColour(r: number, g: number, b: number): void {
    if (r === this.bR && g === this.bG && b === this.bB) return;
    this.bR = r; this.bG = g; this.bB = b;
    rgbToKs(r, g, b, this.kb, 0);
  }

  /** Per dab, before painting: refill from the brush, pick the canvas colour up into the reservoir. */
  prepare(cx: number, cy: number, dia: number, travel: number, spacing: number): void {
    const wet = this.wet;
    this.cx = cx; this.cy = cy;
    this.span = dia * 1.15;
    const stepF = Math.min(1, spacing * 3);
    this.stepF = stepF;
    const dil = Math.min(1, wet.dilution * (wet.wetJitter ? 1 - wet.wetJitter * this.rng() : 1));
    this.dilScale = 1 - dil * 0.5;
    this.dragRate = wet.pull * stepF * 0.12;
    const cell = this.cell, G = this.G, kb = this.kb;
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < G * G; i++) { for (let k = 0; k < NB; k++) cell[i * CS + k] = kb[k]; cell[i * CS + 6] = 1; }
    }
    if (this.fixed) return;
    this.load = Math.max(0, this.load - (1 - wet.charge) * 0.05 * stepF);
    const rf = Math.min(1, this.load * 0.28 * stepF);
    const attack = wet.attack * Math.max(0, 1 - travel / (dia * 3));
    const pick = Math.min(0.9, (attack * 0.9 + wet.pull * 0.8) * stepF * 0.9 + (this.algo.glaze ? 0 : 0.02));
    const blur = wet.blur ? wet.blur * (wet.blurJitter ? 1 - wet.blurJitter * 0.9 * this.rng() : 1) : wet.blurJitter ? 1 - wet.blurJitter * 0.9 * this.rng() : 0;
    const { w, h, data } = this;
    const span = this.span, cs = span / G, q = cs * (0.25 + blur * 1.5);
    const kc = this.kc;
    for (let j = 0; j < G; j++) {
      const v = (j + 0.5) / G - 0.5;
      for (let i = 0; i < G; i++) {
        const o = (j * G + i) * CS;
        // refill toward the brush's own paint
        if (rf > 0) {
          for (let k = 0; k < NB; k++) cell[o + k] += (kb[k] - cell[o + k]) * rf;
          cell[o + 6] += (this.load - cell[o + 6]) * rf;
        }
        if (pick <= 0.002) continue;
        const u = (i + 0.5) / G - 0.5;
        const rn = Math.hypot(u, v) * 2;
        const wr = rn >= 1.15 ? 0 : rn < 0.75 ? 1 : (1.15 - rn) / 0.4;
        if (wr <= 0) continue;
        // area sample: four taps around the cell centre, premultiplied in linear light
        let sr = 0, sg = 0, sb = 0, sa = 0;
        const px = cx + u * span, py = cy + v * span;
        for (let t = 0; t < 4; t++) {
          const xx = Math.min(w - 1, Math.max(0, Math.round(px + ((t & 1) ? q : -q)))), yy = Math.min(h - 1, Math.max(0, Math.round(py + ((t & 2) ? q : -q))));
          const di = (yy * w + xx) << 2, a = data[di + 3];
          if (a === 0) continue;
          const af = a / 255;
          sr += DEC[data[di]] * af; sg += DEC[data[di + 1]] * af; sb += DEC[data[di + 2]] * af; sa += af;
        }
        if (sa < 0.05) continue;
        const lr = sr / sa, lg = sg / sa, lb = sb / sa;
        // linear to bytes to K/S (the lift takes bytes)
        rgbToKs(ENC[(lr * 4096) | 0], ENC[(lg * 4096) | 0], ENC[(lb * 4096) | 0], kc, 0);
        // paper-white picks up as barely any pigment (it would only dilute the stroke)
        let pg = (kc[0] + kc[1] + kc[2] + kc[3] + kc[4] + kc[5]) * 0.4;
        pg = pg > 1 ? 1 : pg < 0.02 ? 0.02 : pg;
        const add = pick * sa * wr * pg;
        const A = cell[o + 6];
        const tot = A + add;
        for (let k = 0; k < NB; k++) cell[o + k] = (cell[o + k] * A + kc[k] * add) / tot;
        cell[o + 6] = Math.min(1, A + add * 0.5);
      }
    }
    if (this.dragRate > 0) {
      // each cell's colour in bytes, for the cheap drag path
      const out = this.rgb;
      for (let i = 0; i < G * G; i++) {
        ksToRgb(cell, i * CS, out);
        cell[i * CS + 7] = out[0]; cell[i * CS + 8] = out[1]; cell[i * CS + 9] = out[2];
      }
    }
  }

  /** Paint one stamp's pixels. */
  paint(s: WetStamp): void {
    const { data, w } = this;
    const { x0, y0, x1, y1, ab, bw, cov, sel, lock, opacity, cx, cy } = s;
    const algo = this.algo, G = this.G, cell = this.cell, fixed = this.fixed;
    const kr = this.kr, kc = this.kc, km = this.km, rgb = this.rgb, kb = this.kb;
    const we = this.we, keep = Math.min(0.8, algo.keep + this.wet.pull * 0.2 + this.wet.attack * 0.1), gain = algo.gain;
    let cPig = 0, cSteer = 1;
    const stacking = algo.glaze && !!algo.stack, snap = s.snap, tilesX = s.tilesX;
    const grade = (this.wet.grade - 0.5) * 2;
    const dil = this.dilScale, drag = this.dragRate;
    const tooth = s.bump > 0 ? s.tooth : null, bump = s.bump;
    const peak = Math.max(0.001, s.peak);
    const inv = G / this.span;
    if (this.colI.length < bw) { this.colI = new Int32Array(bw * 2); this.colW = new Float32Array(bw * 2); }
    const colI = this.colI, colW = this.colW;
    if (!fixed) {
      for (let px = x0; px < x1; px++) {
        let u = (px + 0.5 - cx) * inv - 0.5;
        u = u < 0 ? 0 : u > G - 1 ? G - 1 : u;
        let i0 = u | 0;
        if (i0 > G - 2) i0 = Math.max(0, G - 2);
        colI[px - x0] = i0; colW[px - x0] = G > 1 ? u - i0 : 0;
      }
    }
    let lastKey = -1;
    for (let py = y0; py < y1; py++) {
      const rowO = (py - y0) * bw - x0;
      let j0 = 0, wy = 0;
      if (!fixed) {
        let v = (py + 0.5 - cy) * inv - 0.5;
        v = v < 0 ? 0 : v > G - 1 ? G - 1 : v;
        j0 = v | 0;
        if (j0 > G - 2) j0 = Math.max(0, G - 2);
        wy = G > 1 ? v - j0 : 0;
      }
      for (let px = x0; px < x1; px++) {
        const a = ab[rowO + px];
        if (a < DENSE_MIN) continue;
        const idx = py * w + px;
        const c0 = cov[idx] / 65535;
        let c: number;
        if (algo.uniform) c = a > c0 ? (a > 1 ? 1 : a) : c0;
        else { const aa = a * algo.k; c = c0 + (1 - c0) * (aa > 1 ? 1 : aa); }
        cov[idx] = (c * 65535 + 0.5) | 0;
        const am = a > 1 ? 1 : a;
        const dCov = (c - c0) * opacity;
        // pull drags even where the stroke has no new coverage
        let dragT = drag > 0 ? drag * am * opacity : 0;
        if (dCov <= 0.00005 && dragT <= 0.0005) continue;
        if (dCov <= 0.00005 && !fixed) {
          // drag only: nudge the live pixel toward the reservoir's colour (a cheap byte lerp, no pigment maths)
          const i0 = colI[px - x0], wx = colW[px - x0];
          const o00 = (j0 * G + i0) * CS, o10 = o00 + G * CS;
          const w00 = (1 - wx) * (1 - wy), w01 = wx * (1 - wy), w10 = (1 - wx) * wy, w11 = wx * wy;
          const Ad = cell[o00 + 6] * w00 + cell[o00 + CS + 6] * w01 + cell[o10 + 6] * w10 + cell[o10 + CS + 6] * w11;
          let wd = dragT * (Ad * 1.5 > 1 ? 1 : Ad * 1.5);
          if (sel) wd *= sel[idx] / 255;
          if (wd <= 0.0005) continue;
          const di2 = idx << 2, ca2 = data[di2 + 3] / 255;
          if (lock && ca2 === 0) continue;
          const tr = cell[o00 + 7] * w00 + cell[o00 + CS + 7] * w01 + cell[o10 + 7] * w10 + cell[o10 + CS + 7] * w11;
          const tg = cell[o00 + 8] * w00 + cell[o00 + CS + 8] * w01 + cell[o10 + 8] * w10 + cell[o10 + CS + 8] * w11;
          const tb = cell[o00 + 9] * w00 + cell[o00 + CS + 9] * w01 + cell[o10 + 9] * w10 + cell[o10 + CS + 9] * w11;
          if (ca2 < 0.002) { data[di2] = tr; data[di2 + 1] = tg; data[di2 + 2] = tb; } else {
            data[di2] += (tr - data[di2]) * wd; data[di2 + 1] += (tg - data[di2 + 1]) * wd; data[di2 + 2] += (tb - data[di2 + 2]) * wd;
          }
          if (!lock) data[di2 + 3] = (ca2 + (1 - ca2) * wd) * 255 + 0.5;
          continue;
        }
        let f = dCov > 0.00005 ? dCov / (1 - c0 * opacity) : 0;
        // reservoir at this pixel
        let A: number;
        if (fixed) {
          for (let k = 0; k < NB; k++) kr[k] = kb[k];
          A = this.load;
        } else {
          const i0 = colI[px - x0], wx = colW[px - x0];
          const o00 = (j0 * G + i0) * CS, o10 = o00 + G * CS;
          const w00 = (1 - wx) * (1 - wy), w01 = wx * (1 - wy), w10 = (1 - wx) * wy, w11 = wx * wy;
          for (let k = 0; k < NB; k++) kr[k] = cell[o00 + k] * w00 + cell[o00 + CS + k] * w01 + cell[o10 + k] * w10 + cell[o10 + CS + k] * w11;
          A = cell[o00 + 6] * w00 + cell[o00 + CS + 6] * w01 + cell[o10 + 6] * w10 + cell[o10 + CS + 6] * w11;
        }
        if (sel) { const sv = sel[idx] / 255; f *= sv; dragT *= sv; }
        // chunky (grade above 0.5) or flat (below) deposit
        if (grade !== 0 && f > 0) f += grade * (f * f * (3 - 2 * f) - f);
        const Am = A > 1 ? 1 : A;
        let t = f * Am;
        if (dragT > 0) t += dragT * (Am * 1.5 > 1 ? 1 : Am * 1.5) * (1 - t);
        if (t <= 0.0003) continue;
        if (t > 1) t = 1;
        // pigment strength: dilution thins it, wet edges pool it at the rim and lighten the centre
        let ps = dil;
        if (we > 0) ps *= 1 + we * (1.8 * Math.pow(1 - am, 1.5) - 0.5 * am * am * am);
        const di = idx << 2;
        // a glaze lays ONE film over the untouched pixel (from the undo tile), so its own overlaps never stack
        // Blending is the same: the mix is made against the untouched pixel with the reservoir's current
        // paint (which already holds what was picked up), so a stroke keeps a share of what is under it and
        // never wears it away by repeated dabs. Pull then drags on top, dab by dab, from the live pixel.
        let src: Uint8ClampedArray = data, so = di, dg = 0;
        if (dCov > 0.00005 && !stacking) {
          src = snap[(py >> 6) * tilesX + (px >> 6)]!;
          so = (((py & 63) << 6) | (px & 63)) << 2;
          let film = c * opacity * Am * (sel ? sel[idx] / 255 : 1);
          if (grade !== 0) film += grade * (film * film * (3 - 2 * film) - film);
          t = film > 1 ? 1 : film;
          if (dragT > 0) dg = dragT * (Am * 1.5 > 1 ? 1 : Am * 1.5);
        }
        const ca = src[so + 3] / 255;
        if (lock && ca === 0) continue;
        const cr = src[so], cg = src[so + 1], cb = src[so + 2];
        let lift = 1;
        if (ca < 0.002) {
          for (let k = 0; k < NB; k++) km[k] = kr[k] * ps;
        } else {
          const key = cr | (cg << 8) | (cb << 16);
          if (key !== lastKey) {
            rgbToKs(cr, cg, cb, kc, 0); lastKey = key;
            cPig = (kc[0] + kc[1] + kc[2] + kc[3] + kc[4] + kc[5]) * 0.25;
            if (cPig > 1) cPig = 1;
            cSteer = steer(kc, 0);
          }
          if (algo.glaze) {
            // the new film's absorption adds to what is there (stacking glazes add each dab's share)
            const tf = algo.stack ? dCov * Am * (sel ? sel[idx] / 255 : 1) : t;
            for (let k = 0; k < NB; k++) km[k] = ca * (kc[k] + tf * kr[k] * ps * gain) + (1 - ca) * kr[k] * ps;
          } else {
            // bare paper (no pigment) takes no part in the steering or the retention
            const pig = cPig, wc = ca * (1 - t * (1 - keep * pig)), wn = t, share = wn / (wc + wn);
            const wc2 = wc * (1 + (cSteer - 1) * pig), wn2 = wn * (1 + (steer(kr, 0) - 1) * pig), ws = 1 / (wc2 + wn2);
            let dd = 0, sm = 0.5;
            for (let k = 0; k < NB; k++) {
              km[k] = (wc2 * kc[k] + wn2 * kr[k] * ps) * ws;
              dd += Math.abs(kc[k] - kr[k] * ps); sm += kc[k] + kr[k] * ps;
            }
            // only pigments that differ lose chroma in the mix
            lift = 1 + 0.45 * 4 * share * (1 - share) * pig * (dd / sm);
          }
        }
        if (dg > 0) {
          for (let k = 0; k < NB; k++) km[k] += (kr[k] * ps - km[k]) * dg;
          t += dg * (1 - t);
        }
        ksToRgb(km, 0, rgb);
        let pr = rgb[0], pg = rgb[1], pb = rgb[2];
        if (lift > 1.001) {
          // mixed pigments lose chroma in a coarse spectrum; give a share of it back
          const L = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
          pr = L + (pr - L) * lift; pg = L + (pg - L) * lift; pb = L + (pb - L) * lift;
        }
        if (tooth) {
          const d = (tooth[((py & 255) << 8) | (px & 255)] - 0.5) * bump * 70;
          pr += d; pg += d; pb += d;
        }
        if (s.burnt > 0) {
          const kk = 1 - s.burnt * 0.85 * Math.pow(1 - (a > peak ? 1 : a / peak), 0.6);
          pr *= kk; pg *= kk; pb *= kk;
        }
        data[di] = pr; data[di + 1] = pg; data[di + 2] = pb;
        if (!lock) {
          const na = ca + (1 - ca) * t;
          data[di + 3] = na * 255 + 0.5;
        }
      }
    }
  }
}
