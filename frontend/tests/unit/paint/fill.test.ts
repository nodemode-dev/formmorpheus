import { describe, expect, it } from 'vitest';
import { clearMask, fillMask, floodCoverage, floodFill } from '@src/paint/fill';
import type { Mask, Raster, RGB } from '@src/paint/types';

type Px = [number, number, number, number];
const CLEAR: Px = [0, 0, 0, 0];
const INK: Px = [0, 0, 0, 255];
const RED: RGB = { r: 255, g: 0, b: 0 };

function raster(w: number, h: number, at: (x: number, y: number) => Px): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}

function mask(w: number, h: number, at: (x: number, y: number) => number): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = at(x, y);
  return { width: w, height: h, data };
}

const px = (r: Raster, x: number, y: number): number[] => Array.from(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));

const walled = (): Raster => raster(5, 4, (x) => (x === 2 ? INK : CLEAR));

describe('floodCoverage', () => {
  it('refuses a start point outside the raster', () => {
    const r = walled();
    expect(floodCoverage(r, -1, 0, 0, null)).toBeNull();
    expect(floodCoverage(r, 0, 4, 0, null)).toBeNull();
    expect(floodCoverage(r, 5, 0, 0, null)).toBeNull();
  });

  it('stops at a wall of a different colour', () => {
    const res = floodCoverage(walled(), 0.9, 1.2, 0, null);
    expect(res).not.toBeNull();
    expect(res!.bounds).toEqual({ x: 0, y: 0, w: 2, h: 4 });
    for (let y = 0; y < 4; y++) {
      expect(Array.from(res!.cov.subarray(y * 5, y * 5 + 5))).toEqual([255, 255, 0, 0, 0]);
    }
  });

  it('follows a region around a corner', () => {
    const r = raster(5, 5, (x, y) => ((x === 2 && y < 4) ? INK : CLEAR));
    const res = floodCoverage(r, 0, 0, 0, null)!;
    expect(res.bounds).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(res.cov[0 * 5 + 4]).toBe(255);
    expect(res.cov[1 * 5 + 2]).toBe(0);
    expect(res.cov.filter((c) => c === 255).length).toBe(21);
  });

  it('does not cross a diagonal gap', () => {
    const r = raster(3, 3, (x, y) => (x + y === 2 ? INK : CLEAR));
    const res = floodCoverage(r, 0, 0, 0, null)!;
    expect(res.cov.filter((c) => c > 0).length).toBe(3);
    expect(res.cov[8]).toBe(0);
  });

  it('never tells empty pixels apart by their colour', () => {
    const r = raster(3, 1, (x) => (x === 1 ? [255, 0, 0, 0] : [0, 0, 255, 0]));
    expect(Array.from(floodCoverage(r, 0, 0, 0, null)!.cov)).toEqual([255, 255, 255]);
  });

  it('gives partial coverage inside the soft band above the threshold', () => {
    const levels = [255, 204, 191, 170];
    const r = raster(4, 1, (x) => [levels[x], levels[x], levels[x], 255]);
    const cov = floodCoverage(r, 0, 0, 0.2, null)!.cov;
    expect(cov[0]).toBe(255);
    expect(cov[1]).toBe(255);
    expect(cov[2]).toBeGreaterThan(0);
    expect(cov[2]).toBeLessThan(255);
    expect(cov[3]).toBe(0);
  });

  it('covers everything at a threshold clamped to one', () => {
    const res = floodCoverage(walled(), 0, 0, 50, null)!;
    expect(res.cov.every((c) => c === 255)).toBe(true);
    expect(res.bounds).toEqual({ x: 0, y: 0, w: 5, h: 4 });
  });

  it('stays inside the selection and refuses a start outside it', () => {
    const r = raster(4, 4, () => CLEAR);
    const sel = mask(4, 4, (x, y) => (x < 2 && y < 2 ? 255 : 0));
    const res = floodCoverage(r, 0, 0, 0, sel)!;
    expect(res.bounds).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(res.cov.filter((c) => c > 0).length).toBe(4);
    expect(floodCoverage(r, 3, 3, 0, sel)).toBeNull();
  });

  it('ignores a selection of another size', () => {
    const r = raster(4, 4, () => CLEAR);
    const res = floodCoverage(r, 3, 3, 0, mask(2, 2, () => 0))!;
    expect(res.cov.every((c) => c === 255)).toBe(true);
  });
});

