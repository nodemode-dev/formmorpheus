import { describe, expect, it } from 'vitest';
import {
  MAX_STOPS, bounds, defaultShape, defaultStops, hexOf, normalizeStroke, outline, paintStops, relevantChannels,
  resolveShape, rgbOf, shapeBase, shapeChannel, shapeExtent, trimOutline, trimmed, type Sub,
} from '@src/engine/shape';
import type { BezNode, ShapeDef } from '@src/engine/shape-types';

const node = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0): BezNode => ({ x, y, ix, iy, ox, oy });

function length(subs: Sub[]): number {
  let total = 0;
  for (const s of subs) {
    const pts = s.closed ? [...s.p, s.p[0], s.p[1]] : s.p;
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  }
  return total;
}

const square = (): ShapeDef => defaultShape('rect', 100, 100);
const vals = (d: ShapeDef, over: Record<string, number> = {}) => resolveShape(d, over);

describe('colour conversion', () => {
  it('reads a hex colour as a zero to one triple', () => {
    expect(rgbOf('#ff0000')).toEqual([1, 0, 0]);
    expect(rgbOf('00FF00')).toEqual([0, 1, 0]);
    expect(rgbOf('#336699')[1]).toBeCloseTo(0.4, 10);
  });

  it('reads anything malformed as black', () => {
    expect(rgbOf('red')).toEqual([0, 0, 0]);
    expect(rgbOf('#fff')).toEqual([0, 0, 0]);
    expect(rgbOf('')).toEqual([0, 0, 0]);
  });

  it('writes a triple back as hex and clamps out of range parts', () => {
    expect(hexOf(1, 0, 0)).toBe('#ff0000');
    expect(hexOf(2, -1, 0.5)).toBe('#ff0080');
  });

  it('round trips a colour through both directions', () => {
    for (const hex of ['#3a8bff', '#000000', '#ffffff', '#16213a']) {
      const [r, g, b] = rgbOf(hex);
      expect(hexOf(r, g, b)).toBe(hex);
    }
  });
});

describe('defaults and saved values', () => {
  it('gives a line a stroke and no fill, and other shapes a fill and no stroke', () => {
    expect(defaultShape('line').fill).toBeNull();
    expect(defaultShape('line').stroke?.width).toBeGreaterThan(0);
    expect(defaultShape('ellipse').stroke).toBeNull();
    expect(defaultShape('ellipse').fill?.kind).toBe('solid');
  });

  it('adds only the parameters the type uses', () => {
    expect(defaultShape('rect').radius).toBe(0);
    expect(defaultShape('polygon').sides).toBe(5);
    expect(defaultShape('star')).toMatchObject({ points: 5, inner: 0.5 });
    expect(defaultShape('ellipse')).not.toHaveProperty('radius');
    expect(defaultShape('arrow', 200, 999).h).toBe(60);
  });

  it('reports fill opacity zero for a shape without a fill', () => {
    expect(shapeBase(defaultShape('line')).fillA).toBe(0);
    expect(shapeBase(defaultShape('rect')).fillA).toBe(1);
    expect(shapeBase({ ...square(), fill: { kind: 'solid', color: '#ff0000', alpha: 0.4 } }).fillA).toBe(0.4);
  });

  it('reads the saved size, colours and trim of a shape', () => {
    const v = shapeBase({ ...square(), fill: { kind: 'solid', color: '#ff0000' }, stroke: { color: '#0000ff', width: 7 }, trimEnd: 0.5 });
    expect(v).toMatchObject({ w: 100, h: 100, fillR: 1, fillG: 0, fillB: 0, strokeW: 7, strokeB: 1, strokeA: 1, trimStart: 0, trimEnd: 0.5 });
  });

  it('spreads missing gradient stops evenly and reads the saved ones', () => {
    const v = shapeBase({ ...square(), fill: { kind: 'linear', color: '#ff0000', stops: [{ o: 0.2, color: '#00ff00' }, { o: 0.9, color: '#0000ff' }] } });
    expect(v.o0).toBe(0.2);
    expect(v.o1).toBe(0.9);
    expect(v.g0G).toBe(1);
    expect(v.g1B).toBe(1);
    expect(v[`o${MAX_STOPS - 1}`]).toBe(1);
  });

  it('survives a missing shape', () => {
    expect(shapeBase(undefined)).toMatchObject({ w: 400, h: 300, trimEnd: 1 });
  });

  it('puts keyed values on top of the saved ones without touching the shape', () => {
    const d = square();
    const v = resolveShape(d, { w: 250 });
    expect(v.w).toBe(250);
    expect(v.h).toBe(100);
    expect(d.w).toBe(100);
    expect(resolveShape(d, null).w).toBe(100);
  });

  it('lists the channels that matter for each type', () => {
    expect(relevantChannels(defaultShape('rect'))).toContain('radius');
    expect(relevantChannels(defaultShape('ellipse'))).not.toContain('radius');
    expect(relevantChannels(defaultShape('polygon'))).toContain('sides');
    expect(relevantChannels(defaultShape('star'))).toEqual(expect.arrayContaining(['points', 'inner']));
    expect(relevantChannels(undefined)).toEqual(expect.arrayContaining(['w', 'h', 'trimStart', 'trimEnd']));
  });

  it('looks a channel up by id', () => {
    expect(shapeChannel('inner')).toMatchObject({ min: 0.02, max: 1 });
    expect(shapeChannel(`o${MAX_STOPS - 1}`)?.def).toBe(1);
    expect(shapeChannel(`o${MAX_STOPS}`)).toBeUndefined();
    expect(shapeChannel('nope')).toBeUndefined();
  });
});

