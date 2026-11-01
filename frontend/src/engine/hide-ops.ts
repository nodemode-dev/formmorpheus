// A block hidden by itself (Content.hidden): the renderer draws a copy of the movie without it.
import * as ops from './ops';
import type { Content, Movie, Track } from './types';

/** Hide or show one block. Absent means shown, so the field is only written when set. */
export function setContentHidden(movie: Movie, id: string, hidden: boolean): Movie {
  return ops.updateContent(movie, id, (c) => {
    if (!!c.hidden === hidden) return c;
    const next: Content = { ...c };
    if (hidden) next.hidden = true; else delete next.hidden;
    return next;
  });
}

const anyHidden = (tracks: Track[]): boolean => tracks.some((t) => t.content.some((c) => c.hidden || (c.kind === 'group' && anyHidden(c.tracks))));

function strip(tracks: Track[]): Track[] {
  return tracks.map((t) => (anyHidden([t])
    ? { ...t, content: t.content.filter((c) => !c.hidden).map((c) => (c.kind === 'group' && anyHidden(c.tracks) ? { ...c, tracks: strip(c.tracks) } : c)) }
    : t));
}

const memo = new WeakMap<Movie, Movie>();

/** The movie as drawn: the same object when nothing is hidden, else one copy per movie object (so caches keyed on it stay valid). */
export function visibleMovie(movie: Movie): Movie {
  const have = memo.get(movie);
  if (have) return have;
  const out = anyHidden(movie.tracks) ? { ...movie, tracks: strip(movie.tracks) } : movie;
  memo.set(movie, out);
  return out;
}
