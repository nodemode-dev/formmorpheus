import { describe, expect, it } from 'vitest';
import { autoMask, combine, ellipseMask, extract, invertMask, isEmpty, maskBounds, maskOutline, polygonMask, rectMask } from '@src/paint/select';
import type { Mask, Raster } from '@src/paint/types';

const mask = (w: number, h: number, values: number[]): Mask => ({ width: w, height: h, data: Uint8Array.from(values) });
const sum = (m: Mask): number => m.data.reduce((a, b) => a + b, 0);
const at = (m: Mask, x: number, y: number): number => m.data[y * m.width + x];

describe('rectMask', () => {
  it('fills whole pixels inside an integer rectangle and nothing else', () => {
    const m = rectMask(8, 8, { x: 2, y: 3, w: 4, h: 2 });
    expect(sum(m)).toBe(8 * 255);
    expect(at(m, 2, 3)).toBe(255);
    expect(at(m, 5, 4)).toBe(255);
    expect(at(m, 1, 3)).toBe(0);
    expect(at(m, 6, 4)).toBe(0);
    expect(at(m, 2, 5)).toBe(0);
  });

  it('gives a half covered pixel half coverage', () => {
    const m = rectMask(4, 1, { x: 0.5, y: 0, w: 1, h: 1 });
    expect(Array.from(m.data)).toEqual([128, 128, 0, 0]);
  });

  it('multiplies the coverage of both axes at a corner', () => {
    const m = rectMask(2, 2, { x: 0.5, y: 0.5, w: 4, h: 4 });
    expect(at(m, 0, 0)).toBe(64);
    expect(at(m, 1, 1)).toBe(255);
  });

  it('clips a rectangle that reaches outside the canvas', () => {
    const m = rectMask(4, 4, { x: -10, y: -10, w: 12, h: 12 });
    expect(sum(m)).toBe(4 * 255);
    expect(maskBounds(m)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('leaves the mask empty for a rectangle wholly outside', () => {
    expect(isEmpty(rectMask(4, 4, { x: 10, y: 10, w: 5, h: 5 }))).toBe(true);
  });

  it('softens the edge with a feather that rises towards the inside', () => {
    const m = rectMask(32, 32, { x: 8, y: 8, w: 16, h: 16 }, 3);
    const row = [4, 6, 7, 8, 9, 10, 12, 16].map((x) => at(m, x, 16));
    expect(row[0]).toBe(0);
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    expect(at(m, 7, 16)).toBeGreaterThan(0);
    expect(at(m, 8, 16)).toBeLessThan(255);
    expect(at(m, 7, 16) + at(m, 8, 16)).toBe(255);
    expect(row[row.length - 1]).toBe(255);
  });
});

describe('ellipseMask', () => {
  it('is empty for a box with no width or no height', () => {
    expect(isEmpty(ellipseMask(8, 8, { x: 2, y: 2, w: 0, h: 4 }))).toBe(true);
    expect(isEmpty(ellipseMask(8, 8, { x: 2, y: 2, w: 4, h: 0 }))).toBe(true);
  });

  it('covers the centre and leaves the corners of its box out', () => {
    const m = ellipseMask(40, 40, { x: 4, y: 10, w: 32, h: 20 });
    expect(at(m, 20, 20)).toBe(255);
    expect(at(m, 4, 10)).toBe(0);
    expect(at(m, 35, 29)).toBe(0);
  });

  it('covers an area close to pi times the radii', () => {
    const m = ellipseMask(64, 64, { x: 8, y: 16, w: 48, h: 32 });
    const area = sum(m) / 255;
    expect(Math.abs(area - Math.PI * 24 * 16) / (Math.PI * 24 * 16)).toBeLessThan(0.02);
  });

  it('is mirror symmetric about both axes', () => {
    const m = ellipseMask(32, 32, { x: 4, y: 8, w: 24, h: 16 });
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        expect(at(m, x, y)).toBe(at(m, 31 - x, y));
        expect(at(m, x, y)).toBe(at(m, x, 31 - y));
      }
    }
  });
});

describe('polygonMask', () => {
  it('is empty for fewer than three points', () => {
    expect(isEmpty(polygonMask(8, 8, [{ x: 0, y: 0 }, { x: 8, y: 8 }]))).toBe(true);
  });

  it('fills an axis aligned square exactly', () => {
    const m = polygonMask(8, 8, [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }]);
    expect(sum(m)).toBe(16 * 255);
    expect(maskBounds(m)).toEqual({ x: 2, y: 2, w: 4, h: 4 });
  });

  it('gives fractional coverage on half covered columns and rows', () => {
    const m = polygonMask(8, 8, [{ x: 2.5, y: 2.5 }, { x: 5, y: 2.5 }, { x: 5, y: 5 }, { x: 2.5, y: 5 }]);
    expect(at(m, 2, 3)).toBe(128);
    expect(at(m, 3, 2)).toBe(128);
    expect(at(m, 2, 2)).toBe(64);
    expect(at(m, 3, 3)).toBe(255);
  });

  it('covers about the area of a triangle', () => {
    const m = polygonMask(40, 40, [{ x: 4, y: 4 }, { x: 36, y: 4 }, { x: 4, y: 36 }]);
    expect(Math.abs(sum(m) / 255 - 512) / 512).toBeLessThan(0.02);
  });

  it('leaves the overlap of a self crossing outline empty by the even-odd rule', () => {
    const outer = [{ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 14, y: 14 }, { x: 2, y: 14 }, { x: 2, y: 2 }];
    const inner = [{ x: 6, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 6 }];
    const m = polygonMask(16, 16, outer.concat(inner));
    expect(at(m, 8, 8)).toBe(0);
    expect(at(m, 4, 8)).toBe(255);
    expect(sum(m)).toBe((144 - 16) * 255);
  });

  it('clips a polygon that reaches past the canvas', () => {
    const m = polygonMask(4, 4, [{ x: -5, y: -5 }, { x: 2, y: -5 }, { x: 2, y: 9 }, { x: -5, y: 9 }]);
    expect(sum(m)).toBe(8 * 255);
    expect(maskBounds(m)).toEqual({ x: 0, y: 0, w: 2, h: 4 });
  });
});

