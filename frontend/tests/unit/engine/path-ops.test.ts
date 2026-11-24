import { describe, expect, it } from 'vitest';
import { content } from '@src/engine/model';
import { moveNode, nodeMode, pathView, setHandle, setLinear, toggleCorner } from '@src/engine/path-ops';
import type { Content, Key, SpatialTangents } from '@src/engine/types';

const k = (frame: number, value: number): Key => ({ frame, value, ease: 'linear' });

function moving(path = false): Content {
  return content('drawing', 0, 30, {
    keys: [{ kind: 'move', expanded: false, channels: { x: [k(0, 0), k(10, 90), k(20, 120)], y: [k(0, 0), k(10, 30), k(20, 60)] }, options: { path } }],
  });
}

const spAt = (c: Content, frame: number): SpatialTangents | undefined => c.keys[0].channels.x.find((q) => q.frame === frame)?.sp;

describe('pathView', () => {
  it('is null without a Move lane', () => {
    expect(pathView(content('drawing', 0, 10))).toBeNull();
  });

  it('lists the joint keys with their current handles', () => {
    const v = pathView(moving(true));
    expect(v?.nodes.map((n) => n.frame)).toEqual([0, 10, 20]);
    expect(v?.auto).toBe(true);
    expect(v?.handles[1]).toEqual({ in: [-20, -10], out: [20, 10] });
  });
});

describe('moveNode', () => {
  it('writes rounded x and y on the key and leaves the others', () => {
    const out = moveNode(moving(), 10, 50.4, 70.6);
    expect(out.keys[0].channels.x.map((q) => q.value)).toEqual([0, 50, 120]);
    expect(out.keys[0].channels.y.map((q) => q.value)).toEqual([0, 71, 60]);
  });

  it('returns the same content when nothing moves or no key sits there', () => {
    const c = moving();
    expect(moveNode(c, 10, 90, 30)).toBe(c);
    expect(moveNode(c, 11, 5, 5)).toBe(c);
  });
});

describe('setHandle', () => {
  it('keeps the other handle of a smooth key in line at its own length', () => {
    const out = setHandle(moving(), 10, 'out', [0, 50.04]);
    const sp = spAt(out, 10) as SpatialTangents;
    expect(sp.out).toEqual([0, 50]);
    expect(sp.in[0]).toBeCloseTo(0, 9);
    expect(sp.in[1]).toBeCloseTo(-31.6, 9);
    expect(sp.corner).toBeUndefined();
  });

  it('leaves the other handle of a corner key alone', () => {
    const corner = toggleCorner(moving(), 10);
    const out = setHandle(corner, 10, 'in', [-7, 3]);
    expect(spAt(out, 10)).toEqual({ in: [-7, 3], out: [0, 0], corner: true });
  });

  it('ignores a frame without a joint key', () => {
    const c = moving();
    expect(setHandle(c, 4, 'out', [1, 1])).toBe(c);
  });
});

describe('toggleCorner, setLinear and nodeMode', () => {
  it('turns a smooth key into a corner and back into written smooth tangents', () => {
    const c = moving();
    expect(nodeMode(c, 10)).toBe('smooth');
    const corner = toggleCorner(c, 10);
    expect(nodeMode(corner, 10)).toBe('corner');
    expect(spAt(corner, 10)).toEqual({ in: [0, 0], out: [0, 0], corner: true });
    const smooth = toggleCorner(corner, 10);
    expect(nodeMode(smooth, 10)).toBe('smooth');
    expect(spAt(smooth, 10)).toEqual({ in: [-20, -10], out: [20, 10] });
  });

  it('marks a key linear and clears the tangents when turned off', () => {
    const lin = setLinear(moving(), 10, true);
    expect(nodeMode(lin, 10)).toBe('linear');
    const off = setLinear(lin, 10, false);
    expect(spAt(off, 10)).toBeUndefined();
    expect(nodeMode(off, 10)).toBe('smooth');
  });

  it('reports no mode where there is no key and does not touch the y channel', () => {
    const c = moving();
    expect(nodeMode(c, 3)).toBeNull();
    expect(nodeMode(content('text', 0, 5), 0)).toBeNull();
    expect(toggleCorner(c, 10).keys[0].channels.y).toBe(c.keys[0].channels.y);
  });
});
