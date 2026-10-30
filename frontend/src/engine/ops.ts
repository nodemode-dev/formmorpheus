import type { BlendMode, Content, Highlight, MaskMode, Movie, PlaybackMode, Track, Transform } from './types';
import { clampSide, content as makeContent, end, fits, sourceFrames, sortContent, track as makeTrack, trackName, uid, contentEnd } from './model';
import { clampFps } from './time';

export class OpError extends Error {}

function withTracks(movie: Movie, tracks: Track[]): Movie {
  return { ...movie, tracks };
}

function replaceTrack(movie: Movie, trackId: string, fn: (t: Track) => Track): Movie {
  let hit = false;
  const tracks = movie.tracks.map((t) => {
    if (t.id !== trackId) return t;
    hit = true;
    return fn(t);
  });
  if (!hit) throw new OpError('That track no longer exists.');
  return withTracks(movie, tracks);
}

function findTrackOf(movie: Movie, contentId: string): Track {
  const t = movie.tracks.find((tr) => tr.content.some((c) => c.id === contentId));
  if (!t) throw new OpError('That content no longer exists.');
  return t;
}

export function updateContent(movie: Movie, id: string, fn: (c: Content) => Content): Movie {
  const t = findTrackOf(movie, id);
  return replaceTrack(movie, t.id, (tr) => ({ ...tr, content: tr.content.map((c) => (c.id === id ? fn(c) : c)) }));
}

function cloneContent(c: Content, start: number): Content {
  const copy = JSON.parse(JSON.stringify(c)) as Content;
  const fresh = (x: Content): Content => ({ ...x, id: uid('c'), tracks: x.tracks.map((t) => ({ ...t, id: uid('t'), content: t.content.map(fresh) })) });
  return { ...fresh(copy), start };
}

export function addTrack(movie: Movie, at = 0, name?: string): { movie: Movie; track: Track } {
  const t = makeTrack(name ?? trackName(movie));
  const tracks = [...movie.tracks];
  tracks.splice(Math.max(0, Math.min(at, tracks.length)), 0, t);
  return { movie: withTracks(movie, tracks), track: t };
}

export function deleteTrack(movie: Movie, trackId: string): Movie {
  if (!movie.tracks.some((t) => t.id === trackId)) throw new OpError('That track no longer exists.');
  return withTracks(movie, movie.tracks.filter((t) => t.id !== trackId));
}

export function moveTrack(movie: Movie, trackId: string, to: number): Movie {
  const from = movie.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) throw new OpError('That track no longer exists.');
  const tracks = [...movie.tracks];
  const [t] = tracks.splice(from, 1);
  tracks.splice(Math.max(0, Math.min(to, tracks.length)), 0, t);
  return withTracks(movie, tracks);
}

export function renameTrack(movie: Movie, trackId: string, name: string): Movie {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new OpError('A track needs a name.');
  return replaceTrack(movie, trackId, (t) => ({ ...t, name: clean }));
}

export function setTrackHidden(movie: Movie, trackId: string, hidden: boolean): Movie {
  return replaceTrack(movie, trackId, (t) => ({ ...t, hidden }));
}

export function setAllHidden(movie: Movie, hidden: boolean): Movie {
  return withTracks(movie, movie.tracks.map((t) => (t.hidden === hidden ? t : { ...t, hidden })));
}

export function removeEmptySection(movie: Movie, trackId: string, frame: number): Movie {
  return replaceTrack(movie, trackId, (t) => {
    const items = sortContent(t.content);
    const before = items.filter((c) => end(c) <= frame);
    const after = items.filter((c) => c.start > frame);
    if (items.some((c) => c.start <= frame && frame < end(c))) throw new OpError('The Playhead is over content, not an empty section.');
    const gapStart = before.length ? end(before[before.length - 1]) : 0;
    const gapEnd = after.length ? after[0].start : gapStart;
    const shift = gapEnd - gapStart;
    if (shift <= 0) return t;
    return { ...t, content: items.map((c) => (c.start > frame ? { ...c, start: c.start - shift } : c)) };
  });
}

