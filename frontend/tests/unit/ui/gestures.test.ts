import { describe, expect, it } from 'vitest';
import { MultiTouch, type EndInfo, type PinchInfo } from '@src/ui/gestures';

type Log = { begins: [number, number, number][]; changes: PinchInfo[]; ends: EndInfo[] };

const make = (): { mt: MultiTouch; log: Log } => {
  const log: Log = { begins: [], changes: [], ends: [] };
  const mt = new MultiTouch({
    begin: (n, cx, cy) => { log.begins.push([n, cx, cy]); },
    change: (i) => { log.changes.push(i); },
    end: (i) => { log.ends.push(i); },
  });
  return { mt, log };
};

const two = (t = 0): { mt: MultiTouch; log: Log } => {
  const r = make();
  r.mt.down(1, 0, 0, t);
  r.mt.down(2, 100, 0, t);
  return r;
};

describe('MultiTouch', () => {
  it('does not start a gesture with one finger', () => {
    const { mt, log } = make();
    mt.down(1, 10, 10, 0);
    mt.move(1, 200, 200);
    expect(mt.active).toBe(false);
    expect(mt.count).toBe(1);
    expect(log.begins).toEqual([]);
    expect(log.changes).toEqual([]);
  });

  it('begins at the middle of two fingers', () => {
    const { mt, log } = two();
    expect(mt.active).toBe(true);
    expect(log.begins).toEqual([[2, 50, 0]]);
  });

  it('reports nothing while the fingers stay inside the dead zone', () => {
    const { mt, log } = two();
    mt.move(2, 105, 0);
    mt.move(1, 3, 2);
    expect(log.changes).toEqual([]);
  });

  it('reports the spread ratio and the travel of the middle once past the dead zone', () => {
    const { mt, log } = two();
    mt.move(2, 200, 0);
    expect(log.changes).toHaveLength(1);
    const c = log.changes[0];
    expect(c.fingers).toBe(2);
    expect(c.k).toBeCloseTo(2);
    expect(c.cx).toBeCloseTo(100);
    expect(c.dx).toBeCloseTo(50);
    expect(c.dy).toBeCloseTo(0);
    expect(c.rot).toBeCloseTo(0);
  });

  it('keeps reporting small moves after the gesture has moved', () => {
    const { mt, log } = two();
    mt.move(2, 200, 0);
    mt.move(2, 201, 0);
    expect(log.changes).toHaveLength(2);
    expect(log.changes[1].k).toBeCloseTo(2.01);
  });

  it('reports a quarter turn of two fingers', () => {
    const { mt, log } = two();
    mt.move(2, 0, 100);
    const c = log.changes[0];
    expect(c.rot).toBeCloseTo(Math.PI / 2);
    expect(c.k).toBeCloseTo(1);
    expect(c.dx).toBeCloseTo(-50);
    expect(c.dy).toBeCloseTo(50);
  });

  it('wraps the turn across the half circle instead of jumping a full circle', () => {
    const { mt, log } = make();
    mt.down(1, 0, 0, 0);
    mt.down(2, -100, 1, 0);
    mt.move(2, -100, -30);
    expect(log.changes).toHaveLength(1);
    const expected = Math.atan2(-30, -100) - Math.atan2(1, -100) + 2 * Math.PI;
    expect(log.changes[0].rot).toBeCloseTo(expected);
    expect(Math.abs(log.changes[0].rot)).toBeLessThan(Math.PI);
  });

  it('rebases when a third finger lands and reports no turn for three fingers', () => {
    const { mt, log } = two();
    mt.down(3, 50, 90, 10);
    expect(log.begins).toHaveLength(2);
    expect(log.begins[1][0]).toBe(3);
    mt.move(1, 0, 60);
    mt.move(2, 100, 60);
    mt.move(3, 50, 150);
    const last = log.changes[log.changes.length - 1];
    expect(last.fingers).toBe(3);
    expect(last.rot).toBe(0);
    expect(last.dy).toBeCloseTo(60);
  });

  it('ends a two finger tap once every finger is up', () => {
    const { mt, log } = two(1000);
    mt.up(2, 1080);
    expect(log.ends).toEqual([]);
    expect(mt.active).toBe(true);
    mt.up(1, 1100);
    expect(mt.active).toBe(false);
    expect(log.ends).toEqual([{ fingers: 2, moved: false, ms: 100, quickIn: false }]);
  });

  it('remembers the largest finger count for the end', () => {
    const { mt, log } = two(0);
    mt.down(3, 50, 90, 10);
    mt.up(3, 50);
    mt.up(2, 60);
    mt.up(1, 70);
    expect(log.ends).toEqual([{ fingers: 3, moved: false, ms: 70, quickIn: false }]);
  });

  it('flags a quick pinch in', () => {
    const { mt, log } = two(1000);
    mt.move(2, 40, 0);
    mt.up(2, 1200);
    mt.up(1, 1200);
    expect(log.ends[0]).toEqual({ fingers: 2, moved: true, ms: 200, quickIn: true });
  });

  it('does not flag a slow pinch in or a quick pinch out', () => {
    const slow = two(1000);
    slow.mt.move(2, 40, 0);
    slow.mt.up(2, 1400);
    slow.mt.up(1, 1400);
    expect(slow.log.ends[0].quickIn).toBe(false);
    const out = two(1000);
    out.mt.move(2, 300, 0);
    out.mt.up(2, 1100);
    out.mt.up(1, 1100);
    expect(out.log.ends[0].quickIn).toBe(false);
  });

  it('ignores moves and lifts of pointers it never saw', () => {
    const { mt, log } = two();
    mt.move(9, 500, 500);
    mt.up(9, 50);
    expect(log.changes).toEqual([]);
    expect(log.ends).toEqual([]);
    expect(mt.count).toBe(2);
  });

  it('reset drops the gesture without an end', () => {
    const { mt, log } = two();
    mt.reset();
    expect(mt.active).toBe(false);
    expect(mt.count).toBe(0);
    mt.up(1, 100);
    mt.up(2, 100);
    expect(log.ends).toEqual([]);
  });
});
