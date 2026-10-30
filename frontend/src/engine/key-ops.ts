// Pure keyframe edits: every function returns a new Content (structural sharing) and never mutates.
import type { Content, Ease, Key, KeyKind, KeyLane } from './types';
import { KEY_KINDS, baseValues, evalLane, kindSpec, laneOf } from './keys';

const KIND_ORDER = new Map<KeyKind, number>(KEY_KINDS.map((k, i) => [k.kind, i]));

function defaultOptions(kind: KeyKind): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const o of kindSpec(kind).options ?? []) out[o.id] = o.def;
  return out;
}

function mirror(e: Ease): Ease {
  return e === 'in' ? 'out' : e === 'out' ? 'in' : e;
}

/** Replace (or insert) a lane, keeping lanes in KEY_KINDS order. A null lane removes it. */
function withLane(c: Content, kind: KeyKind, lane: KeyLane | null): Content {
  const rest = c.keys.filter((l) => l.kind !== kind);
  if (lane) {
    rest.push(lane);
    rest.sort((a, b) => (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0));
  }
  return { ...c, keys: rest };
}

/** Drop empty channels; null when nothing is left. */
function tidy(lane: KeyLane): KeyLane | null {
  const channels: Record<string, Key[]> = {};
  let any = false;
  for (const id in lane.channels) {
    if (lane.channels[id].length) {
      channels[id] = lane.channels[id];
      any = true;
    }
  }
  return any ? { ...lane, channels } : null;
}

function putKey(list: Key[], key: Key): Key[] {
  const out: Key[] = [];
  let placed = false;
  for (const k of list) {
    if (k.frame === key.frame) {
      if (!placed) out.push(key);
      placed = true;
    } else if (k.frame > key.frame && !placed) {
      out.push(key);
      out.push(k);
      placed = true;
    } else out.push(k);
  }
  if (!placed) out.push(key);
  return out;
}

function easeBefore(list: Key[], frame: number): Ease | null {
  let e: Ease | null = null;
  for (const k of list) {
    if (k.frame < frame) e = k.ease;
    else break;
  }
  return e;
}

function newLane(kind: KeyKind): KeyLane {
  return { kind, expanded: true, channels: {}, options: defaultOptions(kind) };
}

export function setKeys(c: Content, kind: KeyKind, at: number, values: Record<string, number>, ease?: Ease): Content {
  const frame = Math.round(at);
  const lane = laneOf(c, kind) ?? newLane(kind);
  const channels: Record<string, Key[]> = { ...lane.channels };
  let changed = false;
  for (const spec of kindSpec(kind).channels) {
    const v = values[spec.id];
    if (v === undefined || !Number.isFinite(v)) continue;
    const list = channels[spec.id] ?? [];
    const existing = list.find((k) => k.frame === frame);
    const e = ease ?? existing?.ease ?? easeBefore(list, frame) ?? 'linear';
    if (existing && existing.value === v && existing.ease === e) continue;
    channels[spec.id] = putKey(list, { frame, value: v, ease: e });
    changed = true;
  }
  if (!changed) return c;
  return withLane(c, kind, { ...lane, channels });
}

export function addLane(c: Content, kind: KeyKind, at: number, keyAtStart: boolean, ease: Ease): Content {
  const frame = Math.round(at);
  const existing = laneOf(c, kind);
  if (existing) return setKeys(c, kind, frame, evalLane(c, existing, frame));
  const base = baseValues(c, kind);
  let out = setKeys(c, kind, frame, base, ease);
  if (keyAtStart && frame > 0) out = setKeys(out, kind, 0, base, ease);
  return out;
}

export function moveKey(c: Content, kind: KeyKind, from: number, to: number, channel?: string): Content {
  const lane = laneOf(c, kind);
  if (!lane || from === to) return c;
  const channels: Record<string, Key[]> = { ...lane.channels };
  let changed = false;
  for (const id in lane.channels) {
    if (channel && id !== channel) continue;
    const list = lane.channels[id];
    const k = list.find((q) => q.frame === from);
    if (!k) continue;
    channels[id] = putKey(
      list.filter((q) => q.frame !== from),
      { ...k, frame: to },
    );
    changed = true;
  }
  return changed ? withLane(c, kind, { ...lane, channels }) : c;
}

export function deleteKey(c: Content, kind: KeyKind, at: number, channel?: string): Content {
  const lane = laneOf(c, kind);
  if (!lane) return c;
  const channels: Record<string, Key[]> = { ...lane.channels };
  let changed = false;
  for (const id in lane.channels) {
    if (channel && id !== channel) continue;
    const list = lane.channels[id];
    if (!list.some((q) => q.frame === at)) continue;
    channels[id] = list.filter((q) => q.frame !== at);
    changed = true;
  }
  return changed ? withLane(c, kind, tidy({ ...lane, channels })) : c;
}

export function deleteLane(c: Content, kind: KeyKind): Content {
  return laneOf(c, kind) ? withLane(c, kind, null) : c;
}

