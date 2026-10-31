/** Patterns of a brush file (the 'patt' section): decoded to grey, then fitted to the 256 x 256 grain tile the brush model
 *  paints texture with. Raw and PackBits channels are read; zip-compressed ones are dropped with a warning. */

export interface AbrPattern { id: string; name: string; w: number; h: number; /** 8-bit luminance, 255 = light (holds paint). */ grey: Uint8Array }

const MAX_SIDE = 4096;

function unpack(v: DataView, p: number, end: number, rowBytes: number, h: number): Uint8Array | null {
  if (p + h * 2 > end) return null;
  const out = new Uint8Array(rowBytes * h);
  let q = p + h * 2;
  for (let y = 0; y < h; y++) {
    const stop = Math.min(end, q + v.getUint16(p + y * 2));
    let x = 0;
    while (q < stop && x < rowBytes) {
      let n = v.getUint8(q++);
      if (n >= 128) n -= 256;
      if (n < 0) {
        if (n === -128) continue;
        if (q >= stop) break;
        const b = v.getUint8(q++);
        for (let k = 0; k < 1 - n && x < rowBytes; k++) out[y * rowBytes + x++] = b;
      } else {
        const take = Math.min(n + 1, rowBytes - x, stop - q);
        for (let k = 0; k < take; k++) out[y * rowBytes + x++] = v.getUint8(q++);
      }
    }
    q = stop;
  }
  return out;
}

/** One channel entry to 8-bit samples, or null. */
function channel(v: DataView, p: number, end: number, w: number, h: number): Uint8Array | null {
  if (p + 23 > end) return null;
  const depth = v.getUint32(p);
  const top = v.getInt32(p + 4), left = v.getInt32(p + 8), bottom = v.getInt32(p + 12), right = v.getInt32(p + 16);
  const cw = right - left, ch = bottom - top, comp = v.getUint8(p + 22), data = p + 23;
  if (cw !== w || ch !== h) { if (!(cw > 0 && ch > 0)) return null; }
  const W = cw, H = ch;
  if (W <= 0 || H <= 0 || W > MAX_SIDE || H > MAX_SIDE) return null;
  const bpp = depth === 1 ? 0 : depth / 8;
  const rowBytes = depth === 1 ? Math.ceil(W / 8) : W * bpp;
  if (![1, 8, 16, 32].includes(depth)) return null;
  let raw: Uint8Array | null;
  if (comp === 0) {
    if (data + rowBytes * H > end) return null;
    raw = new Uint8Array(v.buffer, v.byteOffset + data, rowBytes * H);
  } else if (comp === 1) raw = unpack(v, data, end, rowBytes, H);
  else return null;
  if (!raw) return null;
  const out = new Uint8Array(W * H);
  if (depth === 8) out.set(raw.subarray(0, W * H));
  else if (depth === 1) {
    // bitmap mode: a set bit is black
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = (raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
  } else if (depth === 16) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let mx = 0;
    for (let i = 0; i < W * H; i++) mx = Math.max(mx, dv.getUint16(i * 2));
    const k = mx > 32768 ? 255 / 65535 : 255 / 32768;
    for (let i = 0; i < W * H; i++) out[i] = Math.min(255, Math.round(dv.getUint16(i * 2) * k));
  } else {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let i = 0; i < W * H; i++) { const f = dv.getFloat32(i * 4); out[i] = Number.isFinite(f) ? Math.round(Math.min(1, Math.max(0, f)) * 255) : 0; }
  }
  return out;
}

/** Patterns in a 'patt' section [start, end). Never throws: a pattern that cannot be read is left out and named in `warnings`. */
export function readPatterns(v: DataView, start: number, end: number, warnings: string[]): AbrPattern[] {
  const out: AbrPattern[] = [];
  let p = start;
  while (p + 4 <= end) {
    const len = v.getUint32(p);
    const recEnd = Math.min(end, p + 4 + len), next = p + 4 + len + ((4 - (len % 4)) % 4);
    p += 4;
    try {
      const pat = readOne(v, p, recEnd);
      if (pat) out.push(pat);
      else warnings.push('A pattern in the file could not be read.');
    } catch { warnings.push('A pattern in the file could not be read.'); }
    if (len === 0 || next <= p) break;
    p = next;
  }
  return out;
}

