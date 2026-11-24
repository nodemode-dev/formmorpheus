import { describe, expect, it } from 'vitest';
import { patternToGrain, readPatterns, type AbrPattern, type ZipPass } from '@src/io/abr-patt';
import { Bytes, patternRecord } from '../_support/F28';

const read = (bytes: Uint8Array, zip?: ZipPass): { out: AbrPattern[]; warnings: string[] } => {
  const warnings: string[] = [];
  const out = readPatterns(new DataView(bytes.buffer), 0, bytes.length, warnings, zip);
  return { out, warnings };
};
const join = (...parts: Uint8Array[]): Uint8Array => { const b = new Bytes(); for (const p of parts) b.raw(p); return b.bytes(); };

describe('readPatterns', () => {
  it('reads a raw grey pattern with its name and id', () => {
    const rec = patternRecord({ mode: 1, name: 'Canvas\u0000', id: 'abc-1 ', w: 2, h: 2, channels: [{ depth: 8, w: 2, h: 2, comp: 0, data: [10, 20, 30, 40] }] });
    const { out, warnings } = read(rec);
    expect(warnings).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Canvas');
    expect(out[0].id).toBe('abc-1');
    expect([out[0].w, out[0].h]).toEqual([2, 2]);
    expect(Array.from(out[0].grey)).toEqual([10, 20, 30, 40]);
  });

  it('reads run length packed rows', () => {
    const data = new Bytes().u16(2).u16(5).raw([0xfd, 7]).raw([3, 1, 2, 3, 4]).bytes();
    const rec = patternRecord({ mode: 1, name: 'P', id: 'p', w: 4, h: 2, channels: [{ depth: 8, w: 4, h: 2, comp: 1, data }] });
    const { out, warnings } = read(rec);
    expect(warnings).toEqual([]);
    expect(Array.from(out[0].grey)).toEqual([7, 7, 7, 7, 1, 2, 3, 4]);
  });

  it('leaves the rest of a packed row empty when its data ends early', () => {
    const data = new Bytes().u16(3).raw([3, 9, 8]).bytes();
    const rec = patternRecord({ mode: 1, name: 'P', id: 'p', w: 4, h: 1, channels: [{ depth: 8, w: 4, h: 1, comp: 1, data }] });
    expect(Array.from(read(rec).out[0].grey)).toEqual([9, 8, 0, 0]);
  });

  it('turns three colour channels into luminance', () => {
    const ch = (v: number[]): { depth: number; w: number; h: number; comp: number; data: number[] } => ({ depth: 8, w: 3, h: 1, comp: 0, data: v });
    const rec = patternRecord({ mode: 3, name: 'C', id: 'c', w: 3, h: 1, channels: [ch([255, 0, 0]), ch([0, 255, 0]), ch([0, 0, 255])] });
    expect(Array.from(read(rec).out[0].grey)).toEqual([76, 150, 29]);
  });

  it('reads a one bit channel with set bits as black', () => {
    const rec = patternRecord({ mode: 0, name: 'B', id: 'b', w: 4, h: 1, channels: [{ depth: 1, w: 4, h: 1, comp: 0, data: [0b10100000] }] });
    expect(Array.from(read(rec).out[0].grey)).toEqual([0, 255, 0, 255]);
  });

  it('scales sixteen bit samples down to eight bits', () => {
    const data = new Bytes().u16(0).u16(65535).bytes();
    const rec = patternRecord({ mode: 1, name: 'S', id: 's', w: 2, h: 1, channels: [{ depth: 16, w: 2, h: 1, comp: 0, data }] });
    expect(Array.from(read(rec).out[0].grey)).toEqual([0, 255]);
  });

  it('clamps thirty two bit float samples and zeroes the ones that are not finite', () => {
    const f = (x: number): number[] => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x); return Array.from(b); };
    const data = [...f(2), ...f(-1), ...f(Number.NaN), ...f(1)];
    const rec = patternRecord({ mode: 1, name: 'F', id: 'f', w: 4, h: 1, channels: [{ depth: 32, w: 4, h: 1, comp: 0, data }] });
    expect(Array.from(read(rec).out[0].grey)).toEqual([255, 0, 0, 255]);
  });

  it('reads several records in a row', () => {
    const one = (name: string, v: number): Uint8Array => patternRecord({ mode: 1, name, id: name, w: 1, h: 1, channels: [{ depth: 8, w: 1, h: 1, comp: 0, data: [v] }] });
    const { out, warnings } = read(join(one('a', 1), one('bb', 2), one('ccc', 3)));
    expect(warnings).toEqual([]);
    expect(out.map((p) => p.name)).toEqual(['a', 'bb', 'ccc']);
    expect(out.map((p) => p.grey[0])).toEqual([1, 2, 3]);
  });

  it('keeps the good records around an unreadable one', () => {
    const good = patternRecord({ mode: 1, name: 'ok', id: 'ok', w: 1, h: 1, channels: [{ depth: 8, w: 1, h: 1, comp: 0, data: [5] }] });
    const bad = patternRecord({ mode: 1, name: 'bad', id: 'bad', w: 1, h: 1, channels: [{ depth: 12, w: 1, h: 1, comp: 0, data: [5] }] });
    const { out, warnings } = read(join(good, bad, good));
    expect(out.map((p) => p.name)).toEqual(['ok', 'ok']);
    expect(warnings).toHaveLength(1);
  });

  it('refuses a pattern wider than the limit', () => {
    const rec = patternRecord({ mode: 1, name: 'huge', id: 'h', w: 5000, h: 1, channels: [{ depth: 8, w: 5000, h: 1, comp: 0, data: [1] }] });
    const { out, warnings } = read(rec);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('refuses a pattern with a negative size', () => {
    const rec = patternRecord({ mode: 1, name: 'neg', id: 'n', w: -4, h: 2, channels: [] });
    expect(read(rec).out).toEqual([]);
  });

  it('refuses a channel whose pixels run past the record', () => {
    const rec = patternRecord({ mode: 1, name: 'cut', id: 'c', w: 4, h: 4, channels: [{ depth: 8, w: 4, h: 4, comp: 0, data: [1, 2, 3] }] });
    const { out, warnings } = read(rec);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('refuses a name length that runs past the record', () => {
    const body = new Bytes().u32(1).u32(1).u32(0).u32(0x40000000).raw(new Uint8Array(24));
    const rec = new Bytes().u32(body.length).raw(body.bytes()).bytes();
    const { out, warnings } = read(rec);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('stops at a record of length zero instead of looping', () => {
    const { out, warnings } = read(new Uint8Array(64));
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('does not read past a record length that overshoots the section', () => {
    const rec = new Bytes().u32(0xffffff00).raw(new Uint8Array(10)).bytes();
    const { out, warnings } = read(rec);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('gives nothing for an empty section', () => {
    expect(read(new Uint8Array(0))).toEqual({ out: [], warnings: [] });
  });

  it('warns about a zip channel when no second pass is offered', () => {
    const rec = patternRecord({ mode: 1, name: 'z', id: 'z', w: 2, h: 1, channels: [{ depth: 8, w: 2, h: 1, comp: 2, data: [1, 2, 3] }] });
    const { out, warnings } = read(rec);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('queues a zip channel for the second pass without a warning', () => {
    const rec = patternRecord({ mode: 1, name: 'z', id: 'z', w: 2, h: 1, channels: [{ depth: 8, w: 2, h: 1, comp: 3, data: [1, 2, 3] }] });
    const zip: ZipPass = { cache: new Map(), jobs: [] };
    const { out, warnings } = read(rec, zip);
    expect(out).toEqual([]);
    expect(warnings).toEqual([]);
    expect(zip.jobs).toHaveLength(1);
    expect(zip.jobs[0]).toMatchObject({ rowBytes: 2, h: 1, depth: 8, predict: true });
  });

  it('reads a zip channel from the cache on the second pass', () => {
    const rec = patternRecord({ mode: 1, name: 'z', id: 'z', w: 2, h: 1, channels: [{ depth: 8, w: 2, h: 1, comp: 2, data: [1, 2, 3] }] });
    const zip: ZipPass = { cache: new Map(), jobs: [] };
    read(rec, zip);
    zip.cache.set(zip.jobs[0].key, Uint8Array.of(90, 91));
    zip.jobs = [];
    const { out } = read(rec, zip);
    expect(Array.from(out[0].grey)).toEqual([90, 91]);
    expect(zip.jobs).toEqual([]);
  });
});

describe('patternToGrain', () => {
  const pattern = (w: number, h: number, fill: (i: number) => number): AbrPattern => ({ id: 'p', name: 'p', w, h, grey: Uint8Array.from({ length: w * h }, (_, i) => fill(i)) });

  it('repeats a small pattern across the tile inside the tooth band', () => {
    const fit = patternToGrain(pattern(2, 1, (i) => (i ? 255 : 0)));
    expect(fit.tile).toHaveLength(256 * 256);
    expect(fit.fit).toBe(1);
    expect(fit.seamless).toBe(false);
    expect(fit.tile[0]).toBeGreaterThanOrEqual(76);
    expect(fit.tile[0]).toBeLessThanOrEqual(77);
    expect(fit.tile[1]).toBeGreaterThanOrEqual(178);
    expect(fit.tile[1]).toBeLessThanOrEqual(179);
    expect(fit.tile[2]).toBe(fit.tile[0]);
    expect(fit.tile[256 * 255 + 255]).toBe(fit.tile[1]);
  });

  it('resizes a pattern that does not divide the tile and reports the scale', () => {
    const fit = patternToGrain(pattern(100, 100, () => 128));
    expect(fit.fit).toBeCloseTo(0.85, 10);
    expect(fit.seamless).toBe(false);
    expect(new Set(fit.tile).size).toBe(1);
  });

  it('shrinks a large pattern to the tile and marks it for edge blending', () => {
    const fit = patternToGrain(pattern(512, 512, (i) => ((i % 512) < 256 ? 0 : 255)));
    expect(fit.fit).toBe(2);
    expect(fit.seamless).toBe(true);
    expect(fit.tile[0]).toBeLessThan(fit.tile[255]);
  });

  it('stretches a very flat pattern so the texture shows', () => {
    const flat = patternToGrain(pattern(2, 1, (i) => (i ? 120 : 100)));
    expect(flat.tile[1] - flat.tile[0]).toBeGreaterThan(60);
  });

  it('keeps a single flat value unstretched', () => {
    const fit = patternToGrain(pattern(4, 4, () => 255));
    expect(new Set(fit.tile).size).toBe(1);
    expect(fit.tile[0]).toBeGreaterThanOrEqual(178);
  });

  it('returns the same result for the same pattern object', () => {
    const p = pattern(8, 8, (i) => i * 3);
    expect(patternToGrain(p)).toBe(patternToGrain(p));
  });
});
