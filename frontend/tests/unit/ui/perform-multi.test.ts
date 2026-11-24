import { describe, expect, it, vi } from 'vitest';
import type { Content } from '@src/engine/types';
import { followLead, makeFollowers, sampleFollowers, type PoseLike } from '@src/ui/perform-multi';

const pose = (x: number, y: number, sx = 1, sy = 1, rot = 0): PoseLike => ({ x, y, sx, sy, rot });
const block = (id: string, start: number): Content => ({ id, start } as unknown as Content);

describe('makeFollowers', () => {
  it('makes one follower per other block with its own recorder and no values yet', () => {
    const fs = makeFollowers([{ c: block('a', 10), pose: pose(1, 2) }, { c: block('b', 0), pose: pose(3, 4) }], ['x', 'y']);
    expect(fs.map((f) => [f.id, f.start, f.last])).toEqual([['a', 10, null], ['b', 0, null]]);
    expect(fs[0].base).toEqual(pose(1, 2));
    expect(fs[0].rec).not.toBe(fs[1].rec);
  });

  it('returns no followers for no other blocks', () => {
    expect(makeFollowers([], ['x'])).toEqual([]);
  });
});

describe('followLead', () => {
  it('moves each follower by the lead distance and rounds to whole pixels', () => {
    const fs = makeFollowers([{ c: block('a', 0), pose: pose(100, 50) }, { c: block('b', 0), pose: pose(-20, 0) }], ['x', 'y']);
    followLead(fs, pose(10, 10), { x: 15.4, y: 2.6 });
    expect(fs[0].last).toEqual({ x: 105, y: 43 });
    expect(fs[1].last).toEqual({ x: -15, y: -7 });
  });

  it('turns each follower by the lead change to one decimal', () => {
    const fs = makeFollowers([{ c: block('a', 0), pose: pose(0, 0, 1, 1, 30) }], ['rotation']);
    followLead(fs, pose(0, 0, 1, 1, 10), { rotation: 55.26 });
    expect(fs[0].last).toEqual({ rotation: 75.3 });
  });

  it('scales each follower by the lead ratio to three decimals', () => {
    const fs = makeFollowers([{ c: block('a', 0), pose: pose(0, 0, 0.5, 3) }], ['scaleX', 'scaleY']);
    followLead(fs, pose(0, 0, 2, 3), { scaleX: 3, scaleY: 1 });
    expect(fs[0].last).toEqual({ scaleX: 0.75, scaleY: 1 });
  });

  it('skips scaling when the lead scale is zero', () => {
    const fs = makeFollowers([{ c: block('a', 0), pose: pose(0, 0, 2, 2) }], ['scaleX', 'scaleY']);
    followLead(fs, pose(0, 0, 0, 0), { scaleX: 3, scaleY: 3 });
    expect(fs[0].last).toEqual({});
  });

  it('sets only the channels the lead changed', () => {
    const fs = makeFollowers([{ c: block('a', 0), pose: pose(5, 5) }], ['x']);
    followLead(fs, pose(0, 0), { x: 1 });
    expect(fs[0].last).toEqual({ x: 6 });
  });
});

describe('sampleFollowers', () => {
  it('adds the latest values at the frame relative to each block start', () => {
    const fs = makeFollowers([{ c: block('a', 10), pose: pose(0, 0) }, { c: block('b', 4), pose: pose(0, 0) }], ['x']);
    const addA = vi.spyOn(fs[0].rec, 'add');
    const addB = vi.spyOn(fs[1].rec, 'add');
    followLead(fs, pose(0, 0), { x: 7 });
    sampleFollowers(fs, 25);
    expect(addA).toHaveBeenCalledWith(15, { x: 7 });
    expect(addB).toHaveBeenCalledWith(21, { x: 7 });
  });

  it('adds nothing for a follower that has no values yet', () => {
    const fs = makeFollowers([{ c: block('a', 0), pose: pose(0, 0) }], ['x']);
    const add = vi.spyOn(fs[0].rec, 'add');
    sampleFollowers(fs, 5);
    expect(add).not.toHaveBeenCalled();
  });
});
