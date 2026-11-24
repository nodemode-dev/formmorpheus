import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { decodeTiff, isTiff } from '@src/media/tiff-decode';

type Tag = [number, number, number[]];

function tiff(tags: Tag[], pixels: number[], be = false): Uint8Array {
  const le = !be;
  const sz = (t: number): number => (t === 3 ? 2 : t === 4 ? 4 : 1);
  const ifd = 8 + pixels.length;
  const end = ifd + 2 + tags.length * 12 + 4;
  let extra = 0;
  for (const [, type, vals] of tags) if (sz(type) * vals.length > 4) extra += sz(type) * vals.length;
  const out = new Uint8Array(end + extra);
  const dv = new DataView(out.buffer);
  out.set(be ? [0x4d, 0x4d, 0, 42] : [0x49, 0x49, 42, 0]);
  dv.setUint32(4, ifd, le);
  out.set(pixels, 8);
  dv.setUint16(ifd, tags.length, le);
  let ext = end;
  tags.forEach(([tag, type, vals], i) => {
    const at = ifd + 2 + i * 12;
    dv.setUint16(at, tag, le);
    dv.setUint16(at + 2, type, le);
    dv.setUint32(at + 4, vals.length, le);
    const size = sz(type) * vals.length;
    let p = at + 8;
    if (size > 4) { dv.setUint32(at + 8, ext, le); p = ext; ext += size; }
    vals.forEach((v, k) => {
      if (type === 3) dv.setUint16(p + k * 2, v, le);
      else if (type === 4) dv.setUint32(p + k * 4, v, le);
      else dv.setUint8(p + k, v);
    });
  });
  return out;
}

interface Opts { w: number; h: number; bps?: number; comp?: number; photo?: number; spp?: number; extra?: Tag[]; rows?: number }

function image(o: Opts, pixels: number[], be = false): Uint8Array {
  const tags: Tag[] = [
    [256, 3, [o.w]], [257, 3, [o.h]], [258, 3, [o.bps ?? 8]], [259, 3, [o.comp ?? 1]], [262, 3, [o.photo ?? 1]],
    [273, 4, [8]], [277, 3, [o.spp ?? 1]], [278, 3, [o.rows ?? o.h]], [279, 4, [pixels.length]], ...(o.extra ?? []),
  ];
  return tiff(tags, pixels, be);
}

const px = (d: { rgba: Uint8ClampedArray }, i: number): number[] => Array.from(d.rgba.subarray(i * 4, i * 4 + 4));

describe('isTiff', () => {
  it('knows both byte orders by their signature', () => {
    expect(isTiff(new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0]))).toBe(true);
    expect(isTiff(new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0]))).toBe(true);
  });

  it('refuses other signatures and buffers too short to hold a header', () => {
    expect(isTiff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))).toBe(false);
    expect(isTiff(new Uint8Array([0x49, 0x49, 42, 0]))).toBe(false);
    expect(isTiff(new Uint8Array([0x49, 0x4d, 42, 0, 8, 0, 0, 0, 0]))).toBe(false);
  });
});

