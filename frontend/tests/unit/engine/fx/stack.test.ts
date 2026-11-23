import { describe, expect, it } from 'vitest';
import '@src/engine/fx';
import { clearFx, copyFx, fxLanes, moveFx, pasteFx, setFxOff } from '@src/engine/fx/stack';
import type { Content, KeyLane } from '@src/engine/types';

function lane(kind: string, frames: number[] = [], options: KeyLane['options'] = {}): KeyLane {
  return {
    kind, expanded: false, options,
    channels: { v: frames.map((frame) => ({ frame, value: frame })) },
  } as unknown as KeyLane;
}

function content(keys: KeyLane[] | undefined, duration = 10): Content {
  return { duration, keys } as unknown as Content;
}

const kinds = (c: Content): string[] => (c.keys ?? []).map((l) => l.kind);
const frames = (l: KeyLane): number[] => l.channels.v.map((k) => k.frame);

describe('fxLanes', () => {
  it('lists only the effect lanes in their order', () => {
    const c = content([lane('fx:mirror'), lane('camera'), lane('fx:vignette')]);
    expect(fxLanes(c).map((l) => l.kind)).toEqual(['fx:mirror', 'fx:vignette']);
  });

  it('returns nothing for a content without lanes or with unknown effects', () => {
    expect(fxLanes(content(undefined))).toEqual([]);
    expect(fxLanes(content([lane('fx:f21-not-an-effect')]))).toEqual([]);
  });
});

describe('moveFx', () => {
  const base = (): Content => content([lane('fx:mirror'), lane('camera'), lane('fx:vignette'), lane('fx:pixelate')]);

  it('reorders the effects and leaves other lanes in their slots', () => {
    expect(kinds(moveFx(base(), 'fx:pixelate', 0))).toEqual(['fx:pixelate', 'camera', 'fx:mirror', 'fx:vignette']);
    expect(kinds(moveFx(base(), 'fx:mirror', 1))).toEqual(['fx:vignette', 'camera', 'fx:mirror', 'fx:pixelate']);
  });

  it('clamps the target position to the stack', () => {
    expect(kinds(moveFx(base(), 'fx:mirror', 99))).toEqual(['fx:vignette', 'camera', 'fx:pixelate', 'fx:mirror']);
    expect(kinds(moveFx(base(), 'fx:pixelate', -5))).toEqual(['fx:pixelate', 'camera', 'fx:mirror', 'fx:vignette']);
  });

  it('returns the same content when nothing moves', () => {
    const c = base();
    expect(moveFx(c, 'fx:mirror', 0)).toBe(c);
    expect(moveFx(c, 'fx:pixelate', 7)).toBe(c);
    expect(moveFx(c, 'fx:shadow', 0)).toBe(c);
    expect(moveFx(c, 'camera', 0)).toBe(c);
  });

  it('does not change the content it was given', () => {
    const c = base();
    moveFx(c, 'fx:pixelate', 0);
    expect(kinds(c)).toEqual(['fx:mirror', 'camera', 'fx:vignette', 'fx:pixelate']);
  });
});

describe('setFxOff', () => {
  it('switches one effect off and keeps its settings', () => {
    const c = content([lane('fx:mirror', [0, 3], { mode: 'four ways' }), lane('fx:vignette')]);
    const off = setFxOff(c, 'fx:mirror', true);
    expect(off.keys?.[0].options).toEqual({ mode: 'four ways', off: true });
    expect(frames(off.keys![0])).toEqual([0, 3]);
    expect(off.keys?.[1]).toBe(c.keys?.[1]);
    expect(c.keys?.[0].options).toEqual({ mode: 'four ways' });
  });

  it('removes the flag when switched back on', () => {
    const c = content([lane('fx:mirror', [], { mode: 'four ways', off: true })]);
    const on = setFxOff(c, 'fx:mirror', false);
    expect(on.keys?.[0].options).toEqual({ mode: 'four ways' });
    expect('off' in on.keys![0].options).toBe(false);
  });

  it('keeps the lane object when the state already matches', () => {
    const c = content([lane('fx:mirror'), lane('fx:vignette', [], { off: true })]);
    expect(setFxOff(c, 'fx:mirror', false).keys?.[0]).toBe(c.keys?.[0]);
    expect(setFxOff(c, 'fx:vignette', true).keys?.[1]).toBe(c.keys?.[1]);
  });
});

