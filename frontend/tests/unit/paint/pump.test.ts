import { describe, expect, it, vi } from 'vitest';
import { PumpedStroke } from '@src/paint/pump';
import type { PenSample, PixelPatch, Rect, StrokeLike } from '@src/paint/types';

function sample(x: number, predicted = false): PenSample {
  return { x, y: 0, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: x, kind: 'pen', predicted } as PenSample;
}

function fake() {
  const seen: number[] = [];
  const patch = { tag: 'patch' } as unknown as PixelPatch;
  const cancelRect: Rect = { x: 9, y: 9, w: 1, h: 1 };
  const inner = {
    add: vi.fn((s: PenSample): Rect | null => { seen.push(s.x); return s.x < 0 ? null : { x: s.x, y: 0, w: 2, h: 2 }; }),
    finish: vi.fn((): PixelPatch | null => patch),
    cancel: vi.fn((): Rect | null => cancelRect),
  };
  return { inner: inner as unknown as StrokeLike, spy: inner, seen, patch, cancelRect };
}

describe('PumpedStroke', () => {
  it('queues samples without stamping them', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    expect(p.add(sample(1))).toBeNull();
    expect(p.add(sample(2))).toBeNull();
    expect(p.pending).toBe(2);
    expect(f.spy.add).not.toHaveBeenCalled();
  });

  it('never queues a predicted sample', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    p.add(sample(1, true));
    expect(p.pending).toBe(0);
    expect(p.drain(Infinity)).toBeNull();
    expect(f.seen).toEqual([]);
  });

  it('stamps everything in order with an unlimited budget and unites the changed rectangles', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    [10, 4, 20].forEach((x) => p.add(sample(x)));
    expect(p.drain(Infinity)).toEqual({ x: 4, y: 0, w: 18, h: 2 });
    expect(f.seen).toEqual([10, 4, 20]);
    expect(p.pending).toBe(0);
  });

  it('returns no rectangle when no stamp changed pixels', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    p.add(sample(-1));
    expect(p.drain(Infinity)).toBeNull();
    expect(f.seen).toEqual([-1]);
  });

  it('stamps at least one sample when the budget is already spent', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    [1, 2, 3].forEach((x) => p.add(sample(x)));
    expect(p.drain(0)).toEqual({ x: 1, y: 0, w: 2, h: 2 });
    expect(p.pending).toBe(2);
    p.drain(0);
    p.drain(0);
    expect(f.seen).toEqual([1, 2, 3]);
    expect(p.pending).toBe(0);
  });

  it('stops stamping once the time budget has passed', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const f = fake();
    f.spy.add.mockImplementation((s: PenSample) => { clock += 4; f.seen.push(s.x); return null; });
    const p = new PumpedStroke(f.inner);
    for (let x = 0; x < 10; x++) p.add(sample(x));
    p.drain(10);
    expect(f.seen).toEqual([0, 1, 2]);
    expect(p.pending).toBe(7);
  });

  it('keeps the order across many partial drains', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    for (let x = 0; x < 600; x++) p.add(sample(x));
    for (let i = 0; i < 300; i++) p.drain(0);
    p.add(sample(600));
    expect(p.pending).toBe(301);
    p.drain(Infinity);
    expect(f.seen).toEqual(Array.from({ length: 601 }, (_, i) => i));
  });

  it('stamps what is still queued before finishing the stroke', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    p.add(sample(1));
    p.add(sample(2));
    expect(p.finish()).toBe(f.patch);
    expect(f.seen).toEqual([1, 2]);
    expect(f.spy.finish).toHaveBeenCalledTimes(1);
  });

  it('throws the queue away on cancel', () => {
    const f = fake();
    const p = new PumpedStroke(f.inner);
    p.add(sample(1));
    expect(p.cancel()).toBe(f.cancelRect);
    expect(p.pending).toBe(0);
    expect(p.drain(Infinity)).toBeNull();
    expect(f.seen).toEqual([]);
  });
});
