import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import {
  MAX_COLORS, exportAse, exportFmpal, exportGpl, exportPalette, exportSwatches, fromHex, hsbToRgb, paletteFromPixels,
  parseAse, parseGpl, parsePaletteFile, parseSwatches, rgbToHsb, toHex, type PaletteData, type Rgb,
} from '@src/io/palette-io';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const sample: PaletteData = { name: 'Dusk', colors: [{ r: 255, g: 0, b: 0 }, { r: 12, g: 200, b: 99 }, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 40, g: 80, b: 160 }] };
const HEAD = dec(exportGpl({ name: '', colors: [] })).split('\n')[0];
const many = (n: number): Rgb[] => Array.from({ length: n }, (_, i) => ({ r: i, g: 255 - i, b: (i * 7) % 256 }));

describe('hex conversion', () => {
  it('reads six digit hex with or without the hash and in any case', () => {
    expect(fromHex('#FF8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(fromHex(' ff8000 ')).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('refuses short, long and non hex text', () => {
    expect(fromHex('#fff')).toBeNull();
    expect(fromHex('#ff80001')).toBeNull();
    expect(fromHex('#gg0000')).toBeNull();
    expect(fromHex('')).toBeNull();
  });

  it('clamps and rounds channels when writing hex', () => {
    expect(toHex({ r: 300, g: -5, b: Number.NaN })).toBe('#ff0000');
    expect(toHex({ r: 0.6, g: 15, b: 254.4 })).toBe('#010ffe');
  });
});

describe('hue saturation brightness', () => {
  it('gives pure red a hue of zero at full saturation', () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, b: 1 });
  });

  it('gives grey and black no saturation', () => {
    expect(rgbToHsb({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(rgbToHsb({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, b: 0 });
  });

  it('turns a third of the wheel into green and wraps hues outside 0 to 1', () => {
    expect(hsbToRgb(1 / 3, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsbToRgb(1.5, 1, 1)).toEqual({ r: 0, g: 255, b: 255 });
    expect(hsbToRgb(-0.5, 1, 1)).toEqual({ r: 0, g: 255, b: 255 });
  });

  it('round trips colors through hsb', () => {
    for (const c of sample.colors) {
      const h = rgbToHsb(c);
      expect(hsbToRgb(h.h, h.s, h.b)).toEqual(c);
    }
  });
});

describe('palette round trips', () => {
  it('keeps name and colors through the own json format', () => {
    expect(parsePaletteFile(exportFmpal(sample), 'x.fmpal')).toEqual([sample]);
  });

  it('keeps name and colors through the text palette format', () => {
    expect(parsePaletteFile(exportGpl(sample), 'x.gpl')).toEqual([sample]);
  });

  it('keeps colors through the swatch exchange format and names the palette after the file', () => {
    expect(parsePaletteFile(exportAse(sample), 'Evening sky.ase')).toEqual([{ name: 'Evening sky', colors: sample.colors }]);
  });

  it('keeps name and colors through the swatches archive within one step per channel', () => {
    const back = parsePaletteFile(exportSwatches(sample), 'x.swatches');
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe('Dusk');
    expect(back[0].colors).toHaveLength(sample.colors.length);
    back[0].colors.forEach((c, i) => {
      expect(Math.abs(c.r - sample.colors[i].r)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.g - sample.colors[i].g)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.b - sample.colors[i].b)).toBeLessThanOrEqual(1);
    });
  });

  it('writes each format through the one export entry point', () => {
    expect(Array.from(exportPalette(sample, 'gpl'))).toEqual(Array.from(exportGpl(sample)));
    expect(Array.from(exportPalette(sample, 'ase'))).toEqual(Array.from(exportAse(sample)));
    expect(Array.from(exportPalette(sample, 'fmpal'))).toEqual(Array.from(exportFmpal(sample)));
    expect(parseSwatches(exportPalette(sample, 'swatches'), 'f')[0].name).toBe('Dusk');
  });
});

describe('writers', () => {
  it('pads the swatches archive to thirty entries with nulls and drops colors past thirty', () => {
    const files = unzipSync(exportSwatches(sample));
    const json = JSON.parse(dec(files['Swatches.json'])) as { name: string; swatches: unknown[] }[];
    expect(json).toHaveLength(1);
    expect(json[0].swatches).toHaveLength(MAX_COLORS);
    expect(json[0].swatches.slice(sample.colors.length).every((v) => v === null)).toBe(true);
    expect(json[0].swatches[0]).toMatchObject({ hue: 0, saturation: 1, brightness: 1 });
    const pal = parseSwatches(exportSwatches({ name: 'Big', colors: many(45) }), 'f');
    expect(pal[0].colors).toHaveLength(MAX_COLORS);
  });

  it('keeps a line break in a name from starting a new line of the text palette', () => {
    const text = dec(exportGpl({ name: 'a\nb', colors: [{ r: 1, g: 2, b: 3 }] }));
    expect(text.split('\n')[1]).toBe('Name: a b');
    expect(parseGpl(text, 'f').colors).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it('writes the swatch exchange header with the block count', () => {
    const b = exportAse(sample);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    expect(dec(b.subarray(0, 4))).toBe('ASEF');
    expect(dv.getUint32(8)).toBe(sample.colors.length);
  });
});

describe('readers and their refusals', () => {
  it('refuses text that is not a text palette', () => {
    expect(() => parseGpl('1 2 3\n', 'f')).toThrow();
  });

  it('skips comments, blank lines and junk in a text palette and clamps values', () => {
    const p = parseGpl(`${HEAD}\r\nName:\r\nColumns: 4\r\n# note\r\n\r\n300 0 7 loud\r\nnot a color\r\n`, 'Fallback');
    expect(p).toEqual({ name: 'Fallback', colors: [{ r: 255, g: 0, b: 7 }] });
  });

  it('stops a text palette at thirty colors', () => {
    const lines = [HEAD, ...many(50).map((c) => `${c.r} ${c.g} ${c.b}`)];
    expect(parseGpl(lines.join('\n'), 'f').colors).toHaveLength(MAX_COLORS);
  });

  it('caps a long own json palette at thirty colors and a long name at 32 characters', () => {
    const out = parsePaletteFile(exportFmpal({ name: 'n'.repeat(80), colors: many(70) }), 'x.fmpal');
    expect(out[0].colors).toEqual(many(MAX_COLORS));
    expect(out[0].name).toBe('n'.repeat(32));
  });

  it('skips entries that are not hex colors in the own json format', () => {
    const text = JSON.stringify({ format: 'formmorpheus-palette', version: 1, name: '  ', colors: ['#010203', null, 7, 'red', { r: 1 }, '#0a0b0c'] });
    expect(parsePaletteFile(enc(text), 'Mine.fmpal')).toEqual([{ name: 'Mine', colors: [{ r: 1, g: 2, b: 3 }, { r: 10, g: 11, b: 12 }] }]);
  });

  it('reads a bare swatches json, skipping damaged entries and clamping saturation', () => {
    const text = JSON.stringify([{ name: ' Warm ', swatches: [{ hue: 0, saturation: 5, brightness: 1 }, null, { hue: 'x', saturation: 1, brightness: 1 }, 3] }, { name: 'none' }, null]);
    expect(parsePaletteFile(enc(text), 'x.json')).toEqual([{ name: 'Warm', colors: [{ r: 255, g: 0, b: 0 }] }]);
  });

  it('refuses a file with no colors at all', () => {
    expect(() => parsePaletteFile(exportFmpal({ name: 'Empty', colors: [] }), 'x.fmpal')).toThrow();
    expect(() => parsePaletteFile(enc(`${HEAD}\nName: x\n`), 'x.gpl')).toThrow();
  });

  it('refuses damaged json and unknown content', () => {
    expect(() => parsePaletteFile(enc('{"format": "formmorpheus-palette", '), 'x.fmpal')).toThrow();
    expect(() => parsePaletteFile(enc('hello there'), 'x.txt')).toThrow();
    expect(() => parsePaletteFile(new Uint8Array(0), 'x.ase')).toThrow();
  });

  it('refuses an archive that holds no swatches json', () => {
    expect(() => parseSwatches(zipSync({ 'other.json': enc('[]') }), 'f')).toThrow();
  });

  it('refuses an archive whose swatches json is damaged', () => {
    expect(() => parseSwatches(zipSync({ 'Swatches.json': enc('[{') }), 'f')).toThrow();
  });

  it('refuses bytes that only start like an archive', () => {
    expect(() => parsePaletteFile(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9, 9, 9]), 'x.swatches')).toThrow();
  });

  it('finds the swatches json inside a folder of the archive', () => {
    const inner = JSON.stringify([{ name: 'In', swatches: [{ hue: 0, saturation: 0, brightness: 1 }] }]);
    expect(parseSwatches(zipSync({ 'pack/Swatches.json': enc(inner) }), 'f')).toEqual([{ name: 'In', colors: [{ r: 255, g: 255, b: 255 }] }]);
  });

  it('refuses a swatch exchange file that is too short or has the wrong signature', () => {
    expect(() => parseAse(enc('ASEF'), 'f')).toThrow();
    expect(() => parseAse(enc('NOPE00000000'), 'f')).toThrow();
  });

  it('keeps the colors before the cut when a swatch exchange file is truncated', () => {
    const whole = exportAse(sample);
    const cut = whole.subarray(0, whole.length - 5);
    expect(parseAse(cut, 'f')).toEqual([{ name: 'f', colors: sample.colors.slice(0, 4) }]);
  });

  it('survives a swatch exchange header that claims billions of blocks', () => {
    const b = exportAse(sample).slice();
    new DataView(b.buffer).setUint32(8, 0xffffffff);
    expect(parseAse(b, 'f')[0].colors).toEqual(sample.colors);
  });

  it('caps a swatch exchange palette at thirty colors', () => {
    expect(parseAse(exportAse({ name: 'x', colors: many(44) }), 'f')[0].colors).toEqual(many(MAX_COLORS));
  });
});

describe('paletteFromPixels', () => {
  const fill = (cols: [number, number, number, number][], each: number): Uint8Array => {
    const out = new Uint8Array(cols.length * each * 4);
    let o = 0;
    for (const c of cols) for (let i = 0; i < each; i++) { out.set(c, o); o += 4; }
    return out;
  };

  it('returns nothing for a fully transparent picture', () => {
    expect(paletteFromPixels(fill([[200, 10, 10, 0]], 16), 4, 4, 5)).toEqual([]);
  });

  it('returns the one color of a flat picture', () => {
    const out = paletteFromPixels(fill([[40, 80, 160, 255]], 16), 4, 4, 8);
    expect(out).toHaveLength(1);
    expect(Math.abs(out[0].r - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[0].g - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[0].b - 160)).toBeLessThanOrEqual(1);
  });

  it('ignores mostly transparent pixels and puts greys last', () => {
    const px = fill([[128, 128, 128, 255], [255, 0, 0, 255], [0, 255, 0, 20]], 20);
    const out = paletteFromPixels(px, 60, 1, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ r: 255, g: 0, b: 0 });
    expect(out[1].r).toBe(out[1].g);
    expect(out[1].g).toBe(out[1].b);
  });

  it('gives the same palette for the same picture every time and never more than thirty colors', () => {
    const px = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) px.set([(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255], i * 4);
    const a = paletteFromPixels(px, 64, 64, 500);
    expect(a.length).toBeGreaterThan(5);
    expect(a.length).toBeLessThanOrEqual(MAX_COLORS);
    expect(paletteFromPixels(px, 64, 64, 500)).toEqual(a);
    expect(paletteFromPixels(px, 64, 64, 1).length).toBeLessThanOrEqual(5);
  });
});
