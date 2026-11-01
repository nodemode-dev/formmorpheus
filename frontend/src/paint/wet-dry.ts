// What a wet wash does as it dries, applied once when the stroke ends: pigment pools at the rim of the stroke
// (a darker, crisper edge) and settles into the valleys of the paper (granulation). Both are a change of the film's
// thickness m, applied as transmittance^m on the paint the stroke laid, so on paper the edge deepens in colour and on
// a transparent layer it gains alpha. Pure typed-array maths; deterministic (no random numbers).

import type { Brush } from './types';
import { RENDER_ALGOS } from './render-modes';
import { paperMap } from './paper';
import { washVariation } from './fam-wet';

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
  /** The rows each 64 px column of the stroke reached (top inclusive, bottom exclusive), kept while it was drawn. */
  cols?: { top: Int32Array; bot: Int32Array };
}

/** True when the brush's stroke is reworked over its whole rectangle when it ends (the worker must send that rectangle back). */
export function dries(b: Brush): boolean {
  return (b.wetEdges ?? 0) > 0 || (!!b.render && RENDER_ALGOS[b.render].glaze && b.grain >= 0.3);
}

const sstep = (a: number, b: number, x: number): number => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

/** Reused float maps: a long wash is worked a strip at a time, so none of these is allocated per strip. */
const maps: Float32Array[] = [];
function takeMap(slot: number, n: number): Float32Array {
  let m = maps[slot];
  if (!m || m.length < n) { m = new Float32Array(Math.max(n, m ? m.length * 2 : 0)); maps[slot] = m; }
  return m;
}
let accBuf: Float32Array | null = null;

