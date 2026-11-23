import { describe, expect, it } from 'vitest';
import { handlesOf, laneSegments, pathAt, pathNodes, pointAtArc, segmentOf, smoothPathOn, type Pt } from '@src/engine/path';
import type { Key, KeyLane, SpatialTangents } from '@src/engine/types';

const k = (frame: number, value: number, sp?: SpatialTangents): Key => (sp ? { frame, value, ease: 'linear', sp } : { frame, value, ease: 'linear' });

function lane(xs: Key[], ys: Key[], path = false): KeyLane {
  return { kind: 'move', expanded: false, channels: { x: xs, y: ys }, options: { path } };
}

const linearProgress = (a: Key, b: Key, frame: number): number => (frame - a.frame) / (b.frame - a.frame);

describe('pathNodes', () => {
  it('keeps only frames keyed on both x and y with their indices', () => {
    const nodes = pathNodes([k(0, 1), k(5, 2), k(10, 3)], [k(0, 7), k(3, 8), k(10, 9)]);
    expect(nodes.map((n) => [n.frame, n.x, n.y, n.xi, n.yi])).toEqual([[0, 1, 7, 0, 0], [10, 3, 9, 2, 2]]);
  });

  it('gives no nodes for empty channels', () => {
    expect(pathNodes([], [k(0, 1)])).toEqual([]);
  });
});

describe('handlesOf', () => {
  const nodes = pathNodes([k(0, 0), k(10, 90), k(20, 120)], [k(0, 0), k(10, 30), k(20, 60)]);

  it('uses a third of the chord when nothing is set', () => {
    const h = handlesOf(nodes, 1, false);
    expect(h.out).toEqual([10, 10]);
    expect(h.in).toEqual([-30, -10]);
  });

  it('gives end nodes a zero handle on the open side', () => {
    expect(handlesOf(nodes, 0, true).in).toEqual([0, 0]);
    expect(handlesOf(nodes, 2, true).out).toEqual([0, 0]);
  });

  it('uses a sixth of the neighbour span for a smooth inner node', () => {
    const h = handlesOf(nodes, 1, true);
    expect(h.out).toEqual([20, 10]);
    expect(h.in).toEqual([-20, -10]);
  });

  it('prefers the tangents stored on the key and straightens a linear key', () => {
    const own = pathNodes([k(0, 0), k(10, 90, { in: [-1, -2], out: [3, 4] }), k(20, 120)], [k(0, 0), k(10, 30), k(20, 60)]);
    expect(handlesOf(own, 1, true)).toEqual({ in: [-1, -2], out: [3, 4] });
    const lin = pathNodes([k(0, 0), k(10, 90, { in: [5, 5], out: [5, 5], linear: true }), k(20, 120)], [k(0, 0), k(10, 30), k(20, 60)]);
    expect(handlesOf(lin, 1, true)).toEqual({ in: [-30, -10], out: [10, 10] });
  });
});