describe('outline', () => {
  it('draws a sharp rectangle as its four corners', () => {
    const d = defaultShape('rect', 100, 60);
    expect(outline(d, vals(d))).toEqual([{ p: [-50, -30, 50, -30, 50, 30, -50, 30], closed: true }]);
  });

  it('keeps a rounded rectangle inside its box and caps the radius at half the short side', () => {
    const d = defaultShape('rect', 100, 60);
    const b = bounds(outline(d, vals(d, { radius: 500 })));
    expect(b?.[0]).toBeCloseTo(-50, 6);
    expect(b?.[1]).toBeCloseTo(-30, 6);
    expect(b?.[2]).toBeCloseTo(50, 6);
    expect(b?.[3]).toBeCloseTo(30, 6);
    expect(length(outline(d, vals(d, { radius: 500 })))).toBeLessThan(length(outline(d, vals(d))));
  });

  it('treats a negative size as zero', () => {
    const d = square();
    expect(length(outline(d, vals(d, { w: -40, h: -40 })))).toBe(0);
  });

  it('puts every ellipse point on the ellipse', () => {
    const d = defaultShape('ellipse', 200, 80);
    const [s] = outline(d, vals(d));
    expect(s.closed).toBe(true);
    for (let i = 0; i < s.p.length; i += 2) expect((s.p[i] / 100) ** 2 + (s.p[i + 1] / 40) ** 2).toBeCloseTo(1, 9);
    expect(s.p[0]).toBeCloseTo(0, 9);
    expect(s.p[1]).toBeCloseTo(-40, 9);
  });

  it('clamps polygon sides to between three and sixty four and rounds them', () => {
    const d = defaultShape('polygon', 100, 100);
    expect(outline(d, vals(d, { sides: 1 }))[0].p.length).toBe(6);
    expect(outline(d, vals(d, { sides: 500 }))[0].p.length).toBe(128);
    expect(outline(d, vals(d, { sides: 5.6 }))[0].p.length).toBe(12);
  });

  it('alternates star points between the outer and the inner radius', () => {
    const d = defaultShape('star', 100, 100);
    const [s] = outline(d, vals(d, { points: 4, inner: 0.25 }));
    expect(s.p.length).toBe(16);
    for (let i = 0; i < 8; i++) expect(Math.hypot(s.p[i * 2], s.p[i * 2 + 1])).toBeCloseTo(i % 2 ? 12.5 : 50, 9);
  });

  it('clamps the star inner radius', () => {
    const d = defaultShape('star', 100, 100);
    const [s] = outline(d, vals(d, { inner: 9 }));
    expect(Math.hypot(s.p[2], s.p[3])).toBeCloseTo(50, 9);
  });

  it('draws a line as one open run and an arrow as a shaft plus a head ending on the tip', () => {
    const l = defaultShape('line', 100, 10);
    expect(outline(l, vals(l))).toEqual([{ p: [-50, 0, 50, 0], closed: false }]);
    const a = defaultShape('arrow', 100, 10);
    const subs = outline(a, vals(a));
    expect(subs).toHaveLength(2);
    expect(subs[1].p.slice(2, 4)).toEqual([50, 0]);
    expect(subs[1].p[1]).toBeCloseTo(-subs[1].p[5], 9);
    expect(subs.every((s) => !s.closed)).toBe(true);
  });

  it('draws nothing for a path with fewer than two nodes', () => {
    const d: ShapeDef = { type: 'path', w: 0, h: 0, fill: null, stroke: null, nodes: [node(3, 4)] };
    expect(outline(d, vals(d))).toEqual([]);
    expect(bounds(outline(d, vals(d)))).toBeNull();
  });

  it('runs a path through its nodes and follows its handles', () => {
    const straight: ShapeDef = { type: 'path', w: 0, h: 0, fill: null, stroke: null, nodes: [node(0, 0), node(100, 0)] };
    const [s] = outline(straight, vals(straight));
    expect(s.p.slice(0, 2)).toEqual([0, 0]);
    expect(s.p.slice(-2)).toEqual([100, 0]);
    expect(bounds([s])).toEqual([0, 0, 100, 0]);
    const curved: ShapeDef = { ...straight, nodes: [node(0, 0, 0, 0, 0, 80), node(100, 0, 0, 80, 0, 0)] };
    expect(bounds(outline(curved, vals(curved)))?.[3]).toBeCloseTo(60, 0);
  });

  it('does not repeat the first point at the end of a closed path', () => {
    const d: ShapeDef = { type: 'path', w: 0, h: 0, fill: null, stroke: null, closed: true, nodes: [node(0, 0), node(100, 0), node(100, 100)] };
    const [s] = outline(d, vals(d));
    expect(s.closed).toBe(true);
    expect(s.p.slice(-2)).not.toEqual([0, 0]);
    expect(length([s])).toBeCloseTo(200 + Math.hypot(100, 100), 6);
  });
});