describe('combine', () => {
  const next = mask(2, 2, [0, 128, 255, 128]);

  it('copies the new mask when there is no selection yet', () => {
    const out = combine(null, next, 'add');
    expect(Array.from(out.data)).toEqual([0, 128, 255, 128]);
    expect(out.data).not.toBe(next.data);
  });

  it('gives an empty mask when removing from no selection', () => {
    expect(isEmpty(combine(null, next, 'remove'))).toBe(true);
  });

  it('replaces the old selection outright', () => {
    const out = combine(mask(2, 2, [255, 255, 255, 255]), next, 'replace');
    expect(Array.from(out.data)).toEqual([0, 128, 255, 128]);
  });

  it('adds soft values like a screen', () => {
    const out = combine(mask(2, 2, [77, 128, 10, 0]), next, 'add');
    expect(Array.from(out.data)).toEqual([77, 192, 255, 128]);
  });

  it('removes soft values like a multiply by the inverse', () => {
    const out = combine(mask(2, 2, [77, 200, 255, 255]), next, 'remove');
    expect(Array.from(out.data)).toEqual([77, 100, 0, 127]);
  });

  it('treats a selection of another size as no selection', () => {
    const out = combine(mask(1, 1, [255]), next, 'add');
    expect(out.width).toBe(2);
    expect(Array.from(out.data)).toEqual([0, 128, 255, 128]);
  });

  it('does not change its inputs', () => {
    const base = mask(2, 2, [1, 2, 3, 4]);
    combine(base, next, 'add');
    combine(base, next, 'remove');
    expect(Array.from(base.data)).toEqual([1, 2, 3, 4]);
    expect(Array.from(next.data)).toEqual([0, 128, 255, 128]);
  });
});

