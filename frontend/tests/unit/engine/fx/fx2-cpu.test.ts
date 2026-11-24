import { describe, expect, it } from 'vitest';
import { chromaDistance, chromaKeyCpu, directionalBlurCpu, lumaKeyCpu, premul, radialBlurCpu, store, tap, type KeyParams } from '@src/engine/fx/fx2-cpu';

interface R { width: number; height: number; data: Uint8ClampedArray }
const raster = (w: number, h: number, px?: number[]): R => ({ width: w, height: h, data: new Uint8ClampedArray(px ?? w * h * 4) });
const full = (r: R) => ({ x0: 0, y0: 0, x1: r.width, y1: r.height });
const dot = (w: number, h: number, x: number, y: number): R => {
  const r = raster(w, h);
  r.data.set([255, 255, 255, 255], (y * w + x) * 4);
  return r;
};
const alpha = (r: R, x: number, y: number): number => r.data[(y * r.width + x) * 4 + 3];
const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255];
const key = (over: Partial<KeyParams> = {}): KeyParams => ({ r: 0, g: 1, b: 0, tolerance: 0.3, softness: 0.1, spill: 0, choke: 0, view: false, ...over });

describe('premul, tap and store', () => {
  it('multiplies colour by alpha and scales to the unit range', () => {
    const p = premul(raster(1, 1, [255, 0, 51, 128]));
    expect(p[0]).toBeCloseTo(128 / 255, 5);
    expect(p[1]).toBe(0);
    expect(p[2]).toBeCloseTo(0.2 * (128 / 255), 5);
    expect(p[3]).toBeCloseTo(128 / 255, 5);
  });

  it('reads one texel exactly at its centre', () => {
    const p = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.9, 0.8, 0.7, 0.6]);
    const acc = new Float32Array(4);
    tap(p, 2, 1, 1.5, 0.5, acc);
    expect(Array.from(acc)).toEqual(Array.from(p.subarray(4, 8)));
  });

  it('averages two texels half way between their centres', () => {
    const p = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]);
    const acc = new Float32Array(4);
    tap(p, 2, 1, 1, 0.5, acc);
    expect(acc[0]).toBeCloseTo(0.5, 6);
    expect(acc[3]).toBeCloseTo(0.5, 6);
  });

  it('treats everything outside the raster as transparent', () => {
    const p = new Float32Array([1, 1, 1, 1]);
    const acc = new Float32Array(4);
    tap(p, 1, 1, 5, 5, acc);
    expect(Array.from(acc)).toEqual([0, 0, 0, 0]);
    tap(p, 1, 1, 0, 0.5, acc);
    expect(acc[3]).toBeCloseTo(0.5, 6);
  });

  it('adds weight into the accumulator instead of replacing it', () => {
    const p = new Float32Array([1, 1, 1, 1]);
    const acc = new Float32Array([1, 1, 1, 1]);
    tap(p, 1, 1, 0.5, 0.5, acc);
    expect(acc[3]).toBeCloseTo(2, 6);
  });

  it('stores a clear pixel when the accumulated alpha is zero', () => {
    const d = raster(1, 1, [9, 9, 9, 9]);
    store(d, 0, new Float32Array([0.5, 0.5, 0.5, 0]), 1);
    expect(Array.from(d.data)).toEqual([0, 0, 0, 0]);
  });

  it('stores straight colour from a premultiplied sum', () => {
    const d = raster(1, 1);
    store(d, 0, new Float32Array([1, 0, 0.5, 1]), 0.5);
    expect(Array.from(d.data)).toEqual([255, 0, 128, 128]);
  });
});

