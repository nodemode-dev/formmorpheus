import { describe, expect, it } from 'vitest';
import { content, newMovie, track } from '@src/engine/model';
import * as ops from '@src/engine/ops';
import type { Content, Movie, Track } from '@src/engine/types';

const { OpError } = ops;

function build(rows: [number, number][][], duration = 200): Movie {
  return { ...newMovie(), duration, tracks: rows.map((spans, i) => track(`T${i}`, spans.map(([s, d]) => content('drawing', s, d)))) };
}

const spans = (t: Track): [number, number][] => t.content.map((c) => [c.start, c.duration]);
const idAt = (m: Movie, ti: number, ci: number): string => m.tracks[ti].content[ci].id;

describe('track edits', () => {
  it('inserts a new track at a clamped position', () => {
    const m = build([[], []]);
    const top = ops.addTrack(m, -5, 'Top');
    expect(top.movie.tracks[0]).toBe(top.track);
    expect(top.track.name).toBe('Top');
    const bottom = ops.addTrack(m, 99);
    expect(bottom.movie.tracks[2].id).toBe(bottom.track.id);
    expect(m.tracks).toHaveLength(2);
  });

  it('deletes a track and refuses an unknown one', () => {
    const m = build([[], []]);
    expect(ops.deleteTrack(m, m.tracks[0].id).tracks.map((t) => t.id)).toEqual([m.tracks[1].id]);
    expect(() => ops.deleteTrack(m, 'nope')).toThrow(OpError);
  });

  it('moves a track to a clamped index', () => {
    const m = build([[], [], []]);
    const [a, b, c] = m.tracks.map((t) => t.id);
    expect(ops.moveTrack(m, a, 99).tracks.map((t) => t.id)).toEqual([b, c, a]);
    expect(ops.moveTrack(m, c, -1).tracks.map((t) => t.id)).toEqual([c, a, b]);
    expect(() => ops.moveTrack(m, 'nope', 0)).toThrow(OpError);
  });

  it('trims and caps a track name and refuses a blank one', () => {
    const m = build([[]]);
    const id = m.tracks[0].id;
    expect(ops.renameTrack(m, id, '  Sky  ').tracks[0].name).toBe('Sky');
    expect(ops.renameTrack(m, id, 'x'.repeat(200)).tracks[0].name).toHaveLength(80);
    expect(() => ops.renameTrack(m, id, '   ')).toThrow(OpError);
  });

  it('hides all tracks and keeps the ones already in that state', () => {
    const m = build([[], []]);
    const half = ops.setTrackHidden(m, m.tracks[0].id, true);
    const all = ops.setAllHidden(half, true);
    expect(all.tracks.map((t) => t.hidden)).toEqual([true, true]);
    expect(all.tracks[0]).toBe(half.tracks[0]);
  });

  it('closes the empty section under the playhead only', () => {
    const m = build([[[0, 10], [20, 10], [50, 10]]]);
    const id = m.tracks[0].id;
    expect(spans(ops.removeEmptySection(m, id, 15).tracks[0])).toEqual([[0, 10], [10, 10], [40, 10]]);
    expect(() => ops.removeEmptySection(m, id, 5)).toThrow(OpError);
    expect(spans(ops.removeEmptySection(m, id, 100).tracks[0])).toEqual([[0, 10], [20, 10], [50, 10]]);
  });
});

describe('placing and moving content', () => {
  it('places on the asked track when it fits and on a new track when it does not', () => {
    const m = build([[[0, 10]]]);
    const tid = m.tracks[0].id;
    const fit = ops.placeContent(m, tid, content('drawing', 10, 5));
    expect(fit.trackId).toBe(tid);
    expect(spans(fit.movie.tracks[0])).toEqual([[0, 10], [10, 5]]);
    const clash = ops.placeContent(m, tid, content('drawing', 5, 5));
    expect(clash.trackId).not.toBe(tid);
    expect(clash.movie.tracks).toHaveLength(2);
    expect(spans(clash.movie.tracks[0])).toEqual([[5, 5]]);
  });

  it('moves content in time and stops the earliest at frame zero', () => {
    const m = build([[[5, 10], [20, 10]], [[0, 3]]]);
    const out = ops.moveContent(m, [idAt(m, 0, 0), idAt(m, 0, 1)], -50, 0);
    expect(spans(out.tracks[0])).toEqual([[0, 10], [15, 10]]);
    expect(out.tracks[1]).toBe(m.tracks[1]);
  });

  it('moves content to another track and refuses an overlap there', () => {
    const m = build([[[0, 10]], [[20, 10]]]);
    const id = idAt(m, 0, 0);
    const out = ops.moveContent(m, [id], 0, 1);
    expect(out.tracks[0].content).toHaveLength(0);
    expect(spans(out.tracks[1])).toEqual([[0, 10], [20, 10]]);
    expect(() => ops.moveContent(m, [id], 15, 1)).toThrow(OpError);
  });

  it('refuses to move missing content or content on or onto a locked track', () => {
    const m = build([[[0, 10]], []]);
    const id = idAt(m, 0, 0);
    expect(() => ops.moveContent(m, ['nope'], 1, 0)).toThrow(OpError);
    expect(ops.moveContent(m, [], 1, 0)).toBe(m);
    const lockedTarget = { ...m, tracks: [m.tracks[0], { ...m.tracks[1], locked: true }] };
    expect(() => ops.moveContent(lockedTarget, [id], 0, 1)).toThrow(OpError);
    const lockedHome = { ...m, tracks: [{ ...m.tracks[0], locked: true }, m.tracks[1]] };
    expect(() => ops.moveContent(lockedHome, [id], 5, 0)).toThrow(OpError);
  });
});

