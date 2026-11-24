import { describe, expect, it } from 'vitest';
import {
  MAX_NODES, PenResponse, cleanPoints, curveAt, curveLut, curveValue, identityCurve, isIdentity, rollAmount, shapeLean,
} from '@src/paint/curves';
import type { Brush, PenCurves } from '@src/paint/types';

const brushWith = (curves?: PenCurves): Brush => ({ curves }) as unknown as Brush;

describe('cleanPoints', () => {
  it('pins the ends to the identity when only a middle node is given', () => {
    expect(cleanPoints([0.5, 0.25])).toEqual([0, 0, 0.5, 0.25, 1, 1]);
  });

  it('gives the identity ends for an empty list', () => {
    expect(cleanPoints([])).toEqual([0, 0, 1, 1]);
  });

  it('keeps the values given at both ends', () => {
    expect(cleanPoints([0, 0.2, 1, 0.8])).toEqual([0, 0.2, 1, 0.8]);
  });

  it('sorts nodes by x', () => {
    expect(cleanPoints([0.7, 0.1, 0.3, 0.9])).toEqual([0, 0, 0.3, 0.9, 0.7, 0.1, 1, 1]);
  });

  it('clamps values into 0 to 1', () => {
    expect(cleanPoints([0.5, 4, 0.25, -3])).toEqual([0, 0, 0.25, 0, 0.5, 1, 1, 1]);
  });

  it('drops nodes that are not finite and a trailing lone number', () => {
    expect(cleanPoints([Number.NaN, 0.5, 0.4, Number.POSITIVE_INFINITY, 0.6, 0.6, 0.9])).toEqual([0, 0, 0.6, 0.6, 1, 1]);
  });

  it('drops a node that sits within a hundredth of the one before it', () => {
    expect(cleanPoints([0.5, 0.2, 0.505, 0.9])).toEqual([0, 0, 0.5, 0.2, 1, 1]);
  });

  it('keeps at most the allowed number of middle nodes', () => {
    const pts: number[] = [];
    for (let i = 1; i <= 9; i++) pts.push(i / 10, i / 10);
    const out = cleanPoints(pts);
    expect(out.length).toBe((MAX_NODES + 2) * 2);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).toEqual([1, 1]);
    for (let i = 2; i < out.length; i += 2) expect(out[i]).toBeGreaterThan(out[i - 2]);
  });
});

describe('isIdentity', () => {
  it('treats a missing curve and the identity curve as identity', () => {
    expect(isIdentity(undefined)).toBe(true);
    expect(isIdentity(identityCurve())).toBe(true);
    expect(isIdentity({ pts: [0, 0, 1, 1], speed: 1 })).toBe(true);
  });

  it('is false for a straight curve with a slow response', () => {
    expect(isIdentity({ pts: [0, 0, 1, 1], speed: 0.5 })).toBe(false);
  });

  it('is false when a node or an end moves', () => {
    expect(isIdentity({ pts: [0, 0, 0.5, 0.5, 1, 1] })).toBe(false);
    expect(isIdentity({ pts: [0, 0.1, 1, 1] })).toBe(false);
  });
});