describe('directionalBlurCpu', () => {
  it('copies the picture when the distance is zero', () => {
    const src = raster(2, 1, [255, 0, 255, 255, 0, 255, 0, 255]);
    const dst = raster(2, 1);
    directionalBlurCpu(src, dst, 0, 0, 8, 0, full(src));
    expect(Array.from(dst.data)).toEqual(Array.from(src.data));
  });

  it('spreads along the row and not across rows at angle zero', () => {
    const src = dot(3, 3, 1, 1);
    const dst = raster(3, 3);
    directionalBlurCpu(src, dst, 0, 2, 2, 0, full(src));
    expect(alpha(dst, 0, 1)).toBe(64);
    expect(alpha(dst, 2, 1)).toBe(64);
    expect(alpha(dst, 1, 0)).toBe(0);
    expect(alpha(dst, 1, 2)).toBe(0);
  });

  it('spreads along the column at ninety degrees', () => {
    const src = dot(3, 3, 1, 1);
    const dst = raster(3, 3);
    directionalBlurCpu(src, dst, 90, 2, 2, 0, full(src));
    expect(alpha(dst, 1, 0)).toBe(64);
    expect(alpha(dst, 1, 2)).toBe(64);
    expect(alpha(dst, 0, 1)).toBe(0);
  });

  it('keeps the colour of a blurred pixel unmixed with the clear surround', () => {
    const src = dot(3, 3, 1, 1);
    const dst = raster(3, 3);
    directionalBlurCpu(src, dst, 0, 2, 2, 0, full(src));
    expect(Array.from(dst.data.subarray(12, 15))).toEqual([255, 255, 255]);
  });

  it('smears to one side only when the line is shifted', () => {
    const src = dot(5, 1, 2, 0);
    const a = raster(5, 1), b = raster(5, 1);
    directionalBlurCpu(src, a, 0, 2, 2, 0.5, full(src));
    directionalBlurCpu(src, b, 0, 2, 2, -0.5, full(src));
    expect(alpha(a, 1, 0)).toBeGreaterThan(0);
    expect(alpha(a, 3, 0)).toBe(0);
    expect(alpha(b, 3, 0)).toBeGreaterThan(0);
    expect(alpha(b, 1, 0)).toBe(0);
  });

  it('writes only inside the box', () => {
    const src = raster(3, 1, [...RED, ...RED, ...RED]);
    const dst = raster(3, 1);
    directionalBlurCpu(src, dst, 0, 0, 4, 0, { x0: 1, y0: 0, x1: 2, y1: 1 });
    expect(Array.from(dst.data)).toEqual([0, 0, 0, 0, ...RED, 0, 0, 0, 0]);
  });

  it('uses at least one tap when the quality is zero', () => {
    const src = raster(1, 1, RED);
    const dst = raster(1, 1);
    directionalBlurCpu(src, dst, 0, 0, 0, 0, full(src));
    expect(Array.from(dst.data)).toEqual(RED);
  });
});

describe('radialBlurCpu', () => {
  it('copies the picture when the amount is zero in both modes', () => {
    const src = raster(2, 2, [...RED, ...GREEN, ...GREEN, ...RED]);
    for (const zoom of [true, false]) {
      const dst = raster(2, 2);
      radialBlurCpu(src, dst, zoom, 0, 1, 1, 6, full(src));
      expect(Array.from(dst.data)).toEqual(Array.from(src.data));
    }
  });

  it('leaves the pixel at the centre untouched', () => {
    const src = dot(3, 3, 1, 1);
    for (const zoom of [true, false]) {
      const dst = raster(3, 3);
      radialBlurCpu(src, dst, zoom, 80, 1.5, 1.5, 8, full(src));
      expect(alpha(dst, 1, 1)).toBe(255);
    }
  });

  it('smears an off-centre pixel along the radius when zooming', () => {
    const src = dot(7, 1, 5, 0);
    const dst = raster(7, 1);
    radialBlurCpu(src, dst, true, 100, 0.5, 0.5, 16, full(src));
    expect(alpha(dst, 5, 0)).toBeLessThan(255);
    expect(alpha(dst, 4, 0)).toBeGreaterThan(0);
  });
});

