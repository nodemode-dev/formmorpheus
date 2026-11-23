import { describe, expect, it } from 'vitest';
import { liveSet } from '@src/engine/gpu/live';
import type { Movie } from '@src/engine/types';

const movie = (tracks: unknown[]): Movie => ({ tracks } as unknown as Movie);
const item = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, layers: [], ...extra });

describe('liveSet', () => {
  it('is empty for a movie without tracks', () => {
    const l = liveSet(movie([]));
    expect(l.contents.size).toBe(0);
    expect(l.assets.size).toBe(0);
  });

  it('collects every content id and its asset', () => {
    const l = liveSet(movie([
      { content: [item('a', { asset: 'pic1' }), item('b')] },
      { content: [item('c', { asset: 'pic2' })] },
    ]));
    expect([...l.contents].sort()).toEqual(['a', 'b', 'c']);
    expect([...l.assets].sort()).toEqual(['pic1', 'pic2']);
  });

  it('collects layer pixels and masks and ignores empty ones', () => {
    const l = liveSet(movie([{ content: [item('a', { layers: [
      { pixels: 'p1', mask: 'm1' },
      { pixels: null, mask: null },
      { pixels: 'p2' },
    ] })] }]));
    expect([...l.assets].sort()).toEqual(['m1', 'p1', 'p2']);
  });

  it('collects the layers of every flip frame', () => {
    const l = liveSet(movie([{ content: [item('a', { flip: [
      { frames: [{ layers: [{ pixels: 'f1' }] }, { layers: [{ pixels: 'f2', mask: 'fm' }] }] },
      { frames: [] },
    ] })] }]));
    expect([...l.assets].sort()).toEqual(['f1', 'f2', 'fm']);
  });

  it('walks nested tracks to any depth', () => {
    const l = liveSet(movie([{ content: [item('outer', { tracks: [
      { content: [item('mid', { asset: 'x', tracks: [{ content: [item('deep', { asset: 'y' })] }] })] },
    ] })] }]));
    expect([...l.contents].sort()).toEqual(['deep', 'mid', 'outer']);
    expect([...l.assets].sort()).toEqual(['x', 'y']);
  });

  it('accepts older content without flip or tracks fields', () => {
    const l = liveSet(movie([{ content: [{ id: 'old', layers: [{ pixels: 'p' }] }] }]));
    expect(l.contents.has('old')).toBe(true);
    expect(l.assets.has('p')).toBe(true);
  });

  it('lists a shared asset once', () => {
    const l = liveSet(movie([{ content: [item('a', { asset: 's' }), item('b', { asset: 's' })] }]));
    expect(l.assets.size).toBe(1);
    expect(l.contents.size).toBe(2);
  });
});
