// Keyframe fast paths: repeat keys after the last one (loop, ping-pong, offset), thin existing keys to a tolerance,
// and turn a block along its motion path. Pure; every function returns a new Content.
import { evalChannel, evalLane, laneOf } from './keys';
import type { Content, Ease, Key, KeyKind, KeyLane } from './types';

export type CycleMode = 'loop' | 'pingpong' | 'offset';

function swapEase(e: Ease): Ease {
  return e === 'in' ? 'out' : e === 'out' ? 'in' : e;
}

/** The key that leaves the mirror image of `src` when a span is played backward: its ease belongs to the span that arrived at `src`. */
function mirrored(src: Key, spanStart: Key | undefined, frame: number): Key {
  if (!spanStart) return { frame, value: src.value, ease: src.ease, ...(src.out ? { out: src.out } : {}), ...(src.in ? { in: src.in } : {}) };
  const e = spanStart.ease;
  const k: Key = { frame, value: src.value, ease: swapEase(e) };
  if (e === 'custom' && spanStart) {
    const o = spanStart.out ?? [1 / 3, 1 / 3], i = spanStart.in ?? [2 / 3, 2 / 3];
    k.out = [1 - i[0], 1 - i[1]];
    k.in = [1 - o[0], 1 - o[1]];
  }
  return k;
}

function cycleChannel(keys: Key[], mode: CycleMode, lastFrame: number): Key[] {
  if (keys.length < 2) return keys;
  const f0 = keys[0].frame, f1 = keys[keys.length - 1].frame, span = f1 - f0;
  if (span <= 0) return keys;
  const out = keys.slice();
  const climb = keys[keys.length - 1].value - keys[0].value;
  for (let n = 1; ; n++) {
    const shift = span * n;
    if (f0 + shift > lastFrame) break;
    // loop and offset: the first key of a pass is the last key of the one before; it takes the pass's own value
    for (let i = 1; i < keys.length; i++) {
      const frame = keys[i].frame + shift;
      if (frame > lastFrame) break;
      out.push({ ...keys[i], frame, value: keys[i].value + (mode === 'offset' ? climb * n : 0) });
    }
  }
  return out;
}

/** Repeats the keys of one lane (or every lane) after its last key until `toFrame` (the block's last frame by default). */
export function cycleKeys(c: Content, mode: CycleMode, kind?: KeyKind, toFrame?: number): Content {
  const lastFrame = toFrame ?? c.duration - 1;
  const lanes = c.keys.map((lane): KeyLane => {
    if (kind && lane.kind !== kind) return lane;
    const channels: Record<string, Key[]> = {};
    for (const id in lane.channels) channels[id] = mode === 'pingpong' ? pingpong(lane.channels[id], lastFrame) : cycleChannel(lane.channels[id], mode, lastFrame);
    return { ...lane, channels };
  });
  return { ...c, keys: lanes };
}

/** Forward, then backward, then forward again, until `lastFrame`. */
function pingpong(keys: Key[], lastFrame: number): Key[] {
  if (keys.length < 2) return keys;
  const f0 = keys[0].frame, f1 = keys[keys.length - 1].frame, span = f1 - f0;
  if (span <= 0) return keys;
  const out = keys.slice();
  for (let n = 1; f0 + span * n <= lastFrame + span; n++) {
    if (n % 2 === 1) {
      // backward pass: the mirror of key i sits at f1 + (f1 - key.frame) of the first backward pass
      for (let i = keys.length - 2; i >= 0; i--) {
        const frame = f1 + (f1 - keys[i].frame) + span * (n - 1);
        if (frame > lastFrame) break;
        out.push(mirrored(keys[i], i > 0 ? keys[i - 1] : undefined, frame));
      }
    } else {
      for (let i = 1; i < keys.length; i++) {
        const frame = keys[i].frame + span * n;
        if (frame > lastFrame) break;
        out.push({ ...keys[i], frame });
      }
    }
  }
  return out;
}

