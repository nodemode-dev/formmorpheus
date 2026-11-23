import { describe, expect, it } from 'vitest';
import { shakeAt } from '@src/engine/camera-shake';

describe('shakeAt', () => {
  it('is still when the amplitude or the frequency is not positive', () => {
    const rest = { dx: 0, dy: 0, rot: 0 };
    expect(shakeAt({ amp: 0, freq: 2, seed: 1 }, 10, 24)).toEqual(rest);
    expect(shakeAt({ amp: 5, freq: 0, seed: 1 }, 10, 24)).toEqual(rest);
    expect(shakeAt({ amp: -5, freq: 2, seed: 1 }, 10, 24)).toEqual(rest);
    expect(shakeAt({ amp: Number.NaN, freq: 2, seed: 1 }, 10, 24)).toEqual(rest);
  });

  it('gives the same offset for the same frame every time', () => {
    const s = { amp: 12, freq: 1.5, seed: 42 };
    const first = shakeAt(s, 37, 24);
    shakeAt({ ...s, seed: 7 }, 3, 24);
    expect(shakeAt({ ...s }, 37, 24)).toEqual(first);
  });

  it('stays within the amplitude on every frame', () => {
    const s = { amp: 8, freq: 3, seed: 5 };
    for (let f = 0; f < 500; f++) {
      const o = shakeAt(s, f, 30);
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(8 + 1e-9);
      expect(Math.abs(o.dy)).toBeLessThanOrEqual(8 + 1e-9);
      expect(Math.abs(o.rot)).toBeLessThanOrEqual(8 * 0.02 + 1e-9);
    }
  });

  it('scales linearly with the amplitude', () => {
    const a = shakeAt({ amp: 1, freq: 2, seed: 9 }, 11, 24);
    const b = shakeAt({ amp: 10, freq: 2, seed: 9 }, 11, 24);
    expect(b.dx).toBeCloseTo(a.dx * 10, 10);
    expect(b.dy).toBeCloseTo(a.dy * 10, 10);
    expect(b.rot).toBeCloseTo(a.rot * 10, 10);
  });

  it('moves differently for another seed and actually moves over time', () => {
    const a = shakeAt({ amp: 10, freq: 2, seed: 1 }, 5, 24);
    const b = shakeAt({ amp: 10, freq: 2, seed: 2 }, 5, 24);
    const later = shakeAt({ amp: 10, freq: 2, seed: 1 }, 9, 24);
    expect(a.dx).not.toBeCloseTo(b.dx, 6);
    expect(a.dx).not.toBeCloseTo(later.dx, 6);
  });

  it('repeats every second when the frequency is a multiple of ten', () => {
    const s = { amp: 10, freq: 10, seed: 3 };
    const a = shakeAt(s, 0, 24), b = shakeAt(s, 24, 24);
    expect(b.dx).toBeCloseTo(a.dx, 6);
    expect(b.dy).toBeCloseTo(a.dy, 6);
    expect(b.rot).toBeCloseTo(a.rot, 6);
  });

  it('treats a frame rate below one as one', () => {
    const s = { amp: 10, freq: 0.3, seed: 3 };
    expect(shakeAt(s, 7, 0)).toEqual(shakeAt(s, 7, 1));
  });
});
