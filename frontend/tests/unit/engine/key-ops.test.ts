import { describe, expect, it } from 'vitest';
import {
  clearLaneOption, copyKeys, deleteKey, deleteLane, moveKey, pasteKeys, reverseKeys, reverseLane, scaleKeyTimes, setAllEases,
  setEase, setExpanded, setKeys, setLaneOption, shiftKeys,
} from '@src/engine/key-ops';
import type { Content, Ease, Key, KeyKind, KeyLane } from '@src/engine/types';

const blank = (duration = 30): Content => ({ id: 'c', kind: 'shape', start: 0, duration, keys: [] }) as unknown as Content;
const laneAt = (c: Content, kind: KeyKind): KeyLane => {
  const lane = c.keys.find((l) => l.kind === kind);
  if (!lane) throw new Error(`no ${kind} lane`);
  return lane;
};
const list = (c: Content, kind: KeyKind, channel: string): Key[] => laneAt(c, kind).channels[channel];
const frames = (c: Content, kind: KeyKind, channel: string): number[] => list(c, kind, channel).map((k) => k.frame);
const values = (c: Content, kind: KeyKind, channel: string): number[] => list(c, kind, channel).map((k) => k.value);
const eases = (c: Content, kind: KeyKind, channel: string): Ease[] => list(c, kind, channel).map((k) => k.ease);

function opacity(points: [number, number, Ease?][]): Content {
  let c = blank();
  for (const [f, v, e] of points) c = setKeys(c, 'opacity', f, { amount: v }, e);
  return c;
}

describe('setKeys', () => {
  it('creates a collapsed lane with a linear key on the rounded frame', () => {
    const out = setKeys(blank(), 'opacity', 4.6, { amount: 0.5 });
    expect(laneAt(out, 'opacity').expanded).toBe(false);
    expect(list(out, 'opacity', 'amount')).toEqual([{ frame: 5, value: 0.5, ease: 'linear' }]);
  });

  it('ignores channels the lane does not have and values that are not finite', () => {
    const c = blank();
    expect(setKeys(c, 'opacity', 0, { bogus: 1 })).toBe(c);
    expect(setKeys(c, 'opacity', 0, { amount: Number.NaN })).toBe(c);
    expect(setKeys(c, 'opacity', 0, { amount: Number.POSITIVE_INFINITY })).toBe(c);
  });

  it('gives back the same content when the key already holds that value', () => {
    const c = opacity([[3, 0.25]]);
    expect(setKeys(c, 'opacity', 3, { amount: 0.25 })).toBe(c);
  });

  it('keeps keys in time order whatever the order they were set in', () => {
    const c = opacity([[10, 1], [0, 0], [5, 0.5]]);
    expect(frames(c, 'opacity', 'amount')).toEqual([0, 5, 10]);
    expect(values(c, 'opacity', 'amount')).toEqual([0, 0.5, 1]);
  });

  it('replaces the value on a frame that already has a key and keeps its ease', () => {
    const c = setKeys(opacity([[0, 0, 'inout'], [10, 1, 'hold']]), 'opacity', 10, { amount: 0.3 });
    expect(values(c, 'opacity', 'amount')).toEqual([0, 0.3]);
    expect(eases(c, 'opacity', 'amount')).toEqual(['inout', 'hold']);
  });

  it('gives a new key the ease of the key before it', () => {
    const c = setKeys(opacity([[0, 0, 'inout']]), 'opacity', 8, { amount: 1 });
    expect(eases(c, 'opacity', 'amount')).toEqual(['inout', 'inout']);
  });

  it('does not key the pivot until it moves from its unkeyed value', () => {
    const still = setKeys(blank(), 'move', 0, { x: 5, px: 0, py: 0 });
    expect(Object.keys(laneAt(still, 'move').channels)).toEqual(['x']);
    const moved = setKeys(still, 'move', 0, { px: 3 });
    expect(values(moved, 'move', 'px')).toEqual([3]);
  });

  it('does not change the content it was given', () => {
    const c = opacity([[0, 0]]);
    setKeys(c, 'opacity', 5, { amount: 1 });
    expect(frames(c, 'opacity', 'amount')).toEqual([0]);
  });

  it('drops custom handles when a key gets another ease', () => {
    const base = opacity([[0, 0]]);
    const custom: Content = { ...base, keys: [{ ...base.keys[0], channels: { amount: [{ frame: 0, value: 0, ease: 'custom', out: [0.2, 0], in: [0.8, 1] }] } }] };
    const out = setKeys(custom, 'opacity', 0, { amount: 0.5 }, 'linear');
    expect(list(out, 'opacity', 'amount')).toEqual([{ frame: 0, value: 0.5, ease: 'linear' }]);
    const kept = setKeys(custom, 'opacity', 0, { amount: 0.5 });
    expect(list(kept, 'opacity', 'amount')[0]).toEqual({ frame: 0, value: 0.5, ease: 'custom', out: [0.2, 0], in: [0.8, 1] });
  });
});