describe('segmentOf and pointAtArc', () => {
  it('measures a straight span as the distance between its keys', () => {
    const nodes = pathNodes([k(0, 0), k(10, 30)], [k(0, 0), k(10, 40)]);
    const seg = segmentOf(nodes, 0, false);
    expect(seg.len).toBeCloseTo(50, 6);
    expect(seg.p[0]).toEqual([0, 0]);
    expect(seg.p[3]).toEqual([30, 40]);
  });

  it('maps a fraction to arc length even when the handles are uneven', () => {
    const nodes = pathNodes([k(0, 0, { in: [0, 0], out: [60, 0] }), k(10, 100, { in: [-5, 0], out: [0, 0] })], [k(0, 0), k(10, 0)]);
    const seg = segmentOf(nodes, 0, false);
    const out: Pt = [0, 0];
    pointAtArc(seg, 0.25, out);
    expect(out[0]).toBeCloseTo(25, 0);
    pointAtArc(seg, 0.5, out);
    expect(out[0]).toBeCloseTo(50, 0);
    expect(out[1]).toBeCloseTo(0, 9);
  });

  it('clamps the fraction to the ends of the segment', () => {
    const nodes = pathNodes([k(0, 0), k(10, 100)], [k(0, 20), k(10, 80)]);
    const seg = segmentOf(nodes, 0, true);
    const out: Pt = [0, 0];
    pointAtArc(seg, -3, out);
    expect(out).toEqual([0, 20]);
    pointAtArc(seg, 7, out);
    expect(out[0]).toBeCloseTo(100, 9);
    expect(out[1]).toBeCloseTo(80, 9);
  });

  it('makes a curve longer than its chord', () => {
    const nodes = pathNodes([k(0, 0, { in: [0, 0], out: [0, 80] }), k(10, 100, { in: [0, 80], out: [0, 0] })], [k(0, 0), k(10, 0)]);
    const seg = segmentOf(nodes, 0, false);
    expect(seg.len).toBeGreaterThan(100);
    const out: Pt = [0, 0];
    pointAtArc(seg, 0.5, out);
    expect(out[0]).toBeCloseTo(50, 0);
    expect(out[1]).toBeCloseTo(60, 0);
  });
});

describe('laneSegments and pathAt', () => {
  it('reads the smooth path option', () => {
    expect(smoothPathOn(lane([], [], true))).toBe(true);
    expect(smoothPathOn(lane([], []))).toBe(false);
  });

  it('needs two keys on each channel', () => {
    expect(laneSegments(lane([k(0, 0)], [k(0, 0), k(5, 5)]))).toBeNull();
    expect(laneSegments(lane([k(0, 0), k(5, 5)], [k(1, 0), k(6, 5)]))).toBeNull();
  });

  it('leaves a span without tangents straight and curves it when the lane smooths', () => {
    const plain = laneSegments(lane([k(0, 0), k(10, 10)], [k(0, 0), k(10, 10)]));
    expect(plain?.seg(0)).toBeNull();
    const smooth = laneSegments(lane([k(0, 0), k(10, 10)], [k(0, 0), k(10, 10)], true));
    expect(smooth?.seg(0)?.len).toBeCloseTo(Math.hypot(10, 10), 6);
  });

  it('does not curve a held span or one with a key between on a single channel', () => {
    const held = lane([{ frame: 0, value: 0, ease: 'hold' }, k(10, 10)], [k(0, 0), k(10, 10)], true);
    expect(laneSegments(held)?.seg(0)).toBeNull();
    const split = lane([k(0, 0), k(5, 3), k(10, 10)], [k(0, 0), k(10, 10)], true);
    expect(laneSegments(split)?.seg(0)).toBeNull();
  });

  it('answers false on and outside the end keys and on straight spans', () => {
    const out: Pt = [-1, -1];
    const smooth = lane([k(0, 0), k(10, 10)], [k(0, 0), k(10, 10)], true);
    expect(pathAt(smooth, 0, linearProgress, out)).toBe(false);
    expect(pathAt(smooth, 10, linearProgress, out)).toBe(false);
    expect(pathAt(smooth, 42, linearProgress, out)).toBe(false);
    expect(pathAt(lane([k(0, 0), k(10, 10)], [k(0, 0), k(10, 10)]), 5, linearProgress, out)).toBe(false);
    expect(out).toEqual([-1, -1]);
  });

  it('places the frame by the eased fraction of the right span', () => {
    const l = lane([k(0, 0), k(10, 100), k(20, 100)], [k(0, 0), k(10, 0), k(20, 100)], true);
    const out: Pt = [0, 0];
    expect(pathAt(l, 15, () => 0, out)).toBe(true);
    expect(out[0]).toBeCloseTo(100, 9);
    expect(out[1]).toBeCloseTo(0, 9);
    expect(pathAt(l, 15, () => 1, out)).toBe(true);
    expect(out[0]).toBeCloseTo(100, 9);
    expect(out[1]).toBeCloseTo(100, 9);
    expect(pathAt(l, 5, linearProgress, out)).toBe(true);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThan(100);
  });
});
