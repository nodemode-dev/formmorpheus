// Pure GIF89a encoder: palette quantiser (median cut + refinement) and a frame writer
// with dithering, frame-difference optimisation and a hand-written LZW coder.
// No DOM, no dependencies.

export type GifDither = 'none' | 'floyd-steinberg' | 'ordered';

const BIN_COUNT = 32768; // 5 bits per channel
const SAMPLE_BUDGET = 262144;

function parseHex(s: string): [number, number, number] | null {
  let m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (m) {
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s.trim());
  if (m) {
    const v = parseInt(m[1], 16);
    return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17];
  }
  return null;
}

/** Perceptually weighted squared distance. */
function dist(r: number, g: number, b: number, pr: number, pg: number, pb: number): number {
  const dr = r - pr, dg = g - pg, db = b - pb;
  return dr * dr * 3 + dg * dg * 4 + db * db * 2;
}

function nearestIn(pal: Uint8Array, n: number, r: number, g: number, b: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = dist(r, g, b, pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]);
    if (d < bd) { bd = d; best = i; if (d === 0) break; }
  }
  return best;
}

/**
 * One global palette (rgb triplets) for all frames. `fixed` ('#rrggbb') wins when given.
 * When any pixel has alpha below `alphaThreshold` (default 128) one slot is left free, so the
 * palette holds at most colors - 1 entries and GifWriter uses the next index as transparent.
 */
export function quantize(
  frames: Uint8ClampedArray[],
  colors: number,
  fixed: string[] | null,
  alphaThreshold = 128,
): Uint8Array {
  if (fixed && fixed.length) {
    const out: number[] = [];
    for (const s of fixed) {
      const c = parseHex(s);
      if (c) out.push(c[0], c[1], c[2]);
      if (out.length >= 768) break;
    }
    if (out.length) {
      while (out.length < 6) out.push(0);
      return Uint8Array.from(out);
    }
  }
  const want = Math.max(2, Math.min(256, colors | 0));
  const thr = Math.max(0, Math.min(255, alphaThreshold));

  let hasT = false;
  if (thr > 0) {
    outer: for (const f of frames) {
      for (let j = 3; j < f.length; j += 4) if (f[j] < thr) { hasT = true; break outer; }
    }
  }
  const k = hasT ? want - 1 : want;

  // Histogram over a strided subsample of every frame.
  const cnt = new Uint32Array(BIN_COUNT);
  const sum = new Uint32Array(BIN_COUNT * 3);
  let total = 0;
  for (const f of frames) total += f.length >> 2;
  let step = Math.max(1, Math.floor(total / SAMPLE_BUDGET));
  if (step > 1 && (step & 1) === 0) step++;
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi], n = f.length >> 2;
    for (let i = (fi * 7) % step; i < n; i += step) {
      const p = i << 2;
      if (f[p + 3] < thr) continue;
      const r = f[p], g = f[p + 1], b = f[p + 2];
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      cnt[bin]++;
      sum[bin * 3] += r; sum[bin * 3 + 1] += g; sum[bin * 3 + 2] += b;
    }
  }
  const bins: number[] = [];
  for (let i = 0; i < BIN_COUNT; i++) if (cnt[i]) bins.push(i);
  if (!bins.length) return new Uint8Array(hasT ? 3 : 6);
  const nb = bins.length;
  const order = Int32Array.from(bins);
  const mr = new Float64Array(BIN_COUNT), mg = new Float64Array(BIN_COUNT), mb = new Float64Array(BIN_COUNT);
  for (let i = 0; i < nb; i++) {
    const b = order[i], c = cnt[b];
    mr[b] = sum[b * 3] / c; mg[b] = sum[b * 3 + 1] / c; mb[b] = sum[b * 3 + 2] / c;
  }

  let pal: number[][]; // [r, g, b] float centroids
  if (nb <= k) {
    pal = Array.from(order, (b) => [mr[b], mg[b], mb[b]]);
  } else {
    pal = medianCut(order, cnt, mr, mg, mb, k);
    pal = refine(order, cnt, mr, mg, mb, pal, 3);
  }
  const out = new Uint8Array(Math.max(pal.length, hasT ? 1 : 2) * 3);
  for (let i = 0; i < pal.length; i++) {
    out[i * 3] = Math.round(pal[i][0]);
    out[i * 3 + 1] = Math.round(pal[i][1]);
    out[i * 3 + 2] = Math.round(pal[i][2]);
  }
  return out;
}

