import { describe, expect, it } from 'vitest';
import { duckProbe, reductionAt } from '@src/media/duck-meter';

const curve = Float32Array.from([1, 0.5, 0.1, 0, 2]);

describe('reductionAt', () => {
  it('reads the gain reduction in decibels relative to the start of the curve', () => {
    expect(reductionAt(curve, 100, 100)).toBe(0);
    expect(reductionAt(curve, 100, 101)).toBeCloseTo(-6.0206, 3);
    expect(reductionAt(curve, 100, 102)).toBeCloseTo(-20, 4);
  });

  it('floors a silent gain at minus sixty decibels', () => {
    expect(reductionAt(curve, 100, 103)).toBe(-60);
  });

  it('never reports a boost', () => {
    expect(reductionAt(curve, 100, 104)).toBe(0);
  });

  it('rounds the position to the nearest sample', () => {
    expect(reductionAt(curve, 100, 101.4)).toBeCloseTo(-6.0206, 3);
    expect(reductionAt(curve, 100, 101.6)).toBeCloseTo(-20, 4);
  });

  it('is null before and past the curve', () => {
    expect(reductionAt(curve, 100, 99)).toBeNull();
    expect(reductionAt(curve, 100, 105)).toBeNull();
    expect(reductionAt(new Float32Array(0), 0, 0)).toBeNull();
  });

  it('has no reader until the engine installs one', () => {
    expect(duckProbe.read).toBeNull();
  });
});