export function setEase(c: Content, kind: KeyKind, at: number, ease: Ease, channel?: string): Content {
  const lane = laneOf(c, kind);
  if (!lane) return c;
  const channels: Record<string, Key[]> = { ...lane.channels };
  let changed = false;
  for (const id in lane.channels) {
    if (channel && id !== channel) continue;
    const list = lane.channels[id];
    if (!list.some((q) => q.frame === at && q.ease !== ease)) continue;
    channels[id] = list.map((q) => (q.frame === at ? { ...q, ease } : q));
    changed = true;
  }
  return changed ? withLane(c, kind, { ...lane, channels }) : c;
}

export function setAllEases(c: Content, kind: KeyKind, ease: Ease): Content {
  const lane = laneOf(c, kind);
  if (!lane) return c;
  const channels: Record<string, Key[]> = {};
  for (const id in lane.channels) channels[id] = lane.channels[id].map((k) => (k.ease === ease ? k : { ...k, ease }));
  return withLane(c, kind, { ...lane, channels });
}

function reverseLane(lane: KeyLane): KeyLane {
  let first = Infinity;
  let last = -Infinity;
  for (const id in lane.channels) {
    for (const k of lane.channels[id]) {
      if (k.frame < first) first = k.frame;
      if (k.frame > last) last = k.frame;
    }
  }
  if (first >= last) return lane;
  const channels: Record<string, Key[]> = {};
  for (const id in lane.channels) {
    const list = lane.channels[id];
    const n = list.length;
    const out: Key[] = new Array(n);
    // The span that ends at an old key becomes the span that leaves its mirrored key, with the ease flipped.
    for (let i = 0; i < n; i++) {
      const src = list[n - 1 - i];
      const ease = i < n - 1 ? mirror(list[n - 2 - i].ease) : list[n - 1].ease;
      out[i] = { frame: first + last - src.frame, value: src.value, ease };
    }
    channels[id] = out;
  }
  return { ...lane, channels };
}

export function reverseKeys(c: Content, kind?: KeyKind): Content {
  if (!c.keys.length) return c;
  let changed = false;
  const keys = c.keys.map((l) => {
    if (kind && l.kind !== kind) return l;
    const r = reverseLane(l);
    if (r !== l) changed = true;
    return r;
  });
  return changed ? { ...c, keys } : c;
}

export function setExpanded(c: Content, kind: KeyKind, expanded: boolean): Content {
  const lane = laneOf(c, kind);
  if (!lane || lane.expanded === expanded) return c;
  return withLane(c, kind, { ...lane, expanded });
}

export function setLaneOption(c: Content, kind: KeyKind, id: string, value: string | number | boolean): Content {
  const lane = laneOf(c, kind);
  if (!lane || lane.options[id] === value) return c;
  return withLane(c, kind, { ...lane, options: { ...lane.options, [id]: value } });
}

export interface KeyClip {
  kind: KeyKind;
  span: number;
  channels: Record<string, Key[]>;
}

export function copyKeys(c: Content, kind: KeyKind, at?: number): KeyClip | null {
  const lane = laneOf(c, kind);
  if (!lane) return null;
  const channels: Record<string, Key[]> = {};
  let first = Infinity;
  let last = -Infinity;
  for (const id in lane.channels) {
    const list = at === undefined ? lane.channels[id] : lane.channels[id].filter((k) => k.frame === at);
    if (!list.length) continue;
    channels[id] = list;
    if (list[0].frame < first) first = list[0].frame;
    if (list[list.length - 1].frame > last) last = list[list.length - 1].frame;
  }
  if (first === Infinity) return null;
  for (const id in channels) channels[id] = channels[id].map((k) => ({ ...k, frame: k.frame - first }));
  return { kind, span: last - first, channels };
}

export function pasteKeys(c: Content, clip: KeyClip, at: number): Content {
  const base = Math.round(at);
  const lane = laneOf(c, clip.kind) ?? newLane(clip.kind);
  const channels: Record<string, Key[]> = { ...lane.channels };
  for (const id in clip.channels) {
    let list = channels[id] ?? [];
    for (const k of clip.channels[id]) list = putKey(list, { ...k, frame: base + k.frame });
    channels[id] = list;
  }
  return withLane(c, clip.kind, { ...lane, channels });
}

function mapFrames(c: Content, f: (frame: number) => number): Content {
  if (!c.keys.length) return c;
  const keys = c.keys.map((lane) => {
    const channels: Record<string, Key[]> = {};
    for (const id in lane.channels) {
      let list: Key[] = [];
      for (const k of lane.channels[id]) list = putKey(list, { ...k, frame: f(k.frame) });
      channels[id] = list;
    }
    return { ...lane, channels };
  });
  return { ...c, keys };
}

export function shiftKeys(c: Content, delta: number): Content {
  if (!delta) return c;
  return mapFrames(c, (f) => f + delta);
}

export function scaleKeyTimes(c: Content, factor: number): Content {
  if (factor === 1 || !(factor > 0)) return c;
  return mapFrames(c, (f) => Math.round(f * factor));
}