describe('chroma key', () => {
  it('measures zero distance between colours of the same chroma', () => {
    expect(chromaDistance(0, 1, 0, 0, 1, 0)).toBe(0);
    expect(chromaDistance(0.2, 0.2, 0.2, 0.9, 0.9, 0.9)).toBeCloseTo(0, 6);
  });

  it('measures the same distance in both directions and a large one for opposite colours', () => {
    const d = chromaDistance(0, 1, 0, 1, 0, 1);
    expect(d).toBeCloseTo(chromaDistance(1, 0, 1, 0, 1, 0), 10);
    expect(d).toBeGreaterThan(0.5);
  });

  it('removes the key colour and keeps a distant colour', () => {
    const src = raster(2, 1, [...GREEN, ...RED]);
    const dst = raster(2, 1);
    chromaKeyCpu(src, dst, key());
    expect(dst.data[3]).toBe(0);
    expect(Array.from(dst.data.subarray(4))).toEqual(RED);
  });

  it('shows the matte as opaque grey in view mode', () => {
    const src = raster(2, 1, [...GREEN, ...RED]);
    const dst = raster(2, 1);
    chromaKeyCpu(src, dst, key({ view: true }));
    expect(Array.from(dst.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('eats into the kept area with a positive choke', () => {
    const src = raster(3, 1, [...RED, ...GREEN, ...RED]);
    const dst = raster(3, 1);
    chromaKeyCpu(src, dst, key({ choke: 1 }));
    expect([dst.data[3], dst.data[7], dst.data[11]]).toEqual([0, 0, 0]);
  });

  it('grows the kept area with a negative choke', () => {
    const src = raster(3, 1, [...GREEN, ...RED, ...GREEN]);
    const dst = raster(3, 1);
    chromaKeyCpu(src, dst, key({ choke: -1 }));
    expect([dst.data[3], dst.data[7], dst.data[11]]).toEqual([255, 255, 255]);
  });

  it('pulls the key colour out of a tinted pixel only when spill is on', () => {
    const px = [128, 255, 64, 255];
    const off = raster(1, 1), on = raster(1, 1);
    chromaKeyCpu(raster(1, 1, px), off, key({ spill: 0 }));
    chromaKeyCpu(raster(1, 1, px), on, key({ spill: 1 }));
    expect(Array.from(off.data.subarray(0, 3))).toEqual([128, 255, 64]);
    expect(on.data[1]).toBeLessThan(255);
  });

  it('leaves a colour on the far side of the key alone under spill removal', () => {
    const dst = raster(1, 1);
    chromaKeyCpu(raster(1, 1, RED), dst, key({ spill: 1 }));
    expect(Array.from(dst.data)).toEqual(RED);
  });
});

describe('lumaKeyCpu', () => {
  const src = (): R => raster(3, 1, [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);

  it('clears dark pixels and keeps bright ones', () => {
    const dst = raster(3, 1);
    lumaKeyCpu(src(), dst, { threshold: 0.5, softness: 0.1, invert: false });
    expect(dst.data[3]).toBe(0);
    expect(dst.data[11]).toBe(255);
    expect(dst.data[7]).toBeGreaterThan(100);
    expect(dst.data[7]).toBeLessThan(160);
  });

  it('keeps dark pixels instead when inverted', () => {
    const dst = raster(3, 1);
    lumaKeyCpu(src(), dst, { threshold: 0.5, softness: 0.1, invert: true });
    expect(dst.data[3]).toBe(255);
    expect(dst.data[11]).toBe(0);
  });

  it('copies colour unchanged and scales the existing alpha', () => {
    const dst = raster(1, 1);
    lumaKeyCpu(raster(1, 1, [250, 240, 230, 100]), dst, { threshold: 0.2, softness: 0, invert: false });
    expect(Array.from(dst.data)).toEqual([250, 240, 230, 100]);
  });
});
