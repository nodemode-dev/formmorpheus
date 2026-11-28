// The content picked inside a group (groupCtx.picked: a block clicked in an opened group on the Timeline, or a part
// double-clicked on the Stage) as the Stage edits it. While its outermost group is the one selected content, the
// Stage's box, handles, pivot and Move keys act on the picked content; writes go through updateAny. No Perform.
import { canvasOf } from '../engine/canvas';
import { findDeep } from '../engine/character-ops';
import type { Engine } from '../engine/engine';
import { groupCtx } from '../engine/group-ctx';
import { animate } from '../engine/keys';
import { end, locate } from '../engine/model';
import { outline, resolveShape, trimmed, trimOutline, type ShapeVals, type Sub } from '../engine/shape';
import { stageBox } from '../engine/shape-ops';
import { invert, levelFrameOf, mul, viewMat, worldMatrix, type Mat } from '../engine/transform';
import type { Content, Movie } from '../engine/types';

export interface Picked {
  group: Content;
  part: Content;
  /** The part with its start moved so that `engine.frame - view.start` is its own frame (what `animate` reads). */
  view: Content;
  locked: boolean;
}

let memo: { m: Movie; id: string; sel: string; frame: number; mode: string; out: Picked | null } | null = null;

export function pickedPart(engine: Engine): Picked | null {
  const m = engine.movie, id = groupCtx.picked;
  if (!m || !id || engine.mode === 'perform' || engine.selection.content.length !== 1) return null;
  const sel = engine.selection.content[0], frame = engine.frame;
  if (memo && memo.m === m && memo.id === id && memo.sel === sel && memo.frame === frame && memo.mode === engine.mode) return memo.out;
  let out: Picked | null = null;
  const f = findDeep(m, id);
  if (f && f.groups.length && f.groups[0].id === sel) {
    const lf = levelFrameOf(m, f.content, frame);
    const top = locate(m, sel);
    out = { group: f.groups[0], part: f.content, view: { ...f.content, start: frame - (lf - f.content.start) }, locked: !!top?.track.locked || !!f.track.locked };
  }
  memo = { m, id, sel, frame, mode: engine.mode, out };
  return out;
}

/** What the Stage edits: the picked part (while its group shows), else the selection. */
export function stageTargets(engine: Engine): Content[] {
  const p = pickedPart(engine);
  if (!p) return engine.selected;
  return engine.isOver(p.group) ? [p.view] : [];
}

/** A content the Stage edits, by id: the picked part as `stageTargets` gives it, or a top-level block. */
export function stageFind(engine: Engine, m: Movie, id: string): { content: Content; locked: boolean } | null {
  const p = pickedPart(engine);
  if (p && p.part.id === id) return { content: p.view, locked: p.locked };
  const at = locate(m, id);
  return at ? { content: at.content, locked: !!at.track.locked } : null;
}

type Rect = [number, number, number, number];

/** A drawn block's box in its own picture space (movie pixels from the top left), at its own frame `lf`. */
function ownBox(c: Content, lf: number, m: Movie): Rect | null {
  if (c.kind === 'audio' || c.kind === 'group') return null;
  const sb = stageBox(c, lf, m);
  if (sb) {
    const v = c.kind === 'shape' && c.shape ? shapeVals(c, lf) : null;
    const pad = v && c.shape?.stroke && v.strokeW > 0 ? (c.shape.stroke.align && c.shape.stroke.align !== 'center' ? v.strokeW : v.strokeW / 2) : 0;
    const x = m.width / 2 + sb.cx, y = m.height / 2 + sb.cy;
    return [x - sb.w / 2 - pad, y - sb.h / 2 - pad, x + sb.w / 2 + pad, y + sb.h / 2 + pad];
  }
  const a = c.kind === 'image' && c.asset ? m.assets[c.asset] : undefined;
  if (a) return [(m.width - a.width) / 2, (m.height - a.height) / 2, (m.width + a.width) / 2, (m.height + a.height) / 2];
  const k = canvasOf(c, m);
  return [k.x, k.y, k.x + k.w, k.y + k.h];
}

/** Every drawn block at or under `c` that shows at movie frame `frame`, with its box. */
function leaves(m: Movie, c: Content, frame: number, out: Array<{ c: Content; box: Rect }>): void {
  if (c.hidden) return;
  const lf = levelFrameOf(m, c, frame);
  if (lf < c.start || lf >= end(c)) return;
  if (c.kind === 'group') { for (const t of c.tracks) if (!t.hidden) for (const x of t.content) leaves(m, x, frame, out); return; }
  const box = ownBox(c, lf, m);
  if (box) out.push({ c, box });
}

const apply = (s: Mat, x: number, y: number): [number, number] => [s[0] * x + s[2] * y + s[4], s[1] * x + s[3] * y + s[5]];

