import { describe, expect, it } from 'vitest';
import { GifWriter, quantize } from '@src/export/gif';

interface Frame {
  dispose: number; transparent: boolean; tIdx: number; delay: number;
  x: number; y: number; w: number; h: number; local: Uint8Array | null; indices: number[];
}
interface Parsed { sig: string; w: number; h: number; packed: number; gct: Uint8Array; loops: boolean; frames: Frame[]; trailer: number }

function unLzw(min: number, data: number[], npx: number): number[] {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, dict: number[][] = [], prev: number[] | null = null;
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    size = min + 1;
    prev = null;
  };
  reset();
  const out: number[] = [];
  let acc = 0, bits = 0, at = 0;
  while (out.length < npx) {
    while (bits < size) {
      if (at >= data.length) return out;
      acc |= data[at++] << bits; bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size; bits -= size;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = [...(prev as number[]), (prev as number[])[0]];
    else throw new Error(`bad code ${code}`);
    for (const v of entry) out.push(v);
    if (prev && dict.length < 4096) {
      dict.push([...(prev as number[]), entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return out;
}

function parseGif(b: Uint8Array): Parsed {
  const u16 = (o: number): number => b[o] | (b[o + 1] << 8);
  const sig = String.fromCharCode(...b.subarray(0, 6));
  const packed = b[10];
  const gctLen = 3 << ((packed & 7) + 1);
  let p = 13;
  const gct = b.subarray(p, p + gctLen);
  p += gctLen;
  const frames: Frame[] = [];
  let loops = false;
  let gce = { dispose: 0, transparent: false, tIdx: 0, delay: 0 };
  while (b[p] !== 0x3b) {
    if (b[p] === 0x21 && b[p + 1] === 0xff) {
      loops = String.fromCharCode(...b.subarray(p + 3, p + 14)) === 'NETSCAPE2.0';
      p += 3 + b[p + 2];
      while (b[p] !== 0) p += 1 + b[p];
      p++;
    } else if (b[p] === 0x21 && b[p + 1] === 0xf9) {
      gce = { dispose: (b[p + 3] >> 2) & 7, transparent: (b[p + 3] & 1) === 1, delay: u16(p + 4), tIdx: b[p + 6] };
      p += 8;
    } else if (b[p] === 0x2c) {
      const x = u16(p + 1), y = u16(p + 3), w = u16(p + 5), h = u16(p + 7), lp = b[p + 9];
      p += 10;
      let local: Uint8Array | null = null;
      if (lp & 0x80) { const n = 3 << ((lp & 7) + 1); local = b.subarray(p, p + n); p += n; }
      const min = b[p++];
      const data: number[] = [];
      while (b[p] !== 0) { for (let i = 0; i < b[p]; i++) data.push(b[p + 1 + i]); p += 1 + b[p]; }
      p++;
      frames.push({ ...gce, x, y, w, h, local, indices: unLzw(min, data, w * h) });
    } else throw new Error(`unknown block ${b[p]} at ${p}`);
  }
  return { sig, w: u16(6), h: u16(8), packed, gct, loops, frames, trailer: b[p] };
}

const PAL4 = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);

function picture(w: number, h: number, index: (i: number) => number, pal: Uint8Array = PAL4): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const k = index(i);
    if (k < 0) continue;
    out[i * 4] = pal[k * 3]; out[i * 4 + 1] = pal[k * 3 + 1]; out[i * 4 + 2] = pal[k * 3 + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}

describe('GifWriter', () => {
  it('writes the header, the logical screen, the global table and the trailer', () => {
    const g = new GifWriter(4, 3, false);
    g.addFrame(picture(4, 3, () => 0), 5, PAL4, 'none', 128);
    const b = g.finish();
    expect(String.fromCharCode(...b.subarray(0, 6))).toBe('GIF89a');
    expect(Array.from(b.subarray(6, 10))).toEqual([4, 0, 3, 0]);
    expect(b[10]).toBe(0xf1);
    expect(Array.from(b.subarray(13, 25))).toEqual(Array.from(PAL4));
    expect(b[25]).toBe(0x21);
    expect(b[26]).toBe(0xf9);
    expect(b[b.length - 1]).toBe(0x3b);
    expect(parseGif(b).loops).toBe(false);
  });

  it('adds the looping extension right after the global table when looping', () => {
    const g = new GifWriter(300, 2, true);
    g.addFrame(picture(300, 2, () => 1), 5, PAL4, 'none', 128);
    const b = g.finish();
    expect(Array.from(b.subarray(6, 10))).toEqual([44, 1, 2, 0]);
    expect(Array.from(b.subarray(25, 28))).toEqual([0x21, 0xff, 11]);
    expect(String.fromCharCode(...b.subarray(28, 39))).toBe('NETSCAPE2.0');
    expect(Array.from(b.subarray(39, 44))).toEqual([3, 1, 0, 0, 0]);
  });

  it('round trips a small picture through the LZW coder', () => {
    const want = [0, 1, 2, 3, 3, 2, 1, 0, 1, 1, 2, 2];
    const g = new GifWriter(4, 3, false);
    g.addFrame(picture(4, 3, (i) => want[i]), 5, PAL4, 'none', 128);
    const p = parseGif(g.finish());
    expect(p.frames).toHaveLength(1);
    expect(p.frames[0]).toMatchObject({ x: 0, y: 0, w: 4, h: 3, delay: 5, transparent: false, dispose: 1, local: null });
    expect(p.frames[0].indices).toEqual(want);
  });

  it('round trips a noisy 256 colour picture large enough to fill the code table', () => {
    const pal = new Uint8Array(768);
    for (let i = 0; i < 256; i++) { pal[i * 3] = ((i >> 5) & 7) * 32 + 4; pal[i * 3 + 1] = ((i >> 2) & 7) * 32 + 4; pal[i * 3 + 2] = (i & 3) * 64 + 4; }
    let seed = 12345;
    const want: number[] = [];
    for (let i = 0; i < 100 * 100; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; want.push((seed >> 8) & 255); }
    const g = new GifWriter(100, 100, false);
    g.addFrame(picture(100, 100, (i) => want[i], pal), 4, pal, 'none', 128);
    const b = g.finish();
    expect(b[10] & 7).toBe(7);
    const p = parseGif(b);
    expect(p.frames[0].indices).toEqual(want);
    expect(p.trailer).toBe(0x3b);
  });

  it('lengthens the previous frame instead of writing an unchanged one', () => {
    const g = new GifWriter(4, 3, false);
    for (let k = 0; k < 3; k++) g.addFrame(picture(4, 3, (i) => i % 4), 5, PAL4, 'none', 128);
    const p = parseGif(g.finish());
    expect(p.frames).toHaveLength(1);
    expect(p.frames[0].delay).toBe(15);
  });

  it('keeps one frame per movie frame when asked, as a one pixel frame', () => {
    const g = new GifWriter(4, 3, false);
    g.keepAll = true;
    for (let k = 0; k < 3; k++) g.addFrame(picture(4, 3, (i) => i % 4), 5, PAL4, 'none', 128);
    const p = parseGif(g.finish());
    expect(p.frames.map((f) => [f.x, f.y, f.w, f.h, f.delay])).toEqual([[0, 0, 4, 3, 5], [0, 0, 1, 1, 5], [0, 0, 1, 1, 5]]);
    expect(p.frames[1].indices).toEqual([0]);
  });

  it('writes only the rectangle that changed', () => {
    const g = new GifWriter(4, 3, false);
    g.addFrame(picture(4, 3, () => 0), 5, PAL4, 'none', 128);
    g.addFrame(picture(4, 3, (i) => (i === 6 || i === 11 ? 1 : 0)), 7, PAL4, 'none', 128);
    const p = parseGif(g.finish());
    expect(p.frames).toHaveLength(2);
    expect(p.frames[1]).toMatchObject({ x: 2, y: 1, w: 2, h: 2, delay: 7, dispose: 1 });
    expect(p.frames[1].indices).toEqual([1, 0, 0, 1]);
  });

  it('marks see-through pixels with the spare table index and restores the background', () => {
    const pal3 = PAL4.subarray(0, 9);
    const g = new GifWriter(2, 2, false);
    g.addFrame(picture(2, 2, (i) => (i === 3 ? -1 : i), pal3), 5, pal3, 'none', 128);
    const b = g.finish();
    expect(b[10] & 7).toBe(1);
    const p = parseGif(b);
    expect(p.gct).toHaveLength(12);
    expect(p.frames[0]).toMatchObject({ transparent: true, tIdx: 3, dispose: 2 });
    expect(p.frames[0].indices).toEqual([0, 1, 2, 3]);
  });

  it('treats every pixel as solid when the alpha threshold is zero', () => {
    const g = new GifWriter(2, 1, false);
    g.addFrame(new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0]), 5, PAL4, 'none', 0);
    const p = parseGif(g.finish());
    expect(p.frames[0].transparent).toBe(false);
    expect(p.frames[0].indices).toEqual([1, 2]);
  });

  it('writes a local table when a later frame brings another palette', () => {
    const other = Uint8Array.from([255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255]);
    const g = new GifWriter(2, 1, false);
    g.addFrame(picture(2, 1, () => 1), 5, PAL4, 'none', 128);
    g.addFrame(picture(2, 1, () => 2, other), 5, other, 'none', 128);
    const p = parseGif(g.finish());
    expect(Array.from(p.gct)).toEqual(Array.from(PAL4));
    expect(p.frames[0].local).toBeNull();
    expect(Array.from(p.frames[1].local ?? [])).toEqual(Array.from(other));
    expect(p.frames[1].indices).toEqual([2, 2]);
  });

  it('never writes a delay shorter than two hundredths', () => {
    const g = new GifWriter(1, 1, false);
    g.addFrame(picture(1, 1, () => 0), 0, PAL4, 'none', 128);
    expect(parseGif(g.finish()).frames[0].delay).toBe(2);
  });

  it('gives the quantised frame back for a preview', () => {
    const g = new GifWriter(2, 1, false);
    expect(g.previewRgba()).toBeNull();
    g.addFrame(new Uint8ClampedArray([250, 10, 10, 255, 0, 0, 0, 0]), 5, PAL4, 'none', 128);
    expect(Array.from(g.previewRgba() ?? [])).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it('keeps every index inside the palette with each dither', () => {
    for (const d of ['ordered', 'floyd-steinberg'] as const) {
      const g = new GifWriter(8, 8, false);
      const px = new Uint8ClampedArray(8 * 8 * 4);
      for (let i = 0; i < 64; i++) { px[i * 4] = i * 4; px[i * 4 + 1] = 255 - i * 4; px[i * 4 + 2] = 128; px[i * 4 + 3] = 255; }
      g.addFrame(px, 5, PAL4, d, 128);
      const f = parseGif(g.finish()).frames[0];
      expect(f.indices).toHaveLength(64);
      expect(Math.max(...f.indices)).toBeLessThan(4);
    }
  });

  it('refuses a frame buffer that is too small', () => {
    const g = new GifWriter(4, 4, false);
    expect(() => g.addFrame(new Uint8ClampedArray(8), 5, PAL4, 'none', 128)).toThrow(/too small/);
  });

  it('refuses an empty palette', () => {
    const g = new GifWriter(1, 1, false);
    expect(() => g.addFrame(new Uint8ClampedArray(4), 5, new Uint8Array(2), 'none', 128)).toThrow(/empty palette/);
  });

  it('refuses to finish without a frame', () => {
    expect(() => new GifWriter(1, 1, false).finish()).toThrow(/no frames/);
  });
});

describe('quantize', () => {
  it('uses a fixed palette, reads short hex and drops entries it cannot read', () => {
    expect(Array.from(quantize([], 256, ['#ff0000', '0f0', 'nope']))).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it('pads a one colour fixed palette to two entries', () => {
    expect(Array.from(quantize([], 256, ['#fff']))).toEqual([255, 255, 255, 0, 0, 0]);
  });

  it('caps a fixed palette at 256 entries', () => {
    expect(quantize([], 4, Array.from({ length: 300 }, () => '#123456'))).toHaveLength(768);
  });

  it('returns two black entries when there is nothing to measure', () => {
    expect(Array.from(quantize([], 16, null))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('keeps the exact colours of a picture with fewer colours than asked', () => {
    const pal = quantize([new Uint8ClampedArray([0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255])], 256, null);
    expect(Array.from(pal)).toEqual([0, 0, 0, 255, 0, 0]);
  });

  it('leaves one slot free when a pixel is see-through', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 9, 9, 9, 0]);
    expect(quantize([px], 3, null)).toHaveLength(6);
    expect(quantize([px], 3, null, 0)).toHaveLength(9);
  });

  it('returns a single entry for a fully see-through picture', () => {
    expect(Array.from(quantize([new Uint8ClampedArray(16)], 8, null))).toEqual([0, 0, 0]);
  });

  it('never returns more colours than asked, and never more than 256', () => {
    const px = new Uint8ClampedArray(4096 * 4);
    let seed = 7;
    for (let i = 0; i < px.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; px[i] = i % 4 === 3 ? 255 : (seed >> 8) & 255; }
    const eight = quantize([px], 8, null);
    expect(eight.length).toBeLessThanOrEqual(24);
    expect(eight.length).toBeGreaterThanOrEqual(6);
    expect(quantize([px], 1000, null).length).toBeLessThanOrEqual(768);
    expect(quantize([px], 0, null)).toHaveLength(6);
  });
});
