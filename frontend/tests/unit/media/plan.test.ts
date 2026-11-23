import { afterEach, describe, expect, it, vi } from 'vitest';

const at = vi.hoisted(() => ({ list: [] as Array<{ asset: string; seconds: number; lane: string }> }));

vi.mock('@src/engine/render', () => ({
  Renderer: {
    videoSeconds: (_c: unknown, f: number, m: { fps: number }) => f / m.fps,
    videosAt: () => at.list,
  },
}));

import { firstFrames, firstPictures, planPrefetch } from '@src/media/plan';

type Video = Parameters<typeof planPrefetch>[0];
type Movie = Parameters<typeof planPrefetch>[1];
type Block = { id: string; kind: string; asset?: string; start: number; duration: number };

function source(exact: () => Promise<void> = async () => undefined) {
  const v = { prefetch: vi.fn(), release: vi.fn(), exact: vi.fn(exact) };
  return { v, video: v as unknown as Video };
}

function movie(blocks: Block[], playback = 'once', hidden = false): Movie {
  return { fps: 10, duration: 100, playback, tracks: [{ hidden, content: blocks }] } as unknown as Movie;
}

afterEach(() => { vi.useRealTimers(); at.list = []; });

describe('planPrefetch', () => {
  const b: Block = { id: 'b', kind: 'video', asset: 'clip', start: 20, duration: 30 };

  it('prefetches a block from one second before it starts until its end', () => {
    const { v, video } = source();
    for (const f of [9, 10, 35, 49, 50]) planPrefetch(video, movie([b]), f);
    expect(v.prefetch.mock.calls).toEqual([
      ['clip', 0, 2, 'b'],
      ['clip', 1.5, 2, 'b'],
      ['clip', 2.9, 2, 'b'],
    ]);
  });

  it('skips hidden tracks, blocks without an asset and blocks that are not video', () => {
    const { v, video } = source();
    planPrefetch(video, movie([b], 'once', true), 30);
    planPrefetch(video, movie([{ ...b, asset: undefined }, { ...b, kind: 'image' }]), 30);
    expect(v.prefetch).not.toHaveBeenCalled();
  });

  it('decodes the start of a looping movie on its own lane near the end', () => {
    const { v, video } = source();
    planPrefetch(video, movie([{ id: 'w', kind: 'video', asset: 'a', start: 0, duration: 100 }], 'loop'), 86);
    expect(v.prefetch).toHaveBeenCalledWith('a', 8.6, 2, 'w');
    expect(v.prefetch).toHaveBeenCalledWith('a', 0, 1, 'w~wrap');
    expect(v.release).not.toHaveBeenCalled();
  });

  it('does not decode the start ahead for a movie that plays once', () => {
    const { v, video } = source();
    planPrefetch(video, movie([{ id: 'w', kind: 'video', asset: 'a', start: 0, duration: 100 }]), 95);
    expect(v.prefetch.mock.calls.every((c) => c[3] === 'w')).toBe(true);
  });

  it('does not decode ahead a block that starts well after the wrap', () => {
    const { v, video } = source();
    planPrefetch(video, movie([{ id: 'late', kind: 'video', asset: 'a', start: 50, duration: 50 }], 'loop'), 90);
    expect(v.prefetch.mock.calls.some((c) => c[3] === 'late~wrap')).toBe(false);
  });

  it('releases the wrap lane once past two seconds and away from the end', () => {
    const { v, video } = source();
    planPrefetch(video, movie([b], 'loop'), 15);
    expect(v.release).not.toHaveBeenCalled();
    planPrefetch(video, movie([b], 'loop'), 40);
    expect(v.release).toHaveBeenCalledWith('clip', 'b~wrap');
  });
});

describe('firstFrames and firstPictures', () => {
  it('waits for every visible video at the frame', async () => {
    at.list = [{ asset: 'a', seconds: 1, lane: 'x' }, { asset: 'b', seconds: 2, lane: 'y' }];
    const { v, video } = source();
    await firstFrames(video, movie([]), 10);
    expect(v.exact.mock.calls).toEqual([['a', 1, 'x'], ['b', 2, 'y']]);
  });

  it('gives up after the time limit instead of hanging', async () => {
    vi.useFakeTimers();
    at.list = [{ asset: 'a', seconds: 0, lane: 'x' }];
    const { video } = source(() => new Promise<void>(() => undefined));
    let done = false;
    const p = firstFrames(video, movie([]), 0, 300).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('asks only video blocks with an asset for their first picture', async () => {
    const { v, video } = source();
    const blocks = [
      { id: 'v1', kind: 'video', asset: 'a', start: 5, duration: 10 },
      { id: 'v2', kind: 'video', start: 0, duration: 10 },
      { id: 'i1', kind: 'image', asset: 'p', start: 0, duration: 10 },
    ];
    await firstPictures(video, movie([]), blocks as unknown as Parameters<typeof firstPictures>[2]);
    expect(v.exact.mock.calls).toEqual([['a', 0, 'v1']]);
  });

  it('returns at once when there is nothing to wait for', async () => {
    const { v, video } = source();
    await firstPictures(video, movie([]), []);
    await firstFrames(video, movie([]), 0);
    expect(v.exact).not.toHaveBeenCalled();
  });
});