function readOne(v: DataView, p: number, end: number): AbrPattern | null {
  if (p + 20 > end) return null;
  p += 4; // version
  const mode = v.getUint32(p); p += 4;
  p += 4; // point
  const nameLen = v.getUint32(p); p += 4;
  if (nameLen > 1024 || p + nameLen * 2 > end) return null;
  let name = '';
  for (let i = 0; i < nameLen; i++) { const c = v.getUint16(p + i * 2); if (c) name += String.fromCharCode(c); }
  p += nameLen * 2;
  const idLen = v.getUint8(p++);
  let id = '';
  for (let i = 0; i < idLen; i++) id += String.fromCharCode(v.getUint8(p + i));
  p += idLen;
  let palette: Uint8Array | null = null;
  if (mode === 2) {
    if (p + 768 > end) return null;
    palette = new Uint8Array(v.buffer, v.byteOffset + p, 768);
    p += 768;
    if (p + 4 <= end && v.getUint32(p) !== 3) p += 4;
  }
  if (p + 8 > end) return null;
  if (v.getUint32(p) !== 3) return null;
  p += 4;
  const vlen = v.getUint32(p); p += 4;
  const vend = Math.min(end, p + vlen);
  if (p + 20 > vend) return null;
  const top = v.getInt32(p), left = v.getInt32(p + 4), bottom = v.getInt32(p + 8), right = v.getInt32(p + 12);
  const w = right - left, h = bottom - top;
  const nch = v.getUint32(p + 16);
  p += 20;
  if (w <= 0 || h <= 0 || w > MAX_SIDE || h > MAX_SIDE || nch > 8) return null;
  const chans: (Uint8Array | null)[] = [];
  for (let i = 0; i < nch + 2 && p + 8 <= vend; i++) {
    const written = v.getUint32(p), clen = v.getUint32(p + 4);
    p += 8;
    if (!written || !clen) { chans.push(null); continue; }
    const cend = Math.min(vend, p + clen);
    chans.push(i < nch ? channel(v, p, cend, w, h) : null);
    p = cend;
  }
  const c0 = chans[0];
  if (!c0) return null;
  const grey = new Uint8Array(w * h);
  if (mode === 3 && chans[1] && chans[2]) for (let i = 0; i < grey.length; i++) grey[i] = Math.round(0.299 * c0[i] + 0.587 * chans[1][i]! + 0.114 * chans[2][i]!);
  else if (mode === 4 && chans[1] && chans[2] && chans[3]) {
    // stored inverted (255 is no ink): the grey is what the inks leave
    for (let i = 0; i < grey.length; i++) { const k = chans[3][i]! / 255; grey[i] = Math.round((0.299 * c0[i] + 0.587 * chans[1][i]! + 0.114 * chans[2][i]!) * k); }
  } else if (mode === 2 && palette) for (let i = 0; i < grey.length; i++) { const j = c0[i] * 3; grey[i] = Math.round(0.299 * palette[j] + 0.587 * palette[j + 1] + 0.114 * palette[j + 2]); }
  else grey.set(c0);
  return { id: id.trim(), name: name.trim(), w, h, grey };
}

// ---- fit to the grain tile ------------------------------------------------------

const TILE = 256;

function resample(src: Uint8Array, w: number, h: number, nw: number, nh: number): Float32Array {
  const out = new Float32Array(nw * nh);
  if (nw < w || nh < h) {
    // box filter when shrinking
    const kx = w / nw, ky = h / nh;
    for (let y = 0; y < nh; y++) {
      const y0 = Math.floor(y * ky), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) * ky)));
      for (let x = 0; x < nw; x++) {
        const x0 = Math.floor(x * kx), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) * kx)));
        let s = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += src[yy * w + xx]; n++; }
        out[y * nw + x] = s / Math.max(1, n);
      }
    }
    return out;
  }
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, (y + 0.5) * h / nh - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, (x + 0.5) * w / nw - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      const a = src[y0 * w + x0] + (src[y0 * w + x1] - src[y0 * w + x0]) * tx, b = src[y1 * w + x0] + (src[y1 * w + x1] - src[y1 * w + x0]) * tx;
      out[y * nw + x] = a + (b - a) * ty;
    }
  }
  return out;
}

export interface GrainFit {
  tile: Uint8Array;
  /** Multiply the file's texture scale (a fraction, 1 = 100 percent) by this to get the brush's `grainScale`. */
  fit: number;
  /** A picture that is not periodic (it was shrunk to the tile): blend its edges. */
  seamless: boolean;
}

const fitted = new WeakMap<AbrPattern, GrainFit>();

/** The pattern as a 256 x 256 tooth table. The engine reads tooth from 0.3 (pit) to 0.7 (top) of the byte range, so the grey is
 *  put into that band; light stays tooth (holds paint). */
export function patternToGrain(p: AbrPattern): GrainFit {
  const hit = fitted.get(p);
  if (hit) return hit;
  let mn = 255, mx = 0;
  for (let i = 0; i < p.grey.length; i++) { const x = p.grey[i]; if (x < mn) mn = x; if (x > mx) mx = x; }
  // a very flat pattern is stretched so the texture shows at all
  const flat = mx - mn < 96 && mx > mn;
  const norm = (x: number): number => (flat ? (x - mn) / (mx - mn) * 0.75 + 0.125 : x / 255);
  const tile = new Uint8Array(TILE * TILE);
  let fit: number, seamless = false;
  const put = (grey: Float32Array, tw: number, th: number, nx: number, ny: number): void => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const g = grey[(y % th) * tw + (x % tw)];
      tile[y * TILE + x] = Math.round((0.3 + 0.4 * Math.min(1, Math.max(0, norm(g)))) * 255);
    }
    void nx; void ny;
  };
  if (p.w <= TILE && p.h <= TILE) {
    const nx = Math.max(1, Math.round(TILE / p.w)), ny = Math.max(1, Math.round(TILE / p.h)), tw = Math.round(TILE / nx), th = Math.round(TILE / ny);
    const g = tw === p.w && th === p.h ? Float32Array.from(p.grey) : resample(p.grey, p.w, p.h, tw, th);
    put(g, tw, th, nx, ny);
    fit = tw / p.w;
  } else {
    put(resample(p.grey, p.w, p.h, TILE, TILE), TILE, TILE, 1, 1);
    fit = p.w / TILE;
    seamless = true;
  }
  const out: GrainFit = { tile, fit, seamless };
  fitted.set(p, out);
  return out;
}
