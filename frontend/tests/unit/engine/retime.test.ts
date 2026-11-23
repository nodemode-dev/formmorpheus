import { describe, expect, it } from 'vitest';
import {
  afterTrimEnd, afterTrimStart, canRetime, clampSpeed, growEnd, isFrozen, isRetimed, keepsPitch, speedOf,
  splitOffsets, srcFrame, startBack, timeKeys, withDuration,
} from '@src/engine/retime';
import type { Content } from '@src/engine/types';

function clip(over: Record<string, unknown> = {}): Content {
  return { id: 'c1', kind: 'video', name: 'Clip', start: 0, duration: 10, offset: 0, keys: [], ...over } as unknown as Content;
}

describe('speed state', () => {
  it('reads a missing speed as normal speed', () => {
    expect(speedOf(clip())).toBe(1);
    expect(speedOf(clip({ speed: 2 }))).toBe(2);
  });

  it('calls a plain block or a block at speed one not retimed', () => {
    expect(isRetimed(clip())).toBe(false);
    expect(isRetimed(clip({ speed: 1 }))).toBe(false);
  });

  it('calls a faster, reversed or time remapped block retimed', () => {
    expect(isRetimed(clip({ speed: 2 }))).toBe(true);
    expect(isRetimed(clip({ reverse: true }))).toBe(true);
    expect(isRetimed(clip({ keys: [{ kind: 'time', channels: { src: [{ frame: 0, value: 3 }] } }] }))).toBe(true);
  });

  it('treats only speed zero as a freeze', () => {
    expect(isFrozen(clip({ speed: 0 }))).toBe(true);
    expect(isFrozen(clip())).toBe(false);
    expect(isFrozen(clip({ speed: 0.25 }))).toBe(false);
  });

  it('allows retime only on kinds that follow a source', () => {
    for (const kind of ['video', 'audio', 'flipbook', 'group']) expect(canRetime(clip({ kind }))).toBe(true);
    for (const kind of ['text', 'shape', 'solid', 'image']) expect(canRetime(clip({ kind }))).toBe(false);
  });

  it('clamps speed to the allowed range and rounds to a thousandth', () => {
    expect(clampSpeed(10)).toBe(4);
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(-3)).toBe(0.25);
    expect(clampSpeed(1.23456)).toBe(1.235);
  });

  it('keeps pitch unless the block asks for it to follow the speed', () => {
    expect(keepsPitch(clip())).toBe(true);
    expect(keepsPitch(clip({ speedPitch: true }))).toBe(false);
  });
});

describe('time remap keys', () => {
  it('returns the source keys of a time lane', () => {
    const src = [{ frame: 0, value: 0 }, { frame: 9, value: 30 }];
    expect(timeKeys(clip({ keys: [{ kind: 'fx', channels: {} }, { kind: 'time', channels: { src } }] }))).toBe(src);
  });

  it('returns null for sound, for no lane and for an empty lane', () => {
    const src = [{ frame: 0, value: 0 }];
    expect(timeKeys(clip({ kind: 'audio', keys: [{ kind: 'time', channels: { src } }] }))).toBeNull();
    expect(timeKeys(clip())).toBeNull();
    expect(timeKeys(clip({ keys: [{ kind: 'time', channels: { src: [] } }] }))).toBeNull();
  });
});

describe('source frame mapping', () => {
  it('adds the offset when the block is not retimed', () => {
    expect(srcFrame(clip({ offset: 10 }), 5)).toBe(15);
  });

  it('scales the local frame by the speed', () => {
    expect(srcFrame(clip({ offset: 10, speed: 2 }), 5)).toBe(20);
    expect(srcFrame(clip({ offset: 10, speed: 0.5 }), 5)).toBe(12.5);
  });

  it('plays the same window backward when reversed', () => {
    const c = clip({ reverse: true, duration: 10, offset: 4 });
    expect(srcFrame(c, 0)).toBe(13);
    expect(srcFrame(c, 9)).toBe(4);
    expect(srcFrame(clip({ reverse: true, duration: 10, offset: 4, speed: 2 }), 0)).toBe(22);
  });

  it('holds the offset frame on every frame of a freeze', () => {
    const c = clip({ speed: 0, offset: 33 });
    expect(srcFrame(c, 0)).toBe(33);
    expect(srcFrame(c, 500)).toBe(33);
  });
});