describe('trimming and splitting', () => {
  it('grows the end only up to the next content and never below one frame', () => {
    const m = build([[[0, 10], [15, 10]]]);
    const id = idAt(m, 0, 0);
    expect(spans(ops.trimContent(m, id, 'end', 50).tracks[0])).toEqual([[0, 15], [15, 10]]);
    expect(spans(ops.trimContent(m, id, 'end', -50).tracks[0])).toEqual([[0, 1], [15, 10]]);
  });

  it('ripples later content with an end trim', () => {
    const m = build([[[0, 10], [15, 10]]]);
    expect(spans(ops.trimContent(m, idAt(m, 0, 0), 'end', 8, true).tracks[0])).toEqual([[0, 18], [23, 10]]);
  });

  it('pulls the start back only to the previous content and forward to one frame', () => {
    const m = build([[[0, 10], [15, 10]]]);
    const id = idAt(m, 0, 1);
    expect(spans(ops.trimContent(m, id, 'start', -50).tracks[0])).toEqual([[0, 10], [10, 15]]);
    expect(spans(ops.trimContent(m, id, 'start', 50).tracks[0])).toEqual([[0, 10], [24, 1]]);
  });

  it('refuses a trim on a locked track', () => {
    const m = build([[[0, 10]]]);
    const locked = { ...m, tracks: [{ ...m.tracks[0], locked: true }] };
    expect(() => ops.trimContent(locked, idAt(m, 0, 0), 'end', 1)).toThrow(OpError);
  });

  it('splits content into two touching parts that share the source', () => {
    const m = build([[[10, 20]]]);
    const id = idAt(m, 0, 0);
    const out = ops.splitContent(m, id, 16);
    const [left, right] = out.movie.tracks[0].content;
    expect([left.id, left.start, left.duration, left.offset]).toEqual([id, 10, 6, 0]);
    expect([right.id, right.start, right.duration, right.offset]).toEqual([out.right, 16, 14, 6]);
    expect(right.id).not.toBe(id);
  });

  it('refuses a split on either edge of the content', () => {
    const m = build([[[10, 20]]]);
    const id = idAt(m, 0, 0);
    expect(() => ops.splitContent(m, id, 10)).toThrow(OpError);
    expect(() => ops.splitContent(m, id, 30)).toThrow(OpError);
  });

  it('makes the cut of a sound a hard edge and keeps the outer fades', () => {
    const sound = content('audio', 0, 20, { fadeIn: 8, fadeOut: 15 });
    const m = { ...newMovie(), tracks: [track('A', [sound])] };
    const out = ops.splitContent(m, sound.id, 5);
    const [left, right] = out.movie.tracks[0].content;
    expect(left.fadeIn).toBe(5);
    expect(left.fadeOut).toBeUndefined();
    expect(right.fadeIn).toBeUndefined();
    expect(right.fadeOut).toBe(15);
  });
});

