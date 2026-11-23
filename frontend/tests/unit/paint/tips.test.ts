import { describe, expect, it } from 'vitest';
import { bucketAngle, bucketDiameter, bucketRoundness, getTip, grainAt, grainTable } from '@src/paint/tips';
import type { Tip } from '@src/paint/tips';
import type { TipImage } from '@src/paint/types';

const STEP = (3 * Math.PI) / 180;

function at(t: Tip, i: number, j: number): number {
  return t.data[j * t.size + i];
}

function total(t: Tip): number {
  let s = 0;
  for (let i = 0; i < t.data.length; i++) s += t.data[i];
  return s;
}

function rowSum(t: Tip, j: number): number {
  let s = 0;
  for (let i = 0; i < t.size; i++) s += at(t, i, j);
  return s;
}

function colSum(t: Tip, i: number): number {
  let s = 0;
  for (let j = 0; j < t.size; j++) s += at(t, i, j);
  return s;
}

describe('bucketDiameter', () => {
  it('clamps zero, negative and huge diameters', () => {
    expect(bucketDiameter(0)).toBe(1);
    expect(bucketDiameter(-5)).toBe(1);
    expect(bucketDiameter(100000)).toBe(384);
  });

  it('rounds small diameters to whole pixels', () => {
    expect(bucketDiameter(7.4)).toBe(7);
    expect(bucketDiameter(7.6)).toBe(8);
    expect(bucketDiameter(32)).toBe(32);
  });

  it('keeps powers of two exactly', () => {
    expect(bucketDiameter(64)).toBe(64);
    expect(bucketDiameter(128)).toBe(128);
    expect(bucketDiameter(256)).toBe(256);
  });

  it('stays within five percent of large diameters and never decreases', () => {
    let prev = 0;
    for (let d = 33; d <= 384; d++) {
      const b = bucketDiameter(d);
      expect(Math.abs(b - d) / d).toBeLessThan(0.05);
      expect(b).toBeGreaterThanOrEqual(prev);
      expect(Number.isInteger(b)).toBe(true);
      prev = b;
    }
  });
});

describe('bucketAngle', () => {
  it('snaps to three degree steps', () => {
    expect(bucketAngle(0)).toBe(0);
    expect(bucketAngle(STEP * 0.4)).toBe(0);
    expect(bucketAngle(STEP * 0.6)).toBeCloseTo(STEP, 10);
    expect(bucketAngle(1)).toBeCloseTo(Math.round(1 / STEP) * STEP, 10);
  });

  it('wraps negative angles into the positive turn', () => {
    expect(bucketAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 10);
  });

  it('wraps angles beyond a full turn', () => {
    expect(bucketAngle(Math.PI * 2 + 0.5)).toBeCloseTo(bucketAngle(0.5), 10);
  });
});

describe('bucketRoundness', () => {
  it('clamps to the range 0.05 to 1', () => {
    expect(bucketRoundness(0)).toBe(0.05);
    expect(bucketRoundness(-3)).toBe(0.05);
    expect(bucketRoundness(2)).toBe(1);
  });

  it('snaps to steps of one twentieth', () => {
    expect(bucketRoundness(0.52)).toBeCloseTo(0.5, 10);
    expect(bucketRoundness(0.53)).toBeCloseTo(0.55, 10);
  });
});

