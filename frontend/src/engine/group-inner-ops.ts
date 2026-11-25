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

/** The top-level group that holds `id` at any depth (null for a top-level block or an unknown id). */
export function outerGroup(tracks: Track[], id: string): Content | null {
  for (const t of tracks) for (const c of t.content) if (c.kind === 'group' && ownerGroup([{ ...t, content: [c] }], id)) return c;
  return null;
}

/** Edits one block wherever it sits: on a top-level track, or inside a group. */
export function updateAny(movie: Movie, id: string, fn: (c: Content) => Content): Movie {
  return movie.tracks.some((t) => t.content.some((c) => c.id === id)) ? ops.updateContent(movie, id, fn) : updateInner(movie, id, fn);
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

/** The group with this id, anywhere in the tracks. */
export function findGroup(tracks: Track[], gid: string): Content | null {
  for (const t of tracks) {
    for (const c of t.content) {
      if (c.kind !== 'group') continue;
      if (c.id === gid) return c;
      const deeper = findGroup(c.tracks, gid);
      if (deeper) return deeper;
    }
  }
  return null;
}

/** Like viaGroup, for a group named by its own id. */
function viaGroupId(movie: Movie, gid: string, fn: (m: Movie) => Movie): Movie {
  if (!findGroup(movie.tracks, gid)) throw new ops.OpError('That group no longer exists.');
  const swap = (tracks: Track[]): Track[] =>
    tracks.map((t) => ({
      ...t,
      content: t.content.map((c) => {
        if (c.id === gid) return { ...c, tracks: fn({ ...movie, tracks: c.tracks }).tracks };
        return c.kind === 'group' ? { ...c, tracks: swap(c.tracks) } : c;
      }),
    }));
  return { ...movie, tracks: swap(movie.tracks) };
}

/** Puts `item` (its start in the group's own frames) on the group's track `row`, or on a new inner track there when it does not fit. */
export function placeInGroup(movie: Movie, gid: string, item: Content, row = 0): Movie {
  return viaGroupId(movie, gid, (m) => ops.placeContent(m, m.tracks[row]?.id ?? null, item, row).movie);
}

/** A new empty track inside a group, above its row `at`. */
export function addInnerTrack(movie: Movie, gid: string, at = 0): Movie {
  return viaGroupId(movie, gid, (m) => ops.addTrack(m, at).movie);
}

/** Edits one block inside a group, whichever group holds it. */
export function updateInner(movie: Movie, id: string, fn: (c: Content) => Content): Movie {
  return viaGroup(movie, id, (m) => ops.updateContent(m, id, fn));
}

export function deleteInner(movie: Movie, ids: string[]): Movie {
  return viaGroup(movie, ids[0], (m) => ops.deleteContent(m, ids));
}

export function splitInner(movie: Movie, id: string, local: number): Movie {
  return viaGroup(movie, id, (m) => ops.splitContent(m, id, local).movie);
}

/** Takes a block out of its group and lays it on the top level: on track `lane`, or on a new track made at `lane` when `insert`. `frame` is the movie frame of its start. */
export function moveOutOfGroup(movie: Movie, id: string, lane: number, insert: boolean, frame: number): Movie {
  const g = ownerGroup(movie.tracks, id);
  const item = g?.tracks.flatMap((t) => t.content).find((c) => c.id === id);
  if (!g || !item) throw new ops.OpError('That content no longer exists.');
  const without = viaGroup(movie, id, (m) => ops.deleteContent(m, [id]));
  const placed = { ...item, start: Math.max(0, frame) };
  if (insert) return ops.placeContent(without, null, placed, lane).movie;
  return ops.placeContent(without, without.tracks[lane]?.id ?? null, placed, lane).movie;
}

/** Takes a top-level block into group `gid`, onto its row `row`, starting at group frame `local`. */
export function moveIntoGroup(movie: Movie, id: string, gid: string, row: number, local: number): Movie {
  const at = movie.tracks.find((t) => t.content.some((c) => c.id === id));
  const item = at?.content.find((c) => c.id === id);
  if (!at || !item) throw new ops.OpError('That content no longer exists.');
  if (item.id === gid || (item.kind === 'group' && findGroup(item.tracks, gid))) throw new ops.OpError('A group cannot go inside itself.');
  if (at.locked) throw new ops.OpError('Track is locked');
  const without = ops.deleteContent(movie, [id]);
  return placeInGroup(without, gid, { ...item, start: Math.max(0, local) }, row);
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
