// A character walking from one spot to another: move keys on its block for exactly the walk, the walk action over the
// same frames at a pace that fits its stride, turned to face the way it goes. Pure, no DOM.
import { applyAction, characterOf, charFrame, loopPasses } from './action-ops';
import { rigged, WALK_FRAMES, WALK_STRIDE } from './actions-builtin';
import { hasCanvas } from './canvas';
import { updateDeep } from './character-ops';
import { setKeys } from './key-ops';
import { animate, type Animated } from './keys';
import { OpError } from './ops';
import { bounds, outline, shapeBase } from './shape';
import { apply, invert, levelFrameOf, ownMatrix, parentWorld, type Mat } from './transform';
import type { Content, Key, Movie, Track } from './types';

export type WalkSide = 'left' | 'right';
export type WalkHow = { to: [number, number] } | { in: WalkSide } | { off: WalkSide };
export interface Walked { movie: Movie; from: number; to: number }

const WALK_ID = 'builtin:walk';
const REF_LEG = 344;
const REF_HEIGHT = 900;
const MIN_FRAMES = 10;

type Box = [number, number, number, number];

function grow(b: Box | null, x0: number, y0: number, x1: number, y1: number): Box {
  return b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1];
}

/** What a content draws, unmoved, from the movie centre; parts in `skip` and hidden ones are left out. */
function extent(c: Content, m: Movie, skip: ReadonlySet<string>, out: Box | null = null): Box | null {
  let b = out;
  if (c.hidden || skip.has(c.id)) return b;
  if (c.kind === 'shape' && c.shape) { const r = bounds(outline(c.shape, shapeBase(c.shape))); if (r) b = grow(b, r[0], r[1], r[2], r[3]); }
  if (hasCanvas(c) && c.canvas) b = grow(b, c.canvas.x - m.width / 2, c.canvas.y - m.height / 2, c.canvas.x + c.canvas.w - m.width / 2, c.canvas.y + c.canvas.h - m.height / 2);
  for (const t of c.tracks) if (!t.hidden) for (const x of t.content) b = extent(x, m, skip, b);
  return b;
}

function inner(tracks: Track[], id: string): Content | null {
  for (const t of tracks) for (const c of t.content) {
    if (c.id === id) return c;
    if (c.kind === 'group') { const r = inner(c.tracks, id); if (r) return r; }
  }
  return null;
}

const partOf = (g: Content, name: string): Content | null => { const id = g.character?.parts[name]; return id ? inner(g.tracks, id) : null; };

/** The leg from hip to sole in the character's own pixels, measured as the starter actions measure it. */
function legLength(g: Content, m: Movie): number {
  const leg = partOf(g, 'leg-r');
  if (leg?.pivot) {
    let lo = extent(leg, m, new Set());
    if (lo && g.character && rigged(g.character.parts)) for (const n of ['shin-r', 'foot-r']) { const p = partOf(g, n); const r = p ? extent(p, m, new Set()) : null; if (r) lo = grow(lo, r[0], r[1], r[2], r[3]); }
    const len = lo ? (lo[3] - leg.pivot.y) * Math.abs(leg.transform.scale) : 0;
    if (len > 1) return REF_LEG * Math.min(20, Math.max(0.05, len / REF_LEG));
  }
  const all = extent(g, m, new Set());
  const tall = all ? all[3] - all[1] : 0;
  return REF_LEG * (tall > 1 ? Math.min(20, Math.max(0.05, tall / REF_HEIGHT)) : 1);
}

/** The walk heads toward +x unless the character is drawn the other way round (its arm-r on the right). */
function drawnBack(g: Content): boolean {
  const r = partOf(g, 'arm-r'), l = partOf(g, 'arm-l');
  if (!r || !l) return false;
  return r.transform.x + (r.pivot?.x ?? 0) > l.transform.x + (l.pivot?.x ?? 0);
}

const facing = (g: Content, a: Animated): number => (drawnBack(g) ? -1 : 1) * Math.sign(a.scaleX || 1) * (a.flipH ? -1 : 1);

function dropBetween(c: Content, lo: number, hi: number, ids: readonly string[]): Content {
  const lane = c.keys.find((l) => l.kind === 'move');
  if (!lane) return c;
  const channels: Record<string, Key[]> = { ...lane.channels };
  for (const id of ids) if (channels[id]) channels[id] = channels[id].filter((k) => k.frame <= lo || k.frame >= hi);
  return { ...c, keys: c.keys.map((l) => (l === lane ? { ...l, channels } : l)) };
}