const shapeVals = (c: Content, lf: number): ShapeVals => resolveShape(c.shape, animate(c, lf - c.start).shape);

const HIT_SLOP_PX = 3;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function winding(s: Sub, x: number, y: number): number {
  let w = 0;
  const p = s.p, n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if (yj <= y) { if (yi > y && (xi - xj) * (y - yj) - (x - xj) * (yi - yj) > 0) w++; }
    else if (yi <= y && (xi - xj) * (y - yj) - (x - xj) * (yi - yj) < 0) w--;
  }
  return w;
}

function nearRun(runs: Sub[], x: number, y: number, r: number): boolean {
  for (const s of runs) {
    const p = s.p, n = p.length / 2;
    if (n === 1 && Math.hypot(x - p[0], y - p[1]) <= r) return true;
    const last = s.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      if (segDist(x, y, p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1]) <= r) return true;
    }
  }
  return false;
}

/** Whether a Shape paints the point (x, y) of its own picture space (movie pixels from the top left), within `slop`. */
function shapePaints(c: Content, lf: number, m: Movie, x: number, y: number, slop: number): boolean {
  const d = c.shape;
  if (!d) return false;
  const v = shapeVals(c, lf);
  const subs = outline(d, v);
  if (!subs.length) return false;
  const u = x - m.width / 2, w = y - m.height / 2;
  const closed = subs.filter((s) => s.closed);
  if (d.fill && v.fillA > 0 && closed.length) {
    let k = 0;
    for (const s of closed) k += winding(s, u, w);
    if (k !== 0) return true;
  }
  const st = d.stroke;
  const runs = st && v.strokeW > 0 && v.strokeA > 0 ? (trimmed(v) ? trimOutline(subs, v) : subs) : [];
  const half = st && st.align && st.align !== 'center' ? v.strokeW : v.strokeW / 2;
  if (runs.length && nearRun(runs, u, w, half + slop)) return true;
  return slop > 0 && d.fill !== null && v.fillA > 0 && nearRun(closed, u, w, slop);
}

/** Whether a drawn block paints the Stage point (x, y) through `s` (its picture space to the Stage): a Shape by its outline and stroke, anything else by its box. */
function paints(m: Movie, l: { c: Content; box: Rect }, frame: number, s: Mat, x: number, y: number, slopPx: number): boolean {
  const i = invert(s);
  if (!i) return false;
  const [u, v] = apply(i, x, y);
  const b = l.box;
  const scale = Math.sqrt(Math.abs(s[0] * s[3] - s[1] * s[2]));
  const slop = scale > 0 ? slopPx / scale : 0;
  if (u < b[0] - slop || u > b[2] + slop || v < b[1] - slop || v > b[3] + slop) return false;
  if (l.c.kind !== 'shape' || !l.c.shape) return true;
  return shapePaints(l.c, levelFrameOf(m, l.c, frame), m, u, v, slop);
}

/** The content of `group`'s own tracks (top track first) drawn under the Stage point (x, y); `m` is the movie as the Stage draws it. */
export function partAt(m: Movie, group: Content, frame: number, view: { scale: number; ox: number; oy: number }, x: number, y: number): string | null {
  const vm = viewMat(view);
  const drawn: Array<{ id: string; l: { c: Content; box: Rect }; s: Mat }> = [];
  for (const t of group.tracks) {
    if (t.hidden) continue;
    for (const c of t.content) {
      const ls: Array<{ c: Content; box: Rect }> = [];
      leaves(m, c, frame, ls);
      for (const l of ls) drawn.push({ id: c.id, l, s: mul(vm, worldMatrix(m, l.c, frame)) });
    }
  }
  for (const slop of [0, HIT_SLOP_PX]) for (const d of drawn) if (paints(m, d.l, frame, d.s, x, y, slop)) return d.id;
  return null;
}

/** A group part's box in its own picture space, round what it draws now ({w, h} and the centre's offset from the movie centre). */
export function partBox(m: Movie, part: Content, frame: number): { w: number; h: number; cx: number; cy: number } | null {
  if (part.kind !== 'group') return null;
  const inv = invert(worldMatrix(m, part, frame));
  if (!inv) return null;
  const ls: Array<{ c: Content; box: Rect }> = [];
  for (const t of part.tracks) if (!t.hidden) for (const x of t.content) leaves(m, x, frame, ls);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of ls) {
    const s = mul(inv, worldMatrix(m, l.c, frame));
    for (const [u, v] of [[l.box[0], l.box[1]], [l.box[2], l.box[1]], [l.box[2], l.box[3]], [l.box[0], l.box[3]]]) {
      const [px, py] = apply(s, u, v);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 - m.width / 2, cy: (y0 + y1) / 2 - m.height / 2 };
}
