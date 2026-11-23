import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  FORMVIS_FORMAT, blankPng, blendLabelOf, isPng, looksLikeFormvis, parseFormvis, pngSize, writeFormvis, type FvLayer,
} from '@src/io/formvis-doc';

const layer = (id: string, over: Partial<FvLayer> = {}): FvLayer => ({
  id, name: id, visible: true, opacity: 1, blend: 'normal', group: false, parent: null, collapsed: false, alphaLock: false,
  clipping: false, image: null, mask: null, maskOn: true, maskLinked: true, ...over,
});

const bundle = (manifest: unknown, extra: Record<string, Uint8Array> = {}, at = 'manifest.json'): Uint8Array =>
  zipSync({ [at]: strToU8(typeof manifest === 'string' ? manifest : JSON.stringify(manifest)), ...extra });

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ format: FORMVIS_FORMAT, version: 1, width: 8, height: 6, layers: [], ...over });

describe('png helpers', () => {
  it('writes a blank picture whose header carries the size asked for', () => {
    const png = blankPng(7, 3);
    expect(isPng(png)).toBe(true);
    expect(pngSize(png)).toEqual({ w: 7, h: 3 });
  });

  it('does not take other bytes or a cut header for a png', () => {
    expect(isPng(new Uint8Array(40))).toBe(false);
    expect(isPng(blankPng(2, 2).subarray(0, 20))).toBe(false);
    expect(pngSize(strToU8('this is certainly not a picture file'))).toBeNull();
  });

  it('names blend modes for the document and falls back to Normal', () => {
    expect(blendLabelOf('multiply')).toBe('Multiply');
    expect(blendLabelOf('add')).toBe('Linear Dodge (Add)');
    expect(blendLabelOf('passthrough')).toBe('Normal');
  });
});

describe('writing then reading a document', () => {
  const art = blankPng(5, 4);
  const mask = blankPng(8, 6);
  const layers: FvLayer[] = [
    layer('top', { name: 'Ink', opacity: 0.5, blend: 'multiply', clipping: true, alphaLock: true }),
    layer('base', { name: 'Paint', image: art, mask, maskOn: false, maskLinked: false, visible: false }),
    layer('folder', { name: 'Set', group: true, blend: 'passthrough', collapsed: true }),
    layer('inner', { name: 'Inside', parent: 'folder' }),
    layer('iso', { name: 'Isolated', group: true, blend: 'screen' }),
  ];
  const bytes = writeFormvis({ name: 'Doc', width: 8, height: 6, layers, documentId: 'doc-77' });
  const doc = parseFormvis(bytes, 'My work.fvd');

  it('keeps the canvas, the name from the file and the document id', () => {
    expect(doc.width).toBe(8);
    expect(doc.height).toBe(6);
    expect(doc.name).toBe('My work');
    expect(doc.documentId).toBe('doc-77');
    expect(doc.notes).toEqual([]);
  });

  it('keeps the layer order top first', () => {
    expect(doc.layers.map((l) => l.name)).toEqual(['Ink', 'Paint', 'Set', 'Inside', 'Isolated']);
  });

  it('keeps opacity, blend mode, visibility and locks', () => {
    const [ink, paint] = doc.layers;
    expect(ink.opacity).toBe(0.5);
    expect(ink.blend).toBe('multiply');
    expect(ink.alphaLock).toBe(true);
    expect(ink.visible).toBe(true);
    expect(paint.visible).toBe(false);
    expect(paint.opacity).toBe(1);
    expect(paint.alphaLock).toBe(false);
  });

  it('keeps clipping onto the layer below', () => {
    expect(doc.layers[0].clipping).toBe(true);
    expect(doc.layers[1].clipping).toBe(false);
  });

  it('keeps pictures and masks byte for byte with their switches', () => {
    const paint = doc.layers[1];
    expect(Array.from(paint.image as Uint8Array)).toEqual(Array.from(art));
    expect(Array.from(paint.mask as Uint8Array)).toEqual(Array.from(mask));
    expect(paint.maskOn).toBe(false);
    expect(paint.maskLinked).toBe(false);
    expect(paint.placement).toEqual({ x: 0, y: 0, w: 5, h: 4, rotation: 0, flipX: false, flipY: false });
  });

  it('gives a layer with no pixels a blank picture of the canvas size', () => {
    const ink = doc.layers[0];
    expect(pngSize(ink.image as Uint8Array)).toEqual({ w: 8, h: 6 });
    expect(ink.mask).toBeNull();
    expect(ink.maskOn).toBe(true);
    expect(ink.maskLinked).toBe(true);
  });

  it('keeps folders, their members, pass through and the collapsed state', () => {
    const set = doc.layers[2], inside = doc.layers[3], iso = doc.layers[4];
    expect(set.group).toBe(true);
    expect(set.blend).toBe('passthrough');
    expect(set.collapsed).toBe(true);
    expect(set.image).toBeNull();
    expect(inside.parent).toBe(set.id);
    expect(inside.group).toBe(false);
    expect(iso.group).toBe(true);
    expect(iso.blend).toBe('screen');
    expect(iso.collapsed).toBe(false);
  });

  it('keeps an isolated folder in normal mode from turning into pass through', () => {
    const b = writeFormvis({ name: 'd', width: 2, height: 2, layers: [layer('g', { group: true, blend: 'normal' })] });
    expect(parseFormvis(b).layers[0].blend).toBe('normal');
  });

  it('is recognised as a document', () => {
    expect(looksLikeFormvis(bytes)).toBe(true);
  });

  it('stores a manifest with the format name and one record per layer', () => {
    const files = unzipSync(bytes);
    const m = JSON.parse(strFromU8(files['manifest.json'])) as { format: string; version: number; layers: { id: string }[]; activeLayerID: string };
    expect(m.format).toBe(FORMVIS_FORMAT);
    expect(m.version).toBe(1);
    expect(m.layers).toHaveLength(5);
    expect(new Set(m.layers.map((l) => l.id)).size).toBe(5);
    expect(Object.keys(files).filter((k) => k.startsWith('images/')).sort()).toEqual(['images/L2.png', 'images/L4.mask.png', 'images/L4.png', 'images/L5.png']);
  });

  it('drops a parent that is not a folder in the document', () => {
    const b = writeFormvis({ name: 'd', width: 2, height: 2, layers: [layer('a', { parent: 'b' }), layer('b')] });
    expect(parseFormvis(b).layers.map((l) => l.parent)).toEqual([null, null]);
  });

  it('adds thumbnail files only for a real png', () => {
    const one = [layer('a')];
    const withThumb = unzipSync(writeFormvis({ name: 'd', width: 2, height: 2, layers: one, thumbnail: blankPng(2, 2) }));
    const without = unzipSync(writeFormvis({ name: 'd', width: 2, height: 2, layers: one, thumbnail: strToU8('not a picture, just some words here') }));
    expect(Object.keys(withThumb)).toContain('thumbnail.png');
    expect(Object.keys(without)).not.toContain('thumbnail.png');
  });

  it('writes and reads a document with no layers', () => {
    const d = parseFormvis(writeFormvis({ name: 'd', width: 3, height: 3, layers: [], documentId: 'e' }));
    expect(d.layers).toEqual([]);
    expect(d.width).toBe(3);
  });
});

