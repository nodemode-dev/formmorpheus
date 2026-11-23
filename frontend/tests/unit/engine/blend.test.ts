import { describe, expect, it } from 'vitest';
import { SEPARABLE, blendPixels, isPixelBlend } from '@src/engine/blend';
import type { BlendMode } from '@src/engine/types';

function px(...v: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(v);
}

function sep(mode: BlendMode, b: number, s: number): number {
  const fn = SEPARABLE[mode];
  if (!fn) throw new Error(`no formula for ${mode}`);
  return fn(b, s);
}

describe('pixel blend formulas', () => {
  it('knows which modes need a per pixel pass', () => {
    expect(isPixelBlend('divide')).toBe(true);
    expect(isPixelBlend('darker-color')).toBe(true);
    expect(isPixelBlend('normal')).toBe(false);
    expect(isPixelBlend('multiply')).toBe(false);
  });

  it('clamps linear burn, linear light and subtract to the 0 to 1 range', () => {
    expect(sep('linear-burn', 0.2, 0.3)).toBe(0);
    expect(sep('linear-burn', 0.8, 0.7)).toBeCloseTo(0.5, 10);
    expect(sep('linear-light', 0.9, 0.9)).toBe(1);
    expect(sep('linear-light', 0.5, 0.5)).toBeCloseTo(0.5, 10);
    expect(sep('subtract', 0.2, 0.9)).toBe(0);
    expect(sep('subtract', 0.9, 0.2)).toBeCloseTo(0.7, 10);
  });

  it('divides without blowing up on a zero source', () => {
    expect(sep('divide', 0, 0)).toBe(0);
    expect(sep('divide', 0.3, 0)).toBe(1);
    expect(sep('divide', 0.2, 0.4)).toBeCloseTo(0.5, 10);
    expect(sep('divide', 0.9, 0.3)).toBe(1);
  });

  it('thresholds hard mix at a sum of one', () => {
    expect(sep('hard-mix', 0.5, 0.5)).toBe(1);
    expect(sep('hard-mix', 0.49, 0.5)).toBe(0);
  });

  it('darkens with a dark source and lightens with a light one in pin light', () => {
    expect(sep('pin-light', 0.8, 0.25)).toBeCloseTo(0.5, 10);
    expect(sep('pin-light', 0.2, 0.25)).toBeCloseTo(0.2, 10);
    expect(sep('pin-light', 0.2, 0.75)).toBeCloseTo(0.5, 10);
    expect(sep('pin-light', 0.8, 0.75)).toBeCloseTo(0.8, 10);
  });

  it('burns below mid grey and dodges above it in vivid light', () => {
    expect(sep('vivid-light', 0.5, 0.5)).toBeCloseTo(0.5, 10);
    expect(sep('vivid-light', 0.5, 0)).toBe(0);
    expect(sep('vivid-light', 1, 0)).toBe(1);
    expect(sep('vivid-light', 0.5, 1)).toBe(1);
    expect(sep('vivid-light', 0, 1)).toBe(0);
    expect(sep('vivid-light', 0.25, 0.75)).toBeCloseTo(0.5, 10);
  });
});

describe('blendPixels', () => {
  it('subtracts an opaque source from an opaque backdrop per channel', () => {
    const dst = px(200, 100, 50, 255);
    blendPixels(dst, px(50, 150, 50, 255), 'subtract', 1);
    expect(Array.from(dst)).toEqual([150, 0, 0, 255]);
  });

  it('leaves the backdrop alone at zero opacity or under a clear source', () => {
    const dst = px(200, 100, 50, 255, 10, 20, 30, 128);
    blendPixels(dst, px(0, 0, 0, 255, 255, 255, 255, 0), 'subtract', 0);
    expect(Array.from(dst)).toEqual([200, 100, 50, 255, 10, 20, 30, 128]);
    blendPixels(dst, px(0, 0, 0, 0, 255, 255, 255, 0), 'hard-mix', 1);
    expect(Array.from(dst)).toEqual([200, 100, 50, 255, 10, 20, 30, 128]);
  });

  it('shows the plain source over a clear backdrop', () => {
    const dst = px(0, 0, 0, 0);
    blendPixels(dst, px(40, 80, 120, 255), 'linear-burn', 1);
    expect(Array.from(dst)).toEqual([40, 80, 120, 255]);
  });

  it('mixes the blended colour with the backdrop by the opacity', () => {
    const dst = px(100, 100, 100, 255);
    blendPixels(dst, px(200, 200, 200, 255), 'subtract', 0.5);
    expect(Array.from(dst)).toEqual([50, 50, 50, 255]);
  });

  it('raises the alpha when a half clear source lands on a half clear backdrop', () => {
    const dst = px(255, 255, 255, 128);
    blendPixels(dst, px(255, 255, 255, 128), 'hard-mix', 1);
    expect(dst[3]).toBeGreaterThan(185);
    expect(dst[3]).toBeLessThan(195);
    expect(Array.from(dst.slice(0, 3))).toEqual([255, 255, 255]);
  });

  it('takes the whole darker pixel in darker color and the lighter one in lighter color', () => {
    const red = [255, 0, 0, 255], green = [0, 255, 0, 255];
    const a = px(...green);
    blendPixels(a, px(...red), 'darker-color', 1);
    expect(Array.from(a)).toEqual(red);
    const b = px(...green);
    blendPixels(b, px(...red), 'lighter-color', 1);
    expect(Array.from(b)).toEqual(green);
    const c = px(...red);
    blendPixels(c, px(...green), 'lighter-color', 1);
    expect(Array.from(c)).toEqual(green);
  });

  it('blends every pixel of a longer buffer on its own', () => {
    const dst = px(255, 255, 255, 255, 0, 0, 0, 255);
    blendPixels(dst, px(255, 255, 255, 255, 255, 255, 255, 255), 'divide', 1);
    expect(Array.from(dst)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
});