/**
 * Removes keys that the curve does not need: a key goes when dropping it keeps every frame within `tolerance` of the
 * original value (a fraction of that channel's own range). Returns the thinned channel and how many keys went.
 */
export function thinChannel(keys: Key[], tolerance: number): Key[] {
  if (keys.length < 3) return keys;
  let lo = Infinity, hi = -Infinity;
  for (const k of keys) { if (k.value < lo) lo = k.value; if (k.value > hi) hi = k.value; }
  const tol = Math.max(1e-9, (hi - lo) * tolerance);
  const f0 = keys[0].frame, f1 = keys[keys.length - 1].frame;
  const truth = new Float64Array(f1 - f0 + 1);
  for (let f = f0; f <= f1; f++) truth[f - f0] = evalChannel(keys, f) ?? 0;
  let cur = keys.slice();
  for (let pass = 0; pass < 40; pass++) {
    let removed = false;
    for (let i = 1; i < cur.length - 1; i++) {
      // a hold or a key with a custom curve is a choice, not noise
      const a = cur[i - 1], b = cur[i + 1];
      const without = cur.slice(0, i).concat(cur.slice(i + 1));
      let ok = true;
      for (let f = a.frame; f <= b.frame && ok; f++) {
        const v = evalChannel(without, f) ?? 0;
        if (Math.abs(v - truth[f - f0]) > tol) ok = false;
      }
      if (ok) { cur = without; removed = true; i--; }
    }
    if (!removed) break;
  }
  return cur;
}

export function thinKeys(c: Content, tolerance: number, kind?: KeyKind): Content {
  const lanes = c.keys.map((lane): KeyLane => {
    if (kind && lane.kind !== kind) return lane;
    const channels: Record<string, Key[]> = {};
    for (const id in lane.channels) channels[id] = thinChannel(lane.channels[id], tolerance);
    return { ...lane, channels };
  });
  return { ...c, keys: lanes };
}

/** Number of keys in a content (for a toast after thinning). */
export function keyCount(c: Content): number {
  let n = 0;
  for (const l of c.keys) for (const id in l.channels) n += l.channels[id].length;
  return n;
}

/**
 * Rotation that follows the motion path: bakes a 'rotation' channel on the Move lane from the path's direction at every
 * frame between the first and last position key, `offsetDeg` added (0 points the picture's right edge along the path).
 */
export function autoOrient(c: Content, offsetDeg = 0): Content {
  const lane = laneOf(c, 'move');
  const xs = lane?.channels.x, ys = lane?.channels.y;
  if (!lane || !xs || !ys || xs.length < 2) return c;
  const f0 = Math.min(xs[0].frame, ys[0]?.frame ?? xs[0].frame), f1 = Math.max(xs[xs.length - 1].frame, ys[ys.length - 1]?.frame ?? 0);
  const keys: Key[] = [];
  let prev = 0, have = false;
  for (let f = f0; f <= f1; f++) {
    const a = evalLane(c, lane, f - 0.5), b = evalLane(c, lane, f + 0.5);
    const dx = b.x - a.x, dy = b.y - a.y;
    let ang = have ? prev : 0;
    if (Math.hypot(dx, dy) > 1e-4) {
      ang = (Math.atan2(dy, dx) * 180) / Math.PI + offsetDeg;
      // continuous across the +-180 seam
      if (have) while (ang - prev > 180) ang -= 360;
      if (have) while (ang - prev < -180) ang += 360;
    }
    prev = ang;
    have = true;
    keys.push({ frame: f, value: Math.round(ang * 100) / 100, ease: 'linear' });
  }
  const thin = thinChannel(keys, 0.002);
  const next: KeyLane = { ...lane, channels: { ...lane.channels, rotation: thin } };
  return { ...c, keys: c.keys.map((l) => (l === lane ? next : l)) };
}
