// Moving several chosen keyframes of one content by the same number of frames (the group drag on the Timeline).
// Pure: every function returns a new Content. A key is named by lane kind and content-local frame, all its channels go along.
import type { KeyRef } from './key-sel-ops';
import type { Content, Key, KeyLane } from './types';

/** The delta range that keeps every chosen key of `c` inside the content: [lowest, highest]. */
export function deltaRange(c: Content, refs: readonly KeyRef[]): [number, number] {
  if (!refs.length) return [0, 0];
  let lo = Infinity, hi = -Infinity;
  for (const r of refs) { lo = Math.min(lo, r.frame); hi = Math.max(hi, r.frame); }
  return [-lo, Math.max(0, c.duration - 1) - hi];
}

/** Moves the chosen keys of `c` by `delta` frames. A moved key landing on one that was not chosen replaces it. */
export function moveRefs(c: Content, refs: readonly KeyRef[], delta: number): Content {
  if (!delta || !refs.length) return c;
  const kinds = new Set(refs.map((r) => r.kind));
  let changed = false;
  const keys = (c.keys ?? []).map((lane): KeyLane => {
    if (!kinds.has(lane.kind)) return lane;
    const frames = new Set(refs.filter((r) => r.kind === lane.kind).map((r) => r.frame));
    const channels: Record<string, Key[]> = {};
    for (const id in lane.channels) {
      const list = lane.channels[id];
      const moved = list.filter((k) => frames.has(k.frame)).map((k) => ({ ...k, frame: k.frame + delta }));
      if (!moved.length) { channels[id] = list; continue; }
      const landing = new Set(moved.map((k) => k.frame));
      const stay = list.filter((k) => !frames.has(k.frame) && !landing.has(k.frame));
      channels[id] = [...stay, ...moved].sort((a, b) => a.frame - b.frame);
      changed = true;
    }
    return { ...lane, channels };
  });
  return changed ? { ...c, keys } : c;
}

/** The chosen refs after they moved by `delta`. */
export function shiftRefs(refs: readonly KeyRef[], delta: number): KeyRef[] {
  return refs.map((r) => ({ kind: r.kind, frame: r.frame + delta }));
}
