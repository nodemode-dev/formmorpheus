import { describe, expect, it } from 'vitest';
import '@src/engine/fx/gblur';
import { ctx, defaults, fx, run, uniformsOf } from '../../_support/F20';

const e = fx('gblur');
const W = 9, H = 9;
const dot = (): number[] => {
  const px = new Array<number>(W * H * 4).fill(0);
  px.splice((4 * W + 4) * 4, 4, 255, 0, 255, 255);
  return px;
};
const a = (out: number[], x: number, y: number): number => out[(y * W + x) * 4 + 3];

describe('the gaussian blur effect', () => {
  it('is active when either radius is above zero', () => {
    expect(e.active({ x: 0, y: 0 }, {})).toBe(false);
    expect(e.active({ x: 2, y: 0 }, {})).toBe(true);
    expect(e.active({ x: 0, y: 2 }, {})).toBe(true);
    expect(e.active(defaults(e), {})).toBe(true);
  });

  it('pads by three deviations of the larger radius in surface pixels', () => {
    expect(e.pad({ x: 4, y: 1 }, {}, ctx(8, 8))).toBe(13);
    expect(e.pad({ x: 1, y: 4 }, {}, ctx(8, 8, 2))).toBe(25);
    expect(e.pad({ x: 0, y: 0 }, {}, ctx(8, 8))).toBe(1);
  });

  it('copies the picture when both radii are zero', () => {
    expect(run(e, dot(), W, H, { x: 0, y: 0 })).toEqual(dot());
  });

  it('spreads along the row only for a horizontal radius', () => {
    const out = run(e, dot(), W, H, { x: 1, y: 0 });
    expect(a(out, 4, 4)).toBeLessThan(255);
    expect(a(out, 3, 4)).toBeGreaterThan(0);
    expect(a(out, 3, 4)).toBe(a(out, 5, 4));
    expect(a(out, 4, 4)).toBeGreaterThan(a(out, 3, 4));
    expect(a(out, 3, 4)).toBeGreaterThan(a(out, 2, 4));
    expect(a(out, 4, 3)).toBe(0);
    expect(a(out, 4, 5)).toBe(0);
  });

  it('spreads along the column only for a vertical radius', () => {
    const out = run(e, dot(), W, H, { x: 0, y: 1 });
    expect(a(out, 4, 3)).toBeGreaterThan(0);
    expect(a(out, 4, 3)).toBe(a(out, 4, 5));
    expect(a(out, 3, 4)).toBe(0);
  });

  it('keeps the amount of ink when the blur stays inside the picture', () => {
    const out = run(e, dot(), W, H, { x: 1, y: 0 });
    let sum = 0;
    for (let x = 0; x < W; x++) sum += a(out, x, 4);
    expect(Math.abs(sum - 255)).toBeLessThanOrEqual(4);
  });

  it('keeps the colour of the ink while it thins out', () => {
    const out = run(e, dot(), W, H, { x: 1, y: 1 });
    const i = (4 * W + 3) * 4;
    expect(out.slice(i, i + 3)).toEqual([255, 0, 255]);
  });

  it('fades an opaque picture toward its border because outside counts as clear', () => {
    const px = new Array<number>(W * H * 4).fill(255);
    const out = run(e, px, W, H, { x: 1, y: 0 });
    expect(a(out, 4, 4)).toBe(255);
    expect(a(out, 0, 4)).toBeLessThan(200);
    expect(a(out, 0, 4)).toBe(a(out, W - 1, 4));
  });

  it('blurs wider at a larger surface scale', () => {
    const one = run(e, dot(), W, H, { x: 0.5, y: 0 }, {}, undefined, ctx(W, H, 1));
    const two = run(e, dot(), W, H, { x: 0.5, y: 0 }, {}, undefined, ctx(W, H, 2));
    expect(a(two, 4, 4)).toBeLessThan(a(one, 4, 4));
  });

  it('hands each pass its own deviation and never a negative one', () => {
    expect(uniformsOf(e, { x: 3, y: 5 }, {}, ctx(8, 8, 2), 0)).toEqual({ uSig: 6 });
    expect(uniformsOf(e, { x: 3, y: 5 }, {}, ctx(8, 8, 2), 1)).toEqual({ uSig: 10 });
    expect(uniformsOf(e, { x: -3, y: 0 }, {}, ctx(8, 8), 0)).toEqual({ uSig: 0 });
  });
});
