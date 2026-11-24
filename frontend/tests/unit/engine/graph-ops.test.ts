import { describe, expect, it } from 'vitest';
import {
  clampShift, editKey, mirrorSpan, moveKeys, presetHandles, setHandles, setHandlesLinked, setKeyEase, spanHandles, withEase,
} from '@src/engine/graph-ops';
import { keyCount, thinChannel, thinKeys } from '@src/engine/key-fast-ops';
import type { Content, Ease, Key, KeyLane } from '@src/engine/types';

const key = (frame: number, value: number, ease: Ease = 'linear'): Key => ({ frame, value, ease });
const move = (channels: Record<string, Key[]>): Content =>
  ({ id: 'c', kind: 'shape', start: 0, duration: 40, keys: [{ kind: 'move', expanded: false, channels, options: {} } satisfies KeyLane] }) as unknown as Content;
const xs = (c: Content, channel = 'x'): Key[] => c.keys[0].channels[channel];
const three = (): Content => move({ x: [key(0, 0), key(5, 10), key(10, 20)], y: [key(5, 1)] });

describe('ease handles', () => {
  it('has no curve for a hold and a straight line for linear', () => {
    expect(presetHandles('hold')).toBeNull();
    const h = presetHandles('linear');
    expect(h?.out[0]).toBeCloseTo(h?.out[1] ?? -1);
    expect(h?.in[0]).toBeCloseTo(h?.in[1] ?? -1);
  });

  it('reads custom handles from the key and falls back to a straight line', () => {
    expect(spanHandles({ ...key(0, 0, 'custom'), out: [0.1, 0.4], in: [0.6, 0.9] })).toEqual({ out: [0.1, 0.4], in: [0.6, 0.9] });
    expect(spanHandles(key(0, 0, 'custom'))).toEqual(presetHandles('linear'));
    expect(spanHandles(key(0, 0, 'inout'))).toEqual(presetHandles('inout'));
  });

  it('starts a custom ease from the shape the key had and drops handles for a preset', () => {
    const custom = withEase(key(0, 0, 'in'), 'custom');
    expect(custom.ease).toBe('custom');
    expect({ out: custom.out, in: custom.in }).toEqual(presetHandles('in'));
    expect(withEase(custom, 'out')).toEqual(key(0, 0, 'out'));
  });

  it('mirrors a span in time', () => {
    expect(mirrorSpan(key(0, 0, 'in'))).toEqual({ ease: 'out' });
    expect(mirrorSpan(key(0, 0, 'out'))).toEqual({ ease: 'in' });
    expect(mirrorSpan(key(0, 0, 'bounce'))).toEqual({ ease: 'bounce' });
    const m = mirrorSpan({ ...key(0, 0, 'custom'), out: [0.1, 0.4], in: [0.6, 0.9] });
    expect(m.ease).toBe('custom');
    expect(m.out?.[0]).toBeCloseTo(0.4);
    expect(m.out?.[1]).toBeCloseTo(0.1);
    expect(m.in?.[0]).toBeCloseTo(0.9);
    expect(m.in?.[1]).toBeCloseTo(0.6);
  });

  it('makes a span custom with the time of each handle held inside the span', () => {
    const out = setHandles(three(), 'move', 'x', 0, [-0.5, -2], [1.7, 3]);
    expect(xs(out)[0]).toEqual({ frame: 0, value: 0, ease: 'custom', out: [0, -2], in: [1, 3] });
    expect(xs(out)[1]).toEqual(key(5, 10));
  });

  it('refuses handles on the last key, a missing key and a missing channel', () => {
    const c = three();
    expect(setHandles(c, 'move', 'x', 10, [0.2, 0], [0.8, 1])).toBe(c);
    expect(setHandles(c, 'move', 'x', 3, [0.2, 0], [0.8, 1])).toBe(c);
    expect(setHandles(c, 'move', 'nope', 0, [0.2, 0], [0.8, 1])).toBe(c);
    expect(setHandles(c, 'opacity', 'x', 0, [0.2, 0], [0.8, 1])).toBe(c);
  });

  it('leaves the neighbouring span alone when the handles are not linked or the neighbour is not custom', () => {
    const c = three();
    const plain = setHandles(c, 'move', 'x', 5, [0.2, 0], [0.8, 1]);
    expect(setHandlesLinked(c, 'move', 'x', 5, 'out', [0.2, 0], [0.8, 1], false)).toEqual(plain);
    expect(setHandlesLinked(c, 'move', 'x', 5, 'out', [0.2, 0], [0.8, 1], true)).toEqual(plain);
  });

  it('keeps the slope through the key when the linked neighbour span is custom', () => {
    const c = setHandles(three(), 'move', 'x', 0, [0.25, 0.25], [0.5, 0.5]);
    const out = setHandlesLinked(c, 'move', 'x', 5, 'out', [0.5, 1], [0.8, 1], true);
    const arriving = xs(out)[0].in as [number, number];
    const slopeIn = ((1 - arriving[1]) * 10) / ((1 - arriving[0]) * 5);
    const slopeOut = (1 * 10) / (0.5 * 5);
    expect(arriving[0]).toBe(0.5);
    expect(slopeIn).toBeCloseTo(slopeOut);
  });

  it('sets the ease of one key on one channel', () => {
    const c = three();
    const out = setKeyEase(c, 'move', 'x', 5, 'hold');
    expect(xs(out).map((k) => k.ease)).toEqual(['linear', 'hold', 'linear']);
    expect(xs(out, 'y')).toBe(xs(c, 'y'));
    expect(setKeyEase(out, 'move', 'x', 5, 'hold')).toBe(out);
    expect(setKeyEase(c, 'move', 'x', 7, 'hold')).toBe(c);
  });
});

