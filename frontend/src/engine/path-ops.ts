// Pure edits of a content's motion path (the spatial tangents on its Move keys). Each returns a new Content.
import type { Content, Key, KeyLane, SpatialTangents } from './types';
import { handlesOf, laneSegments, pathNodes, smoothPathOn, type PathNode, type Pt } from './path';

const r1 = (n: number): number => Math.round(n * 10) / 10;

function moveLane(c: Content): KeyLane | null {
  return c.keys.find((l) => l.kind === 'move') ?? null;
}

function withMove(c: Content, lane: KeyLane): Content {
  return { ...c, keys: c.keys.map((l) => (l.kind === 'move' ? lane : l)) };
}

function nodeAt(lane: KeyLane, frame: number): { nodes: PathNode[]; i: number } | null {
  const xs = lane.channels.x, ys = lane.channels.y;
  if (!xs || !ys) return null;
  const nodes = pathNodes(xs, ys);
  const i = nodes.findIndex((n) => n.frame === frame);
  return i < 0 ? null : { nodes, i };
}

/** Replaces the x key at `frame` (the y channel is left alone). */
function putX(lane: KeyLane, frame: number, f: (k: Key) => Key): KeyLane {
  return { ...lane, channels: { ...lane.channels, x: lane.channels.x.map((k) => (k.frame === frame ? f(k) : k)) } };
}

function withSp(k: Key, sp: SpatialTangents | undefined): Key {
  const { sp: _old, ...rest } = k;
  void _old;
  return sp ? { ...rest, sp } : rest;
}

/** The nodes of the content's path (frames where x and y are both keyed) and the handles each has now, or null. */
export function pathView(c: Content): { nodes: PathNode[]; auto: boolean; handles: { in: Pt; out: Pt }[] } | null {
  const lane = moveLane(c);
  if (!lane) return null;
  const ls = laneSegments(lane);
  if (!ls) return null;
  return { nodes: ls.nodes, auto: ls.auto, handles: ls.nodes.map((_, i) => handlesOf(ls.nodes, i, ls.auto)) };
}

/** Moves the key at `frame` to a new position (x and y keys; the tangents come along as offsets). */
export function moveNode(c: Content, frame: number, x: number, y: number): Content {
  const lane = moveLane(c);
  if (!lane || !lane.channels.x || !lane.channels.y) return c;
  const nx = Math.round(x), ny = Math.round(y);
  const hit = lane.channels.x.find((k) => k.frame === frame), hity = lane.channels.y.find((k) => k.frame === frame);
  if (!hit || !hity || (hit.value === nx && hity.value === ny)) return c;
  return withMove(c, {
    ...lane,
    channels: {
      ...lane.channels,
      x: lane.channels.x.map((k) => (k.frame === frame ? { ...k, value: nx } : k)),
      y: lane.channels.y.map((k) => (k.frame === frame ? { ...k, value: ny } : k)),
    },
  });
}

/** Sets one handle of the key at `frame` (offset from the key). A smooth key keeps the other handle in line, a corner key leaves it. */
export function setHandle(c: Content, frame: number, side: 'in' | 'out', vec: Pt): Content {
  const lane = moveLane(c);
  const at = lane ? nodeAt(lane, frame) : null;
  if (!lane || !at) return c;
  const cur = handlesOf(at.nodes, at.i, smoothPathOn(lane));
  const old = at.nodes[at.i].xk.sp;
  const corner = !!old?.corner;
  const v: Pt = [r1(vec[0]), r1(vec[1])];
  const mine = Math.hypot(v[0], v[1]);
  const other = side === 'out' ? cur.in : cur.out;
  let o: Pt = other;
  if (!corner && mine > 0.01) {
    const len = Math.hypot(other[0], other[1]) || mine;
    o = [r1((-v[0] / mine) * len), r1((-v[1] / mine) * len)];
  }
  const sp: SpatialTangents = side === 'out' ? { in: o, out: v } : { in: v, out: o };
  if (corner) sp.corner = true;
  return withMove(c, putX(lane, frame, (k) => withSp(k, sp)));
}

/** Alt-click: a smooth key becomes a corner (no handles), a corner becomes smooth (automatic tangents written out). */
export function toggleCorner(c: Content, frame: number): Content {
  const lane = moveLane(c);
  const at = lane ? nodeAt(lane, frame) : null;
  if (!lane || !at) return c;
  const k = at.nodes[at.i].xk;
  if (k.sp?.corner) {
    const probe = at.nodes.map((n, j) => (j === at.i ? { ...n, xk: withSp(n.xk, undefined) } : n));
    const h = handlesOf(probe, at.i, true);
    const sp: SpatialTangents = { in: [r1(h.in[0]), r1(h.in[1])], out: [r1(h.out[0]), r1(h.out[1])] };
    return withMove(c, putX(lane, frame, (q) => withSp(q, sp)));
  }
  return withMove(c, putX(lane, frame, (q) => withSp(q, { in: [0, 0], out: [0, 0], corner: true })));
}

/** Linear path: straight on both sides of the key; off returns the key to automatic tangents. */
export function setLinear(c: Content, frame: number, on: boolean): Content {
  const lane = moveLane(c);
  if (!lane || !nodeAt(lane, frame)) return c;
  return withMove(c, putX(lane, frame, (q) => withSp(q, on ? { in: [0, 0], out: [0, 0], linear: true } : undefined)));
}

/** Whether the key at `frame` is a corner, linear, or smooth. */
export function nodeMode(c: Content, frame: number): 'smooth' | 'corner' | 'linear' | null {
  const lane = moveLane(c);
  const at = lane ? nodeAt(lane, frame) : null;
  if (!at) return null;
  const sp = at.nodes[at.i].xk.sp;
  return sp?.linear ? 'linear' : sp?.corner ? 'corner' : 'smooth';
}
