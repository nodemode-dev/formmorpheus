import { describe, expect, it } from 'vitest';
import '@src/engine/fx/hueshift';
import { defaults, fx, run, uniformsOf } from '../../_support/F20';

const e = fx('hueshift');
const one = (px: number[], over: Record<string, number> = {}): number[] => run(e, px, 1, 1, defaults(e, over));

describe('the hue range shift effect', () => {
  it('is active only while it shifts hue or changes saturation', () => {
    expect(e.active(defaults(e), {})).toBe(true);
    expect(e.active(defaults(e, { shift: 0 }), {})).toBe(false);
    expect(e.active(defaults(e, { shift: 0, sat: -0.2 }), {})).toBe(true);
    expect(e.pad(defaults(e), {}, { scale: 1, ox: 0, oy: 0, mw: 4, mh: 4 })).toBe(0);
  });

  it('turns a colour at the band centre by the full shift', () => {
    expect(one([0, 255, 0, 255])).toEqual([255, 128, 0, 255]);
    expect(one([0, 255, 0, 255], { shift: 120 })).toEqual([0, 0, 255, 255]);
  });

  it('leaves colours outside the band alone', () => {
    expect(one([255, 0, 0, 255])).toEqual([255, 0, 0, 255]);
    expect(one([0, 0, 255, 200])).toEqual([0, 0, 255, 200]);
  });

  it('turns a colour on the soft edge by part of the shift', () => {
    expect(one([255, 255, 0, 255])).toEqual([255, 64, 0, 255]);
  });

  it('wraps the band around zero degrees', () => {
    expect(one([255, 0, 0, 255], { center: 350, shift: 120 })).toEqual([0, 255, 0, 255]);
  });

  it('returns to the same colour after a full turn', () => {
    expect(one([0, 255, 0, 255], { shift: 360 })).toEqual([0, 255, 0, 255]);
    expect(one([0, 255, 0, 255], { shift: -360 })).toEqual([0, 255, 0, 255]);
  });

  it('never changes a grey', () => {
    expect(one([90, 90, 90, 255], { width: 360, shift: 77, sat: 1 })).toEqual([90, 90, 90, 255]);
  });

  it('drains the band to grey at saturation minus one and keeps the rest vivid', () => {
    expect(one([0, 255, 0, 255], { shift: 0, sat: -1 })).toEqual([255, 255, 255, 255]);
    expect(one([255, 0, 0, 255], { shift: 0, sat: -1 })).toEqual([255, 0, 0, 255]);
  });

  it('doubles a muted saturation and stops at full', () => {
    const out = one([128, 255, 128, 255], { shift: 0, sat: 1 });
    expect(out[1]).toBe(255);
    expect(out[0]).toBeLessThanOrEqual(2);
    expect(out[2]).toBeLessThanOrEqual(2);
    expect(one([0, 255, 0, 255], { shift: 0, sat: 1 })).toEqual([0, 255, 0, 255]);
  });

  it('keeps alpha and skips clear pixels', () => {
    expect(one([0, 255, 0, 40])[3]).toBe(40);
    expect(one([0, 255, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it('writes only inside the box', () => {
    const g = [0, 255, 0, 255];
    const out = run(e, [...g, ...g], 2, 1, defaults(e), {}, { x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(out).toEqual([255, 128, 0, 255, 0, 0, 0, 0]);
  });

  it('hands the shader the band and the shift', () => {
    expect(uniformsOf(e, defaults(e))).toEqual({ uCen: 120, uWid: 80, uSoft: 40, uShift: -90, uSat: 0 });
  });
});
