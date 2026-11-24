import { describe, expect, it } from 'vitest';
import { decodeTga, isTga } from '@src/media/tga-decode';

interface Head { type: number; w: number; h: number; bits: number; desc?: number; cmType?: number; cmFirst?: number; cmLen?: number; cmBits?: number; idLen?: number }

function header(o: Head): number[] {
  const cmFirst = o.cmFirst ?? 0, cmLen = o.cmLen ?? 0;
  return [o.idLen ?? 0, o.cmType ?? 0, o.type, cmFirst & 255, cmFirst >> 8, cmLen & 255, cmLen >> 8, o.cmBits ?? 0, 0, 0, 0, 0, o.w & 255, o.w >> 8, o.h & 255, o.h >> 8, o.bits, o.desc ?? 0];
}

const tga = (o: Head, body: number[]): Uint8Array => new Uint8Array([...header(o), ...body]);
const px = (p: { rgba: Uint8ClampedArray }, i: number): number[] => Array.from(p.rgba.subarray(i * 4, i * 4 + 4));

describe('isTga', () => {
  it('accepts a plausible header when the name has a TGA extension', () => {
    expect(isTga(tga({ type: 2, w: 1, h: 1, bits: 24 }, [0, 0, 0]), 'shot.TGA')).toBe(true);
  });

  it('accepts a plausible header when the footer carries the signature', () => {
    const foot = [0, 0, 0, 0, 0, 0, 0, 0, ...Array.from('TRUEVISION-XFILE.', (c) => c.charCodeAt(0)), 0];
    expect(isTga(tga({ type: 2, w: 1, h: 1, bits: 24 }, [0, 0, 0]), 'blob', new Uint8Array(foot))).toBe(true);
  });

  it('refuses a plausible header with neither footer nor TGA name', () => {
    expect(isTga(tga({ type: 2, w: 1, h: 1, bits: 24 }, [0, 0, 0]), 'photo.png')).toBe(false);
  });

  it('refuses an unknown image type, zero size, a mismatched colour map or odd bit depths', () => {
    expect(isTga(tga({ type: 4, w: 1, h: 1, bits: 24 }, []), 'a.tga')).toBe(false);
    expect(isTga(tga({ type: 2, w: 0, h: 1, bits: 24 }, []), 'a.tga')).toBe(false);
    expect(isTga(tga({ type: 1, w: 1, h: 1, bits: 8, cmType: 0 }, []), 'a.tga')).toBe(false);
    expect(isTga(tga({ type: 2, w: 1, h: 1, bits: 24, cmType: 1 }, []), 'a.tga')).toBe(false);
    expect(isTga(tga({ type: 2, w: 1, h: 1, bits: 8 }, []), 'a.tga')).toBe(false);
    expect(isTga(tga({ type: 3, w: 1, h: 1, bits: 24 }, []), 'a.tga')).toBe(false);
  });

  it('refuses a buffer shorter than the header', () => {
    expect(isTga(new Uint8Array(10), 'a.tga')).toBe(false);
  });
});

