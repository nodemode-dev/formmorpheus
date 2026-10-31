// What a wet wash does as it dries, applied once when the stroke ends: pigment pools at the rim of the stroke
// (a darker, crisper edge) and settles into the valleys of the paper (granulation). Both are a change of the film's
// thickness m, applied as transmittance^m on the paint the stroke laid, so on paper the edge deepens in colour and on
// a transparent layer it gains alpha. Pure typed-array maths; deterministic (no random numbers).

import type { Brush } from './types';
import { RENDER_ALGOS } from './render-modes';

export interface DryOptions {
  data: Uint8ClampedArray;
  w: number;
  /** Dirty box, max exclusive. */
  x0: number; y0: number; x1: number; y1: number;
  /** The stroke's coverage, 16 bit, one per pixel of the layer. */
  cov: Uint16Array;
  /** The stroke's untouched 64 px tiles (what the pixels were before the stroke). */
  snap: (Uint8ClampedArray | undefined)[];
  tilesX: number;
  /** 0 to 1 rim pooling (the brush's wet edges). */
  pool: number;
  /** 0 to 1 granulation from the paper tooth. */
  gran: number;
  /** Rim band width in pixels. */
  radius: number;
  /** 256 x 256 paper tooth, 0 (valley) to 1 (peak), canvas anchored. */
  tooth: Float32Array | null;
  lock: boolean;
  sel: Uint8Array | null;
  /** The stroke's coverage normalised to each dab's own flow (255 = a full dab), one byte per pixel of the layer: the wash's shape. */
  edge: Uint8Array | null;
  /** Pen-up bead: a disc where the last dab sat, t the extra thickness it holds (0..1). */
  end?: { x: number; y: number; r: number; t: number };
  /** More beads: where the pen rested mid-stroke. */
  ends?: { x: number; y: number; r: number; t: number }[];
  /** How wet each pixel of the rect still was when the stroke began (paint/wetmap.ts), or null. */
  wetw?: Float32Array | null;
}

/** True when the brush's stroke is reworked over its whole rectangle when it ends (the worker must send that rectangle back). */
export function dries(b: Brush): boolean {
  return (b.wetEdges ?? 0) > 0 || (!!b.render && RENDER_ALGOS[b.render].glaze && b.grain >= 0.3);
}

const sstep = (a: number, b: number, x: number): number => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

/** Box blur of a rw x rh float map with a radius, zero outside the map (running sums, O(area)). */
function boxBlur(src: Float32Array, rw: number, rh: number, r: number): Float32Array {
  if (!scratch || scratch.length < rw * rh) scratch = new Float32Array(rw * rh);
  const tmp = scratch, out = new Float32Array(rw * rh);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < rh; y++) {
    const o = y * rw;
    let s = 0;
    for (let x = 0; x <= r && x < rw; x++) s += src[o + x];
    for (let x = 0; x < rw; x++) {
      tmp[o + x] = s * inv;
      const add = x + r + 1, sub = x - r;
      if (add < rw) s += src[o + add];
      if (sub >= 0) s -= src[o + sub];
    }
  }
  // the column pass walks whole rows with one running sum per column (cache friendly on a wide stroke)
  const acc = new Float32Array(rw);
  for (let y = 0; y <= r && y < rh; y++) { const o = y * rw; for (let x = 0; x < rw; x++) acc[x] += tmp[o + x]; }
  for (let y = 0; y < rh; y++) {
    const o = y * rw;
    for (let x = 0; x < rw; x++) out[o + x] = acc[x] * inv;
    const add = y + r + 1, sub = y - r;
    if (add < rh) { const a = add * rw; for (let x = 0; x < rw; x++) acc[x] += tmp[a + x]; }
    if (sub >= 0) { const s = sub * rw; for (let x = 0; x < rw; x++) acc[x] -= tmp[s + x]; }
  }
  return out;
}
let scratch: Float32Array | null = null;