interface Box { start: number; end: number; pri: number }

function medianCut(
  order: Int32Array, cnt: Uint32Array,
  mr: Float64Array, mg: Float64Array, mb: Float64Array, k: number,
): number[][] {
  const stats = (start: number, end: number) => {
    // Weighted variance sum on bin means (priority) plus per-axis extents.
    let w = 0, sr = 0, sg = 0, sb = 0;
    for (let i = start; i < end; i++) {
      const b = order[i], c = cnt[b];
      w += c; sr += mr[b] * c; sg += mg[b] * c; sb += mb[b] * c;
    }
    const ar = sr / w, ag = sg / w, ab = sb / w;
    let v = 0;
    for (let i = start; i < end; i++) {
      const b = order[i], c = cnt[b];
      v += c * (dist(mr[b], mg[b], mb[b], ar, ag, ab));
    }
    return v;
  };
  const boxes: Box[] = [{ start: 0, end: order.length, pri: stats(0, order.length) }];
  while (boxes.length < k) {
    let bi = -1, bp = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.end - b.start > 1 && b.pri > bp) { bp = b.pri; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    // Axis with the largest weighted extent.
    let r0 = 31, r1 = 0, g0 = 31, g1 = 0, b0 = 31, b1 = 0;
    for (let i = box.start; i < box.end; i++) {
      const bin = order[i];
      const r = bin >> 10, g = (bin >> 5) & 31, b = bin & 31;
      if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (g < g0) g0 = g; if (g > g1) g1 = g;
      if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const er = (r1 - r0) * 1.7, eg = (g1 - g0) * 2, eb = (b1 - b0) * 1.4;
    const axis = eg >= er && eg >= eb ? 1 : er >= eb ? 0 : 2;
    const shift = axis === 0 ? 10 : axis === 1 ? 5 : 0;
    const lo = axis === 0 ? r0 : axis === 1 ? g0 : b0;
    const hi = axis === 0 ? r1 : axis === 1 ? g1 : b1;
    if (hi === lo) { box.pri = 0; continue; }
    const hist = new Float64Array(32);
    let tot = 0;
    for (let i = box.start; i < box.end; i++) {
      const bin = order[i], c = cnt[bin];
      hist[(bin >> shift) & 31] += c; tot += c;
    }
    let acc = 0, cut = lo;
    for (let l = lo; l < hi; l++) { acc += hist[l]; cut = l; if (acc * 2 >= tot) break; }
    // Partition: levels <= cut first.
    let a = box.start, z = box.end - 1;
    while (a <= z) {
      if (((order[a] >> shift) & 31) <= cut) a++;
      else { const t = order[a]; order[a] = order[z]; order[z] = t; z--; }
    }
    const mid = a;
    boxes[bi] = { start: box.start, end: mid, pri: stats(box.start, mid) };
    boxes.push({ start: mid, end: box.end, pri: stats(mid, box.end) });
  }
  return boxes.map((b) => {
    let w = 0, r = 0, g = 0, bl = 0;
    for (let i = b.start; i < b.end; i++) {
      const bin = order[i], c = cnt[bin];
      w += c; r += mr[bin] * c; g += mg[bin] * c; bl += mb[bin] * c;
    }
    return [r / w, g / w, bl / w];
  });
}

/** A few Lloyd iterations over the histogram bins. */
function refine(
  order: Int32Array, cnt: Uint32Array,
  mr: Float64Array, mg: Float64Array, mb: Float64Array, pal: number[][], iters: number,
): number[][] {
  const k = pal.length;
  const sw = new Float64Array(k), sr = new Float64Array(k), sg = new Float64Array(k), sb = new Float64Array(k);
  for (let it = 0; it < iters; it++) {
    sw.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
    for (let i = 0; i < order.length; i++) {
      const bin = order[i], r = mr[bin], g = mg[bin], b = mb[bin];
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = dist(r, g, b, pal[j][0], pal[j][1], pal[j][2]);
        if (d < bd) { bd = d; best = j; }
      }
      const c = cnt[bin];
      sw[best] += c; sr[best] += r * c; sg[best] += g * c; sb[best] += b * c;
    }
    for (let j = 0; j < k; j++) {
      if (sw[j] > 0) pal[j] = [sr[j] / sw[j], sg[j] / sw[j], sb[j] / sw[j]];
    }
  }
  return pal;
}

// ---------------------------------------------------------------------------------------------
// Byte sink and LZW

