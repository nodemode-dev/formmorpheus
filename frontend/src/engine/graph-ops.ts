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

/**
 * Like setHandles, and when `link` the handle on the other side of the shared key follows (same slope through the
 * key), but only if that neighbouring span is already custom: Alt in the Graph breaks the link per side.
 * `side` is the handle moved: 'out' sits on the key `owner`, 'in' on the key after it.
 */
export function setHandlesLinked(c: Content, kind: KeyKind, channel: string, owner: number, side: 'out' | 'in', out: EaseHandle, inn: EaseHandle, link: boolean): Content {
  const first = setHandles(c, kind, channel, owner, out, inn);
  if (!link) return first;
  return editList(first, kind, channel, (list) => {
    const i = list.findIndex((k) => k.frame === owner);
    if (i < 0 || i >= list.length - 1) return null;
    const a = list[i], b = list[i + 1];
    const dt = b.frame - a.frame, dv = b.value - a.value;
    const next = list.slice();
    if (side === 'out') {
      // previous span p -> a: its arriving handle at a keeps the slope of the leaving one
      const p = list[i - 1];
      if (!p || p.ease !== 'custom') return null;
      const h = spanHandles(p);
      if (!h) return null;
      const vx = out[0] * dt, vy = out[1] * dv;
      if (vx < 1e-6) return null;
      const pdt = a.frame - p.frame, pdv = a.value - p.value;
      if (Math.abs(pdv) < 1e-9) return null;
      const dx = (h.in[0] - 1) * pdt;
      next[i - 1] = { ...p, in: [h.in[0], 1 + ((vy / vx) * dx) / pdv] };
    } else {
      // next span b -> n: its leaving handle at b keeps the slope of the arriving one
      const n = list[i + 2];
      if (!n || b.ease !== 'custom') return null;
      const h = spanHandles(b);
      if (!h) return null;
      const vx = (1 - inn[0]) * dt, vy = (1 - inn[1]) * dv;
      if (vx < 1e-6) return null;
      const ndt = n.frame - b.frame, ndv = n.value - b.value;
      if (Math.abs(ndv) < 1e-9) return null;
      const dx = h.out[0] * ndt;
      next[i + 1] = { ...b, out: [h.out[0], ((vy / vx) * dx) / ndv] };
    }
    return next;
  });
}

/** The frame shift that moving the selected keys by `df` can really apply: no key leaves 0 or passes an unselected neighbour. */
export function clampShift(c: Content, kind: KeyKind, items: { channel: string; frame: number }[], df: number): number {
  const lane = laneOf(c, kind);
  if (!lane) return 0;
  let lo = -Infinity, hi = Infinity;
  for (const id in lane.channels) {
    const list = lane.channels[id];
    const on = new Set(items.filter((s) => s.channel === id).map((s) => s.frame));
    for (let i = 0; i < list.length; i++) {
      if (!on.has(list[i].frame)) continue;
      lo = Math.max(lo, -list[i].frame);
      const p = list[i - 1], n = list[i + 1];
      if (p && !on.has(p.frame)) lo = Math.max(lo, p.frame + 1 - list[i].frame);
      if (n && !on.has(n.frame)) hi = Math.min(hi, n.frame - 1 - list[i].frame);
    }
  }
  return Math.min(hi, Math.max(lo, df));
}

/** Move several keys together: frames by `df` (clamped with clampShift), values by `dv`. */
export function moveKeys(c: Content, kind: KeyKind, items: { channel: string; frame: number }[], df: number, dv: number | ((channel: string) => number)): Content {
  const lane = laneOf(c, kind);
  if (!lane || !items.length) return c;
  const shift = clampShift(c, kind, items, Math.round(df));
  const channels: Record<string, Key[]> = { ...lane.channels };
  for (const id in lane.channels) {
    const on = new Set(items.filter((s) => s.channel === id).map((s) => s.frame));
    if (!on.size) continue;
    const d = typeof dv === 'number' ? dv : dv(id);
    channels[id] = lane.channels[id].map((k) => (on.has(k.frame) ? { ...k, frame: k.frame + shift, value: k.value + d } : k));
  }
  const nl: KeyLane = { ...lane, channels };
  return { ...c, keys: c.keys.map((l) => (l === lane ? nl : l)) };
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