describe('moveKey and deleteKey', () => {
  const two = (): Content => setKeys(setKeys(blank(), 'move', 0, { x: 1, y: 2 }), 'move', 6, { x: 3, y: 4 });

  it('gives back the same content when nothing would move', () => {
    const c = two();
    expect(moveKey(c, 'move', 6, 6)).toBe(c);
    expect(moveKey(c, 'opacity', 0, 4)).toBe(c);
    expect(moveKey(c, 'move', 3, 4)).toBe(c);
  });

  it('moves the frame on every channel', () => {
    const out = moveKey(two(), 'move', 6, 9);
    expect(frames(out, 'move', 'x')).toEqual([0, 9]);
    expect(frames(out, 'move', 'y')).toEqual([0, 9]);
  });

  it('moves one channel only when a channel is named', () => {
    const out = moveKey(two(), 'move', 6, 9, 'y');
    expect(frames(out, 'move', 'x')).toEqual([0, 6]);
    expect(frames(out, 'move', 'y')).toEqual([0, 9]);
  });

  it('replaces the key it lands on and stays sorted when it jumps over one', () => {
    const c = opacity([[0, 0.1], [5, 0.5], [10, 1]]);
    expect(values(moveKey(c, 'opacity', 0, 5), 'opacity', 'amount')).toEqual([0.1, 1]);
    const jumped = moveKey(c, 'opacity', 0, 7);
    expect(frames(jumped, 'opacity', 'amount')).toEqual([5, 7, 10]);
    expect(values(jumped, 'opacity', 'amount')).toEqual([0.5, 0.1, 1]);
  });

  it('deletes the key on every channel or on the named one', () => {
    expect(frames(deleteKey(two(), 'move', 0), 'move', 'x')).toEqual([6]);
    const one = deleteKey(two(), 'move', 0, 'x');
    expect(frames(one, 'move', 'x')).toEqual([6]);
    expect(frames(one, 'move', 'y')).toEqual([0, 6]);
  });

  it('gives back the same content when no key is on that frame', () => {
    const c = two();
    expect(deleteKey(c, 'move', 3)).toBe(c);
    expect(deleteKey(c, 'blur', 0)).toBe(c);
  });

  it('removes an emptied channel and then the lane with its last key', () => {
    const c = setKeys(two(), 'move', 12, { x: 9 });
    const out = deleteKey(c, 'move', 12);
    expect(frames(out, 'move', 'x')).toEqual([0, 6]);
    const gone = deleteKey(opacity([[4, 1]]), 'opacity', 4);
    expect(gone.keys).toEqual([]);
  });

  it('removes a whole lane and leaves the others', () => {
    const c = setKeys(two(), 'opacity', 0, { amount: 1 });
    const out = deleteLane(c, 'move');
    expect(out.keys.map((l) => l.kind)).toEqual(['opacity']);
    expect(deleteLane(out, 'move')).toBe(out);
  });
});

