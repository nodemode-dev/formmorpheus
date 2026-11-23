import { describe, expect, it } from 'vitest';
import '@src/engine/fx/mirror';
import { effectOf, gpuSteps, type Effect, type FxCtx, type FxOpts } from '@src/engine/fx/registry';

function mirror(): Effect {
  const e = effectOf('mirror');
  if (!e) throw new Error('mirror is not registered');
  return e;
}

function ramp(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set([x, y, 7, 255], (y * w + x) * 4);
  return d;
}

function run(w: number, h: number, pos: number, o: FxOpts, over: Partial<FxCtx> = {}, box = { x0: 0, y0: 0, x1: w, y1: h }): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(w * h * 4);
  mirror().cpu(ramp(w, h), dst, w, h, { pos }, o, { scale: 1, ox: 0, oy: 0, mw: w, mh: h, ...over }, box);
  return dst;
}

const cols = (d: Uint8ClampedArray, w: number, y = 0): number[] => Array.from({ length: w }, (_, x) => d[(y * w + x) * 4]);
const rows = (d: Uint8ClampedArray, w: number, h: number, x = 0): number[] => Array.from({ length: h }, (_, y) => d[(y * w + x) * 4 + 1]);

describe('mirror', () => {
  it('reflects the left side onto the right', () => {
    expect(cols(run(4, 1, 0.5, { mode: 'left to right' }), 4)).toEqual([0, 1, 1, 0]);
  });

  it('reflects the right side onto the left', () => {
    expect(cols(run(4, 1, 0.5, { mode: 'right to left' }), 4)).toEqual([3, 2, 2, 3]);
  });

  it('reflects the top onto the bottom', () => {
    expect(rows(run(1, 4, 0.5, { mode: 'top to bottom' }), 1, 4)).toEqual([0, 1, 1, 0]);
  });

  it('reflects the bottom onto the top', () => {
    expect(rows(run(1, 4, 0.5, { mode: 'bottom to top' }), 1, 4)).toEqual([3, 2, 2, 3]);
  });

  it('folds the top left quarter into all four', () => {
    const d = run(4, 4, 0.5, { mode: 'four ways' });
    for (let y = 0; y < 4; y++) {
      expect(cols(d, 4, y)).toEqual([0, 1, 1, 0]);
      expect(d[(y * 4) * 4 + 1]).toBe(Math.min(y, 3 - y));
    }
  });

  it('falls back to left over right for an unknown mode', () => {
    expect(cols(run(4, 1, 0.5, { mode: 'diagonal' }), 4)).toEqual([0, 1, 1, 0]);
    expect(cols(run(4, 1, 0.5, {}), 4)).toEqual([0, 1, 1, 0]);
  });

  it('clamps samples that fall off the surface to the edge pixel', () => {
    expect(cols(run(4, 1, 0, { mode: 'left to right' }), 4)).toEqual([0, 0, 0, 0]);
    expect(cols(run(4, 1, 1, { mode: 'right to left' }), 4)).toEqual([3, 3, 3, 3]);
  });

  it('moves the line with the stage origin and scale', () => {
    expect(cols(run(6, 1, 0.5, { mode: 'left to right' }, { ox: 2, mw: 2, scale: 2 }), 6)).toEqual([0, 1, 2, 3, 3, 2]);
  });

  it('copies all four channels of the sampled pixel', () => {
    const d = run(4, 1, 0.5, { mode: 'left to right' });
    expect(Array.from(d.slice(12, 16))).toEqual([0, 0, 7, 255]);
  });

  it('writes only inside the box', () => {
    const d = run(4, 1, 0.5, { mode: 'left to right' }, {}, { x0: 2, y0: 0, x1: 3, y1: 1 });
    expect(Array.from(d)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7, 255, 0, 0, 0, 0]);
  });

  it('sends the line position and mode number to the shader', () => {
    const step = gpuSteps(mirror(), {}, {})[0];
    if (step.kind !== 'shader' || !step.uniforms) throw new Error('expected a shader step with uniforms');
    const c: FxCtx = { scale: 1, ox: 0, oy: 0, mw: 4, mh: 4 };
    expect(step.uniforms({ pos: 0.25 }, { mode: 'four ways' }, c)).toEqual({ uPos: 0.25, uMode: 4 });
    expect(step.uniforms({ pos: 0.25 }, { mode: 'nonsense' }, c)).toEqual({ uPos: 0.25, uMode: 0 });
  });
});