class Sink {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let c = this.buf.length * 2;
    while (c < this.len + n) c *= 2;
    const b = new Uint8Array(c);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  byte(v: number): void { this.ensure(1); this.buf[this.len++] = v & 255; }
  u16(v: number): void { this.ensure(2); this.buf[this.len++] = v & 255; this.buf[this.len++] = (v >> 8) & 255; }
  bytes(a: ArrayLike<number>, from = 0, to = a.length): void {
    this.ensure(to - from);
    for (let i = from; i < to; i++) this.buf[this.len++] = a[i];
  }
  ascii(s: string): void { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
}

const HASH_BITS = 14;
const HASH_SIZE = 1 << HASH_BITS;
const hashKeys = new Int32Array(HASH_SIZE);
const hashVals = new Int32Array(HASH_SIZE);

/** Variable code size LZW; clear code when the 4096 entry table is full. Writes sub-blocks. */
function lzwEncode(px: Uint8Array, count: number, minCode: number, out: Sink): void {
  const clearCode = 1 << minCode, eoiCode = clearCode + 1;
  const initBits = minCode + 1;
  let nbits = initBits, maxcode = (1 << nbits) - 1, free = clearCode + 2, clearFlag = false;
  let acc = 0, accBits = 0;
  const block = new Uint8Array(255);
  let bl = 0;
  hashKeys.fill(-1);

  const flushBlock = () => {
    if (!bl) return;
    out.byte(bl); out.bytes(block, 0, bl); bl = 0;
  };
  const emit = (code: number) => {
    acc |= code << accBits; accBits += nbits;
    while (accBits >= 8) {
      block[bl++] = acc & 255; acc >>>= 8; accBits -= 8;
      if (bl === 255) flushBlock();
    }
    if (free > maxcode || clearFlag) {
      if (clearFlag) { nbits = initBits; maxcode = (1 << nbits) - 1; clearFlag = false; }
      else { nbits++; maxcode = nbits === 12 ? 4096 : (1 << nbits) - 1; }
    }
  };

  out.byte(minCode);
  emit(clearCode);
  let ent = px[0];
  for (let i = 1; i < count; i++) {
    const c = px[i];
    const key = (ent << 8) | c;
    let h = Math.imul(key, 0x9e3779b1) >>> (32 - HASH_BITS);
    let found = -1;
    for (;;) {
      const kk = hashKeys[h];
      if (kk === key) { found = hashVals[h]; break; }
      if (kk < 0) break;
      h = (h + 1) & (HASH_SIZE - 1);
    }
    if (found >= 0) { ent = found; continue; }
    emit(ent);
    ent = c;
    if (free < 4096) {
      hashKeys[h] = key; hashVals[h] = free++;
    } else {
      hashKeys.fill(-1);
      free = clearCode + 2;
      clearFlag = true;
      emit(clearCode);
    }
  }
  emit(ent);
  emit(eoiCode);
  if (accBits > 0) block[bl++] = acc & 255;
  flushBlock();
  out.byte(0);
}

// ---------------------------------------------------------------------------------------------
// Writer

const BAYER8 = (() => {
  const m = new Float32Array(64);
  const b2 = [0, 2, 3, 1];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    // Recursive Bayer construction for 8x8.
    let v = 0;
    for (let l = 2; l >= 0; l--) {
      const bx = (x >> l) & 1, by = (y >> l) & 1;
      v = v * 4 + b2[by * 2 + bx];
    }
    m[y * 8 + x] = (v + 0.5) / 64 - 0.5;
  }
  return m;
})();

const bayerCache = new Map<number, Float32Array>();
/** Bayer threshold matrix of side `size` (2, 4, 8 or 16), values in -0.5..0.5. */
function bayer(size: number): Float32Array {
  if (size === 8) return BAYER8;
  const hit = bayerCache.get(size);
  if (hit) return hit;
  const m = new Float32Array(size * size);
  const levels = Math.log2(size), b2 = [0, 2, 3, 1];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (let l = levels - 1; l >= 0; l--) v = v * 4 + b2[((y >> l) & 1) * 2 + ((x >> l) & 1)];
    m[y * size + x] = (v + 0.5) / (size * size) - 0.5;
  }
  bayerCache.set(size, m);
  return m;
}

interface Pending {
  idx: Uint8Array;
  delay: number;
  hasT: boolean;
  tIdx: number;
  pal: Uint8Array;
}

