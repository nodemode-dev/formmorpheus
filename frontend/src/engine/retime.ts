// Clip retime: speed, reverse and freeze. Pure maths on a Content; no movie, no DOM.
// A block shows a window of its source that starts at `offset` and spans `duration * speed` source frames.
// Forward, local frame L shows source frame offset + L * speed; reversed, the same window plays backward.
// Speed 0 is a freeze: every frame shows source frame `offset`.
import type { Content, Key } from './types';
import { evalChannel } from './keys';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export function speedOf(c: Content): number {
  return c.speed ?? 1;
}

export function isRetimed(c: Content): boolean {
  return c.speed !== undefined && c.speed !== 1 || c.reverse === true || timeKeys(c) !== null;
}

export function isFrozen(c: Content): boolean {
  return c.speed === 0;
}

/** Clip kinds that follow a source over time. */
export function canRetime(c: Content): boolean {
  return c.kind === 'video' || c.kind === 'audio' || c.kind === 'flipbook' || c.kind === 'group';
}

export function clampSpeed(s: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(s * 1000) / 1000));
}

/** The keys of a Time Remap lane (source frame per block frame, eased), or null without any. Video, Flipbook and Group only. */
export function timeKeys(c: Content): Key[] | null {
  if (c.kind === 'audio' || !c.keys) return null;
  for (const l of c.keys) if (l.kind === 'time') { const k = l.channels.src; return k && k.length ? k : null; }
  return null;
}

/** The (fractional) source frame a content shows at content-local frame `local`. Equal to `local + offset` when not retimed. */
export function srcFrame(c: Content, local: number): number {
  if (c.keys && c.keys.length) {
    const t = timeKeys(c);
    if (t) { const v = evalChannel(t, local); if (v !== null && Number.isFinite(v)) return Math.max(0, v); }
  }
  if (c.speed === undefined && !c.reverse) return local + c.offset;
  const s = c.speed ?? 1;
  if (s === 0) return c.offset;
  return c.reverse ? c.offset + (c.duration - 1 - local) * s : c.offset + local * s;
}

/** How many more output frames the end may grow to before the source runs out (Infinity: unbounded source). */
export function growEnd(c: Content, limit: number): number {
  if (!Number.isFinite(limit) || c.speed === 0) return Number.POSITIVE_INFINITY;
  const s = speedOf(c);
  if (!c.reverse) return Math.max(0, Math.floor((limit - c.offset - c.duration * s) / s + 1e-9));
  return Math.max(0, Math.floor(c.offset / s + 1e-9));
}

/** How many frames the start may move earlier before the source runs out. */
export function startBack(c: Content, limit: number): number {
  if (!Number.isFinite(limit) || c.speed === 0) return Number.POSITIVE_INFINITY;
  const s = speedOf(c);
  if (!c.reverse) return Math.max(0, Math.floor(c.offset / s + 1e-9));
  return Math.max(0, Math.floor((limit - c.offset - c.duration * s) / s + 1e-9));
}

/** The content after its length changed by `d` output frames at the end. */
export function afterTrimEnd(c: Content, d: number): Content {
  if (!c.reverse || c.speed === 0) return { ...c, duration: c.duration + d };
  return { ...c, duration: c.duration + d, offset: Math.max(0, c.offset - d * speedOf(c)) };
}

/** The content after its start moved by `d` frames (positive shortens it); `bounded`: the source has a start to stay inside. */
export function afterTrimStart(c: Content, d: number, bounded: boolean): Content {
  if (c.reverse || c.speed === 0) return { ...c, start: c.start + d, duration: c.duration - d };
  const off = c.offset + d * speedOf(c);
  return { ...c, start: c.start + d, duration: c.duration - d, offset: bounded ? Math.max(0, off) : off };
}

/** Offsets of the two halves when a block is cut `leftLen` frames in. */
export function splitOffsets(c: Content, leftLen: number): { left: number; right: number } {
  const s = speedOf(c);
  if (s === 0) return { left: c.offset, right: c.offset };
  if (c.reverse) return { left: c.offset + (c.duration - leftLen) * s, right: c.offset };
  return { left: c.offset, right: c.offset + leftLen * s };
}

/** The content with `duration` frames, its offset kept right for a reversed block (the playing end moves). */
export function withDuration(c: Content, duration: number): Content {
  return afterTrimEnd(c, duration - c.duration);
}

/** Pitch is kept (stretched) for speed changes unless the block asks for it to follow the speed. */
export function keepsPitch(c: Content): boolean {
  return c.speedPitch !== true;
}
