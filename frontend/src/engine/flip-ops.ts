// Flipbook edits (Phase 5). Pure: each returns a new Content or Movie and never mutates.
import { content as makeContent, drawingLayer, end, flipFrame, flipIndexAt, flipLength, flipTrack, track as makeTrack, uid } from './model';
import { shiftKeys } from './key-ops';
import { OpError, deleteContent, placeContent } from './ops';
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
    if (t.hidden || !t.frames.length) return;
    const items: Content[] = [];
    // walk the movie frames the content shows (its offset included) and emit one Drawing per run of the same frame
    let at = 0;
    while (at < fb.duration) {
      const fi = flipIndexAt(t, at + fb.offset);
      let run = 1;
      while (at + run < fb.duration && flipIndexAt(t, at + run + fb.offset) === fi) run++;
      const f = t.frames[fi];
      const d = makeContent('drawing', fb.start + at, run, {
        name: `${t.name} ${fi + 1}`, layers: freshLayers(f.layers), transform: { ...fb.transform }, opacity: fb.opacity * t.opacity,
        blend: t.blend, highlight: t.highlight, keys: shiftKeys(fb, -at).keys, mask: fb.mask, maskInvert: fb.maskInvert,
      });
      items.push(d);
      ids.push(d.id);
      at += run;
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
    // rows loop, so a row that ends early is padded with a blank frame to the common end
    if (at < stop) out.push({ id: uid('f'), hold: stop - at, layers: [drawingLayer()] });
    return { ...flipTrack(`Track ${i + 1}`, 1), frames: out };
  });
  const topIndex = movie.tracks.findIndex((t) => t.content.some((c) => idSet.has(c.id)));
  // the first Drawing lends its placement and keys (drawings made by flipbookToTracks all share them)
  const lead = picked[0][0];
  const fb = makeContent('flipbook', start, stop - start, { name: 'Flipbook', flip, transform: { ...lead.transform }, keys: shiftKeys(lead, lead.start - start).keys, mask: lead.mask, maskInvert: lead.maskInvert });
  const stripped = deleteContent(movie, picked.flat().map((c) => c.id));
  const host = stripped.tracks[topIndex];
  return { movie: placeContent(stripped, host?.id ?? null, fb, Math.max(0, topIndex)).movie, id: fb.id };
}
