import { describe, expect, it } from 'vitest';
import { demoStrokes, padFeel, renderPad, replay } from '@src/paint/studio-render';
import type { PadPaint } from '@src/paint/studio-render';
import type { Brush, Raster } from '@src/paint/types';

function brush(over: Partial<Brush>): Brush {
  return { smoothing: 0, ...over } as unknown as Brush;
}

const PAINT: PadPaint = { color: { r: 0, g: 0, b: 0 }, color2: { r: 255, g: 255, b: 255 }, size: 10, opacity: 1 } as unknown as PadPaint;

describe('padFeel', () => {
  it('uses neutral defaults for a brush with no feel settings', () => {
    expect(padFeel(brush({ smoothing: 0.2 }))).toEqual({ smoothing: 0.2, motion: false, expression: 0.5, amount: 1 });
  });

  it('adds half of the stabilization share to smoothing', () => {
    expect(padFeel(brush({ smoothing: 0.3, stabilization: 50 })).smoothing).toBeCloseTo(0.55, 10);
  });

  it('clamps smoothing at one and stabilization at one hundred', () => {
    expect(padFeel(brush({ smoothing: 0.9, stabilization: 100 })).smoothing).toBe(1);
    expect(padFeel(brush({ smoothing: 0.1, stabilization: 900 })).smoothing).toBeCloseTo(0.6, 10);
    expect(padFeel(brush({ smoothing: 0.1, stabilization: -40 })).smoothing).toBeCloseTo(0.1, 10);
  });

  it('turns percent settings into shares', () => {
    const f = padFeel(brush({ expression: 80, motionFilter: 40 }));
    expect(f.expression).toBeCloseTo(0.8, 10);
    expect(f.motion).toBe(true);
    expect(f.amount).toBeCloseTo(0.4, 10);
  });

  it('keeps an expression of zero instead of the default', () => {
    expect(padFeel(brush({ expression: 0 })).expression).toBe(0);
  });
});

describe('demoStrokes', () => {
  it('gives two pen strokes with fixed seeds that stay on the pad', () => {
    const s = demoStrokes();
    expect(s.map((x) => x.seed)).toEqual([4242, 777]);
    expect(s[0].ev.length).toBe(91);
    expect(s[1].ev.length).toBe(41);
    for (const st of s) {
      expect(st.ev[0].t).toBe(0);
      for (const e of st.ev) {
        expect(e.k).toBe('pen');
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.x).toBeLessThanOrEqual(1);
        expect(e.y).toBeGreaterThanOrEqual(0);
        expect(e.y).toBeLessThanOrEqual(1);
        expect(e.p).toBeGreaterThan(0);
        expect(e.p).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns fresh equal data on each call', () => {
    const a = demoStrokes();
    const b = demoStrokes();
    expect(a).toEqual(b);
    expect(a[0].ev).not.toBe(b[0].ev);
  });

  it('moves the first stroke left to right and the second top to bottom', () => {
    const [a, b] = demoStrokes();
    for (let i = 1; i < a.ev.length; i++) expect(a.ev[i].x).toBeGreaterThan(a.ev[i - 1].x);
    for (let i = 1; i < b.ev.length; i++) {
      expect(b.ev[i].y).toBeGreaterThan(b.ev[i - 1].y);
      expect(b.ev[i].t).toBeGreaterThan(b.ev[i - 1].t);
    }
  });
});

describe('renderPad', () => {
  it('gives a clear raster of the rounded size when there are no strokes', () => {
    const r = renderPad(brush({}), [], 10.4, 6.6, PAINT);
    expect(r.width).toBe(10);
    expect(r.height).toBe(7);
    expect(r.data.length).toBe(10 * 7 * 4);
    expect(r.data.every((v) => v === 0)).toBe(true);
  });

  it('never makes a raster smaller than one pixel', () => {
    const r = renderPad(brush({}), [], 0, -5, PAINT);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
    expect(r.data.length).toBe(4);
  });

  it('ignores a stroke without events', () => {
    const raster: Raster = { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(3) };
    replay(raster, brush({}), { seed: 1, ev: [] }, PAINT);
    expect(raster.data.every((v) => v === 3)).toBe(true);
  });
});