describe('graph key moves', () => {
  it('moves a key to a new frame and value', () => {
    const out = editKey(three(), 'move', 'x', 5, 7, 99);
    expect(xs(out)[1]).toEqual(key(7, 99));
  });

  it('keeps an edited key between its neighbours and at or after frame zero', () => {
    expect(xs(editKey(three(), 'move', 'x', 5, 50, 1))[1].frame).toBe(9);
    expect(xs(editKey(three(), 'move', 'x', 5, -50, 1))[1].frame).toBe(1);
    expect(xs(editKey(three(), 'move', 'x', 0, -8, 1))[0].frame).toBe(0);
    expect(xs(editKey(three(), 'move', 'x', 10, 500, 1))[2].frame).toBe(500);
  });

  it('gives back the same content when the edit changes nothing or names no key', () => {
    const c = three();
    expect(editKey(c, 'move', 'x', 5, 5, 10)).toBe(c);
    expect(editKey(c, 'move', 'x', 4, 6, 1)).toBe(c);
    expect(editKey(c, 'move', 'z', 5, 6, 1)).toBe(c);
  });

  it('limits a shift so a key cannot pass an unselected neighbour', () => {
    const c = three();
    const mid = [{ channel: 'x', frame: 5 }];
    expect(clampShift(c, 'move', mid, 10)).toBe(4);
    expect(clampShift(c, 'move', mid, -10)).toBe(-4);
    expect(clampShift(c, 'move', mid, 2)).toBe(2);
  });

  it('limits a shift so no key goes before frame zero', () => {
    const c = three();
    const all = [0, 5, 10].map((frame) => ({ channel: 'x', frame }));
    expect(clampShift(c, 'move', all, -3)).toBeCloseTo(0);
    expect(clampShift(c, 'move', all, 7)).toBe(7);
    expect(clampShift(c, 'move', all.slice(1), -30)).toBe(-4);
  });

  it('allows no shift on a lane that does not exist', () => {
    expect(clampShift(three(), 'opacity', [{ channel: 'amount', frame: 0 }], 5)).toBe(0);
  });

  it('moves several keys together by a clamped shift and a value change', () => {
    const out = moveKeys(three(), 'move', [{ channel: 'x', frame: 5 }, { channel: 'x', frame: 10 }], 2.4, 5);
    expect(xs(out)).toEqual([key(0, 0), key(7, 15), key(12, 25)]);
    const held = moveKeys(three(), 'move', [{ channel: 'x', frame: 5 }], 40, 0);
    expect(xs(held).map((k) => k.frame)).toEqual([0, 9, 10]);
  });

  it('changes values per channel when given a function', () => {
    const out = moveKeys(three(), 'move', [{ channel: 'x', frame: 0 }, { channel: 'y', frame: 5 }], 0, (id) => (id === 'x' ? 1 : -1));
    expect(xs(out)[0].value).toBe(1);
    expect(xs(out, 'y')[0].value).toBe(0);
    expect(xs(out)[1].value).toBe(10);
  });

  it('gives back the same content when no keys are named', () => {
    const c = three();
    expect(moveKeys(c, 'move', [], 3, 3)).toBe(c);
    expect(moveKeys(c, 'opacity', [{ channel: 'x', frame: 0 }], 3, 3)).toBe(c);
  });
});

describe('thinning keys', () => {
  it('removes keys that lie on the line between their neighbours', () => {
    const out = thinChannel([key(0, 0), key(2, 2), key(5, 5), key(10, 10)], 0.01);
    expect(out).toEqual([key(0, 0), key(10, 10)]);
  });

  it('keeps a key that shapes the curve', () => {
    const keys = [key(0, 0), key(5, 10), key(10, 0)];
    expect(thinChannel(keys, 0.01)).toEqual(keys);
  });

  it('removes more with a larger tolerance', () => {
    const keys = [key(0, 0), key(5, 5.4), key(10, 10)];
    expect(thinChannel(keys, 0.001)).toHaveLength(3);
    expect(thinChannel(keys, 0.1)).toHaveLength(2);
  });

  it('never touches a channel with fewer than three keys', () => {
    const keys = [key(0, 0), key(10, 10)];
    expect(thinChannel(keys, 1)).toBe(keys);
  });

  it('thins the named lane only and counts the keys left', () => {
    const c = move({ x: [key(0, 0), key(5, 5), key(10, 10)], y: [key(0, 0), key(5, 9), key(10, 0)] });
    expect(keyCount(c)).toBe(6);
    expect(keyCount(thinKeys(c, 0.01))).toBe(5);
    expect(keyCount(thinKeys(c, 0.01, 'opacity'))).toBe(6);
    expect(keyCount({ ...c, keys: [] })).toBe(0);
  });
});
