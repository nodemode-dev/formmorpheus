// Whole-channel edits of a lane that key-ops does not cover. Pure: returns a new Content.
import type { Content, Key, KeyKind } from './types';

/** Removes every channel of a lane whose id `drop` accepts (all its keys go); the lane stays, even with no keys left on the others. */
export function dropChannels(c: Content, kind: KeyKind, drop: (channel: string) => boolean): Content {
  const lane = c.keys.find((l) => l.kind === kind);
  if (!lane) return c;
  const channels: Record<string, Key[]> = {};
  let changed = false;
  for (const id in lane.channels) {
    if (drop(id)) { changed = true; continue; }
    channels[id] = lane.channels[id];
  }
  return changed ? { ...c, keys: c.keys.map((l) => (l === lane ? { ...lane, channels } : l)) } : c;
}
