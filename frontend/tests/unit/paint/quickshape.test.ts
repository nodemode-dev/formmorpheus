import { describe, expect, it } from 'vitest';
import { fitShape, forceShape, pathLength, pressureAt, resample, shapePoints, type Pt, type Shape } from '@src/paint/quickshape';

const d = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

function along(corners: Pt[], perEdge: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    for (let j = 0; j < perEdge; j++) out.push({ x: a.x + ((b.x - a.x) * j) / perEdge, y: a.y + ((b.y - a.y) * j) / perEdge });
  }
  out.push({ ...corners[closed ? 0 : corners.length - 1] });
  return out;
}

function circle(cx: number, cy: number, r: number, from: number, to: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = from + ((to - from) * i) / n; out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }); }
  return out;
}

describe('pathLength', () => {
  it('sums the segment lengths', () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBeCloseTo(11, 10);
  });

  it('is zero for an empty path and for one point', () => {
    expect(pathLength([])).toBe(0);
    expect(pathLength([{ x: 5, y: 5 }])).toBe(0);
  });
});

describe('resample', () => {
  it('spaces the points evenly and keeps both ends', () => {
    const out = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }], 5);
    expect(out).toHaveLength(5);
    [0, 25, 50, 75, 100].forEach((x, i) => {
      expect(out[i].x).toBeCloseTo(x, 6);
      expect(out[i].y).toBeCloseTo(0, 6);
    });
  });

  it('keeps the path length of a bent path nearly unchanged', () => {
    const bent = along([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }], 3, false);
    const out = resample(bent, 61);
    expect(out).toHaveLength(61);
    expect(pathLength(out)).toBeGreaterThan(118);
    expect(pathLength(out)).toBeLessThanOrEqual(120 + 1e-9);
  });

  it('returns a copy when the path has no length', () => {
    const p = [{ x: 1, y: 1 }, { x: 1, y: 1 }];
    const out = resample(p, 10);
    expect(out).toEqual(p);
    expect(out).not.toBe(p);
  });
});

describe('fitShape', () => {
  it('refuses a stroke with fewer than four points', () => {
    expect(fitShape([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }])).toBeNull();
  });

  it('refuses a stroke shorter than 24 pixels', () => {
    expect(fitShape(along([{ x: 0, y: 0 }, { x: 20, y: 0 }], 8, false))).toBeNull();
  });

  it('recognises a wobbly straight stroke as a line from its first point', () => {
    const raw = along([{ x: 10, y: 10 }, { x: 210, y: 110 }], 40, false).map((q, i) => ({ x: q.x, y: q.y + (i % 2 ? 0.8 : -0.8) }));
    const s = fitShape(raw);
    expect(s?.kind).toBe('line');
    expect(s?.closed).toBe(false);
    expect(d(s!.v[0], raw[0])).toBeLessThan(1e-6);
    expect(s!.grab).toEqual(raw[raw.length - 1]);
  });

  it('recognises a half circle as an arc with a sweep of half a turn', () => {
    const s = fitShape(circle(100, 100, 50, 0, Math.PI, 40));
    expect(s?.kind).toBe('arc');
    expect(s!.sweep).toBeCloseTo(Math.PI, 1);
  });

  it('gives the arc sweep the sign of the drawing direction', () => {
    const s = fitShape(circle(100, 100, 50, 0, -Math.PI, 40));
    expect(s?.kind).toBe('arc');
    expect(s!.sweep).toBeCloseTo(-Math.PI, 1);
  });

  it('recognises a closed circle as an ellipse with equal radii about its centre', () => {
    const s = fitShape(circle(120, 80, 50, 0, Math.PI * 2, 90));
    expect(s?.kind).toBe('ellipse');
    expect(s?.closed).toBe(true);
    expect(d(s!.v[0], { x: 120, y: 80 })).toBeLessThan(1.5);
    expect(Math.abs(s!.rx - 50)).toBeLessThan(1.5);
    expect(Math.abs(s!.ry - 50)).toBeLessThan(1.5);
  });

  it('recognises a closed square as a rectangle with a vertex near every corner', () => {
    const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const s = fitShape(along(corners, 30, true));
    expect(s?.kind).toBe('rectangle');
    expect(s!.v).toHaveLength(4);
    for (const c of corners) expect(Math.min(...s!.v.map((q) => d(q, c)))).toBeLessThan(4);
  });

  it('recognises a closed three-cornered stroke as a triangle', () => {
    const corners = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 60, y: 100 }];
    const s = fitShape(along(corners, 30, true));
    expect(s?.kind).toBe('triangle');
    expect(s?.closed).toBe(true);
    expect(s!.v).toHaveLength(3);
    for (const c of corners) expect(Math.min(...s!.v.map((q) => d(q, c)))).toBeLessThan(8);
  });
});

describe('forceShape', () => {
  const raw: Pt[] = [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 60, y: 70 }, { x: 110, y: 70 }];

  it('builds a rectangle from the corners of the stroke box', () => {
    const s = forceShape(raw, 'rectangle');
    expect(s.closed).toBe(true);
    expect(s.v).toEqual([{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }]);
    expect(s.grab).toEqual({ x: 110, y: 70 });
  });

  it('builds an ellipse centred in the box with half the box as radii', () => {
    const s = forceShape(raw, 'ellipse');
    expect(s.v).toEqual([{ x: 60, y: 45 }]);
    expect(s.rx).toBe(50);
    expect(s.ry).toBe(25);
  });

  it('never gives a forced ellipse a radius below one pixel', () => {
    const s = forceShape([{ x: 0, y: 5 }, { x: 40, y: 5 }], 'ellipse');
    expect(s.ry).toBe(1);
    expect(s.rx).toBe(20);
  });

  it('builds a triangle with its apex at the top centre of the box', () => {
    expect(forceShape(raw, 'triangle').v).toEqual([{ x: 60, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }]);
  });

  it('builds an open line that starts at the first point', () => {
    const s = forceShape(raw, 'line');
    expect(s.closed).toBe(false);
    expect(s.v).toEqual([{ x: 10, y: 20 }]);
  });
});

