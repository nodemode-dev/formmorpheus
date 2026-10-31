// A layered PSD writer, from the published file format specification: RGB, 8 bit, RLE channels, one record per
// layer with its blend mode, opacity and a Unicode name. Pure byte work, no DOM.
import type { BlendMode } from '../engine/types';

export interface PsdLayer {
  name: string;
  /** Straight (not premultiplied) RGBA of the whole canvas, w * h * 4. */
  rgba: Uint8ClampedArray;
  /** 0 to 1. */
  opacity: number;
  blend: BlendMode;
  hidden?: boolean;
}

const BLEND_KEYS: Record<BlendMode, string> = {
  normal: 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite', 'color-dodge': 'div ',
  'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff', exclusion: 'smud', hue: 'hue ',
  saturation: 'sat ', color: 'colr', luminosity: 'lum ', add: 'lddg', passthrough: 'pass', 'linear-burn': 'lbrn',
  'darker-color': 'dkCl', 'lighter-color': 'lgCl', 'vivid-light': 'vLit', 'linear-light': 'lLit', 'pin-light': 'pLit',
  'hard-mix': 'hMix', subtract: 'fsub', divide: 'fdiv',
};

export function psdBlendKey(b: BlendMode): string {
  return BLEND_KEYS[b] ?? 'norm';
}

/** PackBits of one row into `out` at `at`; returns the new end. A row never needs more than n + n / 128 + 2 bytes. */
function packBits(src: Uint8Array, out: Uint8Array, at: number): number {
  const n = src.length;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) { out[at++] = 257 - run; out[at++] = src[i]; i += run; continue; }
    let lit = 1;
    while (i + lit < n && lit < 128 && !(i + lit + 1 < n && src[i + lit] === src[i + lit + 1])) lit++;
    out[at++] = lit - 1;
    for (let k = 0; k < lit; k++) out[at++] = src[i + k];
    i += lit;
  }
  return at;
}

interface Rle { counts: Uint16Array; data: Uint8Array }

/** One channel of a rectangle, RLE coded row by row into one buffer sized for the worst case (no growing arrays of numbers). */
function rleChannel(rgba: Uint8ClampedArray, w: number, x0: number, y0: number, cw: number, ch: number, c: number): Rle {
  const counts = new Uint16Array(ch);
  const buf = new Uint8Array(ch * (cw + (cw >> 7) + 2));
  const row = new Uint8Array(cw);
  let at = 0;
  for (let y = 0; y < ch; y++) {
    let s = ((y0 + y) * w + x0) * 4 + c;
    for (let x = 0; x < cw; x++, s += 4) row[x] = rgba[s];
    const before = at;
    at = packBits(row, buf, at);
    counts[y] = at - before;
  }
  return { counts, data: buf.subarray(0, at) };
}

class Out {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void { this.parts.push(b); this.length += b.length; }
  u8(v: number): void { this.push(new Uint8Array([v & 255])); }
  u16(v: number): void { this.push(new Uint8Array([(v >>> 8) & 255, v & 255])); }
  i16(v: number): void { this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number): void { this.push(new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])); }
  ascii(s: string): void { this.push(Uint8Array.from(s, (c) => c.charCodeAt(0) & 255)); }
  zeros(n: number): void { if (n > 0) this.push(new Uint8Array(n)); }
  bytes(): Uint8Array {
    const o = new Uint8Array(this.length);
    let p = 0;
    for (const x of this.parts) { o.set(x, p); p += x.length; }
    return o;
  }
}

const pad4 = (n: number): number => (4 - (n % 4)) % 4;

