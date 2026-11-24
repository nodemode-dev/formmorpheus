import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldRepeat, SpinDrag, TriSwipe, resetRotation } from '@src/ui/paint-gestures';
import { screenToCanvas, type ViewXform } from '@src/paint/viewmath';

describe('HoldRepeat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires at once, waits the delay, then repeats at the interval', () => {
    const h = new HoldRepeat(400, 100);
    const fn = vi.fn();
    h.start(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(5);
    expect(h.running).toBe(true);
    h.stop();
  });

  it('stops firing once stopped', () => {
    const h = new HoldRepeat(400, 100);
    const fn = vi.fn();
    h.start(fn);
    vi.advanceTimersByTime(600);
    const count = fn.mock.calls.length;
    h.stop();
    expect(h.running).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(count);
  });

  it('can start without firing at once', () => {
    const h = new HoldRepeat(400, 100);
    const fn = vi.fn();
    h.start(fn, false);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('cancels the previous hold when started again', () => {
    const h = new HoldRepeat(400, 100);
    const first = vi.fn();
    const second = vi.fn();
    h.start(first);
    h.start(second);
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second.mock.calls.length).toBeGreaterThan(1);
    h.stop();
  });

  it('is not running before it starts', () => {
    expect(new HoldRepeat().running).toBe(false);
  });

  it('fires once for a keyboard click on a bound button and not for a pointer click', () => {
    const h = new HoldRepeat(400, 100);
    const btn = document.createElement('button');
    const fn = vi.fn();
    h.bind(btn, fn);
    btn.dispatchEvent(new MouseEvent('click', { detail: 0 }));
    expect(fn).toHaveBeenCalledTimes(1);
    btn.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(h.running).toBe(false);
  });
});

describe('TriSwipe', () => {
  it('answers a firm downward travel as a swipe down, once', () => {
    const t = new TriSwipe();
    t.begin(100, 100);
    expect(t.update(100, 150)).toBeNull();
    expect(t.update(105, 175)).toBe('swipe-down');
    expect(t.fired).toBe(true);
    expect(t.update(105, 300)).toBeNull();
  });

  it('does not take a mostly sideways travel for a swipe down', () => {
    const t = new TriSwipe();
    t.begin(0, 0);
    expect(t.update(100, 80)).toBeNull();
    expect(t.fired).toBe(false);
  });

  it('answers three wide turns sideways as a scrub', () => {
    const t = new TriSwipe();
    t.begin(0, 0);
    expect(t.update(40, 0)).toBeNull();
    expect(t.update(0, 0)).toBeNull();
    expect(t.update(40, 0)).toBeNull();
    expect(t.update(0, 0)).toBe('scrub');
  });

  it('ignores narrow jitter however long it lasts', () => {
    const t = new TriSwipe();
    t.begin(0, 0);
    for (let n = 0; n < 20; n++) expect(t.update(n % 2 ? 0 : 10, 0)).toBeNull();
    expect(t.fired).toBe(false);
  });

  it('can read a new gesture after begin', () => {
    const t = new TriSwipe();
    t.begin(0, 0);
    expect(t.update(0, 100)).toBe('swipe-down');
    t.begin(0, 0);
    expect(t.fired).toBe(false);
    expect(t.update(0, 100)).toBe('swipe-down');
  });
});

const box = { left: 10, top: 20, width: 400, height: 300 } as unknown as DOMRect;
const mid = (v: ViewXform): { x: number; y: number } => screenToCanvas(v, 200, 150);

describe('SpinDrag', () => {
  it('reports no pointer until it begins and after it ends', () => {
    const s = new SpinDrag();
    expect(s.active).toBe(false);
    expect(s.pointer).toBe(-1);
    s.begin({ scale: 1, ox: 0, oy: 0, rot: 0 }, 7, 310, 170, box);
    expect(s.active).toBe(true);
    expect(s.pointer).toBe(7);
    s.end();
    expect(s.active).toBe(false);
    expect(s.pointer).toBe(-1);
  });

  it('turns by the angle swept around the middle and keeps the middle in place', () => {
    const v: ViewXform = { scale: 2, ox: 15, oy: -40, rot: 0 };
    const before = mid(v);
    const s = new SpinDrag();
    s.begin(v, 1, 10 + 300, 20 + 150, box);
    s.move(v, 10 + 200 + 100 * Math.cos(Math.PI / 6), 20 + 150 + 100 * Math.sin(Math.PI / 6), box);
    expect(v.rot).toBeCloseTo(Math.PI / 6, 9);
    const after = mid(v);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('snaps a turn close to upright', () => {
    const v: ViewXform = { scale: 1, ox: 0, oy: 0, rot: 0 };
    const s = new SpinDrag();
    s.begin(v, 1, 10 + 300, 20 + 150, box);
    const a = (2 * Math.PI) / 180;
    s.move(v, 10 + 200 + 100 * Math.cos(a), 20 + 150 + 100 * Math.sin(a), box);
    expect(v.rot).toBeCloseTo(0, 12);
  });

  it('snaps a quarter turn exactly', () => {
    const v: ViewXform = { scale: 1, ox: 0, oy: 0, rot: 0 };
    const s = new SpinDrag();
    s.begin(v, 1, 10 + 300, 20 + 150, box);
    s.move(v, 10 + 200 + 1, 20 + 150 + 100, box);
    expect(v.rot).toBeCloseTo(Math.PI / 2, 12);
  });

  it('leaves the view alone once it has ended', () => {
    const v: ViewXform = { scale: 1, ox: 3, oy: 4, rot: 0.3 };
    const s = new SpinDrag();
    s.begin(v, 1, 310, 170, box);
    s.end();
    s.move(v, 210, 270, box);
    expect(v).toEqual({ scale: 1, ox: 3, oy: 4, rot: 0.3 });
  });
});

describe('resetRotation', () => {
  it('stands the view upright while keeping the middle point under the middle', () => {
    const v: ViewXform = { scale: 1.5, ox: 30, oy: -10, rot: 0.7 };
    const before = mid(v);
    resetRotation(v, { width: 400, height: 300 });
    expect(v.rot).toBe(0);
    expect(v.scale).toBe(1.5);
    const after = mid(v);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});