describe('bounds', () => {
  it('covers every run', () => {
    expect(bounds([{ p: [0, 0, 10, 5], closed: false }, { p: [-3, 9], closed: false }])).toEqual([-3, 0, 10, 9]);
  });

  it('is null for nothing', () => {
    expect(bounds([])).toBeNull();
  });
});

describe('trim path', () => {
  it('is off for the default range', () => {
    const d = square();
    expect(trimmed(vals(d))).toBe(false);
    const subs = outline(d, vals(d));
    expect(trimOutline(subs, vals(d))).toBe(subs);
  });

  it('is on once the start, the end or the offset moves', () => {
    const d = square();
    expect(trimmed(vals(d, { trimStart: 0.1 }))).toBe(true);
    expect(trimmed(vals(d, { trimEnd: 0.9 }))).toBe(true);
    expect(trimmed(vals(d, { trimOffset: -5 }))).toBe(true);
  });

  it('keeps the first half of a square as one open run', () => {
    const d = square();
    const out = trimOutline(outline(d, vals(d)), vals(d, { trimEnd: 0.5 }));
    expect(out).toEqual([{ p: [-50, -50, 50, -50, 50, 50], closed: false }]);
  });

  it('keeps the share of the length the range asks for', () => {
    const d = defaultShape('ellipse', 300, 120);
    const subs = outline(d, vals(d));
    const out = trimOutline(subs, vals(d, { trimStart: 0.2, trimEnd: 0.65 }));
    expect(length(out)).toBeCloseTo(length(subs) * 0.45, 6);
    expect(out.every((s) => !s.closed)).toBe(true);
  });

  it('swaps a start that lies after the end', () => {
    const d = square();
    const subs = outline(d, vals(d));
    expect(trimOutline(subs, vals(d, { trimStart: 0.5, trimEnd: 0 }))).toEqual(trimOutline(subs, vals(d, { trimStart: 0, trimEnd: 0.5 })));
  });

  it('turns the range round a closed outline by the offset in degrees', () => {
    const d = square();
    const out = trimOutline(outline(d, vals(d)), vals(d, { trimEnd: 0.25, trimOffset: 90 }));
    expect(out).toEqual([{ p: [50, -50, 50, 50], closed: false }]);
    const full = trimOutline(outline(d, vals(d)), vals(d, { trimEnd: 0.25, trimOffset: 90 + 720 }));
    expect(length(full)).toBeCloseTo(100, 6);
  });

  it('splits a range that wraps past the start in two runs with the full share of length', () => {
    const d = square();
    const out = trimOutline(outline(d, vals(d)), vals(d, { trimStart: 0.5, trimEnd: 1, trimOffset: 90 }));
    expect(out).toHaveLength(2);
    expect(length(out)).toBeCloseTo(200, 6);
    expect(out[0].p.slice(0, 2)).toEqual([-50, 50]);
    expect(out[1].p.slice(-2)).toEqual([50, -50]);
  });

  it('accepts a negative offset on a closed outline', () => {
    const d = square();
    const out = trimOutline(outline(d, vals(d)), vals(d, { trimEnd: 0.25, trimOffset: -90 }));
    expect(length(out)).toBeCloseTo(100, 6);
    expect(out[0].p.slice(0, 2)).toEqual([-50, 50]);
  });

  it('cuts an open line in the middle and does not wrap it', () => {
    const d = defaultShape('line', 100, 10);
    const subs = outline(d, vals(d));
    expect(trimOutline(subs, vals(d, { trimStart: 0.25, trimEnd: 0.75 }))).toEqual([{ p: [-25, 0, 25, 0], closed: false }]);
    expect(trimOutline(subs, vals(d, { trimStart: 0.5, trimEnd: 1, trimOffset: 180 }))).toEqual([]);
    expect(trimOutline(subs, vals(d, { trimStart: 0.5, trimEnd: 0.5 }))).toEqual([]);
  });

  it('returns nothing for an outline without length', () => {
    const d = square();
    expect(trimOutline(outline(d, vals(d, { w: 0, h: 0 })), vals(d, { trimEnd: 0.5 }))).toEqual([]);
  });
});

