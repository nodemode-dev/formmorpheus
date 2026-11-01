// Materials beyond relief: shine and depth for thick, impasto-like strokes. When a stroke ends its coverage is
// read as a height field (rounded at the rim, plus the grain's tooth), lit from a chosen angle, and the light is
// baked into the pixels: a lit side, a shaded side, a specular glint (gloss) and a metallic sheen that tints the
// glint with the paint's own colour. Pure maths on typed arrays; the stroke engine calls it from finish().

import type { Shine } from './types';

export const DEFAULT_LIGHT = 135;

/** True when a brush's material does anything. */
export function hasShine(s: Shine | undefined): s is Shine {
  return !!s && (s.depth > 0.001 || s.gloss > 0.001 || s.metal > 0.001);
}

export interface ShineRect { x0: number; y0: number; x1: number; y1: number }

export interface ShineOptions {
  /** The stroke's diameter in canvas pixels: wide strokes get a wider, rounder ridge. */
  baseDia: number;
  /** 256 x 256 grain tile (0 to 1), added to the height when the brush has grain. */
  tooth: Float32Array | null;
  /** The brush's relief strength (0 to 1): how much of the grain reads as height. */
  bump: number;
  sel: Uint8Array | null;
  lock: boolean;
}

let hBuf: Float32Array | null = null;
let tBuf: Float32Array | null = null;
let shineIdle = 0;

/** The work buffers are sized to the biggest bake so far (a whole UHD layer is 66 MB each): freed after a quiet spell. */
function touchShineBuffers(): void {
  if (shineIdle) clearTimeout(shineIdle);
  shineIdle = setTimeout(() => { shineIdle = 0; hBuf = null; tBuf = null; }, 4000) as unknown as number;
}

