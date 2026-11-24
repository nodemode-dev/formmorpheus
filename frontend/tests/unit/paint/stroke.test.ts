import { describe, expect, it } from 'vitest';
import { applyPatch } from '@src/paint/stroke';
import type { PixelPatch, Raster } from '@src/paint/types';

function mk(w: number, h: number, fill: number): Raster {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(fill) };
}

function patch(x: number, y: number, w: number, h: number): PixelPatch {
  const before = new Uint8ClampedArray(w * h * 4);
  const after = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    before.fill(10 + i, i * 4, i * 4 + 4);
    after.fill(100 + i, i * 4, i * 4 + 4);
  }
  return { layer: 'a', rect: { x, y, w, h }, before, after };
}

function px(r: Raster, x: number, y: number): number {
  return r.data[(y * r.width + x) * 4];
}

describe('applyPatch', () => {
  it('writes the after bytes on redo and returns the rect', () => {
    const r = mk(6, 5, 1);
    const p = patch(1, 2, 3, 2);
    expect(applyPatch(r, p, 'redo')).toEqual({ x: 1, y: 2, w: 3, h: 2 });
    expect(px(r, 1, 2)).toBe(100);
    expect(px(r, 3, 2)).toBe(102);
    expect(px(r, 1, 3)).toBe(103);
    expect(px(r, 3, 3)).toBe(105);
  });

  it('writes the before bytes on undo', () => {
    const r = mk(6, 5, 1);
    const p = patch(1, 2, 3, 2);
    applyPatch(r, p, 'redo');
    applyPatch(r, p, 'undo');
    expect(px(r, 1, 2)).toBe(10);
    expect(px(r, 3, 3)).toBe(15);
  });

  it('leaves every pixel outside the rect alone', () => {
    const r = mk(6, 5, 1);
    applyPatch(r, patch(1, 2, 3, 2), 'redo');
    let untouched = 0;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        const inside = x >= 1 && x < 4 && y >= 2 && y < 4;
        if (!inside) {
          expect(px(r, x, y)).toBe(1);
          untouched++;
        }
      }
    }
    expect(untouched).toBe(24);
  });

  it('writes all four channels of each pixel', () => {
    const r = mk(4, 4, 0);
    applyPatch(r, patch(2, 2, 1, 1), 'redo');
    expect(Array.from(r.data.subarray((2 * 4 + 2) * 4, (2 * 4 + 2) * 4 + 4))).toEqual([100, 100, 100, 100]);
  });

  it('clips a patch that hangs over the left and top edges and reads the matching source pixels', () => {
    const r = mk(4, 4, 1);
    const p = patch(-1, -1, 3, 3);
    expect(applyPatch(r, p, 'redo')).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(px(r, 0, 0)).toBe(104);
    expect(px(r, 1, 0)).toBe(105);
    expect(px(r, 0, 1)).toBe(107);
    expect(px(r, 1, 1)).toBe(108);
    expect(px(r, 2, 0)).toBe(1);
    expect(px(r, 0, 2)).toBe(1);
  });

  it('clips a patch that hangs over the right and bottom edges', () => {
    const r = mk(4, 4, 1);
    const p = patch(3, 3, 3, 3);
    expect(applyPatch(r, p, 'undo')).toEqual({ x: 3, y: 3, w: 1, h: 1 });
    expect(px(r, 3, 3)).toBe(10);
    expect(px(r, 2, 3)).toBe(1);
    expect(px(r, 0, 0)).toBe(1);
  });

  it('changes nothing and reports an empty rect for a patch fully outside', () => {
    const r = mk(4, 4, 1);
    const out = applyPatch(r, patch(10, 10, 2, 2), 'redo');
    expect(out.w).toBe(0);
    expect(out.h).toBe(0);
    expect(r.data.every((v) => v === 1)).toBe(true);
    const left = applyPatch(r, patch(-5, 0, 2, 2), 'redo');
    expect(left.w).toBe(0);
    expect(r.data.every((v) => v === 1)).toBe(true);
  });

  it('restores the raster exactly after redo then undo of a real change', () => {
    const r = mk(5, 5, 0);
    for (let i = 0; i < r.data.length; i++) r.data[i] = (i * 7) % 256;
    const start = r.data.slice();
    const rect = { x: 1, y: 1, w: 3, h: 3 };
    const before = new Uint8ClampedArray(3 * 3 * 4);
    for (let y = 0; y < 3; y++) before.set(start.subarray(((y + 1) * 5 + 1) * 4, ((y + 1) * 5 + 4) * 4), y * 12);
    const p: PixelPatch = { layer: 'a', rect, before, after: new Uint8ClampedArray(36).fill(255) };
    applyPatch(r, p, 'redo');
    expect(px(r, 2, 2)).toBe(255);
    applyPatch(r, p, 'undo');
    expect(Array.from(r.data)).toEqual(Array.from(start));
  });
});
