// Perform mode maths: capture a drag as keys, smooth it without lag, thin it to a few keys, and lay it over a content.
// The capture and reduce steps follow the owner's formvfx Motion Sketch (one sample per frame, then
// Ramer-Douglas-Peucker with a tolerance); smoothing here is a zero-phase Gaussian so the take does not trail the hand.
// Pure, no DOM.
import type { Content, Ease, Key, KeyKind, KeyLane, Movie } from './types';
import { end, locate, sourceFrames } from './model';
import { channelSpec, kindSpec, laneOf, laneRank } from './keys';
import { growEnd } from './retime';

export interface Take {
  kind: KeyKind;
  from: number;
  to: number;
  channels: Record<string, Key[]>;
}

/** Widest span a pixel-like channel is judged against; the +-20000 limits would make every tolerance huge. */
const RANGE_CAP = 1000;
/** Gaussian sigma in frames at filtering 1. */
const MAX_SIGMA = 3;

export class Recorder {
  private readonly kind: KeyKind;
  private readonly ids: string[];
  private readonly rows = new Map<string, Map<number, number>>();
  private last = -1;

  constructor(kind: KeyKind, channels: string[]) {
    this.kind = kind;
    this.ids = channels.slice();
    for (const id of this.ids) this.rows.set(id, new Map());
  }

  add(localFrame: number, values: Record<string, number>): void {
    if (!Number.isFinite(localFrame)) return;
    const f = Math.round(localFrame);
    // a take only runs forward inside the content: a loop wrap or a ping pong turn mid-gesture (frames
    // going back) and frames before the content's start are ignored, never stitched across
    if (f < 0 || f < this.last) return;
    this.last = f;
    for (const id of this.ids) {
      const v = values[id];
      if (v === undefined || !Number.isFinite(v)) continue;
      (this.rows.get(id) as Map<number, number>).set(f, v);
    }
  }

  finish(filtering: number): Take | null {
    const amount = clamp01(filtering);
    const spec = kindSpec(this.kind);
    const channels: Record<string, Key[]> = {};
    let from = Infinity;
    let to = -Infinity;
    for (const id of this.ids) {
      const row = this.rows.get(id) as Map<number, number>;
      if (!row.size) continue;
      const dense = fill(row);
      const smooth = filterMotion(dense, amount);
      const cs = channelSpec(this.kind, id);
      const tol = cs ? toleranceFor(cs.min, cs.max, cs.step, amount, observedRange(dense)) : 0;
      const keys = reduceKeys(smooth, tol);
      channels[id] = keys;
      if (keys[0].frame < from) from = keys[0].frame;
      if (keys[keys.length - 1].frame > to) to = keys[keys.length - 1].frame;
    }
    if (from === Infinity) return null;
    return { kind: this.kind, from, to, channels };
  }
}

function clamp01(v: number): number {
  return v < 0 || !Number.isFinite(v) ? 0 : v > 1 ? 1 : v;
}

/** One key per frame between the first and last touched frame; skipped frames are interpolated linearly. */
function fill(row: Map<number, number>): Key[] {
  const frames = [...row.keys()].sort((a, b) => a - b);
  const out: Key[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const v = row.get(f) as number;
    if (i > 0) {
      const pf = frames[i - 1];
      const pv = row.get(pf) as number;
      for (let g = pf + 1; g < f; g++) out.push({ frame: g, value: pv + ((v - pv) * (g - pf)) / (f - pf), ease: 'linear' });
    }
    out.push({ frame: f, value: v, ease: 'linear' });
  }
  return out;
}

function observedRange(keys: Key[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of keys) {
    if (k.value < lo) lo = k.value;
    if (k.value > hi) hi = k.value;
  }
  return hi - lo;
}

/** Tolerance in channel units: a fraction of the channel's useful range that grows with the filtering amount. */
function toleranceFor(min: number, max: number, step: number, amount: number, observed: number): number {
  const span = Math.min(max - min, RANGE_CAP);
  const eff = Math.min(span, Math.max(observed * 4, step * 10));
  // The floor keeps a channel that only jitters (a hand tremor on one axis) from keeping a key per frame.
  return Math.max(eff * (0.0005 + 0.006 * Math.pow(amount, 1.5)), step * (0.25 + 1.5 * amount));
}

/**
 * Zero-phase Gaussian smoothing over frame distance (works on gaps too). Ends keep their raw value and the
 * effect fades in over two sigma, so the take still starts and stops where the hand did.
 */