describe('decodeTga', () => {
  it('turns BGR into RGB and flips a bottom-origin picture', () => {
    const p = decodeTga(tga({ type: 2, w: 1, h: 2, bits: 24 }, [0, 0, 255, 255, 0, 0]));
    expect(p.width).toBe(1);
    expect(p.height).toBe(2);
    expect(px(p, 0)).toEqual([0, 0, 255, 255]);
    expect(px(p, 1)).toEqual([255, 0, 0, 255]);
  });

  it('keeps row order for a top-origin picture', () => {
    const p = decodeTga(tga({ type: 2, w: 1, h: 2, bits: 24, desc: 0x20 }, [0, 0, 255, 255, 0, 0]));
    expect(px(p, 0)).toEqual([255, 0, 0, 255]);
    expect(px(p, 1)).toEqual([0, 0, 255, 255]);
  });

  it('mirrors columns for a right-origin picture', () => {
    const p = decodeTga(tga({ type: 2, w: 2, h: 1, bits: 24, desc: 0x30 }, [0, 0, 255, 0, 255, 0]));
    expect(px(p, 0)).toEqual([0, 255, 0, 255]);
    expect(px(p, 1)).toEqual([255, 0, 0, 255]);
  });

  it('skips the image id field', () => {
    const p = decodeTga(tga({ type: 2, w: 1, h: 1, bits: 24, idLen: 3 }, [9, 9, 9, 10, 20, 30]));
    expect(px(p, 0)).toEqual([30, 20, 10, 255]);
  });

  it('keeps alpha in 32-bit pictures that declare attribute bits', () => {
    const p = decodeTga(tga({ type: 2, w: 1, h: 1, bits: 32, desc: 8 }, [1, 2, 3, 40]));
    expect(px(p, 0)).toEqual([3, 2, 1, 40]);
  });

  it('makes 32-bit pictures without attribute bits opaque', () => {
    const p = decodeTga(tga({ type: 2, w: 1, h: 1, bits: 32, desc: 0 }, [1, 2, 3, 0]));
    expect(px(p, 0)).toEqual([3, 2, 1, 255]);
  });

  it('expands 16-bit colour and reads the top bit as alpha', () => {
    const p = decodeTga(tga({ type: 2, w: 2, h: 1, bits: 16, desc: 0x21 }, [0x00, 0x7c, 0x1f, 0x80]));
    expect(px(p, 0)).toEqual([255, 0, 0, 0]);
    expect(px(p, 1)).toEqual([0, 0, 255, 255]);
  });

  it('treats 15-bit colour as opaque', () => {
    const p = decodeTga(tga({ type: 2, w: 1, h: 1, bits: 15 }, [0xe0, 0x03]));
    expect(px(p, 0)).toEqual([0, 255, 0, 255]);
  });

  it('reads grey pictures with and without alpha', () => {
    expect(px(decodeTga(tga({ type: 3, w: 1, h: 1, bits: 8 }, [77])), 0)).toEqual([77, 77, 77, 255]);
    expect(px(decodeTga(tga({ type: 3, w: 1, h: 1, bits: 16 }, [77, 12])), 0)).toEqual([77, 77, 77, 12]);
  });

  it('looks up colour-mapped pixels and clamps indices past the map', () => {
    const map = [255, 0, 0, 0, 255, 0];
    const p = decodeTga(tga({ type: 1, cmType: 1, cmLen: 2, cmBits: 24, w: 3, h: 1, bits: 8, desc: 0x20 }, [...map, 0, 1, 9]));
    expect(px(p, 0)).toEqual([0, 0, 255, 255]);
    expect(px(p, 1)).toEqual([0, 255, 0, 255]);
    expect(px(p, 2)).toEqual([0, 255, 0, 255]);
  });

  it('subtracts the first map index from stored indices', () => {
    const map = [255, 0, 0, 0, 0, 255];
    const p = decodeTga(tga({ type: 1, cmType: 1, cmFirst: 5, cmLen: 2, cmBits: 24, w: 1, h: 1, bits: 8 }, [...map, 6]));
    expect(px(p, 0)).toEqual([255, 0, 0, 255]);
  });

  it('unpacks run-length repeat and raw packets', () => {
    const p = decodeTga(tga({ type: 10, w: 5, h: 1, bits: 24 }, [0x82, 1, 2, 3, 0x01, 10, 20, 30, 40, 50, 60]));
    expect(px(p, 0)).toEqual([3, 2, 1, 255]);
    expect(px(p, 2)).toEqual([3, 2, 1, 255]);
    expect(px(p, 3)).toEqual([30, 20, 10, 255]);
    expect(px(p, 4)).toEqual([60, 50, 40, 255]);
  });

  it('refuses run-length data that ends before the picture is full', () => {
    expect(() => decodeTga(tga({ type: 10, w: 4, h: 1, bits: 24 }, [0x81, 1, 2, 3]))).toThrow(/ends early/);
  });

  it('refuses raw data that ends before the picture is full', () => {
    expect(() => decodeTga(tga({ type: 2, w: 2, h: 2, bits: 24 }, [1, 2, 3]))).toThrow(/ends early/);
  });

  it('refuses a header it cannot decode', () => {
    expect(() => decodeTga(new Uint8Array(18))).toThrow();
  });

  it('refuses a picture larger than the pixel cap before allocating it', () => {
    expect(() => decodeTga(tga({ type: 2, w: 65535, h: 65535, bits: 24 }, []))).toThrow(/too large/);
  });
});
