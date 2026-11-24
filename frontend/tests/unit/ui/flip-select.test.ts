import { describe, expect, it } from 'vitest';
import { FlipSelect, loopContains, pathTouches } from '@src/ui/flip-select';
import type { Content } from '@src/engine/types';

type Row = { id: string; frames: [string, number][] };

const content = (rows: Row[]): Content =>
  ({ flip: rows.map((r) => ({ id: r.id, frames: r.frames.map(([id, hold]) => ({ id, hold })) })) }) as unknown as Content;

const sheet = (): Content =>
  content([
    { id: 'A', frames: [['a1', 1], ['a2', 2], ['a3', 1], ['a4', 1]] },
    { id: 'B', frames: [['b1', 2], ['b2', 2], ['b3', 1]] },
    { id: 'C', frames: [['c1', 5]] },
  ]);

const sorted = (s: FlipSelect): { track: string; frames: string[] }[] =>
  s.refs().map((r) => ({ track: r.track, frames: [...r.frames].sort() })).sort((x, y) => x.track.localeCompare(y.track));

describe('FlipSelect basics', () => {
  it('starts empty and clear reports that nothing changed', () => {
    const s = new FlipSelect();
    expect(s.count).toBe(0);
    expect(s.refs()).toEqual([]);
    expect(s.clear()).toBe(false);
  });

  it('adds frames across tracks, counts them and sets the anchor', () => {
    const s = new FlipSelect();
    s.add('A', 'a1');
    s.add('A', 'a1');
    s.add('B', 'b2');
    expect(s.count).toBe(2);
    expect(s.has('A', 'a1')).toBe(true);
    expect(s.has('B', 'a1')).toBe(false);
    expect(s.anchor).toEqual({ track: 'B', frame: 'b2' });
  });

  it('toggle removes a selected frame and drops the emptied track from refs', () => {
    const s = new FlipSelect();
    s.toggle('A', 'a1');
    s.toggle('B', 'b1');
    s.toggle('A', 'a1');
    expect(s.has('A', 'a1')).toBe(false);
    expect(s.refs()).toEqual([{ track: 'B', frames: ['b1'] }]);
    expect(s.anchor).toEqual({ track: 'A', frame: 'a1' });
  });

  it('set replaces the selection and ignores refs with no frames', () => {
    const s = new FlipSelect();
    s.add('A', 'a1');
    s.set([{ track: 'B', frames: ['b1', 'b2'] }, { track: 'C', frames: [] }]);
    expect(s.has('A', 'a1')).toBe(false);
    expect(sorted(s)).toEqual([{ track: 'B', frames: ['b1', 'b2'] }]);
    s.set([]);
    expect(s.count).toBe(0);
  });
});

describe('FlipSelect reload', () => {
  it('brings back the selection that clear removed', () => {
    const s = new FlipSelect();
    s.add('A', 'a1');
    s.add('B', 'b3');
    expect(s.clear()).toBe(true);
    expect(s.count).toBe(0);
    expect(s.reload(sheet())).toBe(true);
    expect(sorted(s)).toEqual([{ track: 'A', frames: ['a1'] }, { track: 'B', frames: ['b3'] }]);
  });

  it('brings back the selection that set replaced', () => {
    const s = new FlipSelect();
    s.add('A', 'a2');
    s.set([{ track: 'C', frames: ['c1'] }]);
    expect(s.reload(sheet())).toBe(true);
    expect(sorted(s)).toEqual([{ track: 'A', frames: ['a2'] }]);
  });

  it('drops frames that no longer exist and refuses when none survive', () => {
    const s = new FlipSelect();
    s.add('A', 'a1');
    s.add('A', 'gone');
    s.clear();
    expect(s.reload(sheet())).toBe(true);
    expect(sorted(s)).toEqual([{ track: 'A', frames: ['a1'] }]);
    const t = new FlipSelect();
    t.add('Z', 'z1');
    t.clear();
    expect(t.reload(sheet())).toBe(false);
    expect(t.count).toBe(0);
  });

  it('has nothing to reload before any selection was replaced', () => {
    expect(new FlipSelect().reload(sheet())).toBe(false);
  });
});

