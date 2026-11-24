import { describe, expect, it } from 'vitest';
import { flipOrder } from '@src/engine/flip-order';
import { OpError } from '@src/engine/ops';
import type { Content, Movie, Track } from '@src/engine/types';

const block = (id: string, start: number, duration: number): Content => ({ id, start, duration, kind: 'shape', keys: [] }) as unknown as Content;
const track = (id: string, content: Content[]): Track => ({ id, content }) as unknown as Track;
const movieOf = (...tracks: Track[]): Movie => ({ fps: 24, tracks }) as unknown as Movie;
const starts = (m: Movie, row = 0): Record<string, number> => Object.fromEntries(m.tracks[row].content.map((c) => [c.id, c.start]));

describe('flipOrder', () => {
  it('reverses the order and keeps the first start and the gaps', () => {
    const m = movieOf(track('t', [block('a', 0, 10), block('b', 15, 5), block('c', 30, 20)]));
    const out = flipOrder(m, ['a', 'b', 'c']);
    expect(starts(out)).toEqual({ c: 0, b: 25, a: 40 });
  });

  it('covers the same stretch of the movie afterwards', () => {
    const m = movieOf(track('t', [block('a', 7, 10), block('b', 20, 3), block('c', 40, 12)]));
    const out = flipOrder(m, ['a', 'b', 'c']);
    const ends = out.tracks[0].content.map((c) => c.start + c.duration);
    expect(Math.min(...out.tracks[0].content.map((c) => c.start))).toBe(7);
    expect(Math.max(...ends)).toBe(52);
  });

  it('gives back the original when applied twice', () => {
    const m = movieOf(track('t', [block('a', 2, 10), block('b', 15, 5), block('c', 30, 20)]));
    const twice = flipOrder(flipOrder(m, ['a', 'b', 'c']), ['a', 'b', 'c']);
    expect(starts(twice)).toEqual({ a: 2, b: 15, c: 30 });
  });

  it('reads the blocks in time order whatever their stored order', () => {
    const m = movieOf(track('t', [block('b', 15, 5), block('a', 0, 10)]));
    expect(starts(flipOrder(m, ['a', 'b']))).toEqual({ b: 0, a: 10 });
  });

  it('leaves unselected blocks and their durations alone', () => {
    const m = movieOf(track('t', [block('a', 0, 10), block('b', 10, 5), block('z', 100, 8)]));
    const out = flipOrder(m, ['a', 'b']);
    expect(starts(out)).toEqual({ b: 0, a: 5, z: 100 });
    expect(out.tracks[0].content.map((c) => c.duration).sort((x, y) => x - y)).toEqual([5, 8, 10]);
  });

  it('flips each track by itself and keeps a track with fewer than two picks as it is', () => {
    const lone = track('u', [block('x', 3, 4), block('y', 9, 4)]);
    const m = movieOf(track('t', [block('a', 0, 10), block('b', 10, 5)]), lone);
    const out = flipOrder(m, ['a', 'b', 'x']);
    expect(starts(out, 0)).toEqual({ b: 0, a: 5 });
    expect(out.tracks[1]).toBe(lone);
  });

  it('does not change the movie it was given', () => {
    const m = movieOf(track('t', [block('a', 0, 10), block('b', 15, 5)]));
    flipOrder(m, ['a', 'b']);
    expect(starts(m)).toEqual({ a: 0, b: 15 });
  });

  it('refuses when no track has two selected blocks', () => {
    const m = movieOf(track('t', [block('a', 0, 10)]), track('u', [block('x', 0, 4)]));
    expect(() => flipOrder(m, ['a', 'x'])).toThrow(OpError);
    expect(() => flipOrder(m, [])).toThrow(OpError);
    expect(() => flipOrder(m, ['nope', 'gone'])).toThrow(OpError);
  });
});
