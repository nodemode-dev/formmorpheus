// Flipbook edits (Phase 5). Pure: each returns a new Content or Movie and never mutates.
import { content as makeContent, drawingLayer, end, flipFrame, flipLength, flipStartOf, flipTrack, track as makeTrack, uid } from './model';
import { OpError, deleteContent, placeContent, updateContent } from './ops';
import type { Content, DrawingLayer, FlipTrack, FlipbookFrame, Movie, Track } from './types';

function rows(c: Content, row: number, fn: (t: FlipTrack) => FlipTrack): Content {
  if (c.kind !== 'flipbook') throw new OpError('That content is not a flipbook.');
  if (!c.flip[row]) throw new OpError('That flipbook track no longer exists.');
  return { ...c, flip: c.flip.map((t, i) => (i === row ? fn(t) : t)) };
}

function frames(c: Content, row: number, fn: (f: FlipbookFrame[]) => FlipbookFrame[]): Content {
  return rows(c, row, (t) => ({ ...t, frames: fn(t.frames) }));
}

function freshLayers(layers: DrawingLayer[]): DrawingLayer[] {
  return layers.map((l) => ({ ...l, id: uid('l') }));
}

function copyFrame(f: FlipbookFrame): FlipbookFrame {
  return { id: uid('f'), hold: f.hold, layers: freshLayers(f.layers) };
}

/** Longest row, in movie frames. */
export function flipDuration(c: Content): number {
  return c.flip.reduce((m, t) => Math.max(m, flipLength(t)), 0);
}

/** Grows the content so its longest row fits (never shrinks a longer, looping content). */
function fit(c: Content): Content {
  const len = flipDuration(c);
  return len > c.duration ? { ...c, duration: len } : c;
}

export function insertFrame(c: Content, row: number, after: number): Content {
  return fit(frames(c, row, (f) => [...f.slice(0, after + 1), flipFrame(), ...f.slice(after + 1)]));
}

export function duplicateFrame(c: Content, row: number, index: number): Content {
  return fit(frames(c, row, (f) => (f[index] ? [...f.slice(0, index + 1), copyFrame(f[index]), ...f.slice(index + 1)] : f)));
}

export function deleteFrame(c: Content, row: number, index: number): Content {
  return frames(c, row, (f) => (f.length <= 1 ? [{ ...f[0], layers: [drawingLayer()] }] : f.filter((_, i) => i !== index)));
}

export function clearFrame(c: Content, row: number, index: number): Content {
  return frames(c, row, (f) => f.map((x, i) => (i === index ? { ...x, layers: x.layers.map((l) => ({ ...l, pixels: null })) } : x)));
}

export function setHold(c: Content, row: number, index: number, hold: number): Content {
  const h = Math.max(1, Math.min(999, Math.round(hold)));
  return fit(frames(c, row, (f) => f.map((x, i) => (i === index ? { ...x, hold: h } : x))));
}

export function setFrameLayers(c: Content, row: number, index: number, layers: DrawingLayer[]): Content {
  return frames(c, row, (f) => f.map((x, i) => (i === index ? { ...x, layers } : x)));
}

export function pasteFrames(c: Content, row: number, after: number, items: FlipbookFrame[]): Content {
  return fit(frames(c, row, (f) => [...f.slice(0, after + 1), ...items.map(copyFrame), ...f.slice(after + 1)]));
}

/** Splits the flipbook at a frame: the frames from `index` on go to a new flipbook right after this one on the same track. */
export function splitFlipbook(movie: Movie, id: string, row: number, index: number): Movie {
  let rightPart: Content | null = null;
  const m = updateContent(movie, id, (c) => {
    const t = c.flip[row];
    if (!t || index <= 0 || index >= t.frames.length) throw new OpError('Split needs a frame after the first.');
    const at = flipStartOf(t, index);
    const left = { ...c, duration: at, flip: c.flip.map((x) => ({ ...x, frames: x.frames.slice(0, Math.max(1, cutIndex(x, at))) })) };
    rightPart = makeContent('flipbook', c.start + at, Math.max(1, c.duration - at), {
      name: c.name, highlight: c.highlight, transform: { ...c.transform }, opacity: c.opacity, blend: c.blend,
      flip: c.flip.map((x) => ({ ...x, id: uid('ft'), frames: x.frames.slice(cutIndex(x, at)).map(copyFrame) })).map((x) => (x.frames.length ? x : { ...x, frames: [flipFrame()] })),
    });
    return left;
  });
  const placed = rightPart as Content | null;
  if (!placed) return m;
  const host = m.tracks.find((t) => t.content.some((c) => c.id === id));
  return placeContent(m, host?.id ?? null, placed).movie;
}

