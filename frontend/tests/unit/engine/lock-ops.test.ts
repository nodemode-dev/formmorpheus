import { describe, expect, it } from 'vitest';
import { moveToNewTrack, roomOn, setAllLocked, setTrackLocked } from '@src/engine/lock-ops';
import { content, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Movie } from '@src/engine/types';

function movie(): Movie {
  const m = newMovie();
  m.tracks = [
    track('A', [content('image', 10, 10, { id: 'a1' })]),
    track('B', [content('image', 0, 5, { id: 'b1' }), content('image', 15, 10, { id: 'b2' })]),
  ];
  return m;
}

describe('track lock', () => {
  it('locks one track and leaves the input movie alone', () => {
    const m = movie();
    const locked = setTrackLocked(m, m.tracks[1].id, true);
    expect(locked.tracks[1].locked).toBe(true);
    expect(locked.tracks[0]).toBe(m.tracks[0]);
    expect(m.tracks[1].locked).toBeUndefined();
  });

  it('removes the field on unlock and keeps the same track when nothing changes', () => {
    const m = movie();
    const locked = setTrackLocked(m, m.tracks[0].id, true);
    const again = setTrackLocked(locked, m.tracks[0].id, true);
    expect(again.tracks[0]).toBe(locked.tracks[0]);
    const open = setTrackLocked(locked, m.tracks[0].id, false);
    expect('locked' in open.tracks[0]).toBe(false);
  });

  it('refuses a track that does not exist', () => {
    expect(() => setTrackLocked(movie(), 'gone', true)).toThrow(OpError);
  });

  it('locks and unlocks every track at once', () => {
    const all = setAllLocked(movie(), true);
    expect(all.tracks.every((t) => t.locked === true)).toBe(true);
    expect(setAllLocked(all, false).tracks.some((t) => 'locked' in t)).toBe(false);
  });

  it('reports room only on an existing unlocked track with a free span', () => {
    const m = movie();
    const none = new Set<string>();
    expect(roomOn(m, 1, 5, 10, none)).toBe(true);
    expect(roomOn(m, 1, 5, 11, none)).toBe(false);
    expect(roomOn(m, 1, 5, 11, new Set(['b2']))).toBe(true);
    expect(roomOn(m, 9, 0, 1, none)).toBe(false);
    expect(roomOn(setTrackLocked(m, m.tracks[1].id, true), 1, 5, 10, none)).toBe(false);
  });
});

describe('move onto a new track', () => {
  it('puts the content on a new track at the given place and shifts it', () => {
    const m = movie();
    const out = moveToNewTrack(m, ['b2'], 5, 0);
    expect(out.tracks).toHaveLength(3);
    expect(out.tracks[0].content.map((c) => [c.id, c.start])).toEqual([['b2', 20]]);
    expect(out.tracks[2].content.map((c) => c.id)).toEqual(['b1']);
    expect(m.tracks[1].content).toHaveLength(2);
  });

  it('removes a track the move left empty', () => {
    const m = movie();
    const out = moveToNewTrack(m, ['a1'], 0, 99);
    expect(out.tracks).toHaveLength(2);
    expect(out.tracks[0].id).toBe(m.tracks[1].id);
    expect(out.tracks[1].content.map((c) => c.id)).toEqual(['a1']);
  });

  it('stops the shift at frame zero', () => {
    const one = moveToNewTrack(movie(), ['a1'], -1000, 0);
    expect(one.tracks[0].content.map((c) => [c.id, c.start])).toEqual([['a1', 0]]);
    const m = movie();
    m.tracks[1].content[0].start = 4;
    m.tracks[1].content[0].duration = 2;
    const pair = moveToNewTrack(m, ['b1', 'b2'], -1000, 0);
    expect(pair.tracks[0].content.map((c) => [c.id, c.start])).toEqual([['b1', 0], ['b2', 11]]);
  });

  it('refuses content that would overlap itself on the one track', () => {
    const m = movie();
    m.tracks[1].content[1].start = 12;
    expect(() => moveToNewTrack(m, ['a1', 'b2'], 0, 0)).toThrow(OpError);
  });

  it('refuses content on a locked track and ids that match nothing', () => {
    const m = movie();
    expect(() => moveToNewTrack(setTrackLocked(m, m.tracks[0].id, true), ['a1'], 0, 0)).toThrow(OpError);
    expect(() => moveToNewTrack(m, ['gone'], 0, 0)).toThrow(OpError);
    expect(() => moveToNewTrack(m, [], 0, 0)).toThrow(OpError);
  });
});
