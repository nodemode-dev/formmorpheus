import { describe, expect, it } from 'vitest';
import { buildTable, CURVE_IDS, curveAtFrame, curvePointId, parseCurve, TABLE_N } from '@src/engine/fx/colorcorrect';
import { defaults, fx, run, uniformsOf } from '../../_support/F20';

const e = fx('colorcorrect');
const at = (t: Float32Array, x: number, c: number): number => t[Math.round(x * (TABLE_N - 1)) * 4 + c];

describe('parseCurve', () => {
  it('reads nothing from a value that is not a curve string', () => {
    expect(parseCurve(undefined)).toBeNull();
    expect(parseCurve(12)).toBeNull();
    expect(parseCurve('')).toBeNull();
    expect(parseCurve('0,0')).toBeNull();
    expect(parseCurve('0,0,x,1')).toBeNull();
  });

  it('reads the straight line as no curve', () => {
    expect(parseCurve('0,0,1,1')).toBeNull();
  });

  it('keeps a bent curve as points', () => {
    expect(parseCurve('0,0,0.5,0.8,1,1')).toEqual([0, 0, 0.5, 0.8, 1, 1]);
  });

  it('clamps points into the unit square', () => {
    expect(parseCurve('0,0,0.5,2,1,1')).toEqual([0, 0, 0.5, 1, 1, 1]);
  });
});

describe('curveAtFrame', () => {
  it('names a point channel after its curve and index', () => {
    expect(curvePointId('G', 3)).toBe('cvG3');
  });

  it('returns the saved curve when no point is keyed', () => {
    expect(curveAtFrame('L', defaults(e), { curveL: '0,0,0.5,0.8,1,1' })).toEqual([0, 0, 0.5, 0.8, 1, 1]);
    expect(curveAtFrame('L', defaults(e), {})).toBeNull();
  });

  it('moves a point of the straight line by its keyed offset', () => {
    expect(curveAtFrame('R', defaults(e, { cvR1: -0.5 }), {})).toEqual([0, 0, 1, 0.5]);
  });

  it('lays offsets onto the saved curve of that channel only', () => {
    const p = defaults(e, { cvL1: -0.25 });
    expect(curveAtFrame('L', p, { curveL: '0,0,0.5,0.75,1,1' })).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    expect(curveAtFrame('G', p, {})).toBeNull();
  });

  it('reports the straight line when an offset undoes the saved bend', () => {
    expect(curveAtFrame('L', defaults(e, { cvL0: -0.5 }), { curveL: '0,0.5,1,1' })).toBeNull();
  });
});

