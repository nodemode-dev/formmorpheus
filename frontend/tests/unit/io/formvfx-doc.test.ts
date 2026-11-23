import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FORMVFX_FORMAT, looksLikeFormvfx, parseFormvfx } from '@src/io/formvfx-doc';

const dims = { fps: 24, width: 100, height: 50 };
const comp = (over: Record<string, unknown> = {}, name = 'Main', id = 1): Record<string, unknown> => ({ id, name, kind: { type: 'Comp', layers: [], width: 100, height: 50, duration: 2, frameRate: 24, ...over } });
const project = (items: unknown[]): Uint8Array => strToU8(JSON.stringify({ format: FORMVFX_FORMAT, items }));

describe('formvfx sniffing', () => {
  it('recognises the format field at the head of a project', () => {
    expect(looksLikeFormvfx(`{ "format" : "${FORMVFX_FORMAT}", "items": [] }`)).toBe(true);
  });

  it('does not recognise other JSON', () => {
    expect(looksLikeFormvfx('{"format":"something.else/1"}')).toBe(false);
    expect(looksLikeFormvfx('')).toBe(false);
  });
});

describe('formvfx project refusals', () => {
  it('refuses text that is not JSON and names the file', () => {
    expect(() => parseFormvfx(strToU8('not json'), 'a.fvxproj', dims)).toThrow(/a\.fvxproj.*not JSON/);
  });

  it('refuses JSON without the format marker', () => {
    expect(() => parseFormvfx(strToU8('{"items":[]}'), 'a.fvxproj', dims)).toThrow(/not a formvfx project/);
    expect(() => parseFormvfx(strToU8('null'), 'a.fvxproj', dims)).toThrow(/not a formvfx project/);
    expect(() => parseFormvfx(strToU8('{"format":7}'), 'a.fvxproj', dims)).toThrow(/not a formvfx project/);
  });

  it('refuses a project with no composition', () => {
    expect(() => parseFormvfx(project([]), 'a.fvxproj', dims)).toThrow(/no composition/);
    expect(() => parseFormvfx(strToU8(JSON.stringify({ format: FORMVFX_FORMAT, items: 'x' })), 'a.fvxproj', dims)).toThrow(/no composition/);
  });

  it('refuses a bundle that holds no project file', () => {
    const zip = zipSync({ 'Footage/a.png': new Uint8Array([1]) });
    expect(() => parseFormvfx(zip, 'b.zip', dims)).toThrow(/no \.fvxproj project/);
  });

  it('refuses a damaged bundle', () => {
    const bad = new Uint8Array(64);
    bad[0] = 0x50; bad[1] = 0x4b;
    expect(() => parseFormvfx(bad, 'b.zip', dims)).toThrow(/not a readable bundle/);
  });
});

describe('formvfx project reading', () => {
  it('reads an empty composition with its size and its length at the movie frame rate', () => {
    const r = parseFormvfx(project([comp()]), 'a.fvxproj', dims);
    expect(r.name).toBe('Main');
    expect(r.clips).toEqual([]);
    expect(r.compWidth).toBe(100);
    expect(r.compHeight).toBe(50);
    expect(r.durationFrames).toBe(48);
    expect(r.notes).toEqual([]);
  });

  it('falls back to the file name when the composition has no name', () => {
    expect(parseFormvfx(project([comp({}, '')]), 'shot.fvxproj', dims).name).toBe('shot');
  });

  it('notes a different frame rate and a different size', () => {
    const r = parseFormvfx(project([comp({ frameRate: 30, width: 640, height: 360 })]), 'a.fvxproj', dims);
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toContain('30');
    expect(r.notes[1]).toContain('640');
    expect(r.durationFrames).toBe(48);
  });

  it('reads the project out of a bundle and keeps its pictures, ignoring resource fork folders', () => {
    const zip = zipSync({ 'p/main.fvxproj': project([comp()]), 'p/Footage/a.png': new Uint8Array([1, 2]), '__MACOSX/p/b.png': new Uint8Array([3]), 'p/readme.txt': strToU8('x') });
    const r = parseFormvfx(zip, 'b.zip', dims);
    expect(r.name).toBe('Main');
    expect(Array.from(r.files.keys())).toEqual(['p/Footage/a.png']);
  });

  it('leaves out a sound layer and says so', () => {
    const items = [comp({ layers: [{ kind: 'Footage', source: 2, name: 'Hum' }] }), { id: 2, name: 'hum', kind: { type: 'Footage', kind: 'Audio', path: 'hum.wav' } }];
    const r = parseFormvfx(project(items), 'a.fvxproj', dims);
    expect(r.clips).toEqual([]);
    expect(r.notes.some((n) => n.startsWith('1 sound layers'))).toBe(true);
  });

  it('leaves out picture layers whose file is not in the bundle and counts them', () => {
    const layer = { kind: 'Footage', source: 2, name: 'Pic' };
    const items = [comp({ layers: [layer, layer] }), { id: 2, name: 'pic', kind: { type: 'Footage', kind: 'Image', path: '../../etc/pic.png', width: 4, height: 4 } }];
    const r = parseFormvfx(project(items), 'a.fvxproj', dims);
    expect(r.clips).toEqual([]);
    expect(r.notes.some((n) => n.startsWith('2 layers whose picture is not in the bundle'))).toBe(true);
  });

  it('picks the composition that no other composition nests as the main one', () => {
    const audio = { id: 9, name: 'hum', kind: { type: 'Footage', kind: 'Audio' } };
    const inner = comp({ layers: [{ kind: 'Footage', source: 9 }], duration: 1 }, 'Inner', 5);
    const outer = comp({ layers: [{ kind: 'Precomp', source: 5 }, { kind: 'Footage', source: 9 }], duration: 3 }, 'Outer', 6);
    const r = parseFormvfx(project([inner, outer, audio]), 'a.fvxproj', dims);
    expect(r.name).toBe('Outer');
    expect(r.durationFrames).toBe(72);
  });
});
