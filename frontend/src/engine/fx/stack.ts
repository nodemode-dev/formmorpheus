// The effect stack of a content: the registry-effect lanes in the order they are applied. Reorder, copy, paste and presets.
// Pure, no DOM. The order is the order of the lanes in `Content.keys` (older files carry the built-in order).
import { kindSpec } from '../keys';
import type { Content, KeyLane } from '../types';

export interface FxPreset { name: string; lanes: KeyLane[] }

const isFx = (l: KeyLane): boolean => !!kindSpec(l.kind).fx;

/** The effect lanes of a content, first applied first. */
export function fxLanes(c: Content): KeyLane[] {
  return (c.keys ?? []).filter(isFx);
}

const clone = (l: KeyLane): KeyLane => JSON.parse(JSON.stringify(l)) as KeyLane;

/** Moves the effect `kind` to position `to` among the effects. Returns the same content when nothing changes. */
export function moveFx(c: Content, kind: string, to: number): Content {
  const fx = fxLanes(c);
  const from = fx.findIndex((l) => l.kind === kind);
  if (from < 0) return c;
  const t = Math.max(0, Math.min(fx.length - 1, to));
  if (t === from) return c;
  const [lane] = fx.splice(from, 1);
  fx.splice(t, 0, lane);
  let i = 0;
  return { ...c, keys: (c.keys ?? []).map((l) => (isFx(l) ? fx[i++] : l)) };
}

/** Switches one effect off or on without losing its settings or keys; `off` is written only while true. */
export function setFxOff(c: Content, kind: string, off: boolean): Content {
  return {
    ...c,
    keys: (c.keys ?? []).map((l) => {
      if (l.kind !== kind || (l.options.off === true) === off) return l;
      const options = { ...l.options };
      if (off) options.off = true; else delete options.off;
      return { ...l, options };
    }),
  };
}

/** Deep copies of the effect lanes, for the clipboard or a preset. Keys are kept relative to the block start. */
export function copyFx(c: Content): KeyLane[] {
  return fxLanes(c).map(clone);
}

/** Lays copies of `lanes` onto `c`: an effect it already has is replaced in place, a new one goes on top of the stack. `replace` clears the stack first. Keys past the block's end are dropped. */
export function pasteFx(c: Content, lanes: KeyLane[], replace = false): Content {
  let keys = (c.keys ?? []).slice();
  if (replace) keys = keys.filter((l) => !isFx(l));
  const last = Math.max(0, c.duration - 1);
  for (const src of lanes) {
    if (!kindSpec(src.kind).fx) continue;
    const l = clone(src);
    for (const id in l.channels) l.channels[id] = l.channels[id].filter((k) => k.frame <= last);
    const at = keys.findIndex((x) => x.kind === l.kind);
    if (at >= 0) keys[at] = l; else keys.push(l);
  }
  return { ...c, keys };
}

/** Removes every effect lane. */
export function clearFx(c: Content): Content {
  return { ...c, keys: (c.keys ?? []).filter((l) => !isFx(l)) };
}