describe('refusing files that are not valid documents', () => {
  it('refuses bytes that are not an archive and names the file', () => {
    expect(() => parseFormvis(strToU8('plain words'), 'notes.fvd')).toThrow(/notes\.fvd/);
    expect(looksLikeFormvis(strToU8('plain words'))).toBe(false);
    expect(looksLikeFormvis(new Uint8Array(0))).toBe(false);
  });

  it('refuses a damaged archive', () => {
    const cut = bundle(base()).subarray(0, 30);
    expect(() => parseFormvis(cut, 'a.fvd')).toThrow();
    expect(looksLikeFormvis(cut)).toBe(false);
  });

  it('refuses an archive with no manifest', () => {
    const b = zipSync({ 'images/L1.png': blankPng(2, 2) });
    expect(() => parseFormvis(b, 'a.fvd')).toThrow(/manifest/);
    expect(looksLikeFormvis(b)).toBe(false);
  });

  it('refuses a manifest buried more than one folder deep', () => {
    const b = bundle(base(), {}, 'a/b/manifest.json');
    expect(() => parseFormvis(b, 'a.fvd')).toThrow(/manifest/);
    expect(looksLikeFormvis(b)).toBe(false);
  });

  it('refuses a manifest that is not json', () => {
    const b = bundle('{ "format": ');
    expect(() => parseFormvis(b, 'a.fvd')).toThrow(/damaged/);
    expect(looksLikeFormvis(b)).toBe(false);
  });

  it('refuses a manifest of another format or with no format', () => {
    expect(() => parseFormvis(bundle(base({ format: 'com.example.other' })), 'a.fvd')).toThrow();
    expect(() => parseFormvis(bundle(base({ format: 7 })), 'a.fvd')).toThrow();
    expect(() => parseFormvis(bundle([1, 2, 3]), 'a.fvd')).toThrow();
    expect(looksLikeFormvis(bundle(base({ format: 'com.example.other' })))).toBe(false);
    expect(looksLikeFormvis(bundle(base({ format: `${FORMVIS_FORMAT}.evil` })))).toBe(false);
  });

  it('refuses a newer format version and says which', () => {
    expect(() => parseFormvis(bundle(base({ version: 2 })), 'a.fvd')).toThrow(/version 2/);
    expect(() => parseFormvis(bundle(base({ version: '1' })), 'a.fvd')).toThrow();
  });

  it('refuses a canvas with no size, a negative size or a size that is not a number', () => {
    expect(() => parseFormvis(bundle(base({ width: 0 })), 'a.fvd')).toThrow(/size/);
    expect(() => parseFormvis(bundle(base({ height: -4 })), 'a.fvd')).toThrow(/size/);
    expect(() => parseFormvis(bundle(base({ width: '800' })), 'a.fvd')).toThrow(/size/);
    expect(() => parseFormvis(bundle(base({ width: 0.2 })), 'a.fvd')).toThrow(/size/);
  });

  it('refuses a canvas past the side or the area limit', () => {
    expect(() => parseFormvis(bundle(base({ width: 30001, height: 1 })), 'a.fvd')).toThrow(/30000/);
    expect(() => parseFormvis(bundle(base({ width: 20000, height: 20000 })), 'a.fvd')).toThrow(/256/);
    expect(parseFormvis(bundle(base({ width: 30000, height: 1 })), 'a.fvd').width).toBe(30000);
  });
});

