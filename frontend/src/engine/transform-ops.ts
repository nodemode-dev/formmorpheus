// Compose transform edits that are not a drag: flip, reset, nudge. Pure; each returns the new movie.
import { updateContent } from './ops';
import type { Content, Movie, Transform } from './types';

const noStretch = (t: Transform): Transform => {
  const { stretchX: _x, stretchY: _y, ...rest } = t;
  return rest;
};

/** Mirror around the pivot (the transform turns around it already). Keyframes are left alone. */
export function flip(movie: Movie, ids: string[], axis: 'h' | 'v'): Movie {
  let m = movie;
  for (const id of ids) {
    m = updateContent(m, id, (c: Content) => ({ ...c, transform: axis === 'h' ? { ...c.transform, flipH: !c.transform.flipH } : { ...c.transform, flipV: !c.transform.flipV } }));
  }
  return m;
}

/** Back to the default Compose transform: position, scale, stretch, rotation and flips. Keyframes and the pivot stay. */
export function resetTransform(movie: Movie, ids: string[]): Movie {
  let m = movie;
  for (const id of ids) m = updateContent(m, id, (c: Content) => ({ ...c, transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false } }));
  return m;
}

export function isDefaultTransform(t: Transform): boolean {
  return t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0 && !t.flipH && !t.flipV && (t.stretchX ?? 1) === 1 && (t.stretchY ?? 1) === 1;
}

/** Move by whole movie pixels in the content's parent space. */
export function nudge(movie: Movie, ids: string[], dx: number, dy: number): Movie {
  let m = movie;
  for (const id of ids) m = updateContent(m, id, (c: Content) => ({ ...c, transform: { ...c.transform, x: c.transform.x + dx, y: c.transform.y + dy } }));
  return m;
}

/** Store a one-axis stretch; a stretch of 1 is not written. */
export function withStretch(t: Transform, sx: number, sy: number): Transform {
  const out = noStretch(t);
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  if (r(sx) !== 1) out.stretchX = r(sx);
  if (r(sy) !== 1) out.stretchY = r(sy);
  return out;
}