/** Box blur of a rect-sized float buffer, radius r, edge-clamped, in place (two passes: rows then columns). */
function blur(h: Float32Array, t: Float32Array, rw: number, rh: number, r: number): void {
  const n = 2 * r + 1;
  for (let y = 0; y < rh; y++) {
    const o = y * rw;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += h[o + Math.min(rw - 1, Math.max(0, k))];
    for (let x = 0; x < rw; x++) {
      t[o + x] = acc / n;
      acc += h[o + Math.min(rw - 1, x + r + 1)] - h[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < rw; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += t[Math.min(rh - 1, Math.max(0, k)) * rw + x];
    for (let y = 0; y < rh; y++) {
      h[y * rw + x] = acc / n;
      acc += t[Math.min(rh - 1, y + r + 1) * rw + x] - t[Math.max(0, y - r) * rw + x];
    }
  }
}

/**
 * Light the stroke's pixels. `cov` is the stroke's 16-bit coverage, `rect` its dirty rectangle (exclusive max).
 * Reads the height from coverage, writes only RGB of pixels the stroke covered.
 */
export function bakeShine(data: Uint8ClampedArray, w: number, h: number, cov: Uint16Array, rect: ShineRect, s: Shine, o: ShineOptions): void {
  // one pixel of margin so the rim has a gradient
  const x0 = Math.max(0, rect.x0 - 1), y0 = Math.max(0, rect.y0 - 1), x1 = Math.min(w, rect.x1 + 1), y1 = Math.min(h, rect.y1 + 1);
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 2 || rh < 2) return;
  const n = rw * rh;
  if (!hBuf || hBuf.length < n) { hBuf = new Float32Array(n * 2); tBuf = new Float32Array(n * 2); }
  const H = hBuf, T = tBuf!;
  touchShineBuffers();
  const depth = s.depth, gloss = s.gloss, metal = s.metal;
  const tooth = o.tooth && o.bump > 0 ? o.tooth : null;
  const rb = Math.max(1, Math.min(14, Math.round(o.baseDia * (0.1 + 0.12 * metal))));
  for (let y = 0; y < rh; y++) {
    const ro = (y + y0) * w + x0;
    for (let x = 0; x < rw; x++) H[y * rw + x] = cov[ro + x] / 65535;
  }
  if (rw > 2 * rb + 2 && rh > 2 * rb + 2) blur(H, T, rw, rh, rb);
  // height in pixels: a thick ridge for depth, a gloss-only stroke still gets a gentle swell so the glint has a surface
  const hk = 2 + depth * 10 + gloss * 2;
  const tk = tooth ? o.bump * (0.6 + depth * 2.2) : 0;
  const a = ((s.light ?? DEFAULT_LIGHT) * Math.PI) / 180;
  // the light comes from (cos a, -sin a) on the screen, 50 degrees above the page
  const lz0 = 0.766, lxy = 0.643;
  const lx = Math.cos(a) * lxy, ly = -Math.sin(a) * lxy, lz = lz0;
  let hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
  const pow = 8 + gloss * gloss * 120;
  const specK = gloss * (0.55 + 0.45 * metal) * 255;
  const diffK = 0.5 + depth * 0.9 + metal * 0.3;
  const flat = lz;
  for (let y = 1; y < rh - 1; y++) {
    const py = y + y0;
    for (let x = 1; x < rw - 1; x++) {
      const px = x + x0, idx = py * w + px;
      const c = cov[idx];
      if (c === 0) continue;
      const i = y * rw + x;
      let gx = (H[i + 1] - H[i - 1]) * 0.5 * hk, gy = (H[i + rw] - H[i - rw]) * 0.5 * hk;
      if (tooth) {
        const tx = (px & 255), ty = (py & 255);
        gx += (tooth[(ty << 8) | ((tx + 1) & 255)] - tooth[(ty << 8) | ((tx - 1) & 255)]) * 0.5 * tk;
        gy += (tooth[(((ty + 1) & 255) << 8) | tx] - tooth[(((ty - 1) & 255) << 8) | tx]) * 0.5 * tk;
      }
      // normal (-gx, -gy, 1) normalised
      const il = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const nx = -gx * il, ny = -gy * il, nz = il;
      const dif = (nx * lx + ny * ly + nz * lz - flat) * diffK;
      let sp = nx * hx + ny * hy + nz * hz;
      sp = sp <= 0 ? 0 : Math.pow(sp, pow);
      // a metal reflects its surroundings: a soft broad sheen along the lit slopes, dark on the shaded ones
      // (banded by the slope like a mirror of a sky and a horizon, strongest where the surface is steep)
      const slope = Math.min(1, (gx * gx + gy * gy) * 4);
      const sheen = metal * (dif * 0.5 + Math.sin((nx * lx + ny * ly) * 9) * 0.28 * slope);
      let wgt = (c / 65535) * (data[idx * 4 + 3] / 255);
      if (o.sel) wgt *= o.sel[idx] / 255;
      if (wgt <= 0.001) continue;
      if (o.lock && data[idx * 4 + 3] === 0) continue;
      const di = idx * 4;
      const r = data[di], g = data[di + 1], b = data[di + 2];
      // the shaded side darkens the paint, it never goes black (a steep metal slope drove k below zero: a black offset line)
      // a polished metal tube: the shaded side only softens (no dark offset line), the lit side gets the bright band
      let sh = dif + sheen;
      if (sh < 0) sh *= 1 - 0.75 * metal;
      const k = Math.max(0.55 + 0.3 * metal, 1 + sh * wgt);
      // specular colour: white for a plastic gloss, the paint's own colour (lifted) for a metal
      const sr = sp * specK * wgt, spc = 1 - metal;
      data[di] = r * k + sr * (spc + metal * (r / 255 * 0.6 + 0.4));
      data[di + 1] = g * k + sr * (spc + metal * (g / 255 * 0.6 + 0.4));
      data[di + 2] = b * k + sr * (spc + metal * (b / 255 * 0.6 + 0.4));
    }
  }
}
