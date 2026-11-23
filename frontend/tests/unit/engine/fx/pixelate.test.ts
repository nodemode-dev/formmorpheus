import { describe, expect, it } from 'vitest';
import '@src/engine/fx/pixelate';
import { effectOf, gpuSteps, type Effect, type FxCtx, type FxOpts, type FxParams } from '@src/engine/fx/registry';

function pixelate(): Effect {
  const e = effectOf('pixelate');
  if (!e) throw new Error('pixelate is not registered');
  return e;
}

function ramp(w: number, h: number, alpha = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([x, y, 9, alpha], (y * w + x) * 4);
  return d;
}

function run(src: Uint8ClampedArray, w: number, h: number, p: FxParams, o: FxOpts = {}, over: Partial<FxCtx> = {}): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(w * h * 4);
  pixelate().cpu(src, dst, w, h, p, o, { scale: 1, ox: 0, oy: 0, mw: w, mh: h, ...over }, { x0: 0, y0: 0, x1: w, y1: h });
  return dst;
}

const at = (d: Uint8ClampedArray, w: number, x: number, y: number): number[] => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
const cols = (d: Uint8ClampedArray, w: number, y = 0): number[] => Array.from({ length: w }, (_, x) => d[(y * w + x) * 4]);

describe('pixelate', () => {
  it('fills each square cell with the pixel at its centre', () => {
    const d = run(ramp(4, 4), 4, 4, { size: 2, dot: 1 }, { shape: 'square' });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      expect(at(d, 4, x, y)).toEqual([x < 2 ? 1 : 3, y < 2 ? 1 : 3, 9, 255]);
    }
  });

  it('scales the cell with the view', () => {
    const d = run(ramp(8, 1), 8, 1, { size: 2, dot: 1 }, {}, { scale: 2 });
    expect(cols(d, 8)).toEqual([2, 2, 2, 2, 6, 6, 6, 6]);
  });

  it('never uses a cell smaller than one pixel', () => {
    const src = ramp(5, 3);
    expect(Array.from(run(src, 5, 3, { size: 0.2, dot: 1 }))).toEqual(Array.from(src));
    expect(Array.from(run(src, 5, 3, { size: -40, dot: 1 }))).toEqual(Array.from(src));
  });

  it('anchors the grid to the stage origin', () => {
    const d = run(ramp(4, 1), 4, 1, { size: 2, dot: 1 }, {}, { ox: 1 });
    expect(cols(d, 4)).toEqual([0, 2, 2, 3]);
  });

  it('leaves a cell empty when its centre sample is transparent', () => {
    const src = ramp(4, 2);
    src[(0 * 4 + 1) * 4 + 3] = 0;
    src[(1 * 4 + 1) * 4 + 3] = 0;
    const d = run(src, 4, 2, { size: 2, dot: 1 });
    expect(at(d, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(d, 4, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(at(d, 4, 2, 0)).toEqual([3, 1, 9, 255]);
  });

  it('keeps the sampled alpha of a half transparent cell', () => {
    const d = run(ramp(2, 2, 100), 2, 2, { size: 2, dot: 1 });
    expect(at(d, 2, 0, 0)).toEqual([1, 1, 9, 100]);
  });

  it('falls back to squares for an unknown shape', () => {
    const src = ramp(4, 4);
    expect(Array.from(run(src, 4, 4, { size: 2, dot: 1 }, { shape: 'star' }))).toEqual(Array.from(run(src, 4, 4, { size: 2, dot: 1 }, { shape: 'square' })));
  });

  it('draws a round dot that fades at its rim and clears the cell corners', () => {
    const d = run(ramp(4, 4), 4, 4, { size: 4, dot: 0.5 }, { shape: 'dot' });
    expect(at(d, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(d, 4, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(at(d, 4, 1, 1)).toEqual([2, 2, 9, 202]);
    expect(at(d, 4, 2, 2)).toEqual([2, 2, 9, 202]);
  });

  it('grows the dot with the dot size', () => {
    const small = run(ramp(4, 4), 4, 4, { size: 4, dot: 0.5 }, { shape: 'dot' });
    const big = run(ramp(4, 4), 4, 4, { size: 4, dot: 1.3 }, { shape: 'dot' });
    expect(small[3]).toBe(0);
    expect(big[3]).toBeGreaterThan(200);
    expect(big[(1 * 4 + 1) * 4 + 3]).toBe(255);
  });

  it('keeps a flat picture flat on the hex grid', () => {
    const src = new Uint8ClampedArray(6 * 6 * 4);
    for (let i = 0; i < src.length; i += 4) src.set([40, 50, 60, 255], i);
    expect(Array.from(run(src, 6, 6, { size: 3, dot: 1 }, { shape: 'hex' }))).toEqual(Array.from(src));
  });

  it('samples every hex pixel from a source pixel at most one cell away', () => {
    const d = run(ramp(12, 12), 12, 12, { size: 4, dot: 1 }, { shape: 'hex' });
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      const [sx, sy, , a] = at(d, 12, x, y);
      expect(a).toBe(255);
      expect(Math.hypot(sx + 0.5 - (x + 0.5), sy + 0.5 - (y + 0.5))).toBeLessThanOrEqual(4);
    }
  });

  it('sends the cell, shape and dot size to the shader', () => {
    const step = gpuSteps(pixelate(), {}, {})[0];
    if (step.kind !== 'shader' || !step.uniforms) throw new Error('expected a shader step with uniforms');
    const c: FxCtx = { scale: 2, ox: 0, oy: 0, mw: 4, mh: 4 };
    expect(step.uniforms({ size: 8, dot: 0.7 }, { shape: 'dot' }, c)).toEqual({ uCell: 16, uShape: 2, uDot: 0.7 });
    expect(step.uniforms({ size: 0.1, dot: 0.7 }, { shape: 'hex' }, c)).toEqual({ uCell: 1, uShape: 1, uDot: 0.7 });
  });
});