describe('trim limits', () => {
  it('lets a forward block grow until the source ends', () => {
    expect(growEnd(clip({ offset: 10, duration: 20, speed: 2 }), 100)).toBe(25);
    expect(growEnd(clip({ offset: 10, duration: 20 }), 30)).toBe(0);
    expect(growEnd(clip({ offset: 10, duration: 20 }), 5)).toBe(0);
  });

  it('lets a reversed block grow only by what lies before its offset', () => {
    expect(growEnd(clip({ offset: 10, duration: 20, speed: 2, reverse: true }), 100)).toBe(5);
  });

  it('has no limit for an unbounded source or a freeze', () => {
    expect(growEnd(clip(), Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(growEnd(clip({ speed: 0 }), 100)).toBe(Number.POSITIVE_INFINITY);
    expect(startBack(clip({ speed: 0 }), 100)).toBe(Number.POSITIVE_INFINITY);
  });

  it('mirrors the limits for moving the start earlier', () => {
    expect(startBack(clip({ offset: 10, duration: 20, speed: 2 }), 100)).toBe(5);
    expect(startBack(clip({ offset: 10, duration: 20, speed: 2, reverse: true }), 100)).toBe(25);
  });
});

describe('trimming', () => {
  it('changes only the length of a forward block trimmed at the end', () => {
    const out = afterTrimEnd(clip({ offset: 10, speed: 2 }), 3);
    expect(out.duration).toBe(13);
    expect(out.offset).toBe(10);
  });

  it('moves the offset of a reversed block trimmed at the end and never below zero', () => {
    const c = clip({ offset: 10, speed: 2, reverse: true });
    expect(afterTrimEnd(c, 3).offset).toBe(4);
    expect(afterTrimEnd(c, 3).duration).toBe(13);
    expect(afterTrimEnd(c, 10).offset).toBe(0);
  });

  it('keeps the last shown source frame of a reversed block when its end is trimmed', () => {
    const c = clip({ offset: 10, speed: 2, reverse: true });
    expect(srcFrame(afterTrimEnd(c, -4), 0)).toBe(srcFrame(c, 0));
  });

  it('moves start, length and offset together when a forward start is trimmed', () => {
    const out = afterTrimStart(clip({ start: 5, offset: 10, speed: 2 }), 3, true);
    expect(out.start).toBe(8);
    expect(out.duration).toBe(7);
    expect(out.offset).toBe(16);
  });

  it('keeps the offset inside a bounded source only', () => {
    const c = clip({ start: 20, offset: 4 });
    expect(afterTrimStart(c, -10, true).offset).toBe(0);
    expect(afterTrimStart(c, -10, false).offset).toBe(-6);
  });

  it('leaves the offset of a reversed block alone when its start is trimmed', () => {
    const out = afterTrimStart(clip({ offset: 10, reverse: true }), 2, true);
    expect(out.offset).toBe(10);
    expect(out.duration).toBe(8);
  });

  it('sets a new length through withDuration', () => {
    expect(withDuration(clip({ offset: 3 }), 25).duration).toBe(25);
    const r = withDuration(clip({ offset: 10, reverse: true }), 14);
    expect(r.duration).toBe(14);
    expect(r.offset).toBe(6);
  });

  it('does not change the content it was given', () => {
    const c = clip({ offset: 10, reverse: true });
    afterTrimEnd(c, 3);
    afterTrimStart(c, 3, true);
    expect(c.duration).toBe(10);
    expect(c.offset).toBe(10);
  });
});

describe('split offsets', () => {
  it('starts the right half where the cut falls in the source', () => {
    expect(splitOffsets(clip({ offset: 10, speed: 2 }), 4)).toEqual({ left: 10, right: 18 });
  });

  it('gives both halves of a freeze the same frame', () => {
    expect(splitOffsets(clip({ offset: 10, speed: 0 }), 4)).toEqual({ left: 10, right: 10 });
  });

  it('keeps every frame of a reversed block showing the same source frame after a cut', () => {
    const c = clip({ offset: 10, speed: 2, reverse: true, duration: 10 });
    const o = splitOffsets(c, 4);
    const left = clip({ offset: o.left, speed: 2, reverse: true, duration: 4 });
    const right = clip({ offset: o.right, speed: 2, reverse: true, duration: 6 });
    for (let l = 0; l < 4; l++) expect(srcFrame(left, l)).toBe(srcFrame(c, l));
    for (let l = 0; l < 6; l++) expect(srcFrame(right, l)).toBe(srcFrame(c, l + 4));
  });
});
