import { describe, expect, it } from 'vitest';
import { OpError } from '@src/engine/ops';
import { freezeAt, resetRetime, setReverse, setSpeed } from '@src/engine/retime-ops';
import type { Content, Movie } from '@src/engine/types';

function block(id: string, start: number, duration: number, over: Record<string, unknown> = {}): Content {
  return {
    id, kind: 'video', name: id.toUpperCase(), asset: 'v1', start, duration, offset: 0, keys: [], tracks: [],
    transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false }, ...over,
  } as unknown as Content;
}

function movie(content: Content[], over: Record<string, unknown> = {}): Movie {
  return {
    fps: 24, duration: 100, width: 1920, height: 1080, background: '#000000',
    assets: { v1: { frames: 100 } }, tracks: [{ id: 't1', content }], ...over,
  } as unknown as Movie;
}

const get = (m: Movie, id: string): Content => {
  const c = m.tracks[0].content.find((x) => x.id === id);
  if (!c) throw new Error(`no ${id}`);
  return c;
};

describe('setSpeed', () => {
  it('shortens a faster block so the same part of the source is shown', () => {
    const out = get(setSpeed(movie([block('a', 0, 20)]), 'a', 2), 'a');
    expect(out.speed).toBe(2);
    expect(out.duration).toBe(10);
  });

  it('lengthens a slower block', () => {
    const out = get(setSpeed(movie([block('a', 0, 20)]), 'a', 0.5), 'a');
    expect(out.speed).toBe(0.5);
    expect(out.duration).toBe(40);
  });

  it('clamps the speed to the allowed range', () => {
    const out = get(setSpeed(movie([block('a', 0, 20)]), 'a', 50), 'a');
    expect(out.speed).toBe(4);
    expect(out.duration).toBe(5);
  });

  it('never makes a block shorter than one frame', () => {
    expect(get(setSpeed(movie([block('a', 0, 2)]), 'a', 4), 'a').duration).toBe(1);
  });

  it('stops a slowed block at the next block on its track', () => {
    const out = get(setSpeed(movie([block('a', 0, 20), block('b', 30, 10)]), 'a', 0.25), 'a');
    expect(out.duration).toBe(30);
    expect(out.speed).toBe(0.25);
  });

  it('stops a slowed block where its source runs out', () => {
    const m = movie([block('a', 0, 20, { offset: 90 })]);
    expect(get(setSpeed(m, 'a', 0.5), 'a').duration).toBe(20);
  });

  it('drops the speed field at normal speed and restores the length', () => {
    const fast = setSpeed(movie([block('a', 0, 20)]), 'a', 2);
    const out = get(setSpeed(fast, 'a', 1), 'a');
    expect(out).not.toHaveProperty('speed');
    expect(out.duration).toBe(20);
  });

  it('records when the pitch should follow the speed', () => {
    const m = movie([block('a', 0, 20)]);
    const follows = setSpeed(m, 'a', 2, false);
    expect(get(follows, 'a').speedPitch).toBe(true);
    expect(get(setSpeed(follows, 'a', 2), 'a')).not.toHaveProperty('speedPitch');
  });

  it('treats a freeze as normal speed when it is given a speed', () => {
    const out = get(setSpeed(movie([block('a', 0, 10, { speed: 0, kind: 'flipbook' })]), 'a', 2), 'a');
    expect(out.duration).toBe(5);
    expect(out.speed).toBe(2);
  });

  it('refuses content that cannot change speed and content that is gone', () => {
    const m = movie([block('a', 0, 20, { kind: 'text' })]);
    expect(() => setSpeed(m, 'a', 2)).toThrow(OpError);
    expect(() => setSpeed(m, 'missing', 2)).toThrow(OpError);
  });

  it('does not change the movie it was given', () => {
    const m = movie([block('a', 0, 20)]);
    setSpeed(m, 'a', 2);
    expect(get(m, 'a').duration).toBe(20);
    expect(get(m, 'a')).not.toHaveProperty('speed');
  });
});

