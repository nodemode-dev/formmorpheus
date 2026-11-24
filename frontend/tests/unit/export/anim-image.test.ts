import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { ApngWriter, SizeOver, WebpAnimWriter } from '@src/export/anim-image';

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Chunk { type: string; data: Uint8Array; crcOk: boolean }

function chunks(b: Uint8Array): Chunk[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Chunk[] = [];
  for (let p = 8; p < b.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
    const data = b.subarray(p + 8, p + 8 + len);
    out.push({ type, data, crcOk: dv.getUint32(p + 8 + len) === crc32(b.subarray(p + 4, p + 8 + len)) });
    p += 12 + len;
  }
  return out;
}

const be32 = (d: Uint8Array, o: number): number => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o);
const be16 = (d: Uint8Array, o: number): number => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(o);

function unfilter(z: Uint8Array, w: number, h: number, bpp: number): number[] {
  const raw = unzlibSync(z);
  const stride = w * bpp;
  expect(raw).toHaveLength((stride + 1) * h);
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    expect(raw[o]).toBe(1);
    const row: number[] = [];
    for (let i = 0; i < stride; i++) row.push((raw[o + 1 + i] + (i >= bpp ? row[i - bpp] : 0)) & 255);
    out.push(...row);
  }
  return out;
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function frame(w: number, h: number, seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + seed * 101) & 255;
  return px;
}

