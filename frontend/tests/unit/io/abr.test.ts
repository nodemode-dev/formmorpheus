import { describe, expect, it } from 'vitest';
import { parseAbr, parseAbrFile, parseAbrFileAsync } from '@src/io/abr';
import { Bytes, descriptorHead, patternRecord } from '../_support/F28';

const buf = (b: Bytes): ArrayBuffer => b.bytes().buffer as ArrayBuffer;

const computed = (spacing: number, diameter: number, roundness: number, angle: number, hardness: number): Bytes => {
  const body = new Bytes().u32(0).u16(spacing).u16(diameter).u16(roundness).u16(angle & 0xffff).u16(hardness);
  return new Bytes().u16(1).u32(body.length).raw(body.bytes());
};
const sampled = (name: string | null, spacing: number, w: number, h: number, px: number[]): Bytes => {
  const body = new Bytes().u32(0).u16(spacing);
  if (name !== null) body.text(name);
  body.raw(new Uint8Array(9)).i32(0).i32(0).i32(h).i32(w).u16(8).u8(0).raw(px);
  return new Bytes().u16(2).u32(body.length).raw(body.bytes());
};
const section = (key: string, body: Uint8Array): Bytes => {
  const b = new Bytes().ascii('8BIM').ascii(key).u32(body.length).raw(body);
  while (b.length % 4) b.u8(0);
  return b;
};
const sampRecord = (id: string, w: number, h: number, px: number[]): Uint8Array => {
  const body = new Bytes().u8(id.length).ascii(id).raw(new Uint8Array(264)).i32(0).i32(0).i32(h).i32(w).u16(8).u8(0).raw(px);
  const rec = new Bytes().u32(body.length).raw(body.bytes());
  while (rec.length % 4) rec.u8(0);
  return rec.bytes();
};
const preset = (name: string, sampleId: string, spacing: number): Bytes =>
  new Bytes().ascii('Objc').text('').key('brushPreset').u32(2)
    .key('Nm  ').ascii('TEXT').text(name)
    .key('Brsh').ascii('Objc').text('').key('sampledBrush').u32(2)
    .key('sampledData').ascii('TEXT').text(sampleId)
    .key('Spcn').ascii('UntF').ascii('#Prc').f64(spacing);
const descSection = (presets: Bytes[]): Bytes => {
  const d = new Bytes().u32(16).raw(descriptorHead('null', 1).key('Brsh').ascii('VlLs').u32(presets.length).bytes());
  for (const p of presets) d.raw(p.bytes());
  return section('desc', d.bytes());
};
const hierarchy = (entries: Array<[string, string?]>): Bytes => {
  const d = new Bytes().u32(16).raw(descriptorHead('null', 1).key('hierarchy').ascii('VlLs').u32(entries.length).bytes());
  for (const [cls, name] of entries) {
    d.ascii('Objc').text('').key(cls);
    if (name === undefined) d.u32(0); else d.u32(1).key('Nm  ').ascii('TEXT').text(name);
  }
  return section('phry', d.bytes());
};
const modern = (...sections: Bytes[]): ArrayBuffer => {
  const b = new Bytes().u16(6).u16(2);
  for (const s of sections) b.raw(s.bytes());
  return buf(b);
};

describe('parseAbrFile refusals', () => {
  it('refuses a file shorter than four bytes', () => {
    expect(() => parseAbrFile(new ArrayBuffer(3))).toThrow();
    expect(() => parseAbrFile(new ArrayBuffer(0))).toThrow();
  });

  it('refuses versions it does not know', () => {
    for (const version of [0, 3, 5, 11, 0x504b]) {
      expect(() => parseAbrFile(buf(new Bytes().u16(version).u16(1).raw(new Uint8Array(32))))).toThrow();
    }
  });

  it('refuses a modern file with an unknown layout number', () => {
    expect(() => parseAbrFile(buf(new Bytes().u16(6).u16(3).raw(new Uint8Array(32))))).toThrow();
    expect(() => parseAbrFile(buf(new Bytes().u16(10).u16(0).raw(new Uint8Array(32))))).toThrow();
  });

  it('reads a modern file with no sections as empty', () => {
    const f = parseAbrFile(buf(new Bytes().u16(7).u16(1).raw(new Uint8Array(40).fill(0xab))));
    expect(f.version).toBe(7);
    expect([f.samples, f.patterns, f.presets, f.legacy]).toEqual([[], [], [], []]);
  });
});

