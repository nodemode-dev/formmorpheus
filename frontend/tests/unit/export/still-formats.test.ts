import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { encodeBmp, encodeRaw, encodeTga, encodeTiff, pictureHasAlpha, pictureMime } from '@src/export/still-formats';

function picture(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = (i * 7 + 1) & 255;
    px[i * 4 + 1] = (i * 13 + 2) & 255;
    px[i * 4 + 2] = (i * 29 + 3) & 255;
    px[i * 4 + 3] = (i * 31 + 4) & 255;
  }
  return px;
}

interface Tag { type: number; count: number; value: number }

function readIfd(file: Uint8Array): Map<number, Tag> {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const at = dv.getUint32(4, true);
  const n = dv.getUint16(at, true);
  const tags = new Map<number, Tag>();
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    const type = dv.getUint16(e + 2, true);
    const count = dv.getUint32(e + 4, true);
    const value = type === 3 && count === 1 ? dv.getUint16(e + 8, true) : dv.getUint32(e + 8, true);
    tags.set(dv.getUint16(e, true), { type, count, value });
  }
  expect(dv.getUint32(at + 2 + n * 12, true)).toBe(0);
  return tags;
}

function tiffPixels(file: Uint8Array, inflate: boolean): Uint8Array {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const tags = readIfd(file);
  const offs = tags.get(273) as Tag;
  const cnts = tags.get(279) as Tag;
  const parts: number[] = [];
  for (let i = 0; i < offs.count; i++) {
    const o = offs.count > 1 ? dv.getUint32(offs.value + i * 4, true) : offs.value;
    const c = cnts.count > 1 ? dv.getUint32(cnts.value + i * 4, true) : cnts.value;
    const chunk = file.subarray(o, o + c);
    parts.push(...(inflate ? unzlibSync(chunk) : chunk));
  }
  return Uint8Array.from(parts);
}

describe('picture format facts', () => {
  it('says which formats carry transparency', () => {
    expect(['png', 'tiff', 'tga', 'webp'].every(pictureHasAlpha)).toBe(true);
    expect(pictureHasAlpha('bmp')).toBe(false);
    expect(pictureHasAlpha('jpg')).toBe(false);
  });

  it('gives a generic type for an unknown extension', () => {
    expect(pictureMime('tiff')).toBe('image/tiff');
    expect(pictureMime('jpg')).toBe('image/jpeg');
    expect(pictureMime('exe')).toBe('application/octet-stream');
  });
});

describe('encodeTga', () => {
  it('writes an 18 byte true-colour header with a top-left origin', () => {
    const out = encodeTga(picture(3, 2), 3, 2, true);
    const dv = new DataView(out.buffer);
    expect(out.length).toBe(18 + 3 * 2 * 4);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(2);
    expect(dv.getUint16(12, true)).toBe(3);
    expect(dv.getUint16(14, true)).toBe(2);
    expect(out[16]).toBe(32);
    expect(out[17]).toBe(0x28);
  });

  it('stores pixels as blue green red alpha in reading order', () => {
    const px = picture(2, 2);
    const out = encodeTga(px, 2, 2, true);
    for (let i = 0; i < 4; i++) {
      expect(Array.from(out.subarray(18 + i * 4, 22 + i * 4))).toEqual([px[i * 4 + 2], px[i * 4 + 1], px[i * 4], px[i * 4 + 3]]);
    }
  });

  it('drops alpha and declares 24 bits without alpha', () => {
    const px = picture(2, 1);
    const out = encodeTga(px, 2, 1, false);
    expect(out.length).toBe(18 + 6);
    expect(out[16]).toBe(24);
    expect(out[17]).toBe(0x20);
    expect(Array.from(out.subarray(18))).toEqual([px[2], px[1], px[0], px[6], px[5], px[4]]);
  });
});

describe('encodeBmp', () => {
  it('writes the file and info headers', () => {
    const out = encodeBmp(picture(3, 2), 3, 2);
    const dv = new DataView(out.buffer);
    expect(String.fromCharCode(out[0], out[1])).toBe('BM');
    expect(dv.getUint32(2, true)).toBe(out.length);
    expect(dv.getUint32(10, true)).toBe(54);
    expect(dv.getUint32(14, true)).toBe(40);
    expect(dv.getInt32(18, true)).toBe(3);
    expect(dv.getInt32(22, true)).toBe(2);
    expect(dv.getUint16(26, true)).toBe(1);
    expect(dv.getUint16(28, true)).toBe(24);
    expect(dv.getUint32(30, true)).toBe(0);
    expect(dv.getUint32(34, true)).toBe(out.length - 54);
  });

  it('pads every row to a multiple of four bytes', () => {
    expect(encodeBmp(picture(1, 1), 1, 1).length).toBe(54 + 4);
    expect(encodeBmp(picture(3, 2), 3, 2).length).toBe(54 + 12 * 2);
    expect(encodeBmp(picture(4, 3), 4, 3).length).toBe(54 + 12 * 3);
    expect(encodeBmp(picture(5, 1), 5, 1).length).toBe(54 + 16);
  });

  it('stores rows bottom up as blue green red with zero padding', () => {
    const px = picture(1, 2);
    const out = encodeBmp(px, 1, 2);
    expect(Array.from(out.subarray(54, 58))).toEqual([px[6], px[5], px[4], 0]);
    expect(Array.from(out.subarray(58, 62))).toEqual([px[2], px[1], px[0], 0]);
  });
});

