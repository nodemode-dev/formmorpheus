import { describe, expect, it } from 'vitest';
import {
  clampSide, content, contentAt, contentEnd, end, fits, flipIndexAt, flipLength, flipStartOf, flipTrack, freeSpan,
  locate, newMovie, sortContent, sourceFrames, textColorFor, track, trackName, uid,
} from '@src/engine/model';
import { MAX_SIDE, type FlipTrack } from '@src/engine/types';

function row(holds: number[]): FlipTrack {
  const t = flipTrack('Row', holds.length);
  return { ...t, frames: t.frames.map((f, i) => ({ ...f, hold: holds[i] })) };
}

describe('ids', () => {
  it('gives a different id on every call and keeps the prefix', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uid('zz')));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.startsWith('zz')).toBe(true);
  });
});

describe('flipbook rows', () => {
  it('always makes at least one frame', () => {
    expect(flipTrack('A', 0).frames).toHaveLength(1);
    expect(flipTrack('A', -3).frames).toHaveLength(1);
    expect(flipTrack('A', 4).frames).toHaveLength(4);
  });

  it('sums the holds and counts a hold below one as one', () => {
    expect(flipLength(row([2, 3, 1]))).toBe(6);
    expect(flipLength(row([0, -4, 2]))).toBe(4);
  });

  it('finds the frame shown at a local time', () => {
    const t = row([2, 3, 1]);
    expect([0, 1, 2, 3, 4, 5].map((n) => flipIndexAt(t, n))).toEqual([0, 0, 1, 1, 1, 2]);
  });

  it('loops past the end and before the start', () => {
    const t = row([2, 3, 1]);
    expect(flipIndexAt(t, 6)).toBe(0);
    expect(flipIndexAt(t, 8)).toBe(1);
    expect(flipIndexAt(t, -1)).toBe(2);
    expect(flipIndexAt(t, -6)).toBe(0);
  });

  it('reports no frame for a row without frames', () => {
    expect(flipIndexAt({ ...row([1]), frames: [] }, 0)).toBe(-1);
  });

  it('gives the start time of each frame and stops at the row length', () => {
    const t = row([2, 3, 1]);
    expect([0, 1, 2].map((i) => flipStartOf(t, i))).toEqual([0, 2, 5]);
    expect(flipStartOf(t, 99)).toBe(6);
  });

  it('agrees between start time and index lookup', () => {
    const t = row([4, 1, 7, 2]);
    for (let i = 0; i < t.frames.length; i++) expect(flipIndexAt(t, flipStartOf(t, i))).toBe(i);
  });
});

describe('text colour', () => {
  it('picks dark text on a light background and light text on a dark one', () => {
    expect(textColorFor('#ffffff')).toBe('#111111');
    expect(textColorFor('#000000')).toBe('#ffffff');
    expect(textColorFor('ffff00')).toBe('#111111');
    expect(textColorFor(' #0000FF ')).toBe('#ffffff');
  });

  it('falls back to dark text for a malformed colour', () => {
    expect(textColorFor('')).toBe('#111111');
    expect(textColorFor('#fff')).toBe('#111111');
    expect(textColorFor('rgb(0,0,0)')).toBe('#111111');
  });
});

describe('content', () => {
  it('rounds the span and refuses a negative start or an empty duration', () => {
    const c = content('image', -4.2, 0);
    expect(c.start).toBe(0);
    expect(c.duration).toBe(1);
    const d = content('image', 2.6, 9.4);
    expect(d.start).toBe(3);
    expect(d.duration).toBe(9);
    expect(end(d)).toBe(12);
  });

  it('gives a drawing one layer and a text its style, and nothing to other kinds', () => {
    expect(content('drawing', 0, 1).layers).toHaveLength(1);
    expect(content('image', 0, 1).layers).toHaveLength(0);
    expect(content('text', 0, 1).text).not.toBeNull();
    expect(content('image', 0, 1).text).toBeNull();
  });

  it('lets the extra fields win over the defaults', () => {
    const c = content('audio', 0, 5, { name: 'Voice', volume: 0.25 });
    expect(c.name).toBe('Voice');
    expect(c.volume).toBe(0.25);
  });
});

