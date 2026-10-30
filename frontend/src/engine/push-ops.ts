// Push content: move content in time and carry the content it touches along (a plain move refuses to overlap).
// Keys are local to a content's first frame, so only starts change. Pure model maths, no DOM.
import type { Movie } from './types';
import { sortContent } from './model';
import { OpError } from './ops';

/** Move the given contents `delta` frames (positive later, negative earlier), pushing their neighbours on each track. */
export function pushContent(movie: Movie, ids: string[], delta: number): Movie {
  if (!ids.length || !delta) return movie;
  const sel = new Set(ids);
  let touched = false;
  const tracks = movie.tracks.map((t) => {
    if (!t.content.some((c) => sel.has(c.id))) return t;
    touched = true;
    const items = sortContent(t.content);
    const starts = items.map((c) => c.start + (sel.has(c.id) ? delta : 0));
    if (delta > 0) {
      let edge = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < items.length; i++) {
        starts[i] = Math.max(starts[i], edge);
        edge = starts[i] + items[i].duration;
      }
    } else {
      let edge = Number.POSITIVE_INFINITY;
      for (let i = items.length - 1; i >= 0; i--) {
        starts[i] = Math.min(starts[i], edge - items[i].duration);
        edge = starts[i];
      }
      if (starts[0] < 0) throw new OpError('There is no room before the start of the movie.');
    }
    return { ...t, content: items.map((c, i) => (starts[i] === c.start ? c : { ...c, start: starts[i] })) };
  });
  if (!touched) throw new OpError('That content no longer exists.');
  return keepInside({ ...movie, tracks });
}

/** Refuses a result whose content passes the movie's end (a push or an extend-and-push at the last frame). */
export function keepInside(movie: Movie): Movie {
  for (const t of movie.tracks) for (const c of t.content) if (c.start + c.duration > movie.duration) throw new OpError('There is no room after the end of the movie.');
  return movie;
}