export function filterMotion(keys: Key[], amount: number): Key[] {
  const a = clamp01(amount);
  const n = keys.length;
  if (a === 0 || n < 3) return keys.map((k) => ({ ...k }));
  const sigma = MAX_SIGMA * a;
  const radius = sigma * 3;
  const inv = 1 / (2 * sigma * sigma);
  const first = keys[0].frame;
  const last = keys[n - 1].frame;
  const out: Key[] = new Array(n);
  let lo = 0;
  for (let i = 0; i < n; i++) {
    const f = keys[i].frame;
    while (keys[lo].frame < f - radius) lo++;
    let sum = 0;
    let wsum = 0;
    for (let j = lo; j < n && keys[j].frame <= f + radius; j++) {
      const d = keys[j].frame - f;
      const w = Math.exp(-d * d * inv);
      sum += w * keys[j].value;
      wsum += w;
    }
    const smooth = wsum > 0 ? sum / wsum : keys[i].value;
    const edge = Math.min(f - first, last - f);
    const mix = Math.min(1, edge / (2 * sigma));
    out[i] = { frame: f, value: keys[i].value + (smooth - keys[i].value) * mix, ease: keys[i].ease };
  }
  return out;
}

/** Ramer-Douglas-Peucker on (frame, value); vertical distance to the chord, kept keys get linear eases. */
export function reduceKeys(keys: Key[], tolerance: number): Key[] {
  const n = keys.length;
  if (n === 0) return [];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol = Math.max(0, tolerance);
  while (stack.length) {
    const j = stack.pop() as number;
    const i = stack.pop() as number;
    if (j <= i + 1) continue;
    const a = keys[i];
    const b = keys[j];
    const span = Math.max(b.frame - a.frame, 1e-9);
    let worst = 0;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const lin = a.value + ((b.value - a.value) * (keys[k].frame - a.frame)) / span;
      const d = Math.abs(lin - keys[k].value);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push(i, at, at, j);
    }
  }
  const out: Key[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ frame: keys[i].frame, value: keys[i].value, ease: 'linear' });
  return out;
}


/**
 * Longest duration content `id` may grow to when a take outruns it: up to the next block on its track, the
 * movie's end and the end of its source media. Never below its current duration.
 */
export function roomFor(movie: Movie, id: string): number {
  const at = locate(movie, id);
  if (!at) return Number.POSITIVE_INFINITY;
  const c = at.content;
  let stop = Math.max(movie.duration, end(c));
  for (const o of at.track.content) if (o.id !== id && o.start >= end(c)) stop = Math.min(stop, o.start);
  const src = c.duration + growEnd(c, sourceFrames(movie, c));
  return Math.max(c.duration, Math.min(stop - c.start, c.kind === 'video' || c.kind === 'audio' ? src : Number.POSITIVE_INFINITY));
}

export function applyTake(c: Content, take: Take, ease: Ease = 'linear', room = Number.POSITIVE_INFINITY): Content {
  const spec = kindSpec(take.kind);
  const existing = laneOf(c, take.kind);
  const options: Record<string, string | number | boolean> = {};
  for (const o of spec.options ?? []) options[o.id] = o.def;
  const channels: Record<string, Key[]> = existing ? { ...existing.channels } : {};
  let changed = false;
  // a take never keys past its block: the block grows as far as it may (`room`), and keys beyond its last frame are dropped
  const dur = take.to >= c.duration ? Math.max(c.duration, Math.min(room, Math.floor(take.to) + 1)) : c.duration;
  for (const id in take.channels) {
    const incoming = take.channels[id].filter((k) => k.frame <= dur - 1);
    if (!incoming.length) continue;
    // each channel replaces only its own recorded span (rotation can join a take late, from a pen twist)
    const lo = incoming[0].frame, hi = incoming[incoming.length - 1].frame;
    const kept = (channels[id] ?? []).filter((k) => k.frame < lo || k.frame > hi);
    const merged = kept.concat(incoming.map((k) => ({ frame: k.frame, value: k.value, ease })));
    merged.sort((a, b) => a.frame - b.frame);
    channels[id] = merged;
    changed = true;
  }
  if (!changed) return c;
  const lane: KeyLane = existing ? { ...existing, channels } : { kind: take.kind, expanded: false, channels, options };
  const at = c.keys.findIndex((l) => l.kind === take.kind);
  const inPlace = at >= 0 && !!kindSpec(take.kind).fx;
  const rest = inPlace ? c.keys.map((l, i) => (i === at ? lane : l)) : c.keys.filter((l) => l.kind !== take.kind);
  if (!inPlace) rest.push(lane);
  rest.sort((a, b) => laneRank(a.kind) - laneRank(b.kind));
  // content the take outruns grows to meet it, as far as the neighbours and the movie allow
  return { ...c, keys: rest, duration: dur };
}