describe('reading documents from elsewhere', () => {
  it('reads a document that sits inside one folder of the archive', () => {
    const png = blankPng(3, 2);
    const b = bundle(base({ layers: [{ id: 'a', name: 'A', imageFile: 'a.png' }] }), { 'Work/images/a.png': png }, 'Work/manifest.json');
    const d = parseFormvis(b, 'w.fvd');
    expect(pngSize(d.layers[0].image as Uint8Array)).toEqual({ w: 3, h: 2 });
    expect(looksLikeFormvis(b)).toBe(true);
  });

  it('fills defaults for a bare record and skips records with no id', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a' }, { name: 'ghost' }, 5, null, { id: 9 }] })));
    expect(d.layers).toHaveLength(1);
    expect(d.layers[0]).toMatchObject({
      id: 'a', name: 'Layer', visible: true, opacity: 1, blend: 'normal', group: false, parent: null, collapsed: false, alphaLock: false,
      clipping: false, image: null, mask: null, maskOn: true, maskLinked: true, maskPlacement: null,
    });
    expect(d.layers[0].placement).toEqual({ x: 0, y: 0, w: 8, h: 6, rotation: 0, flipX: false, flipY: false });
    expect(d.documentId).toBeNull();
  });

  it('clamps opacity into 0 to 1 and ignores one that is not a number', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', opacity: 7 }, { id: 'b', opacity: -2 }, { id: 'c', opacity: 'half' }] })));
    expect(d.layers.map((l) => l.opacity)).toEqual([1, 0, 1]);
  });

  it('does not follow a picture name that points outside the images folder to a missing file', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', imageFile: '../../etc/passwd', maskFile: '../secret.png' }] })));
    expect(d.layers[0].image).toBeNull();
    expect(d.layers[0].mask).toBeNull();
  });

  it('ignores clipping and parents that point at records that do not exist', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', maskSourceID: 'nobody', parentID: 'nowhere' }, { id: 'b', parentID: 'a' }] })));
    expect(d.layers.every((l) => !l.clipping && l.parent === null)).toBe(true);
  });

  it('shows an unknown blend mode as normal and says so', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', blendMode: 'Sparkle' }] })));
    expect(d.layers[0].blend).toBe('normal');
    expect(d.notes).toHaveLength(1);
  });

  it('leaves out adjustment layers that have no picture and notes it', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', adjustment: { kind: 'levels' } }, { id: 'b' }] })));
    expect(d.layers.map((l) => l.id)).toEqual(['b']);
    expect(d.notes).toHaveLength(1);
    expect(d.notes[0]).toMatch(/^1 /);
  });

  it('reads placement with flips and never lets a size fall below one', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', transform: { origin: [3, -4], size: [0, -9], rotation: 30, flipX: true, flipY: 'yes' } }] })));
    expect(d.layers[0].placement).toEqual({ x: 3, y: -4, w: 1, h: 1, rotation: 30, flipX: true, flipY: false });
    expect(d.notes).toHaveLength(1);
  });

  it('treats a lock on everything as a transparency lock', () => {
    const d = parseFormvis(bundle(base({ layers: [{ id: 'a', locks: { all: true } }, { id: 'b', locks: 'yes' }] })));
    expect(d.layers.map((l) => l.alphaLock)).toEqual([false, true]);
  });

  it('rounds a fractional canvas size', () => {
    const d = parseFormvis(bundle(base({ width: 10.6, height: 4.4 })));
    expect([d.width, d.height]).toEqual([11, 4]);
  });
});
