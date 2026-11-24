import { describe, expect, it } from 'vitest';
import {
  centreNodes, channelsOf, currentVals, isKeyed, keyParam, maskShape, nearestOnPath, refitPath, setBase, shapeColorOver,
  shapeExtra, solidExtra, splitSegment, stageBox, unkeyParam, withShape, writeParams,
} from '@src/engine/shape-ops';
import { defaultShape } from '@src/engine/shape';
import type { BezNode, ShapeDef } from '@src/engine/shape-types';
import type { Content, Movie } from '@src/engine/types';

const node = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0): BezNode => ({ x, y, ix, iy, ox, oy });

function shapeBlock(shape: ShapeDef | undefined, over: Record<string, unknown> = {}): Content {
  return { id: 's1', kind: 'shape', name: 'Shape', start: 0, duration: 50, offset: 0, keys: [], shape, transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false }, ...over } as unknown as Content;
}

function movie(over: Record<string, unknown> = {}): Movie {
  return { fps: 24, duration: 100, width: 1920, height: 1080, background: '#000000', tracks: [], ...over } as unknown as Movie;
}

function pointAt(a: BezNode, b: BezNode, t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * u * a.x + 3 * u * u * t * (a.x + a.ox) + 3 * u * t * t * (b.x + b.ix) + t * t * t * b.x,
    u * u * u * a.y + 3 * u * u * t * (a.y + a.oy) + 3 * u * t * t * (b.y + b.iy) + t * t * t * b.y,
  ];
}

describe('new content', () => {
  it('builds a shape of at least one pixel at the given place with the given colour', () => {
    const x = shapeExtra('rect', 0, -5, 30, -40, 15, undefined, false, '#ff0000');
    expect(x.shape).toMatchObject({ type: 'rect', w: 1, h: 1, stroke: null });
    expect(x.shape?.fill?.color).toBe('#ff0000');
    expect(x.transform).toMatchObject({ x: 30, y: -40, rotation: 15, scale: 1 });
  });

  it('colours the stroke of a line', () => {
    const x = shapeExtra('line', 200, 10, 0, 0, 0, undefined, false, '#00ff00');
    expect(x.shape?.fill).toBeNull();
    expect(x.shape?.stroke?.color).toBe('#00ff00');
  });

  it('strokes an open path, fills a closed one and saves its bounding box', () => {
    const nodes = [node(-50, -20), node(50, -20), node(50, 20)];
    const open = shapeExtra('path', 1, 1, 0, 0, 0, nodes, false, '#112233').shape;
    expect(open?.fill).toBeNull();
    expect(open?.stroke?.color).toBe('#112233');
    expect(open).toMatchObject({ w: 100, h: 40, closed: false });
    const closed = shapeExtra('path', 1, 1, 0, 0, 0, nodes, true, '#112233').shape;
    expect(closed?.stroke).toBeNull();
    expect(closed?.fill).toEqual({ kind: 'solid', color: '#112233' });
  });

  it('makes a solid that covers the whole movie', () => {
    const s = solidExtra('#445566').shape;
    expect(s).toMatchObject({ w: 0, h: 0, stroke: null });
    expect(s?.fill?.color).toBe('#445566');
    expect(stageBox(shapeBlock(s, { kind: 'solid' }), 0, movie())).toEqual({ w: 1920, h: 1080, cx: 0, cy: 0 });
  });

  it('sizes an adjustment mask from the movie', () => {
    expect(maskShape(movie())).toMatchObject({ type: 'ellipse', w: 1152, h: 648, feather: 86, stroke: null });
  });

  it('picks a default colour that contrasts what is under the shape', () => {
    expect(shapeColorOver(movie({ background: '#000000' }), 0)).toBe('#ffffff');
    expect(shapeColorOver(movie({ background: '#ffffff' }), 0)).toBe('#16213a');
    expect(shapeColorOver(null, 0)).toBe('#16213a');
  });

  it('judges contrast against a solid that covers the frame, not the background', () => {
    const solid = shapeBlock(solidExtra('#ffffff').shape, { kind: 'solid', start: 10, duration: 10 });
    const m = movie({ background: '#000000', tracks: [{ id: 't', content: [solid] }] });
    expect(shapeColorOver(m, 15)).toBe('#16213a');
    expect(shapeColorOver(m, 20)).toBe('#ffffff');
  });
});