describe('eases and lane settings', () => {
  it('sets the ease of one key and gives back the same content when it already has it', () => {
    const c = opacity([[0, 0], [5, 1]]);
    const out = setEase(c, 'opacity', 5, 'hold');
    expect(eases(out, 'opacity', 'amount')).toEqual(['linear', 'hold']);
    expect(setEase(out, 'opacity', 5, 'hold')).toBe(out);
    expect(setEase(c, 'blur', 5, 'hold')).toBe(c);
  });

  it('gives a key custom handles when it becomes custom and drops them afterwards', () => {
    const custom = setEase(opacity([[0, 0], [5, 1]]), 'opacity', 0, 'custom');
    const k = list(custom, 'opacity', 'amount')[0];
    expect(k.ease).toBe('custom');
    expect(k.out).toHaveLength(2);
    expect(k.in).toHaveLength(2);
    const back = setEase(custom, 'opacity', 0, 'out');
    expect(list(back, 'opacity', 'amount')[0]).toEqual({ frame: 0, value: 0, ease: 'out' });
  });

  it('sets every ease of a lane at once', () => {
    const out = setAllEases(opacity([[0, 0, 'in'], [5, 1, 'hold'], [9, 0]]), 'opacity', 'inout');
    expect(eases(out, 'opacity', 'amount')).toEqual(['inout', 'inout', 'inout']);
  });

  it('expands and collapses a lane', () => {
    const c = opacity([[0, 0]]);
    const open = setExpanded(c, 'opacity', true);
    expect(laneAt(open, 'opacity').expanded).toBe(true);
    expect(setExpanded(open, 'opacity', true)).toBe(open);
    expect(setExpanded(c, 'blur', true)).toBe(c);
  });

  it('sets and clears a lane option', () => {
    const c = opacity([[0, 0]]);
    const set = setLaneOption(c, 'opacity', 'custom', 7);
    expect(laneAt(set, 'opacity').options.custom).toBe(7);
    expect(setLaneOption(set, 'opacity', 'custom', 7)).toBe(set);
    const cleared = clearLaneOption(set, 'opacity', 'custom');
    expect('custom' in laneAt(cleared, 'opacity').options).toBe(false);
    expect(clearLaneOption(cleared, 'opacity', 'custom')).toBe(cleared);
  });
});

describe('reversing keys', () => {
  it('mirrors frames inside the lane span and reverses the values', () => {
    const lane = laneAt(opacity([[0, 0.1], [2, 0.5], [10, 1]]), 'opacity');
    const out = reverseLane(lane);
    expect(out.channels.amount.map((k) => k.frame)).toEqual([0, 8, 10]);
    expect(out.channels.amount.map((k) => k.value)).toEqual([1, 0.5, 0.1]);
  });

  it('moves each span ease to its mirrored key and swaps ease in with ease out', () => {
    const lane = laneAt(opacity([[2, 1, 'in'], [6, 2, 'hold'], [10, 3, 'out']]), 'opacity');
    expect(reverseLane(lane).channels.amount.map((k) => k.ease)).toEqual(['hold', 'out', 'out']);
  });

  it('restores frames and values when reversed twice', () => {
    const lane = laneAt(opacity([[1, 0.1], [4, 0.5], [13, 1]]), 'opacity');
    const twice = reverseLane(reverseLane(lane));
    expect(twice.channels.amount.map((k) => [k.frame, k.value])).toEqual([[1, 0.1], [4, 0.5], [13, 1]]);
  });

  it('leaves a lane with one key alone unless an axis is given', () => {
    const lane = laneAt(opacity([[5, 1]]), 'opacity');
    expect(reverseLane(lane)).toBe(lane);
    expect(reverseLane(lane, { first: 0, last: 20 }).channels.amount[0].frame).toBe(15);
  });

  it('mirrors every lane around the whole content when asked', () => {
    const c = setKeys(opacity([[4, 1]]), 'move', 0, { x: 7 });
    const out = reverseKeys(c, undefined, true);
    expect(frames(out, 'opacity', 'amount')).toEqual([25]);
    expect(frames(out, 'move', 'x')).toEqual([29]);
  });

  it('reverses only the named lane and gives back the same content when nothing changes', () => {
    const c = setKeys(setKeys(opacity([[0, 0], [4, 1]]), 'move', 0, { x: 1 }), 'move', 9, { x: 5 });
    const out = reverseKeys(c, 'move');
    expect(values(out, 'move', 'x')).toEqual([5, 1]);
    expect(values(out, 'opacity', 'amount')).toEqual([0, 1]);
    const single = opacity([[3, 1]]);
    expect(reverseKeys(single)).toBe(single);
    const empty = blank();
    expect(reverseKeys(empty, undefined, true)).toBe(empty);
  });
});

