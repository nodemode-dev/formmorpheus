import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { View } from '@src/engine/render';
import type { Movie } from '@src/engine/types';
import { GestureCache } from '@src/ui/stage-gesture-cache';

const mv = (): Movie => ({ width: 100, height: 100 }) as unknown as Movie;
const view = (scale: number, ox: number, oy: number): View => ({ scale, ox, oy }) as unknown as View;

const setup = () => {
  const canvas = document.createElement('canvas');
  const settled = vi.fn();
  const seen = vi.fn();
  const cache = new GestureCache(canvas, settled, seen);
  const m = mv();
  cache.store(m, 3, view(1, 0, 0), 800, 600, false, 2);
  return { canvas, settled, seen, cache, m };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('GestureCache', () => {
  it('refuses to stand in before any picture is stored', () => {
    const cache = new GestureCache(document.createElement('canvas'), () => undefined);
    expect(cache.reuse(mv(), 0, view(1, 0, 0), 10, 10, false, 1)).toBe(false);
  });

  it('reuses the picture for the same view without a transform', () => {
    const { cache, m, canvas } = setup();
    expect(cache.reuse(m, 3, view(1, 0, 0), 800, 600, false, 2)).toBe(true);
    expect(canvas.style.transform).toBe('');
  });

  it('refuses when the movie, frame, size, preview or pixel ratio differ', () => {
    const { cache, m } = setup();
    expect(cache.reuse(mv(), 3, view(1, 0, 0), 800, 600, false, 2)).toBe(false);
    expect(cache.reuse(m, 4, view(1, 0, 0), 800, 600, false, 2)).toBe(false);
    expect(cache.reuse(m, 3, view(1, 0, 0), 801, 600, false, 2)).toBe(false);
    expect(cache.reuse(m, 3, view(1, 0, 0), 800, 599, false, 2)).toBe(false);
    expect(cache.reuse(m, 3, view(1, 0, 0), 800, 600, true, 2)).toBe(false);
    expect(cache.reuse(m, 3, view(1, 0, 0), 800, 600, false, 1)).toBe(false);
  });

  it('moves the cached picture in CSS pixels for a pan', () => {
    const { cache, m, canvas, seen } = setup();
    expect(cache.reuse(m, 3, view(1, 20, 10), 800, 600, false, 2)).toBe(true);
    expect(canvas.style.transform).toBe('translate(10.00px, 5.00px) scale(1.00000)');
    expect(seen).toHaveBeenLastCalledWith('translate(10.00px, 5.00px) scale(1.00000)');
  });

  it('scales the cached picture about the view origin for a zoom', () => {
    const { cache, m, canvas } = setup();
    expect(cache.reuse(m, 3, view(1.5, 0, 0), 800, 600, false, 2)).toBe(true);
    expect(canvas.style.transform).toBe('translate(0.00px, 0.00px) scale(1.50000)');
  });

  it('accepts a zoom of exactly twice or half the cached scale', () => {
    const { cache, m } = setup();
    expect(cache.reuse(m, 3, view(2, 0, 0), 800, 600, false, 2)).toBe(true);
    expect(cache.reuse(m, 3, view(0.5, 0, 0), 800, 600, false, 2)).toBe(true);
  });

  it('refuses a zoom that would make the picture too soft or too small', () => {
    const { cache, m } = setup();
    expect(cache.reuse(m, 3, view(2.01, 0, 0), 800, 600, false, 2)).toBe(false);
    expect(cache.reuse(m, 3, view(0.49, 0, 0), 800, 600, false, 2)).toBe(false);
  });

  it('calls settled once the gesture has been still long enough', () => {
    const { cache, m, settled } = setup();
    cache.reuse(m, 3, view(1, 5, 5), 800, 600, false, 2);
    vi.advanceTimersByTime(100);
    cache.reuse(m, 3, view(1, 6, 6), 800, 600, false, 2);
    vi.advanceTimersByTime(100);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('drops the transform and the pending settle when a new picture is stored', () => {
    const { cache, m, canvas, settled } = setup();
    cache.reuse(m, 3, view(1.2, 4, 4), 800, 600, false, 2);
    cache.store(m, 3, view(1.2, 4, 4), 800, 600, false, 2);
    expect(canvas.style.transform).toBe('');
    vi.advanceTimersByTime(1000);
    expect(settled).not.toHaveBeenCalled();
    expect(cache.reuse(m, 3, view(1.2, 4, 4), 800, 600, false, 2)).toBe(true);
  });

  it('forgets the picture when invalidated', () => {
    const { cache, m, canvas, settled } = setup();
    cache.reuse(m, 3, view(1, 8, 8), 800, 600, false, 2);
    cache.invalidate();
    expect(canvas.style.transform).toBe('');
    expect(cache.reuse(m, 3, view(1, 0, 0), 800, 600, false, 2)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps the picture for a new movie object after a rebind', () => {
    const { cache, m } = setup();
    const next = mv();
    cache.rebind(next);
    expect(cache.reuse(next, 3, view(1, 0, 0), 800, 600, false, 2)).toBe(true);
    expect(cache.reuse(m, 3, view(1, 0, 0), 800, 600, false, 2)).toBe(false);
  });

  it('reports a transform change only when the transform actually changes', () => {
    const { cache, m, seen } = setup();
    seen.mockClear();
    cache.reuse(m, 3, view(1, 20, 10), 800, 600, false, 2);
    cache.reuse(m, 3, view(1, 20, 10), 800, 600, false, 2);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
