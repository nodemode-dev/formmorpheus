// The content picked inside a group (groupCtx.picked: a block clicked in an opened group on the Timeline, or a part
// double-clicked on the Stage) as the Stage edits it. While its outermost group is the one selected content, the
// Stage's box, handles, pivot and Move keys act on the picked content; writes go through updateAny. No Perform.
import { canvasOf } from '../engine/canvas';
import { findDeep } from '../engine/character-ops';
import type { Engine } from '../engine/engine';
import { groupCtx } from '../engine/group-ctx';
import { end, locate } from '../engine/model';
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
  if (sb) { const x = m.width / 2 + sb.cx, y = m.height / 2 + sb.cy; return [x - sb.w / 2, y - sb.h / 2, x + sb.w / 2, y + sb.h / 2]; }
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

function inQuad(s: Mat, b: Rect, x: number, y: number): boolean {
  const i = invert(s);
  if (!i) return false;
  const [u, v] = apply(i, x, y);
  return u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3];
}

/** The content of `group`'s own tracks (top track first) drawn under the Stage point (x, y); `m` is the movie as the Stage draws it. */
export function partAt(m: Movie, group: Content, frame: number, view: { scale: number; ox: number; oy: number }, x: number, y: number): string | null {
  const vm = viewMat(view);
  for (const t of group.tracks) {
    if (t.hidden) continue;
    for (const c of t.content) {
      const ls: Array<{ c: Content; box: Rect }> = [];
      leaves(m, c, frame, ls);
      for (const l of ls) if (inQuad(mul(vm, worldMatrix(m, l.c, frame)), l.box, x, y)) return c.id;
    }
  }
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
