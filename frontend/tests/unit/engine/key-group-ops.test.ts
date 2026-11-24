import { describe, expect, it } from 'vitest';
import { dropChannels } from '@src/engine/key-chan-ops';
import { deltaRange, moveRefs, shiftRefs } from '@src/engine/key-group-ops';
import type { KeyRef } from '@src/engine/key-sel-ops';
import type { Content, Key, KeyKind, KeyLane } from '@src/engine/types';

const POS = 'position' as KeyKind;
const OPA = 'opacity' as KeyKind;
const key = (frame: number, value: number): Key => ({ frame, value, ease: 'linear' }) as unknown as Key;
const lane = (kind: KeyKind, channels: Record<string, Key[]>): KeyLane => ({ kind, channels }) as unknown as KeyLane;
const content = (duration: number, keys: KeyLane[]): Content => ({ id: 'c', kind: 'shape', start: 0, duration, keys }) as unknown as Content;
const ref = (kind: KeyKind, frame: number): KeyRef => ({ kind, frame });
const frames = (c: Content, kind: KeyKind, channel: string): number[] => (c.keys.find((l) => l.kind === kind) as KeyLane).channels[channel].map((k) => k.frame);
const values = (c: Content, kind: KeyKind, channel: string): number[] => (c.keys.find((l) => l.kind === kind) as KeyLane).channels[channel].map((k) => k.value);

describe('deltaRange', () => {
  it('allows no movement when nothing is chosen', () => {
    expect(deltaRange(content(10, []), [])).toEqual([0, 0]);
  });

  it('keeps the first chosen key at or after zero and the last inside the content', () => {
    expect(deltaRange(content(10, []), [ref(POS, 3), ref(OPA, 7)])).toEqual([-3, 2]);
  });

  it('lets a single key travel the whole content', () => {
    expect(deltaRange(content(25, []), [ref(POS, 0)])).toEqual([-0, 24]);
  });

  it('treats an empty content as one frame long', () => {
    expect(deltaRange(content(0, []), [ref(POS, 0)])).toEqual([-0, 0]);
  });
});

describe('moveRefs', () => {
  it('gives back the same content for no delta, no refs or refs that match no key', () => {
    const c = content(20, [lane(POS, { x: [key(0, 1), key(5, 2)] })]);
    expect(moveRefs(c, [ref(POS, 5)], 0)).toBe(c);
    expect(moveRefs(c, [], 3)).toBe(c);
    expect(moveRefs(c, [ref(OPA, 5)], 3)).toBe(c);
    expect(moveRefs(c, [ref(POS, 9)], 3)).toBe(c);
  });

  it('moves the chosen frame on every channel of the lane', () => {
    const c = content(20, [lane(POS, { x: [key(0, 1), key(5, 2)], y: [key(5, 9), key(8, 7)] })]);
    const out = moveRefs(c, [ref(POS, 5)], 2);
    expect(frames(out, POS, 'x')).toEqual([0, 7]);
    expect(frames(out, POS, 'y')).toEqual([7, 8]);
    expect(values(out, POS, 'y')).toEqual([9, 7]);
  });

  it('leaves other lanes and the original content untouched', () => {
    const other = lane(OPA, { v: [key(5, 0.5)] });
    const c = content(20, [lane(POS, { x: [key(5, 2)] }), other]);
    const out = moveRefs(c, [ref(POS, 5)], -4);
    expect(out.keys[1]).toBe(other);
    expect(frames(out, POS, 'x')).toEqual([1]);
    expect(frames(c, POS, 'x')).toEqual([5]);
  });

  it('replaces a key that was not chosen when a moved key lands on it', () => {
    const c = content(20, [lane(POS, { x: [key(0, 1), key(4, 2), key(6, 3)] })]);
    const out = moveRefs(c, [ref(POS, 4)], 2);
    expect(frames(out, POS, 'x')).toEqual([0, 6]);
    expect(values(out, POS, 'x')).toEqual([1, 2]);
  });

  it('keeps every chosen key when the group moves onto its own old frames', () => {
    const c = content(20, [lane(POS, { x: [key(2, 1), key(4, 2), key(6, 3)] })]);
    const out = moveRefs(c, [ref(POS, 2), ref(POS, 4), ref(POS, 6)], 2);
    expect(frames(out, POS, 'x')).toEqual([4, 6, 8]);
    expect(values(out, POS, 'x')).toEqual([1, 2, 3]);
  });

  it('keeps the keys in time order when a key jumps over a neighbour', () => {
    const c = content(20, [lane(POS, { x: [key(1, 1), key(3, 2), key(9, 3)] })]);
    const out = moveRefs(c, [ref(POS, 1)], 5);
    expect(frames(out, POS, 'x')).toEqual([3, 6, 9]);
    expect(values(out, POS, 'x')).toEqual([2, 1, 3]);
  });

  it('moves keys of several lanes by the same amount', () => {
    const c = content(20, [lane(POS, { x: [key(3, 1)] }), lane(OPA, { v: [key(3, 0), key(10, 1)] })]);
    const out = moveRefs(c, [ref(POS, 3), ref(OPA, 10)], -3);
    expect(frames(out, POS, 'x')).toEqual([0]);
    expect(frames(out, OPA, 'v')).toEqual([3, 7]);
  });
});

describe('shiftRefs', () => {
  it('shifts every ref and leaves the given list alone', () => {
    const refs = [ref(POS, 3), ref(OPA, 7)];
    expect(shiftRefs(refs, -2)).toEqual([ref(POS, 1), ref(OPA, 5)]);
    expect(refs[0].frame).toBe(3);
  });
});

describe('dropChannels', () => {
  it('gives back the same content when the lane is missing or nothing is dropped', () => {
    const c = content(20, [lane(POS, { x: [key(0, 1)] })]);
    expect(dropChannels(c, OPA, () => true)).toBe(c);
    expect(dropChannels(c, POS, () => false)).toBe(c);
  });

  it('removes only the channels the test accepts', () => {
    const other = lane(OPA, { v: [key(0, 1)] });
    const c = content(20, [lane(POS, { x: [key(0, 1)], y: [key(0, 2)], z: [key(4, 3)] }), other]);
    const out = dropChannels(c, POS, (id) => id !== 'y');
    expect(Object.keys(out.keys[0].channels)).toEqual(['y']);
    expect(out.keys[0].channels.y).toBe(c.keys[0].channels.y);
    expect(out.keys[1]).toBe(other);
    expect(Object.keys(c.keys[0].channels)).toEqual(['x', 'y', 'z']);
  });

  it('keeps the lane even when every channel goes', () => {
    const c = content(20, [lane(POS, { x: [key(0, 1)] })]);
    const out = dropChannels(c, POS, () => true);
    expect(out.keys).toHaveLength(1);
    expect(out.keys[0].channels).toEqual({});
  });
});