describe('setBase', () => {
  it('writes sizes as given and rounds counts', () => {
    const d = defaultShape('star', 100, 100);
    expect(setBase(d, 'w', 250.5).w).toBe(250.5);
    expect(setBase(d, 'points', 6.6).points).toBe(7);
    expect(setBase(d, 'sides', 3.2).sides).toBe(3);
    expect(setBase(d, 'trimEnd', 0.3).trimEnd).toBe(0.3);
  });

  it('never changes the shape it was given', () => {
    const d = defaultShape('rect', 100, 100);
    const before = JSON.stringify(d);
    setBase(d, 'fillA', 0.3);
    setBase(d, 'strokeW', 9);
    setBase(d, 'o1', 0.2);
    setBase(d, 'w', 5);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('gives a shape without a fill one when its opacity is raised', () => {
    const out = setBase(defaultShape('line'), 'fillA', 0.5);
    expect(out.fill).toMatchObject({ kind: 'solid', alpha: 0.5 });
  });

  it('gives a shape without a stroke one when a stroke value is written', () => {
    const out = setBase(defaultShape('rect'), 'strokeW', 6);
    expect(out.stroke).toMatchObject({ width: 6, color: '#ffffff' });
    expect(setBase(out, 'dash', 4).stroke).toMatchObject({ width: 6, dash: 4 });
  });

  it('creates default gradient stops on first use and clamps a stop position', () => {
    const d: ShapeDef = { ...defaultShape('rect'), fill: { kind: 'linear', color: '#112233' } };
    const out = setBase(d, 'o1', 2);
    expect(out.fill?.stops).toHaveLength(2);
    expect(out.fill?.stops?.[1].o).toBe(1);
    expect(out.fill?.stops?.[0].color).toBe('#112233');
    expect(setBase(d, 'o0', -1).fill?.stops?.[0].o).toBe(0);
  });

  it('ignores a stop that does not exist and an unknown channel', () => {
    const d: ShapeDef = { ...defaultShape('rect'), fill: { kind: 'linear', color: '#000000', stops: [{ o: 0, color: '#000000' }, { o: 1, color: '#ffffff' }] } };
    expect(setBase(d, 'o5', 0.5).fill?.stops).toEqual(d.fill?.stops);
    expect(setBase(d, 'nonsense', 3)).toEqual(d);
  });
});

describe('writing parameters on content', () => {
  it('writes the saved value when the channel has no keys', () => {
    const c = shapeBlock(defaultShape('rect', 100, 100));
    const out = writeParams(c, { w: 300, radius: 12 }, 5, false, 'linear');
    expect(out.shape).toMatchObject({ w: 300, radius: 12, h: 100 });
    expect(out.keys).toEqual([]);
    expect(c.shape?.w).toBe(100);
  });

  it('leaves content without a shape alone', () => {
    const c = shapeBlock(undefined, { kind: 'video' });
    expect(withShape(c, (d) => ({ ...d, w: 1 }))).toBe(c);
    expect(stageBox(c, 0, movie())).toBeNull();
    expect(unkeyParam(c, 'w', 0, 5)).toBe(c);
  });

  it('keys a parameter, then writes later edits as keys and keeps the saved value', () => {
    const c = shapeBlock(defaultShape('rect', 100, 100));
    expect(isKeyed(c, 'w')).toBe(false);
    const keyed = keyParam(c, 'w', 0, 100, false, 'linear');
    expect(isKeyed(keyed, 'w')).toBe(true);
    const edited = writeParams(keyed, { w: 300 }, 20, false, 'linear');
    expect(edited.shape?.w).toBe(100);
    expect(stageBox(edited, 0, movie())?.w).toBe(100);
    expect(stageBox(edited, 20, movie())?.w).toBe(300);
    const mid = stageBox(edited, 10, movie())?.w ?? 0;
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(300);
  });

  it('removes every key of a parameter and leaves it at the given value', () => {
    const c = shapeBlock(defaultShape('rect', 100, 100));
    const keyed = writeParams(keyParam(c, 'w', 0, 100, false, 'linear'), { w: 300 }, 20, false, 'linear');
    const out = unkeyParam(keyed, 'w', 10, 180);
    expect(isKeyed(out, 'w')).toBe(false);
    expect(out.shape?.w).toBe(180);
    expect(stageBox(out, 20, movie())?.w).toBe(180);
  });

  it('reads current values with overrides on top and lists channels by type', () => {
    const c = shapeBlock(defaultShape('polygon', 100, 80));
    expect(currentVals(c, undefined)).toMatchObject({ w: 100, h: 80, sides: 5 });
    expect(currentVals(c, { sides: 9 }).sides).toBe(9);
    expect(channelsOf(c)).toContain('sides');
    expect(channelsOf(c)).not.toContain('radius');
  });
});

describe('pen path', () => {
  it('centres nodes on their bounding box and reports the old centre', () => {
    const out = centreNodes([node(10, 20), node(110, 60)]);
    expect(out).toMatchObject({ cx: 60, cy: 40 });
    expect(out.nodes.map((n) => [n.x, n.y])).toEqual([[-50, -20], [50, 20]]);
  });

  it('leaves a single node where it is', () => {
    const nodes = [node(10, 20)];
    expect(centreNodes(nodes)).toEqual({ nodes, cx: 0, cy: 0 });
  });

  it('refits the saved box of a path to its outline', () => {
    const d: ShapeDef = { type: 'path', w: 1, h: 1, fill: null, stroke: null, nodes: [node(0, 0), node(30, 0), node(30, 70)] };
    expect(refitPath(d).w).toBeCloseTo(30, 9);
    expect(refitPath(d).h).toBeCloseTo(70, 9);
    const empty: ShapeDef = { ...d, nodes: [] };
    expect(refitPath(empty)).toBe(empty);
  });

  it('splits a straight segment at its middle', () => {
    const out = splitSegment([node(0, 0), node(100, 0)], 0, 0.5);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ x: 50, y: 0 });
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[2]).toMatchObject({ x: 100, y: 0 });
  });

  it('keeps the shape of a curve when a node is inserted', () => {
    const a = node(0, 0, 0, 0, 30, 90), b = node(120, 10, -40, -70, 0, 0);
    const t = 0.3;
    const out = splitSegment([a, b], 0, t);
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const left = pointAt(out[0], out[1], s), want = pointAt(a, b, s * t);
      expect(left[0]).toBeCloseTo(want[0], 9);
      expect(left[1]).toBeCloseTo(want[1], 9);
      const right = pointAt(out[1], out[2], s), want2 = pointAt(a, b, t + s * (1 - t));
      expect(right[0]).toBeCloseTo(want2[0], 9);
      expect(right[1]).toBeCloseTo(want2[1], 9);
    }
  });

  it('splits the closing segment of a closed path and leaves the input alone', () => {
    const nodes = [node(0, 0), node(100, 0), node(100, 100)];
    const out = splitSegment(nodes, 2, 0.5);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ x: 50, y: 50 });
    expect(nodes).toHaveLength(3);
  });

  it('finds the nearest point on a path', () => {
    const nodes = [node(0, 0), node(100, 0), node(100, 100)];
    const hit = nearestOnPath(nodes, false, 100, 50);
    expect(hit).toMatchObject({ seg: 1, t: 0.5 });
    expect(hit?.dist).toBeCloseTo(0, 9);
    const near = nearestOnPath(nodes, false, 25, 10);
    expect(near?.seg).toBe(0);
    expect(near?.dist).toBeCloseTo(10, 1);
  });

  it('searches the closing segment only on a closed path', () => {
    const nodes = [node(0, 0), node(100, 0), node(100, 100)];
    expect(nearestOnPath(nodes, true, 40, 60)?.seg).toBe(2);
    expect(nearestOnPath(nodes, false, 40, 60)?.seg).not.toBe(2);
  });

  it('finds nothing on a path with a single node', () => {
    expect(nearestOnPath([node(0, 0)], false, 5, 5)).toBeNull();
  });
});
