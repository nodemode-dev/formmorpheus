import { describe, expect, it } from 'vitest';
import { swathCorner, swathGrid } from '@src/paint/fam-dry';

describe('swathCorner', () => {
  it('keeps the middle and the axis ends inside the outline', () => {
    expect(swathCorner(0, 0, 10, 4)).toBe(false);
    expect(swathCorner(5, 0, 10, 4)).toBe(false);
    expect(swathCorner(0, 2, 10, 4)).toBe(false);
  });

  it('cuts the grid corners off', () => {
    expect(swathCorner(5, 2, 10, 4)).toBe(true);
    expect(swathCorner(-5, -2, 10, 4)).toBe(true);
  });

  it('cuts nothing from a swath without a span', () => {
    expect(swathCorner(5, 2, 0, 4)).toBe(false);
    expect(swathCorner(5, 2, 10, -1)).toBe(false);
  });
});

describe('swathGrid', () => {
  it('lays at least two stamps along and one across', () => {
    const g = swathGrid(0, 0, 10);
    expect(g.nA).toBe(2);
    expect(g.nB).toBe(1);
  });

  it('spaces the stamps closer than their diameter', () => {
    const g = swathGrid(40, 20, 10);
    expect(g.nA).toBe(Math.ceil(40 / 3.6) + 1);
    expect(g.nB).toBe(Math.ceil(20 / 3.6) + 1);
    expect(40 / (g.nA - 1)).toBeLessThan(10);
  });

  it('bounds the stamp count of a very wide swath without opening gaps', () => {
    const d0 = 4;
    const tight = (Math.ceil(400 / (d0 * 0.36)) + 1) * (Math.ceil(200 / (d0 * 0.36)) + 1);
    const g = swathGrid(400, 200, d0);
    expect(g.nA * g.nB).toBeLessThan(tight);
    expect(400 / (g.nA - 1)).toBeLessThan(d0);
    expect(200 / (g.nB - 1)).toBeLessThan(d0);
  });

  it('shares the flow between overlapping stamps within 0.2 and 1', () => {
    const dense = swathGrid(40, 20, 10);
    expect(dense.flowK).toBeGreaterThanOrEqual(0.2);
    expect(dense.flowK).toBeLessThan(1);
    const cover = (dense.nA * dense.nB * 100 * 0.785) / (50 * 30);
    expect(dense.flowK).toBeCloseTo(1 / Math.sqrt(cover), 10);
  });
});
