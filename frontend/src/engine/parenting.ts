// Parenting edits: link a content to a parent, unlink it keeping its place on the Stage. Pure, no DOM.
import { animate } from './keys';
import * as keyOps from './key-ops';
import { OpError } from './ops';
import { decompose, findContent, invert, mul, parentProblem, parentWorld, worldMatrix } from './transform';
import type { Content, Movie, Track } from './types';

function mapContent(tracks: Track[], id: string, fn: (c: Content) => Content): Track[] {
  return tracks.map((t) => {
    if (!t.content.some((c) => c.id === id || c.kind === 'group')) return t;
    return { ...t, content: t.content.map((c) => (c.id === id ? fn(c) : c.kind === 'group' ? { ...c, tracks: mapContent(c.tracks, id, fn) } : c)) };
  });
}

function update(movie: Movie, id: string, fn: (c: Content) => Content): Movie {
  return { ...movie, tracks: mapContent(movie.tracks, id, fn) };
}

/** Makes `parentId` the parent of `childId`. Refuses (OpError, with a message) a loop, itself, or its own subtree. */
export function setParent(movie: Movie, childId: string, parentId: string): Movie {
  const why = parentProblem(movie, childId, parentId);
  if (why) throw new OpError(why);
  return update(movie, childId, (c) => ({ ...c, parent: parentId }));
}

/**
 * Removes the link and bakes the pose: the content's Move and Scale values are rewritten so it sits where it
 * showed at `frame` (movie frame), keys at that frame included. Later keys keep their parent-relative numbers.
 */
export function unparent(movie: Movie, childId: string, frame: number): Movie {
  const child = findContent(movie, childId);
  if (!child) throw new OpError('That content no longer exists.');
  if (!child.parent) return movie;
  const local = Math.round(frame) - child.start;
  const a = animate(child, local);
  const free = update(movie, childId, (c) => {
    const { parent: _drop, ...rest } = c;
    return rest as Content;
  });
  // the pose it shows now, as the free content's own matrix inside the camera and groups only
  const world = worldMatrix(movie, child, frame, a);
  const above = parentWorld(free, findContent(free, childId) as Content, frame);
  const inv = invert(above);
  if (!inv) return free;
  const d = decompose(mul(inv, world), movie, a.px ?? 0, a.py ?? 0);
  const round = (n: number, k: number): number => Math.round(n * k) / k;
  const t = { x: round(d.x, 100), y: round(d.y, 100), scale: round((d.scaleX + d.scaleY) / 2, 10000), rotation: round(d.rotation, 100) };
  return update(free, childId, (c) => {
    let out: Content = { ...c, transform: { ...c.transform, x: t.x, y: t.y, scale: t.scale, rotation: t.rotation, flipH: d.flipH, flipV: false } };
    if (c.keys.some((l) => l.kind === 'move')) {
      const at = Math.max(0, Math.min(c.duration - 1, local));
      out = keyOps.setKeys(out, 'move', at, { x: t.x, y: t.y, scaleX: round(d.scaleX, 10000), scaleY: round(d.scaleY, 10000), rotation: t.rotation });
    }
    return out;
  });
}
