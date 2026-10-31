// Flipbook timing and production edits (shoot on N, reverse and append, cycle, blanks between, exposure sheet
// moves, notes, underlay). Pure: each returns a new Content and never mutates; each is one history step.
import { flipFrame } from './model';
import { copyFrame, eachRef, setHolds, type FrameRef } from './flip-ops';
import { OpError } from './ops';
import type { Content, FlipUnderlay, FlipbookFrame, OnionSettings } from './types';

function rowOf(c: Content, row: number): number {
  if (c.kind !== 'flipbook') throw new OpError('That content is not a flipbook.');
  if (!c.flip[row]) throw new OpError('That flipbook track no longer exists.');
  return row;
}

function patchFrames(c: Content, row: number, fn: (f: FlipbookFrame[]) => FlipbookFrame[]): Content {
  rowOf(c, row);
  return { ...c, flip: c.flip.map((t, i) => (i === row ? { ...t, frames: fn(t.frames) } : t)) };
}

/** Re-times the named frames to be held for `n` movie frames each (1 ones, 2 twos, 3 threes, 4 fours). */
export function shootOn(c: Content, refs: FrameRef[], n: number): Content {
  return setHolds(c, refs, Math.max(1, Math.min(8, Math.round(n))));
}

/** The default hold of new frames on a row; 1 clears it. */
export function setShoot(c: Content, row: number, n: number): Content {
  rowOf(c, row);
  const v = Math.max(1, Math.min(8, Math.round(n)));
  return { ...c, flip: c.flip.map((t, i) => {
    if (i !== row) return t;
    const { shoot: _s, ...rest } = t;
    return v > 1 ? { ...rest, shoot: v } : rest;
  }) };
}

/** Copies of the named frames in reverse order, placed after the last of them (a ping-pong cycle). `skipEnds` leaves out the turning frames so they are not shown twice. */
export function reverseAppend(c: Content, refs: FrameRef[], skipEnds = false): Content {
  return eachRef(c, refs, (_row, idx, cur) => {
    const picked = idx.map((i) => cur.frames[i]);
    let back = picked.slice().reverse().map(copyFrame);
    if (skipEnds) back = back.slice(1, -1);
    if (!back.length) return null;
    const last = idx[idx.length - 1];
    return [...cur.frames.slice(0, last + 1), ...back, ...cur.frames.slice(last + 1)];
  });
}

/** Repeats the named frames so they play `times` times in all (copies follow the selection). */
export function cycleFrames(c: Content, refs: FrameRef[], times: number): Content {
  const n = Math.max(1, Math.min(99, Math.round(times)));
  if (n < 2) return c;
  return eachRef(c, refs, (_row, idx, cur) => {
    const picked = idx.map((i) => cur.frames[i]);
    const more: FlipbookFrame[] = [];
    for (let k = 1; k < n; k++) for (const f of picked) more.push(copyFrame(f));
    const last = idx[idx.length - 1];
    return [...cur.frames.slice(0, last + 1), ...more, ...cur.frames.slice(last + 1)];
  });
}

/** A blank frame after every named frame except the last (one frame only: after it), held as long as the frame before it. */
export function blanksBetween(c: Content, refs: FrameRef[]): Content {
  return eachRef(c, refs, (_row, idx, cur) => {
    const set = new Set(idx.length > 1 ? idx.slice(0, -1) : idx);
    const out: FlipbookFrame[] = [];
    cur.frames.forEach((f, i) => {
      out.push(f);
      if (set.has(i)) out.push({ ...flipFrame(), hold: Math.max(1, f.hold) });
    });
    return out;
  });
}

/** Moves one frame a place earlier (-1) or later (1) within its row. */
export function nudgeFrame(c: Content, row: number, index: number, dir: -1 | 1): Content {
  return patchFrames(c, row, (f) => {
    const to = index + dir;
    if (!f[index] || to < 0 || to >= f.length) return f;
    const out = [...f];
    [out[index], out[to]] = [out[to], out[index]];
    return out;
  });
}

function patchFrame(c: Content, row: number, index: number, key: 'note' | 'name', text: string): Content {
  return patchFrames(c, row, (f) => f.map((x, i) => {
    if (i !== index) return x;
    const v = text.trim();
    const { [key]: _old, ...rest } = x;
    return v ? { ...rest, [key]: v } : rest;
  }));
}

export function setNote(c: Content, row: number, index: number, note: string): Content { return patchFrame(c, row, index, 'note', note); }

export function setLabel(c: Content, row: number, index: number, label: string): Content { return patchFrame(c, row, index, 'name', label); }

/** Sets or (null) removes the reference underlay. */
export function setUnderlay(c: Content, u: FlipUnderlay | null): Content {
  if (c.kind !== 'flipbook') throw new OpError('That content is not a flipbook.');
  const { underlay: _u, ...rest } = c;
  return u ? { ...rest, underlay: u } : rest;
}

export const DEFAULT_UNDERLAY: Omit<FlipUnderlay, 'asset'> = { visible: true, opacity: 0.5, x: 0, y: 0, scale: 1, offset: 0 };

/** The inbetweening preset: the previous and next drawing only, tinted, with the key drawings readable. */
export const INBETWEEN_ONION: Partial<OnionSettings> = {
  enabled: true, backFrames: 1, foreFrames: 1, opacity: 0.55, tint: true, backColor: '#ff4f7a', foreColor: '#3a9bff', blendPrimary: false,
  backOpacity: undefined, foreOpacity: undefined, backTint: undefined, foreTint: undefined,
};

/** Gives the flipbook its own onion settings set to the inbetweening preset. */
export function inbetweenOnion(c: Content, base: OnionSettings): Content {
  const o: OnionSettings = { ...(c.onion ?? base), ...INBETWEEN_ONION } as OnionSettings;
  delete o.backOpacity; delete o.foreOpacity; delete o.backTint; delete o.foreTint;
  return { ...c, onion: o };
}
