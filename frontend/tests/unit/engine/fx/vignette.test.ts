import { describe, expect, it } from 'vitest';
import '@src/engine/fx/vignette';
import { effectOf, gpuSteps, type Effect, type FxCtx, type FxParams } from '@src/engine/fx/registry';

function vignette(): Effect {
  const e = effectOf('vignette');
  if (!e) throw new Error('vignette is not registered');
  return e;
}

const defaults = (): FxParams => Object.fromEntries(vignette().params.map((q) => [q.id, q.def]));

function flat(w: number, h: number, px: [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set(px, i);
  return d;
}

function run(src: Uint8ClampedArray, w: number, h: number, p: Partial<FxParams>, over: Partial<FxCtx> = {}): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(w * h * 4);
  vignette().cpu(src, dst, w, h, { ...defaults(), ...p } as FxParams, {}, { scale: 1, ox: 0, oy: 0, mw: w, mh: h, ...over }, { x0: 0, y0: 0, x1: w, y1: h });
  return dst;
}

const at = (d: Uint8ClampedArray, w: number, x: number, y: number): number[] => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('vignette', () => {
  it('is skipped when the amount is zero or negative', () => {
    expect(vignette().active({ ...defaults(), amount: 0 }, {})).toBe(false);
    expect(vignette().active({ ...defaults(), amount: -1 }, {})).toBe(false);
    expect(vignette().active(defaults(), {})).toBe(true);
  });

  it('darkens the corners more than the centre and keeps alpha', () => {
    const d = run(flat(8, 8, [255, 255, 255, 255]), 8, 8, {});
    const corner = at(d, 8, 0, 0), centre = at(d, 8, 3, 3);
    expect(corner[0]).toBeLessThan(centre[0]);
    expect(centre[0]).toBe(255);
    expect(corner[3]).toBe(255);
    expect(centre[3]).toBe(255);
  });

  it('is symmetric about the stage centre', () => {
    const d = run(flat(8, 6, [255, 255, 255, 255]), 8, 6, {});
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      expect(at(d, 8, x, y)).toEqual(at(d, 8, 7 - x, 5 - y));
    }
  });

  it('gets darker toward the edge along a row', () => {
    const d = run(flat(16, 2, [255, 255, 255, 255]), 16, 2, { size: 0, feather: 1 });
    for (let x = 8; x < 15; x++) expect(d[(x + 1) * 4]).toBeLessThanOrEqual(d[x * 4]);
    expect(d[15 * 4]).toBeLessThan(d[8 * 4]);
  });

  it('changes nothing when it starts beyond the corners', () => {
    const src = flat(4, 4, [200, 100, 50, 128]);
    expect(Array.from(run(src, 4, 4, { size: 1.2 }))).toEqual(Array.from(src));
  });

  it('paints the whole picture in the color at full strength with no feather', () => {
    const d = run(flat(4, 4, [255, 255, 255, 200]), 4, 4, { amount: 1, size: 0, feather: 0, colR: 1, colG: 0, colB: 0 });
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(at(d, 4, x, y)).toEqual([255, 0, 0, 200]);
  });

  it('treats an amount above one as one', () => {
    const p = { size: 0, feather: 0, colR: 0.5, colG: 0.5, colB: 0.5 };
    const full = run(flat(4, 4, [255, 255, 255, 255]), 4, 4, { ...p, amount: 1 });
    const over = run(flat(4, 4, [255, 255, 255, 255]), 4, 4, { ...p, amount: 5 });
    expect(Array.from(over)).toEqual(Array.from(full));
    expect(full[0]).toBeGreaterThan(120);
    expect(full[0]).toBeLessThan(135);
  });

  it('mixes halfway at half the amount', () => {
    const d = run(flat(4, 4, [200, 100, 0, 255]), 4, 4, { amount: 0.5, size: 0, feather: 0 });
    expect(at(d, 4, 0, 0)).toEqual([100, 50, 0, 255]);
  });

  it('leaves transparent pixels untouched', () => {
    const src = flat(4, 4, [255, 255, 255, 255]);
    src.set([90, 90, 90, 0], 0);
    const d = run(src, 4, 4, { amount: 1, size: 0, feather: 0 });
    expect(at(d, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(at(d, 4, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it('follows the stage when the view is moved and zoomed', () => {
    const base = run(flat(4, 4, [255, 255, 255, 255]), 4, 4, {});
    const moved = run(flat(12, 12, [255, 255, 255, 255]), 12, 12, {}, { ox: 2, oy: 2, mw: 4, mh: 4, scale: 2 });
    expect(at(moved, 12, 6, 6)[0]).toBe(255);
    expect(at(moved, 12, 2, 2)[0]).toBeLessThan(255);
    expect(at(moved, 12, 2, 2)).toEqual(at(moved, 12, 9, 9));
    expect(at(moved, 12, 2, 2)[0]).toBeLessThanOrEqual(at(base, 4, 0, 0)[0]);
  });

  it('reaches further into a wide stage when fully round', () => {
    const src = flat(16, 4, [255, 255, 255, 255]);
    const ellipse = run(src, 16, 4, { round: 0, size: 0.5, feather: 0.2 });
    const circle = run(src, 16, 4, { round: 1, size: 0.5, feather: 0.2 });
    const top = (d: Uint8ClampedArray): number => d[8 * 4];
    expect(top(circle)).toBeGreaterThanOrEqual(top(ellipse));
    expect(circle[0]).toBeLessThan(255);
  });

  it('sends the color and shape values to the shader', () => {
    const step = gpuSteps(vignette(), {}, {})[0];
    if (step.kind !== 'shader' || !step.uniforms) throw new Error('expected a shader step with uniforms');
    const u = step.uniforms({ amount: 0.4, size: 0.2, round: 0.1, feather: 0.6, colR: 1, colG: 0.5, colB: 0 }, {}, { scale: 1, ox: 0, oy: 0, mw: 4, mh: 4 });
    expect(u).toEqual({ uColor: [1, 0.5, 0], uAmount: 0.4, uStart: 0.2, uRound: 0.1, uFeather: 0.6 });
  });
});
