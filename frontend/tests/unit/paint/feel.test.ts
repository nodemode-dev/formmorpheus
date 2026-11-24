import { describe, expect, it } from 'vitest';
import { MotionFilter, brushScale, penButton } from '@src/paint/feel';
import type { PenSample } from '@src/paint/types';

const sample = (x: number, y: number, time: number, pressure = 0.5): PenSample =>
  ({ x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, time } as PenSample);

describe('MotionFilter', () => {
  it('returns the first sample untouched', () => {
    const f = new MotionFilter();
    const s = sample(3, 4, 100);
    expect(f.apply(s, 0)).toBe(s);
  });

  it('averages a slow small wobble hard', () => {
    const f = new MotionFilter();
    f.apply(sample(0, 0, 0, 0.5), 0);
    const out = f.apply(sample(0.01, 0, 10, 1), 0);
    expect(out.x).toBeCloseTo(0.002, 6);
    expect(out.y).toBe(0);
    expect(out.pressure).toBeCloseTo(0.725, 6);
    expect(out.time).toBe(10);
  });

  it('lets a quick deliberate move pass', () => {
    const f = new MotionFilter();
    f.apply(sample(0, 0, 0), 0);
    const out = f.apply(sample(100, 50, 10, 0.9), 0);
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(50);
    expect(out.pressure).toBeCloseTo(0.9);
  });

  it('counts a move as quick sooner with more expression', () => {
    const plain = new MotionFilter(), expressive = new MotionFilter();
    plain.apply(sample(0, 0, 0), 0);
    expressive.apply(sample(0, 0, 0), 1);
    const a = plain.apply(sample(10, 0, 10), 0);
    const b = expressive.apply(sample(10, 0, 10), 1);
    expect(b.x).toBeCloseTo(10);
    expect(a.x).toBeLessThan(b.x);
    expect(a.x).toBeGreaterThan(2);
  });

  it('applies only part of the correction for a partial amount', () => {
    const f = new MotionFilter();
    f.apply(sample(0, 0, 0, 0.5), 0, 0.5);
    const out = f.apply(sample(0.01, 0, 10, 1), 0, 0.5);
    expect(out.x).toBeCloseTo(0.006, 6);
    expect(out.pressure).toBeCloseTo(0.8625, 6);
  });

  it('treats samples with the same time as one millisecond apart', () => {
    const f = new MotionFilter();
    f.apply(sample(0, 0, 5), 0);
    const out = f.apply(sample(0.01, 0, 5), 0);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(out.x).toBeCloseTo(0.002, 6);
  });

  it('starts over after a reset', () => {
    const f = new MotionFilter();
    f.apply(sample(0, 0, 0), 0);
    f.reset();
    const s = sample(500, 500, 1);
    expect(f.apply(s, 0)).toBe(s);
  });
});

describe('brushScale', () => {
  it('does not scale when off', () => {
    expect(brushScale('off', 3, 4000, 4000)).toEqual({ zoom: 1, dynamic: false, k: 1, screenFixed: false });
  });

  it('keeps the screen size by scaling with the inverse view scale', () => {
    expect(brushScale('screen', 4, 100, 100)).toEqual({ zoom: 4, dynamic: true, k: 0.25, screenFixed: true });
  });

  it('survives a view scale of zero', () => {
    const s = brushScale('screen', 0, 100, 100);
    expect(Number.isFinite(s.k)).toBe(true);
    expect(s.k).toBeGreaterThan(0);
  });

  it('scales with the long side of the canvas', () => {
    const s = brushScale('canvas', 7, 1080, 3840);
    expect(s.k).toBe(2);
    expect(s.zoom).toBe(0.5);
    expect(s.dynamic).toBe(true);
    expect(s.screenFixed).toBe(false);
  });

  it('clamps the canvas scale between a quarter and four', () => {
    expect(brushScale('canvas', 1, 100, 50).k).toBe(0.25);
    expect(brushScale('canvas', 1, 100000, 50).k).toBe(4);
  });
});

describe('penButton', () => {
  it('ignores pointers that are not a pen', () => {
    expect(penButton({ pointerType: 'mouse', button: 2, buttons: 2 })).toBeNull();
    expect(penButton({ pointerType: 'touch', button: 5, buttons: 32 })).toBeNull();
  });

  it('reads the eraser end from the button or the mask', () => {
    expect(penButton({ pointerType: 'pen', button: 5, buttons: 0 })).toBe('eraser');
    expect(penButton({ pointerType: 'pen', button: -1, buttons: 33 })).toBe('eraser');
  });

  it('reads the barrel button and prefers the eraser when both are down', () => {
    expect(penButton({ pointerType: 'pen', button: 2, buttons: 0 })).toBe('barrel');
    expect(penButton({ pointerType: 'pen', button: -1, buttons: 3 })).toBe('barrel');
    expect(penButton({ pointerType: 'pen', button: 2, buttons: 34 })).toBe('eraser');
  });

  it('reports nothing for a plain pen tip', () => {
    expect(penButton({ pointerType: 'pen', button: 0, buttons: 1 })).toBeNull();
  });
});
