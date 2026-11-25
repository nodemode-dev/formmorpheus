// Lip-sync edits: a Mouth Chart Flipbook and the write of analysed shapes into a Flipbook row. Pure, never mutates.
import { VISEMES, VISEME_NAMES, type Viseme } from '../media/lipsync';
import { flipLength, flipTrack, freeSpan, locate, uid } from './model';
import { flipDuration } from './flip-ops';
import { OpError, updateContent } from './ops';
import type { Content, DrawingLayer, FlipTrack, FlipbookFrame, Movie, Track } from './types';

export const NEW_ROW = -1;

/** The row of a Mouth Chart: eight empty frames named for the shapes. */
export function mouthChartRow(): FlipTrack {
  const row = flipTrack('Mouth', VISEMES.length);
  return { ...row, frames: row.frames.map((f, i) => ({ ...f, name: VISEME_NAMES[VISEMES[i]] })) };
}

/** Which frame of a row stands for each shape: a frame named for it, else the frame at that place in the order (clamped). */
export function guessMapping(row: FlipTrack): Record<Viseme, number> {
  const out = {} as Record<Viseme, number>;
  VISEMES.forEach((v, i) => {
    const named = row.frames.findIndex((f) => f.name === VISEME_NAMES[v]);
    out[v] = named >= 0 ? named : Math.min(i, row.frames.length - 1);
  });
  return out;
}

/**
 * A chart row that rests: its Rest drawing (named, else the first) moved to the front and held `duration` frames, so a
 * mouth shows Rest for its whole block until lip-sync writes shapes; the other drawings stay after it to be copied.
 */
export function restingChart(row: FlipTrack, duration: number): FlipTrack {
  if (!row.frames.length) return row;
  const r = guessMapping(row).rest;
  const rest = { ...row.frames[r], hold: Math.max(1, Math.round(duration)) };
  return { ...row, frames: [rest, ...row.frames.filter((_, i) => i !== r)] };
}

/** True when a row looks like a mouth set: it has frames named for the shapes, or at least eight frames. */
export function looksLikeMouth(row: FlipTrack): boolean {
  return row.frames.some((f) => f.name && VISEMES.some((v) => VISEME_NAMES[v] === f.name)) || row.frames.length >= VISEMES.length;
}

function fresh(layers: DrawingLayer[]): DrawingLayer[] {
  const ids = new Map(layers.map((l) => [l.id, uid('l')]));
  return layers.map((l) => ({ ...l, id: ids.get(l.id)!, ...(l.parent && ids.has(l.parent) ? { parent: ids.get(l.parent) } : {}) }));
}

function copy(f: FlipbookFrame, hold: number): FlipbookFrame {
  return { ...f, id: uid('f'), hold, layers: fresh(f.layers) };
}

/** The frames of a row cut to local times [a, b): frames that straddle a cut are split into copies. */
function slice(frames: FlipbookFrame[], a: number, b: number): FlipbookFrame[] {
  const out: FlipbookFrame[] = [];
  let at = 0;
  for (const f of frames) {
    const hold = Math.max(1, f.hold), lo = Math.max(a, at), hi = Math.min(b, at + hold);
    if (hi > lo) out.push(hi - lo === hold ? f : copy(f, hi - lo));
    at += hold;
  }
  return out;
}

export interface LipsyncJob {
  /** Flipbook content to write into. */
  content: string;
  /** Row index, or NEW_ROW for a row of its own on top (the chart row is then hidden). */
  row: number;
  /** Row that holds the shape drawings (when different from `row`; -1 means the same). */
  chartRow: number;
  /** Movie frame of the first shape. */
  from: number;
  shapes: Viseme[];
  /** Frame of the chart row for each shape. */
  map: Record<Viseme, number>;
}

