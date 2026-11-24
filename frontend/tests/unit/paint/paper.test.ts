import { describe, expect, it } from 'vitest';
import { paperMap } from '@src/paint/paper';

describe('paperMap', () => {
  const m = paperMap();

  it('is a 512 by 512 map made once', () => {
    expect(m).toHaveLength(512 * 512);
    expect(paperMap()).toBe(m);
  });

  it('stays within 0 and 1 and uses most of that range', () => {
    let lo = Infinity, hi = -Infinity, total = 0;
    for (let i = 0; i < m.length; i++) { const v = m[i]; if (v < lo) lo = v; if (v > hi) hi = v; total += v; }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.6);
    expect(Math.abs(total / m.length - 0.5)).toBeLessThan(0.1);
  });

  it('wraps without a seam on both axes', () => {
    const jump = (a: number, b: number): number => Math.abs(m[a] - m[b]);
    let inside = 0, seamX = 0, seamY = 0;
    for (let k = 0; k < 512; k++) {
      inside += jump((k << 9) | 200, (k << 9) | 201);
      seamX += jump((k << 9) | 511, k << 9);
      seamY += jump((511 << 9) | k, k);
    }
    expect(seamX).toBeLessThan(inside * 2);
    expect(seamY).toBeLessThan(inside * 2);
  });

  it('is not a flat field', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 4096; i++) seen.add(Math.round(m[i * 61] * 50));
    expect(seen.size).toBeGreaterThan(20);
  });
});