describe('getTip', () => {
  it('builds a square map two pixels wider than the bucketed diameter', () => {
    const t = getTip('round', 20, 0, 1, 0);
    expect(t.diameter).toBe(20);
    expect(t.size).toBe(22);
    expect(t.data.length).toBe(22 * 22);
  });

  it('draws a hard round tip opaque at the centre and clear at the corners', () => {
    const t = getTip('round', 20, 0, 1, 0);
    expect(at(t, 11, 11)).toBe(255);
    expect(at(t, 0, 0)).toBe(0);
    expect(at(t, t.size - 1, t.size - 1)).toBe(0);
  });

  it('draws a round tip that mirrors left to right and top to bottom', () => {
    const t = getTip('round', 24, 0.5, 1, 0);
    const n = t.size;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        expect(at(t, i, j)).toBe(at(t, n - 1 - i, j));
        expect(at(t, i, j)).toBe(at(t, i, n - 1 - j));
      }
    }
  });

  it('covers roughly the area of the disc for a hard round tip', () => {
    const t = getTip('round', 40, 0, 1, 0);
    const area = total(t) / 255;
    expect(area).toBeGreaterThan(Math.PI * 400 * 0.95);
    expect(area).toBeLessThan(Math.PI * 400 * 1.1);
  });

  it('returns the cached tip for the same arguments and for arguments in the same bucket', () => {
    const a = getTip('round', 20, 0.5, 1, 0);
    expect(getTip('round', 20, 0.5, 1, 0)).toBe(a);
    expect(getTip('round', 20.2, 0.51, 0.99, 0.001)).toBe(a);
  });

  it('builds a different tip for a different shape', () => {
    const a = getTip('round', 40, 0, 1, 0);
    const b = getTip('square', 40, 0, 1, 0);
    expect(b).not.toBe(a);
    expect(at(a, 38, 38)).toBe(0);
    expect(at(b, 38, 38)).toBe(255);
  });

  it('lays less paint with a soft edge than with a hard one', () => {
    expect(total(getTip('round', 40, 1, 1, 0))).toBeLessThan(total(getTip('round', 40, 0, 1, 0)) * 0.7);
  });

  it('clamps softness outside 0 to 1', () => {
    expect(getTip('round', 30, 5, 1, 0)).toBe(getTip('round', 30, 1, 1, 0));
    expect(getTip('round', 30, -2, 1, 0)).toBe(getTip('round', 30, 0, 1, 0));
  });

  it('flattens the tip across its short axis when roundness is low', () => {
    const t = getTip('round', 40, 0, 0.5, 0);
    const c = t.size / 2;
    expect(colSum(t, c)).toBeLessThan(rowSum(t, c) * 0.6);
  });

  it('turns the long axis with the angle', () => {
    const t = getTip('round', 40, 0, 0.5, Math.PI / 2);
    const c = t.size / 2;
    expect(rowSum(t, c)).toBeLessThan(colSum(t, c) * 0.6);
  });

  it('leaves a hole in the middle of a ring', () => {
    const t = getTip('ring', 40, 0, 1, 0);
    expect(at(t, 21, 21)).toBe(0);
    expect(at(t, 37, 21)).toBe(255);
  });

  it('draws a cross with opaque arms and clear diagonals', () => {
    const t = getTip('cross', 40, 0, 1, 0);
    expect(at(t, 21, 21)).toBe(255);
    expect(at(t, 33, 21)).toBe(255);
    expect(at(t, 31, 31)).toBe(0);
  });

  it('gives an empty map for a sampled tip without a picture', () => {
    const t = getTip('sampled', 16, 0, 1, 0);
    expect(total(t)).toBe(0);
  });

  it('samples a picture tip and keys the cache by the picture', () => {
    const full: TipImage = { w: 4, h: 4, data: new Uint8Array(16).fill(255), key: 'f26-full' };
    const half: TipImage = { w: 4, h: 4, data: new Uint8Array(16).fill(128), key: 'f26-half' };
    const a = getTip('sampled', 16, 0, 1, 0, full);
    const b = getTip('sampled', 16, 0, 1, 0, half);
    expect(b).not.toBe(a);
    expect(at(a, 9, 9)).toBe(255);
    expect(at(b, 9, 9)).toBe(128);
  });

  it('ignores a picture for a procedural shape', () => {
    const img: TipImage = { w: 2, h: 2, data: new Uint8Array(4), key: 'f26-blank' };
    expect(getTip('round', 18, 0, 1, 0, img)).toBe(getTip('round', 18, 0, 1, 0));
  });
});

describe('paper grain', () => {
  it('is normalised to span 0 to 1', () => {
    const t = grainTable(7);
    expect(t.length).toBe(256 * 256);
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < min) min = t[i];
      if (t[i] > max) max = t[i];
      sum += t[i];
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
    expect(sum / t.length).toBeGreaterThan(0.3);
    expect(sum / t.length).toBeLessThan(0.7);
  });

  it('tiles every 256 pixels in both directions and for negative positions', () => {
    expect(grainAt(10 + 256, 20, 7)).toBe(grainAt(10, 20, 7));
    expect(grainAt(10, 20 + 512, 7)).toBe(grainAt(10, 20, 7));
    expect(grainAt(-1, -1, 7)).toBe(grainAt(255, 255, 7));
  });

  it('reads the table row by row', () => {
    const t = grainTable(7);
    expect(grainAt(5, 9, 7)).toBe(t[9 * 256 + 5]);
    expect(grainAt(5.9, 9.2, 7)).toBe(t[9 * 256 + 5]);
  });

  it('gives a different pattern for a different seed', () => {
    const a = grainTable(21);
    const b = grainTable(22);
    let differ = 0;
    for (let i = 0; i < a.length; i += 97) if (a[i] !== b[i]) differ++;
    expect(differ).toBeGreaterThan(500);
  });

  it('truncates a fractional seed', () => {
    expect(grainTable(21.9)).toBe(grainTable(21));
  });

  it('rebuilds an evicted table with identical values', () => {
    const first = grainTable(500);
    const copy = first.slice();
    for (let s = 501; s <= 512; s++) grainTable(s);
    const again = grainTable(500);
    expect(again).not.toBe(first);
    expect(again.every((v, i) => v === copy[i])).toBe(true);
  });
});