describe('stage extent and paints', () => {
  it('adds the stroke width to the box only when there is a stroke', () => {
    const d = square();
    expect(shapeExtent(d, vals(d))).toEqual({ w: 100, h: 100, cx: 0, cy: 0 });
    const s: ShapeDef = { ...d, stroke: { color: '#000000', width: 10 } };
    expect(shapeExtent(s, vals(s))).toEqual({ w: 110, h: 110, cx: 0, cy: 0 });
  });

  it('never gives a box smaller than eight pixels and keeps a line grabbable', () => {
    const d = square();
    expect(shapeExtent(d, vals(d, { w: 1, h: 2 }))).toMatchObject({ w: 8, h: 8 });
    const l = defaultShape('line', 100, 0);
    expect(shapeExtent(l, vals(l, { strokeW: 2 })).h).toBe(24);
  });

  it('centres the box of a path on its outline', () => {
    const d: ShapeDef = { type: 'path', w: 0, h: 0, fill: null, stroke: null, nodes: [node(10, 20), node(110, 60)] };
    expect(shapeExtent(d, vals(d))).toEqual({ w: 100, h: 40, cx: 60, cy: 40 });
  });

  it('falls back to two default stops and never returns more than the maximum', () => {
    expect(paintStops({ kind: 'linear', color: '#112233' })).toEqual(defaultStops('#112233'));
    expect(paintStops({ kind: 'linear', color: '#112233', stops: [{ o: 0.5, color: '#000000' }] })).toHaveLength(2);
    const many = Array.from({ length: MAX_STOPS + 4 }, (_, i) => ({ o: i / 12, color: '#000000' }));
    expect(paintStops({ kind: 'linear', color: '#112233', stops: many })).toHaveLength(MAX_STOPS);
  });

  it('accepts only a stroke with a numeric width', () => {
    const s = { color: '#000000', width: 3 };
    expect(normalizeStroke(s)).toBe(s);
    expect(normalizeStroke(null)).toBeNull();
    expect(normalizeStroke(undefined)).toBeNull();
    expect(normalizeStroke({ color: '#000000' } as never)).toBeNull();
  });
});