describe('FlipSelect range', () => {
  it('without an anchor selects only the clicked frame and anchors it', () => {
    const s = new FlipSelect();
    s.range(sheet(), 'A', 'a3');
    expect(s.refs()).toEqual([{ track: 'A', frames: ['a3'] }]);
    expect(s.anchor).toEqual({ track: 'A', frame: 'a3' });
  });

  it('selects every frame between the anchor and the click on one row', () => {
    const s = new FlipSelect();
    s.add('A', 'a2');
    s.range(sheet(), 'A', 'a3');
    expect(sorted(s)).toEqual([{ track: 'A', frames: ['a2', 'a3'] }]);
  });

  it('works backwards from the anchor too', () => {
    const s = new FlipSelect();
    s.add('A', 'a4');
    s.range(sheet(), 'A', 'a2');
    expect(sorted(s)).toEqual([{ track: 'A', frames: ['a2', 'a3', 'a4'] }]);
  });

  it('covers the time span on every row between the anchor row and the clicked row', () => {
    const s = new FlipSelect();
    s.add('B', 'b2');
    s.range(sheet(), 'A', 'a1');
    expect(sorted(s)).toEqual([
      { track: 'A', frames: ['a1', 'a2', 'a3'] },
      { track: 'B', frames: ['b1', 'b2'] },
    ]);
    expect(s.anchor).toEqual({ track: 'B', frame: 'b2' });
  });

  it('includes rows in the middle that hold one long frame', () => {
    const s = new FlipSelect();
    s.add('A', 'a4');
    s.range(sheet(), 'C', 'c1');
    expect(sorted(s)).toEqual([
      { track: 'A', frames: ['a1', 'a2', 'a3', 'a4'] },
      { track: 'B', frames: ['b1', 'b2', 'b3'] },
      { track: 'C', frames: ['c1'] },
    ]);
  });

  it('counts a hold of zero as one frame of time', () => {
    const c = content([{ id: 'D', frames: [['d1', 0], ['d2', 0], ['d3', 0], ['d4', 0]] }]);
    const s = new FlipSelect();
    s.add('D', 'd1');
    s.range(c, 'D', 'd3');
    expect(sorted(s)).toEqual([{ track: 'D', frames: ['d1', 'd2', 'd3'] }]);
  });

  it('leaves the selection alone when the clicked frame is unknown', () => {
    const s = new FlipSelect();
    s.add('A', 'a1');
    s.range(sheet(), 'A', 'nope');
    expect(s.refs()).toEqual([{ track: 'A', frames: ['a1'] }]);
  });
});

describe('FlipSelect prune', () => {
  it('follows a frame that moved to another row and drops a vanished one', () => {
    const s = new FlipSelect();
    s.add('A', 'a1');
    s.add('A', 'a2');
    const moved = content([
      { id: 'A', frames: [['a3', 1]] },
      { id: 'B', frames: [['b1', 1], ['a1', 1]] },
    ]);
    expect(s.prune(moved)).toBe(true);
    expect(s.refs()).toEqual([{ track: 'B', frames: ['a1'] }]);
    expect(s.prune(moved)).toBe(false);
  });

  it('reports no change when every selected frame is still in place', () => {
    const s = new FlipSelect();
    s.add('B', 'b1');
    expect(s.prune(sheet())).toBe(false);
    expect(s.count).toBe(1);
  });

  it('empties a track whose row was deleted', () => {
    const s = new FlipSelect();
    s.add('Z', 'z1');
    expect(s.prune(sheet())).toBe(true);
    expect(s.count).toBe(0);
  });
});

describe('loopContains', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it('finds a point inside a closed loop', () => {
    expect(loopContains(square, 5, 5)).toBe(true);
  });

  it('refuses points outside the loop', () => {
    expect(loopContains(square, 15, 5)).toBe(false);
    expect(loopContains(square, 5, -1)).toBe(false);
  });

  it('treats the notch of a concave loop as outside', () => {
    const u = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 20, y: 30 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }];
    expect(loopContains(u, 15, 20)).toBe(false);
    expect(loopContains(u, 5, 20)).toBe(true);
    expect(loopContains(u, 25, 20)).toBe(true);
  });

  it('never contains anything with fewer than three points', () => {
    expect(loopContains([], 0, 0)).toBe(false);
    expect(loopContains([{ x: 0, y: 0 }, { x: 10, y: 10 }], 5, 5)).toBe(false);
  });
});

describe('pathTouches', () => {
  const box = { left: 10, right: 12, top: 10, bottom: 12 };

  it('counts a fast flick whose ends both lie outside the box', () => {
    expect(pathTouches([{ x: 0, y: 11 }, { x: 100, y: 11 }], box)).toBe(true);
  });

  it('misses a line that passes beside the box', () => {
    expect(pathTouches([{ x: 0, y: 0 }, { x: 100, y: 0 }], box)).toBe(false);
  });

  it('counts a single point that lands on the box edge', () => {
    expect(pathTouches([{ x: 12, y: 10 }], box)).toBe(true);
  });

  it('touches nothing with an empty path', () => {
    expect(pathTouches([], box)).toBe(false);
  });
});