describe('shapePoints', () => {
  it('draws a line from the start to the grab point in steps no longer than asked', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 30, y: 40 }], 'line');
    const pts = shapePoints(s, null, false, 2);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 30, y: 40 });
    for (let i = 1; i < pts.length; i++) expect(d(pts[i - 1], pts[i])).toBeLessThanOrEqual(2 + 1e-9);
    expect(pathLength(pts)).toBeCloseTo(50, 6);
  });

  it('ends a line at the pointer while the pen is down', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 30, y: 40 }], 'line');
    const pts = shapePoints(s, { x: -20, y: 7 }, false);
    expect(pts[pts.length - 1]).toEqual({ x: -20, y: 7 });
  });

  it('snaps a regular line to a multiple of 15 degrees and keeps its length', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 5, y: 5 }], 'line');
    const pts = shapePoints(s, { x: 100, y: 10 }, true);
    const end = pts[pts.length - 1];
    expect(end.y).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(Math.hypot(100, 10), 6);
    const up = shapePoints(s, { x: 50, y: 30 }, true);
    const e2 = up[up.length - 1];
    expect((Math.atan2(e2.y, e2.x) * 180) / Math.PI).toBeCloseTo(30, 6);
  });

  it('draws an arc on one circle from the start to the grab point', () => {
    const s: Shape = { kind: 'arc', closed: false, grab: { x: 100, y: 0 }, v: [{ x: 0, y: 0 }], sweep: Math.PI, rx: 0, ry: 0, rot: 0 };
    const pts = shapePoints(s, null, false);
    expect(d(pts[0], { x: 0, y: 0 })).toBeLessThan(1e-6);
    expect(d(pts[pts.length - 1], { x: 100, y: 0 })).toBeLessThan(1e-6);
    for (const q of pts) expect(d(q, { x: 50, y: 0 })).toBeCloseTo(50, 6);
    expect(pathLength(pts)).toBeGreaterThan(Math.PI * 50 * 0.99);
  });

  it('traces a closed ellipse that stays on the ellipse equation', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 200, y: 100 }], 'ellipse');
    const pts = shapePoints(s, null, false);
    expect(d(pts[0], pts[pts.length - 1])).toBeLessThan(1e-6);
    for (const q of pts) expect(((q.x - 100) / 100) ** 2 + ((q.y - 50) / 50) ** 2).toBeCloseTo(1, 6);
  });

  it('turns a regular ellipse into a circle of the mean radius', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 200, y: 100 }], 'ellipse');
    for (const q of shapePoints(s, null, true)) expect(d(q, { x: 100, y: 50 })).toBeCloseTo(75, 6);
  });

  it('scales a closed shape about its centre when the pointer moves away', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 100, y: 50 }], 'rectangle');
    const pts = shapePoints(s, { x: 150, y: 75 }, false, 1e6);
    expect(pts).toHaveLength(5);
    expect(pts[0].x).toBeCloseTo(-50, 6);
    expect(pts[0].y).toBeCloseTo(-25, 6);
    expect(pts[2].x).toBeCloseTo(150, 6);
    expect(pts[2].y).toBeCloseTo(75, 6);
    expect(d(pts[4], pts[0])).toBeLessThan(1e-9);
  });

  it('turns a closed shape about its centre when the pointer swings round', () => {
    const s = forceShape([{ x: -10, y: -10 }, { x: 10, y: 10 }], 'rectangle');
    const pts = shapePoints(s, { x: -10, y: 10 }, false, 1e6);
    expect(pts[0].x).toBeCloseTo(10, 6);
    expect(pts[0].y).toBeCloseTo(-10, 6);
  });

  it('never shrinks a closed shape below a twentieth of its size', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 100, y: 100 }], 'rectangle');
    const pts = shapePoints(s, { x: 50, y: 50.0001 }, false, 1e6);
    expect(d(pts[0], pts[1])).toBeCloseTo(5, 6);
  });

  it('makes a regular rectangle a square with equal sides', () => {
    const s = forceShape([{ x: 0, y: 0 }, { x: 100, y: 40 }], 'rectangle');
    const pts = shapePoints(s, null, true, 1e6);
    const sides = [0, 1, 2, 3].map((i) => d(pts[i], pts[i + 1]));
    for (const side of sides) expect(side).toBeCloseTo(sides[0], 6);
    const c = { x: 50, y: 20 };
    for (const q of pts) expect(d(q, c)).toBeCloseTo(d(pts[0], c), 6);
  });
});

describe('pressureAt', () => {
  it('answers a middle pressure for an empty profile', () => {
    expect(pressureAt([], 0.3)).toBe(0.5);
  });

  it('interpolates between the neighbouring samples', () => {
    expect(pressureAt([0, 1], 0.25)).toBeCloseTo(0.25, 10);
    expect(pressureAt([0.2, 0.8, 0.4], 0.5)).toBeCloseTo(0.8, 10);
    expect(pressureAt([0.2, 0.8, 0.4], 0.75)).toBeCloseTo(0.6, 10);
  });

  it('clamps the position to the ends of the stroke', () => {
    expect(pressureAt([0.1, 0.9], -4)).toBeCloseTo(0.1, 10);
    expect(pressureAt([0.1, 0.9], 7)).toBeCloseTo(0.9, 10);
  });
});