/** The frames a walk of this character over `dist` of its parent's pixels takes, at the pace its stride sets. */
export function walkFrames(movie: Movie, g: Content, a: Animated, dist: number): number {
  const stride = WALK_STRIDE * legLength(g, movie) * Math.abs(a.scaleX || 1);
  const pass = (WALK_FRAMES * movie.fps) / 24 / Math.max(0.01, Math.abs(g.speed ?? 1));
  return Math.max(MIN_FRAMES, Math.round(dist / (stride / pass)));
}

/**
 * Walks the character from the movie frame `frame`: to a spot (`to`, the point its feet go to, in movie frame pixels as
 * `view` shows the movie: the Stage without its camera in Camera mode), in from off screen on a side to where it stands,
 * or off screen on a side. Its feet are the bottom middle of what it draws. One change, for one undo step.
 */
export function walkCharacter(movie: Movie, charId: string, frame: number, how: WalkHow, view: Movie = movie): Walked {
  const g = characterOf(movie, charId);
  const kf = Math.round(levelFrameOf(movie, g, frame) - g.start);
  if (kf < 0 || kf > g.duration - 1) throw new OpError('Move the Playhead over the character first.');
  const box = extent(g, movie, new Set(g.character.parts.shadow ? [g.character.parts.shadow] : []));
  if (!box) throw new OpError('This character draws nothing to walk.');
  const a = animate(g, kf);
  const pic: [number, number] = [movie.width / 2 + (box[0] + box[2]) / 2, movie.height / 2 + box[3]];
  const feet = (v: Animated): [number, number] => apply(ownMatrix(v, movie), pic[0], pic[1]);
  const here = feet(a);
  const up = (src: Movie): Mat | null => invert(parentWorld(src, g, frame));
  const offAt = (side: WalkSide): [number, number] => {
    const w = parentWorld(movie, g, frame), back = invert(w);
    if (!back) throw new OpError('This character cannot walk from here.');
    const at = apply(w, here[0], here[1]);
    const half = ((box[2] - box[0]) / 2) * Math.hypot(w[0], w[1]) * Math.abs(a.scaleX || 1) + movie.width * 0.02;
    return apply(back, side === 'left' ? -half : movie.width + half, at[1]);
  };
  let start = here, end = here;
  if ('to' in how) {
    const back = up(view);
    if (!back) throw new OpError('This character cannot walk from here.');
    end = apply(back, how.to[0], how.to[1]);
  } else if ('in' in how) start = offAt(how.in);
  else end = offAt(how.off);
  const dx = end[0] - start[0], dy = end[1] - start[1];
  if (Math.hypot(dx, dy) < 1) throw new OpError('The character already stands there.');
  const dir = Math.abs(dx) < 0.5 ? 0 : Math.sign(dx);
  const turn = dir !== 0 && dir !== facing(g, a);
  const turned: Animated = turn ? { ...a, scaleX: -a.scaleX } : a;
  const ref = turn ? feet(turned) : here;
  const pos = (p: [number, number]): Record<string, number> => ({ x: a.x + p[0] - ref[0], y: a.y + p[1] - ref[1] });
  const frames = walkFrames(movie, g, a, Math.max(Math.abs(dx), Math.abs(dy)));
  const last = frame + frames, kl = Math.round(levelFrameOf(movie, g, last) - g.start);
  if (last > movie.duration - 1 || kl > g.duration - 1) throw new OpError('The walk runs past the end of the character on the Timeline: lengthen its block or the movie, or start earlier.');
  const s0 = pos(start), s1 = pos(end);
  const moved = updateDeep(movie, g.id, (c) => {
    let out = dropBetween(c, kf, kl, ['x', 'y']);
    const jumps = Math.abs(s0.x - a.x) > 0.01 || Math.abs(s0.y - a.y) > 0.01;
    if (kf > 0 && (jumps || turn)) {
      const was = animate(c, kf - 1);
      out = setKeys(out, 'move', kf - 1, { x: was.x, y: was.y }, 'hold');
    }
    if (turn) {
      const k = c.transform.stretchX ?? 1, sx = a.scaleX / (k || 1);
      if (kf > 0) out = setKeys(out, 'move', kf - 1, { scaleX: sx }, 'hold');
      out = setKeys(out, 'move', kf, { scaleX: -sx }, 'hold');
    }
    out = setKeys(out, 'move', kf, s0, 'linear');
    return setKeys(out, 'move', kl, s1);
  });
  const mg = characterOf(moved, g.id);
  const from = charFrame(moved, mg, frame), to = charFrame(moved, mg, last);
  const pass = Math.max(1, Math.round((WALK_FRAMES * movie.fps) / 24));
  const done = applyAction(moved, g.id, WALK_ID, from, loopPasses(pass, Math.max(1, to - from)), to).movie;
  return { movie: done, from: frame, to: last };
}
