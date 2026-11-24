import { describe, expect, it } from 'vitest';
import { NEW_ROW, applyLipsync, guessMapping, looksLikeMouth, mouthChartRow, type LipsyncJob } from '@src/engine/lipsync-ops';
import { content, flipLength, flipTrack, newMovie, track } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Content, FlipTrack, Movie } from '@src/engine/types';
import { VISEMES, VISEME_NAMES, type Viseme } from '@src/media/lipsync';

function movie(rows: FlipTrack[] = [mouthChartRow()], extra: Content[] = []): Movie {
  const m = newMovie();
  m.tracks = [track('T', [content('flipbook', 10, 8, { id: 'fb', flip: rows }), ...extra])];
  return m;
}

function job(over: Partial<LipsyncJob> = {}): LipsyncJob {
  const shapes: Viseme[] = ['AI', 'AI', 'O', 'rest'];
  return { content: 'fb', row: NEW_ROW, chartRow: 0, from: 12, shapes, map: guessMapping(mouthChartRow()), ...over };
}

const fb = (m: Movie): Content => m.tracks[0].content[0];
const holds = (t: FlipTrack): number[] => t.frames.map((f) => f.hold);
const names = (t: FlipTrack): (string | undefined)[] => t.frames.map((f) => f.name);

describe('mouth chart', () => {
  it('has one named frame per shape, in order', () => {
    const row = mouthChartRow();
    expect(row.frames).toHaveLength(VISEMES.length);
    expect(names(row)).toEqual(VISEMES.map((v) => VISEME_NAMES[v]));
  });

  it('maps each shape to the frame named for it wherever it sits', () => {
    const row = mouthChartRow();
    const reversed = { ...row, frames: [...row.frames].reverse() };
    VISEMES.forEach((v, i) => {
      expect(guessMapping(row)[v]).toBe(i);
      expect(guessMapping(reversed)[v]).toBe(VISEMES.length - 1 - i);
    });
  });

  it('falls back to the place in the order, clamped to the last frame', () => {
    const map = guessMapping(flipTrack('Plain', 3));
    expect(VISEMES.map((v) => map[v])).toEqual([0, 1, 2, 2, 2, 2, 2, 2]);
  });

  it('recognises a mouth set by named frames or by having enough frames', () => {
    expect(looksLikeMouth(mouthChartRow())).toBe(true);
    expect(looksLikeMouth(flipTrack('Plain', 3))).toBe(false);
    expect(looksLikeMouth(flipTrack('Plain', VISEMES.length))).toBe(true);
    const one = flipTrack('One', 1);
    expect(looksLikeMouth({ ...one, frames: [{ ...one.frames[0], name: VISEME_NAMES.O }] })).toBe(true);
  });
});

describe('writing lip-sync', () => {
  it('writes runs of shapes into a new top row padded with the rest shape and hides the chart', () => {
    const m = movie();
    const out = applyLipsync(m, job());
    const c = fb(out);
    expect(c.flip).toHaveLength(2);
    expect(holds(c.flip[0])).toEqual([2, 2, 1, 1, 2]);
    expect(names(c.flip[0])).toEqual((['rest', 'AI', 'O', 'rest', 'rest'] as Viseme[]).map((v) => VISEME_NAMES[v]));
    expect(c.flip[1].hidden).toBe(true);
    expect(c.duration).toBe(8);
    expect(fb(m).flip).toHaveLength(1);
    expect(fb(m).flip[0].hidden).toBe(false);
  });

  it('gives every written frame and layer a new id', () => {
    const m = movie();
    const chart = fb(m).flip[0];
    const row = fb(applyLipsync(m, job())).flip[0];
    const old = new Set([...chart.frames.map((f) => f.id), ...chart.frames.flatMap((f) => f.layers.map((l) => l.id))]);
    const made = [...row.frames.map((f) => f.id), ...row.frames.flatMap((f) => f.layers.map((l) => l.id))];
    expect(new Set(made).size).toBe(made.length);
    expect(made.some((id) => old.has(id))).toBe(false);
  });

  it('writes over part of an existing row and keeps the frames around it', () => {
    const m = movie();
    const before = fb(m).flip[0].frames;
    const row = fb(applyLipsync(m, job({ row: 0, chartRow: -1 }))).flip[0];
    expect(holds(row)).toEqual([1, 1, 2, 1, 1, 1, 1]);
    expect(flipLength(row)).toBe(8);
    expect(row.frames.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(row.frames.slice(5)).toEqual(before.slice(6));
    expect(names(row).slice(2, 5)).toEqual([VISEME_NAMES.AI, VISEME_NAMES.O, VISEME_NAMES.rest]);
  });

  it('splits a held frame that straddles the written range', () => {
    const base = flipTrack('Two', 2);
    const two = { ...base, frames: base.frames.map((f) => ({ ...f, hold: 4 })) };
    const row = fb(applyLipsync(movie([two]), job({ row: 0, chartRow: -1, from: 11, shapes: ['rest'], map: guessMapping(two) }))).flip[0];
    expect(holds(row)).toEqual([1, 1, 2, 4]);
    expect(row.frames[3]).toBe(two.frames[1]);
    expect(new Set(row.frames.map((f) => f.id)).size).toBe(4);
  });

  it('grows the flipbook when the range runs past its end and the track has room', () => {
    const out = applyLipsync(movie(), job({ from: 16 }));
    expect(fb(out).duration).toBe(10);
    expect(flipLength(fb(out).flip[0])).toBe(10);
  });

  it('refuses to grow into the next content on the track', () => {
    const m = movie([mouthChartRow()], [content('image', 19, 5)]);
    expect(() => applyLipsync(m, job({ from: 16 }))).toThrow(OpError);
    expect(fb(applyLipsync(m, job({ from: 15 }))).duration).toBe(9);
  });

  it('refuses a range before the flipbook, an empty range and a missing row', () => {
    expect(() => applyLipsync(movie(), job({ from: 5 }))).toThrow(OpError);
    expect(() => applyLipsync(movie(), job({ shapes: [] }))).toThrow(OpError);
    expect(() => applyLipsync(movie(), job({ chartRow: 4 }))).toThrow(OpError);
    expect(() => applyLipsync(movie(), job({ row: 3, chartRow: 0 }))).toThrow(OpError);
  });

  it('refuses content that is missing or is not a flipbook', () => {
    const m = movie([mouthChartRow()], [content('image', 30, 5, { id: 'img' })]);
    expect(() => applyLipsync(m, job({ content: 'gone' }))).toThrow(OpError);
    expect(() => applyLipsync(m, job({ content: 'img' }))).toThrow(OpError);
  });
});
