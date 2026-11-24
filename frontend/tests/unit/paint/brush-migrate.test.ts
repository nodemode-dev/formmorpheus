import { describe, expect, it } from 'vitest';
import { BRUSH_VER, migrateBrush } from '@src/paint/brush-migrate';
import type { Brush } from '@src/paint/types';

const old = (over: Partial<Brush> = {}): Brush => ({
  id: 'b', name: 'B', set: 'S', tip: 'round', softness: 0, maxSize: 40, minSize: 2, spacing: 0.1, flow: 1,
  pressureSize: [1, 1], pressureFlow: [1, 1], tilt: 0, scatter: 0, rotationJitter: 0, followStroke: false,
  roundness: 1, grain: 0, smoothing: 0.2, pickup: 0.5, presets: [], ...over,
}) as unknown as Brush;

describe('migrateBrush', () => {
  it('returns a current brush untouched', () => {
    const b = old({ ver: BRUSH_VER, scatter: 0.7, rotationJitter: 0.4 });
    expect(migrateBrush(b)).toBe(b);
  });

  it('moves the old sideways scatter to the position scatter and the turn to scatter', () => {
    const b = old({ scatter: 0.6, rotationJitter: 0.25 });
    const o = migrateBrush(b);
    expect(o).not.toBe(b);
    expect(o.ver).toBe(BRUSH_VER);
    expect(o.scatterPos).toBe(0.6);
    expect(o.scatter).toBe(0.25);
    expect(o.rotationJitter).toBe(0);
  });

  it('does not change the brush it was given', () => {
    const b = old({ scatter: 0.6, rotationJitter: 0.25 });
    migrateBrush(b);
    expect(b.scatter).toBe(0.6);
    expect(b.rotationJitter).toBe(0.25);
    expect(b.ver).toBeUndefined();
  });

  it('leaves the position scatter unset when the old brush had no scatter', () => {
    const o = migrateBrush(old({ rotationJitter: 1 }));
    expect(o.scatterPos).toBeUndefined();
    expect(o.scatter).toBe(1);
  });

  it('turns a negative turn into zero scatter', () => {
    expect(migrateBrush(old({ rotationJitter: -0.5 })).scatter).toBe(0);
  });

  it('hands back the same converted copy on every call', () => {
    const b = old({ scatter: 0.3 });
    expect(migrateBrush(b)).toBe(migrateBrush(b));
  });

  it('does not convert a converted copy again', () => {
    const o = migrateBrush(old({ scatter: 0.3, rotationJitter: 0.9 }));
    const again = migrateBrush(o);
    expect(again).toBe(o);
    expect(again.scatter).toBe(0.9);
    expect(again.scatterPos).toBe(0.3);
  });

  it('treats an explicit version 1 like a brush with no version', () => {
    expect(migrateBrush(old({ ver: 1, scatter: 0.2 })).scatterPos).toBe(0.2);
  });

  it('shrinks a multi-stamp brush by the square root of its count and adds spread', () => {
    const o = migrateBrush(old({ shapeCount: 4, maxSize: 40, minSize: 2, scatter: 0.5 }));
    expect(o.maxSize).toBeCloseTo(20, 10);
    expect(o.minSize).toBeCloseTo(1, 10);
    expect(o.scatterPos).toBeCloseTo(0.75, 10);
  });

  it('gives a multi-stamp brush with no scatter the base spread', () => {
    expect(migrateBrush(old({ shapeCount: 2 })).scatterPos).toBeCloseTo(0.25, 10);
  });

  it('never shrinks below three tenths or a minimum size of 0.6', () => {
    const o = migrateBrush(old({ shapeCount: 100, maxSize: 50, minSize: 1 }));
    expect(o.maxSize).toBeCloseTo(15, 10);
    expect(o.minSize).toBe(0.6);
  });

  it('keeps the size of a single-stamp brush', () => {
    const o = migrateBrush(old({ shapeCount: 1.4, maxSize: 33, minSize: 3 }));
    expect(o.maxSize).toBe(33);
    expect(o.minSize).toBe(3);
  });
});
