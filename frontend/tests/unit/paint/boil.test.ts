import { describe, expect, it } from 'vitest';
import { boil, boilHash, boilSeed } from '@src/paint/boil';
import type { Raster } from '@src/paint/types';

function raster(w: number, h: number): Raster {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as Raster;
}

function fillRect(r: Raster, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data.set(rgba, (y * r.width + x) * 4);
}

describe('boilHash', () => {
  it('stays in 0 to 1 on a 24 bit grid', () => {
    for (let i = -20; i < 20; i++) {
      const v = boilHash(i * 7, i * 13 - 5, i, i & 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger(v * 16777216)).toBe(true);
    }
  });

  it('is repeatable for the same inputs', () => {
    expect(boilHash(12, -7, 3, 1)).toBe(boilHash(12, -7, 3, 1));
  });

  it('changes with the cell, the seed and the channel', () => {
    const base = boilHash(4, 9, 2, 0);
    expect(boilHash(5, 9, 2, 0)).not.toBe(base);
    expect(boilHash(4, 10, 2, 0)).not.toBe(base);
    expect(boilHash(4, 9, 3, 0)).not.toBe(base);
    expect(boilHash(4, 9, 2, 1)).not.toBe(base);
  });

  it('spreads values across the range', () => {
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += boilHash(i, i * 3 + 1, 0, 0);
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});

describe('boilSeed', () => {
  it('holds a seed for the rate and then steps to the next', () => {
    expect([0, 1, 2, 3, 4, 5].map((f) => boilSeed(f, 2, 3))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('cycles back after the last variation', () => {
    expect(boilSeed(6, 2, 3)).toBe(0);
    expect(boilSeed(9, 1, 4)).toBe(1);
  });

  it('wraps negative frames into the range', () => {
    expect(boilSeed(-1, 2, 3)).toBe(2);
    expect(boilSeed(-2, 1, 4)).toBe(2);
  });

  it('treats a rate or a variation count below one as one', () => {
    expect(boilSeed(5, 0, 4)).toBe(1);
    expect(boilSeed(5, -3, 4)).toBe(1);
    expect(boilSeed(5, 1, 0)).toBe(0);
  });

  it('rounds a fractional rate and count', () => {
    expect(boilSeed(4, 1.6, 2.6)).toBe(2);
  });
});

describe('boil', () => {
  it('returns null and clears the target for an empty source', () => {
    const src = raster(40, 40), dst = raster(40, 40);
    dst.data.fill(200);
    expect(boil(src, dst, { amount: 3, scale: 12, seed: 1 })).toBeNull();
    expect(dst.data.every((v) => v === 0)).toBe(true);
  });

  it('copies the picture when the amount is zero', () => {
    const src = raster(48, 40), dst = raster(48, 40);
    fillRect(src, 10, 8, 30, 25, [200, 100, 50, 255]);
    fillRect(src, 20, 12, 24, 16, [10, 240, 90, 255]);
    boil(src, dst, { amount: 0, scale: 10, seed: 4 });
    for (let i = 0; i < src.data.length; i++) expect(Math.abs(dst.data[i] - src.data[i])).toBeLessThanOrEqual(1);
  });

  it('returns a box that holds the content and stays inside the raster', () => {
    const src = raster(70, 50), dst = raster(70, 50);
    fillRect(src, 36, 20, 40, 24, [255, 255, 255, 255]);
    const b = boil(src, dst, { amount: 2, scale: 8, seed: 0 });
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x0).toBeLessThanOrEqual(36); expect(b.x1).toBeGreaterThanOrEqual(40);
    expect(b.y0).toBeLessThanOrEqual(20); expect(b.y1).toBeGreaterThanOrEqual(24);
    expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.y0).toBeGreaterThanOrEqual(0);
    expect(b.x1).toBeLessThanOrEqual(70); expect(b.y1).toBeLessThanOrEqual(50);
    for (let y = 0; y < 50; y++) for (let x = 0; x < 70; x++) {
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) continue;
      expect(dst.data[(y * 70 + x) * 4 + 3]).toBe(0);
    }
  });

  it('gives the same result for the same seed and another for a different seed', () => {
    const src = raster(64, 64);
    fillRect(src, 20, 20, 44, 44, [255, 0, 0, 255]);
    const a = raster(64, 64), b = raster(64, 64), c = raster(64, 64);
    const p = { amount: 4, scale: 6, seed: 2 };
    boil(src, a, p);
    boil(src, b, p);
    boil(src, c, { ...p, seed: 3 });
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
  });

  it('moves the outline but keeps the colour of a flat shape', () => {
    const src = raster(64, 64), dst = raster(64, 64);
    fillRect(src, 20, 20, 44, 44, [30, 120, 210, 255]);
    boil(src, dst, { amount: 4, scale: 6, seed: 5 });
    let changed = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const o = i * 4;
      if (dst.data[o + 3] !== src.data[o + 3]) changed++;
      if (dst.data[o + 3] === 0) continue;
      expect(Math.abs(dst.data[o] - 30)).toBeLessThanOrEqual(1);
      expect(Math.abs(dst.data[o + 1] - 120)).toBeLessThanOrEqual(1);
      expect(Math.abs(dst.data[o + 2] - 210)).toBeLessThanOrEqual(1);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('never moves content farther than the amount', () => {
    const src = raster(64, 64), dst = raster(64, 64);
    fillRect(src, 24, 24, 40, 40, [255, 255, 255, 255]);
    boil(src, dst, { amount: 3, scale: 9, seed: 7 });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const inside = x >= 24 - 4 && x < 40 + 4 && y >= 24 - 4 && y < 40 + 4;
      if (!inside) expect(dst.data[(y * 64 + x) * 4 + 3]).toBe(0);
    }
    expect(dst.data[(32 * 64 + 32) * 4 + 3]).toBeGreaterThanOrEqual(254);
  });
});
