import { describe, expect, it } from 'vitest';
import { addMarker, deleteMarker, markerAtFrame, markersOf, moveMarker, patchMarker, stepMarker } from '@src/engine/marker-ops';
import { newMovie } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Movie } from '@src/engine/types';

function withFrames(frames: number[]): { movie: Movie; ids: string[] } {
  let movie = newMovie();
  const ids: string[] = [];
  for (const f of frames) { const r = addMarker(movie, f); movie = r.movie; ids.push(r.id); }
  return { movie, ids };
}

describe('markers', () => {
  it('has no markers and no markers field on a new movie', () => {
    const m = newMovie();
    expect(markersOf(m)).toEqual([]);
    expect('markers' in m).toBe(false);
  });

  it('adds markers sorted by frame without changing the movie it was given', () => {
    const base = newMovie();
    const { movie } = withFrames([30, 5, 12]);
    expect(markersOf(movie).map((k) => k.frame)).toEqual([5, 12, 30]);
    addMarker(base, 3);
    expect(markersOf(base)).toEqual([]);
  });

  it('rounds the frame and never goes below zero', () => {
    const a = addMarker(newMovie(), 4.6, 'Beat');
    expect(markersOf(a.movie)[0]).toMatchObject({ frame: 5, name: 'Beat', id: a.id });
    expect(markersOf(addMarker(newMovie(), -20).movie)[0].frame).toBe(0);
  });

  it('refuses a second marker on the same frame', () => {
    const { movie } = withFrames([8]);
    expect(() => addMarker(movie, 8)).toThrow(OpError);
    expect(() => addMarker(movie, 8.4)).toThrow(OpError);
  });

  it('finds the marker on a frame', () => {
    const { movie, ids } = withFrames([8, 20]);
    expect(markerAtFrame(movie, 20)?.id).toBe(ids[1]);
    expect(markerAtFrame(movie, 9)).toBeNull();
  });

  it('renames with a cap of 80 characters and sets or clears the colour', () => {
    const { movie, ids } = withFrames([8]);
    const named = patchMarker(movie, ids[0], { name: 'x'.repeat(200), color: 'teal' });
    expect(markersOf(named)[0].name).toHaveLength(80);
    expect(markersOf(named)[0].color).toBe('teal');
    const cleared = patchMarker(named, ids[0], { color: null });
    expect('color' in markersOf(cleared)[0]).toBe(false);
    expect(markersOf(cleared)[0].name).toHaveLength(80);
    expect(markersOf(movie)[0].name).toBe('');
  });

  it('refuses to patch or move a marker that is gone', () => {
    const { movie } = withFrames([8]);
    expect(() => patchMarker(movie, 'gone', { name: 'a' })).toThrow(OpError);
    expect(() => moveMarker(movie, 'gone', 3)).toThrow(OpError);
  });

  it('moves a marker and keeps the list sorted', () => {
    const { movie, ids } = withFrames([5, 12, 30]);
    const moved = moveMarker(movie, ids[0], 20.2);
    expect(markersOf(moved).map((k) => k.frame)).toEqual([12, 20, 30]);
    expect(markersOf(moved)[1].id).toBe(ids[0]);
  });

  it('refuses a move onto another marker but allows a move onto its own frame', () => {
    const { movie, ids } = withFrames([5, 12]);
    expect(() => moveMarker(movie, ids[0], 12)).toThrow(OpError);
    expect(markersOf(moveMarker(movie, ids[0], 5)).map((k) => k.frame)).toEqual([5, 12]);
  });

  it('drops the markers field when the last marker is deleted', () => {
    const { movie, ids } = withFrames([5, 12]);
    const one = deleteMarker(movie, ids[0]);
    expect(markersOf(one).map((k) => k.id)).toEqual([ids[1]]);
    const none = deleteMarker(one, ids[1]);
    expect('markers' in none).toBe(false);
    expect(markersOf(deleteMarker(movie, 'gone'))).toHaveLength(2);
  });

  it('steps to the next and the previous marker, strictly past the frame', () => {
    const { movie } = withFrames([5, 12, 30]);
    expect(stepMarker(movie, 0, 1)).toBe(5);
    expect(stepMarker(movie, 5, 1)).toBe(12);
    expect(stepMarker(movie, 30, 1)).toBeNull();
    expect(stepMarker(movie, 30, -1)).toBe(12);
    expect(stepMarker(movie, 13, -1)).toBe(12);
    expect(stepMarker(movie, 5, -1)).toBeNull();
    expect(stepMarker(newMovie(), 5, 1)).toBeNull();
  });
});
