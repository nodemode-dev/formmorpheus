import { describe, expect, it } from 'vitest';
import {
  baseValues, bezierSeg, boneSpec, channelSpec, easeAt, easeCurve, evalChannel, evalLane, hasKeyAt, hasKind, kindSpec,
  laneChannels, laneFrames, laneOf, shownOf, storedOf, warpChannelIds, warpRows, warpSize, type ChannelSpec,
} from '@src/engine/keys';
import { content } from '@src/engine/model';
import type { Ease, Key, KeyLane } from '@src/engine/types';
import { WARP_DEFAULT, WARP_MAX, WARP_MIN } from '@src/engine/warp-draw';

const k = (frame: number, value: number, ease: Ease = 'linear', extra: Partial<Key> = {}): Key => ({ frame, value, ease, ...extra });
const lane = (kind: KeyLane['kind'], channels: Record<string, Key[]>, options: KeyLane['options'] = {}): KeyLane => ({ kind, expanded: false, channels, options });

describe('evalChannel', () => {
  it('returns null without keys', () => {
    expect(evalChannel([], 5)).toBeNull();
  });

  it('holds the first value before the first key and the last value after the last', () => {
    const keys = [k(10, 3), k(20, 7)];
    expect(evalChannel(keys, -100)).toBe(3);
    expect(evalChannel(keys, 10)).toBe(3);
    expect(evalChannel(keys, 20)).toBe(7);
    expect(evalChannel(keys, 1e9)).toBe(7);
  });

  it('interpolates linearly inside a span', () => {
    const keys = [k(0, 0), k(10, 100), k(20, -100)];
    expect(evalChannel(keys, 2.5)).toBeCloseTo(25, 10);
    expect(evalChannel(keys, 10)).toBe(100);
    expect(evalChannel(keys, 15)).toBeCloseTo(0, 10);
  });

  it('finds the right span among many keys', () => {
    const keys = Array.from({ length: 101 }, (_, i) => k(i * 10, i * i));
    for (const i of [0, 1, 37, 63, 99]) {
      expect(evalChannel(keys, i * 10 + 5)).toBeCloseTo((i * i + (i + 1) * (i + 1)) / 2, 8);
    }
  });

  it('keeps the leaving value across a hold span and jumps at the next key', () => {
    const keys = [k(0, 4, 'hold'), k(10, 9)];
    expect(evalChannel(keys, 9.99)).toBe(4);
    expect(evalChannel(keys, 10)).toBe(9);
  });

  it('uses the ease of the key the span leaves', () => {
    const keys = [k(0, 0, 'hold'), k(10, 10, 'linear'), k(20, 20, 'hold')];
    expect(evalChannel(keys, 5)).toBe(0);
    expect(evalChannel(keys, 15)).toBeCloseTo(15, 10);
  });

  it('eases symmetrically with inout and leans the right way with in and out', () => {
    const mid = (e: Ease): number => evalChannel([k(0, 0, e), k(100, 1)], 50) as number;
    expect(mid('inout')).toBeCloseTo(0.5, 6);
    expect(mid('in')).toBeGreaterThan(0.5);
    expect(mid('out')).toBeLessThan(0.5);
    const early = evalChannel([k(0, 0, 'inout'), k(100, 1)], 10) as number;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.1);
  });

  it('rises without turning back for the plain eases', () => {
    for (const e of ['linear', 'in', 'out', 'inout'] as Ease[]) {
      const keys = [k(0, -5, e), k(60, 5)];
      let prev = -5;
      for (let f = 1; f <= 60; f++) {
        const v = evalChannel(keys, f) as number;
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
      expect(prev).toBe(5);
    }
  });

  it('treats a custom ease without handles as a straight line', () => {
    const keys = [k(0, 10, 'custom'), k(40, 50)];
    for (const f of [4, 10, 20, 33]) expect(evalChannel(keys, f)).toBeCloseTo(10 + f, 5);
  });

  it('follows custom handles that overshoot the target', () => {
    const keys = [k(0, 0, 'custom', { out: [0.3, 2], in: [0.7, 2] }), k(100, 10)];
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => evalChannel(keys, i + 1) as number));
    expect(peak).toBeGreaterThan(10);
    expect(evalChannel(keys, 100)).toBe(10);
  });
});

