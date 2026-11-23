import { describe, expect, it } from 'vitest';
import {
  deleteFrame, deleteFrames, duplicateFrame, fillFrame, flipDuration, flipFrames, insertFrame, isBlank, pasteIntoFree, setHold, setHolds,
  splitFrame, type FrameRef,
} from '@src/engine/flip-ops';
import {
  blanksBetween, cycleFrames, inbetweenOnion, nudgeFrame, reverseAppend, setLabel, setNote, setShoot, setUnderlay, shootOn,
} from '@src/engine/flip-time';
import { flipTrack } from '@src/engine/model';
import { OpError } from '@src/engine/ops';
import type { Content, FlipTrack, FlipUnderlay, FlipbookFrame, OnionSettings } from '@src/engine/types';

const drawn = (f: FlipbookFrame): FlipbookFrame => ({ ...f, layers: f.layers.map((l) => ({ ...l, pixels: 'ink' })) }) as unknown as FlipbookFrame;

function book(holds: number[], duration = 0): Content {
  const t = flipTrack('A', holds.length);
  const row: FlipTrack = { ...t, frames: t.frames.map((f, i) => ({ ...drawn(f), hold: holds[i], name: `n${i}` })) };
  const total = holds.reduce((s, h) => s + h, 0);
  return { id: 'c', kind: 'flipbook', start: 0, duration: duration || total, flip: [row], keys: [], onion: null } as unknown as Content;
}
const row = (c: Content): FlipbookFrame[] => c.flip[0].frames;
const holds = (c: Content): number[] => row(c).map((f) => f.hold);
const names = (c: Content): (string | undefined)[] => row(c).map((f) => f.name);
const pick = (c: Content, ...at: number[]): FrameRef[] => [{ track: c.flip[0].id, frames: at.map((i) => row(c)[i].id) }];
const notBook = (): Content => ({ ...book([1]), kind: 'shape' }) as unknown as Content;

