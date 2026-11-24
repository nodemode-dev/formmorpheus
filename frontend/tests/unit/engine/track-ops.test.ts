import { describe, expect, it, vi } from 'vitest';
import { OpError } from '@src/engine/ops';
import { cloneTrack, copyTrack, duplicateTrack, hasTrackClip, pasteTrack } from '@src/engine/track-ops';
import type { Content, Movie, Track } from '@src/engine/types';

function content(id: string, extra: Partial<Content> = {}): Content {
  return { id, kind: 'drawing', name: id, start: 0, duration: 10, offset: 0, opacity: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false }, layers: [], keys: [], text: null, tracks: [], ...extra } as unknown as Content;
}

function track(id: string, items: Content[], name = id): Track {
  return { id, name, hidden: false, content: items } as unknown as Track;
}

function movie(tracks: Track[]): Movie {
  return { id: 'm', name: 'm', width: 100, height: 100, fps: 24, duration: 100, tracks } as unknown as Movie;
}

function allIds(t: Track): string[] {
  return [t.id, ...t.content.flatMap((c) => [c.id, ...c.tracks.flatMap(allIds)])];
}

describe('cloneTrack', () => {
  it('gives the track and everything inside it fresh ids', () => {
    const inner = track('t2', [content('c3')]);
    const src = track('t1', [content('c1'), content('c2', { tracks: [inner] })]);
    const copy = cloneTrack(src);
    const before = allIds(src);
    const after = allIds(copy);
    expect(after).toHaveLength(before.length);
    expect(new Set(after).size).toBe(after.length);
    for (const id of after) expect(before).not.toContain(id);
  });

  it('adds copy to the name once', () => {
    const first = cloneTrack(track('t1', [], 'Hero'));
    expect(first.name).toBe('Hero copy');
    expect(cloneTrack(first).name).toBe('Hero copy');
  });

  it('keeps the content data and its order', () => {
    const src = track('t1', [content('a', { start: 3, duration: 7, name: 'first' }), content('b', { start: 12, name: 'second' })]);
    const copy = cloneTrack(src);
    expect(copy.content.map((c) => [c.name, c.start, c.duration])).toEqual([['first', 3, 7], ['second', 12, 10]]);
  });

  it('points a parent inside the track at the copy of that parent', () => {
    const src = track('t1', [content('a'), content('b', { parent: 'a' })]);
    const copy = cloneTrack(src);
    expect(copy.content[1].parent).toBe(copy.content[0].id);
    expect(copy.content[1].parent).not.toBe('a');
  });

  it('follows a parent that comes later in the track', () => {
    const src = track('t1', [content('b', { parent: 'a' }), content('a')]);
    const copy = cloneTrack(src);
    expect(copy.content[0].parent).toBe(copy.content[1].id);
  });

  it('leaves a parent outside the track as it was', () => {
    const copy = cloneTrack(track('t1', [content('b', { parent: 'elsewhere' })]));
    expect(copy.content[0].parent).toBe('elsewhere');
  });

  it('is a deep copy that leaves the original untouched', () => {
    const src = track('t1', [content('a')]);
    const snapshot = JSON.stringify(src);
    const copy = cloneTrack(src);
    copy.content[0].transform.x = 99;
    expect(JSON.stringify(src)).toBe(snapshot);
  });
});

describe('duplicateTrack', () => {
  it('puts the copy directly above the track it was made from', () => {
    const m = movie([track('top', []), track('mid', [content('a')]), track('low', [])]);
    const { movie: next, track: made } = duplicateTrack(m, 'mid');
    expect(next.tracks.map((t) => t.id)).toEqual(['top', made.id, 'mid', 'low']);
    expect(made.name).toBe('mid copy');
    expect(made.content).toHaveLength(1);
  });

  it('does not change the movie it was given', () => {
    const m = movie([track('a', []), track('b', [])]);
    duplicateTrack(m, 'b');
    expect(m.tracks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('refuses a track that is not in the movie', () => {
    expect(() => duplicateTrack(movie([track('a', [])]), 'gone')).toThrow(OpError);
  });
});

describe('the track clipboard', () => {
  it('refuses to paste before anything was copied', async () => {
    vi.resetModules();
    const ops = await import('@src/engine/ops');
    const fresh = await import('@src/engine/track-ops');
    expect(fresh.hasTrackClip()).toBe(false);
    expect(() => fresh.pasteTrack(movie([track('a', [])]), null)).toThrow(ops.OpError);
  });

  it('pastes on top when no track is chosen', () => {
    copyTrack(track('src', [content('x')], 'Source'));
    expect(hasTrackClip()).toBe(true);
    const { movie: next, track: made } = pasteTrack(movie([track('a', []), track('b', [])]), null);
    expect(next.tracks.map((t) => t.id)).toEqual([made.id, 'a', 'b']);
    expect(made.name).toBe('Source copy');
  });

  it('pastes above the chosen track', () => {
    copyTrack(track('src', [content('x')]));
    const { movie: next, track: made } = pasteTrack(movie([track('a', []), track('b', [])]), 'b');
    expect(next.tracks.map((t) => t.id)).toEqual(['a', made.id, 'b']);
  });

  it('refuses to paste above a track that is gone', () => {
    copyTrack(track('src', []));
    expect(() => pasteTrack(movie([track('a', [])]), 'gone')).toThrow(OpError);
  });

  it('gives every paste its own ids', () => {
    copyTrack(track('src', [content('x')]));
    const m = movie([]);
    const one = pasteTrack(m, null).track;
    const two = pasteTrack(m, null).track;
    expect(one.id).not.toBe(two.id);
    expect(one.content[0].id).not.toBe(two.content[0].id);
    expect(one.id).not.toBe('src');
  });

  it('keeps what was copied when the original changes afterwards', () => {
    const src = track('src', [content('x', { name: 'before' })]);
    copyTrack(src);
    src.content[0].name = 'after';
    src.content.push(content('y'));
    const made = pasteTrack(movie([]), null).track;
    expect(made.content.map((c) => c.name)).toEqual(['before']);
  });
});
