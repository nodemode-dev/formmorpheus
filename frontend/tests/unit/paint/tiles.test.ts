import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PARK_TILE, cloneRaster, eachParkedTile, isParked, noteUse, parkRaster, parkedEmpty, rasterBytes, unpark, usedAt,
} from '@src/paint/tiles';
import type { Raster } from '@src/paint/types';

function mk(w: number, h: number): Raster {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

function ink(r: Raster, x: number, y: number, v: [number, number, number, number]): void {
  r.data.set(v, (y * r.width + x) * 4);
}

function scatter(r: Raster): void {
  let s = 12345;
  for (let i = 0; i < 400; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const x = s % 120;
    const y = (s >>> 8) % 120;
    ink(r, x, y, [s & 255, (s >>> 4) & 255, (s >>> 12) & 255, 255]);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parkRaster', () => {
  it('refuses a raster smaller than 4096 pixels', () => {
    const r = mk(63, 65);
    expect(parkRaster(r)).toBe(false);
    expect(isParked(r)).toBe(false);
  });

  it('refuses a raster whose data length does not match its size', () => {
    const r: Raster = { width: 128, height: 128, data: new Uint8ClampedArray(100) };
    expect(parkRaster(r)).toBe(false);
    expect(isParked(r)).toBe(false);
  });

  it('parks an empty raster with no bytes at all', () => {
    const r = mk(256, 256);
    expect(parkRaster(r)).toBe(true);
    expect(isParked(r)).toBe(true);
    expect(parkedEmpty(r)).toBe(true);
    expect(rasterBytes(r)).toBe(0);
  });

  it('refuses to park a raster twice', () => {
    const r = mk(128, 128);
    expect(parkRaster(r)).toBe(true);
    expect(parkRaster(r)).toBe(false);
  });

  it('stores a flat filled tile as four bytes', () => {
    const r = mk(PARK_TILE, PARK_TILE);
    for (let i = 0; i < r.data.length; i += 4) r.data.set([10, 20, 30, 255], i);
    const before = r.data.slice();
    expect(parkRaster(r)).toBe(true);
    expect(rasterBytes(r)).toBe(4);
    expect(parkedEmpty(r)).toBe(false);
    expect(Array.from(r.data)).toEqual(Array.from(before));
  });

  it('keeps only the tiles that hold ink', () => {
    const r = mk(PARK_TILE * 2, PARK_TILE);
    ink(r, PARK_TILE + 3, 5, [1, 2, 3, 4]);
    parkRaster(r);
    expect(rasterBytes(r)).toBe(PARK_TILE * PARK_TILE * 4);
  });

  it('reports the flat array size for a raster that is not parked', () => {
    const r = mk(70, 70);
    expect(rasterBytes(r)).toBe(70 * 70 * 4);
    expect(parkedEmpty(r)).toBe(false);
  });
});

describe('reading a parked raster', () => {
  it('gives back the exact pixels of a raster whose size is not a multiple of the tile', () => {
    const r = mk(300, 200);
    scatter(r);
    ink(r, 299, 199, [7, 8, 9, 10]);
    const before = r.data.slice();
    expect(parkRaster(r)).toBe(true);
    expect(rasterBytes(r)).toBe(128 * 128 * 4 + 44 * 72 * 4);
    const after = r.data;
    expect(after.length).toBe(before.length);
    expect(after.every((v, i) => v === before[i])).toBe(true);
  });

  it('unparks the raster on the first read of data', () => {
    const r = mk(128, 128);
    parkRaster(r);
    const d = r.data;
    expect(isParked(r)).toBe(false);
    expect(d.length).toBe(128 * 128 * 4);
    expect(d.some((v) => v !== 0)).toBe(false);
    expect(r.data).toBe(d);
  });

  it('accepts a new data array while parked and forgets the tiles', () => {
    const r = mk(128, 128);
    ink(r, 4, 4, [9, 9, 9, 9]);
    parkRaster(r);
    const fresh = new Uint8ClampedArray(128 * 128 * 4);
    fresh[0] = 77;
    r.data = fresh;
    expect(isParked(r)).toBe(false);
    expect(r.data).toBe(fresh);
    expect(r.data[(4 * 128 + 4) * 4]).toBe(0);
  });

  it('returns the same array when unpark is called on a plain raster', () => {
    const r = mk(8, 8);
    const d = r.data;
    expect(unpark(r)).toBe(d);
  });

  it('can be parked again after it was read', () => {
    const r = mk(128, 128);
    ink(r, 100, 100, [5, 6, 7, 8]);
    parkRaster(r);
    unpark(r);
    expect(parkRaster(r)).toBe(true);
    expect(Array.from(r.data.subarray((100 * 128 + 100) * 4, (100 * 128 + 100) * 4 + 4))).toEqual([5, 6, 7, 8]);
  });
});

describe('eachParkedTile', () => {
  it('returns false and calls nothing for a plain raster', () => {
    const fn = vi.fn();
    expect(eachParkedTile(mk(128, 128), fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('visits only inked tiles with clipped sizes at the right and bottom edges', () => {
    const r = mk(200, 130);
    ink(r, 199, 129, [1, 2, 3, 4]);
    parkRaster(r);
    const seen: { x: number; y: number; w: number; h: number; n: number; last: number[] }[] = [];
    expect(eachParkedTile(r, (x, y, w, h, b) => seen.push({ x, y, w, h, n: b.length, last: Array.from(b.subarray(b.length - 4)) }))).toBe(true);
    expect(seen).toEqual([{ x: 128, y: 128, w: 72, h: 2, n: 72 * 2 * 4, last: [1, 2, 3, 4] }]);
    expect(isParked(r)).toBe(true);
  });

  it('expands a flat tile to full bytes for the caller', () => {
    const r = mk(128, 128);
    for (let i = 0; i < r.data.length; i += 4) r.data.set([200, 100, 50, 255], i);
    parkRaster(r);
    let got: Uint8ClampedArray | null = null;
    eachParkedTile(r, (_x, _y, _w, _h, b) => { got = b; });
    const bytes = got as unknown as Uint8ClampedArray;
    expect(bytes.length).toBe(128 * 128 * 4);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([200, 100, 50, 255]);
    expect(Array.from(bytes.subarray(bytes.length - 4))).toEqual([200, 100, 50, 255]);
  });
});

describe('cloneRaster', () => {
  it('copies a plain raster into an independent array', () => {
    const r = mk(4, 4);
    r.data[0] = 9;
    const c = cloneRaster(r);
    c.data[0] = 1;
    expect(r.data[0]).toBe(9);
    expect(c.width).toBe(4);
    expect(c.height).toBe(4);
  });

  it('clones a parked raster without unparking the original', () => {
    const r = mk(256, 128);
    ink(r, 130, 7, [11, 22, 33, 44]);
    parkRaster(r);
    const c = cloneRaster(r);
    expect(isParked(c)).toBe(true);
    expect(rasterBytes(c)).toBe(rasterBytes(r));
    const o = (7 * 256 + 130) * 4;
    expect(Array.from(c.data.subarray(o, o + 4))).toEqual([11, 22, 33, 44]);
    expect(isParked(c)).toBe(false);
    expect(isParked(r)).toBe(true);
  });

  it('keeps the original intact when the clone is painted after reading', () => {
    const r = mk(128, 128);
    ink(r, 1, 1, [5, 5, 5, 5]);
    parkRaster(r);
    const c = cloneRaster(r);
    c.data[(1 * 128 + 1) * 4] = 99;
    expect(r.data[(1 * 128 + 1) * 4]).toBe(5);
  });
});

describe('use tracking', () => {
  it('reports zero for a raster never noted', () => {
    expect(usedAt(mk(2, 2))).toBe(0);
  });

  it('records the time of noteUse', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    const r = mk(2, 2);
    noteUse(r);
    expect(usedAt(r)).toBe(5000);
  });

  it('marks a raster as used when it is unparked', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const r = mk(128, 128);
    noteUse(r);
    parkRaster(r);
    vi.setSystemTime(9000);
    unpark(r);
    expect(usedAt(r)).toBe(9000);
  });
});