describe('copyFx and pasteFx', () => {
  it('copies the effect lanes deeply', () => {
    const c = content([lane('camera', [1]), lane('fx:mirror', [0, 4], { mode: 'four ways' })]);
    const copy = copyFx(c);
    expect(copy).toEqual([c.keys![1]]);
    expect(copy[0]).not.toBe(c.keys![1]);
    copy[0].channels.v[0].frame = 99;
    copy[0].options.mode = 'changed';
    expect(frames(c.keys![1])).toEqual([0, 4]);
    expect(c.keys![1].options.mode).toBe('four ways');
  });

  it('replaces an effect in place and puts a new one on top', () => {
    const c = content([lane('fx:mirror', [0]), lane('camera'), lane('fx:vignette', [1])]);
    const out = pasteFx(c, [lane('fx:pixelate', [2]), lane('fx:mirror', [5])]);
    expect(kinds(out)).toEqual(['fx:mirror', 'camera', 'fx:vignette', 'fx:pixelate']);
    expect(frames(out.keys![0])).toEqual([5]);
    expect(frames(out.keys![2])).toEqual([1]);
    expect(kinds(c)).toEqual(['fx:mirror', 'camera', 'fx:vignette']);
    expect(frames(c.keys![0])).toEqual([0]);
  });

  it('ignores pasted lanes that are not effects', () => {
    const c = content([lane('camera', [1])]);
    const out = pasteFx(c, [lane('camera', [7]), lane('fx:f21-not-an-effect')]);
    expect(kinds(out)).toEqual(['camera']);
    expect(frames(out.keys![0])).toEqual([1]);
  });

  it('drops keys past the last frame of the block', () => {
    const out = pasteFx(content([], 5), [lane('fx:mirror', [0, 4, 5, 30])]);
    expect(frames(out.keys![0])).toEqual([0, 4]);
  });

  it('keeps only a key at frame zero for an empty block', () => {
    const out = pasteFx(content([], 0), [lane('fx:mirror', [0, 1])]);
    expect(frames(out.keys![0])).toEqual([0]);
  });

  it('clears the old stack first when replacing', () => {
    const c = content([lane('fx:mirror'), lane('camera'), lane('fx:vignette')]);
    expect(kinds(pasteFx(c, [lane('fx:pixelate')], true))).toEqual(['camera', 'fx:pixelate']);
  });

  it('pastes copies so later edits to the source do not leak', () => {
    const src = lane('fx:mirror', [0, 2]);
    const out = pasteFx(content(undefined), [src]);
    src.channels.v[0].frame = 9;
    expect(out.keys![0]).not.toBe(src);
    expect(frames(out.keys![0])).toEqual([0, 2]);
  });

  it('round trips a stack from one content to another', () => {
    const a = content([lane('fx:vignette', [0, 3], { off: true }), lane('fx:mirror', [1])]);
    const b = pasteFx(content([lane('camera')]), copyFx(a));
    expect(fxLanes(b)).toEqual(fxLanes(a));
  });
});

describe('clearFx', () => {
  it('removes every effect lane and keeps the rest', () => {
    const c = content([lane('fx:mirror'), lane('camera', [2]), lane('fx:vignette')]);
    const out = clearFx(c);
    expect(kinds(out)).toEqual(['camera']);
    expect(out.keys![0]).toBe(c.keys![1]);
    expect(kinds(c)).toHaveLength(3);
  });

  it('gives an empty lane list to a content that had none', () => {
    expect(clearFx(content(undefined)).keys).toEqual([]);
  });
});