export function placeContent(movie: Movie, trackId: string | null, item: Content, trackIndex = 0): { movie: Movie; trackId: string } {
  let m = movie;
  let target = trackId ? m.tracks.find((t) => t.id === trackId) : undefined;
  if (target && !fits(target, item.start, item.duration)) target = undefined;
  if (!target) {
    const added = addTrack(m, trackIndex);
    m = added.movie;
    target = added.track;
  }
  const id = target.id;
  m = replaceTrack(m, id, (t) => ({ ...t, content: sortContent([...t.content, item]) }));
  return { movie: m, trackId: id };
}

export function moveContent(movie: Movie, ids: string[], deltaFrames: number, toTrackDelta: number): Movie {
  if (!ids.length) return movie;
  const idSet = new Set(ids);
  const moving: { c: Content; from: number }[] = [];
  movie.tracks.forEach((t, ti) => t.content.forEach((c) => { if (idSet.has(c.id)) moving.push({ c, from: ti }); }));
  if (!moving.length) throw new OpError('That content no longer exists.');
  const minStart = Math.min(...moving.map((x) => x.c.start));
  const dt = Math.max(-minStart, deltaFrames);
  const tracks = movie.tracks.map((t) => ({ ...t, content: t.content.filter((c) => !idSet.has(c.id)) }));
  for (const { c, from } of moving) {
    const to = Math.max(0, Math.min(tracks.length - 1, from + toTrackDelta));
    const next = { ...c, start: c.start + dt };
    if (!fits(tracks[to], next.start, next.duration)) throw new OpError('There is other content in the way.');
    tracks[to] = { ...tracks[to], content: sortContent([...tracks[to].content, next]) };
  }
  return withTracks(movie, tracks);
}

export function trimContent(movie: Movie, id: string, edge: 'start' | 'end', deltaFrames: number, ripple = false): Movie {
  const t = findTrackOf(movie, id);
  const items = sortContent(t.content);
  const idx = items.findIndex((c) => c.id === id);
  const c = items[idx];
  const limit = sourceFrames(movie, c);
  let next: Content;
  if (edge === 'end') {
    const room = ripple ? Number.POSITIVE_INFINITY : (items[idx + 1]?.start ?? Number.POSITIVE_INFINITY) - end(c);
    const maxGrow = Math.min(room, limit - c.offset - c.duration);
    const d = Math.max(1 - c.duration, Math.min(maxGrow, deltaFrames));
    next = { ...c, duration: c.duration + d };
    if (ripple) {
      const shifted = items.map((x, i) => (i > idx ? { ...x, start: x.start + d } : i === idx ? next : x));
      return replaceTrack(movie, t.id, (tr) => ({ ...tr, content: shifted }));
    }
  } else {
    const prevEnd = idx > 0 ? end(items[idx - 1]) : 0;
    const roomBack = ripple ? c.start : c.start - prevEnd;
    const sourceBack = Number.isFinite(limit) ? c.offset : Number.POSITIVE_INFINITY;
    const d = Math.max(-Math.min(roomBack, sourceBack), Math.min(c.duration - 1, deltaFrames));
    next = { ...c, start: c.start + d, duration: c.duration - d, offset: Math.max(0, c.offset + d) };
    if (ripple) {
      const shifted = items.map((x, i) => (i < idx ? { ...x, start: Math.max(0, x.start + d) } : i === idx ? next : x));
      return replaceTrack(movie, t.id, (tr) => ({ ...tr, content: shifted }));
    }
  }
  return replaceTrack(movie, t.id, (tr) => ({ ...tr, content: tr.content.map((x) => (x.id === id ? next : x)) }));
}

export function splitContent(movie: Movie, id: string, frame: number): { movie: Movie; right: string } {
  const t = findTrackOf(movie, id);
  const c = t.content.find((x) => x.id === id) as Content;
  if (frame <= c.start || frame >= end(c)) throw new OpError('Put the Playhead inside the content to split it.');
  const leftLen = frame - c.start;
  const right = { ...cloneContent(c, frame), duration: c.duration - leftLen, offset: c.offset + leftLen, name: c.name };
  const left = { ...c, duration: leftLen };
  const m = replaceTrack(movie, t.id, (tr) => ({ ...tr, content: sortContent(tr.content.map((x) => (x.id === id ? left : x)).concat(right)) }));
  return { movie: m, right: right.id };
}

