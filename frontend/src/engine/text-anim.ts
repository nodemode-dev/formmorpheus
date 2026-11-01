// Text animators: which letters, words or lines are built on / off at a frame, and how far. Pure maths over glyph boxes.
import type { Ease } from './types';
import type { AnimDir, AnimOrder, TextAnim, TextAnimSide } from './text-rich';

/** Where in time a Text block is drawn. `inP` / `outP` / `typeP` are set when a Text Animation lane keys the progress (0..1). */
export interface TextPhase {
  /** Frames since the block started. */
  t: number;
  /** Block length in frames. */
  dur: number;
  fps: number;
  inP: number | null;
  outP: number | null;
  typeP: number | null;
  /** The app's ease curves (engine/keys.ts easeCurve), passed in so this file stays free of the key model. */
  ease: (e: Ease) => (u: number) => number;
}

export interface GlyphBox { x: number; y: number; w: number; size: number; line: number; word: number }

export interface GlyphFx {
  /** 0 or 1: hidden by the typewriter. */
  vis: number;
  /** 0..1: how far the glyph is built on (the background box follows it, fade or not). */
  show: number;
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  blur: number;
  /** Centre of the unit the glyph belongs to (turn and scale happen around it). */
  cx: number;
  cy: number;
}

export interface AnimResult {
  fx: GlyphFx[];
  /** Every glyph is in its resting place: the plain draw is exact. */
  settled: boolean;
  cursor: { x: number; y: number; size: number; glyph: number } | null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orders = new Map<string, Int32Array>();
/** Rank of every unit in the build order (0 goes first). */
export function orderOf(n: number, order: AnimOrder, seed: number): Int32Array {
  const key = `${n}|${order}|${seed}`;
  const have = orders.get(key);
  if (have) return have;
  const out = new Int32Array(n);
  if (order === 'forward') for (let i = 0; i < n; i++) out[i] = i;
  else if (order === 'backward') for (let i = 0; i < n; i++) out[i] = n - 1 - i;
  else if (order === 'center') {
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2) || a - b);
    idx.forEach((u, r) => { out[u] = r; });
  } else {
    const r = rng(seed), idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    idx.forEach((u, rank) => { out[u] = rank; });
  }
  if (orders.size > 64) orders.clear();
  orders.set(key, out);
  return out;
}

const VEC: Record<AnimDir, [number, number]> = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };

interface Groups { of: Int32Array; count: number; cx: number[]; cy: number[]; rank: Int32Array }

function groupsOf(glyphs: GlyphBox[], side: TextAnimSide): Groups {
  const of = new Int32Array(glyphs.length);
  const ids = new Map<number, number>();
  glyphs.forEach((g, i) => {
    const k = side.unit === 'char' ? i : side.unit === 'word' ? g.word : g.line;
    let id = ids.get(k);
    if (id === undefined) { id = ids.size; ids.set(k, id); }
    of[i] = id;
  });
  const count = ids.size, x0 = new Array<number>(count).fill(Infinity), x1 = new Array<number>(count).fill(-Infinity), ys = new Array<number>(count).fill(0), ns = new Array<number>(count).fill(0);
  glyphs.forEach((g, i) => { const id = of[i]; x0[id] = Math.min(x0[id], g.x); x1[id] = Math.max(x1[id], g.x + g.w); ys[id] += g.y; ns[id]++; });
  return { of, count, cx: x0.map((v, i) => (v + x1[i]) / 2), cy: ys.map((v, i) => v / Math.max(1, ns[i])), rank: orderOf(count, side.order, side.seed) };
}

export const sideSpan = (side: TextAnimSide, groups: number): number => Math.max(0, groups - 1) * side.stagger + side.dur;

/** Per glyph state of the animators at `ph`. */
export function evalAnim(anim: TextAnim, glyphs: GlyphBox[], ph: TextPhase): AnimResult {
  const n = glyphs.length;
  const fx: GlyphFx[] = glyphs.map((g) => ({ vis: 1, show: 1, alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, cx: g.x + g.w / 2, cy: g.y }));
  let settled = true;
  const sides: Array<['in' | 'out', TextAnimSide]> = [];
  if (anim.in) sides.push(['in', anim.in]);
  if (anim.out) sides.push(['out', anim.out]);
  for (const [which, side] of sides) {
    const grp = groupsOf(glyphs, side), span = sideSpan(side, grp.count), curve = ph.ease(side.ease);
    const keyed = which === 'in' ? ph.inP : ph.outP;
    const tt = keyed !== null ? clamp01(keyed) * span : which === 'in' ? ph.t - side.offset : ph.t - (ph.dur - side.offset - span);
    const v = VEC[side.slide?.dir ?? 'up'], d = side.slide?.dist ?? 0, sign = which === 'in' ? 1 : -1;
    const sc = side.scale ?? 1, rot = side.rotate ?? 0, bl = side.blur ?? 0;
    for (let i = 0; i < n; i++) {
      const g = grp.of[i], p = clamp01((tt - grp.rank[g] * side.stagger) / Math.max(0.0001, side.dur));
      // selector: a unit outside the window rests (treated as finished)
      const rg = side.range, pos = ((g + 0.5) / Math.max(1, grp.count)) * 100;
      const inWin = !rg || (pos >= rg.start + rg.shift && pos <= rg.end + rg.shift);
      const e = inWin ? curve(p) : which === 'in' ? 1 : 0;
      // h: how far the unit is from its resting state (1 hidden, 0 settled)
      const h = which === 'in' ? 1 - e : e;
      const f = fx[i];
      if (Math.abs(h) > 1e-4) settled = false;
      f.dx += v[0] * d * sign * h;
      f.dy += v[1] * d * sign * h;
      f.scale *= 1 + (sc - 1) * h;
      f.rot += rot * h * sign;
      f.blur += bl * Math.max(0, h);
      if (side.fade) f.alpha *= clamp01(1 - h);
      f.show *= clamp01(1 - Math.abs(h));
      f.cx = grp.cx[g];
      f.cy = grp.cy[g];
    }
  }
  let cursor: AnimResult['cursor'] = null;
  const ty = anim.type;
  if (ty && n) {
    let count = n;
    let typing = false;
    if (ph.typeP !== null) { count = Math.round(clamp01(ph.typeP) * n); typing = true; }
    else {
      const per = ty.cps / Math.max(1, ph.fps);
      count = Math.min(n, Math.max(0, Math.floor((ph.t - ty.offset) * per)));
      typing = count < n;
      if (ty.erase) {
        const start = ph.dur - (ty.eraseOffset ?? 0) - n / per;
        if (ph.t >= start) { count = Math.min(count, Math.max(0, n - Math.floor((ph.t - start) * per))); typing = true; }
      }
    }
    if (count < n || ty.erase || ph.typeP !== null) settled = false;
    for (let i = count; i < n; i++) fx[i].vis = 0;
    if (ty.cursor) {
      const on = typing || Math.floor(ph.t / Math.max(1, ph.fps / 2)) % 2 === 0;
      if (on) {
        const k = count > 0 ? count - 1 : 0, g = glyphs[k];
        cursor = { x: count > 0 ? g.x + g.w : g.x, y: g.y, size: g.size, glyph: k };
        settled = false;
      }
    }
  }
  return { fx, settled, cursor };
}
