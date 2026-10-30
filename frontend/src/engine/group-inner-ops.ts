// Edits of content inside a group (the Timeline's in-place group expand): move and trim reuse the top-level
// ops by treating the group's own tracks as a movie of their own. Pure, no DOM.
import * as ops from './ops';
import type { Content, Movie, Track } from './types';

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