describe('flipbook frame edits', () => {
  it('measures the longest row as the sum of its holds', () => {
    const c = book([1, 2, 3]);
    const longer = { ...c, flip: [c.flip[0], { ...flipTrack('B', 9) }] };
    expect(flipDuration(c)).toBe(6);
    expect(flipDuration(longer)).toBe(9);
  });

  it('inserts a blank frame after the given one and grows the content', () => {
    const out = insertFrame(book([1, 2]), 0, 0);
    expect(holds(out)).toEqual([1, 1, 2]);
    expect(isBlank(row(out)[1])).toBe(true);
    expect(out.duration).toBe(4);
  });

  it('duplicates a frame with a fresh id and the same hold', () => {
    const c = book([2, 5]);
    const out = duplicateFrame(c, 0, 1);
    expect(holds(out)).toEqual([2, 5, 5]);
    expect(row(out)[2].id).not.toBe(row(out)[1].id);
    expect(row(out)[2].layers[0].id).not.toBe(row(out)[1].layers[0].id);
    expect(holds(duplicateFrame(c, 0, 9))).toEqual([2, 5]);
  });

  it('never deletes the last frame of a row but blanks it', () => {
    expect(holds(deleteFrame(book([1, 2, 3]), 0, 1))).toEqual([1, 3]);
    const last = deleteFrame(book([4]), 0, 0);
    expect(row(last)).toHaveLength(1);
    expect(isBlank(row(last)[0])).toBe(true);
  });

  it('clamps and rounds a hold and never shrinks the content', () => {
    const c = book([1, 1], 10);
    expect(holds(setHold(c, 0, 0, 0))).toEqual([1, 1]);
    expect(holds(setHold(c, 0, 0, 5000))).toEqual([999, 1]);
    expect(holds(setHold(c, 0, 1, 2.6))).toEqual([1, 3]);
    expect(setHold(c, 0, 1, 3).duration).toBe(10);
    expect(setHold(c, 0, 1, 30).duration).toBe(31);
  });

  it('refuses content that is not a flipbook and a row that is gone', () => {
    expect(() => setHold(notBook(), 0, 0, 2)).toThrow(OpError);
    expect(() => insertFrame(book([1]), 3, 0)).toThrow(OpError);
  });

  it('splits a hold in two parts that add up to it', () => {
    const c = book([5]);
    expect(holds(splitFrame(c, 0, 0, 2))).toEqual([2, 3]);
    expect(holds(splitFrame(c, 0, 0, 99))).toEqual([4, 1]);
    expect(holds(splitFrame(c, 0, 0, -4))).toEqual([1, 4]);
    expect(holds(splitFrame(book([1, 3]), 0, 0, 1))).toEqual([1, 3]);
  });

  it('sets the holds of the named frames absolutely or by a change', () => {
    const c = book([1, 2, 3]);
    expect(holds(setHolds(c, pick(c, 0, 2), 4))).toEqual([4, 2, 4]);
    expect(holds(setHolds(c, pick(c, 1, 2), -5, true))).toEqual([1, 1, 1]);
    expect(holds(setHolds(c, pick(c, 1), 2, true))).toEqual([1, 4, 3]);
    expect(setHolds(c, [{ track: 'missing', frames: ['x'] }], 9)).toBe(c);
  });

  it('leaves one blank frame when every frame of a row is deleted', () => {
    const c = book([3, 2]);
    expect(names(deleteFrames(c, pick(c, 0)))).toEqual(['n1']);
    const empty = deleteFrames(c, pick(c, 0, 1));
    expect(holds(empty)).toEqual([1]);
    expect(isBlank(row(empty)[0])).toBe(true);
  });

  it('reverses the named frames in their own slots', () => {
    const c = book([1, 2, 3, 4]);
    const out = flipFrames(c, pick(c, 0, 2, 3));
    expect(names(out)).toEqual(['n3', 'n1', 'n2', 'n0']);
    expect(holds(out)).toEqual([4, 2, 3, 1]);
  });

  it('pastes into blank frames first and then onto the end without shifting', () => {
    const c = insertFrame(book([1, 1]), 0, 0);
    const items = row(book([7, 8]));
    const out = pasteIntoFree(c, 0, 0, items);
    expect(holds(out)).toEqual([1, 7, 1, 8]);
    expect(names(out)).toEqual(['n0', 'n0', 'n1', 'n1']);
  });

  it('extends a frame over blank frames up to the next drawing', () => {
    let c = book([1, 1]);
    c = insertFrame(insertFrame(c, 0, 0), 0, 0);
    c = setHold(c, 0, 2, 2);
    const out = fillFrame(c, 0, 0);
    expect(holds(out)).toEqual([4, 1]);
    expect(names(out)).toEqual(['n0', 'n1']);
  });

  it('extends the last drawing to the end of the content', () => {
    const c = insertFrame(insertFrame(book([1]), 0, 0), 0, 0);
    const out = fillFrame(c, 0, 0);
    expect(holds(out)).toEqual([3]);
    expect(out.duration).toBe(3);
  });
});