describe('decodeTiff', () => {
  it('reads uncompressed 8-bit RGB', () => {
    const d = decodeTiff(image({ w: 2, h: 1, photo: 2, spp: 3 }, [255, 0, 0, 0, 255, 0]));
    expect([d.width, d.height]).toEqual([2, 1]);
    expect(px(d, 0)).toEqual([255, 0, 0, 255]);
    expect(px(d, 1)).toEqual([0, 255, 0, 255]);
  });

  it('reads big-endian files the same as little-endian ones', () => {
    const d = decodeTiff(image({ w: 2, h: 1, photo: 2, spp: 3 }, [1, 2, 3, 4, 5, 6], true));
    expect(px(d, 0)).toEqual([1, 2, 3, 255]);
    expect(px(d, 1)).toEqual([4, 5, 6, 255]);
  });

  it('reads grey where black is zero and inverts grey where white is zero', () => {
    expect(px(decodeTiff(image({ w: 1, h: 1, photo: 1 }, [10])), 0)).toEqual([10, 10, 10, 255]);
    expect(px(decodeTiff(image({ w: 1, h: 1, photo: 0 }, [10])), 0)).toEqual([245, 245, 245, 255]);
  });

  it('reads grey with alpha', () => {
    expect(px(decodeTiff(image({ w: 1, h: 1, photo: 1, spp: 2 }, [90, 30])), 0)).toEqual([90, 90, 90, 30]);
  });

  it('keeps unassociated alpha and unpremultiplies associated alpha', () => {
    const straight = decodeTiff(image({ w: 1, h: 1, photo: 2, spp: 4, extra: [[338, 3, [2]]] }, [50, 20, 0, 100]));
    expect(px(straight, 0)).toEqual([50, 20, 0, 100]);
    const assoc = decodeTiff(image({ w: 1, h: 1, photo: 2, spp: 4, extra: [[338, 3, [1]]] }, [50, 20, 0, 100]));
    expect(px(assoc, 0)).toEqual([128, 51, 0, 100]);
  });

  it('takes the high byte of 16-bit samples', () => {
    expect(px(decodeTiff(image({ w: 1, h: 1, bps: 16 }, [0x34, 0x12])), 0)).toEqual([0x12, 0x12, 0x12, 255]);
    expect(px(decodeTiff(image({ w: 1, h: 1, bps: 16 }, [0x12, 0x34], true)), 0)).toEqual([0x12, 0x12, 0x12, 255]);
  });

  it('expands 1-bit grey most significant bit first', () => {
    const d = decodeTiff(image({ w: 8, h: 1, bps: 1 }, [0b10100000]));
    expect(Array.from({ length: 8 }, (_, i) => px(d, i)[0])).toEqual([255, 0, 255, 0, 0, 0, 0, 0]);
  });

  it('looks up palette colours from the 16-bit colour map', () => {
    const map: Tag = [320, 3, [0, 65535, 0, 32768, 65535, 0]];
    const d = decodeTiff(image({ w: 2, h: 1, photo: 3, extra: [map] }, [0, 1]));
    expect(px(d, 0)).toEqual([0, 0, 255, 255]);
    expect(px(d, 1)).toEqual([255, 128, 0, 255]);
  });

  it('unpacks PackBits runs and literals', () => {
    const d = decodeTiff(image({ w: 6, h: 1, comp: 32773 }, [0xfd, 7, 0x01, 1, 2]));
    expect(Array.from({ length: 6 }, (_, i) => px(d, i)[0])).toEqual([7, 7, 7, 7, 1, 2]);
  });

  it('decodes LZW codes', () => {
    const d = decodeTiff(image({ w: 2, h: 1, comp: 5 }, [0x80, 0x10, 0x48, 0x50, 0x10]));
    expect([px(d, 0)[0], px(d, 1)[0]]).toEqual([65, 66]);
  });

  it('decodes an LZW code that refers to the entry being built', () => {
    const d = decodeTiff(image({ w: 3, h: 1, comp: 5 }, [0x80, 0x10, 0x60, 0x50, 0x10]));
    expect([px(d, 0)[0], px(d, 1)[0], px(d, 2)[0]]).toEqual([65, 65, 65]);
  });

  it('inflates Deflate data', () => {
    const packed = Array.from(zlibSync(new Uint8Array([1, 2, 3, 4, 5, 6])));
    const d = decodeTiff(image({ w: 2, h: 1, photo: 2, spp: 3, comp: 8 }, packed));
    expect(px(d, 0)).toEqual([1, 2, 3, 255]);
    expect(px(d, 1)).toEqual([4, 5, 6, 255]);
  });

  it('refuses damaged Deflate data', () => {
    expect(() => decodeTiff(image({ w: 2, h: 1, comp: 8 }, [1, 2, 3, 4]))).toThrow(/damaged Deflate/);
  });

  it('undoes the horizontal predictor on 8-bit samples', () => {
    const d = decodeTiff(image({ w: 3, h: 1, extra: [[317, 3, [2]]] }, [10, 5, 250]));
    expect([px(d, 0)[0], px(d, 1)[0], px(d, 2)[0]]).toEqual([10, 15, 9]);
  });

  it('places each strip at its own rows', () => {
    const tags: Tag[] = [
      [256, 3, [1]], [257, 3, [2]], [258, 3, [8]], [259, 3, [1]], [262, 3, [1]],
      [273, 4, [9, 8]], [277, 3, [1]], [278, 3, [1]], [279, 4, [1, 1]],
    ];
    const d = decodeTiff(tiff(tags, [40, 80]));
    expect([px(d, 0)[0], px(d, 1)[0]]).toEqual([80, 40]);
  });

  it('refuses a zero size', () => {
    expect(() => decodeTiff(image({ w: 0, h: 1 }, [0]))).toThrow(/unsupported size/);
  });

  it('refuses sample depths, compressions and colour models it does not know', () => {
    expect(() => decodeTiff(image({ w: 1, h: 1, bps: 4 }, [0]))).toThrow(/4-bit/);
    expect(() => decodeTiff(image({ w: 1, h: 1, comp: 7 }, [0]))).toThrow(/compression 7/);
    expect(() => decodeTiff(image({ w: 1, h: 1, photo: 5, spp: 4 }, [0, 0, 0, 0]))).toThrow(/color model/);
    expect(() => decodeTiff(image({ w: 1, h: 1, photo: 2, spp: 1 }, [0]))).toThrow(/sample count/);
  });

  it('refuses a file without strip offsets', () => {
    const tags: Tag[] = [[256, 3, [1]], [257, 3, [1]], [258, 3, [8]], [262, 3, [1]]];
    expect(() => decodeTiff(tiff(tags, [0]))).toThrow(/no image data/);
  });
});
