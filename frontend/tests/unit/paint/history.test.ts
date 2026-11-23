import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PaintHistory, historyNotice, patchTiles, readRect, tilePatch, writeRect,
} from '@src/paint/history';
import type { LayerSnapshot, PaintHost, SnapLayer } from '@src/paint/history';
import type { PaintLayer, PixelPatch, Raster, Rect } from '@src/paint/types';

const raster = (w: number, h: number, fill = 0): Raster => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(fill) });

function makeHost(layers: Record<string, Raster>) {
  const restored: LayerSnapshot[] = [];
  const touched: Rect[] = [];
  const changes: string[] = [];
  const host: PaintHost = {
    layerById: (id) => (layers[id] ? ({ id, raster: layers[id] } as unknown as PaintLayer) : null),
    restore: (s) => { restored.push(s); },
    touch: (_r, rect) => { touched.push(rect); },
    changed: (what) => { changes.push(what); },
  };
  return { host, restored, touched, changes };
}

function patch(layer: string, rect: Rect, before: number, after: number): PixelPatch {
  const n = rect.w * rect.h * 4;
  return { layer, rect, before: new Uint8ClampedArray(n).fill(before), after: new Uint8ClampedArray(n).fill(after) };
}

const snapLayer = (id: string, r: Raster): SnapLayer => ({
  id, name: id, visible: true, opacity: 1, blend: 'normal' as SnapLayer['blend'], alphaLock: false, clipping: false, source: null, raster: r,
});
const snap = (active: string, ...layers: SnapLayer[]): LayerSnapshot => ({ layers, active });

const MB = 1024 * 1024;

afterEach(() => { historyNotice.handler = null; });

describe('rect copies', () => {
  it('writes a rect into a raster and reads it back', () => {
    const r = raster(4, 4);
    const bytes = new Uint8ClampedArray(2 * 2 * 4).map((_, i) => i + 1);
    const rect = { x: 1, y: 2, w: 2, h: 2 };
    writeRect(r, rect, bytes);
    expect(readRect(r, rect)).toEqual(bytes);
    expect(r.data[(2 * 4 + 1) * 4]).toBe(1);
    expect(r.data[(3 * 4 + 1) * 4]).toBe(9);
    expect(r.data.filter((v) => v !== 0).length).toBe(16);
  });
});

describe('tilePatch', () => {
  it('keeps a small patch as one rectangle', () => {
    const p = patch('a', { x: 0, y: 0, w: 8, h: 8 }, 0, 9);
    expect(tilePatch(p)).toEqual([p]);
    expect(tilePatch(p)[0]).toBe(p);
  });

  it('keeps only the tiles that changed in a big patch', () => {
    const p = patch('a', { x: 10, y: 20, w: 300, h: 300 }, 7, 7);
    const i = (200 * 300 + 150) * 4;
    p.after[i] = 99;
    const tiles = tilePatch(p);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].layer).toBe('a');
    expect(tiles[0].rect).toEqual({ x: 138, y: 148, w: 128, h: 128 });
    const local = ((200 - 128) * 128 + (150 - 128)) * 4;
    expect(tiles[0].after[local]).toBe(99);
    expect(tiles[0].before[local]).toBe(7);
    expect(tiles[0].after.filter((v) => v === 99).length).toBe(1);
  });

  it('clips the tiles on the far edges to the patch', () => {
    const p = patch('a', { x: 0, y: 0, w: 300, h: 300 }, 0, 0);
    p.after[(299 * 300 + 299) * 4 + 3] = 1;
    const tiles = tilePatch(p);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].rect).toEqual({ x: 256, y: 256, w: 44, h: 44 });
  });

  it('keeps one rectangle when most of the patch changed', () => {
    const p = patch('a', { x: 0, y: 0, w: 300, h: 300 }, 0, 5);
    expect(tilePatch(p)).toEqual([p]);
  });

  it('returns no tiles for a big patch that changed nothing', () => {
    expect(tilePatch(patch('a', { x: 0, y: 0, w: 300, h: 300 }, 3, 3))).toEqual([]);
  });
});