/** The top-level group whose tracks hold `id` at any depth. */
function groupHolding(tracks: Track[], id: string): Content | null {
  const inside = (ts: Track[]): boolean => ts.some((t) => t.content.some((c) => c.id === id || (c.kind === 'group' && inside(c.tracks))));
  for (const t of tracks) for (const c of t.content) if (c.kind === 'group' && inside(c.tracks)) return c;
  return null;
}

/** Writes the shapes as holds into a row over the movie frames [from, from + shapes.length); the rest of the row stays. */
export function applyLipsync(movie: Movie, job: LipsyncJob): Movie {
  const loc = locate(movie, job.content);
  if (!loc) {
    // a mouth inside a group (a character's): written in the group's own frames, the group's tracks taken as a movie
    const g = groupHolding(movie.tracks, job.content);
    if (g) {
      const inner = applyLipsync({ ...movie, tracks: g.tracks }, { ...job, from: job.from - g.start + g.offset });
      return updateContent(movie, g.id, (x) => ({ ...x, tracks: inner.tracks }));
    }
  }
  if (!loc || loc.content.kind !== 'flipbook') throw new OpError('That content is not a flipbook.');
  const c = loc.content;
  const chart = c.flip[job.chartRow >= 0 ? job.chartRow : job.row];
  if (!chart || !chart.frames.length) throw new OpError('Pick a flipbook track with the mouth frames.');
  if (!job.shapes.length) throw new OpError('There is no sound in that range.');
  // the shape drawings are read before the row is cut, so writing over the chart row still finds them
  const pics = {} as Record<Viseme, FlipbookFrame>;
  for (const v of VISEMES) pics[v] = chart.frames[Math.max(0, Math.min(chart.frames.length - 1, job.map[v]))];
  // shapes to runs
  const runs: { shape: Viseme; n: number }[] = [];
  for (const s of job.shapes) { const l = runs[runs.length - 1]; if (l && l.shape === s) l.n++; else runs.push({ shape: s, n: 1 }); }
  const made = runs.map((r) => ({ ...copy(pics[r.shape], r.n), name: VISEME_NAMES[r.shape] }));
  const a = job.from - c.start + c.offset, b = a + job.shapes.length;
  if (a < 0) throw new OpError('That range starts before the flipbook.');
  // the content grows to hold the range when the track has room; otherwise it is the sound that is cut
  let duration = c.duration;
  const needed = job.from + job.shapes.length - c.start;
  if (needed > duration) {
    const room = freeSpan(loc.track, c.start, new Set([c.id])).to;
    if (job.from + job.shapes.length > room) throw new OpError('The flipbook is too short for that range and the track has no room to grow it.');
    duration = needed;
  }
  const total = Math.max(flipDuration(c), c.offset + duration, b);
  const rest = pics.rest;
  let flip: FlipTrack[];
  if (job.row === NEW_ROW) {
    const frames: FlipbookFrame[] = [];
    if (a > 0) frames.push({ ...copy(rest, a), name: VISEME_NAMES.rest });
    frames.push(...made);
    if (total > b) frames.push({ ...copy(rest, total - b), name: VISEME_NAMES.rest });
    const row: FlipTrack = { ...flipTrack('Lip-sync', 1), frames };
    flip = [row, ...c.flip.map((t, i) => (i === (job.chartRow >= 0 ? job.chartRow : 0) ? { ...t, hidden: true } : t))];
  } else {
    const t = c.flip[job.row];
    if (!t) throw new OpError('That flipbook track no longer exists.');
    const len = flipLength(t);
    const head = len >= a ? slice(t.frames, 0, a) : [...slice(t.frames, 0, len), { ...copy(t.frames[t.frames.length - 1], a - len) }];
    const tail = b < len ? slice(t.frames, b, len) : [];
    flip = c.flip.map((x, i) => (i === job.row ? { ...x, frames: [...head, ...made, ...tail] } : x));
  }
  return updateContent(movie, c.id, (x: Content) => ({ ...x, duration, flip }));
}
