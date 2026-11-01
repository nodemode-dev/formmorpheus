// Pure keyframe edits: every function returns a new Content (structural sharing) and never mutates.
import type { Content, Ease, Key, KeyKind, KeyLane } from './types';
import { baseValues, boneSpec, easeAt, evalLane, laneRank, kindSpec, laneFrames, laneOf, warpRows, warpSize } from './keys';
import { WARP_MAX, WARP_MIN, meshOffset, warpId } from './warp-draw';
import { mirrorSpan, withEase } from './graph-ops';
import { srcFrame } from './retime';


function defaultOptions(kind: KeyKind): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const o of kindSpec(kind).options ?? []) out[o.id] = o.def;
  return out;
}


/** Replace (or insert) a lane, keeping lanes in KEY_KINDS order. A null lane removes it. */
function withLane(c: Content, kind: KeyKind, lane: KeyLane | null): Content {
  const old = c.keys ?? [];
  const at = old.findIndex((l) => l.kind === kind);
  // an effect lane that already exists keeps its place in the stack
  if (lane && at >= 0 && kindSpec(kind).fx) return { ...c, keys: old.map((l, i) => (i === at ? lane : l)) };
  const rest = old.filter((l) => l.kind !== kind);
  if (lane) {
    rest.push(lane);
    rest.sort((a, b) => laneRank(a.kind) - laneRank(b.kind));
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
  // lanes start collapsed to one bar (Expand opens the per-parameter rows)
  return { kind, expanded: false, channels: {}, options: defaultOptions(kind) };
}

export function setKeys(c: Content, kind: KeyKind, at: number, values: Record<string, number>, ease?: Ease): Content {
  const frame = Math.round(at);
  const lane = laneOf(c, kind) ?? newLane(kind);
  const channels: Record<string, Key[]> = { ...lane.channels };
  let changed = false;
  for (const spec of kind === 'bones' ? Object.keys(values).map(boneSpec) : kindSpec(kind).channels) {
    const v = values[spec.id];
    if (v === undefined || !Number.isFinite(v)) continue;
    const list = channels[spec.id] ?? [];
    // the pivot channels are keyed only once the pivot is moved from its unkeyed value
    if (!list.length && kind === 'move' && (spec.id === 'px' || spec.id === 'py') && v === (c.pivot?.[spec.id === 'px' ? 'x' : 'y'] ?? 0)) continue;
    const existing = list.find((k) => k.frame === frame);
    const e = ease ?? existing?.ease ?? easeBefore(list, frame) ?? 'linear';
    if (existing && existing.value === v && existing.ease === e) continue;
    // keep what else the key carries (spatial tangents, custom ease handles)
    const { out: oldOut, in: oldIn, ...kept } = existing ?? ({} as Partial<Key>);
    // custom ease handles only mean something with ease 'custom'; any other ease drops the stale ones
    channels[spec.id] = putKey(list, e === 'custom' ? { ...kept, ...(oldOut ? { out: oldOut } : {}), ...(oldIn ? { in: oldIn } : {}), frame, value: v, ease: e } : { ...kept, frame, value: v, ease: e });
    changed = true;
  }
  if (!changed) return c;
  return withLane(c, kind, { ...lane, channels });
}

export function addLane(c: Content, kind: KeyKind, at: number, keyAtStart: boolean, ease: Ease): Content {
  const frame = Math.round(at);
  const existing = laneOf(c, kind);
  if (existing) return setKeys(c, kind, frame, evalLane(c, existing, frame));
  // Time Remap starts from what the block shows now: source frame at each key, so adding the lane changes nothing
  const base = kind === 'time' ? { src: srcFrame(c, frame) } : baseValues(c, kind);
  let out = setKeys(c, kind, frame, base, ease);
  if (keyAtStart && frame > 0) out = setKeys(out, kind, 0, kind === 'time' ? { src: srcFrame(c, 0) } : base, ease);
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
    channels[id] = list.map((q) => (q.frame === at ? withEase(q, ease) : q));
    changed = true;
  }
  return changed ? withLane(c, kind, { ...lane, channels }) : c;
}

export function setAllEases(c: Content, kind: KeyKind, ease: Ease): Content {
  const lane = laneOf(c, kind);
  if (!lane) return c;
  const channels: Record<string, Key[]> = {};
  for (const id in lane.channels) channels[id] = lane.channels[id].map((k) => (k.ease === ease ? k : withEase(k, ease)));
  return withLane(c, kind, { ...lane, channels });
}

