import { describe, expect, it } from 'vitest';
import { buildPath, pathAt, pathBounds, type Poly } from '@src/engine/text-path';

const node = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0) => ({ x, y, ix, iy, ox, oy });

describe('buildPath', () => {
  it('lays a curve without nodes as a straight line centred on the block', () => {
    const p = buildPath({ kind: 'curve' }, 100, 50, 200);
    expect(p.pts[0]).toBeCloseTo(0);
    expect(p.pts[p.pts.length - 2]).toBeCloseTo(200);
    expect(p.total).toBeCloseTo(200);
    expect(pathBounds(p)).toEqual({ x0: 0, y0: 50, x1: 200, y1: 50 });
  });

  it('treats a length of zero as one pixel', () => {
    expect(buildPath({ kind: 'curve' }, 0, 0, 0).total).toBeCloseTo(1);
  });

  it('keeps one cumulative length per point, never decreasing', () => {
    const p = buildPath({ kind: 'wave' }, 0, 0, 300);
    expect(p.cum.length).toBe(p.pts.length / 2);
    expect(p.cum[0]).toBe(0);
    for (let i = 1; i < p.cum.length; i++) expect(p.cum[i]).toBeGreaterThanOrEqual(p.cum[i - 1]);
    expect(p.total).toBe(p.cum[p.cum.length - 1]);
  });

  it('draws a wave that peaks a quarter wavelength in', () => {
    const p = buildPath({ kind: 'wave', amp: 40, len: 400 }, 200, 50, 400);
    expect(p.pts[50]).toBeCloseTo(100);
    expect(p.pts[51]).toBeCloseTo(90);
    const b = pathBounds(p);
    expect(b.y0).toBeCloseTo(10);
    expect(b.y1).toBeCloseTo(90);
    expect(p.total).toBeGreaterThan(400);
  });

  it('draws a flat wave when the height is zero', () => {
    const p = buildPath({ kind: 'wave', amp: 0 }, 0, 7, 120);
    expect(p.total).toBeCloseTo(120);
    expect(pathBounds(p).y0).toBeCloseTo(7);
    expect(pathBounds(p).y1).toBeCloseTo(7);
  });

  it('bends an arc of 1 into a half circle below the text centre', () => {
    const L = 300;
    const R = L / Math.PI;
    const p = buildPath({ kind: 'arc', bend: 1 }, 10, 20, L);
    expect(p.pts[0]).toBeCloseTo(10 - R);
    expect(p.pts[1]).toBeCloseTo(20 + R);
    expect(p.pts[p.pts.length - 2]).toBeCloseTo(10 + R);
    expect(p.pts[p.pts.length - 1]).toBeCloseTo(20 + R);
    expect(p.total / L).toBeCloseTo(1, 2);
  });

  it('bends the other way for a negative arc', () => {
    const L = 300;
    const R = L / Math.PI;
    const p = buildPath({ kind: 'arc', bend: -1 }, 10, 20, L);
    expect(p.pts[1]).toBeCloseTo(20 - R);
    expect(p.pts[p.pts.length - 1]).toBeCloseTo(20 - R);
  });

  it('puts the middle of a circle on its top and every point on the radius', () => {
    const R = 50;
    const p = buildPath({ kind: 'circle', radius: R }, 100, 100, 200);
    for (let i = 0; i < p.pts.length; i += 2) expect(Math.hypot(p.pts[i] - 100, p.pts[i + 1] - (100 + R))).toBeCloseTo(R);
    const mid = pathAt(p, p.total / 2);
    expect(mid.x).toBeCloseTo(100, 0);
    expect(mid.y).toBeCloseTo(100, 0);
  });

  it('fits the text once round a circle with no radius and refuses a tiny radius', () => {
    const L = 314;
    const p = buildPath({ kind: 'circle' }, 0, 0, L);
    const R = L / (Math.PI * 2);
    expect(Math.hypot(p.pts[0], p.pts[1] - R)).toBeCloseTo(R);
    const tiny = buildPath({ kind: 'circle', radius: 1 }, 0, 0, 20);
    expect(Math.hypot(tiny.pts[0], tiny.pts[1] - 4)).toBeCloseTo(4);
  });

  it('follows pen nodes as offsets from the centre', () => {
    const p = buildPath({ kind: 'curve', nodes: [node(-50, 0), node(50, 0)] }, 200, 80, 999);
    expect(p.pts[0]).toBeCloseTo(150);
    expect(p.pts[p.pts.length - 2]).toBeCloseTo(250);
    expect(p.total).toBeCloseTo(100);
    expect(pathBounds(p).y0).toBeCloseTo(80);
    expect(pathBounds(p).y1).toBeCloseTo(80);
  });

  it('bulges a pen curve towards its handles', () => {
    const p = buildPath({ kind: 'curve', nodes: [node(-50, 0, 0, 0, 0, -60), node(50, 0, 0, -60, 0, 0)] }, 0, 0, 100);
    const b = pathBounds(p);
    expect(b.y0).toBeCloseTo(-45, 0);
    expect(b.y1).toBeCloseTo(0);
    expect(p.total).toBeGreaterThan(100);
  });
});

describe('pathAt', () => {
  const line: Poly = { pts: [0, 0, 0, 10, 10, 10], cum: [0, 10, 20], total: 20 };

  it('interpolates inside a segment and reports its direction', () => {
    const a = pathAt(line, 5);
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(5);
    expect(a.ang).toBeCloseTo(Math.PI / 2);
    const b = pathAt(line, 15);
    expect(b.x).toBeCloseTo(5);
    expect(b.y).toBeCloseTo(10);
    expect(b.ang).toBeCloseTo(0);
  });

  it('lands exactly on a corner', () => {
    const c = pathAt(line, 10);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(10);
  });

  it('continues straight past both ends', () => {
    const before = pathAt(line, -4);
    expect(before.x).toBeCloseTo(0);
    expect(before.y).toBeCloseTo(-4);
    expect(before.ang).toBeCloseTo(Math.PI / 2);
    const after = pathAt(line, 26);
    expect(after.x).toBeCloseTo(16);
    expect(after.y).toBeCloseTo(10);
    expect(after.ang).toBeCloseTo(0);
  });

  it('answers a single point or an empty path without failing', () => {
    expect(pathAt({ pts: [3, 4], cum: [0], total: 0 }, 9)).toEqual({ x: 3, y: 4, ang: 0 });
    expect(pathAt({ pts: [], cum: [0], total: 0 }, 9)).toEqual({ x: 0, y: 0, ang: 0 });
  });
});

describe('pathBounds', () => {
  it('covers every point', () => {
    expect(pathBounds({ pts: [3, -2, -7, 9, 4, 4], cum: [0, 1, 2], total: 2 })).toEqual({ x0: -7, y0: -2, x1: 4, y1: 9 });
  });
});