describe('flipbook timing', () => {
  it('shoots the named frames on a hold between one and eight', () => {
    const c = book([1, 1, 1]);
    expect(holds(shootOn(c, pick(c, 0, 1), 2))).toEqual([2, 2, 1]);
    expect(holds(shootOn(c, pick(c, 0), 20))).toEqual([8, 1, 1]);
    expect(holds(shootOn(c, pick(c, 0), 0))).toEqual([1, 1, 1]);
    expect(shootOn(c, pick(c, 0, 1, 2), 3).duration).toBe(9);
  });

  it('stores a default hold for new frames and clears it at one', () => {
    const twos = setShoot(book([1]), 0, 2.2);
    expect(twos.flip[0].shoot).toBe(2);
    expect(holds(insertFrame(twos, 0, 0))).toEqual([1, 2]);
    expect('shoot' in setShoot(twos, 0, 1).flip[0]).toBe(false);
    expect(setShoot(twos, 0, 99).flip[0].shoot).toBe(8);
    expect(() => setShoot(twos, 4, 2)).toThrow(OpError);
  });

  it('appends the named frames in reverse after the last of them', () => {
    const c = book([1, 2, 3, 9]);
    const out = reverseAppend(c, pick(c, 0, 1, 2));
    expect(holds(out)).toEqual([1, 2, 3, 3, 2, 1, 9]);
    expect(new Set(row(out).map((f) => f.id)).size).toBe(7);
    expect(out.duration).toBe(21);
  });

  it('leaves out the turning frames of a ping-pong when asked', () => {
    const c = book([1, 2, 3]);
    expect(holds(reverseAppend(c, pick(c, 0, 1, 2), true))).toEqual([1, 2, 3, 2]);
    expect(holds(reverseAppend(c, pick(c, 0, 1), true))).toEqual([1, 2, 3]);
  });

  it('repeats the named frames so they play the asked number of times', () => {
    const c = book([1, 2, 9]);
    const out = cycleFrames(c, pick(c, 0, 1), 3);
    expect(holds(out)).toEqual([1, 2, 1, 2, 1, 2, 9]);
    expect(names(out)).toEqual(['n0', 'n1', 'n0', 'n1', 'n0', 'n1', 'n2']);
  });

  it('does nothing for one repeat and caps the repeats at ninety nine', () => {
    const c = book([1]);
    expect(cycleFrames(c, pick(c, 0), 1)).toBe(c);
    expect(cycleFrames(c, pick(c, 0), -4)).toBe(c);
    expect(row(cycleFrames(c, pick(c, 0), 5000))).toHaveLength(99);
  });

  it('puts a blank frame between the named frames with the hold of the one before', () => {
    const c = book([1, 2, 3]);
    const out = blanksBetween(c, pick(c, 0, 1, 2));
    expect(holds(out)).toEqual([1, 1, 2, 2, 3]);
    expect(row(out).map(isBlank)).toEqual([false, true, false, true, false]);
  });

  it('puts a blank frame after a single named frame', () => {
    const c = book([4, 1]);
    const out = blanksBetween(c, pick(c, 0));
    expect(holds(out)).toEqual([4, 4, 1]);
    expect(isBlank(row(out)[1])).toBe(true);
  });

  it('nudges a frame one place and stops at the ends of the row', () => {
    const c = book([1, 2, 3]);
    expect(names(nudgeFrame(c, 0, 0, 1))).toEqual(['n1', 'n0', 'n2']);
    expect(names(nudgeFrame(c, 0, 2, -1))).toEqual(['n0', 'n2', 'n1']);
    expect(names(nudgeFrame(c, 0, 0, -1))).toEqual(['n0', 'n1', 'n2']);
    expect(names(nudgeFrame(c, 0, 2, 1))).toEqual(['n0', 'n1', 'n2']);
    expect(names(nudgeFrame(c, 0, 7, 1))).toEqual(['n0', 'n1', 'n2']);
  });

  it('trims a note and a label and removes them when empty', () => {
    const c = book([1, 1]);
    const noted = setNote(c, 0, 1, '  blink here ');
    expect(row(noted)[1].note).toBe('blink here');
    expect(row(noted)[0].note).toBeUndefined();
    expect('note' in row(setNote(noted, 0, 1, '   '))[1]).toBe(false);
    expect(row(setLabel(c, 0, 0, ' AH '))[0].name).toBe('AH');
    expect('name' in row(setLabel(c, 0, 0, ''))[0]).toBe(false);
  });

  it('sets and removes the underlay and refuses other content', () => {
    const u = { asset: 'a1', visible: true, opacity: 0.5, x: 0, y: 0, scale: 1, offset: 0 } as FlipUnderlay;
    const withIt = setUnderlay(book([1]), u);
    expect(withIt.underlay).toBe(u);
    expect('underlay' in setUnderlay(withIt, null)).toBe(false);
    expect(() => setUnderlay(notBook(), u)).toThrow(OpError);
  });

  it('gives the flipbook the inbetweening onion preset without per-side overrides', () => {
    const base = { enabled: false, backFrames: 4, foreFrames: 0, opacity: 0.2, tint: false, backOpacity: 0.9, foreTint: true, step: 3 } as unknown as OnionSettings;
    const c = book([1]);
    const o = inbetweenOnion(c, base).onion as OnionSettings & { step: number };
    expect(o.enabled).toBe(true);
    expect(o.backFrames).toBe(1);
    expect(o.foreFrames).toBe(1);
    expect(o.step).toBe(3);
    expect('backOpacity' in o).toBe(false);
    expect('foreTint' in o).toBe(false);
    expect(c.onion).toBeNull();
    expect(base.backFrames).toBe(4);
  });
});