describe('invertMask, maskBounds and isEmpty', () => {
  it('inverts every value and round trips', () => {
    const m = mask(3, 1, [0, 100, 255]);
    const inv = invertMask(m);
    expect(Array.from(inv.data)).toEqual([255, 155, 0]);
    expect(Array.from(invertMask(inv).data)).toEqual([0, 100, 255]);
  });

  it('finds the tight bounds of the selected pixels', () => {
    const m = mask(4, 4, [0, 0, 0, 0, 0, 0, 9, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(maskBounds(m)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(isEmpty(m)).toBe(false);
  });

  it('has no bounds when nothing is selected', () => {
    const m = mask(3, 2, [0, 0, 0, 0, 0, 0]);
    expect(maskBounds(m)).toBeNull();
    expect(isEmpty(m)).toBe(true);
  });

  it('bounds a single pixel in the last corner', () => {
    expect(maskBounds(mask(2, 2, [0, 0, 0, 5]))).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });
});

describe('extract', () => {
  const raster: Raster = { width: 3, height: 2, data: new Uint8ClampedArray(24) };
  for (let i = 0; i < 6; i++) raster.data.set([i * 10, i * 10 + 1, i * 10 + 2, 200], i * 4);

  it('crops to the mask bounds and scales alpha by the mask', () => {
    const out = extract(raster, mask(3, 2, [0, 255, 0, 0, 51, 0]));
    expect(out.rect).toEqual({ x: 1, y: 0, w: 1, h: 2 });
    expect(out.raster.width).toBe(1);
    expect(out.raster.height).toBe(2);
    expect(Array.from(out.raster.data)).toEqual([10, 11, 12, 200, 40, 41, 42, 40]);
  });

  it('leaves unselected pixels inside the crop fully transparent', () => {
    const out = extract(raster, mask(3, 2, [255, 0, 0, 0, 0, 255]));
    expect(out.rect).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(Array.from(out.raster.data.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.raster.data.slice(20, 24))).toEqual([50, 51, 52, 200]);
  });

  it('returns an empty raster for an empty mask or a mask of another size', () => {
    expect(extract(raster, mask(3, 2, [0, 0, 0, 0, 0, 0])).raster.width).toBe(0);
    const other = extract(raster, mask(2, 2, [255, 255, 255, 255]));
    expect(other.raster.data).toHaveLength(0);
    expect(other.rect).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('maskOutline', () => {
  const span = (loop: { x: number; y: number }[]) => ({
    x0: Math.min(...loop.map((p) => p.x)), x1: Math.max(...loop.map((p) => p.x)),
    y0: Math.min(...loop.map((p) => p.y)), y1: Math.max(...loop.map((p) => p.y)),
  });

  it('has no contour for an empty mask', () => {
    expect(maskOutline(mask(2, 2, [0, 0, 0, 0]))).toEqual([]);
  });

  it('traces one closed loop along the pixel edges of a block', () => {
    const loops = maskOutline(rectMask(8, 8, { x: 2, y: 2, w: 3, h: 4 }));
    expect(loops).toHaveLength(1);
    const loop = loops[0];
    expect(loop[loop.length - 1]).toEqual(loop[0]);
    expect(span(loop)).toEqual({ x0: 2, x1: 5, y0: 2, y1: 6 });
  });

  it('traces a loop round a block that touches the canvas edge', () => {
    const loops = maskOutline(rectMask(4, 4, { x: 0, y: 0, w: 4, h: 4 }));
    expect(loops).toHaveLength(1);
    expect(span(loops[0])).toEqual({ x0: 0, x1: 4, y0: 0, y1: 4 });
  });

  it('traces one loop for each separate island', () => {
    const m = combine(rectMask(16, 8, { x: 1, y: 1, w: 3, h: 3 }), rectMask(16, 8, { x: 9, y: 2, w: 4, h: 4 }), 'add');
    const loops = maskOutline(m);
    expect(loops).toHaveLength(2);
    const lefts = loops.map((l) => span(l).x0).sort((a, b) => a - b);
    expect(lefts).toEqual([1, 9]);
  });

  it('traces the hole of a ring as a loop of its own', () => {
    const ring = combine(rectMask(12, 12, { x: 1, y: 1, w: 10, h: 10 }), rectMask(12, 12, { x: 4, y: 4, w: 4, h: 4 }), 'remove');
    expect(maskOutline(ring)).toHaveLength(2);
  });

  it('ignores values below the half level', () => {
    expect(maskOutline(mask(3, 3, [0, 0, 0, 0, 100, 0, 0, 0, 0]))).toEqual([]);
  });
});

describe('autoMask', () => {
  function halves(): Raster {
    const r: Raster = { width: 6, height: 4, data: new Uint8ClampedArray(96) };
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) r.data.set(x < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 6 + x) * 4);
    return r;
  }

  it('selects the connected region of the clicked colour only', () => {
    const m = autoMask(halves(), 1, 1, 0.1);
    expect(maskBounds(m)).toEqual({ x: 0, y: 0, w: 3, h: 4 });
    expect(at(m, 0, 0)).toBe(255);
    expect(at(m, 4, 2)).toBe(0);
  });

  it('selects nothing for a click outside the picture', () => {
    const m = autoMask(halves(), -1, 99, 0.1);
    expect(m.width).toBe(6);
    expect(m.height).toBe(4);
    expect(isEmpty(m)).toBe(true);
  });
});
