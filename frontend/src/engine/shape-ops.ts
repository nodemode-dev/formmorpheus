// Edits of Shape, Solid and Adjustment content: building new blocks, writing one parameter (saved value or key),
// pen-path node maths. Pure, no DOM.
import { animate, laneOf } from './keys';
import * as keyOps from './key-ops';
import { bounds, defaultStops, defaultShape, hexOf, outline, relevantChannels, resolveShape, rgbOf, shapeBase, shapeExtent, type ShapeVals } from './shape';
import type { BezNode, ShapeDef, ShapePaint, ShapeStroke, ShapeType } from './shape-types';
import type { Content, Ease, Movie } from './types';

/** The Shape lane (collapsed on creation) with a first key at `at` and optionally one at the start. */
function ensureLane(c: Content, at: number, keyAtStart: boolean, ease: Ease): Content {
  const had = !!laneOf(c, 'shape');
  const out = keyOps.addLane(c, 'shape', at, keyAtStart, ease);
  return had ? out : keyOps.setExpanded(out, 'shape', false);
}

/** Content fields for a new Shape of `type` with the given size, centred at (cx, cy) from the movie centre. */
export function shapeExtra(type: ShapeType, w: number, h: number, cx = 0, cy = 0, rotation = 0, nodes?: BezNode[], closed = false, color = '#3a8bff'): Partial<Content> {
  const d: ShapeDef = defaultShape(type, Math.max(1, w), Math.max(1, h));
  if (type === 'path') {
    d.nodes = nodes ?? [];
    d.closed = closed;
    d.fill = closed ? { kind: 'solid', color } : null;
    d.stroke = closed ? null : { color, width: 12, cap: 'round', join: 'round' };
    const b = bounds(outline(d, shapeBase(d)));
    if (b) { d.w = b[2] - b[0]; d.h = b[3] - b[1]; }
  } else {
    if (d.fill) d.fill = { ...d.fill, color };
    if (d.stroke) d.stroke = { ...d.stroke, color };
  }
  const name = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line', arrow: 'Arrow', path: 'Path' }[type];
  return { name, shape: d, transform: { x: cx, y: cy, scale: 1, rotation, flipH: false, flipV: false } };
}

/** A new Solid is a neutral deep slate, so a Shape (blue-ish accent) and a Title read on it. */
export function solidExtra(color = '#263238'): Partial<Content> {
  return { name: 'Solid', shape: { type: 'rect', w: 0, h: 0, fill: { kind: 'solid', color }, stroke: null } };
}

