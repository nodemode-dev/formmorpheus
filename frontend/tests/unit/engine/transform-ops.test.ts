import { describe, expect, it } from 'vitest';
import { OpError } from '@src/engine/ops';
import { flip, isDefaultTransform, nudge, resetTransform, withStretch } from '@src/engine/transform-ops';
import type { Content, Movie, Track, Transform } from '@src/engine/types';

const rest: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false };

function content(id: string, transform: Partial<Transform> = {}, extra: Partial<Content> = {}): Content {
  return { id, kind: 'drawing', name: id, start: 0, duration: 10, offset: 0, opacity: 1, transform: { ...rest, ...transform }, layers: [], keys: [], text: null, tracks: [], ...extra } as unknown as Content;
}

function movie(items: Content[], locked = false): Movie {
  const t = { id: 't', name: 't', hidden: false, content: items, ...(locked ? { locked: true } : {}) } as unknown as Track;
  return { id: 'm', name: 'm', width: 100, height: 100, fps: 24, duration: 100, tracks: [t] } as unknown as Movie;
}

const get = (m: Movie, id: string): Content => m.tracks[0].content.find((c) => c.id === id) as Content;

describe('flip', () => {
  it('mirrors only the chosen axis of the chosen content', () => {
    const m = flip(movie([content('a'), content('b')]), ['a'], 'h');
    expect(get(m, 'a').transform).toMatchObject({ flipH: true, flipV: false });
    expect(get(m, 'b').transform).toMatchObject({ flipH: false, flipV: false });
    expect(get(flip(m, ['a'], 'v'), 'a').transform).toMatchObject({ flipH: true, flipV: true });
  });

  it('restores the picture when applied twice', () => {
    const start = movie([content('a', { x: 5, rotation: 30 })]);
    expect(get(flip(flip(start, ['a'], 'v'), ['a'], 'v'), 'a').transform).toEqual(get(start, 'a').transform);
  });

  it('leaves position, scale, rotation and keys alone', () => {
    const keys = [{ id: 'lane' }] as unknown as Content['keys'];
    const m = flip(movie([content('a', { x: 5, y: -2, scale: 2, rotation: 45 }, { keys })]), ['a'], 'h');
    expect(get(m, 'a').transform).toEqual({ x: 5, y: -2, scale: 2, rotation: 45, flipH: true, flipV: false });
    expect(get(m, 'a').keys).toEqual(keys);
  });

  it('does not change the movie it was given', () => {
    const start = movie([content('a')]);
    flip(start, ['a'], 'h');
    expect(get(start, 'a').transform.flipH).toBe(false);
  });

  it('refuses content on a locked track', () => {
    expect(() => flip(movie([content('a')], true), ['a'], 'h')).toThrow(OpError);
  });

  it('returns the same movie when nothing is chosen', () => {
    const start = movie([content('a')]);
    expect(flip(start, [], 'h')).toBe(start);
  });
});

describe('resetTransform', () => {
  it('puts position, scale, stretch, rotation and flips back', () => {
    const m = resetTransform(movie([content('a', { x: 9, y: 8, scale: 3, rotation: 90, flipH: true, flipV: true, stretchX: 2, stretchY: 0.5 })]), ['a']);
    expect(get(m, 'a').transform).toEqual(rest);
    expect(isDefaultTransform(get(m, 'a').transform)).toBe(true);
  });

  it('keeps the pivot and the keys', () => {
    const keys = [{ id: 'lane' }] as unknown as Content['keys'];
    const m = resetTransform(movie([content('a', { x: 9 }, { pivot: { x: 4, y: 6 }, keys })]), ['a']);
    expect(get(m, 'a').pivot).toEqual({ x: 4, y: 6 });
    expect(get(m, 'a').keys).toEqual(keys);
  });

  it('resets every chosen content and no other', () => {
    const m = resetTransform(movie([content('a', { x: 1 }), content('b', { x: 2 }), content('c', { x: 3 })]), ['a', 'c']);
    expect([get(m, 'a').transform.x, get(m, 'b').transform.x, get(m, 'c').transform.x]).toEqual([0, 2, 0]);
  });
});

describe('isDefaultTransform', () => {
  it('accepts the resting transform, with or without a stretch of one', () => {
    expect(isDefaultTransform(rest)).toBe(true);
    expect(isDefaultTransform({ ...rest, stretchX: 1, stretchY: 1 })).toBe(true);
  });

  it('notices any single field that moved', () => {
    const changes: Array<Partial<Transform>> = [{ x: 1 }, { y: -1 }, { scale: 0.5 }, { rotation: 360 }, { flipH: true }, { flipV: true }, { stretchX: 1.2 }, { stretchY: 0.8 }];
    for (const c of changes) expect(isDefaultTransform({ ...rest, ...c })).toBe(false);
  });
});

describe('nudge', () => {
  it('moves every chosen content by the given pixels', () => {
    const m = nudge(movie([content('a', { x: 10, y: 20 }), content('b', { x: -5, y: 0 }), content('c')]), ['a', 'b'], 3, -4);
    expect(get(m, 'a').transform).toMatchObject({ x: 13, y: 16 });
    expect(get(m, 'b').transform).toMatchObject({ x: -2, y: -4 });
    expect(get(m, 'c').transform).toMatchObject({ x: 0, y: 0 });
  });

  it('adds up over several nudges and undoes with the opposite one', () => {
    const start = movie([content('a', { x: 1, y: 1, scale: 2 })]);
    const there = nudge(nudge(start, ['a'], 10, 0), ['a'], 10, 5);
    expect(get(there, 'a').transform).toMatchObject({ x: 21, y: 6, scale: 2 });
    expect(get(nudge(there, ['a'], -20, -5), 'a').transform).toEqual(get(start, 'a').transform);
  });

  it('refuses content on a locked track', () => {
    expect(() => nudge(movie([content('a')], true), ['a'], 1, 1)).toThrow(OpError);
  });
});

describe('withStretch', () => {
  it('stores a stretch rounded to three decimals', () => {
    expect(withStretch(rest, 1.23456, 0.5)).toEqual({ ...rest, stretchX: 1.235, stretchY: 0.5 });
  });

  it('does not write a stretch of one', () => {
    const out = withStretch({ ...rest, stretchX: 2, stretchY: 3 }, 1, 1.0002);
    expect(out).toEqual(rest);
    expect('stretchX' in out).toBe(false);
    expect('stretchY' in out).toBe(false);
  });

  it('writes one axis without the other', () => {
    const out = withStretch(rest, 1, 2);
    expect(out.stretchY).toBe(2);
    expect('stretchX' in out).toBe(false);
  });

  it('keeps the rest of the transform and the one it was given', () => {
    const src: Transform = { x: 4, y: 5, scale: 2, rotation: 10, flipH: true, flipV: false, stretchX: 3 };
    const out = withStretch(src, 0.75, 1);
    expect(out).toEqual({ x: 4, y: 5, scale: 2, rotation: 10, flipH: true, flipV: false, stretchX: 0.75 });
    expect(src.stretchX).toBe(3);
  });
});