describe('encodeTiff', () => {
  it('starts with the little-endian signature and an ascending tag list', () => {
    const out = encodeTiff(picture(4, 3), 4, 3, true, false);
    const dv = new DataView(out.buffer);
    expect(Array.from(out.subarray(0, 4))).toEqual([0x49, 0x49, 42, 0]);
    expect(dv.getUint32(4, true)).toBe(8);
    const ids = [...readIfd(out).keys()];
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.length).toBe(11);
  });

  it('describes an uncompressed picture with unassociated alpha', () => {
    const out = encodeTiff(picture(4, 3), 4, 3, true, false);
    const dv = new DataView(out.buffer);
    const tags = readIfd(out);
    expect(tags.get(256)?.value).toBe(4);
    expect(tags.get(257)?.value).toBe(3);
    expect(tags.get(259)?.value).toBe(1);
    expect(tags.get(262)?.value).toBe(2);
    expect(tags.get(277)?.value).toBe(4);
    expect(tags.get(284)?.value).toBe(1);
    expect(tags.get(338)?.value).toBe(2);
    const bps = tags.get(258) as Tag;
    expect(bps.count).toBe(4);
    expect([0, 1, 2, 3].map((i) => dv.getUint16(bps.value + i * 2, true))).toEqual([8, 8, 8, 8]);
  });

  it('keeps every pixel byte of a picture with alpha', () => {
    const px = picture(4, 3);
    const out = encodeTiff(px, 4, 3, true, false);
    expect(Array.from(tiffPixels(out, false))).toEqual(Array.from(px));
  });

  it('leaves the alpha tag out and packs three bytes a pixel without alpha', () => {
    const px = picture(2, 2);
    const out = encodeTiff(px, 2, 2, false, false);
    const tags = readIfd(out);
    expect(tags.has(338)).toBe(false);
    expect(tags.size).toBe(10);
    expect(tags.get(277)?.value).toBe(3);
    expect(tags.get(258)?.count).toBe(3);
    const want: number[] = [];
    for (let i = 0; i < 4; i++) want.push(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    expect(Array.from(tiffPixels(out, false))).toEqual(want);
    expect(out.length).toBe((tags.get(273) as Tag).value + 12);
  });

  it('marks deflate and the strip inflates back to the pixels', () => {
    const px = picture(8, 8);
    const out = encodeTiff(px, 8, 8, true, true);
    const tags = readIfd(out);
    expect(tags.get(259)?.value).toBe(8);
    expect((tags.get(273) as Tag).value + (tags.get(279) as Tag).value).toBe(out.length);
    expect(Array.from(tiffPixels(out, true))).toEqual(Array.from(px));
  });

  it('splits a tall picture into strips of at most 64 KB that tile the file', () => {
    const w = 4096, h = 9;
    const px = picture(w, h);
    const out = encodeTiff(px, w, h, true, false);
    const dv = new DataView(out.buffer);
    const tags = readIfd(out);
    expect(tags.get(278)?.value).toBe(4);
    const offs = tags.get(273) as Tag;
    const cnts = tags.get(279) as Tag;
    expect(offs.count).toBe(3);
    expect(cnts.count).toBe(3);
    const o = [0, 1, 2].map((i) => dv.getUint32(offs.value + i * 4, true));
    const c = [0, 1, 2].map((i) => dv.getUint32(cnts.value + i * 4, true));
    expect(c).toEqual([65536, 65536, 16384]);
    expect(o[1]).toBe(o[0] + c[0]);
    expect(o[2]).toBe(o[1] + c[1]);
    expect(o[2] + c[2]).toBe(out.length);
    const body = out.subarray(o[0]);
    expect(body.length).toBe(px.length);
    expect(body[0]).toBe(px[0]);
    expect(body[px.length - 1]).toBe(px[px.length - 1]);
    expect(body[70001]).toBe(px[70001]);
  });

  it('keeps one row per strip when a single row is wider than 64 KB', () => {
    const w = 20000;
    const out = encodeTiff(new Uint8ClampedArray(w * 2 * 4), w, 2, true, false);
    const tags = readIfd(out);
    expect(tags.get(278)?.value).toBe(1);
    expect(tags.get(273)?.count).toBe(2);
  });
});

describe('encodeRaw', () => {
  it('routes each extension to its encoder', () => {
    const px = picture(3, 3);
    expect(encodeRaw('tiff', px, 3, 3, true, true)).toEqual(encodeTiff(px, 3, 3, true, true));
    expect(encodeRaw('tga', px, 3, 3, false, false)).toEqual(encodeTga(px, 3, 3, false));
    expect(encodeRaw('bmp', px, 3, 3, true, false)).toEqual(encodeBmp(px, 3, 3));
  });
});