describe('new movie', () => {
  it('clamps the sides between 16 and the largest side', () => {
    expect(clampSide(1)).toBe(16);
    expect(clampSide(-50)).toBe(16);
    expect(clampSide(MAX_SIDE * 4)).toBe(MAX_SIDE);
    expect(clampSide(640.4)).toBe(640);
    const m = newMovie({ width: 2, height: MAX_SIDE + 1 });
    expect(m.width).toBe(16);
    expect(m.height).toBe(MAX_SIDE);
  });

  it('starts empty unless a flipbook is asked for', () => {
    expect(newMovie().tracks).toEqual([]);
    const m = newMovie({ flipbook: true, fps: 12, seconds: 10 });
    expect(m.tracks).toHaveLength(1);
    const fb = m.tracks[0].content[0];
    expect(fb.kind).toBe('flipbook');
    expect(fb.start).toBe(0);
    expect(fb.duration).toBe(Math.min(m.duration, m.fps));
    expect(fb.flip[0].frames).toHaveLength(m.fps);
  });

  it('names a new track with a number no track uses', () => {
    const m = newMovie();
    expect(trackName(m)).toBe('Track 1');
    m.tracks = [track('Track 2'), track('Track 3')];
    expect(trackName(m)).toBe('Track 4');
    m.tracks = [track('Other'), track('Track 3')];
    expect(trackName(m)).toBe('Track 4');
  });
});

describe('timeline queries', () => {
  const a = content('image', 0, 10);
  const b = content('image', 20, 5);
  const t = track('T', [a, b]);

  it('finds the content under a frame with an exclusive end', () => {
    expect(contentAt(t, 0)).toBe(a);
    expect(contentAt(t, 9)).toBe(a);
    expect(contentAt(t, 10)).toBeNull();
    expect(contentAt(t, 24)).toBe(b);
    expect(contentAt(t, 25)).toBeNull();
  });

  it('reports the free span around a frame', () => {
    expect(freeSpan(t, 12)).toEqual({ from: 10, to: 20 });
    expect(freeSpan(t, 30)).toEqual({ from: 25, to: Number.POSITIVE_INFINITY });
    expect(freeSpan(t, 5)).toEqual({ from: 5, to: 5 });
    expect(freeSpan(t, 5, new Set([a.id]))).toEqual({ from: 0, to: 20 });
  });

  it('says whether a span fits between the neighbours', () => {
    expect(fits(t, 10, 10)).toBe(true);
    expect(fits(t, 10, 11)).toBe(false);
    expect(fits(t, 9, 2)).toBe(false);
    expect(fits(t, 5, 30, new Set([a.id, b.id]))).toBe(true);
  });

  it('sorts by start without changing the input', () => {
    const list = [b, a];
    expect(sortContent(list)).toEqual([a, b]);
    expect(list[0]).toBe(b);
  });

  it('locates content on its track and returns null for an unknown id', () => {
    const m = newMovie();
    m.tracks = [track('X'), t];
    const loc = locate(m, b.id);
    expect(loc?.trackIndex).toBe(1);
    expect(loc?.index).toBe(1);
    expect(loc?.content).toBe(b);
    expect(locate(m, 'nope')).toBeNull();
  });

  it('measures the end of the last content, looking inside groups', () => {
    const m = newMovie();
    expect(contentEnd(m)).toBe(0);
    const inner = content('image', 90, 10);
    const g = content('group', 0, 30, { tracks: [track('In', [inner])] });
    m.tracks = [t, track('G', [g])];
    expect(contentEnd(m)).toBe(100);
  });

  it('limits only video and audio by their source length', () => {
    const m = newMovie({ fps: 24 });
    m.assets = {
      v: { ...({} as (typeof m.assets)[string]), frames: 48 },
      s: { ...({} as (typeof m.assets)[string]), frames: 0, seconds: 2.5 },
    };
    expect(sourceFrames(m, content('image', 0, 5, { asset: 'v' }))).toBe(Number.POSITIVE_INFINITY);
    expect(sourceFrames(m, content('video', 0, 5, { asset: 'v' }))).toBe(48);
    expect(sourceFrames(m, content('audio', 0, 5, { asset: 's' }))).toBe(Math.floor(2.5 * m.fps));
    expect(sourceFrames(m, content('video', 0, 5, { asset: 'gone' }))).toBe(Number.POSITIVE_INFINITY);
  });
});
