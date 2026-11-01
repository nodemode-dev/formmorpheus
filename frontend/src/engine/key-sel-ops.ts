// Operations on a chosen set of keyframes of one content (the Timeline's key selection): copy by type, paste,
// delete and reverse. A key is named by its lane kind and content-local frame; all its channels go with it.
import { deleteKey, pasteKeys, reverseLane, type KeyClip } from './key-ops';
import { laneOf } from './keys';
import type { Content, Key, KeyKind, KeyLane } from './types';

export interface KeyRef { kind: KeyKind; frame: number }

export const refKey = (r: KeyRef): string => `${r.kind}:${r.frame}`;

/** The chosen keys as one clip per lane kind, each starting at the earliest chosen frame of the whole selection. */
export function copyRefs(c: Content, refs: readonly KeyRef[]): KeyClip[] {
  if (!refs.length) return [];
  const base = Math.min(...refs.map((r) => r.frame));
  const out: KeyClip[] = [];
  const kinds = new Set(refs.map((r) => r.kind));
  for (const kind of kinds) {
    const frames = new Set(refs.filter((r) => r.kind === kind).map((r) => r.frame));
    const lane = laneOf(c, kind);
    if (!lane) continue;
    const channels: Record<string, Key[]> = {};
    let last = 0;
    for (const id in lane.channels) {
      const list = lane.channels[id].filter((k) => frames.has(k.frame)).map((k) => ({ ...k, frame: k.frame - base }));
      if (!list.length) continue;
      channels[id] = list;
      last = Math.max(last, list[list.length - 1].frame);
    }
    if (Object.keys(channels).length) out.push({ kind, span: last, channels });
  }
  return out;
}

/** Pastes clips at `at`; each goes to the lane of its own type, which is made when the content has none. */
export function pasteClips(c: Content, clips: readonly KeyClip[], at: number): Content {
  return clips.reduce((acc, clip) => pasteKeys(acc, clip, at), c);
}

export function deleteRefs(c: Content, refs: readonly KeyRef[]): Content {
  return refs.reduce((acc, r) => deleteKey(acc, r.kind, r.frame), c);
}

/** Mirrors the chosen keys of each lane inside their own span; the keys not chosen stay where they are. */
export function reverseRefs(c: Content, refs: readonly KeyRef[]): Content {
  let out = c;
  // one axis for every lane: the centre of the whole selection, so the lanes stay in step
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of refs) { if (r.frame < lo) lo = r.frame; if (r.frame > hi) hi = r.frame; }
  const axis = { first: lo, last: hi };
  for (const kind of new Set(refs.map((r) => r.kind))) {
    const lane = laneOf(out, kind);
    if (!lane) continue;
    const frames = new Set(refs.filter((r) => r.kind === kind).map((r) => r.frame));
    const picked: Record<string, Key[]> = {};
    for (const id in lane.channels) picked[id] = lane.channels[id].filter((k) => frames.has(k.frame));
    const flipped = reverseLane({ ...lane, channels: picked }, axis);
    const channels: Record<string, Key[]> = {};
    for (const id in lane.channels) {
      const mirrored = flipped.channels[id] ?? [];
      // keys not chosen always stay; a mirrored key landing on one of them yields to it
      const keep = lane.channels[id].filter((k) => !frames.has(k.frame));
      const held = new Set(keep.map((k) => k.frame));
      channels[id] = [...keep, ...mirrored.filter((k) => !held.has(k.frame))].sort((a, b) => a.frame - b.frame);
    }
    const next: KeyLane = { ...lane, channels };
    out = { ...out, keys: out.keys.map((l) => (l.kind === kind ? next : l)) };
  }
  return out;
}