/** Box blur of a rw x rh float map with a radius, zero outside the map (running sums, O(area)). `out` is a fresh or pooled map. */
function boxBlur(src: Float32Array, rw: number, rh: number, r: number, out: Float32Array = new Float32Array(rw * rh)): Float32Array {
  if (!scratch || scratch.length < rw * rh) scratch = new Float32Array(rw * rh);
  const tmp = scratch;
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
  if (!accBuf || accBuf.length < rw) accBuf = new Float32Array(rw);
  const acc = accBuf; acc.fill(0, 0, rw);
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

/** Three narrower box passes: close to a Gaussian, so the reach of a wet mark is a soft round cloud, not a square (a single box left a faint rectangle). Reaches about as far as one box of radius r. */
function roundBlur(src: Float32Array, rw: number, rh: number, r: number): Float32Array {
  const k = Math.max(1, Math.round(r * 0.58));
  const a = boxBlur(src, rw, rh, k);
  boxBlur(a, rw, rh, k, a);
  boxBlur(a, rw, rh, k, a);
  return a;
}

/** The stroke's rectangle is worked in blocks, and only the blocks the stroke touches: a long diagonal stroke's box is mostly empty. */
export function dryWash(o: DryOptions): void {
  const { x0, y0, x1, y1, cov, w, pool, gran, tooth } = o;
  if (x1 <= x0 || y1 <= y0 || (pool <= 0 && (gran <= 0 || !tooth))) return;
  // Strips of columns, each worked only over the rows where the stroke is (a band round the stroke, not the whole
  // rectangle): a long wash costs what its own area costs, whatever way it runs.
  const B = 160;
  for (let bx = x0; bx < x1; bx += B) {
    const ex = Math.min(x1, bx + B);
    let top = -1, bot = -1;
    if (o.cols) {
      // the stroke noted the rows each 64 px column of it reached while it was drawn: no scan
      let t = 1e9, b = -1;
      for (let cx = bx >> 6; cx <= (ex - 1) >> 6; cx++) { if (o.cols.top[cx] < t) t = o.cols.top[cx]; if (o.cols.bot[cx] > b) b = o.cols.bot[cx]; }
      if (b < 0) continue;
      top = Math.max(y0, t); bot = Math.min(y1, b) - 1;
      if (bot < top) continue;
    } else {
      for (let y = y0; y < y1; y++) {
        const co = y * w;
        let hit = false;
        for (let x = bx; x < ex; x++) if (cov[co + x] > 250) { hit = true; break; }
        if (hit) { top = y; break; }
      }
      if (top < 0) continue;
      for (let y = y1 - 1; y >= top; y--) {
        const co = y * w;
        let hit = false;
        for (let x = bx; x < ex; x++) if (cov[co + x] > 250) { hit = true; break; }
        if (hit) { bot = y; break; }
      }
    }
    dryBlock(o, bx, top, ex, bot + 1);
  }
  // two passes: the first runs the colours together, the second carries them on (a wet join feathers, it does not stop at a line)
  if (o.wetw && !o.lock && pool > 0) { bleed(o); bleed(o); }
}

// ratio ^ m by table (ratio 0..1 in 256 steps, m 0.05..4 in 1/32 steps, both interpolated): a wash pixel needs it for each colour channel and the alpha
const PM = 128, PR = 256;
let powT: Float32Array | null = null;
function powTable(): Float32Array {
  if (powT) return powT;
  const t = new Float32Array((PM + 2) * (PR + 1));
  for (let mi = 0; mi < PM + 2; mi++) { const m = 0.05 + mi / 32; for (let ri = 0; ri <= PR; ri++) t[mi * (PR + 1) + ri] = Math.pow(ri / PR, m); }
  powT = t;
  return t;
}
function fastPow(t: Float32Array, ratio: number, mf: number, mi: number): number {
  const rf = ratio * PR, ri = rf | 0, rt = rf - ri, r1 = ri < PR ? ri + 1 : PR;
  const a = mi * (PR + 1), b = a + PR + 1;
  const v0 = t[a + ri] + (t[a + r1] - t[a + ri]) * rt, v1 = t[b + ri] + (t[b + r1] - t[b + ri]) * rt;
  return v0 + (v1 - v0) * mf;
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
    const n = rw * rh, E = o.edge, f0 = takeMap(0, n);
    for (let y = 0; y < rh; y++) {
      const co = (y0 + y) * w + x0;
      for (let x = 0; x < rw; x++) f0[y * rw + x] = E ? E[co + x] / 255 : sstep(0.02, 0.22, cov[co + x] / 65535);
    }
    const R = Math.max(1, Math.round(o.radius));
    const B = boxBlur(f0, rw, rh, Math.max(1, Math.round(R * 0.25)), takeMap(1, n));
    body = takeMap(2, n);
    sharp = takeMap(3, n);
    for (let i = 0; i < n; i++) {
      body[i] = sstep(0.3, 0.55, B[i]);
      // cutting the soft tail of the tip: faint edge pixels fade, mid ones rise to the interior's film
      sharp[i] = Math.min(2.2, sstep(0.2, 0.55, B[i]) / Math.max(0.08, B[i]));
    }
    const inner = boxBlur(body, rw, rh, R, takeMap(4, n));
    rim = takeMap(5, n);
    for (let i = 0; i < n; i++) {
      const e = Math.min(1, Math.max(0, body[i] * (1 - inner[i]) * 2));
      rim[i] = e * Math.sqrt(Math.sqrt(e));
    }
  }
  const end = o.end, ends = o.ends && o.ends.length ? o.ends : null, wetw = o.wetw;
  const paper = gran > 0 ? paperMap() : null, pt = powTable();
  for (let py = ay0; py < ay1; py++) {
    const y = py - y0, co = py * w, trow = (py >> 6) * tilesX, yo = (py & 63) << 6;
    for (let px = ax0; px < ax1; px++) {
      const c = cov[co + px] / 65535;
      if (c < 0.004) continue;
      const i = y * rw + (px - x0);
      let m = 1;
      if (pool > 0) {
        const e = rim![i], bd = body![i];
        // thickness: the rim holds ~4x at full wet edges, the interior ~0.75x; the soft tail of the tip is cut
        m = (1 + pool * 4.2 * e - pool * 0.2 * (1 - e) * bd) * (1 + (sharp![i] - 1) * 0.6 * pool);
        // over a wet wash the edge is not sharpened and pigment does not pool: it runs
        if (wetw) m = 1 + (m - 1) * (1 - 0.8 * wetw[(py - o.y0) * orw + (px - o.x0)]);
        // settled pigment: the inside of a wash is blotchy, never an even tint (paint/fam-wet.ts)
        // (dark pigment hardly shows it, and a power of a near-black ratio would turn the blotches into pale patches)
        const gl = data[((py * w + px) << 2) + 1] / 255;
        m *= 1 + (washVariation(px, py, R0 * 5, pool, (1 - e) * bd) - 1) * (gl < 0.5 ? gl * 2 : 1);
      }
      if (end) {
        const dd = Math.hypot(px + 0.5 - end.x, py + 0.5 - end.y) / end.r;
        if (dd < 1) m += end.t * (1 - dd * dd) * (1 - dd * dd);
      }
      if (ends) for (const q of ends) {
        const dd = Math.hypot(px + 0.5 - q.x, py + 0.5 - q.y) / q.r;
        if (dd < 1) m += q.t * (1 - dd * dd) * (1 - dd * dd);
      }
      if (gran > 0 && paper) {
        // pigment settles into the paper's valleys: the paper's own height field, with a little of the brush's tooth
        let tx = px & 511, ty = py & 511;
        if (tx > 255) tx = 511 - tx;
        if (ty > 255) ty = 511 - ty;
        const g = paper[((py & 511) << 9) | (px & 511)] * 0.7 + (tooth ? tooth[(ty << 8) | tx] : 0.5) * 0.3;
        const gd = data[((py * w + px) << 2) + 1] / 255;
        m *= 1 + gran * (0.5 - g) * 0.9 * (gd < 0.5 ? gd * 2 : 1);
      }
      // a near-black film has no room to thin: the rim cut of a hairline stroke would turn it into pale dashes
      if (m < 1) { const gq = data[((py * w + px) << 2) + 1] / 255; if (gq < 0.5) m = 1 + (m - 1) * gq * 2; }
      if (sel) m = 1 + (m - 1) * (sel[py * w + px] / 255);
      m = m < 0.05 ? 0.05 : m > 4 ? 4 : m;
      if (Math.abs(m - 1) < 0.01) continue;
      const t = snap[trow + (px >> 6)];
      if (!t) continue;
      const so = (yo | (px & 63)) << 2, di = (py * w + px) << 2;
      const sa = t[so + 3] / 255, da = data[di + 3] / 255;
      const mq = (m - 0.05) * 32, mi = mq | 0, mf = mq - mi;
      if (sa > 0.02) {
        for (let k = 0; k < 3; k++) {
          const s = t[so + k], d = data[di + k];
          if (s < 6) continue;
          const ratio = d >= s ? 1 : d / s;
          const target = s * fastPow(pt, ratio, mf, mi);
          data[di + k] = d + (target - d) * (sa > 1 ? 1 : sa);
        }
      }
      if (!lock && da > sa + 0.002 && sa < 0.999) {
        const film = (da - sa) / (1 - sa);
        const f2 = 1 - fastPow(pt, 1 - (film > 1 ? 1 : film), mf, mi);
        data[di + 3] = (sa + (1 - sa) * f2) * 255 + 0.5;
        // pooled pigment is denser: on fresh paint the rim runs deeper than the pigment's own colour
        if (pool > 0 && m > 1 && sa < 0.02) {
          const dk = 1 - 0.38 * (m > 4 ? 1 : (m - 1) / 3) * pool;
          data[di] *= dk; data[di + 1] *= dk; data[di + 2] *= dk;
        }
      }
    }
  }
}