describe('parseAbrFile on version 1 and 2 files', () => {
  it('reads a computed brush with its numbers', () => {
    const f = parseAbrFile(buf(new Bytes().u16(1).u16(1).raw(computed(25, 40, 100, -30, 80).bytes())), 'Tip');
    expect(f.version).toBe(1);
    expect(f.warnings).toEqual([]);
    expect(f.legacy).toEqual([{ name: 'Tip 1', spacing: 0.25, computed: { diameter: 40, hardness: 80, roundness: 100, angle: -30 } }]);
  });

  it('reads a named sampled brush of a version 2 file', () => {
    const f = parseAbrFile(buf(new Bytes().u16(2).u16(1).raw(sampled(' Chalk\u0000', 50, 2, 2, [1, 2, 3, 4]).bytes())));
    expect(f.legacy).toHaveLength(1);
    expect(f.legacy[0].name).toBe('Chalk');
    expect(f.legacy[0].spacing).toBe(0.5);
    expect(f.legacy[0].tip).toMatchObject({ w: 2, h: 2, srcW: 2, srcH: 2 });
    expect(Array.from(f.legacy[0].tip?.data ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('numbers unnamed brushes after the base name', () => {
    const b = new Bytes().u16(1).u16(2).raw(sampled(null, 10, 1, 1, [9]).bytes()).raw(computed(30, 10, 100, 0, 100).bytes());
    expect(parseAbrFile(buf(b), 'Mine').legacy.map((l) => l.name)).toEqual(['Mine 1', 'Mine 2']);
  });

  it('stops quietly when the brush count overstates the file', () => {
    const f = parseAbrFile(buf(new Bytes().u16(1).u16(60000).raw(computed(25, 40, 100, 0, 80).bytes())));
    expect(f.legacy).toHaveLength(1);
  });

  it('warns about a tip whose pixels are missing and keeps the next brush', () => {
    const cut = sampled(null, 10, 50, 50, [1, 2, 3]);
    const b = new Bytes().u16(1).u16(2).raw(cut.bytes()).raw(computed(30, 10, 100, 0, 100).bytes());
    const f = parseAbrFile(buf(b));
    expect(f.warnings).toHaveLength(1);
    expect(f.legacy).toHaveLength(1);
    expect(f.legacy[0].computed?.diameter).toBe(10);
  });

  it('warns about a tip with a negative size instead of throwing', () => {
    const f = parseAbrFile(buf(new Bytes().u16(1).u16(1).raw(sampled(null, 10, -5, 4, [1, 2, 3, 4]).bytes())));
    expect(f.legacy).toEqual([]);
    expect(f.warnings).toHaveLength(1);
  });
});

describe('parseAbrFile on version 6 to 10 files', () => {
  it('reads tips, presets and folders from their sections', () => {
    const f = parseAbrFile(modern(
      section('samp', sampRecord('tip-a', 2, 2, [10, 20, 30, 40])),
      descSection([preset('Charcoal ', 'tip-a', 40)]),
      hierarchy([['Grup', 'Dry'], ['preset'], ['groupEnd']]),
    ));
    expect(f.warnings).toEqual([]);
    expect(f.samples).toHaveLength(1);
    expect(f.samples[0].id).toBe('tip-a');
    expect(Array.from(f.samples[0].data)).toEqual([10, 20, 30, 40]);
    expect(f.presets).toHaveLength(1);
    expect(f.presets[0].folder).toEqual(['Dry']);
  });

  it('warns and ignores folders when the folder list does not match the presets', () => {
    const f = parseAbrFile(modern(
      section('samp', sampRecord('tip-a', 1, 1, [7])),
      descSection([preset('One', 'tip-a', 40)]),
      hierarchy([['Grup', 'Dry'], ['preset'], ['preset'], ['groupEnd']]),
    ));
    expect(f.presets[0].folder).toEqual([]);
    expect(f.warnings).toHaveLength(1);
  });

  it('warns about a tip record that runs past its section', () => {
    const body = new Bytes().u32(5000).raw(new Uint8Array(60));
    const f = parseAbrFile(modern(section('samp', body.bytes())));
    expect(f.samples).toEqual([]);
    expect(f.warnings).toHaveLength(1);
  });

  it('keeps the presets read before a descriptor is cut short', () => {
    const whole = descSection([preset('One', 'a', 25), preset('Two', 'b', 25)]).bytes();
    const cut = new Bytes().ascii('8BIM').ascii('desc').u32(whole.length - 12 - 20).raw(whole.subarray(12, whole.length - 20));
    const f = parseAbrFile(modern(cut));
    expect(f.presets.length).toBeGreaterThanOrEqual(1);
    expect(f.presets[0].node.items.get('Nm  ')).toBe('One');
    expect(f.warnings).toHaveLength(1);
  });

  it('survives a section length that overshoots the file', () => {
    const b = new Bytes().u16(6).u16(2).ascii('8BIM').ascii('desc').u32(0xfffffff0).raw(new Uint8Array(16));
    const f = parseAbrFile(buf(b));
    expect(f.presets).toEqual([]);
  });

  it('reads patterns from the pattern section', () => {
    const rec = patternRecord({ mode: 1, name: 'Weave', id: 'w1', w: 2, h: 1, channels: [{ depth: 8, w: 2, h: 1, comp: 0, data: [3, 4] }] });
    const f = parseAbrFile(modern(section('patt', rec)));
    expect(f.patterns.map((p) => p.name)).toEqual(['Weave']);
    expect(Array.from(f.patterns[0].grey)).toEqual([3, 4]);
  });

  it('gives the same answer from the async reader when nothing is zip compressed', async () => {
    const file = modern(section('samp', sampRecord('tip-a', 2, 1, [1, 2])), descSection([preset('One', 'tip-a', 30)]));
    const a = await parseAbrFileAsync(file);
    const s = parseAbrFile(file);
    expect(a.samples).toEqual(s.samples);
    expect(a.presets).toHaveLength(1);
    expect(a.warnings).toEqual([]);
  });
});

describe('parseAbr', () => {
  it('pairs each preset with its tip, name, spacing and folder', () => {
    const out = parseAbr(modern(
      section('samp', sampRecord('tip-a', 2, 2, [10, 20, 30, 40])),
      descSection([preset('Charcoal ', 'tip-a', 40), preset('', 'missing', 10)]),
      hierarchy([['Grup', 'Dry'], ['Grup', 'Soft'], ['preset'], ['groupEnd'], ['preset'], ['groupEnd']]),
    ));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Charcoal');
    expect(out[0].spacing).toBeCloseTo(0.4, 10);
    expect(out[0].folder).toBe('Dry/Soft');
    expect(out[0].tip).toEqual({ w: 2, h: 2, data: Uint8Array.of(10, 20, 30, 40) });
  });

  it('draws a computed brush as a soft round tip', () => {
    const out = parseAbr(buf(new Bytes().u16(1).u16(1).raw(computed(25, 40, 100, 0, 50).bytes())));
    expect(out).toHaveLength(1);
    const tip = out[0].tip;
    expect([tip.w, tip.h]).toEqual([40, 40]);
    expect(tip.data[20 * 40 + 20]).toBe(255);
    expect(tip.data[0]).toBe(0);
    const edge = tip.data[20 * 40 + 36];
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('clamps a computed brush to between 2 and 400 pixels across', () => {
    const big = parseAbr(buf(new Bytes().u16(1).u16(1).raw(computed(25, 5000, 100, 0, 100).bytes())));
    const none = parseAbr(buf(new Bytes().u16(1).u16(1).raw(computed(25, 0, 100, 0, 100).bytes())));
    expect(big[0].tip.w).toBe(400);
    expect(none[0].tip.w).toBe(2);
  });

  it('squeezes a computed brush by its roundness', () => {
    const tip = parseAbr(buf(new Bytes().u16(1).u16(1).raw(computed(25, 40, 25, 0, 100).bytes())))[0].tip;
    expect(tip.data[20 * 40 + 4]).toBe(255);
    expect(tip.data[4 * 40 + 20]).toBe(0);
  });
});