describe('copying, pasting and retiming keys', () => {
  it('copies a lane with frames counted from its first key', () => {
    const clip = copyKeys(opacity([[4, 0.2], [9, 0.8]]), 'opacity');
    expect(clip?.span).toBe(5);
    expect(clip?.channels.amount.map((k) => [k.frame, k.value])).toEqual([[0, 0.2], [5, 0.8]]);
  });

  it('copies nothing from a missing lane or a frame without keys', () => {
    const c = opacity([[4, 0.2]]);
    expect(copyKeys(c, 'blur')).toBeNull();
    expect(copyKeys(c, 'opacity', 7)).toBeNull();
  });

  it('copies the keys of one frame with a span of zero', () => {
    const clip = copyKeys(opacity([[4, 0.2], [9, 0.8]]), 'opacity', 9);
    expect(clip?.span).toBe(0);
    expect(clip?.channels.amount).toEqual([{ frame: 0, value: 0.8, ease: 'linear' }]);
  });

  it('pastes a clip at a frame, replacing keys it lands on', () => {
    const c = opacity([[0, 0.2], [5, 0.8], [15, 0.4]]);
    const clip = copyKeys(c, 'opacity');
    if (!clip) throw new Error('nothing copied');
    const out = pasteKeys(c, clip, 10.4);
    expect(frames(out, 'opacity', 'amount')).toEqual([0, 5, 10, 15, 25]);
    expect(values(out, 'opacity', 'amount')).toEqual([0.2, 0.8, 0.2, 0.8, 0.4]);
  });

  it('pastes into a content that has no such lane yet', () => {
    const clip = copyKeys(opacity([[4, 0.2], [9, 0.8]]), 'opacity');
    if (!clip) throw new Error('nothing copied');
    const out = pasteKeys(blank(), clip, 2);
    expect(frames(out, 'opacity', 'amount')).toEqual([2, 7]);
  });

  it('shifts every key by a number of frames', () => {
    const c = opacity([[4, 0.2], [9, 0.8]]);
    expect(shiftKeys(c, 0)).toBe(c);
    expect(frames(shiftKeys(c, -3), 'opacity', 'amount')).toEqual([1, 6]);
    expect(frames(c, 'opacity', 'amount')).toEqual([4, 9]);
  });

  it('scales key times and rounds them to whole frames', () => {
    const c = opacity([[2, 0.2], [3, 0.8]]);
    expect(frames(scaleKeyTimes(c, 2), 'opacity', 'amount')).toEqual([4, 6]);
    expect(frames(scaleKeyTimes(c, 0.5), 'opacity', 'amount')).toEqual([1, 2]);
  });

  it('refuses a scale of zero, a negative scale and NaN', () => {
    const c = opacity([[2, 0.2]]);
    expect(scaleKeyTimes(c, 1)).toBe(c);
    expect(scaleKeyTimes(c, 0)).toBe(c);
    expect(scaleKeyTimes(c, -2)).toBe(c);
    expect(scaleKeyTimes(c, Number.NaN)).toBe(c);
  });

  it('keeps the later key when two keys are squeezed onto one frame', () => {
    const out = scaleKeyTimes(opacity([[0, 0.1], [1, 0.2], [2, 0.3]]), 0.25);
    expect(frames(out, 'opacity', 'amount')).toEqual([0, 1]);
    expect(values(out, 'opacity', 'amount')).toEqual([0.2, 0.3]);
  });
});