describe('floodFill', () => {
  it('refuses a sample of another size', () => {
    expect(floodFill(walled(), raster(4, 4, () => CLEAR), 0, 0, RED, 0, null, 'a')).toBeNull();
  });

  it('refuses a click outside the canvas and leaves the target alone', () => {
    const t = walled();
    const copy = t.data.slice();
    expect(floodFill(t, t, 99, 0, RED, 0, null, 'a')).toBeNull();
    expect(t.data).toEqual(copy);
  });

  it('fills the clicked region and keeps the wall and the far side', () => {
    const t = walled();
    const patch = floodFill(t, t, 0, 0, RED, 0, null, 'layer-1')!;
    for (let y = 0; y < 4; y++) {
      expect(px(t, 0, y)).toEqual([255, 0, 0, 255]);
      expect(px(t, 1, y)).toEqual([255, 0, 0, 255]);
      expect(px(t, 2, y)).toEqual(INK);
      expect(px(t, 3, y)).toEqual(CLEAR);
      expect(px(t, 4, y)).toEqual(CLEAR);
    }
    expect(patch.layer).toBe('layer-1');
  });

  it('returns a patch that holds the pixels before and after', () => {
    const t = walled();
    const original = t.data.slice();
    const patch = floodFill(t, t, 0, 0, RED, 0, null, 'a')!;
    expect(patch.rect).toEqual({ x: 0, y: 0, w: 5, h: 4 });
    expect(patch.before).toEqual(original);
    expect(patch.after).toEqual(t.data);
    expect(patch.after).not.toEqual(patch.before);
  });

  it('clamps the patch rectangle to ten pixels around the region', () => {
    const t = raster(40, 30, (x, y) => (x >= 18 && x <= 21 && y >= 13 && y <= 16 ? [0, 0, 255, 255] : INK));
    const patch = floodFill(t, t, 19, 14, RED, 0, null, 'a')!;
    expect(patch.rect).toEqual({ x: 8, y: 3, w: 24, h: 24 });
    expect(patch.before.length).toBe(24 * 24 * 4);
    expect(px(t, 18, 13)).toEqual([255, 0, 0, 255]);
    expect(px(t, 17, 13)).toEqual(INK);
  });

  it('samples one raster and writes into another', () => {
    const sampleR = walled();
    const t = raster(5, 4, () => CLEAR);
    floodFill(t, sampleR, 4, 0, RED, 0, null, 'a');
    expect(px(t, 4, 2)).toEqual([255, 0, 0, 255]);
    expect(px(t, 3, 2)).toEqual([255, 0, 0, 255]);
    expect(px(t, 0, 2)).toEqual(CLEAR);
    expect(px(sampleR, 4, 2)).toEqual(CLEAR);
  });

  it('fills beneath a soft edge pixel next to the region', () => {
    const t = raster(5, 1, (x) => (x === 2 ? [0, 0, 0, 128] : x === 3 ? INK : CLEAR));
    floodFill(t, t, 0, 0, RED, 0, null, 'a');
    const edge = px(t, 2, 0);
    expect(edge[3]).toBe(255);
    expect(Math.abs(edge[0] - 127)).toBeLessThanOrEqual(1);
    expect(edge[1]).toBe(0);
    expect(px(t, 3, 0)).toEqual(INK);
    expect(px(t, 4, 0)).toEqual(CLEAR);
  });

  it('weights the fill by a soft selection', () => {
    const t = raster(2, 1, () => [0, 0, 255, 255]);
    const sel = mask(2, 1, (x) => (x === 0 ? 255 : 128));
    floodFill(t, t, 0, 0, RED, 0, sel, 'a');
    expect(px(t, 0, 0)).toEqual([255, 0, 0, 255]);
    const half = px(t, 1, 0);
    expect(Math.abs(half[0] - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(half[2] - 127)).toBeLessThanOrEqual(1);
    expect(half[3]).toBe(255);
  });
});

describe('fillMask', () => {
  it('returns an empty patch for a mask of another size or an empty mask', () => {
    const t = raster(3, 3, () => CLEAR);
    const copy = t.data.slice();
    for (const m of [mask(2, 3, () => 255), mask(3, 3, () => 0)]) {
      const p = fillMask(t, m, RED, 'x');
      expect(p.layer).toBe('x');
      expect(p.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 });
      expect(p.before.length).toBe(0);
    }
    expect(t.data).toEqual(copy);
  });

  it('fills only the selected pixels and reports their bounds', () => {
    const t = raster(4, 4, () => CLEAR);
    const p = fillMask(t, mask(4, 4, (x, y) => (x >= 1 && x <= 2 && y === 2 ? 255 : 0)), RED, 'x');
    expect(p.rect).toEqual({ x: 1, y: 2, w: 2, h: 1 });
    expect(px(t, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(px(t, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(px(t, 0, 2)).toEqual(CLEAR);
    expect(px(t, 1, 1)).toEqual(CLEAR);
    expect(Array.from(p.before)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(p.after)).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
  });

  it('lays a half selected fill at half alpha on an empty pixel', () => {
    const t = raster(1, 1, () => CLEAR);
    fillMask(t, mask(1, 1, () => 128), RED, 'x');
    expect(px(t, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('mixes a half selected fill into an opaque pixel', () => {
    const t = raster(1, 1, () => [0, 0, 255, 255]);
    fillMask(t, mask(1, 1, () => 128), RED, 'x');
    const p = px(t, 0, 0);
    expect(Math.abs(p[0] - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(p[2] - 127)).toBeLessThanOrEqual(1);
    expect(p[3]).toBe(255);
  });
});

describe('clearMask', () => {
  it('erases fully selected pixels and keeps the rest', () => {
    const t = raster(3, 1, () => [10, 20, 30, 255]);
    const p = clearMask(t, mask(3, 1, (x) => (x === 1 ? 255 : 0)), 'x');
    expect(px(t, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(t, 1, 0)).toEqual([10, 20, 30, 0]);
    expect(px(t, 2, 0)).toEqual([10, 20, 30, 255]);
    expect(p.rect).toEqual({ x: 1, y: 0, w: 1, h: 1 });
    expect(Array.from(p.before)).toEqual([10, 20, 30, 255]);
    expect(Array.from(p.after)).toEqual([10, 20, 30, 0]);
  });

  it('scales alpha by the inverse of a soft mask', () => {
    const t = raster(1, 1, () => [10, 20, 30, 255]);
    clearMask(t, mask(1, 1, () => 128), 'x');
    expect(px(t, 0, 0)).toEqual([10, 20, 30, 127]);
  });

  it('does nothing for a mask of another size', () => {
    const t = raster(2, 2, () => INK);
    const p = clearMask(t, mask(3, 3, () => 255), 'x');
    expect(p.rect.w).toBe(0);
    expect(px(t, 0, 0)).toEqual(INK);
  });
});