/** A wash laid over a still-wet one: colour and alpha run together across the wet area (premultiplied blur, by wetness). */
function bleed(o: DryOptions): void {
  const { data, w } = o, wetw = o.wetw!, orw = o.x1 - o.x0;
  // the colours run a fraction of the brush's width (a few px to about 0.3 of it), not across the whole stroke
  const R = Math.max(5, Math.round(o.radius * 1.6));
  // only where the earlier wash still is wet (the map is sparse): its box, plus the reach of the blur
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  for (let y = 0; y < o.y1 - o.y0; y++) for (let x = 0; x < orw; x++) if (wetw[y * orw + x] > 0.01) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) return;
  // wet paint next to the stroke counts too: the wetness is spread by Rw, so a band laid against a wet one runs into it
  const Rw = Math.min(160, Math.max(R, Math.round(o.radius * 9)));
  const x0 = Math.max(o.x0, o.x0 + bx0 - Rw), y0 = Math.max(o.y0, o.y0 + by0 - Rw), x1 = Math.min(o.x1, o.x0 + bx1 + 1 + Rw), y1 = Math.min(o.y1, o.y0 + by1 + 1 + Rw);
  const rw = x1 - x0, rh = y1 - y0, n = rw * rh;
  // the bleed reaches only a little past the stroke
  const f0 = new Float32Array(n);
  for (let y = 0; y < rh; y++) { const co = (y0 + y) * w + x0; for (let x = 0; x < rw; x++) f0[y * rw + x] = o.edge ? o.edge[co + x] / 255 : sstep(0.02, 0.22, o.cov[co + x] / 65535); }
  const near = roundBlur(f0, rw, rh, Math.max(4, Math.round(o.radius) * 8));
  for (let i = 0; i < n; i++) near[i] = Math.min(1, near[i] * 5);
  // The colours that run are the two washes' own, weighted by where wash is (M): the paper round them is not averaged
  // in, so a join of two washes of one colour keeps its body and its grain instead of going pale and smooth, while
  // two different colours still run into each other. The stroke's alpha only ever grows (outward on a clear layer).
  const M = new Float32Array(n);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const i = y * rw + x, wv0 = wetw[(y0 + y - o.y0) * orw + (x0 + x - o.x0)] * 1.5; M[i] = Math.max(f0[i], wv0 > 1 ? 1 : wv0); }
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const di = ((y0 + y) * w + x0 + x) << 2, a = data[di + 3] / 255, i = y * rw + x, m = M[i];
      ch[0][i] = data[di] * m; ch[1][i] = data[di + 1] * m; ch[2][i] = data[di + 2] * m; ch[3][i] = m; ch[4][i] = a;
    }
  }
  const bl = ch.map((c) => boxBlur(c, rw, rh, R));
  const wf = new Float32Array(n);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) wf[y * rw + x] = wetw[(y0 + y - o.y0) * orw + (x0 + x - o.x0)];
  const wd = roundBlur(wf, rw, rh, Rw);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x, wv = Math.min(1, wd[i] * 2.4) * near[i];
      if (wv <= 0.01) continue;
      const bm = bl[3][i];
      if (bm < 0.01) continue;
      const di = ((y0 + y) * w + x0 + x) << 2, a0 = data[di + 3] / 255, m = M[i], inv = 1 / bm;
      // inside a wash the colour moves toward its neighbours' average; just outside it a faint stain runs out
      let k = m > 0.5 ? 0.8 * wv * sstep(0.4, 0.7, m) : (a0 > 0.98 ? wv * 0.4 * (bm > 1 ? 1 : bm) * (bm > 1 ? 1 : bm) : wv);
      // a clear pixel has no colour of its own (its bytes are black): it takes the running colour whole, else the faint stain it gains reads as a grey haze
      if (a0 < 0.05) k = 1 - (1 - k) * (a0 * 20);
      data[di] += (bl[0][i] * inv - data[di]) * k;
      data[di + 1] += (bl[1][i] * inv - data[di + 1]) * k;
      data[di + 2] += (bl[2][i] * inv - data[di + 2]) * k;
      const ba = bl[4][i];
      // on bare paper beside a wash the stain is only a trace: it must not read as a band between strokes
      if (a0 < 0.98 && ba > a0) {
        // bare paper takes a stain only deep in a wet neighbour's reach (a faint one would only print as a pale disc)
        let g = wv * (m > 0.5 ? 1 : (a0 < 0.02 ? 0.5 : 0.25) * (bm > 1 ? 1 : bm));
        if (m <= 0.5 && g < 0.12) g = 0;
        if (g > 0) data[di + 3] = (a0 + (ba - a0) * g) * 255 + 0.5;
      }
    }
  }
}
