import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE, MIN_SCALE, anchorOffset, canvasToScreen, isQuickPinchIn, loupePlacement, panDelta, pinchView,
  rotBounds, rotPt, screenToCanvas, snapRotation, thresholdFromDrag, unrotate, wrapAngle,
} from '@src/paint/viewmath';
import type { ViewXform } from '@src/paint/viewmath';

describe('view transform', () => {
  it('rotates a point a quarter turn', () => {
    const p = rotPt(1, 0, Math.PI / 2);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(1, 12);
  });

  it('maps a canvas point to the screen without rotation', () => {
    const v: ViewXform = { scale: 2, ox: 10, oy: -4, rot: 0 };
    expect(canvasToScreen(v, 3, 5)).toEqual({ x: 16, y: 6 });
    expect(screenToCanvas(v, 16, 6)).toEqual({ x: 3, y: 5 });
  });

  it('round trips a point through a rotated and zoomed view', () => {
    const v: ViewXform = { scale: 1.7, ox: 33, oy: -12, rot: 0.6 };
    const s = canvasToScreen(v, 41, -7);
    const back = screenToCanvas(v, s.x, s.y);
    expect(back.x).toBeCloseTo(41, 9);
    expect(back.y).toBeCloseTo(-7, 9);
  });

  it('leaves a screen point alone when the view is upright', () => {
    expect(unrotate({ scale: 3, ox: 1, oy: 2, rot: 0 }, 7, 9)).toEqual({ x: 7, y: 9 });
  });

  it('solves the offset that keeps a canvas point under a screen point', () => {
    const a = { x: 120, y: 80 }, c = { x: 300, y: 222 };
    const o = anchorOffset(2.5, 1.1, a, c);
    const s = canvasToScreen({ scale: 2.5, rot: 1.1, ox: o.x, oy: o.y }, a.x, a.y);
    expect(s.x).toBeCloseTo(c.x, 9);
    expect(s.y).toBeCloseTo(c.y, 9);
  });

  it('returns the same rectangle for bounds without rotation', () => {
    const r = { x: 1, y: 2, w: 3, h: 4 };
    expect(rotBounds(r, 0)).toBe(r);
  });

  it('swaps width and height of the bounds after a quarter turn', () => {
    const b = rotBounds({ x: 0, y: 0, w: 10, h: 20 }, Math.PI / 2);
    expect(b.x).toBeCloseTo(-20, 9);
    expect(b.y).toBeCloseTo(0, 9);
    expect(b.w).toBeCloseTo(20, 9);
    expect(b.h).toBeCloseTo(10, 9);
  });

  it('converts a screen pan into the unrotated offset space', () => {
    const d = panDelta({ scale: 1, ox: 0, oy: 0, rot: Math.PI / 2 }, 1, 0);
    expect(d.x).toBeCloseTo(0, 12);
    expect(d.y).toBeCloseTo(-1, 12);
    expect(panDelta({ scale: 1, ox: 0, oy: 0, rot: 0 }, 4, -3)).toEqual({ x: 4, y: -3 });
  });
});

describe('angles', () => {
  it('wraps angles into the range from minus pi to pi', () => {
    expect(wrapAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(-1.5 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(2 * Math.PI + 0.25)).toBeCloseTo(0.25, 12);
    for (const a of [-100, -7, -3.2, 0, 3.2, 7, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
    }
  });

  it('snaps a nearly upright rotation to upright', () => {
    expect(snapRotation((2 * Math.PI) / 180)).toBe(0);
    expect(snapRotation((-3 * Math.PI) / 180)).toBeCloseTo(0, 12);
  });

  it('snaps to the nearest quarter turn', () => {
    expect(snapRotation((91 * Math.PI) / 180)).toBeCloseTo(Math.PI / 2, 12);
    expect(snapRotation((-88 * Math.PI) / 180)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('keeps a rotation that is outside the tolerance', () => {
    const a = (10 * Math.PI) / 180;
    expect(snapRotation(a)).toBeCloseTo(a, 12);
    expect(snapRotation(a, 0.5)).toBeCloseTo(0, 12);
  });
});

describe('pinch gesture', () => {
  const start = { d: 100, ang: 0, scale: 1, rot: 0, anchor: { x: 50, y: 60 } };

  it('zooms by the ratio of finger distances', () => {
    const v = pinchView(start, { d: 250, ang: 0, cx: 200, cy: 100 });
    expect(v.scale).toBeCloseTo(2.5, 12);
    expect(v.rot).toBe(0);
  });

  it('keeps the anchor point under the centre of the fingers', () => {
    const v = pinchView(start, { d: 180, ang: 0.7, cx: 310, cy: 140 });
    const s = canvasToScreen(v, 50, 60);
    expect(s.x).toBeCloseTo(310, 9);
    expect(s.y).toBeCloseTo(140, 9);
    expect(v.rot).toBeCloseTo(0.7, 12);
  });

  it('clamps the zoom at both ends', () => {
    expect(pinchView(start, { d: 1e9, ang: 0, cx: 0, cy: 0 }).scale).toBe(MAX_SCALE);
    expect(pinchView(start, { d: 1e-9, ang: 0, cx: 0, cy: 0 }).scale).toBe(MIN_SCALE);
  });

  it('does not turn when rotation is off', () => {
    const v = pinchView({ ...start, rot: 0.3 }, { d: 100, ang: 1.2, cx: 0, cy: 0 }, false);
    expect(v.rot).toBe(0.3);
  });

  it('survives a start distance of zero', () => {
    const v = pinchView({ ...start, d: 0 }, { d: 2, ang: 0, cx: 0, cy: 0 });
    expect(v.scale).toBe(2);
  });

  it('detects a quick pinch in only when it is both fast and deep', () => {
    expect(isQuickPinchIn(100, 50, 200)).toBe(true);
    expect(isQuickPinchIn(100, 70, 200)).toBe(false);
    expect(isQuickPinchIn(100, 50, 300)).toBe(false);
    expect(isQuickPinchIn(0, 0, 10)).toBe(false);
  });
});

describe('loupe and threshold', () => {
  it('places the loupe above the pointer', () => {
    expect(loupePlacement(200, 200, 100, 400, 400)).toEqual({ x: 200, y: 122 });
  });

  it('flips the loupe below the pointer near the top edge', () => {
    expect(loupePlacement(200, 50, 100, 400, 400)).toEqual({ x: 200, y: 128 });
  });

  it('keeps the loupe inside the left, right and bottom edges', () => {
    expect(loupePlacement(0, 200, 100, 400, 400).x).toBe(54);
    expect(loupePlacement(400, 200, 100, 400, 400).x).toBe(346);
    expect(loupePlacement(50, 10, 100, 400, 100).y).toBe(46);
  });

  it('turns a horizontal drag into a clamped threshold', () => {
    expect(thresholdFromDrag(0.2, 42)).toBeCloseTo(0.3, 12);
    expect(thresholdFromDrag(0.5, 4200)).toBe(1);
    expect(thresholdFromDrag(0.5, -4200)).toBe(0);
    expect(thresholdFromDrag(0.5, 50, 100)).toBe(1);
  });
});
