// Motion paths: between two Move keys the position follows a cubic Bezier (spatial tangents on the x key),
// and the temporal ease maps time to a fraction of the curve's ARC LENGTH, so speed along the curve follows the ease.
// Pure, no DOM. keys.ts passes the ease in (`progress`), which keeps this file free of an import cycle.
import type { Key, KeyLane } from './types';

export type Pt = [number, number];

/** A frame where both x and y are keyed. */
export interface PathNode {
  frame: number;
  x: number;
  y: number;
  xk: Key;
  yk: Key;
  /** Indices in the x and y key lists. */
  xi: number;
  yi: number;
}

export interface PathSeg {
  /** Bezier points: key a, out handle, in handle of key b, key b. */
  p: [Pt, Pt, Pt, Pt];
  len: number;
  /** Cumulative arc length at t = i / ARC_N. */
  table: Float64Array;
}

interface Built {
  ys: Key[];
  auto: boolean;
  nodes: PathNode[];
  segs: (PathSeg | null | undefined)[];
}

const ARC_N = 64;
const CACHE = new WeakMap<Key[], Built>();

export function pathNodes(xs: Key[], ys: Key[]): PathNode[] {
  const nodes: PathNode[] = [];
  let j = 0;
  for (let i = 0; i < xs.length; i++) {
    while (j < ys.length && ys[j].frame < xs[i].frame) j++;
    if (j < ys.length && ys[j].frame === xs[i].frame) nodes.push({ frame: xs[i].frame, x: xs[i].value, y: ys[j].value, xk: xs[i], yk: ys[j], xi: i, yi: j });
  }
  return nodes;
}

export function smoothPathOn(lane: KeyLane): boolean {
  return lane.options.path === true;
}

function build(lane: KeyLane): Built | null {
  const xs = lane.channels.x, ys = lane.channels.y;
  if (!xs || !ys || xs.length < 2 || ys.length < 2) return null;
  const auto = smoothPathOn(lane);
  const hit = CACHE.get(xs);
  if (hit && hit.ys === ys && hit.auto === auto) return hit;
  const nodes = pathNodes(xs, ys);
  const b: Built = { ys, auto, nodes, segs: new Array(Math.max(0, nodes.length - 1)) };
  CACHE.set(xs, b);
  return b;
}

/** Automatic (smooth) tangent at node i: Catmull-Rom, a sixth of the neighbours' span; ends use a third of the chord. */
function autoVec(nodes: PathNode[], i: number): Pt | null {
  if (i <= 0 || i >= nodes.length - 1) return null;
  return [(nodes[i + 1].x - nodes[i - 1].x) / 6, (nodes[i + 1].y - nodes[i - 1].y) / 6];
}

/** The out (to node i+1) and in (from node i-1) handles a node has right now, as offsets from it: its own, or automatic. */
export function handlesOf(nodes: PathNode[], i: number, auto: boolean): { in: Pt; out: Pt } {
  const n = nodes[i];
  const sp = n.xk.sp;
  const next = nodes[i + 1], prev = nodes[i - 1];
  const chordOut: Pt = next ? [(next.x - n.x) / 3, (next.y - n.y) / 3] : [0, 0];
  const chordIn: Pt = prev ? [(prev.x - n.x) / 3, (prev.y - n.y) / 3] : [0, 0];
  if (sp && sp.linear) return { in: chordIn, out: chordOut };
  if (sp) return { in: [sp.in[0], sp.in[1]], out: [sp.out[0], sp.out[1]] };
  if (auto) {
    const v = autoVec(nodes, i);
    if (v) return { in: [-v[0], -v[1]], out: v };
  }
  return { in: chordIn, out: chordOut };
}

/** Whether the span from node i to i+1 is curved (a spatial tangent is set on a side, or the lane smooths its path). */
function curved(nodes: PathNode[], i: number, auto: boolean): boolean {
  if (auto) return true;
  const a = nodes[i].xk.sp, b = nodes[i + 1].xk.sp;
  return !!((a && !a.linear) || (b && !b.linear));
}

function bez(p: [Pt, Pt, Pt, Pt], t: number, out: Pt): void {
  const v = 1 - t, a = v * v * v, b = 3 * v * v * t, c = 3 * v * t * t, d = t * t * t;
  out[0] = a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0];
  out[1] = a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1];
}

export function segmentOf(nodes: PathNode[], i: number, auto: boolean): PathSeg {
  const a = nodes[i], b = nodes[i + 1];
  const ho = handlesOf(nodes, i, auto).out, hi = handlesOf(nodes, i + 1, auto).in;
  const p: [Pt, Pt, Pt, Pt] = [[a.x, a.y], [a.x + ho[0], a.y + ho[1]], [b.x + hi[0], b.y + hi[1]], [b.x, b.y]];
  const table = new Float64Array(ARC_N + 1);
  const cur: Pt = [0, 0];
  let px = p[0][0], py = p[0][1], sum = 0;
  for (let k = 1; k <= ARC_N; k++) {
    bez(p, k / ARC_N, cur);
    sum += Math.hypot(cur[0] - px, cur[1] - py);
    table[k] = sum;
    px = cur[0];
    py = cur[1];
  }
  return { p, len: sum, table };
}

/** Point at a fraction 0..1 of the segment's arc length. */
export function pointAtArc(seg: PathSeg, f: number, out: Pt): void {
  const target = (f < 0 ? 0 : f > 1 ? 1 : f) * seg.len;
  const tb = seg.table;
  let lo = 0, hi = ARC_N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tb[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = tb[hi] - tb[lo];
  const t = (lo + (span > 1e-12 ? (target - tb[lo]) / span : 0)) / ARC_N;
  bez(seg.p, t, out);
}

/** The built segments of a lane, null where a span is straight (no tangents) or not made of two adjacent joint keys. */
export function laneSegments(lane: KeyLane): { nodes: PathNode[]; auto: boolean; seg: (i: number) => PathSeg | null } | null {
  const b = build(lane);
  if (!b || b.nodes.length < 2) return null;
  return {
    nodes: b.nodes,
    auto: b.auto,
    seg: (i) => {
      let s = b.segs[i];
      if (s === undefined) {
        const a = b.nodes[i], n = b.nodes[i + 1];
        s = a.xi + 1 === n.xi && a.yi + 1 === n.yi && a.xk.ease !== 'hold' && curved(b.nodes, i, b.auto) ? segmentOf(b.nodes, i, b.auto) : null;
        b.segs[i] = s;
      }
      return s;
    },
  };
}

/**
 * Position on the path at `frame`, or false when this frame is not inside a curved span (the channels then evaluate on their own).
 * `progress(a, b, frame)`: the eased fraction 0..1 of the span from x key a to b (keys.ts supplies it, so custom eases apply).
 */
export function pathAt(lane: KeyLane, frame: number, progress: (a: Key, b: Key, frame: number) => number, out: Pt): boolean {
  const ls = laneSegments(lane);
  if (!ls) return false;
  const nodes = ls.nodes;
  if (frame <= nodes[0].frame || frame >= nodes[nodes.length - 1].frame) return false;
  let lo = 0, hi = nodes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const seg = ls.seg(lo);
  if (!seg) return false;
  pointAtArc(seg, progress(nodes[lo].xk, nodes[hi].xk, frame), out);
  return true;
}
