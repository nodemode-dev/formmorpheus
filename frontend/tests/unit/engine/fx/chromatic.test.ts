import { describe, expect, it } from 'vitest';
import '@src/engine/fx/chromatic';
import { ctx, defaults, fx, run, uniformsOf } from '../../_support/F20';

const e = fx('chromatic');
const W = 5;
const stripe = (x: number): number[] => {
  const px = new Array<number>(W * 4).fill(0);
  px.splice(x * 4, 4, 255, 255, 255, 255);
  return px;
};
const at = (out: number[], x: number): number[] => out.slice(x * 4, x * 4 + 4);

describe('the chromatic aberration effect', () => {
  it('is active only above zero and pads by the amount in surface pixels', () => {
    expect(e.active(defaults(e), {})).toBe(true);
    expect(e.active({ amount: 0 }, {})).toBe(false);
    expect(e.pad({ amount: 2.2 }, {}, ctx(8, 8, 2))).toBe(5);
    expect(uniformsOf(e, { amount: 3 }, {}, ctx(8, 8, 2))).toEqual({ uAmt: 6 });
  });

  it('leaves a flat opaque picture unchanged', () => {
    const px = new Array<number>(W * 3 * 4).fill(0).map((_, i) => [40, 90, 200, 255][i % 4]);
    expect(run(e, px, W, 3, { amount: 6 })).toEqual(px);
  });

  it('leaves the pixel at the centre of the stage unchanged', () => {
    expect(at(run(e, stripe(2), W, 1, { amount: 3 }), 2)).toEqual([255, 255, 255, 255]);
  });

  it('pulls red from further out and blue from further in', () => {
    const outer = run(e, stripe(4), W, 1, { amount: 3 });
    expect(at(outer, 3)).toEqual([255, 0, 0, 255]);
    const inner = run(e, stripe(2), W, 1, { amount: 3 });
    expect(at(inner, 4)).toEqual([0, 0, 255, 255]);
  });

  it('writes nothing where all three samples are clear', () => {
    expect(at(run(e, stripe(4), W, 1, { amount: 3 }), 0)).toEqual([0, 0, 0, 0]);
  });

  it('copies the picture when the amount is zero', () => {
    const px = [10, 20, 30, 255, 200, 150, 100, 128, 0, 0, 0, 0, 1, 2, 3, 255, 9, 9, 9, 9];
    const out = run(e, px, W, 1, { amount: 0 });
    expect(at(out, 0)).toEqual([10, 20, 30, 255]);
    expect(at(out, 1)).toEqual([200, 150, 100, 128]);
    expect(at(out, 2)).toEqual([0, 0, 0, 0]);
  });
});