describe('curveLut and curveAt', () => {
  it('builds a straight table for the identity curve', () => {
    const lut = curveLut(identityCurve());
    expect(lut.length).toBe(257);
    for (let k = 0; k <= 256; k += 16) expect(lut[k]).toBeCloseTo(k / 256, 6);
  });

  it('passes through its nodes', () => {
    const c = { pts: [0, 0.1, 0.25, 0.6, 0.75, 0.7, 1, 0.9] };
    expect(curveValue(c, 0)).toBeCloseTo(0.1, 5);
    expect(curveValue(c, 0.25)).toBeCloseTo(0.6, 5);
    expect(curveValue(c, 0.75)).toBeCloseTo(0.7, 5);
    expect(curveValue(c, 1)).toBeCloseTo(0.9, 5);
  });

  it('never overshoots between rising nodes', () => {
    const lut = curveLut({ pts: [0, 0, 0.1, 0.9, 0.9, 0.95, 1, 1] });
    for (let k = 1; k <= 256; k++) expect(lut[k]).toBeGreaterThanOrEqual(lut[k - 1] - 1e-6);
  });

  it('stays flat across a plateau', () => {
    const c = { pts: [0, 0, 0.3, 0.5, 0.7, 0.5, 1, 1] };
    expect(curveValue(c, 0.4)).toBeCloseTo(0.5, 5);
    expect(curveValue(c, 0.5)).toBeCloseTo(0.5, 5);
    expect(curveValue(c, 0.6)).toBeCloseTo(0.5, 5);
  });

  it('keeps every entry inside 0 to 1', () => {
    const lut = curveLut({ pts: [0, 1, 0.5, 0, 1, 1] });
    for (const v of lut) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('returns the cached table until the points change', () => {
    const c = { pts: [0, 0, 0.5, 0.8, 1, 1] };
    const a = curveLut(c);
    expect(curveLut(c)).toBe(a);
    c.pts[3] = 0.2;
    const b = curveLut(c);
    expect(b).not.toBe(a);
    expect(curveAt(b, 0.5)).toBeCloseTo(0.2, 5);
  });

  it('clamps the input below 0 and above 1', () => {
    const lut = curveLut({ pts: [0, 0.2, 1, 0.8] });
    expect(curveAt(lut, -5)).toBeCloseTo(0.2, 6);
    expect(curveAt(lut, 7)).toBeCloseTo(0.8, 6);
  });

  it('interpolates between table entries', () => {
    const lut = new Float32Array(257);
    lut[10] = 0.25; lut[11] = 0.75;
    expect(curveAt(lut, 10.5 / 256)).toBeCloseTo(0.5, 6);
  });

  it('inverts with a falling line', () => {
    expect(curveValue({ pts: [0, 1, 1, 0] }, 0.3)).toBeCloseTo(0.7, 5);
  });

  it('returns the input when there is no curve', () => {
    expect(curveValue(undefined, 0.37)).toBe(0.37);
    expect(curveValue(undefined, 1.5)).toBe(1.5);
  });
});

describe('shapeLean', () => {
  it('returns the lean unchanged without a tilt curve', () => {
    expect(shapeLean(brushWith(), 0.42)).toBe(0.42);
    expect(shapeLean(brushWith({ size: { pts: [0, 1, 1, 0] } }), 0.42)).toBe(0.42);
  });

  it('reshapes the lean through the tilt curve', () => {
    expect(shapeLean(brushWith({ tilt: { pts: [0, 0.5, 1, 1] } }), 0)).toBeCloseTo(0.5, 5);
    expect(shapeLean(brushWith({ tilt: { pts: [0, 0.5, 1, 1] } }), 0.5)).toBeCloseTo(0.75, 5);
  });
});

describe('rollAmount', () => {
  it('is 0 at no twist, 1 at a half turn and a half at a quarter turn', () => {
    expect(rollAmount(0, null, false)).toBeCloseTo(0, 10);
    expect(rollAmount(180, null, false)).toBeCloseTo(1, 10);
    expect(rollAmount(90, null, false)).toBeCloseTo(0.5, 10);
    expect(rollAmount(360, null, false)).toBeCloseTo(0, 10);
  });

  it('is symmetric around zero twist', () => {
    expect(rollAmount(-70, null, false)).toBeCloseTo(rollAmount(70, null, false), 10);
  });

  it('measures against the stroke direction when relative', () => {
    expect(rollAmount(90, Math.PI / 2, true)).toBeCloseTo(0, 10);
    expect(rollAmount(0, Math.PI, true)).toBeCloseTo(1, 10);
  });

  it('ignores the direction when not relative or when there is none', () => {
    expect(rollAmount(90, Math.PI / 2, false)).toBeCloseTo(0.5, 10);
    expect(rollAmount(90, null, true)).toBeCloseTo(0.5, 10);
  });
});

describe('PenResponse', () => {
  it('is not wanted without curves or with identity curves only', () => {
    expect(PenResponse.wanted(brushWith())).toBe(false);
    expect(PenResponse.wanted(brushWith({ size: identityCurve(), tilt: { pts: [0, 1, 1, 0] } }))).toBe(false);
  });

  it('is wanted for a shaped curve or a slow response', () => {
    expect(PenResponse.wanted(brushWith({ flow: { pts: [0, 0.5, 1, 1] } }))).toBe(true);
    expect(PenResponse.wanted(brushWith({ roundness: { pts: [0, 0, 1, 1], speed: 0.3 } }))).toBe(true);
  });

  it('passes pressure straight through with no curves', () => {
    const r = new PenResponse(brushWith());
    r.update(0.3, 1, 10);
    expect(r.size).toBeCloseTo(0.3, 6);
    expect(r.opacity).toBeCloseTo(0.3, 6);
    expect(r.flow).toBeCloseTo(0.3, 6);
    expect(r.bleed).toBeCloseTo(0.3, 6);
    expect(r.round).toBeCloseTo(0.3, 6);
  });

  it('runs each channel through its own curve', () => {
    const r = new PenResponse(brushWith({ size: { pts: [0, 1, 1, 0] }, bleed: { pts: [0, 0.5, 1, 0.5] } }));
    r.update(0.2, 1, 10);
    expect(r.size).toBeCloseTo(0.8, 5);
    expect(r.bleed).toBeCloseTo(0.5, 5);
    expect(r.opacity).toBeCloseTo(0.2, 6);
  });

  it('takes the first pressure at once even with a slow response', () => {
    const r = new PenResponse(brushWith({ opacity: { pts: [0, 0, 1, 1], speed: 0 } }));
    r.update(0.6, 1, 10);
    expect(r.opacity).toBeCloseTo(0.6, 6);
  });

  it('eases a slow channel toward the new pressure by distance travelled', () => {
    const r = new PenResponse(brushWith({ opacity: { pts: [0, 0, 1, 1], speed: 0 } }));
    r.update(0, 1, 10);
    r.update(1, 80, 10);
    expect(r.opacity).toBeCloseTo(1 - Math.exp(-1), 5);
    expect(r.size).toBeCloseTo(1, 6);
    r.update(1, 80, 10);
    expect(r.opacity).toBeCloseTo(1 - Math.exp(-2), 5);
  });

  it('uses a floor of 4 for the dab size and of a half for the step', () => {
    const r = new PenResponse(brushWith({ flow: { pts: [0, 0, 1, 1], speed: 0 } }));
    r.update(0, 0, 1);
    r.update(1, 0, 1);
    expect(r.flow).toBeCloseTo(1 - Math.exp(-0.5 / 32), 5);
  });

  it('clamps a response speed outside 0 to 1', () => {
    const fast = new PenResponse(brushWith({ size: { pts: [0, 0, 1, 1], speed: 9 } }));
    fast.update(0, 1, 10);
    fast.update(1, 1, 10);
    expect(fast.size).toBeCloseTo(1, 6);
    const slow = new PenResponse(brushWith({ size: { pts: [0, 0, 1, 1], speed: -4 } }));
    slow.update(0, 1, 10);
    slow.update(1, 80, 10);
    expect(slow.size).toBeCloseTo(1 - Math.exp(-1), 5);
  });
});
