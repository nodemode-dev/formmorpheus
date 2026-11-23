import { afterEach, describe, expect, it } from 'vitest';
import { edgesOf, reachFrames, snapDelta, snapOptions, snapTargets } from '@src/engine/snap';
import type { Content, Movie } from '@src/engine/types';

function block(id: string, start: number, duration: number, keyFrames: number[] = []): Content {
  const keys = keyFrames.length ? [{ kind: 'transform', channels: { x: keyFrames.map((frame) => ({ frame, value: 0 })) } }] : [];
  return { id, kind: 'video', name: id, start, duration, offset: 0, keys } as unknown as Content;
}

function movie(content: Content[], over: Record<string, unknown> = {}): Movie {
  return { fps: 24, duration: 100, width: 1920, height: 1080, tracks: [{ id: 't1', content }], ...over } as unknown as Movie;
}

afterEach(() => { snapOptions.seconds = false; });

describe('snapTargets', () => {
  it('always offers the movie start, the movie end and the Playhead', () => {
    expect(snapTargets(movie([]), 7, new Set())).toEqual([0, 7, 100]);
  });

  it('adds block edges, keys in movie frames and markers, sorted without repeats', () => {
    const m = movie([block('a', 10, 20, [5]), block('b', 30, 12)], { markers: [{ frame: 42 }, { frame: 10 }] });
    expect(snapTargets(m, 7, new Set())).toEqual([0, 7, 10, 15, 30, 42, 100]);
  });

  it('leaves out the blocks being moved', () => {
    const m = movie([block('a', 10, 20, [5]), block('b', 40, 10)]);
    expect(snapTargets(m, 0, new Set(['a']))).toEqual([0, 40, 50, 100]);
  });

  it('adds both ends of the loop range, the end one frame past the last looped frame', () => {
    expect(snapTargets(movie([], { loopFrom: 20, loopTo: 59 }), 0, new Set())).toEqual([0, 20, 60, 100]);
    expect(snapTargets(movie([], { loopFrom: 20 }), 0, new Set())).toEqual([0, 100]);
  });

  it('adds every whole second only when the option is on', () => {
    snapOptions.seconds = true;
    expect(snapTargets(movie([]), 1, new Set())).toEqual([0, 1, 24, 48, 72, 96, 100]);
  });
});

describe('edgesOf', () => {
  it('lists the start and end of every block', () => {
    expect(edgesOf([block('a', 10, 20), block('b', 40, 5)])).toEqual([10, 30, 40, 45]);
    expect(edgesOf([])).toEqual([]);
  });
});

describe('snapDelta', () => {
  it('pulls the drag so the nearest edge lands on a target in reach', () => {
    expect(snapDelta([10, 30], [0, 50, 100], 18, 3)).toEqual({ delta: 20, line: 50 });
  });

  it('pulls backward as well as forward', () => {
    expect(snapDelta([10], [0, 50, 100], 42, 3)).toEqual({ delta: 40, line: 50 });
  });

  it('leaves the drag alone when nothing is in reach', () => {
    expect(snapDelta([10, 30], [0, 50, 100], 18, 1)).toEqual({ delta: 18, line: null });
  });

  it('prefers the closest pair over an earlier farther one', () => {
    expect(snapDelta([10, 30], [14, 31], 2, 5)).toEqual({ delta: 1, line: 31 });
  });

  it('reports an exact hit without changing the drag', () => {
    expect(snapDelta([10], [25], 15, 0.5)).toEqual({ delta: 15, line: 25 });
  });

  it('does nothing without targets or without edges', () => {
    expect(snapDelta([10], [], 4, 100)).toEqual({ delta: 4, line: null });
    expect(snapDelta([], [0, 10], 4, 100)).toEqual({ delta: 4, line: null });
  });

  it('snaps to targets before the first and after the last one', () => {
    expect(snapDelta([10], [20, 30], 8, 3)).toEqual({ delta: 10, line: 20 });
    expect(snapDelta([10], [20, 30], 22, 3)).toEqual({ delta: 20, line: 30 });
  });
});

describe('reachFrames', () => {
  it('converts the pixel reach to frames at the zoom', () => {
    expect(reachFrames(4)).toBe(2);
    expect(reachFrames(1, 12)).toBe(12);
  });

  it('falls back to an exact hit when zoomed far in', () => {
    expect(reachFrames(100)).toBe(0.5);
  });

  it('stays finite at a zoom of zero', () => {
    expect(Number.isFinite(reachFrames(0))).toBe(true);
    expect(reachFrames(0)).toBeGreaterThan(1000);
  });
});
