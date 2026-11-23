import { describe, expect, it, vi } from 'vitest';
import type { PenSample, RGB } from '@src/paint/types';
import { PredictTail } from '@src/ui/paint-predict';

const sample = (x: number, y: number): PenSample => ({ x, y, pressure: 1 }) as unknown as PenSample;
const red: RGB = { r: 200, g: 10, b: 0 };
const four = (): number => 4;

describe('PredictTail', () => {
  it('starts inactive and clearing it repaints nothing', () => {
    const t = new PredictTail();
    expect(t.active).toBe(false);
    expect(t.clear()).toBeNull();
  });

  it('returns the padded box of a new tail', () => {
    const t = new PredictTail();
    expect(t.set({ x: 0, y: 0 }, [sample(10, 0)], four, red, 1)).toEqual({ x: -4, y: -4, w: 18, h: 8 });
    expect(t.active).toBe(true);
  });

  it('raises widths below one pixel to one', () => {
    const t = new PredictTail();
    expect(t.set({ x: 0, y: 0 }, [sample(10, 10)], () => 0, red, 1)).toEqual({ x: -2.5, y: -2.5, w: 15, h: 15 });
  });

  it('pads by the widest sample', () => {
    const t = new PredictTail();
    const r = t.set({ x: 0, y: 0 }, [sample(2, 0), sample(20, 0)], (s) => s.x / 2, red, 1);
    expect(r).toEqual({ x: -7, y: -7, w: 34, h: 14 });
  });

  it('repaints the old and new tail together when it moves', () => {
    const t = new PredictTail();
    t.set({ x: 0, y: 0 }, [sample(10, 0)], four, red, 1);
    expect(t.set({ x: 100, y: 100 }, [sample(110, 100)], four, red, 1)).toEqual({ x: -4, y: -4, w: 118, h: 108 });
  });

  it('returns the last box on clear and then nothing', () => {
    const t = new PredictTail();
    t.set({ x: 0, y: 0 }, [sample(10, 0)], four, red, 1);
    expect(t.clear()).toEqual({ x: -4, y: -4, w: 18, h: 8 });
    expect(t.active).toBe(false);
    expect(t.clear()).toBeNull();
  });

  it('treats an empty sample list as no tail but still repaints the old one', () => {
    const t = new PredictTail();
    expect(t.set({ x: 0, y: 0 }, [], four, red, 1)).toBeNull();
    expect(t.active).toBe(false);
    t.set({ x: 0, y: 0 }, [sample(10, 0)], four, red, 1);
    expect(t.set({ x: 5, y: 5 }, [], four, red, 1)).toEqual({ x: -4, y: -4, w: 18, h: 8 });
    expect(t.active).toBe(false);
  });

  it('draws one segment per sample from the start point in the tail colour', () => {
    const calls: string[] = [];
    const ctx = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
      moveTo: (x: number, y: number): void => { calls.push(`m${x},${y}`); },
      lineTo: (x: number, y: number): void => { calls.push(`l${x},${y}`); },
      lineWidth: 0, globalAlpha: 1, strokeStyle: '', lineCap: '', lineJoin: '',
    };
    const t = new PredictTail();
    t.set({ x: 1, y: 2 }, [sample(3, 4), sample(5, 6)], (s) => s.x, red, 0.5);
    t.draw(ctx as unknown as CanvasRenderingContext2D);
    expect(calls).toEqual(['m1,2', 'l3,4', 'm3,4', 'l5,6']);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.strokeStyle).toBe('rgb(200, 10, 0)');
    expect(ctx.globalAlpha).toBeCloseTo(0.425, 10);
    expect(ctx.lineWidth).toBe(5);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('draws nothing once cleared', () => {
    const ctx = { save: vi.fn(), restore: vi.fn(), stroke: vi.fn() };
    const t = new PredictTail();
    t.set({ x: 0, y: 0 }, [sample(10, 0)], four, red, 1);
    t.clear();
    t.draw(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
