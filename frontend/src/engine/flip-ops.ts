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
  const ids = new Map(layers.map((l) => [l.id, uid('l')]));
  // a group's members name it in `parent`, so the copies must name the copied group
  return layers.map((l) => ({ ...l, id: ids.get(l.id)!, ...(l.parent && ids.has(l.parent) ? { parent: ids.get(l.parent) } : {}) }));
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

/** A new row goes in at `at` (above the row that sat there; the top by default). */
export function addFlipTrack(c: Content, fps: number, at = 0): Content {
  const count = Math.max(1, Math.min(flipDuration(c) || Math.round(fps), 2000));
  const list = [...c.flip];
  list.splice(Math.max(0, Math.min(list.length, at)), 0, flipTrack(`Track ${c.flip.length + 1}`, count));
  return { ...c, flip: list };
}

/** A copy of a row with fresh ids, for the row clipboard. */
export function cloneFlipTrack(t: FlipTrack): FlipTrack {
  return { ...t, id: uid('ft'), frames: t.frames.map((f) => ({ ...copyFrame(f), ...(f.name ? { name: f.name } : {}) })) };
}

/** Puts a row (a pasted or duplicated one) at `at`, directly above the row that sat there. */
export function insertFlipTrack(c: Content, at: number, t: FlipTrack): Content {
  const list = [...c.flip];
  list.splice(Math.max(0, Math.min(list.length, at)), 0, cloneFlipTrack(t));
  return fit({ ...c, flip: list });
}

// ---- frame sets: a selection names frames by track id and frame id, so it survives other edits ----

export interface FrameRef { track: string; frames: string[] }

const isBlank = (f: FlipbookFrame): boolean => f.layers.every((l) => l.pixels === null && !l.group);

/** `fn` gets the row as it stands after earlier refs (two refs may name the same row), not as it was in `c`. */
function eachRef(c: Content, refs: FrameRef[], fn: (row: number, idx: number[], cur: FlipTrack) => FlipbookFrame[] | null): Content {
  let out = c;
  for (const ref of refs) {
    const row = out.flip.findIndex((t) => t.id === ref.track);
    if (row < 0) continue;
    const set = new Set(ref.frames);
    const idx = out.flip[row].frames.flatMap((f, i) => (set.has(f.id) ? [i] : []));
    if (!idx.length) continue;
    const next = fn(row, idx, out.flip[row]);
    if (next) out = frames(out, row, () => next);
  }
  return fit(out);
}

/** Splits a hold: the earlier part keeps `at` cells, the later part is a copy sharing the same pixels. */
export function splitFrame(c: Content, row: number, index: number, at: number): Content {
  return frames(c, row, (f) => {
    const x = f[index];
    if (!x || x.hold < 2) return f;
    const first = Math.max(1, Math.min(x.hold - 1, Math.round(at)));
    return [...f.slice(0, index), { ...x, hold: first }, { ...copyFrame(x), hold: x.hold - first }, ...f.slice(index + 1)];
  });
}

/** Extends a frame to the next frame that has content, or to the content's end; blank frames in between are absorbed. */
export function fillFrame(c: Content, row: number, index: number): Content {
  const len = flipDuration(c);
  return fit(frames(c, row, (f) => {
    if (!f[index]) return f;
    let stop = index + 1;
    while (stop < f.length && isBlank(f[stop])) stop++;
    const start = f.slice(0, index).reduce((s, x) => s + Math.max(1, x.hold), 0);
    const target = stop < f.length ? start + f.slice(index, stop).reduce((s, x) => s + Math.max(1, x.hold), 0) : Math.max(len, start + Math.max(1, f[index].hold));
    const hold = Math.min(999, Math.max(Math.max(1, f[index].hold), target - start));
    return [...f.slice(0, index), { ...f[index], hold }, ...f.slice(stop)];
  }));
}

/** Sets the hold of every named frame: an absolute number, or a change when `relative`. */
export function setHolds(c: Content, refs: FrameRef[], hold: number, relative = false): Content {
  return eachRef(c, refs, (_row, idx, cur) => {
    const set = new Set(idx);
    return cur.frames.map((x, i) => (set.has(i) ? { ...x, hold: Math.max(1, Math.min(999, Math.round(relative ? Math.max(1, x.hold) + hold : hold))) } : x));
  });
}

/** Deletes the named frames; a row keeps at least one (blank) frame. */
export function deleteFrames(c: Content, refs: FrameRef[]): Content {
  return eachRef(c, refs, (_row, idx, cur) => {
    const set = new Set(idx);
    const left = cur.frames.filter((_, i) => !set.has(i));
    return left.length ? left : [{ ...cur.frames[0], hold: 1, layers: [drawingLayer()] }];
  });
}

/** Reverses the order of the named frames within each row (their holds travel with them). */
export function flipFrames(c: Content, refs: FrameRef[]): Content {
  return eachRef(c, refs, (_row, idx, cur) => {
    const src = cur.frames;
    const out = [...src];
    idx.forEach((slot, k) => { out[slot] = src[idx[idx.length - 1 - k]]; });
    return out;
  });
}

