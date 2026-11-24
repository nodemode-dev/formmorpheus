import { describe, expect, it } from 'vitest';
import { unzipSync, unzlibSync } from 'fflate';
import { encodeGreyPng, exportBrushLib, fileNameFor } from '@src/io/brush-export';

const chunks = (png: Uint8Array): { type: string; body: Uint8Array }[] => {
  const out: { type: string; body: Uint8Array }[] = [];
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 12 <= png.length) {
    const len = v.getUint32(p);
    out.push({ type: String.fromCharCode(...png.subarray(p + 4, p + 8)), body: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
};

describe('encodeGreyPng', () => {
  it('writes the signature and the three chunks in order', () => {
    const png = encodeGreyPng(2, 2, Uint8Array.of(1, 2, 3, 4));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(chunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares the size as eight bit grey', () => {
    const head = chunks(encodeGreyPng(3, 2, new Uint8Array(6)))[0].body;
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    expect([v.getUint32(0), v.getUint32(4), head[8], head[9]]).toEqual([3, 2, 8, 0]);
  });

  it('round trips the pixels through inflate with unfiltered rows', () => {
    const data = Uint8Array.from({ length: 12 }, (_, i) => i * 20);
    const raw = unzlibSync(chunks(encodeGreyPng(4, 3, data))[1].body);
    expect(raw).toHaveLength(15);
    const back: number[] = [];
    for (let y = 0; y < 3; y++) {
      expect(raw[y * 5]).toBe(0);
      back.push(...raw.subarray(y * 5 + 1, y * 5 + 5));
    }
    expect(back).toEqual(Array.from(data));
  });

  it('ends with the standard checksum of the end chunk', () => {
    const png = encodeGreyPng(1, 1, Uint8Array.of(255));
    expect(Array.from(png.subarray(png.length - 4))).toEqual([0xae, 0x42, 0x60, 0x82]);
  });
});

describe('fileNameFor', () => {
  it('replaces characters a file name may not hold', () => {
    expect(fileNameFor('a/b\\c:d*e?f"g<h>i|j', 'brush')).toBe('a_b_c_d_e_f_g_h_i_j.brush');
  });

  it('leaves no path separator in a name that tries to climb folders', () => {
    const name = fileNameFor('../../etc/passwd', 'brushset');
    expect(name).not.toMatch(/[\\/]/);
    expect(name.endsWith('.brushset')).toBe(true);
  });

  it('cuts a long name to sixty characters', () => {
    expect(fileNameFor('x'.repeat(200), 'brushlib')).toBe(`${'x'.repeat(60)}.brushlib`);
  });

  it('falls back to a default for an empty name', () => {
    expect(fileNameFor('   ', 'brush')).toBe('Set.brush');
    expect(fileNameFor('', 'brush')).toBe('Set.brush');
  });

  it('replaces control characters', () => {
    expect(fileNameFor('a\u0000b\nc', 'brush')).toBe('a_b_c.brush');
  });
});

describe('exportBrushLib', () => {
  it('leaves out sets with no brushes and escapes the library name', () => {
    const files = unzipSync(exportBrushLib('Mine & <yours>', [{ name: 'Empty', brushes: [] }]));
    expect(Object.keys(files)).toEqual(['brushlib.plist']);
    const text = new TextDecoder().decode(files['brushlib.plist']);
    expect(text).toContain('Mine &amp; &lt;yours&gt;');
    expect(text).not.toContain('Empty');
  });
});