describe('PaintHistory pixel steps', () => {
  it('starts empty and refuses to undo or redo', () => {
    const h = new PaintHistory(makeHost({}).host, 50, MB);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
    expect(h.undoLabel()).toBeNull();
    expect(h.top()).toBeNull();
    expect(h.usedBytes()).toBe(0);
  });

  it('undoes and redoes a stroke on the layer raster', () => {
    const r = raster(4, 4, 1);
    const { host, touched, changes } = makeHost({ a: r });
    const h = new PaintHistory(host, 50, MB);
    const rect = { x: 1, y: 1, w: 2, h: 2 };
    h.push({ kind: 'pixels', label: 'Stroke', patch: patch('a', rect, 1, 200) });
    expect(h.undoLabel()).toBe('Stroke');
    expect(h.undo()).toBe(true);
    expect(readRect(r, rect).every((v) => v === 1)).toBe(true);
    expect(h.canUndo()).toBe(false);
    expect(h.redoLabel()).toBe('Stroke');
    expect(h.redo()).toBe(true);
    expect(readRect(r, rect).every((v) => v === 200)).toBe(true);
    expect(r.data[0]).toBe(1);
    expect(touched).toEqual([rect, rect]);
    expect(changes).toEqual(['pixels', 'pixels']);
  });

  it('skips a patch whose layer is gone', () => {
    const { host, touched } = makeHost({});
    const h = new PaintHistory(host, 50, MB);
    h.push({ kind: 'pixels', label: 'Stroke', patch: patch('gone', { x: 0, y: 0, w: 1, h: 1 }, 0, 1) });
    expect(h.undo()).toBe(true);
    expect(touched).toEqual([]);
  });

  it('drops the redo steps on a new push', () => {
    const { host } = makeHost({ a: raster(2, 2) });
    const h = new PaintHistory(host, 50, MB);
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    h.push({ kind: 'pixels', label: 'one', patch: patch('a', rect, 0, 1) });
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.push({ kind: 'pixels', label: 'two', patch: patch('a', rect, 0, 2) });
    expect(h.canRedo()).toBe(false);
    expect(h.undoLabel()).toBe('two');
  });

  it('undoes in reverse order of the pushes', () => {
    const r = raster(1, 1);
    const { host } = makeHost({ a: r });
    const h = new PaintHistory(host, 50, MB);
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    h.push({ kind: 'pixels', label: 'one', patch: patch('a', rect, 0, 10) });
    h.push({ kind: 'pixels', label: 'two', patch: patch('a', rect, 10, 20) });
    h.undo();
    expect(r.data[0]).toBe(10);
    h.undo();
    expect(r.data[0]).toBe(0);
    h.redo();
    h.redo();
    expect(r.data[0]).toBe(20);
  });

  it('counts the bytes of the steps it can undo', () => {
    const { host } = makeHost({ a: raster(4, 4) });
    const h = new PaintHistory(host, 50, MB);
    h.push({ kind: 'pixels', label: 's', patch: patch('a', { x: 0, y: 0, w: 2, h: 2 }, 0, 1) });
    expect(h.usedBytes()).toBe(32);
    h.undo();
    expect(h.usedBytes()).toBe(0);
    h.redo();
    expect(h.usedBytes()).toBe(32);
    h.clear();
    expect(h.usedBytes()).toBe(0);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('uses the tiles a stroke registered for its patch', () => {
    const r = raster(4, 4);
    const { host, touched } = makeHost({ a: r });
    const h = new PaintHistory(host, 50, MB);
    const whole = patch('a', { x: 0, y: 0, w: 4, h: 4 }, 50, 60);
    const tile = patch('a', { x: 3, y: 3, w: 1, h: 1 }, 5, 6);
    patchTiles.set(whole, [tile]);
    h.push({ kind: 'pixels', label: 's', patch: whole });
    expect(h.usedBytes()).toBe(8);
    h.undo();
    expect(touched).toEqual([tile.rect]);
    expect(r.data[15 * 4]).toBe(5);
    expect(r.data[0]).toBe(0);
  });
});

describe('PaintHistory limits', () => {
  const step = (label: string): { kind: 'pixels'; label: string; patch: PixelPatch } =>
    ({ kind: 'pixels', label, patch: patch('a', { x: 0, y: 0, w: 2, h: 2 }, 0, 1) });

  it('drops the oldest step beyond its depth without a notice', () => {
    const notice = vi.fn();
    historyNotice.handler = notice;
    const h = new PaintHistory(makeHost({ a: raster(2, 2) }).host, 2, MB);
    expect(h.hasDropped()).toBe(false);
    h.push(step('one'));
    h.push(step('two'));
    h.push(step('three'));
    expect(h.hasDropped()).toBe(true);
    expect(h.usedBytes()).toBe(64);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(false);
    expect(h.redoLabel()).toBe('two');
    expect(notice).not.toHaveBeenCalled();
  });

  it('drops the oldest steps beyond its byte budget and says so once', () => {
    const notice = vi.fn();
    historyNotice.handler = notice;
    const h = new PaintHistory(makeHost({ a: raster(2, 2) }).host, 50, 70);
    h.push(step('one'));
    h.push(step('two'));
    expect(h.usedBytes()).toBe(64);
    h.push(step('three'));
    h.push(step('four'));
    expect(h.usedBytes()).toBe(64);
    expect(h.hasDropped()).toBe(true);
    expect(h.undoLabel()).toBe('four');
    expect(notice).toHaveBeenCalledTimes(1);
    expect(typeof notice.mock.calls[0][0]).toBe('string');
  });

  it('always keeps the newest step even when it alone is over budget', () => {
    const h = new PaintHistory(makeHost({ a: raster(2, 2) }).host, 50, 10);
    h.push(step('big'));
    expect(h.canUndo()).toBe(true);
    expect(h.undoLabel()).toBe('big');
    h.push(step('bigger'));
    expect(h.undoLabel()).toBe('bigger');
    h.undo();
    expect(h.canUndo()).toBe(false);
  });

  it('sheds down to the newest steps on request', () => {
    const h = new PaintHistory(makeHost({ a: raster(2, 2) }).host, 50, MB);
    for (const l of ['one', 'two', 'three', 'four']) h.push(step(l));
    h.shedDepth(0);
    h.shedDepth(Number.NaN);
    h.shedDepth(Number.POSITIVE_INFINITY);
    expect(h.usedBytes()).toBe(128);
    h.shedDepth(2);
    expect(h.usedBytes()).toBe(64);
    expect(h.undoLabel()).toBe('four');
    h.undo();
    h.undo();
    expect(h.canUndo()).toBe(false);
    h.shedDepth(1);
    expect(h.redoLabel()).toBe('three');
    h.redo();
    expect(h.canRedo()).toBe(false);
  });
});

describe('PaintHistory layer steps', () => {
  it('restores the snapshot before on undo and after on redo', () => {
    const a = raster(2, 2), b = raster(2, 2);
    const { host, restored, changes } = makeHost({});
    const h = new PaintHistory(host, 50, MB);
    const before = snap('a', snapLayer('a', a));
    const after = snap('b', snapLayer('a', a), snapLayer('b', b));
    h.push({ kind: 'layers', label: 'Add layer', before, after });
    h.undo();
    expect(restored).toEqual([before]);
    expect(restored[0]).toBe(before);
    h.redo();
    expect(restored[1]).toBe(after);
    expect(changes).toEqual(['layers', 'layers']);
  });

  it('counts a raster held by only one side of the step', () => {
    const a = raster(2, 2), b = raster(3, 3);
    const h = new PaintHistory(makeHost({}).host, 50, MB);
    h.push({ kind: 'layers', label: 'Add', before: snap('a', snapLayer('a', a)), after: snap('b', snapLayer('a', a), snapLayer('b', b)) });
    expect(h.usedBytes()).toBe(36);
    h.push({ kind: 'layers', label: 'Rename', before: snap('a', snapLayer('a', a)), after: snap('a', snapLayer('a', a)) });
    expect(h.usedBytes()).toBe(36);
  });

  it('merges consecutive steps that share a tag into one', () => {
    const a = raster(1, 1);
    const { host, restored } = makeHost({});
    const h = new PaintHistory(host, 50, MB);
    const s0 = snap('a', { ...snapLayer('a', a), opacity: 1 });
    const s1 = snap('a', { ...snapLayer('a', a), opacity: 0.6 });
    const s2 = snap('a', { ...snapLayer('a', a), opacity: 0.2 });
    h.push({ kind: 'layers', label: 'Opacity', before: s0, after: s1, tag: 'opacity:a' });
    const firstTop = h.top();
    h.push({ kind: 'layers', label: 'Opacity', before: s1, after: s2, tag: 'opacity:a' });
    expect(h.top()).not.toBe(firstTop);
    h.undo();
    expect(restored[0]).toBe(s0);
    expect(h.canUndo()).toBe(false);
    h.redo();
    expect(restored[1]).toBe(s2);
  });

  it('keeps steps with different tags or no tag apart', () => {
    const a = raster(1, 1);
    const h = new PaintHistory(makeHost({}).host, 50, MB);
    const s = snap('a', snapLayer('a', a));
    h.push({ kind: 'layers', label: 'x', before: s, after: s, tag: 't1' });
    h.push({ kind: 'layers', label: 'y', before: s, after: s, tag: 't2' });
    h.push({ kind: 'layers', label: 'z', before: s, after: s });
    h.push({ kind: 'layers', label: 'w', before: s, after: s });
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(4);
  });

  it('puts merged pixels back on undo and replays them on redo', () => {
    const lower = raster(2, 1, 9), upper = raster(2, 1, 4);
    const { host, touched } = makeHost({});
    const h = new PaintHistory(host, 50, MB);
    const before = snap('up', snapLayer('low', lower), snapLayer('up', upper));
    const after = snap('low', snapLayer('low', lower));
    const rect = { x: 0, y: 0, w: 2, h: 1 };
    h.push({ kind: 'layers', label: 'Merge down', before, after, patches: [patch('low', rect, 9, 77)] });
    expect(h.usedBytes()).toBe(16 + 8);
    h.undo();
    expect(lower.data.every((v) => v === 9)).toBe(true);
    h.redo();
    expect(lower.data.every((v) => v === 77)).toBe(true);
    expect(upper.data.every((v) => v === 4)).toBe(true);
    expect(touched).toEqual([rect, rect]);
  });

  it('lists every raster its layer steps keep alive', () => {
    const a = raster(1, 1), b = raster(1, 1), c = raster(1, 1);
    const h = new PaintHistory(makeHost({ a }).host, 50, MB);
    h.push({ kind: 'layers', label: 'Delete', before: snap('b', snapLayer('a', a), snapLayer('b', b)), after: snap('a', snapLayer('a', a)) });
    h.push({ kind: 'pixels', label: 's', patch: patch('a', { x: 0, y: 0, w: 1, h: 1 }, 0, 1) });
    h.undo();
    const held = h.rasters();
    expect(held.has(a)).toBe(true);
    expect(held.has(b)).toBe(true);
    expect(held.has(c)).toBe(false);
    expect(held.size).toBe(2);
  });
});