export function duplicateContent(movie: Movie, id: string): { movie: Movie; copy: string } {
  const t = findTrackOf(movie, id);
  const ti = movie.tracks.indexOf(t);
  const c = t.content.find((x) => x.id === id) as Content;
  const copy = cloneContent(c, c.start);
  const { movie: m } = placeContent(movie, null, copy, ti);
  return { movie: m, copy: copy.id };
}

export function duplicateAfter(movie: Movie, id: string): { movie: Movie; copy: string } {
  const t = findTrackOf(movie, id);
  const items = sortContent(t.content);
  const idx = items.findIndex((x) => x.id === id);
  const c = items[idx];
  const copy = cloneContent(c, end(c));
  const pushBy = Math.max(0, end(copy) - (items[idx + 1]?.start ?? Number.POSITIVE_INFINITY));
  const placed = items.map((x, i) => (i > idx ? { ...x, start: x.start + pushBy } : x));
  const m = replaceTrack(movie, t.id, (tr) => ({ ...tr, content: sortContent([...placed, copy]) }));
  return { movie: m, copy: copy.id };
}

export function fillDuration(movie: Movie, id: string): Movie {
  const t = findTrackOf(movie, id);
  const items = sortContent(t.content);
  const idx = items.findIndex((x) => x.id === id);
  const c = items[idx];
  const stop = Math.min(items[idx + 1]?.start ?? movie.duration, Math.max(movie.duration, end(c)));
  const limit = sourceFrames(movie, c);
  const duration = Math.max(c.duration, Math.min(stop - c.start, limit - c.offset));
  return updateContent(movie, id, (x) => ({ ...x, duration }));
}

export function deleteContent(movie: Movie, ids: string[]): Movie {
  const idSet = new Set(ids);
  return withTracks(movie, movie.tracks.map((t) => (t.content.some((c) => idSet.has(c.id)) ? { ...t, content: t.content.filter((c) => !idSet.has(c.id)) } : t)));
}

export function pasteContent(movie: Movie, items: Content[], frame: number, trackId: string | null): { movie: Movie; ids: string[] } {
  if (!items.length) return { movie, ids: [] };
  const base = Math.min(...items.map((c) => c.start));
  let m = movie;
  const ids: string[] = [];
  let tid = trackId;
  const ti = tid ? Math.max(0, m.tracks.findIndex((t) => t.id === tid)) : 0;
  for (const c of items) {
    const copy = cloneContent(c, frame + (c.start - base));
    const placed = placeContent(m, tid, copy, ti);
    m = placed.movie;
    tid = placed.trackId;
    ids.push(copy.id);
  }
  return { movie: m, ids };
}

export function groupContent(movie: Movie, ids: string[]): { movie: Movie; group: string } {
  if (ids.length < 1) throw new OpError('Select content to group.');
  const idSet = new Set(ids);
  const inner: Track[] = [];
  let topIndex = Number.POSITIVE_INFINITY;
  movie.tracks.forEach((t, ti) => {
    const picked = t.content.filter((c) => idSet.has(c.id));
    if (picked.length) {
      topIndex = Math.min(topIndex, ti);
      inner.push({ ...t, id: uid('t'), content: picked });
    }
  });
  if (!inner.length) throw new OpError('That content no longer exists.');
  const start = Math.min(...inner.flatMap((t) => t.content.map((c) => c.start)));
  const stop = Math.max(...inner.flatMap((t) => t.content.map(end)));
  const rebased = inner.map((t) => ({ ...t, content: t.content.map((c) => ({ ...c, start: c.start - start })) }));
  const group = makeContent('group', start, stop - start, { tracks: rebased, name: 'Group' });
  const stripped = deleteContent(movie, ids);
  const host = stripped.tracks[topIndex];
  const emptied = new Set(movie.tracks.filter((t, ti) => ti !== topIndex && t.content.length > 0 && t.content.every((c) => idSet.has(c.id))).map((t) => t.id));
  const kept = withTracks(stripped, stripped.tracks.filter((t) => !emptied.has(t.id)));
  const placed = placeContent(kept, host?.id ?? null, group, Math.max(0, kept.tracks.indexOf(host)));
  return { movie: placed.movie, group: group.id };
}

