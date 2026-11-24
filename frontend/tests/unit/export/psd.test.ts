import { describe, expect, it } from 'vitest';
import { encodePsdLayer, psdBlendKey, writePsd, writePsdEncoded } from '@src/export/psd';
import type { BlendMode } from '@src/engine/types';

const dvOf = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);
const str = (b: Uint8Array, o: number, n = 4): string => String.fromCharCode(...b.subarray(o, o + n));

function unpack(src: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length;) {
    const n = src[i++];
    if (n < 128) { for (let k = 0; k <= n; k++) out.push(src[i++]); }
    else if (n > 128) { for (let k = 0; k < 257 - n; k++) out.push(src[i]); i++; }
  }
  return out;
}

function canvas(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(paint(x, y), (y * w + x) * 4);
  return px;
}

describe('psdBlendKey', () => {
  it('maps blend modes to their four letter keys', () => {
    expect(psdBlendKey('normal')).toBe('norm');
    expect(psdBlendKey('multiply')).toBe('mul ');
    expect(psdBlendKey('add')).toBe('lddg');
  });

  it('falls back to normal for a mode it does not know', () => {
    expect(psdBlendKey('nonsense' as BlendMode)).toBe('norm');
  });
});

describe('encodePsdLayer', () => {
  const rgba = canvas(6, 5, (x, y) => (x >= 2 && x <= 4 && y >= 1 && y <= 2 ? [10 * x, 200, y, 255] : [0, 0, 0, 0]));

  it('records the rectangle of the painted pixels as top, left, bottom, right', () => {
    const { rec } = encodePsdLayer(6, 5, { name: 'ink', rgba, opacity: 1, blend: 'normal' });
    const dv = dvOf(rec);
    expect([dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12)]).toEqual([1, 2, 3, 5]);
    expect(dv.getUint16(16)).toBe(4);
    expect([dv.getInt16(18), dv.getInt16(24), dv.getInt16(30), dv.getInt16(36)]).toEqual([-1, 0, 1, 2]);
  });

  it('stores each channel as row counts and PackBits rows that decode to the pixels', () => {
    const { rec, dat } = encodePsdLayer(6, 5, { name: 'ink', rgba, opacity: 1, blend: 'normal' });
    const rd = dvOf(rec), dd = dvOf(dat);
    const want = [
      [255, 255, 255, 255, 255, 255],
      [20, 30, 40, 20, 30, 40],
      [200, 200, 200, 200, 200, 200],
      [1, 1, 1, 2, 2, 2],
    ];
    let at = 0;
    for (let k = 0; k < 4; k++) {
      const len = rd.getUint32(20 + k * 6);
      expect(dd.getUint16(at)).toBe(1);
      const c0 = dd.getUint16(at + 2), c1 = dd.getUint16(at + 4);
      expect(2 + 4 + c0 + c1).toBe(len);
      expect(unpack(dat.subarray(at + 6, at + 6 + c0 + c1))).toEqual(want[k]);
      at += len;
    }
    expect(at).toBe(dat.length);
  });

  it('writes the blend key, a clamped opacity and the hidden flag', () => {
    const half = encodePsdLayer(6, 5, { name: 'a', rgba, opacity: 0.5, blend: 'screen' }).rec;
    expect([str(half, 42), str(half, 46), half[50], half[52]]).toEqual(['8BIM', 'scrn', 128, 0]);
    const over = encodePsdLayer(6, 5, { name: 'a', rgba, opacity: 7, blend: 'normal', hidden: true }).rec;
    expect([over[50], over[52]]).toEqual([255, 2]);
    expect(encodePsdLayer(6, 5, { name: 'a', rgba, opacity: -1, blend: 'normal' }).rec[50]).toBe(0);
  });

  it('writes a padded short name and the full Unicode name', () => {
    const { rec } = encodePsdLayer(6, 5, { name: 'Caf\u00e9 1', rgba, opacity: 1, blend: 'normal' });
    const dv = dvOf(rec);
    const extra = dv.getUint32(54);
    expect(rec).toHaveLength(58 + extra);
    expect([dv.getUint32(58), dv.getUint32(62)]).toEqual([0, 0]);
    expect(rec[66]).toBe(6);
    expect(str(rec, 67, 6)).toBe('Caf_ 1');
    expect(rec[73]).toBe(0);
    expect([str(rec, 74), str(rec, 78)]).toEqual(['8BIM', 'luni']);
    expect(dv.getUint32(82) % 4).toBe(0);
    expect(dv.getUint32(86)).toBe(6);
    const name = Array.from({ length: 6 }, (_, i) => String.fromCharCode(dv.getUint16(90 + i * 2))).join('');
    expect(name).toBe('Caf\u00e9 1');
  });

  it('cuts the short name at 31 characters', () => {
    const { rec } = encodePsdLayer(6, 5, { name: 'x'.repeat(80), rgba, opacity: 1, blend: 'normal' });
    expect(rec[66]).toBe(31);
    expect(dvOf(rec).getUint32(66 + 32 + 12)).toBe(80);
  });

  it('writes an empty layer as a zero rectangle with raw empty channels', () => {
    const { rec, dat } = encodePsdLayer(6, 5, { name: 'none', rgba: new Uint8ClampedArray(120), opacity: 1, blend: 'normal' });
    const dv = dvOf(rec);
    expect([dv.getUint32(0), dv.getUint32(4), dv.getUint32(8), dv.getUint32(12)]).toEqual([0, 0, 0, 0]);
    expect([dv.getUint32(20), dv.getUint32(26), dv.getUint32(32), dv.getUint32(38)]).toEqual([2, 2, 2, 2]);
    expect(Array.from(dat)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('writePsd', () => {
  const merged = canvas(7, 3, (x, y) => [x < 4 ? 9 : x * 30, y * 80, (x * y) % 3, 100 + x]);
  const layer = { name: 'one', rgba: merged, opacity: 1, blend: 'normal' as BlendMode };

  it('writes the file header for an 8 bit RGB picture', () => {
    const b = writePsd(7, 3, [layer], merged, false);
    const dv = dvOf(b);
    expect(str(b, 0)).toBe('8BPS');
    expect(dv.getUint16(4)).toBe(1);
    expect(Array.from(b.subarray(6, 12))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([dv.getUint16(12), dv.getUint32(14), dv.getUint32(18), dv.getUint16(22), dv.getUint16(24)]).toEqual([3, 3, 7, 8, 3]);
    expect([dv.getUint32(26), dv.getUint32(30)]).toEqual([0, 0]);
  });

  it('keeps the layer section lengths consistent and even', () => {
    const b = writePsd(7, 3, [layer, { ...layer, name: 'two' }], merged, false);
    const dv = dvOf(b);
    const section = dv.getUint32(34), info = dv.getUint32(38);
    expect(section).toBe(info + 8);
    expect(info % 2).toBe(0);
    expect(dv.getInt16(42)).toBe(2);
    expect(dv.getUint32(38 + 4 + info)).toBe(0);
    expect(dv.getUint16(38 + section)).toBe(1);
  });

  it('writes a negative layer count when the merged picture keeps its alpha', () => {
    const b = writePsd(7, 3, [layer, layer], merged, true);
    expect(dvOf(b).getUint16(12)).toBe(4);
    expect(dvOf(b).getInt16(42)).toBe(-2);
  });

  it('stores a merged picture that decodes back channel by channel', () => {
    for (const alpha of [false, true]) {
      const b = writePsd(7, 3, [layer], merged, alpha);
      const dv = dvOf(b);
      const mch = alpha ? 4 : 3;
      let at = 38 + dv.getUint32(34) + 2;
      const counts: number[] = [];
      for (let i = 0; i < mch * 3; i++, at += 2) counts.push(dv.getUint16(at));
      for (let c = 0; c < mch; c++) {
        for (let y = 0; y < 3; y++) {
          const n = counts[c * 3 + y];
          const want = Array.from({ length: 7 }, (_, x) => merged[(y * 7 + x) * 4 + c]);
          expect(unpack(b.subarray(at, at + n))).toEqual(want);
          at += n;
        }
      }
      expect(at).toBe(b.length);
    }
  });

  it('writes a file with no layers at all', () => {
    const b = writePsdEncoded(7, 3, [], merged, false);
    expect(dvOf(b).getInt16(42)).toBe(0);
    expect(dvOf(b).getUint32(38)).toBe(2);
  });

  it('refuses a side longer than 30000 pixels', () => {
    expect(() => writePsdEncoded(30001, 1, [], new Uint8ClampedArray(4), false)).toThrow(/30000/);
    expect(() => writePsdEncoded(1, 30001, [], new Uint8ClampedArray(4), false)).toThrow(/30000/);
  });
});
