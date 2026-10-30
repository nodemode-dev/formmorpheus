// Flip content: reverse the time order of the selected contents on each track. The first one's start and the gaps
// between neighbours stay, so the run covers the same stretch of the movie. Pure model maths, no DOM.
import type { Movie } from './types';
import { sortContent } from './model';
import { OpError } from './ops';

export function flipOrder(movie: Movie, ids: string[]): Movie {
  const sel = new Set(ids);
  let changed = false;
  const tracks = movie.tracks.map((t) => {
    const items = sortContent(t.content);
    const picked = items.filter((c) => sel.has(c.id));
    if (picked.length < 2) return t;
    changed = true;
    const gaps = picked.slice(1).map((c, i) => c.start - (picked[i].start + picked[i].duration));
    const rev = [...picked].reverse();
    const starts: number[] = [picked[0].start];
    for (let i = 1; i < rev.length; i++) starts.push(starts[i - 1] + rev[i - 1].duration + gaps[i - 1]);
    const place = new Map(rev.map((c, i) => [c.id, starts[i]] as const));
    return { ...t, content: items.map((c) => (place.has(c.id) ? { ...c, start: place.get(c.id) as number } : c)) };
  });
  if (!changed) throw new OpError('Select two or more contents on one track to flip their order.');
  return { ...movie, tracks };
}
