// Transitions between two blocks that touch on one track. Pure: finds the live transition at a frame and the
// maths of each kind; the renderer draws both blocks and mixes them with `mixPlan`.
import { end } from './model';
import { srcFrame } from './retime';
import type { Content, Transition, TransitionKind } from './types';

export const TRANSITION_KINDS: { id: TransitionKind; label: string }[] = [
  { id: 'crossfade', label: 'Crossfade' },
  { id: 'dip', label: 'Dip to Color' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'push', label: 'Push' },
];

export const MIN_TRANSITION = 2;

export interface ActiveTransition {
  a: Content;
  b: Content;
  tr: Transition;
  /** Content-local frame each side shows (the outgoing block holds its last frame, the incoming its first). */
  aLocal: number;
  bLocal: number;
  /** 0 to 1, never exactly either end. */
  p: number;
}

/** The block that touches the start of `b` on the same track, if any. */
export function previousOf(items: Content[], b: Content): Content | null {
  for (const x of items) if (x !== b && end(x) === b.start) return x;
  return null;
}

/** Frames of the window before and after the cut. */
export function halves(tr: Transition): [number, number] {
  const d = Math.max(MIN_TRANSITION, Math.round(tr.duration));
  const before = Math.floor(d / 2);
  return [before, d - before];
}

/** The transition running at `frame` on a track's blocks, or null. */
export function transitionAt(items: Content[], frame: number): ActiveTransition | null {
  for (const b of items) {
    const tr = b.transition;
    if (!tr) continue;
    const [pre, post] = halves(tr);
    const from = b.start - pre;
    if (frame < from || frame >= b.start + post) continue;
    const a = previousOf(items, b);
    if (!a) continue;
    // each side must really exist where it is shown
    if (frame < b.start && frame < a.start) continue;
    if (frame >= b.start && frame >= end(b)) continue;
    const d = pre + post;
    return {
      a, b, tr,
      aLocal: Math.min(a.duration - 1, frame - a.start),
      bLocal: Math.max(0, frame - b.start),
      p: (frame - from + 1) / (d + 1),
    };
  }
  return null;
}

export function anyTransitionAt(items: Content[], frame: number): boolean {
  for (const b of items) if (b.transition && transitionAt(items, frame)) return true;
  return false;
}

/** True when a group, or a group inside it, holds a block with a transition (a cheap test before the frame is looked at). */
function groupHas(g: Content): boolean {
  for (const t of g.tracks) for (const c of t.content) if (c.transition || (c.kind === 'group' && groupHas(c))) return true;
  return false;
}

/** True if any track of the list has a transition running at `frame` (the GPU compositor defers those frames to the CPU). */
export function tracksHaveTransition(tracks: { hidden: boolean; content: Content[] }[], frame: number): boolean {
  for (const t of tracks) {
    if (t.hidden) continue;
    let has = false;
    for (const c of t.content) if (c.transition) { has = true; break; }
    if (has && transitionAt(t.content, frame)) return true;
    // a group shows its own tracks at its own time: its transitions run there
    for (const c of t.content) {
      if (c.kind === 'group' && frame >= c.start && frame < end(c) && groupHas(c) && tracksHaveTransition(c.tracks, srcFrame(c, frame - c.start))) return true;
    }
  }
  return false;
}

export function defaultTransition(kind: TransitionKind, fps: number): Transition {
  const d = Math.max(MIN_TRANSITION, Math.round(fps / 2));
  if (kind === 'dip') return { kind, duration: d, color: '#000000' };
  if (kind === 'wipe' || kind === 'push') return { kind, duration: d, dir: 'l' };
  return { kind, duration: d };
}

/** The window a transition covers on the Timeline, as first frame and frame after the last. */
export function windowOf(b: Content): { from: number; to: number } | null {
  const tr = b.transition;
  if (!tr) return null;
  const [pre, post] = halves(tr);
  return { from: b.start - pre, to: b.start + post };
}