function tableBits(n: number): number {
  let b = 1;
  while ((1 << b) < n) b++;
  return b;
}

function samePal(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class GifWriter {
  private readonly w: number;
  private readonly h: number;
  private readonly loop: boolean;
  private body = new Sink();
  private globalPal: Uint8Array | null = null;
  private pending: Pending | null = null;
  private canvas: Uint8Array | null = null; // indices the viewer shows after the last emitted frame
  private free: Uint8Array[] = [];
  private scratch: Uint8Array;
  private srcCur: Uint32Array;
  private srcPrev: Uint32Array;
  private srcPrevValid = false;
  private lastDelayPos = -1;
  private firstHasT = false;
  private frames = 0;
  private cache = new Int16Array(BIN_COUNT);
  private cachePal: Uint8Array | null = null;
  private cacheN = -1;
  private errA: Float32Array;
  private errB: Float32Array;
  private matrix: Float32Array = BAYER8;
  private matrixSide = 8;
  private strength = 1;

  /** Stable dithering: smoothness 0..3 picks a 2x2, 4x4, 8x8 or 16x16 matrix; intensity 0..100 (50 is the default strength). */
  setOrdered(smoothness: number, intensity: number): void {
    this.matrixSide = 2 << Math.max(0, Math.min(3, Math.round(smoothness)));
    this.matrix = bayer(this.matrixSide);
    this.strength = Math.max(0, Math.min(100, intensity)) / 50;
  }

  /** The frame just added, as RGBA after the palette and dither (for a preview); valid until the next addFrame. */
  previewRgba(): Uint8ClampedArray | null {
    const p = this.pending;
    if (!p) return null;
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0, o = 0; i < p.idx.length; i++, o += 4) {
      const k = p.idx[i];
      if (p.hasT && k === p.tIdx) { out[o + 3] = 0; continue; }
      out[o] = p.pal[k * 3]; out[o + 1] = p.pal[k * 3 + 1]; out[o + 2] = p.pal[k * 3 + 2]; out[o + 3] = 255;
    }
    return out;
  }

  constructor(width: number, height: number, loop: boolean) {
    this.w = Math.max(1, width | 0);
    this.h = Math.max(1, height | 0);
    this.loop = loop;
    const n = this.w * this.h;
    this.scratch = new Uint8Array(n);
    this.srcCur = new Uint32Array(n);
    this.srcPrev = new Uint32Array(n);
    this.errA = new Float32Array(0);
    this.errB = new Float32Array(0);
  }

  private buf(): Uint8Array {
    return this.free.pop() ?? new Uint8Array(this.w * this.h);
  }

  private prepCache(pal: Uint8Array, searchN: number): void {
    if (this.cachePal === pal && this.cacheN === searchN) return;
    this.cache.fill(-1);
    this.cachePal = pal;
    this.cacheN = searchN;
  }

  private lookup(r: number, g: number, b: number): number {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = this.cache[key];
    if (v < 0) {
      v = nearestIn(this.cachePal!, this.cacheN, (r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4);
      this.cache[key] = v;
    }
    return v;
  }

  addFrame(
    rgba: Uint8ClampedArray, delayCs: number, palette: Uint8Array,
    dither: GifDither, alphaThreshold: number,
  ): void {
    const w = this.w, h = this.h, npx = w * h;
    if (rgba.length < npx * 4) throw new Error('GifWriter: frame buffer too small');
    const n = Math.min(256, palette.length / 3 | 0);
    if (n < 1) throw new Error('GifWriter: empty palette');
    if (!this.globalPal) this.globalPal = palette.slice(0, n * 3);
    const pal = samePal(this.pending?.pal ?? this.globalPal, palette.subarray(0, n * 3))
      ? (this.pending?.pal ?? this.globalPal)
      : palette.slice(0, n * 3);
    const thr = Math.max(0, Math.min(255, alphaThreshold | 0));

    // Aligned copy of the source (also the previous-frame reference for static regions).
    const srcBytes = new Uint8Array(this.srcCur.buffer);
    srcBytes.set(rgba.subarray(0, npx * 4) as unknown as Uint8Array);
    const src = srcBytes;

    let hasT = false;
    if (thr > 0) for (let j = 3; j < npx * 4; j += 4) if (src[j] < thr) { hasT = true; break; }

    const size = 1 << tableBits(n);
    const tIdx = hasT ? (n < size ? n : n - 1) : -1;
    const searchN = hasT && tIdx !== n ? n - 1 : n;
    this.prepCache(pal, Math.max(1, searchN));

    const idx = this.buf();
    const prev = this.pending;
    const stable = dither === 'floyd-steinberg' && this.srcPrevValid && prev !== null &&
      !prev.hasT && !hasT && samePal(prev.pal, pal);

    if (dither === 'none') this.dNone(src, idx, thr, tIdx);
    else if (dither === 'ordered') this.dOrdered(src, idx, thr, tIdx, n);
    else this.dFloyd(src, idx, thr, tIdx, pal, stable ? prev!.idx : null);

    // Keep this frame's source for the next static-region comparison.
    const t = this.srcPrev; this.srcPrev = this.srcCur; this.srcCur = t;
    this.srcPrevValid = dither === 'floyd-steinberg';

    if (this.frames === 0) this.firstHasT = hasT;
    this.frames++;
    if (this.pending) this.emit(this.pending, hasT, false);
    this.pending = { idx, delay: Math.max(2, Math.round(delayCs)), hasT, tIdx, pal };
  }

  private dNone(src: Uint8Array, idx: Uint8Array, thr: number, tIdx: number): void {
    const npx = this.w * this.h;
    for (let i = 0, p = 0; i < npx; i++, p += 4) {
      idx[i] = src[p + 3] < thr ? tIdx : this.lookup(src[p], src[p + 1], src[p + 2]);
    }
  }

  private dOrdered(src: Uint8Array, idx: Uint8Array, thr: number, tIdx: number, n: number): void {
    const w = this.w, h = this.h;
    const spread = Math.min(160, 205 / Math.cbrt(Math.max(2, n))) * this.strength;
    const side = this.matrixSide, mask = side - 1, mat = this.matrix;
    for (let y = 0; y < h; y++) {
      const row = (y & mask) * side;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i * 4;
        if (src[p + 3] < thr) { idx[i] = tIdx; continue; }
        const o = mat[row + (x & mask)] * spread;
        let r = src[p] + o, g = src[p + 1] + o, b = src[p + 2] + o;
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;
        idx[i] = this.lookup(r | 0, g | 0, b | 0);
      }
    }
  }

  private dFloyd(
    src: Uint8Array, idx: Uint8Array, thr: number, tIdx: number, pal: Uint8Array,
    same: Uint8Array | null,
  ): void {
    const w = this.w, h = this.h;
    const rowLen = (w + 2) * 3;
    if (this.errA.length !== rowLen) { this.errA = new Float32Array(rowLen); this.errB = new Float32Array(rowLen); }
    let cur = this.errA, nxt = this.errB;
    cur.fill(0); nxt.fill(0);
    const prev32 = this.srcPrev; // previous frame (swapped after this call, still the old one here)
    const cur32 = new Uint32Array(src.buffer, src.byteOffset, w * h);
    const LIM = 96;
    for (let y = 0; y < h; y++) {
      const rtl = (y & 1) === 1;
      const dir = rtl ? -1 : 1;
      for (let s = 0; s < w; s++) {
        const x = rtl ? w - 1 - s : s;
        const i = y * w + x, p = i * 4;
        const e = (x + 1) * 3;
        if (src[p + 3] < thr) { idx[i] = tIdx; continue; }
        if (same !== null && prev32[i] === cur32[i]) { idx[i] = same[i]; continue; }
        let r = src[p] + cur[e], g = src[p + 1] + cur[e + 1], b = src[p + 2] + cur[e + 2];
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        b = b < 0 ? 0 : b > 255 ? 255 : b;
        const k = this.lookup(r | 0, g | 0, b | 0);
        idx[i] = k;
        let er = r - pal[k * 3], eg = g - pal[k * 3 + 1], eb = b - pal[k * 3 + 2];
        er = er < -LIM ? -LIM : er > LIM ? LIM : er;
        eg = eg < -LIM ? -LIM : eg > LIM ? LIM : eg;
        eb = eb < -LIM ? -LIM : eb > LIM ? LIM : eb;
        const f = e + dir * 3, d = e - dir * 3;
        const e7 = 7 / 16, e3 = 3 / 16, e5 = 5 / 16, e1 = 1 / 16;
        cur[f] += er * e7; cur[f + 1] += eg * e7; cur[f + 2] += eb * e7;
        nxt[d] += er * e3; nxt[d + 1] += eg * e3; nxt[d + 2] += eb * e3;
        nxt[e] += er * e5; nxt[e + 1] += eg * e5; nxt[e + 2] += eb * e5;
        nxt[f] += er * e1; nxt[f + 1] += eg * e1; nxt[f + 2] += eb * e1;
      }
      const t = cur; cur = nxt; nxt = t;
      nxt.fill(0);
    }
  }

  /** Write one buffered frame. `nextT`: the following frame has transparency. */
  private emit(p: Pending, nextT: boolean, last: boolean): void {
    const w = this.w, h = this.h;
    const dispose = p.hasT || nextT || (last && this.firstHasT);
    const canvas = this.canvas;
    let x0 = 0, y0 = 0, rw = w, rh = h;
    if (!dispose && canvas) {
      let minX = w, minY = h, maxX = -1, maxY = -1;
      const a = p.idx;
      for (let y = 0; y < h; y++) {
        const o = y * w;
        let xl = -1, xr = -1;
        for (let x = 0; x < w; x++) if (a[o + x] !== canvas[o + x]) { xl = x; break; }
        if (xl < 0) continue;
        for (let x = w - 1; x >= xl; x--) if (a[o + x] !== canvas[o + x]) { xr = x; break; }
        if (y < minY) minY = y;
        maxY = y;
        if (xl < minX) minX = xl;
        if (xr > maxX) maxX = xr;
      }
      if (maxX < 0) {
        // Identical to what is on screen: lengthen the previous frame instead.
        if (this.lastDelayPos >= 0) {
          const b = this.body.buf, pos = this.lastDelayPos;
          const d = Math.min(65535, (b[pos] | (b[pos + 1] << 8)) + p.delay);
          b[pos] = d & 255; b[pos + 1] = d >> 8;
          this.free.push(p.idx);
          return;
        }
        minX = 0; minY = 0; maxX = 0; maxY = 0;
      }
      x0 = minX; y0 = minY; rw = maxX - minX + 1; rh = maxY - minY + 1;
    }

    // Pull the rectangle into a contiguous scratch buffer.
    let px: Uint8Array = p.idx;
    if (rw !== w || rh !== h) {
      px = this.scratch;
      for (let y = 0; y < rh; y++) {
        const o = (y0 + y) * w + x0;
        px.set(p.idx.subarray(o, o + rw), y * rw);
      }
    }

    const out = this.body;
    const n = p.pal.length / 3;
    const bits = tableBits(n);
    const local = !samePal(p.pal, this.globalPal!);
    out.byte(0x21); out.byte(0xf9); out.byte(4);
    out.byte((dispose ? 2 << 2 : 1 << 2) | (p.hasT ? 1 : 0));
    this.lastDelayPos = out.len;
    out.u16(Math.min(65535, p.delay));
    out.byte(p.hasT ? p.tIdx : 0);
    out.byte(0);
    out.byte(0x2c);
    out.u16(x0); out.u16(y0); out.u16(rw); out.u16(rh);
    if (local) {
      out.byte(0x80 | (bits - 1));
      out.bytes(p.pal);
      for (let i = n * 3; i < (3 << bits); i++) out.byte(0);
    } else out.byte(0);
    lzwEncode(px, rw * rh, Math.max(2, bits), out);

    if (dispose) {
      this.free.push(p.idx);
      if (this.canvas) { this.free.push(this.canvas); this.canvas = null; }
    } else {
      if (this.canvas) this.free.push(this.canvas);
      this.canvas = p.idx;
    }
  }

  finish(): Uint8Array {
    if (!this.pending || !this.globalPal) throw new Error('GifWriter: no frames');
    this.emit(this.pending, false, true);
    this.pending = null;
    const head = new Sink();
    head.ascii('GIF89a');
    head.u16(this.w); head.u16(this.h);
    const n = this.globalPal.length / 3;
    const bits = tableBits(n);
    head.byte(0x80 | (7 << 4) | (bits - 1));
    head.byte(0); head.byte(0);
    head.bytes(this.globalPal);
    for (let i = n * 3; i < (3 << bits); i++) head.byte(0);
    if (this.loop) {
      head.byte(0x21); head.byte(0xff); head.byte(11);
      head.ascii('NETSCAPE2.0');
      head.byte(3); head.byte(1); head.u16(0); head.byte(0);
    }
    const res = new Uint8Array(head.len + this.body.len + 1);
    res.set(head.buf.subarray(0, head.len), 0);
    res.set(this.body.buf.subarray(0, this.body.len), head.len);
    res[res.length - 1] = 0x3b;
    return res;
  }
}