const lumaOf = (hex: string): number => { const c = rgbOf(hex); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

/** The colour most visible on the Stage at `frame`: the lowest Solid or solid-filled Shape that covers it, else the background. */
function colorUnder(m: Movie, frame: number): string {
  for (let t = m.tracks.length - 1; t >= 0; t--) {
    for (const c of m.tracks[t].content) {
      if ((c.kind === 'solid' || c.kind === 'shape') && c.shape?.fill && (c.shape.fill.alpha ?? 1) > 0.5 && c.start <= frame && frame < c.start + c.duration) {
        if (c.kind === 'solid' || (c.shape.w >= m.width * 0.8 && c.shape.h >= m.height * 0.8)) return c.shape.fill.color;
      }
    }
  }
  return m.background;
}

/** A default shape colour that contrasts what is under the new shape (accent blue, orange, white, or deep navy; the best of them). */
export function shapeColorOver(m: Movie | null, frame: number): string {
  const under = m && !m.transparent ? colorUnder(m, frame) : '#ffffff';
  const lu = lumaOf(under);
  const u = rgbOf(under);
  let best = '#3a8bff', score = -1;
  for (const cand of ['#3a8bff', '#ff8a2a', '#ffffff', '#16213a', '#f2c230']) {
    const c = rgbOf(cand);
    const dl = Math.abs(lumaOf(cand) - lu);
    const dh = Math.hypot(c[0] - u[0], c[1] - u[1], c[2] - u[2]) / 1.7;
    const s = dl * 1.5 + dh;
    if (s > score) { score = s; best = cand; }
  }
  return best;
}

/** An Adjustment mask outline: a soft ellipse in the middle of the movie. */
export function maskShape(movie: Movie): ShapeDef {
  return { type: 'ellipse', w: Math.round(movie.width * 0.6), h: Math.round(movie.height * 0.6), fill: { kind: 'solid', color: '#ffffff' }, stroke: null, feather: Math.round(Math.min(movie.width, movie.height) * 0.08) };
}

// ---- writing one parameter -------------------------------------------------------------------------------

function paintOf(d: ShapeDef): ShapePaint {
  return d.fill ?? { kind: 'solid', color: '#3a8bff' };
}

function strokeOf(d: ShapeDef): ShapeStroke {
  return d.stroke ?? { color: '#ffffff', width: 0, cap: 'round', join: 'round' };
}

/** The saved value of one channel set to `v` (the unkeyed state). */
export function setBase(d: ShapeDef, id: string, v: number): ShapeDef {
  const n = { ...d };
  const fill = (): ShapePaint => (n.fill = { ...paintOf(d) });
  const stroke = (): ShapeStroke => (n.stroke = { ...strokeOf(d) });
  const part = (hex: string, i: 0 | 1 | 2): string => { const c = rgbOf(hex); c[i] = Math.min(1, Math.max(0, v)); return hexOf(c[0], c[1], c[2]); };
  switch (id) {
    case 'w': n.w = v; break;
    case 'h': n.h = v; break;
    case 'radius': n.radius = v; break;
    case 'sides': n.sides = Math.round(v); break;
    case 'points': n.points = Math.round(v); break;
    case 'inner': n.inner = v; break;
    case 'trimStart': n.trimStart = v; break;
    case 'trimEnd': n.trimEnd = v; break;
    case 'trimOffset': n.trimOffset = v; break;
    case 'feather': n.feather = v; break;
    case 'fillR': { const f = fill(); f.color = part(f.color, 0); break; }
    case 'fillG': { const f = fill(); f.color = part(f.color, 1); break; }
    case 'fillB': { const f = fill(); f.color = part(f.color, 2); break; }
    case 'fillA': { const f = fill(); f.alpha = v; if (v > 0 && !d.fill) n.fill = f; break; }
    case 'ga': fill().angle = v; break;
    case 'gcx': fill().cx = v; break;
    case 'gcy': fill().cy = v; break;
    case 'strokeW': stroke().width = v; break;
    case 'strokeR': { const s = stroke(); s.color = part(s.color, 0); break; }
    case 'strokeG': { const s = stroke(); s.color = part(s.color, 1); break; }
    case 'strokeB': { const s = stroke(); s.color = part(s.color, 2); break; }
    case 'strokeA': stroke().alpha = v; break;
    case 'dash': stroke().dash = v; break;
    case 'gap': stroke().gap = v; break;
    case 'dashOffset': stroke().dashOffset = v; break;
    default: {
      const mc = /^g(\d)([RGB])$/.exec(id);
      if (mc) {
        const f = fill();
        const stops = (f.stops && f.stops.length >= 2 ? f.stops : defaultStops(f.color)).map((s) => ({ ...s }));
        const i = Number(mc[1]);
        if (stops[i]) { stops[i].color = part(stops[i].color, mc[2] === 'R' ? 0 : mc[2] === 'G' ? 1 : 2); if (i === 0) f.color = stops[i].color; }
        f.stops = stops;
        break;
      }
      const m = /^o(\d)$/.exec(id);
      if (m) {
        const f = fill();
        const stops = (f.stops && f.stops.length >= 2 ? f.stops : defaultStops(f.color)).map((s) => ({ ...s }));
        const i = Number(m[1]);
        if (stops[i]) stops[i].o = Math.min(1, Math.max(0, v));
        f.stops = stops;
      }
    }
  }
  return n;
}

/** Replaces the saved shape of a content. */
export function withShape(c: Content, fn: (d: ShapeDef) => ShapeDef): Content {
  return c.shape ? { ...c, shape: fn(c.shape) } : c;
}

/** True when this channel already has keys, so an edit must write a key. */
export function isKeyed(c: Content, id: string): boolean {
  return !!laneOf(c, 'shape')?.channels[id]?.length;
}

/**
 * One parameter edited at content-local frame `local`: a key when the channel is keyed (or `forceKey`), else the saved
 * value. Several channels may change at once (a colour).
 */
export function writeParams(c: Content, vals: Record<string, number>, local: number, addKeyAtStart: boolean, ease: Ease, forceKey = false): Content {
  let out = c;
  const keyed: Record<string, number> = {};
  for (const id of Object.keys(vals)) {
    if (forceKey || isKeyed(out, id)) keyed[id] = vals[id];
    else out = withShape(out, (d) => setBase(d, id, vals[id]));
  }
  if (Object.keys(keyed).length) {
    const base = laneOf(out, 'shape') ? out : ensureLane(out, local, addKeyAtStart, ease);
    out = keyOps.setKeys(base, 'shape', local, keyed);
  }
  return out;
}

/** Starts animating a parameter: a key at the Playhead with its current value (the lane is made on first use). */
export function keyParam(c: Content, id: string, local: number, value: number, addKeyAtStart: boolean, ease: Ease): Content {
  const base = laneOf(c, 'shape') ? c : ensureLane(c, local, addKeyAtStart, ease);
  return keyOps.setKeys(base, 'shape', local, { [id]: value });
}

/** Removes every key of a parameter, leaving it at its value at `local`. */
export function unkeyParam(c: Content, id: string, local: number, value: number): Content {
  const lane = laneOf(c, 'shape');
  if (!lane) return c;
  const channels = { ...lane.channels };
  delete channels[id];
  const keys = (c.keys ?? []).map((l) => (l === lane ? { ...l, channels } : l)).filter((l) => l.kind !== 'shape' || Object.keys(l.channels).length > 0);
  return withShape({ ...c, keys }, (d) => setBase(d, id, value));
}

/** The Stage box of a Shape, Solid or masked Adjustment at `frame`: size and centre offset in movie pixels; null for other content. */
export function stageBox(c: Content, frame: number, movie: Movie): { w: number; h: number; cx: number; cy: number } | null {
  if (!c.shape || (c.kind !== 'shape' && c.kind !== 'solid' && c.kind !== 'adjust')) return null;
  const v = resolveShape(c.shape, animate(c, frame - c.start).shape);
  if (c.kind === 'solid') return { w: v.w > 0 ? v.w : movie.width, h: v.h > 0 ? v.h : movie.height, cx: 0, cy: 0 };
  return shapeExtent(c.shape, v);
}

export function currentVals(c: Content, over: ShapeVals | undefined): ShapeVals {
  const v = shapeBase(c.shape);
  if (over) for (const k in over) v[k] = over[k];
  return v;
}

export function channelsOf(c: Content): string[] {
  return relevantChannels(c.shape);
}

// ---- pen path --------------------------------------------------------------------------------------------

/** Centres a node list on its bounding box; returns the nodes and the centre that moved to the origin. */
export function centreNodes(nodes: BezNode[]): { nodes: BezNode[]; cx: number; cy: number } {
  const d: ShapeDef = { type: 'path', w: 0, h: 0, fill: null, stroke: null, nodes, closed: false };
  const b = bounds(outline(d, shapeBase(d)));
  if (!b) return { nodes, cx: 0, cy: 0 };
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return { nodes: nodes.map((n) => ({ ...n, x: n.x - cx, y: n.y - cy })), cx, cy };
}

/** Recomputes the saved bounding box of a path. */
export function refitPath(d: ShapeDef): ShapeDef {
  const b = bounds(outline(d, shapeBase(d)));
  return b ? { ...d, w: b[2] - b[0], h: b[3] - b[1] } : d;
}

/** Inserts a node into segment `seg` (between node seg and seg + 1) at parameter t, keeping the curve's shape. */
export function splitSegment(nodes: BezNode[], seg: number, t: number): BezNode[] {
  const a = nodes[seg], b = nodes[(seg + 1) % nodes.length];
  const p0 = [a.x, a.y], p1 = [a.x + a.ox, a.y + a.oy], p2 = [b.x + b.ix, b.y + b.iy], p3 = [b.x, b.y];
  const lerp = (p: number[], q: number[]): number[] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const p01 = lerp(p0, p1), p12 = lerp(p1, p2), p23 = lerp(p2, p3), a1 = lerp(p01, p12), b1 = lerp(p12, p23), m = lerp(a1, b1);
  const mid: BezNode = { x: m[0], y: m[1], ix: a1[0] - m[0], iy: a1[1] - m[1], ox: b1[0] - m[0], oy: b1[1] - m[1] };
  const next = nodes.map((n) => ({ ...n }));
  next[seg] = { ...a, ox: p01[0] - a.x, oy: p01[1] - a.y };
  const bi = (seg + 1) % nodes.length;
  next[bi] = { ...b, ix: p23[0] - b.x, iy: p23[1] - b.y };
  next.splice(seg + 1, 0, mid);
  return next;
}

/** Nearest point of the path to (x, y): segment index, t and distance, by sampling each segment. */
export function nearestOnPath(nodes: BezNode[], closed: boolean, x: number, y: number): { seg: number; t: number; dist: number } | null {
  const last = closed ? nodes.length : nodes.length - 1;
  let best: { seg: number; t: number; dist: number } | null = null;
  for (let s = 0; s < last; s++) {
    const a = nodes[s], b = nodes[(s + 1) % nodes.length];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = 1 - t;
      const px = u * u * u * a.x + 3 * u * u * t * (a.x + a.ox) + 3 * u * t * t * (b.x + b.ix) + t * t * t * b.x;
      const py = u * u * u * a.y + 3 * u * u * t * (a.y + a.oy) + 3 * u * t * t * (b.y + b.iy) + t * t * t * b.y;
      const dist = Math.hypot(px - x, py - y);
      if (!best || dist < best.dist) best = { seg: s, t, dist };
    }
  }
  return best;
}
