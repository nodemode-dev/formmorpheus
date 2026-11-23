import { describe, expect, it } from 'vitest';
import '@src/engine/fx/gradmap';
import { defaults, fx, run, uniformsOf } from '../../_support/F20';

const e = fx('gradmap');
const RAMP = { loR: 0, loG: 0, loB: 1, midR: 1, midG: 0, midB: 0, hiR: 0, hiG: 1, hiB: 0 };
const one = (px: number[], over: Record<string, number> = {}): number[] => run(e, px, 1, 1, defaults(e, { ...RAMP, ...over }));

describe('the gradient map effect', () => {
  it('is active only while the amount is above zero', () => {
    expect(e.active(defaults(e), {})).toBe(true);
    expect(e.active(defaults(e, { amount: 0 }), {})).toBe(false);
  });

  it('declares three colour channels per stop inside the unit range', () => {
    for (const stop of ['lo', 'mid', 'hi']) {
      for (const k of ['R', 'G', 'B']) {
        const q = e.params.find((x) => x.id === stop + k);
        expect(q?.min).toBe(0);
        expect(q?.max).toBe(1);
        expect(q?.def).toBeGreaterThanOrEqual(0);
        expect(q?.def).toBeLessThanOrEqual(1);
      }
    }
  });

  it('maps black to the shadow colour and white to the highlight colour', () => {
    expect(one([0, 0, 0, 255])).toEqual([0, 0, 255, 255]);
    expect(one([255, 255, 255, 255])).toEqual([0, 255, 0, 255]);
  });

  it('maps the midtone position to the midtone colour', () => {
    expect(one([51, 51, 51, 255], { midpos: 0.2 })).toEqual([255, 0, 0, 255]);
  });

  it('blends between two stops in proportion to brightness', () => {
    const out = one([64, 64, 64, 255]);
    expect(out[0]).toBeGreaterThanOrEqual(127);
    expect(out[0]).toBeLessThanOrEqual(129);
    expect(out[2]).toBeGreaterThanOrEqual(126);
    expect(out[2]).toBeLessThanOrEqual(128);
    expect(out[1]).toBe(0);
  });

  it('mixes with the original by the amount', () => {
    expect(one([255, 255, 255, 255], { amount: 0.5 })).toEqual([128, 255, 128, 255]);
    expect(one([10, 200, 30, 255], { amount: 0 })).toEqual([10, 200, 30, 255]);
  });

  it('sends everything below the black point to the shadow colour', () => {
    expect(one([100, 100, 100, 255], { black: 0.5 })).toEqual([0, 0, 255, 255]);
  });

  it('sends everything above the white point to the highlight colour', () => {
    expect(one([140, 140, 140, 255], { white: 0.5 })).toEqual([0, 255, 0, 255]);
  });

  it('stays a hard step when the white point is not above the black point', () => {
    const p = { black: 0.5, white: 0.2 };
    expect(one([100, 100, 100, 255], p)).toEqual([0, 0, 255, 255]);
    expect(one([200, 200, 200, 255], p)).toEqual([0, 255, 0, 255]);
  });

  it('keeps alpha and skips clear pixels', () => {
    expect(one([255, 255, 255, 77])[3]).toBe(77);
    expect(one([255, 255, 255, 0])).toEqual([0, 0, 0, 0]);
  });

  it('hands the shader the stops and a white point above the black point', () => {
    const u = uniformsOf(e, defaults(e, { ...RAMP, black: 0.5, white: 0.2 }));
    expect(u.uC0).toEqual([0, 0, 1]);
    expect(u.uC2).toEqual([0, 1, 0]);
    expect(u.uLo).toBe(0.5);
    expect(u.uHi).toBeCloseTo(0.501, 6);
  });
});