describe('ApngWriter', () => {
  it('writes the signature, the header and the animation control chunk first', async () => {
    const w = new ApngWriter(3, 2, true, 2, 4, 1, 12);
    w.addFrame(frame(3, 2, 1));
    w.addFrame(frame(3, 2, 2));
    const blob = w.finish();
    expect(blob.type).toBe('image/png');
    const b = await bytes(blob);
    expect(Array.from(b.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const c = chunks(b);
    expect(c.map((x) => x.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    expect(c.every((x) => x.crcOk)).toBe(true);
    expect(Array.from(c[0].data)).toEqual([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
    expect([be32(c[1].data, 0), be32(c[1].data, 4)]).toEqual([2, 4]);
    expect(c[6].data).toHaveLength(0);
  });

  it('numbers the frame control and frame data chunks in one sequence', async () => {
    const w = new ApngWriter(2, 2, true, 3, 0, 2, 25);
    for (let k = 0; k < 3; k++) w.addFrame(frame(2, 2, k));
    const c = chunks(await bytes(w.finish()));
    const seq = c.filter((x) => x.type === 'fcTL' || x.type === 'fdAT').map((x) => be32(x.data, 0));
    expect(seq).toEqual([0, 1, 2, 3, 4]);
    for (const f of c.filter((x) => x.type === 'fcTL')) {
      expect(f.data).toHaveLength(26);
      expect([be32(f.data, 4), be32(f.data, 8), be32(f.data, 12), be32(f.data, 16)]).toEqual([2, 2, 0, 0]);
      expect([be16(f.data, 20), be16(f.data, 22), f.data[24], f.data[25]]).toEqual([2, 25, 0, 0]);
    }
  });

  it('stores pixels that decode back to every frame, with alpha', async () => {
    const a = frame(5, 4, 3), b2 = frame(5, 4, 9);
    const w = new ApngWriter(5, 4, true, 2, 0, 1, 10);
    w.addFrame(a);
    w.addFrame(b2);
    const c = chunks(await bytes(w.finish()));
    expect(unfilter(c[3].data, 5, 4, 4)).toEqual(Array.from(a));
    expect(unfilter(c[5].data.subarray(4), 5, 4, 4)).toEqual(Array.from(b2));
  });

  it('drops the alpha channel and uses colour type 2 when opaque', async () => {
    const a = frame(3, 3, 5);
    const w = new ApngWriter(3, 3, false, 1, 0, 1, 10);
    w.addFrame(a);
    const c = chunks(await bytes(w.finish()));
    expect(c[0].data[9]).toBe(2);
    const rgb = Array.from(a).filter((_, i) => i % 4 !== 3);
    expect(unfilter(c[3].data, 3, 3, 3)).toEqual(rgb);
  });

  it('writes a play count that is never negative', async () => {
    const w = new ApngWriter(1, 1, true, 1, -3, 1, 10);
    w.addFrame(frame(1, 1, 0));
    expect(be32(chunks(await bytes(w.finish()))[1].data, 4)).toBe(0);
  });

  it('stops with the size reached when the file passes its cap', () => {
    const w = new ApngWriter(2, 2, true, 10, 0, 1, 10, 50);
    let err: unknown = null;
    try { w.addFrame(frame(2, 2, 1)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SizeOver);
    expect((err as SizeOver).estimate).toBeGreaterThan(50);
    expect((err as SizeOver).message).toMatch(/MB/);
  });

  it('stops on the second frame when the projected size is over the cap', () => {
    const w = new ApngWriter(2, 2, true, 1000, 0, 1, 10, 5000);
    w.addFrame(frame(2, 2, 1));
    let err: unknown = null;
    try { w.addFrame(frame(2, 2, 2)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SizeOver);
    expect((err as SizeOver).estimate).toBeGreaterThan(5000);
  });
});

const le32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const txt = (s: string): number[] => Array.from(s, (ch) => ch.charCodeAt(0));

function still(type: string, data: number[]): Uint8Array {
  const body = [...txt(type), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  return Uint8Array.from([...txt('RIFF'), ...le32(4 + body.length), ...txt('WEBP'), ...body]);
}

const str = (b: Uint8Array, o: number): string => String.fromCharCode(...b.subarray(o, o + 4));
const rd32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

describe('WebpAnimWriter', () => {
  it('lays out the container, the canvas size, the loop count and one frame', () => {
    const w = new WebpAnimWriter(10, 6);
    w.addFrame(still('VP8 ', [1, 2, 3]), 40);
    const b = w.finish(0);
    expect(b).toHaveLength(80);
    expect([str(b, 0), rd32(b, 4), str(b, 8)]).toEqual(['RIFF', 72, 'WEBP']);
    expect([str(b, 12), rd32(b, 16)]).toEqual(['VP8X', 10]);
    expect(Array.from(b.subarray(20, 30))).toEqual([0x02, 0, 0, 0, 9, 0, 0, 5, 0, 0]);
    expect([str(b, 30), rd32(b, 34)]).toEqual(['ANIM', 6]);
    expect(Array.from(b.subarray(38, 44))).toEqual([255, 255, 255, 255, 0, 0]);
    expect([str(b, 44), rd32(b, 48)]).toEqual(['ANMF', 28]);
    expect(Array.from(b.subarray(52, 68))).toEqual([0, 0, 0, 0, 0, 0, 9, 0, 0, 5, 0, 0, 40, 0, 0, 0]);
    expect(Array.from(b.subarray(68))).toEqual([...txt('VP8 '), 3, 0, 0, 0, 1, 2, 3, 0]);
  });

  it('writes the loop count little endian and never negative', () => {
    const a = new WebpAnimWriter(2, 2);
    a.addFrame(still('VP8 ', [1, 2]), 10);
    expect(Array.from(a.finish(300).subarray(42, 44))).toEqual([44, 1]);
    const n = new WebpAnimWriter(2, 2);
    n.addFrame(still('VP8 ', [1, 2]), 10);
    expect(Array.from(n.finish(-5).subarray(42, 44))).toEqual([0, 0]);
  });

  it('flags alpha on the canvas and on every frame when one frame has it', () => {
    const w = new WebpAnimWriter(4, 4);
    w.addFrame(still('VP8 ', [1, 2]), 10);
    w.addFrame(still('VP8L', [0x2f, 0, 0, 0, 0x10, 0]), 10);
    const b = w.finish(0);
    expect(b[20]).toBe(0x12);
    expect(b[52 + 15]).toBe(0x02);
    expect(str(b, 44 + 8 + 16 + 10)).toBe('ANMF');
    expect(b[44 + 8 + 16 + 10 + 8 + 15]).toBe(0x02);
  });

  it('keeps the alpha plane of a lossy still next to its picture data', () => {
    const file = Uint8Array.from([...txt('RIFF'), ...le32(4 + 18 + 10 + 10), ...txt('WEBP'),
      ...txt('VP8X'), ...le32(10), 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...txt('ALPH'), ...le32(2), 7, 8, ...txt('VP8 '), ...le32(2), 5, 6]);
    const w = new WebpAnimWriter(1, 1);
    w.addFrame(file, 10);
    const b = w.finish(0);
    expect(b[20]).toBe(0x12);
    expect(Array.from(b.subarray(68))).toEqual([...txt('ALPH'), 2, 0, 0, 0, 7, 8, ...txt('VP8 '), 2, 0, 0, 0, 5, 6]);
  });

  it('clamps a frame time to the 24 bit field and to at least one millisecond', () => {
    const w = new WebpAnimWriter(2, 2);
    w.addFrame(still('VP8 ', [1, 2]), 0);
    w.addFrame(still('VP8 ', [1, 2]), 1e9);
    const b = w.finish(0);
    expect(Array.from(b.subarray(64, 67))).toEqual([1, 0, 0]);
    expect(Array.from(b.subarray(64 + 34, 67 + 34))).toEqual([255, 255, 255]);
  });

  it('refuses bytes that are not a WebP picture', () => {
    const w = new WebpAnimWriter(2, 2);
    expect(() => w.addFrame(new Uint8Array(40), 10)).toThrow(/WebP/);
    expect(() => w.addFrame(Uint8Array.from(txt('RIFF')), 10)).toThrow(/WebP/);
  });

  it('refuses a WebP file without picture data', () => {
    const w = new WebpAnimWriter(2, 2);
    expect(() => w.addFrame(still('EXIF', [1, 2, 3, 4]), 10)).toThrow(/no image data/);
  });
});