/** Pulls the named frames out of their rows and sets them into row `toTrack` after frame index `after` (-1: at the start). `toTrack` null makes a new row at `newAt`. */
export function moveFrames(c: Content, refs: FrameRef[], toTrack: string | null, after: number, newAt = 0): Content {
  const taken: FlipbookFrame[] = [];
  const order = new Map<string, number>();
  c.flip.forEach((t, r) => t.frames.forEach((f, i) => order.set(f.id, r * 100000 + i)));
  const ids = new Set(refs.flatMap((r) => r.frames));
  const pickedAll: FlipbookFrame[] = [];
  for (const t of c.flip) for (const f of t.frames) if (ids.has(f.id)) pickedAll.push(f);
  pickedAll.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  taken.push(...pickedAll);
  if (!taken.length) return c;
  // the target row's anchor frame must stay where it is, so remember its id
  const anchor = toTrack && after >= 0 ? c.flip.find((t) => t.id === toTrack)?.frames[after]?.id : undefined;
  if (anchor && ids.has(anchor)) return c;
  const bare = c.flip.map((t) => {
    const keep = t.frames.filter((f) => !ids.has(f.id));
    return keep.length === t.frames.length ? t : { ...t, frames: keep.length ? keep : [flipFrame()] };
  });
  let list = bare;
  if (toTrack === null) {
    const nt = { ...flipTrack(`Track ${c.flip.length + 1}`, 1), frames: taken };
    list = [...bare];
    list.splice(Math.max(0, Math.min(list.length, newAt)), 0, nt);
  } else {
    list = bare.map((t) => {
      if (t.id !== toTrack) return t;
      // a missing anchor (the index was past the row) appends; only an explicit -1 inserts at the start
      const found = anchor ? t.frames.findIndex((f) => f.id === anchor) : -1;
      const at = found >= 0 ? found : after >= 0 ? t.frames.length - 1 : -1;
      return { ...t, frames: [...t.frames.slice(0, at + 1), ...taken, ...t.frames.slice(at + 1)] };
    });
  }
  return fit({ ...c, flip: list });
}

/** Push: a blank frame before the named frame, so it and the ones after it move one frame later. */
export function pushFrame(c: Content, row: number, index: number): Content {
  return fit(frames(c, row, (f) => [...f.slice(0, index), flipFrame(), ...f.slice(index)]));
}

/** Pull: closes one frame of the blank space before the named frame. */
export function pullFrame(c: Content, row: number, index: number): Content {
  return frames(c, row, (f) => {
    const p = f[index - 1];
    if (!p || !isBlank(p)) return f;
    return p.hold > 1 ? f.map((x, i) => (i === index - 1 ? { ...x, hold: x.hold - 1 } : x)) : f.filter((_, i) => i !== index - 1);
  });
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

export function patchFlipTrack(c: Content, row: number, patch: Partial<Pick<FlipTrack, 'name' | 'hidden' | 'opacity' | 'blend' | 'highlight' | 'mask' | 'maskInvert'>>): Content {
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
        blend: t.blend, highlight: t.highlight, keys: shiftKeys(fb, -at).keys,
        // a masking row keeps masking the track made from the row below it
        mask: t.mask && t.mask !== 'none' ? t.mask : fb.mask, maskInvert: t.mask && t.mask !== 'none' ? !!t.maskInvert : fb.maskInvert,
      });
      items.push(d);
      ids.push(d.id);
      at += run;
    }
    // a row keeps its own name (Convert to Flipbook gives it back), a single row takes the flipbook's
    made.push(makeTrack(fb.flip.length > 1 ? t.name : fb.name, items));
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
  const sources = movie.tracks.filter((t) => t.content.some((c) => idSet.has(c.id) && c.kind === 'drawing'));
  const picked = sources.map((t) => t.content.filter((c) => idSet.has(c.id) && c.kind === 'drawing').sort((a, b) => a.start - b.start));
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
    const row: FlipTrack = { ...flipTrack(sources.length > 1 ? sources[i].name : `Track ${i + 1}`, 1), frames: out };
    // with several rows a Drawing's mask is a row mask again (the inverse of flipbookToTracks)
    if (sources.length > 1 && (list[0].mask === 'alpha' || list[0].mask === 'luminance')) { row.mask = list[0].mask; row.maskInvert = list[0].maskInvert; }
    return row;
  });
  const topIndex = movie.tracks.findIndex((t) => t.content.some((c) => idSet.has(c.id)));
  // the first Drawing lends its placement and keys (drawings made by flipbookToTracks all share them)
  const lead = picked[0][0];
  const fb = makeContent('flipbook', start, stop - start, { name: 'Flipbook', flip, transform: { ...lead.transform }, keys: shiftKeys(lead, lead.start - start).keys, mask: sources.length > 1 ? 'none' : lead.mask, maskInvert: sources.length > 1 ? false : lead.maskInvert });
  const stripped = deleteContent(movie, picked.flat().map((c) => c.id));
  const host = stripped.tracks[topIndex];
  return { movie: placeContent(stripped, host?.id ?? null, fb, Math.max(0, topIndex)).movie, id: fb.id };
}
