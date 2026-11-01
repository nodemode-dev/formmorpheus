// Perform with several blocks selected: the block the pen grabbed is the lead, the others follow it. Each follower
// keeps its own take, built from the lead's change (moved by the same distance, turned and scaled by the same amount).
import { Recorder } from '../engine/perform';
import type { Content } from '../engine/types';

export interface PoseLike { x: number; y: number; sx: number; sy: number; rot: number }

export interface Follower {
  id: string;
  start: number;
  rec: Recorder;
  base: PoseLike;
  last: Record<string, number> | null;
}

export function makeFollowers(others: Array<{ c: Content; pose: PoseLike }>, channels: string[]): Follower[] {
  return others.map((o) => ({ id: o.c.id, start: o.c.start, rec: new Recorder('move', channels), base: o.pose, last: null }));
}

/** Sets each follower's latest values from the lead's (`vals` against the lead's pose `lead` when the take began). */
export function followLead(fs: Follower[], lead: PoseLike, vals: Record<string, number>): void {
  for (const f of fs) {
    const v: Record<string, number> = {};
    if (vals.x !== undefined) v.x = Math.round(f.base.x + (vals.x - lead.x));
    if (vals.y !== undefined) v.y = Math.round(f.base.y + (vals.y - lead.y));
    if (vals.rotation !== undefined) v.rotation = Math.round((f.base.rot + (vals.rotation - lead.rot)) * 10) / 10;
    if (vals.scaleX !== undefined && lead.sx) v.scaleX = Math.round(f.base.sx * (vals.scaleX / lead.sx) * 1000) / 1000;
    if (vals.scaleY !== undefined && lead.sy) v.scaleY = Math.round(f.base.sy * (vals.scaleY / lead.sy) * 1000) / 1000;
    f.last = v;
  }
}

/** Adds the followers' latest values at the Playhead frame. */
export function sampleFollowers(fs: Follower[], frame: number): void {
  for (const f of fs) if (f.last) f.rec.add(frame - f.start, f.last);
}