/** The stroke's rectangle is worked in blocks, and only the blocks the stroke touches: a long diagonal stroke's box is mostly empty. */
export function dryWash(o: DryOptions): void {
  const { x0, y0, x1, y1, cov, w, pool, gran, tooth } = o;
  if (x1 <= x0 || y1 <= y0 || (pool <= 0 && (gran <= 0 || !tooth))) return;
  const B = 192;
  for (let by = y0; by < y1; by += B) {
    for (let bx = x0; bx < x1; bx += B) {
      const ex = Math.min(x1, bx + B), ey = Math.min(y1, by + B);
      let any = false;
      for (let y = by; y < ey && !any; y++) { const co = y * w; for (let x = bx; x < ex; x++) if (cov[co + x] > 250) { any = true; break; } }
      if (any) dryBlock(o, bx, by, ex, ey);
    }
  }
  if (o.wetw && !o.lock && pool > 0) bleed(o);
}

/** One block (ax0..ax1, ay0..ay1): its maps are made over the block plus a margin wide enough for the blurs, and only the block is changed. */
function dryBlock(o: DryOptions, ax0: number, ay0: number, ax1: number, ay1: number): void {
  const { data, w, cov, snap, tilesX, pool, gran, tooth, lock, sel } = o;
  const R0 = Math.max(1, Math.round(o.radius)), pad = pool > 0 ? Math.round(R0 * 3.3) + 3 : 0;
  const x0 = Math.max(o.x0, ax0 - pad), y0 = Math.max(o.y0, ay0 - pad), x1 = Math.min(o.x1, ax1 + pad), y1 = Math.min(o.y1, ay1 + pad);
  const rw = x1 - x0, rh = y1 - y0, orw = o.x1 - o.x0;
  // The wash's shape: its coverage (each dab's own flow = 1), blurred a little and cut to a crisp mask. Pigment
  // gathers where the mask is thin inside (the rim), and the interior gives up a little (pigment is conserved).
  let rim: Float32Array | null = null;     // 0 deep inside, 1 at the rim
  let sharp: Float32Array | null = null;   // how much of its film a pixel keeps once the soft tail is cut
  let body: Float32Array | null = null;    // the crisp mask
  if (pool > 0) {
    const E = o.edge, f0 = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      const co = (y0 + y) * w + x0;
      for (let x = 0; x < rw; x++) f0[y * rw + x] = E ? E[co + x] / 255 : sstep(0.02, 0.22, cov[co + x] / 65535);
    }
    const R = Math.max(1, Math.round(o.radius));
    const B = boxBlur(f0, rw, rh, Math.max(1, Math.round(R * 0.25)));
    body = new Float32Array(rw * rh);
    sharp = new Float32Array(rw * rh);
    for (let i = 0; i < body.length; i++) {
      body[i] = sstep(0.3, 0.55, B[i]);
      // cutting the soft tail of the tip: faint edge pixels fade, mid ones rise to the interior's film
      sharp[i] = Math.min(2.2, sstep(0.2, 0.55, B[i]) / Math.max(0.08, B[i]));
    }
    const inner = boxBlur(body, rw, rh, R);
    rim = new Float32Array(rw * rh);
    for (let i = 0; i < rim.length; i++) {
      const e = Math.min(1, Math.max(0, body[i] * (1 - inner[i]) * 2));
      rim[i] = e * Math.sqrt(Math.sqrt(e));
    }
  }
  const end = o.end, ends = o.ends && o.ends.length ? o.ends : null, wetw = o.wetw;
  for (let py = ay0; py < ay1; py++) {
    const y = py - y0, co = py * w, trow = (py >> 6) * tilesX, yo = (py & 63) << 6;
    for (let px = ax0; px < ax1; px++) {
      const c = cov[co + px] / 65535;
      if (c < 0.004) continue;
      const i = y * rw + (px - x0);
      let m = 1;
      if (pool > 0) {
        const e = rim![i], bd = body![i];
        // thickness: the rim holds ~2.2x at full wet edges, the interior ~0.8x; the soft tail of the tip is cut
        m = (1 + pool * 2.6 * e - pool * 0.25 * (1 - e) * bd) * (1 + (sharp![i] - 1) * 0.6 * pool);
        // over a wet wash the edge is not sharpened and pigment does not pool: it runs
        if (wetw) m = 1 + (m - 1) * (1 - 0.8 * wetw[(py - o.y0) * orw + (px - o.x0)]);
      }
      if (end) {
        const dd = Math.hypot(px + 0.5 - end.x, py + 0.5 - end.y) / end.r;
        if (dd < 1) m += end.t * (1 - dd * dd);
      }
      if (ends) for (const q of ends) {
        const dd = Math.hypot(px + 0.5 - q.x, py + 0.5 - q.y) / q.r;
        if (dd < 1) m += q.t * (1 - dd * dd);
      }
      if (gran > 0 && tooth) m *= 1 + gran * (0.5 - tooth[(((py * 2) & 255) << 8) | ((px * 2 + (py & 1)) & 255)]) * 0.8;
      if (sel) m = 1 + (m - 1) * (sel[py * w + px] / 255);
      m = m < 0.05 ? 0.05 : m > 4 ? 4 : m;
      if (Math.abs(m - 1) < 0.01) continue;
      const t = snap[trow + (px >> 6)];
      if (!t) continue;
      const so = (yo | (px & 63)) << 2, di = (py * w + px) << 2;
      const sa = t[so + 3] / 255, da = data[di + 3] / 255;
      if (sa > 0.02) {
        for (let k = 0; k < 3; k++) {
          const s = t[so + k], d = data[di + k];
          if (s < 6) continue;
          const ratio = d >= s ? 1 : d / s;
          const target = s * Math.pow(ratio, m);
          data[di + k] = d + (target - d) * (sa > 1 ? 1 : sa);
        }
      }
      if (!lock && da > sa + 0.002 && sa < 0.999) {
        const film = (da - sa) / (1 - sa);
        const f2 = 1 - Math.pow(1 - (film > 1 ? 1 : film), m);
        data[di + 3] = (sa + (1 - sa) * f2) * 255 + 0.5;
      }
    }
  }
}