describe('buildTable', () => {
  it('is the identity at the defaults', () => {
    const t = buildTable(defaults(e), {});
    expect(t.length).toBe(TABLE_N * 4);
    for (const x of [0, 0.25, 0.5, 1]) for (let c = 0; c < 3; c++) expect(at(t, x, c)).toBeCloseTo(Math.round(x * (TABLE_N - 1)) / (TABLE_N - 1), 5);
  });

  it('reverses the ramp when the output levels are swapped', () => {
    const t = buildTable(defaults(e, { lvOut0: 1, lvOut1: 0 }), {});
    expect(at(t, 0, 0)).toBeCloseTo(1, 5);
    expect(at(t, 1, 2)).toBeCloseTo(0, 5);
  });

  it('lifts the midtones with a gamma above one', () => {
    const t = buildTable(defaults(e, { lvGamma: 2 }), {});
    expect(at(t, 0.5, 1)).toBeCloseTo(Math.sqrt(511 / 1023 + 1 / 2046), 2);
    expect(at(t, 0, 1)).toBe(0);
    expect(at(t, 1, 1)).toBeCloseTo(1, 5);
  });

  it('crushes everything below the input black point', () => {
    const t = buildTable(defaults(e, { lvIn0: 0.5 }), {});
    expect(at(t, 0.25, 0)).toBe(0);
    expect(at(t, 0.75, 0)).toBeCloseTo(0.5, 2);
  });

  it('stays finite when the input white is below the input black', () => {
    const t = buildTable(defaults(e, { lvIn0: 0.6, lvIn1: 0.2 }), {});
    expect(t.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(at(t, 0.5, 0)).toBe(0);
    expect(at(t, 0.9, 0)).toBeCloseTo(1, 5);
  });

  it('applies a channel level to that channel only', () => {
    const t = buildTable(defaults(e, { rOut1: 0.5 }), {});
    expect(at(t, 1, 0)).toBeCloseTo(0.5, 5);
    expect(at(t, 1, 1)).toBeCloseTo(1, 5);
    expect(at(t, 1, 2)).toBeCloseTo(1, 5);
  });

  it('bends every channel with the master curve and one channel with its own', () => {
    const master = buildTable(defaults(e), { curveL: '0,0,0.5,0.8,1,1' });
    for (let c = 0; c < 3; c++) expect(at(master, 0.5, c)).toBeCloseTo(0.8, 2);
    const blue = buildTable(defaults(e), { curveB: '0,0,0.5,0.2,1,1' });
    expect(at(blue, 0.5, 2)).toBeCloseTo(0.2, 2);
    expect(at(blue, 0.5, 0)).toBeCloseTo(0.5, 2);
  });

  it('ignores the curves when the curve mix is zero and halves them at one half', () => {
    const o = { curveL: '0,0,0.5,0.8,1,1' };
    expect(at(buildTable(defaults(e, { curveMix: 0 }), o), 0.5, 0)).toBeCloseTo(0.5, 2);
    expect(at(buildTable(defaults(e, { curveMix: 0.5 }), o), 0.5, 0)).toBeCloseTo(0.65, 2);
  });
});

describe('the color correction effect', () => {
  it('declares one hidden curve option per curve', () => {
    expect((e.options ?? []).map((q) => q.id)).toEqual(CURVE_IDS.map((id) => 'curve' + id));
    expect((e.options ?? []).every((q) => q.hidden === true)).toBe(true);
  });

  it('keeps every default inside its own range', () => {
    for (const q of e.params) {
      expect(q.def).toBeGreaterThanOrEqual(q.min);
      expect(q.def).toBeLessThanOrEqual(q.max);
    }
    expect(new Set(e.params.map((q) => q.id)).size).toBe(e.params.length);
  });

  it('is inactive at the defaults and active once anything moves', () => {
    expect(e.active(defaults(e), {})).toBe(false);
    expect(e.active(defaults(e, { exposure: 0.1 }), {})).toBe(true);
    expect(e.active(defaults(e, { gGamma: 1.2 }), {})).toBe(true);
    expect(e.active(defaults(e, { hB: -0.3 }), {})).toBe(true);
    expect(e.active(defaults(e, { cvL1: -0.2 }), {})).toBe(true);
  });

  it('counts a saved curve as active only while the curve mix is above zero', () => {
    const o = { curveR: '0,0,0.5,0.8,1,1' };
    expect(e.active(defaults(e), o)).toBe(true);
    expect(e.active(defaults(e, { curveMix: 0 }), o)).toBe(false);
  });

  it('passes pixels through unchanged at the defaults', () => {
    const px = [10, 128, 250, 200, 0, 255, 77, 255];
    expect(run(e, px, 2, 1, defaults(e))).toEqual(px);
  });

  it('skips fully transparent pixels', () => {
    expect(run(e, [200, 100, 50, 0], 1, 1, defaults(e, { exposure: 1 }))).toEqual([0, 0, 0, 0]);
  });

  it('doubles the light per stop of exposure and clamps at white', () => {
    expect(run(e, [60, 30, 200, 255], 1, 1, defaults(e, { exposure: 1 }))).toEqual([120, 60, 255, 255]);
  });

  it('warms with temperature and shifts green with tint', () => {
    const warm = run(e, [100, 100, 100, 255], 1, 1, defaults(e, { temp: 1 }));
    expect(warm).toEqual([125, 100, 75, 255]);
    const tint = run(e, [100, 100, 100, 255], 1, 1, defaults(e, { tint: 1 }));
    expect(tint).toEqual([100, 75, 100, 255]);
  });

  it('drains all colour at vibrance minus one', () => {
    expect(run(e, [255, 0, 0, 255], 1, 1, defaults(e, { vibrance: -1 }))).toEqual([54, 54, 54, 255]);
  });

  it('boosts a muted colour more than a vivid one with positive vibrance', () => {
    const muted = run(e, [140, 120, 120, 255], 1, 1, defaults(e, { vibrance: 1 }));
    expect(muted[0] - muted[1]).toBeGreaterThan(30);
    expect(run(e, [255, 0, 0, 255], 1, 1, defaults(e, { vibrance: 1 }))).toEqual([255, 0, 0, 255]);
  });

  it('tints shadows without touching white', () => {
    const out = run(e, [0, 0, 0, 255, 255, 255, 255, 255], 2, 1, defaults(e, { sR: 1 }));
    expect(out[0]).toBeGreaterThanOrEqual(127);
    expect(out[0]).toBeLessThanOrEqual(128);
    expect(out.slice(1, 4)).toEqual([0, 0, 255]);
    expect(out.slice(4)).toEqual([255, 255, 255, 255]);
  });

  it('writes only inside the box', () => {
    const out = run(e, [50, 50, 50, 255, 50, 50, 50, 255], 2, 1, defaults(e, { exposure: 1 }), {}, { x0: 1, y0: 0, x1: 2, y1: 1 });
    expect(out).toEqual([0, 0, 0, 0, 100, 100, 100, 255]);
  });

  it('hands the shader the same gains the pixel path uses', () => {
    const u = uniformsOf(e, defaults(e, { exposure: 1, temp: 1, tint: -1, vibrance: 0.3 }));
    expect(u.uGain).toEqual([2.5, 2.5, 1.5]);
    expect(u.uVib).toBe(0.3);
  });
});
