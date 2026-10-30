// Whole-track Cut, Copy, Duplicate and Paste. A copied or duplicated track lands directly above the track it
// was made from (or above the chosen one). Pure model code: no DOM.
import { uid } from './model';
import { OpError } from './ops';
import type { Content, Movie, Track } from './types';

let clip: Track | null = null;

export function hasTrackClip(): boolean {
  return clip !== null;
}

export function copyTrack(t: Track): void {
  clip = JSON.parse(JSON.stringify(t)) as Track;
}

/** A deep copy with fresh ids; a parent inside the copied track follows the copy, one outside stays. */
export function cloneTrack(t: Track): Track {
  const raw = JSON.parse(JSON.stringify(t)) as Track;
  const ids = new Map<string, string>();
  const fresh = (x: Content): Content => {
    const id = uid('c');
    ids.set(x.id, id);
    return { ...x, id, tracks: x.tracks.map((s) => ({ ...s, id: uid('t'), content: s.content.map(fresh) })) };
  };
  const relink = (x: Content): Content => {
    const next: Content = x.tracks.length ? { ...x, tracks: x.tracks.map((s) => ({ ...s, content: s.content.map(relink) })) } : x;
    return next.parent && ids.has(next.parent) ? { ...next, parent: ids.get(next.parent) } : next;
  };
  const content = raw.content.map(fresh).map(relink);
  return { ...raw, id: uid('t'), name: t.name.endsWith(' copy') ? t.name : `${t.name} copy`, content };
}

function insertAt(m: Movie, index: number, t: Track): Movie {
  const tracks = [...m.tracks];
  tracks.splice(Math.max(0, Math.min(index, tracks.length)), 0, t);
  return { ...m, tracks };
}

function indexOfTrack(m: Movie, id: string): number {
  const i = m.tracks.findIndex((t) => t.id === id);
  if (i < 0) throw new OpError('That track no longer exists.');
  return i;
}

export function duplicateTrack(m: Movie, id: string): { movie: Movie; track: Track } {
  const i = indexOfTrack(m, id);
  const t = cloneTrack(m.tracks[i]);
  return { movie: insertAt(m, i, t), track: t };
}

/** Pastes the track clipboard above `id` (or on top when null). */
export function pasteTrack(m: Movie, id: string | null): { movie: Movie; track: Track } {
  if (!clip) throw new OpError('Copy a track first.');
  const t = cloneTrack(clip);
  return { movie: insertAt(m, id ? indexOfTrack(m, id) : 0, t), track: t };
}
