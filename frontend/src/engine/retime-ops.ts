// Movie-level retime operations: speed, reverse, freeze frame. Each returns a new Movie (one undo step when run once).
import { end, locate, sortContent, sourceFrames } from './model';
import { OpError, cloneContent, updateContent } from './ops';
import { canRetime, clampSpeed, isFrozen, speedOf, srcFrame } from './retime';
import type { Content, Movie } from './types';

function check(c: Content): void {
  if (!canRetime(c)) throw new OpError('Only video, sound, Flipbooks and groups can change speed.');
}

/** The room after block `id` on its track, up to the next block (the movie may grow, so no limit from its length). */
function roomAfter(movie: Movie, id: string): number {
  const at = locate(movie, id);
  if (!at) return 0;
  const c = at.content;
  let stop = Number.POSITIVE_INFINITY;
  for (const o of at.track.content) if (o.id !== id && o.start >= end(c)) stop = Math.min(stop, o.start);
  return stop - c.start;
}

/** Speed (25% to 400%) for one block: its length follows, so the same part of the source is shown; the next block bounds it. */
export function setSpeed(movie: Movie, id: string, speed: number, keepPitch = true): Movie {
  const at = locate(movie, id);
  if (!at) throw new OpError('That content no longer exists.');
  check(at.content);
  const s = clampSpeed(speed);
  const room = roomAfter(movie, id);
  return updateContent(movie, id, (c) => {
    const old = isFrozen(c) ? 1 : speedOf(c);
    const limit = sourceFrames(movie, c);
    let dur = Math.max(1, Math.round((c.duration * old) / s));
    // never past the source: for a forward block that is the rest after `offset`, for a reversed one the part before the window's end
    if (Number.isFinite(limit)) {
      const window = c.reverse ? c.offset + c.duration * old : limit - c.offset;
      const keep = c.reverse ? Math.floor(Math.min(window, limit) / s) : Math.floor(window / s);
      dur = Math.min(dur, Math.max(1, keep));
    }
    dur = Math.max(1, Math.min(dur, Math.floor(room)));
    const next: Content = { ...c, duration: dur };
    if (c.reverse && Number.isFinite(limit)) next.offset = Math.max(0, c.offset + c.duration * old - dur * s);
    if (s === 1) delete next.speed; else next.speed = s;
    if (c.kind === 'audio' || c.kind === 'video') {
      if (keepPitch) delete next.speedPitch; else next.speedPitch = true;
    }
    return next;
  });
}

export function setReverse(movie: Movie, id: string, on: boolean): Movie {
  const at = locate(movie, id);
  if (!at) throw new OpError('That content no longer exists.');
  check(at.content);
  return updateContent(movie, id, (c) => {
    const next = { ...c };
    if (on) next.reverse = true; else delete next.reverse;
    return next;
  });
}

/** Back to normal speed and direction. */
export function resetRetime(movie: Movie, id: string): Movie {
  const at = locate(movie, id);
  if (!at) throw new OpError('That content no longer exists.');
  const c = at.content;
  const s = isFrozen(c) ? 1 : speedOf(c);
  let m = movie;
  if (s !== 1) m = setSpeed(m, id, 1);
  return updateContent(m, id, (x) => {
    const n = { ...x };
    delete n.speed; delete n.reverse; delete n.speedPitch;
    return n;
  });
}

/**
 * Freeze frame: the block is cut at `frame`, a new block of `length` frames holds the picture shown there, and
 * the rest of the block (and any later blocks on the track) moves later. Returns the new freeze block's id.
 */
export function freezeAt(movie: Movie, id: string, frame: number, length: number): { movie: Movie; freeze: string } {
  const at = locate(movie, id);
  if (!at) throw new OpError('That content no longer exists.');
  const c = at.content;
  if (c.kind === 'audio') throw new OpError('A sound cannot hold a frame.');
  if (frame < c.start || frame >= end(c)) throw new OpError('Put the Playhead inside the content to hold a frame.');
  const len = Math.max(1, Math.round(length));
  const local = frame - c.start;
  const src = Math.max(0, Math.floor(srcFrame(c, local)));
  // halves around the cut, in the block's own direction
  const s = speedOf(c);
  let leftOff = c.offset, rightOff = c.offset;
  if (s !== 0) {
    if (c.reverse) leftOff = c.offset + (c.duration - local) * s; else rightOff = c.offset + local * s;
  }
  const hold = cloneContent(c, frame);
  hold.name = `${c.name} hold`;
  hold.duration = len;
  hold.offset = src;
  hold.speed = 0;
  delete hold.reverse;
  delete hold.speedPitch;
  delete hold.transition;
  hold.keys = [];
  if (hold.fadeIn !== undefined) delete hold.fadeIn;
  if (hold.fadeOut !== undefined) delete hold.fadeOut;
  const rest = cloneContent(c, frame + len);
  rest.duration = c.duration - local;
  rest.offset = rightOff;
  rest.name = c.name;
  delete rest.transition;
  // keys of the later part stay on the right piece, local to its new first frame
  rest.keys = c.keys.map((l) => ({ ...l, channels: Object.fromEntries(Object.entries(l.channels).map(([k, ks]) => [k, ks.map((key) => ({ ...key, frame: key.frame - local })).filter((key) => key.frame >= 0)])) }));
  const left: Content = { ...c, duration: local, offset: leftOff };
  const items = sortContent(at.track.content);
  const out: Content[] = [];
  for (const x of items) {
    if (x.id === id) { if (local > 0) out.push(left); out.push(hold, rest); continue; }
    out.push(x.start >= end(c) ? { ...x, start: x.start + len } : x);
  }
  if (local === 0) {
    // the cut is at the block's first frame: keep the original id on the rest, the hold goes before it
    const i = out.findIndex((x) => x === rest);
    out[i] = { ...rest, id: c.id, start: frame + len };
  }
  const tracks = movie.tracks.map((t) => (t.id === at.track.id ? { ...t, content: sortContent(out) } : t));
  return { movie: { ...movie, tracks, duration: Math.max(movie.duration, end(out[out.length - 1])) }, freeze: hold.id };
}