/** Rectangle holding every pixel with some alpha, or null when the layer is empty. */
function bounds(rgba: Uint8ClampedArray, w: number, h: number): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let hit = false;
    for (let x = 0, s = y * w * 4 + 3; x < w; x++, s += 4) {
      if (rgba[s] === 0) continue;
      hit = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    if (hit) { if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** A layer already encoded: its record bytes and its channel data. Holds no pixels, so a caller can free them at once. */
export interface PsdEncodedLayer { rec: Uint8Array; dat: Uint8Array }

/** The most a PSD's layer data may take (the format's offsets are 32 bit); a clear message instead of a corrupt file. */
export const PSD_MAX_BYTES = 3_800_000_000;

/** Encodes one layer (straight RGBA of the whole canvas) so its pixels can be released before the next layer is made. */
export function encodePsdLayer(w: number, h: number, L: PsdLayer): PsdEncodedLayer {
  const rec = new Out();
  const dat = new Out();
  {
    const b = bounds(L.rgba, w, h) ?? [0, 0, 0, 0];
    const cw = b[2] - b[0], chh = b[3] - b[1];
    rec.u32(b[1]); rec.u32(b[0]); rec.u32(b[3]); rec.u32(b[2]);
    rec.u16(4);
    const ids = [-1, 0, 1, 2], src = [3, 0, 1, 2];
    const enc = src.map((c) => (cw && chh ? rleChannel(L.rgba, w, b[0], b[1], cw, chh, c) : { counts: [], data: new Uint8Array(0) }));
    enc.forEach((e, k) => {
      const len = 2 + e.counts.length * 2 + e.data.length;
      rec.i16(ids[k]); rec.u32(len);
      dat.u16(cw && chh ? 1 : 0);
      const cb = new Uint8Array(e.counts.length * 2);
      for (let q = 0; q < e.counts.length; q++) { cb[q * 2] = e.counts[q] >>> 8; cb[q * 2 + 1] = e.counts[q] & 255; }
      dat.push(cb);
      dat.push(e.data);
    });
    rec.ascii('8BIM'); rec.ascii(psdBlendKey(L.blend));
    rec.u8(Math.round(Math.max(0, Math.min(1, L.opacity)) * 255)); rec.u8(0); rec.u8(L.hidden ? 2 : 0); rec.u8(0);
    // extra data: no mask, no blending ranges, a Pascal name, then the Unicode name
    const asciiName = Array.from(L.name).map((c) => (c.charCodeAt(0) < 128 && c.charCodeAt(0) >= 32 ? c : '_')).join('').slice(0, 31);
    const pascal = 1 + asciiName.length;
    const pascalPad = (4 - (pascal % 4)) % 4;
    const chars = Array.from(L.name).slice(0, 255).join('');
    const uni = new Out();
    uni.u32(chars.length);
    for (let i = 0; i < chars.length; i++) uni.u16(chars.charCodeAt(i));
    const uniLen = uni.length + pad4(uni.length);
    const extra = 4 + 4 + pascal + pascalPad + 12 + uniLen;
    rec.u32(extra);
    rec.u32(0); rec.u32(0);
    rec.u8(asciiName.length); rec.ascii(asciiName); rec.zeros(pascalPad);
    rec.ascii('8BIM'); rec.ascii('luni'); rec.u32(uniLen); rec.push(uni.bytes()); rec.zeros(pad4(uni.length));
  }
  return { rec: rec.bytes(), dat: dat.bytes() };
}

/** Whole-file writer for layers made with encodePsdLayer; `merged` is the flattened picture (straight RGBA). */
export function writePsdEncoded(w: number, h: number, layers: PsdEncodedLayer[], merged: Uint8ClampedArray, mergedAlpha: boolean): Uint8Array {
  if (w > 30000 || h > 30000) throw new Error('A PSD file is limited to 30000 pixels a side.');
  const out = new Out();
  const mch = mergedAlpha ? 4 : 3;
  out.ascii('8BPS'); out.u16(1); out.zeros(6); out.u16(mch); out.u32(h); out.u32(w); out.u16(8); out.u16(3);
  out.u32(0); // colour mode data
  out.u32(0); // image resources

  const info = new Out();
  info.i16(mergedAlpha ? -layers.length : layers.length);
  for (const L of layers) info.push(L.rec);
  for (const L of layers) info.push(L.dat);
  if (info.length + 8 + merged.length > PSD_MAX_BYTES) throw new Error('This PSD would be larger than the format allows (4 GB). Export fewer tracks or a smaller size.');
  const infoLen = info.length + (info.length & 1);
  out.u32(4 + infoLen + 4);
  out.u32(infoLen);
  out.push(info.bytes());
  out.zeros(infoLen - info.length);
  out.u32(0); // global layer mask

  // flattened picture: all rows' byte counts first, then the data
  const chans = Array.from({ length: mch }, (_, c) => rleChannel(merged, w, 0, 0, w, h, c));
  out.u16(1);
  for (const c of chans) for (const n of c.counts) out.u16(n);
  for (const c of chans) out.push(c.data);
  return out.bytes();
}

/**
 * `merged` is the flattened picture (straight RGBA); `mergedAlpha` says whether it keeps its transparency.
 * Layers are listed bottom first. Holds every layer's pixels at once: the exporter uses encodePsdLayer per layer instead.
 */
export function writePsd(w: number, h: number, layers: PsdLayer[], merged: Uint8ClampedArray, mergedAlpha: boolean): Uint8Array {
  return writePsdEncoded(w, h, layers.map((L) => encodePsdLayer(w, h, L)), merged, mergedAlpha);
}
