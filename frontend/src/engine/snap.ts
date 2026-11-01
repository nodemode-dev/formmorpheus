// Timeline snapping: pulls a dragged block edge to the nearest edge of another block, the Playhead, a marker,
// a key, the movie's start or end. Pure; the Timeline passes the drag and draws the indicator.
import { end } from './model';
import type { Content, Movie, Track } from './types';

export interface SnapResult {
  /** The adjusted delta (frames). */
  delta: number;
  /** The frame the nearest candidate snapped to, or null. */
  line: number | null;
}

/** Extra snap targets, set by the interface (View > Snap to Seconds). */
export const snapOptions = { seconds: false };

/** Every frame worth snapping to, skipping the blocks named in `skip`. Sorted, de-duplicated. */
export function snapTargets(movie: Movie, playhead: number, skip: Set<string>): number[] {
  const out = new Set<number>([0, movie.duration, playhead]);
  for (const k of movie.markers ?? []) out.add(k.frame);
  if (movie.loopFrom !== undefined && movie.loopTo !== undefined) { out.add(movie.loopFrom); out.add(movie.loopTo + 1); }
  // optional: every whole second
  if (snapOptions.seconds) { const s = Math.max(1, Math.round(movie.fps)); for (let f = 0; f <= movie.duration; f += s) out.add(f); }
  const walk = (tracks: Track[], base: number): void => {
    for (const t of tracks) for (const c of t.content) {
      if (skip.has(c.id)) continue;
      out.add(base + c.start);
      out.add(base + end(c));
      for (const lane of c.keys) for (const ch of Object.values(lane.channels)) for (const k of ch) out.add(base + c.start + k.frame);
    }
  };
  walk(movie.tracks, 0);
  return [...out].sort((a, b) => a - b);
}

/** Edges of the moving blocks (start and end of each), at their original positions. */
export function edgesOf(items: Content[]): number[] {
  const e: number[] = [];
  for (const c of items) e.push(c.start, end(c));
  return e;
}

/** Snaps a drag by `delta` frames: the edges move with it; the nearest edge/target pair within `reach` frames wins. */
export function snapDelta(edges: number[], targets: number[], delta: number, reach: number): SnapResult {
  let best = Number.POSITIVE_INFINITY;
  let fix = 0;
  let line: number | null = null;
  for (const e of edges) {
    const at = e + delta;
    // binary search for the nearest target to `at`
    let lo = 0, hi = targets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (targets[mid] < at) lo = mid + 1; else hi = mid;
    }
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= targets.length) continue;
      const d = targets[i] - at;
      if (Math.abs(d) < Math.abs(best) && Math.abs(d) <= reach) { best = d; fix = d; line = targets[i]; }
    }
  }
  return line === null ? { delta, line: null } : { delta: delta + fix, line };
}

/** Pixels a snap reaches, as frames at the Timeline's zoom; zoomed in far enough, only an exact hit (shows the line, pulls nothing). */
export function reachFrames(ppf: number, px = 8): number {
  return Math.max(0.5, Math.round(px / Math.max(ppf, 1e-6)));
}
