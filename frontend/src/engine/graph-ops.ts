// Graph editor edits: per-key custom ease handles and single-channel key moves. Pure, no DOM.
import type { Content, Ease, EaseHandle, Key, KeyKind, KeyLane } from './types';
import { laneOf } from './keys';

export interface Handles { out: EaseHandle; in: EaseHandle }

/** The handle pair a preset ease draws (null for hold, which has no curve). */
export function presetHandles(ease: Ease): Handles | null {
  switch (ease) {
    case 'hold': return null;
    case 'in': return { out: [1 / 3, 1 / 3], in: [2 / 3, 1] };
    case 'out': return { out: [1 / 3, 0], in: [2 / 3, 2 / 3] };
    case 'inout': return { out: [1 / 3, 0], in: [2 / 3, 1] };
    default: return { out: [1 / 3, 1 / 3], in: [2 / 3, 2 / 3] };
  }
}

/** Handles of the span that leaves `k`, whatever its ease. */
export function spanHandles(k: Key): Handles | null {
  if (k.ease === 'custom') return { out: k.out ?? [1 / 3, 1 / 3], in: k.in ?? [2 / 3, 2 / 3] };
  return presetHandles(k.ease);
}

/** A key with a new ease; custom handles are kept only for 'custom' and start from the old shape. */
export function withEase(k: Key, ease: Ease): Key {
  const { out: _o, in: _i, ...rest } = k;
  if (ease !== 'custom') return { ...rest, ease };
  const h = spanHandles(k) ?? presetHandles('linear')!;
  return { ...rest, ease, out: [h.out[0], h.out[1]], in: [h.in[0], h.in[1]] };
}

/** The span after reversing time: ease swapped, custom handles mirrored. */
export function mirrorSpan(k: Key): Pick<Key, 'ease' | 'out' | 'in'> {
  if (k.ease === 'in') return { ease: 'out' };
  if (k.ease === 'out') return { ease: 'in' };
  if (k.ease !== 'custom') return { ease: k.ease };
  const h = spanHandles(k)!;
  return { ease: 'custom', out: [1 - h.in[0], 1 - h.in[1]], in: [1 - h.out[0], 1 - h.out[1]] };
}

function editList(c: Content, kind: KeyKind, channel: string, fn: (list: Key[]) => Key[] | null): Content {
  const lane = laneOf(c, kind);
  const list = lane?.channels[channel];
  if (!lane || !list) return c;
  const next = fn(list);
  if (!next) return c;
  const nl: KeyLane = { ...lane, channels: { ...lane.channels, [channel]: next } };
  return { ...c, keys: c.keys.map((l) => (l === lane ? nl : l)) };
}

/** Make the span leaving the key at `frame` custom with these handles (x clamped to 0..1). */
export function setHandles(c: Content, kind: KeyKind, channel: string, frame: number, out: EaseHandle, inn: EaseHandle): Content {
  const cl = (v: number): number => Math.min(1, Math.max(0, v));
  return editList(c, kind, channel, (list) => {
    const i = list.findIndex((k) => k.frame === frame);
    if (i < 0 || i === list.length - 1) return null;
    const next = list.slice();
    const { out: _o, in: _i, ...rest } = list[i];
    next[i] = { ...rest, ease: 'custom', out: [cl(out[0]), out[1]], in: [cl(inn[0]), inn[1]] };
    return next;
  });
}

/** Move one channel's key to a new frame and value; the frame stays between its neighbours. */
export function editKey(c: Content, kind: KeyKind, channel: string, from: number, to: number, value: number): Content {
  return editList(c, kind, channel, (list) => {
    const i = list.findIndex((k) => k.frame === from);
    if (i < 0) return null;
    const lo = i > 0 ? list[i - 1].frame + 1 : 0;
    const hi = i < list.length - 1 ? list[i + 1].frame - 1 : Infinity;
    const frame = Math.min(hi, Math.max(lo, to));
    if (frame === from && list[i].value === value) return null;
    const next = list.slice();
    next[i] = { ...list[i], frame, value };
    return next;
  });
}

/** Set the preset or custom ease of one key (one channel), keeping the handle rules. */
export function setKeyEase(c: Content, kind: KeyKind, channel: string, frame: number, ease: Ease): Content {
  return editList(c, kind, channel, (list) => {
    const i = list.findIndex((k) => k.frame === frame);
    if (i < 0 || list[i].ease === ease) return null;
    const next = list.slice();
    next[i] = withEase(list[i], ease);
    return next;
  });
}
