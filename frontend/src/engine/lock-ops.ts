// Track lock and "move onto a new track" (a drag dropped between lanes or below the last lane).
import { end, fits, sortContent } from './model';
import * as ops from './ops';
import type { Content, Movie, Track } from './types';

/** Lock or unlock a track. Absent means unlocked, so the field is only written when set. */
export function setTrackLocked(movie: Movie, trackId: string, locked: boolean): Movie {
  if (!movie.tracks.some((t) => t.id === trackId)) throw new ops.OpError('That track no longer exists.');
  return { ...movie, tracks: movie.tracks.map((t) => {
    if (t.id !== trackId || !!t.locked === locked) return t;
    const next: Track = { ...t };
    if (locked) next.locked = true; else delete next.locked;
    return next;
  }) };
}

export function setAllLocked(movie: Movie, locked: boolean): Movie {
  return movie.tracks.reduce((acc, t) => setTrackLocked(acc, t.id, locked), movie);
}

/** Moves the content to a track made at `at` (0 is the top). All of it lands on that one track, so it must not overlap itself. */
export function moveToNewTrack(movie: Movie, ids: string[], deltaFrames: number, at: number): Movie {
  const idSet = new Set(ids);
  const moving: Content[] = [];
  for (const t of movie.tracks) for (const c of t.content) if (idSet.has(c.id)) { if (t.locked) throw new ops.OpError('Track is locked'); moving.push(c); }
  if (!moving.length) throw new ops.OpError('That content no longer exists.');
  const dt = Math.max(-Math.min(...moving.map((c) => c.start)), deltaFrames);
  const placed = sortContent(moving.map((c) => ({ ...c, start: c.start + dt })));
  for (let i = 1; i < placed.length; i++) if (end(placed[i - 1]) > placed[i].start) throw new ops.OpError('No room on that track');
  const stripped: Movie = { ...movie, tracks: movie.tracks.map((t) => (t.content.some((c) => idSet.has(c.id)) ? { ...t, content: t.content.filter((c) => !idSet.has(c.id)) } : t)) };
  const added = ops.addTrack(stripped, at);
  // a track the move left empty goes with it, so dragging a lone block between lanes just reorders
  const emptied = new Set(movie.tracks.filter((t) => t.content.length && t.content.every((c) => idSet.has(c.id))).map((t) => t.id));
  const tracks = added.movie.tracks.filter((t) => !emptied.has(t.id)).map((t) => (t.id === added.track.id ? { ...t, content: placed } : t));
  return { ...added.movie, tracks };
}

/** Whether `start..start+duration` is free on the track at `index`, ignoring the moving content. */
export function roomOn(movie: Movie, index: number, start: number, duration: number, ignore: Set<string>): boolean {
  const t = movie.tracks[index];
  return !!t && !t.locked && fits(t, start, duration, ignore);
}