function cutIndex(t: FlipTrack, at: number): number {
  let acc = 0;
  for (let i = 0; i < t.frames.length; i++) {
    if (acc >= at) return i;
    acc += Math.max(1, t.frames[i].hold);
  }
  return t.frames.length;
}

export function addFlipTrack(c: Content, fps: number): Content {
  const count = Math.max(1, Math.min(flipDuration(c) || Math.round(fps), 2000));
  return { ...c, flip: [flipTrack(`Track ${c.flip.length + 1}`, count), ...c.flip] };
}

export function deleteFlipTrack(c: Content, row: number): Content {
  if (c.flip.length <= 1) throw new OpError('A flipbook keeps at least one track.');
  return { ...c, flip: c.flip.filter((_, i) => i !== row) };
}

export function moveFlipTrack(c: Content, row: number, to: number): Content {
  const list = [...c.flip];
  const [t] = list.splice(row, 1);
  if (!t) return c;
  list.splice(Math.max(0, Math.min(list.length, to)), 0, t);
  return { ...c, flip: list };
}

export function patchFlipTrack(c: Content, row: number, patch: Partial<Pick<FlipTrack, 'name' | 'hidden' | 'opacity' | 'blend' | 'highlight'>>): Content {
  return rows(c, row, (t) => ({ ...t, ...patch }));
}

/** Every Flipbook row becomes a timeline track of Drawings, one per frame, for one pass of the content. */
export function flipbookToTracks(movie: Movie, id: string): { movie: Movie; ids: string[] } {
  const host = movie.tracks.findIndex((t) => t.content.some((c) => c.id === id));
  if (host < 0) throw new OpError('That content no longer exists.');
  const fb = movie.tracks[host].content.find((c) => c.id === id) as Content;
  if (fb.kind !== 'flipbook') throw new OpError('That content is not a flipbook.');
  const made: Track[] = [];
  const ids: string[] = [];
  fb.flip.forEach((t) => {
    const items: Content[] = [];
    let at = 0;
    let i = 0;
    while (at < fb.duration && t.frames.length) {
      const f = t.frames[i % t.frames.length];
      const hold = Math.min(Math.max(1, f.hold), fb.duration - at);
      const d = makeContent('drawing', fb.start + at, hold, { name: `${t.name} ${(i % t.frames.length) + 1}`, layers: freshLayers(f.layers), transform: { ...fb.transform }, opacity: fb.opacity * t.opacity, blend: t.blend, highlight: t.highlight });
      items.push(d);
      ids.push(d.id);
      at += hold;
      i++;
    }
    made.push(makeTrack(fb.flip.length > 1 ? `${fb.name} ${t.name}` : fb.name, items));
  });
  const stripped = deleteContent(movie, [id]);
  const tracks = [...stripped.tracks];
  const emptyHost = tracks[host] && tracks[host].content.length === 0;
  tracks.splice(host, emptyHost ? 1 : 0, ...made);
  return { movie: { ...stripped, tracks }, ids };
}

/** Selected Drawings become one Flipbook: each source track a row, each Drawing a frame held for its duration (gaps become blank frames). */
export function tracksToFlipbook(movie: Movie, ids: string[]): { movie: Movie; id: string } {
  const idSet = new Set(ids);
  const picked = movie.tracks.map((t) => t.content.filter((c) => idSet.has(c.id) && c.kind === 'drawing').sort((a, b) => a.start - b.start)).filter((l) => l.length);
  if (!picked.length) throw new OpError('Select drawings to make a flipbook.');
  const start = Math.min(...picked.map((l) => l[0].start));
  const stop = Math.max(...picked.map((l) => end(l[l.length - 1])));
  const flip: FlipTrack[] = picked.map((list, i) => {
    const out: FlipbookFrame[] = [];
    let at = start;
    for (const c of list) {
      if (c.start > at) out.push({ id: uid('f'), hold: c.start - at, layers: [drawingLayer()] });
      out.push({ id: uid('f'), hold: c.duration, layers: freshLayers(c.layers) });
      at = end(c);
    }
    return { ...flipTrack(`Track ${i + 1}`, 1), frames: out };
  });
  const topIndex = movie.tracks.findIndex((t) => t.content.some((c) => idSet.has(c.id)));
  const fb = makeContent('flipbook', start, stop - start, { name: 'Flipbook', flip });
  const stripped = deleteContent(movie, picked.flat().map((c) => c.id));
  const host = stripped.tracks[topIndex];
  return { movie: placeContent(stripped, host?.id ?? null, fb, Math.max(0, topIndex)).movie, id: fb.id };
}
