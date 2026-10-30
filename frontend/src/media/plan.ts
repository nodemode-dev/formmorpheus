// Decode planning that sits between the Engine's clock and the VideoPool: what to prefetch while playing
// (including the start of a looping movie, ahead of the wrap) and the first pictures to wait for before a
// block or a movie is revealed. No DOM.
import { Renderer } from '../engine/render';
import type { Content, Movie } from '../engine/types';
import type { VideoSource } from './types';

/** Seconds before the end of a looping movie at which the start is decoded ahead. */
const WRAP_LEAD = 1.5;
/** Lane suffix of the prefetch for the start of the movie. */
const WRAP = '~wrap';

/** Called on every Playhead step while playing. */
export function planPrefetch(video: VideoSource, m: Movie, f: number): void {
  const wrapAt = m.playback === 'loop' && f + WRAP_LEAD * m.fps >= m.duration ? 0 : -1;
  for (const t of m.tracks) {
    if (t.hidden) continue;
    for (const c of t.content) {
      if (c.kind !== 'video' || !c.asset) continue;
      if (f >= c.start - m.fps && f < c.start + c.duration) video.prefetch(c.asset, Renderer.videoSeconds(c, Math.max(0, f - c.start), m), 2, c.id);
      // the block's own lane is busy near the end: the start gets a lane of its own, so the first picture after the wrap is ready
      if (wrapAt >= 0 && c.start <= wrapAt + m.fps && wrapAt < c.start + c.duration) video.prefetch(c.asset, Renderer.videoSeconds(c, Math.max(0, wrapAt - c.start), m), 1, c.id + WRAP);
      else if (wrapAt < 0 && f > m.fps * 2) video.release?.(c.asset, c.id + WRAP);
    }
  }
}

/** Resolves when every video visible at `frame` has its exact picture decoded, or after `ms` (never a hang). */
export async function firstFrames(video: VideoSource, m: Movie, frame: number, ms = 5000): Promise<void> {
  await settleAll(Renderer.videosAt(m, frame).map((v) => video.exact(v.asset, v.seconds, v.lane)), ms);
}

/** Same for new video blocks, at their first picture (an import waits before the block is added). */
export async function firstPictures(video: VideoSource, m: Movie, blocks: Content[], ms = 5000): Promise<void> {
  await settleAll(blocks.filter((c) => c.kind === 'video' && c.asset).map((c) => video.exact(c.asset as string, Renderer.videoSeconds(c, 0, m), c.id)), ms);
}

async function settleAll(waits: Promise<void>[], ms: number): Promise<void> {
  if (!waits.length) return;
  let timer = 0;
  const limit = new Promise<void>((res) => { timer = window.setTimeout(res, ms); });
  try { await Promise.race([Promise.all(waits).then(() => undefined), limit]); } finally { window.clearTimeout(timer); }
}