describe('copies, fill, delete and paste', () => {
  it('duplicates onto a new track at the same time with a fresh id', () => {
    const m = build([[[4, 6]]]);
    const out = ops.duplicateContent(m, idAt(m, 0, 0));
    expect(out.movie.tracks).toHaveLength(2);
    const all = out.movie.tracks.flatMap((t) => t.content);
    expect(all.map((c) => c.start)).toEqual([4, 4]);
    expect(new Set(all.map((c) => c.id)).size).toBe(2);
    expect(all.some((c) => c.id === out.copy)).toBe(true);
  });

  it('duplicates after the content and pushes what is in the way', () => {
    const m = build([[[0, 10], [12, 5], [40, 5]]]);
    const out = ops.duplicateAfter(m, idAt(m, 0, 0));
    expect(spans(out.movie.tracks[0])).toEqual([[0, 10], [10, 10], [20, 5], [48, 5]]);
    expect(out.movie.tracks[0].content[1].id).toBe(out.copy);
  });

  it('fills the duration up to the next content or the end of the movie', () => {
    const m = build([[[0, 10], [30, 10]]], 100);
    expect(spans(ops.fillDuration(m, idAt(m, 0, 0)).tracks[0])).toEqual([[0, 30], [30, 10]]);
    expect(spans(ops.fillDuration(m, idAt(m, 0, 1)).tracks[0])).toEqual([[0, 10], [30, 70]]);
  });

  it('deletes content and refuses on a locked track', () => {
    const m = build([[[0, 10], [10, 10]], [[0, 5]]]);
    const out = ops.deleteContent(m, [idAt(m, 0, 0)]);
    expect(spans(out.tracks[0])).toEqual([[10, 10]]);
    expect(out.tracks[1]).toBe(m.tracks[1]);
    const locked = { ...m, tracks: [{ ...m.tracks[0], locked: true }, m.tracks[1]] };
    expect(() => ops.deleteContent(locked, [idAt(m, 0, 0)])).toThrow(OpError);
  });

  it('pastes copies at the frame keeping their spacing and giving new ids', () => {
    const m = build([[]]);
    const items = [content('drawing', 30, 5), content('drawing', 40, 5)];
    const out = ops.pasteContent(m, items, 100, m.tracks[0].id);
    expect(spans(out.movie.tracks[0])).toEqual([[100, 5], [110, 5]]);
    expect(out.ids).toHaveLength(2);
    expect(out.ids).not.toContain(items[0].id);
    expect(ops.pasteContent(m, [], 0, null)).toEqual({ movie: m, ids: [] });
    const locked = { ...m, tracks: [{ ...m.tracks[0], locked: true }] };
    expect(() => ops.pasteContent(locked, items, 0, m.tracks[0].id)).toThrow(OpError);
  });

  it('gives a clone new ids throughout and relinks parents inside it', () => {
    const a = content('drawing', 0, 5);
    const b = content('drawing', 0, 5, { parent: a.id });
    const outside = content('drawing', 0, 5, { parent: 'elsewhere' });
    const g = content('group', 3, 5, { tracks: [track('in', [a, b, outside])] });
    const copy = ops.cloneContent(g, 50);
    const [ca, cb, co] = copy.tracks[0].content;
    expect(copy.start).toBe(50);
    expect(copy.id).not.toBe(g.id);
    expect(ca.id).not.toBe(a.id);
    expect(cb.parent).toBe(ca.id);
    expect(co.parent).toBe('elsewhere');
    expect(g.tracks[0].content[1].parent).toBe(a.id);
  });
});

describe('grouping', () => {
  it('groups content into one block spanning it with members rebased to zero', () => {
    const m = build([[[10, 10]], [[15, 20]], [[0, 5]]]);
    const ids = [idAt(m, 0, 0), idAt(m, 1, 0)];
    const out = ops.groupContent(m, ids);
    expect(out.movie.tracks).toHaveLength(2);
    const g = out.movie.tracks[0].content[0];
    expect([g.id, g.kind, g.start, g.duration]).toEqual([out.group, 'group', 10, 25]);
    expect(g.tracks.map((t) => spans(t))).toEqual([[[0, 10]], [[5, 20]]]);
    expect(out.movie.tracks[1]).toBe(m.tracks[2]);
  });

  it('refuses an empty or unknown selection', () => {
    const m = build([[[0, 5]]]);
    expect(() => ops.groupContent(m, [])).toThrow(OpError);
    expect(() => ops.groupContent(m, ['nope'])).toThrow(OpError);
  });

  it('ungroups back to the original times and ids', () => {
    const m = build([[[10, 10]], [[15, 20]]]);
    const ids = [idAt(m, 0, 0), idAt(m, 1, 0)];
    const grouped = ops.groupContent(m, ids);
    const out = ops.ungroupContent(grouped.movie, grouped.group);
    expect(out.ids).toEqual(ids);
    expect(out.movie.tracks.map((t) => spans(t))).toEqual([[[10, 10]], [[15, 20]]]);
  });

  it('refuses to ungroup content that is not a group', () => {
    const m = build([[[0, 5]]]);
    expect(() => ops.ungroupContent(m, idAt(m, 0, 0))).toThrow(OpError);
  });
});