describe('bezierSeg', () => {
  it('starts and ends on the two values', () => {
    expect(bezierSeg(0, 2, 8, 0.2, 0.9, 5, 5)).toBeCloseTo(2, 9);
    expect(bezierSeg(1, 2, 8, 0.2, 0.9, 5, 5)).toBeCloseTo(8, 9);
  });

  it('is the straight line when the handles sit on it', () => {
    for (const u of [0.1, 0.25, 0.5, 0.8]) expect(bezierSeg(u, 0, 1, 1 / 3, 2 / 3, 1 / 3, 2 / 3)).toBeCloseTo(u, 6);
  });

  it('stays finite with both handles at the extremes of time', () => {
    for (const u of [0, 0.001, 0.5, 0.999, 1]) {
      const v = bezierSeg(u, 0, 1, 1, 0, 0, 1);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('easeCurve', () => {
  const all: Ease[] = ['linear', 'in', 'out', 'inout', 'bounce', 'elastic', 'overshoot'];

  it('runs every curve from zero to one and clamps time outside the span', () => {
    for (const e of all) {
      const f = easeCurve(e);
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
      expect(f(-3)).toBeCloseTo(0, 6);
      expect(f(7)).toBeCloseTo(1, 6);
    }
  });

  it('steps at the end for hold', () => {
    const f = easeCurve('hold');
    expect(f(0.999)).toBe(0);
    expect(f(1)).toBe(1);
  });

  it('pushes past the target for overshoot and elastic but not for bounce', () => {
    const peak = (e: Ease): number => Math.max(...Array.from({ length: 101 }, (_, i) => easeCurve(e)(i / 100)));
    expect(peak('overshoot')).toBeGreaterThan(1.05);
    expect(peak('elastic')).toBeGreaterThan(1.05);
    expect(peak('bounce')).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('lanes', () => {
  it('lists the frames of a lane once each, in order, or of one channel', () => {
    const l = lane('move', { x: [k(10, 0), k(2, 0)], y: [k(2, 0), k(30, 0)] });
    expect(laneFrames(l)).toEqual([2, 10, 30]);
    expect(laneFrames(l, 'y')).toEqual([2, 30]);
    expect(laneFrames(l, 'missing')).toEqual([]);
  });

  it('says whether a key sits on a frame', () => {
    const l = lane('move', { x: [k(10, 0)], y: [k(4, 0)] });
    expect(hasKeyAt(l, 10)).toBe(true);
    expect(hasKeyAt(l, 4, 'x')).toBe(false);
    expect(hasKeyAt(l, 4, 'y')).toBe(true);
    expect(hasKeyAt(l, 5)).toBe(false);
    expect(hasKeyAt(l, 5, 'missing')).toBe(false);
  });

  it('reads the ease of the key on a frame', () => {
    const l = lane('move', { x: [k(10, 0, 'hold')], y: [k(4, 0, 'inout')] });
    expect(easeAt(l, 10)).toBe('hold');
    expect(easeAt(l, 4)).toBe('inout');
    expect(easeAt(l, 4, 'x')).toBeNull();
    expect(easeAt(l, 99)).toBeNull();
    const bones = lane('bones', { b7: [k(3, 0, 'bounce')] });
    expect(easeAt(bones, 3)).toBe('bounce');
    expect(easeAt(bones, 4)).toBeNull();
  });

  it('finds a lane by kind and survives content without keys', () => {
    const l = lane('move', {});
    const c = content('image', 0, 10, { keys: [l] });
    expect(laneOf(c, 'move')).toBe(l);
    expect(laneOf(c, 'volume')).toBeNull();
    const old = { ...c } as Partial<typeof c>;
    delete old.keys;
    expect(laneOf(old as typeof c, 'move')).toBeNull();
  });

  it('takes the base values of a move lane from the transform and pivot', () => {
    const c = content('image', 0, 10);
    c.transform = { ...c.transform, x: 12, y: -7, scale: 2, rotation: 45 };
    c.pivot = { x: 3, y: 4 } as typeof c.pivot;
    expect(baseValues(c, 'move')).toEqual({ x: 12, y: -7, scaleX: 2, scaleY: 2, rotation: 45, px: 3, py: 4 });
    expect(baseValues(content('audio', 0, 10, { volume: 0.4 }), 'volume')).toEqual({ level: 0.4, pan: 0 });
  });

  it('evaluates keyed channels and leaves the others at their base', () => {
    const c = content('image', 0, 10);
    c.transform = { ...c.transform, x: 5, y: 9, rotation: 30 };
    const l = lane('move', { rotation: [k(0, 0), k(10, 90)] });
    const v = evalLane(c, l, 5);
    expect(v.rotation).toBeCloseTo(45, 10);
    expect(v.x).toBe(5);
    expect(v.y).toBe(9);
  });

  it('orders the channels of a bones lane by bone number', () => {
    const l = lane('bones', { b10: [k(0, 0)], b2: [k(0, 0)], b1: [k(0, 0)] });
    expect(laneChannels(l).map((s) => s.id)).toEqual(['b1', 'b2', 'b10']);
  });
});

describe('kinds and channels', () => {
  it('knows the built-in kinds and refuses anything else', () => {
    expect(hasKind('move')).toBe(true);
    expect(hasKind('no-such-kind')).toBe(false);
    expect(hasKind(7)).toBe(false);
    expect(hasKind(null)).toBe(false);
  });

  it('gives an empty spec for an unknown kind instead of failing', () => {
    expect(kindSpec('no-such-kind' as KeyLane['kind']).channels).toEqual([]);
  });

  it('makes bone channels on demand and finds fixed channels by id', () => {
    expect(boneSpec('b3').id).toBe('b3');
    expect(boneSpec('b3').unit).toBe('deg');
    expect(channelSpec('bones', 'b12')?.id).toBe('b12');
    expect(channelSpec('move', 'rotation')?.id).toBe('rotation');
    expect(channelSpec('move', 'nope')).toBeUndefined();
  });

  it('converts between stored and shown values both ways', () => {
    const spec = { display: 100, shift: 50 } as ChannelSpec;
    expect(shownOf(spec, 0.25)).toBe(75);
    expect(storedOf(spec, 75)).toBeCloseTo(0.25, 12);
    const plain = { display: 100 } as ChannelSpec;
    expect(shownOf(plain, 3, 4)).toBe(75);
    for (const v of [-2, 0, 0.3, 17]) expect(storedOf(plain, shownOf(plain, v, 8), 8)).toBeCloseTo(v, 10);
  });
});

describe('warp mesh', () => {
  it('uses the default size without a lane or with a bad size', () => {
    expect(warpSize(null)).toBe(WARP_DEFAULT);
    expect(warpSize(lane('warp', {}, { size: 'abc' }))).toBe(WARP_DEFAULT);
  });

  it('clamps the size and the rows to the allowed range', () => {
    expect(warpSize(lane('warp', {}, { size: 9999 }))).toBe(WARP_MAX);
    expect(warpSize(lane('warp', {}, { size: -1 }))).toBe(WARP_MIN);
    expect(warpRows(lane('warp', {}, { size: WARP_MIN, rows: 9999 }))).toBe(WARP_MAX);
    expect(warpRows(lane('warp', {}, { size: WARP_MAX }))).toBe(WARP_MAX);
  });

  it('has two channels per node, all different', () => {
    const ids = warpChannelIds(3, 2);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(warpChannelIds(3)).toHaveLength(18);
  });

  it('shows only the channels of its own mesh', () => {
    const l = lane('warp', {}, { size: WARP_MIN });
    const shown = laneChannels(l).map((s) => s.id).sort();
    expect(shown).toEqual(warpChannelIds(WARP_MIN).sort());
  });
});
