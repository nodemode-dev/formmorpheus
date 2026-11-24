import { describe, expect, it } from 'vitest';
import { content, newMovie, track } from '@src/engine/model';
import { applyTake, filterMotion, Recorder, reduceKeys, roomFor, type Take } from '@src/engine/perform';
import type { Key } from '@src/engine/types';

const k = (frame: number, value: number): Key => ({ frame, value, ease: 'linear' });
const pairs = (keys: Key[]): [number, number][] => keys.map((q) => [q.frame, q.value]);

describe('Recorder', () => {
  it('gives no take when nothing was recorded', () => {
    expect(new Recorder('move', ['x', 'y']).finish(0)).toBeNull();
  });

  it('records one key per frame at filtering zero and fills skipped frames', () => {
    const r = new Recorder('move', ['x']);
    r.add(2, { x: 10 });
    r.add(6, { x: 30 });
    const take = r.finish(0) as Take;
    expect([take.kind, take.from, take.to]).toEqual(['move', 2, 6]);
    expect(pairs(take.channels.x)).toEqual([[2, 10], [3, 15], [4, 20], [5, 25], [6, 30]]);
  });

  it('ignores frames that go back, frames before zero and values that are not numbers', () => {
    const r = new Recorder('move', ['x', 'y']);
    r.add(-3, { x: 1, y: 1 });
    r.add(Number.NaN, { x: 1, y: 1 });
    r.add(5, { x: 50, y: Number.NaN });
    r.add(3, { x: 999, y: 999 });
    r.add(6, { x: 60, z: 4 });
    const take = r.finish(0) as Take;
    expect(pairs(take.channels.x)).toEqual([[5, 50], [6, 60]]);
    expect(take.channels.y).toBeUndefined();
    expect(take.channels.z).toBeUndefined();
  });

  it('thins a steady drag to its two ends when filtering is on', () => {
    const r = new Recorder('move', ['x']);
    for (let f = 0; f <= 40; f++) r.add(f, { x: f * 5 });
    const take = r.finish(0.5) as Take;
    expect(pairs(take.channels.x)).toEqual([[0, 0], [40, 200]]);
  });

  it('treats filtering outside zero to one as clamped', () => {
    const r = new Recorder('move', ['x']);
    r.add(0, { x: 0 });
    r.add(1, { x: 7 });
    r.add(2, { x: 3 });
    expect((r.finish(-5) as Take).channels.x).toHaveLength(3);
  });
});

describe('filterMotion', () => {
  const spike = [k(0, 0), k(1, 0), k(2, 0), k(3, 0), k(4, 0), k(5, 100), k(6, 0), k(7, 0), k(8, 0), k(9, 0), k(10, 0)];

  it('returns copies of the keys at amount zero and for fewer than three keys', () => {
    const out = filterMotion(spike, 0);
    expect(out).toEqual(spike);
    expect(out[0]).not.toBe(spike[0]);
    expect(filterMotion([k(0, 1), k(1, 9)], 1)).toEqual([k(0, 1), k(1, 9)]);
  });

  it('flattens a spike and spreads it to both sides evenly', () => {
    const out = filterMotion(spike, 0.5);
    expect(out[5].value).toBeLessThan(60);
    expect(out[5].value).toBeGreaterThan(out[4].value);
    expect(out[4].value).toBeGreaterThan(0);
    expect(out[4].value).toBeCloseTo(out[6].value, 9);
    expect(out[3].value).toBeCloseTo(out[7].value, 9);
  });

  it('keeps the first and last value and the frames', () => {
    const ramp = [k(0, 40), k(1, 0), k(2, 30), k(3, 5), k(4, 70)];
    const out = filterMotion(ramp, 1);
    expect(out[0].value).toBe(40);
    expect(out[4].value).toBe(70);
    expect(out.map((q) => q.frame)).toEqual([0, 1, 2, 3, 4]);
  });

  it('leaves a constant channel constant', () => {
    const flat = Array.from({ length: 12 }, (_, i) => k(i, 42));
    for (const q of filterMotion(flat, 1)) expect(q.value).toBeCloseTo(42, 9);
  });
});