export function ungroupContent(movie: Movie, id: string): { movie: Movie; ids: string[] } {
  const t = findTrackOf(movie, id);
  const ti = movie.tracks.indexOf(t);
  const g = t.content.find((c) => c.id === id) as Content;
  if (g.kind !== 'group') throw new OpError('That content is not a group.');
  let m = deleteContent(movie, [id]);
  const ids: string[] = [];
  g.tracks.forEach((inner, i) => {
    const placedTrack = addTrack(m, ti + i, inner.name);
    m = placedTrack.movie;
    for (const c of inner.content) {
      const item = { ...c, start: c.start + g.start };
      m = replaceTrack(m, placedTrack.track.id, (tr) => ({ ...tr, content: sortContent([...tr.content, item]) }));
      ids.push(item.id);
    }
  });
  const hostEmpty = (m.tracks.find((tr) => tr.id === t.id)?.content.length ?? 1) === 0;
  if (hostEmpty) m = withTracks(m, m.tracks.filter((tr) => tr.id !== t.id));
  return { movie: m, ids };
}

export interface ContentPatch {
  name?: string;
  opacity?: number;
  blend?: BlendMode;
  mask?: MaskMode;
  maskInvert?: boolean;
  highlight?: Highlight;
  transform?: Partial<Transform>;
  volume?: number;
}

export function patchContent(movie: Movie, ids: string[], patch: ContentPatch): Movie {
  let m = movie;
  for (const id of ids) {
    m = updateContent(m, id, (c) => {
      const next: Content = { ...c };
      if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 80) || c.name;
      if (patch.opacity !== undefined) next.opacity = Math.min(1, Math.max(0, patch.opacity));
      if (patch.blend !== undefined) next.blend = patch.blend;
      if (patch.mask !== undefined) next.mask = patch.mask;
      if (patch.maskInvert !== undefined) next.maskInvert = patch.maskInvert;
      if (patch.highlight !== undefined) next.highlight = patch.highlight;
      if (patch.volume !== undefined) next.volume = Math.min(2, Math.max(0, patch.volume));
      if (patch.transform) next.transform = { ...c.transform, ...patch.transform };
      return next;
    });
  }
  return m;
}

export interface MoviePatch {
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  background?: string;
  transparent?: boolean;
  playback?: PlaybackMode;
  addKeyAtStart?: boolean;
}

export function patchMovie(movie: Movie, patch: MoviePatch): Movie {
  const next: Movie = { ...movie };
  if (patch.name !== undefined) next.name = patch.name.trim().slice(0, 120) || movie.name;
  if (patch.width !== undefined) next.width = clampSide(patch.width);
  if (patch.height !== undefined) next.height = clampSide(patch.height);
  if (patch.fps !== undefined) {
    const fps = clampFps(patch.fps);
    const ratio = fps / movie.fps;
    next.fps = fps;
    if (ratio !== 1) {
      const scale = (c: Content): Content => ({
        ...c,
        start: Math.round(c.start * ratio),
        duration: Math.max(1, Math.round(c.duration * ratio)),
        offset: Math.round(c.offset * ratio),
        tracks: c.tracks.map((t) => ({ ...t, content: t.content.map(scale) })),
      });
      next.tracks = movie.tracks.map((t) => ({ ...t, content: t.content.map(scale) }));
      next.duration = Math.max(1, Math.round(movie.duration * ratio));
    }
  }
  if (patch.duration !== undefined) next.duration = Math.max(1, Math.round(patch.duration));
  if (patch.background !== undefined) next.background = patch.background;
  if (patch.transparent !== undefined) next.transparent = patch.transparent;
  if (patch.playback !== undefined) next.playback = patch.playback;
  if (patch.addKeyAtStart !== undefined) next.addKeyAtStart = patch.addKeyAtStart;
  return next;
}

export function fitToContent(movie: Movie): Movie {
  const stop = contentEnd(movie);
  return stop > 0 ? { ...movie, duration: stop } : movie;
}
