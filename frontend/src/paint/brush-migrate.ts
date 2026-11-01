// Brushes made before Scatter turned into a rotation (`ver` 2): their `scatter` was the random sideways offset of each stamp
// and `rotationJitter` the random turn. The offset moves to `scatterPos`, the turn becomes `scatter`, so a brush looks as it
// did and the Studio's Scatter now means what it means in a brush file. Pure; one converted copy per brush object.

import type { Brush } from './types';

export const BRUSH_VER = 2;

const done = new WeakMap<Brush, Brush>();

/** The brush in the current meaning of its fields: the same object when it already is, else a converted copy (the same copy on every call). */
export function migrateBrush(b: Brush): Brush {
  if ((b.ver ?? 1) >= BRUSH_VER) return b;
  const hit = done.get(b);
  if (hit) return hit;
  const o: Brush = { ...b, ver: BRUSH_VER, scatter: Math.max(0, b.rotationJitter || 0), rotationJitter: 0 };
  if (b.scatter > 0) o.scatterPos = b.scatter;
  // Count used to lay n small stamps (each 1 / sqrt(n) of the size) inside a disc; now it lays n stamps at the full
  // size side by side, so an older multi-stamp brush gets the smaller size and a little spread to look as it did
  const n = Math.round(b.shapeCount ?? 1);
  if (n > 1) {
    const s = Math.max(0.3, 1 / Math.sqrt(n));
    o.maxSize = b.maxSize * s; o.minSize = Math.max(0.6, b.minSize * s);
    o.scatterPos = (b.scatter > 0 ? b.scatter : 0) + 0.25;
  }
  done.set(b, o);
  done.set(o, o);
  return o;
}