/** A wash laid over a still-wet one: colour and alpha run together across the wet area (premultiplied blur, by wetness). */
function bleed(o: DryOptions): void {
  const { data, w, x0, y0, x1, y1 } = o, wetw = o.wetw!;
  const rw = x1 - x0, rh = y1 - y0, n = rw * rh;
  const R = Math.max(3, Math.round(o.radius * 3.2));
  // the bleed reaches only a little past the stroke
  const f0 = new Float32Array(n);
  for (let y = 0; y < rh; y++) { const co = (y0 + y) * w + x0; for (let x = 0; x < rw; x++) f0[y * rw + x] = o.edge ? o.edge[co + x] / 255 : sstep(0.02, 0.22, o.cov[co + x] / 65535); }
  const near = boxBlur(f0, rw, rh, Math.max(3, Math.round(o.radius) * 5));
  for (let i = 0; i < n; i++) near[i] = Math.min(1, near[i] * 3);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const di = ((y0 + y) * w + x0 + x) << 2, a = data[di + 3] / 255, i = y * rw + x;
      ch[0][i] = data[di] * a; ch[1][i] = data[di + 1] * a; ch[2][i] = data[di + 2] * a; ch[3][i] = a;
    }
  }
  const bl = ch.map((c) => boxBlur(c, rw, rh, R));
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x, wv = wetw[i] * near[i] * 0.85;
      if (wv <= 0.01) continue;
      const di = ((y0 + y) * w + x0 + x) << 2, a0 = data[di + 3] / 255;
      const a = a0 + (bl[3][i] - a0) * wv;
      if (a < 0.002) continue;
      // colour from the premultiplied blur, so empty paper does not dilute it
      const pr0 = data[di] * a0, pg0 = data[di + 1] * a0, pb0 = data[di + 2] * a0;
      data[di] = (pr0 + (bl[0][i] - pr0) * wv) / a;
      data[di + 1] = (pg0 + (bl[1][i] - pg0) * wv) / a;
      data[di + 2] = (pb0 + (bl[2][i] - pb0) * wv) / a;
      data[di + 3] = a * 255 + 0.5;
    }
  }
}
