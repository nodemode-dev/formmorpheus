import { describe, expect, it } from 'vitest';
import { content, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import { keepInside, pushContent } from '@src/engine/push-ops';
import type { Movie } from '@src/engine/types';

function movieWith(spans: [number, number][], duration = 100): { movie: Movie; ids: string[] } {
  const items = spans.map(([s, d]) => content('drawing', s, d));
  const movie = { ...newMovie(), duration, tracks: [track('A', items)] };
  return { movie, ids: items.map((c) => c.id) };
}

const starts = (m: Movie): number[] => m.tracks[0].content.map((c) => c.start);

describe('pushContent', () => {
  it('returns the same movie for no ids or a zero delta', () => {
    const { movie, ids } = movieWith([[0, 10]]);
    expect(pushContent(movie, [], 5)).toBe(movie);
    expect(pushContent(movie, ids, 0)).toBe(movie);
  });

  it('carries touching neighbours later and absorbs a gap first', () => {
    const { movie, ids } = movieWith([[0, 10], [10, 10], [25, 10]]);
    expect(starts(pushContent(movie, [ids[0]], 3))).toEqual([3, 13, 25]);
    expect(starts(pushContent(movie, [ids[0]], 8))).toEqual([8, 18, 28]);
  });

  it('carries earlier neighbours back on a negative push', () => {
    const { movie, ids } = movieWith([[5, 10], [15, 10], [40, 10]]);
    expect(starts(pushContent(movie, [ids[2]], -20))).toEqual([0, 10, 20]);
  });

  it('refuses a push before the start of the movie', () => {
    const { movie, ids } = movieWith([[2, 10], [12, 10]]);
    expect(() => pushContent(movie, [ids[1]], -3)).toThrow(OpError);
  });

  it('refuses a push past the end of the movie', () => {
    const { movie, ids } = movieWith([[0, 10], [10, 10]], 22);
    expect(starts(pushContent(movie, [ids[0]], 2))).toEqual([2, 12]);
    expect(() => pushContent(movie, [ids[0]], 3)).toThrow(OpError);
  });

  it('refuses ids that are on no track', () => {
    const { movie } = movieWith([[0, 10]]);
    expect(() => pushContent(movie, ['missing'], 1)).toThrow(OpError);
  });

  it('leaves tracks without selected content untouched', () => {
    const { movie, ids } = movieWith([[0, 10]]);
    const other = track('B', [content('drawing', 0, 10)]);
    const both = { ...movie, tracks: [...movie.tracks, other] };
    const out = pushContent(both, [ids[0]], 4);
    expect(out.tracks[1]).toBe(other);
    expect(out.tracks[0].content[0].duration).toBe(10);
  });
});

describe('keepInside', () => {
  it('accepts content that ends exactly at the last frame and refuses one frame more', () => {
    const { movie } = movieWith([[90, 10]]);
    expect(keepInside(movie)).toBe(movie);
    expect(() => keepInside({ ...movie, duration: 99 })).toThrow(OpError);
  });
});
