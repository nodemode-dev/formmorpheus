// Pure maths for the Draw & Paint view: a canvas that can be panned, zoomed and rotated, the
// two-finger gesture that drives it, the quick pinch test and the loupe geometry. No DOM.
//
// A canvas point p lands on the screen (relative to the canvas element) at
//   s = R(rot) * (scale * p + o)
// so rotating needs no pivot: the offset o is solved for whichever screen point must stay put.

import type { Point, Rect } from './types';

export interface ViewXform { scale: number; ox: number; oy: number; rot: number }

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;

export function rotPt(x: number, y: number, a: number): Point {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Screen point (relative to the canvas element) to the unrotated space the overlays are drawn in. */
export function unrotate(v: ViewXform, sx: number, sy: number): Point {
  return v.rot ? rotPt(sx, sy, -v.rot) : { x: sx, y: sy };
}

export function screenToCanvas(v: ViewXform, sx: number, sy: number): Point {
  const u = unrotate(v, sx, sy);
  return { x: (u.x - v.ox) / v.scale, y: (u.y - v.oy) / v.scale };
}

export function canvasToScreen(v: ViewXform, px: number, py: number): Point {
  const ux = v.ox + px * v.scale, uy = v.oy + py * v.scale;
  return v.rot ? rotPt(ux, uy, v.rot) : { x: ux, y: uy };
}

/** Bounds, on the screen, of a rectangle given in the unrotated space. */
export function rotBounds(r: Rect, rot: number): Rect {
  if (!rot) return r;
  const c = Math.cos(rot), s = Math.sin(rot);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const px = r.x + (i & 1 ? r.w : 0), py = r.y + (i & 2 ? r.h : 0);
    const x = px * c - py * s, y = px * s + py * c;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The offset that keeps canvas point `a` under screen point `c` at this scale and rotation. */
export function anchorOffset(scale: number, rot: number, a: Point, c: Point): Point {
  const u = rotPt(c.x, c.y, -rot);
  return { x: u.x - a.x * scale, y: u.y - a.y * scale };
}

/** Wrap to -PI..PI. */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  a = (a + Math.PI) % t;
  if (a < 0) a += t;
  return a - Math.PI;
}

/** Snap a rotation to upright (and quarter turns) when it is within `tol` radians. */
export function snapRotation(rot: number, tol = (4 * Math.PI) / 180): number {
  const w = wrapAngle(rot);
  const q = Math.round(w / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(w - q) < tol ? q : w;
}

export interface PinchStart {
  /** Finger distance and angle when the gesture began. */
  d: number;
  ang: number;
  scale: number;
  rot: number;
  /** Canvas point that was under the centre of the fingers. */
  anchor: Point;
}

export interface PinchNow { d: number; ang: number; cx: number; cy: number }

/** The view after a two-finger move: zoom by the distance ratio, turn by the angle change, follow the centre. */
export function pinchView(s: PinchStart, n: PinchNow, rotate = true): ViewXform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * (n.d / (s.d || 1))));
  const rot = rotate ? snapRotation(s.rot + wrapAngle(n.ang - s.ang)) : s.rot;
  const o = anchorOffset(scale, rot, s.anchor, { x: n.cx, y: n.cy });
  return { scale, rot, ox: o.x, oy: o.y };
}

/** A pinch that closes to under 60% of its start spread in under 300 ms snaps the view to fit. */
export function isQuickPinchIn(startD: number, endD: number, ms: number): boolean {
  return startD > 0 && endD / startD < 0.6 && ms < 300;
}

/** Pan delta given on the screen, converted to the unrotated offset space. */
export function panDelta(v: ViewXform, dx: number, dy: number): Point {
  return v.rot ? rotPt(dx, dy, -v.rot) : { x: dx, y: dy };
}

/** Where the loupe sits: above the pointer so a finger never covers it, flipped below near the top edge. */
export function loupePlacement(x: number, y: number, size: number, w: number, h: number): Point {
  const gap = 28;
  let ly = y - gap - size / 2;
  if (ly - size / 2 < 4) ly = y + gap + size / 2;
  const lx = Math.max(size / 2 + 4, Math.min(w - size / 2 - 4, x));
  return { x: lx, y: Math.min(h - size / 2 - 4, ly) };
}

/** Colour threshold (0..1) from a horizontal drag: right is looser, left is stricter. */
export function thresholdFromDrag(t0: number, dx: number, span = 420): number {
  return Math.max(0, Math.min(1, t0 + dx / span));
}