/** Mirrors a lane around the middle of [axis.first, axis.last]; without an axis, around the middle of its own first and last key. */
export function reverseLane(lane: KeyLane, axis?: { first: number; last: number }): KeyLane {
  let first = Infinity;
  let last = -Infinity;
  for (const id in lane.channels) {
    for (const k of lane.channels[id]) {
      if (k.frame < first) first = k.frame;
      if (k.frame > last) last = k.frame;
    }
  }
  if (first > last) return lane;
  if (axis) { first = axis.first; last = axis.last; } else if (first >= last) return lane;
  const channels: Record<string, Key[]> = {};
  for (const id in lane.channels) {
    const list = lane.channels[id];
    const n = list.length;
    const out: Key[] = new Array(n);
    // The span that ends at an old key becomes the span that leaves its mirrored key, with the ease flipped.
    for (let i = 0; i < n; i++) {
      const src = list[n - 1 - i];
      const span = i < n - 1 ? mirrorSpan(list[n - 2 - i]) : { ease: list[n - 1].ease === 'custom' ? 'linear' as const : list[n - 1].ease };
      out[i] = { frame: first + last - src.frame, value: src.value, ...span };
      // the path runs backwards: what arrived now leaves, so the tangent sides swap
      if (src.sp) out[i].sp = { ...src.sp, in: [src.sp.out[0], src.sp.out[1]], out: [src.sp.in[0], src.sp.in[1]] };
    }
    channels[id] = out;
  }
  return { ...lane, channels };
}

/** `whole`: mirror every lane around the content's centre (first to last frame), so the lanes stay in step; otherwise each lane inside its own span. */
export function reverseKeys(c: Content, kind?: KeyKind, whole = false): Content {
  if (!c.keys.length) return c;
  let changed = false;
  let axis: { first: number; last: number } | undefined;
  if (whole) {
    let hi = Math.max(0, Math.round(c.duration) - 1);
    for (const l of c.keys) for (const id in l.channels) for (const k of l.channels[id]) if (k.frame > hi) hi = k.frame;
    axis = { first: 0, last: hi };
  }
  const keys = c.keys.map((l) => {
    if (kind && l.kind !== kind) return l;
    const r = reverseLane(l, axis);
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

/** Remove a lane option so the default applies again (the file then carries no trace of it). */
export function clearLaneOption(c: Content, kind: KeyKind, id: string): Content {
  const lane = laneOf(c, kind);
  if (!lane || !(id in lane.options)) return c;
  const { [id]: _gone, ...rest } = lane.options;
  return withLane(c, kind, { ...lane, options: rest });
}

/** Change a Warp lane's mesh to n x n nodes; every key frame is resampled from the old mesh so the pose at each key stays. */
export function setWarpSize(c: Content, n: number): Content {
  return setWarpGrid(c, n, n);
}

/** Warp mesh of `cols` nodes across and `rows` down (Add column, Add row); the picture's current bend is resampled onto it. */
export function setWarpGrid(c: Content, cols: number, rowsIn: number): Content {
  const lane = laneOf(c, 'warp');
  const size = Math.min(WARP_MAX, Math.max(WARP_MIN, Math.round(cols)));
  const rows = Math.min(WARP_MAX, Math.max(WARP_MIN, Math.round(rowsIn)));
  if (!lane || (warpSize(lane) === size && warpRows(lane) === rows)) return c;
  const old = warpSize(lane), oldRows = warpRows(lane);
  const channels: Record<string, Key[]> = {};
  const out = [0, 0];
  for (const frame of laneFrames(lane)) {
    const vals = evalLane(c, lane, frame);
    const dx: number[] = [], dy: number[] = [];
    for (let r = 0; r < oldRows; r++) for (let k = 0; k < old; k++) { dx.push(vals[warpId(r, k, 'x')] ?? 0); dy.push(vals[warpId(r, k, 'y')] ?? 0); }
    const ease = easeAt(lane, frame) ?? 'linear';
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < size; k++) {
        meshOffset(old, dx, dy, k / (size - 1), r / (rows - 1), out, false, oldRows);
        for (const [axis, v] of [['x', out[0]], ['y', out[1]]] as const) {
          const id = warpId(r, k, axis);
          (channels[id] ??= []).push({ frame, value: Math.round(v * 100) / 100, ease });
        }
      }
    }
  }
  const options: Record<string, string | number | boolean> = { ...lane.options, size };
  if (rows === size) delete options.rows;
  else options.rows = rows;
  return withLane(c, 'warp', { ...lane, channels, options });
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
