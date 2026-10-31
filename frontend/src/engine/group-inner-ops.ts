// Edits of content inside a group (the Timeline's in-place group expand): move and trim reuse the top-level
// ops by treating the group's own tracks as a movie of their own. Pure, no DOM.
import * as ops from './ops';
import type { Content, Movie, Track, Transition } from './types';
import { previousOf } from './transitions';

/** The group whose tracks directly hold `id`, anywhere in the movie. */
export function ownerGroup(tracks: Track[], id: string): Content | null {
  for (const t of tracks) {
    for (const c of t.content) {
      if (c.kind !== 'group') continue;
      if (c.tracks.some((x) => x.content.some((y) => y.id === id))) return c;
      const deeper = ownerGroup(c.tracks, id);
      if (deeper) return deeper;
    }
  }
  return null;
}

/** Runs `fn` on the group's tracks as if they were the movie's, and writes the result back. */
function viaGroup(movie: Movie, innerId: string, fn: (m: Movie) => Movie): Movie {
  const g = ownerGroup(movie.tracks, innerId);
  if (!g) throw new ops.OpError('That content no longer exists.');
  const swap = (tracks: Track[]): Track[] =>
    tracks.map((t) => ({
      ...t,
      content: t.content.map((c) => {
        if (c.id === g.id) return { ...c, tracks: fn({ ...movie, tracks: c.tracks }).tracks };
        return c.kind === 'group' ? { ...c, tracks: swap(c.tracks) } : c;
      }),
    }));
  return { ...movie, tracks: swap(movie.tracks) };
}

export function moveInner(movie: Movie, ids: string[], deltaFrames: number, toTrackDelta = 0): Movie {
  return viaGroup(movie, ids[0], (m) => ops.moveContent(m, ids, deltaFrames, toTrackDelta));
}

export function trimInner(movie: Movie, id: string, edge: 'start' | 'end', deltaFrames: number): Movie {
  return viaGroup(movie, id, (m) => ops.trimContent(m, id, edge, deltaFrames, false));
}

/** The block inside `g` that starts a cut (it touches a block before it on its track) nearest group frame `local`, within `reach` frames. */
export function cutNear(g: Content, local: number, reach = 12): Content | null {
  let best: Content | null = null, dist = reach + 1;
  for (const t of g.tracks) {
    for (const b of t.content) {
      if (!previousOf(t.content, b)) continue;
      const d = Math.abs(b.start - local);
      if (d < dist) { dist = d; best = b; }
    }
  }
  return best;
}

/** Sets (or, with null, removes) the transition into block `innerId` of a group, exactly as on a top-level track. */
export function setInnerTransition(movie: Movie, innerId: string, tr: Transition | null): Movie {
  return viaGroup(movie, innerId, (m) => ops.updateContent(m, innerId, (c) => {
    const n: Content = { ...c };
    if (tr) n.transition = tr; else delete n.transition;
    return n;
  }));
}