describe('setReverse and resetRetime', () => {
  it('turns reverse on and off', () => {
    const on = setReverse(movie([block('a', 0, 20)]), 'a', true);
    expect(get(on, 'a').reverse).toBe(true);
    expect(get(setReverse(on, 'a', false), 'a')).not.toHaveProperty('reverse');
  });

  it('refuses to reverse content that does not follow a source', () => {
    expect(() => setReverse(movie([block('a', 0, 20, { kind: 'shape' })]), 'a', true)).toThrow(OpError);
    expect(() => setReverse(movie([]), 'a', true)).toThrow(OpError);
  });

  it('resets speed, direction and pitch and restores the length', () => {
    const m = movie([block('a', 0, 10, { speed: 2, reverse: true, speedPitch: true })]);
    const out = get(resetRetime(m, 'a'), 'a');
    expect(out).not.toHaveProperty('speed');
    expect(out).not.toHaveProperty('reverse');
    expect(out).not.toHaveProperty('speedPitch');
    expect(out.duration).toBe(20);
  });

  it('refuses to reset content that is gone', () => {
    expect(() => resetRetime(movie([]), 'a')).toThrow(OpError);
  });
});

describe('freezeAt', () => {
  it('cuts the block, holds the frame under the Playhead and moves the rest later', () => {
    const m = movie([block('a', 10, 20, { offset: 5 }), block('b', 40, 10)], { duration: 45 });
    const r = freezeAt(m, 'a', 18, 12);
    const items = r.movie.tracks[0].content;
    expect(items.map((c) => [c.start, c.duration])).toEqual([[10, 8], [18, 12], [30, 12], [52, 10]]);
    expect(items[0].id).toBe('a');
    expect(items[1].id).toBe(r.freeze);
    expect(items[1]).toMatchObject({ speed: 0, offset: 13, keys: [] });
    expect(items[2].offset).toBe(13);
    expect(items[3].id).toBe('b');
    expect(new Set(items.map((c) => c.id)).size).toBe(4);
    expect(r.movie.duration).toBe(62);
  });

  it('never shortens the movie', () => {
    const r = freezeAt(movie([block('a', 0, 20)]), 'a', 5, 3);
    expect(r.movie.duration).toBe(100);
  });

  it('holds the frame a faster block shows there', () => {
    const r = freezeAt(movie([block('a', 0, 20, { speed: 2, offset: 4 })]), 'a', 6, 5);
    const [left, hold, rest] = r.movie.tracks[0].content;
    expect(hold.offset).toBe(16);
    expect(left.offset).toBe(4);
    expect(rest.offset).toBe(16);
    expect(rest.speed).toBe(2);
  });

  it('holds the frame a reversed block shows there and keeps both halves on their source frames', () => {
    const r = freezeAt(movie([block('a', 0, 20, { reverse: true })]), 'a', 5, 4);
    const [left, hold, rest] = r.movie.tracks[0].content;
    expect(hold.offset).toBe(14);
    expect(hold).not.toHaveProperty('reverse');
    expect(left).toMatchObject({ duration: 5, offset: 15, reverse: true });
    expect(rest).toMatchObject({ duration: 15, offset: 0, reverse: true });
  });

  it('keeps the original id on the rest when the cut is at the first frame', () => {
    const r = freezeAt(movie([block('a', 10, 20)]), 'a', 10, 6);
    const items = r.movie.tracks[0].content;
    expect(items.map((c) => [c.start, c.duration])).toEqual([[10, 6], [16, 20]]);
    expect(items[0].id).toBe(r.freeze);
    expect(items[1].id).toBe('a');
  });

  it('moves the keys after the cut onto the rest, local to its first frame', () => {
    const keys = [{ kind: 'transform', channels: { x: [{ frame: 3, value: 1 }, { frame: 12, value: 2 }] } }];
    const r = freezeAt(movie([block('a', 0, 20, { keys })]), 'a', 8, 4);
    const rest = r.movie.tracks[0].content[2];
    expect(rest.keys[0].channels.x).toEqual([{ frame: 4, value: 2 }]);
  });

  it('holds for at least one whole frame', () => {
    const r = freezeAt(movie([block('a', 0, 20)]), 'a', 5, 0);
    expect(r.movie.tracks[0].content[1].duration).toBe(1);
    expect(freezeAt(movie([block('a', 0, 20)]), 'a', 5, 2.6).movie.tracks[0].content[1].duration).toBe(3);
  });

  it('refuses a sound, a Playhead outside the block and content that is gone', () => {
    expect(() => freezeAt(movie([block('a', 0, 20, { kind: 'audio' })]), 'a', 5, 4)).toThrow(OpError);
    const m = movie([block('a', 10, 20)]);
    expect(() => freezeAt(m, 'a', 9, 4)).toThrow(OpError);
    expect(() => freezeAt(m, 'a', 30, 4)).toThrow(OpError);
    expect(() => freezeAt(m, 'nope', 15, 4)).toThrow(OpError);
  });
});