describe('patchContent', () => {
  it('clamps opacity and volume and merges the transform', () => {
    const m = build([[[0, 5]]]);
    const id = idAt(m, 0, 0);
    const c = ops.patchContent(m, [id], { opacity: 4, volume: -1, transform: { x: 12 } }).tracks[0].content[0];
    expect(c.opacity).toBe(1);
    expect(c.volume).toBe(0);
    expect(c.transform).toEqual({ ...m.tracks[0].content[0].transform, x: 12 });
    expect(ops.patchContent(m, [id], { opacity: -2, volume: 9 }).tracks[0].content[0]).toMatchObject({ opacity: 0, volume: 2 });
  });

  it('keeps the old name when the new one is blank', () => {
    const m = build([[[0, 5]]]);
    const id = idAt(m, 0, 0);
    const before = m.tracks[0].content[0].name;
    expect(ops.patchContent(m, [id], { name: '   ' }).tracks[0].content[0].name).toBe(before);
    expect(ops.patchContent(m, [id], { name: ' Hero ' }).tracks[0].content[0].name).toBe('Hero');
  });

  it('refuses any edit of content on a locked track', () => {
    const m = build([[[0, 5]]]);
    const locked = { ...m, tracks: [{ ...m.tracks[0], locked: true }] };
    expect(() => ops.patchContent(locked, [idAt(m, 0, 0)], { opacity: 0.5 })).toThrow(OpError);
    expect(() => ops.updateContent(m, 'nope', (c: Content) => c)).toThrow(OpError);
  });
});

describe('patchMovie', () => {
  it('retimes content when the frame rate changes so lengths in seconds hold', () => {
    const m = { ...build([[[5, 10], [15, 7]]], 100), fps: 24 };
    const out = ops.patchMovie(m, { fps: 48 });
    expect(out.fps).toBe(48);
    expect(out.duration).toBe(200);
    expect(spans(out.tracks[0])).toEqual([[10, 20], [30, 14]]);
  });

  it('keeps touching neighbours touching when the rate drops', () => {
    const m = { ...build([[[0, 5], [5, 5], [10, 5]]], 100), fps: 24 };
    const items = ops.patchMovie(m, { fps: 12 }).tracks[0].content;
    for (let i = 1; i < items.length; i++) expect(items[i].start).toBe(items[i - 1].start + items[i - 1].duration);
    expect(items.every((c) => c.duration >= 1)).toBe(true);
  });

  it('leaves every frame in place with keepFrames', () => {
    const m = { ...build([[[5, 10]]], 100), fps: 24 };
    const out = ops.patchMovie(m, { fps: 48, keepFrames: true });
    expect(out.fps).toBe(48);
    expect(out.duration).toBe(100);
    expect(out.tracks).toBe(m.tracks);
  });

  it('clamps duration, backstage and motion blur', () => {
    const m = build([]);
    expect(ops.patchMovie(m, { duration: -4 }).duration).toBe(1);
    expect(ops.patchMovie(m, { duration: 12.6 }).duration).toBe(13);
    expect(ops.patchMovie(m, { backstage: 7 }).backstage).toBe(1);
    expect(ops.patchMovie(m, { motionBlur: { on: true, shutter: 9000, samples: 0 } }).motionBlur).toEqual({ on: true, shutter: 720, samples: 2 });
    expect(ops.patchMovie(m, { motionBlur: { on: false, shutter: -3, samples: 999 } }).motionBlur).toEqual({ on: false, shutter: 0, samples: 64 });
  });

  it('keeps the name when blank and removes a blank author', () => {
    const m = { ...build([]), name: 'Film', author: 'Ana' };
    expect(ops.patchMovie(m, { name: '  ' }).name).toBe('Film');
    expect(ops.patchMovie(m, { author: ' Bo ' }).author).toBe('Bo');
    expect('author' in ops.patchMovie(m, { author: '  ' })).toBe(false);
    expect(m.author).toBe('Ana');
  });

  it('writes the timecode only when it is turned off and drops an oversized picture', () => {
    const m = build([]);
    const off = ops.patchMovie(m, { timecode: false });
    expect(off.timecode).toBe(false);
    expect('timecode' in ops.patchMovie(off, { timecode: true })).toBe(false);
    expect(ops.patchMovie(m, { authorPicture: 'data:a' }).authorPicture).toBe('data:a');
    expect('authorPicture' in ops.patchMovie(m, { authorPicture: 'x'.repeat(400000) })).toBe(false);
  });
});

describe('fitToContent', () => {
  it('sets the duration to the end of the last content and leaves an empty movie', () => {
    const m = build([[[0, 10]], [[30, 12]]]);
    expect(ops.fitToContent(m).duration).toBe(42);
    const empty = build([]);
    expect(ops.fitToContent(empty)).toBe(empty);
  });
});