describe('reduceKeys', () => {
  it('gives nothing for nothing and keeps a single key', () => {
    expect(reduceKeys([], 1)).toEqual([]);
    expect(reduceKeys([k(4, 9)], 1)).toEqual([k(4, 9)]);
  });

  it('keeps only the ends of a straight run', () => {
    const run = Array.from({ length: 10 }, (_, i) => k(i, i * 3));
    expect(pairs(reduceKeys(run, 0.001))).toEqual([[0, 0], [9, 27]]);
  });

  it('keeps a corner that leaves the chord by more than the tolerance', () => {
    const bend = [k(0, 0), k(1, 10), k(2, 20), k(3, 10), k(4, 0)];
    expect(pairs(reduceKeys(bend, 5))).toEqual([[0, 0], [2, 20], [4, 0]]);
    expect(pairs(reduceKeys(bend, 20))).toEqual([[0, 0], [4, 0]]);
  });

  it('keeps every key that deviates at a zero or negative tolerance and writes linear eases', () => {
    const wobble: Key[] = [{ frame: 0, value: 0, ease: 'hold' }, k(1, 3), k(2, 1), k(3, 4)];
    const out = reduceKeys(wobble, -1);
    expect(pairs(out)).toEqual([[0, 0], [1, 3], [2, 1], [3, 4]]);
    expect(out.every((q) => q.ease === 'linear')).toBe(true);
  });
});

describe('applyTake', () => {
  const take = (xs: Key[], to = xs[xs.length - 1].frame): Take => ({ kind: 'move', from: xs[0].frame, to, channels: { x: xs } });

  it('adds a lane with the recorded keys and the chosen ease', () => {
    const c = content('drawing', 0, 20);
    const out = applyTake(c, take([k(2, 5), k(8, 9)]), 'hold');
    expect(out.keys).toHaveLength(1);
    expect(out.keys[0].kind).toBe('move');
    expect(out.keys[0].channels.x).toEqual([{ frame: 2, value: 5, ease: 'hold' }, { frame: 8, value: 9, ease: 'hold' }]);
    expect(out.duration).toBe(20);
    expect(c.keys).toHaveLength(0);
  });

  it('replaces only the recorded span of a channel and leaves other channels', () => {
    const first = applyTake(content('drawing', 0, 30), { kind: 'move', from: 0, to: 20, channels: { x: [k(0, 1), k(5, 2), k(10, 3), k(20, 4)], y: [k(0, 7)] } });
    const out = applyTake(first, take([k(4, 50), k(12, 60)]));
    expect(pairs(out.keys[0].channels.x)).toEqual([[0, 1], [4, 50], [12, 60], [20, 4]]);
    expect(out.keys[0].channels.y).toBe(first.keys[0].channels.y);
    expect(out.keys).toHaveLength(1);
  });

  it('grows the content to meet a longer take when there is room', () => {
    const out = applyTake(content('drawing', 0, 10), take([k(0, 0), k(14, 9)]));
    expect(out.duration).toBe(15);
    expect(pairs(out.keys[0].channels.x)).toEqual([[0, 0], [14, 9]]);
  });

  it('grows only as far as the room and drops keys past the last frame', () => {
    const out = applyTake(content('drawing', 0, 10), take([k(0, 0), k(11, 5), k(14, 9)]), 'linear', 12);
    expect(out.duration).toBe(12);
    expect(pairs(out.keys[0].channels.x)).toEqual([[0, 0], [11, 5]]);
  });

  it('returns the same content when no key of the take fits', () => {
    const c = content('drawing', 0, 10);
    expect(applyTake(c, take([k(15, 1), k(18, 2)]), 'linear', 10)).toBe(c);
  });
});

describe('roomFor', () => {
  it('stops at the next content on the track', () => {
    const a = content('drawing', 0, 10), b = content('drawing', 25, 10);
    const m = { ...newMovie(), duration: 100, tracks: [track('A', [a, b])] };
    expect(roomFor(m, a.id)).toBe(25);
    expect(roomFor(m, b.id)).toBe(75);
  });

  it('is never below the current duration and unbounded for unknown content', () => {
    const a = content('drawing', 95, 10);
    const m = { ...newMovie(), duration: 100, tracks: [track('A', [a])] };
    expect(roomFor(m, a.id)).toBe(10);
    expect(roomFor(m, 'nope')).toBe(Number.POSITIVE_INFINITY);
  });
});
