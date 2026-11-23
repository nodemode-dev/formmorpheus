import { afterEach, describe, expect, it, vi } from 'vitest';
import { History, MAX_RECOVERY, packStates, unpackStates } from '@src/engine/history';
import type { Movie } from '@src/engine/types';

const movie = (n: number): Movie => ({ n }) as unknown as Movie;
const labels = (h: History): string[] => h.past.map((s) => s.label);

function fill(h: History, count: number): void {
  for (let i = 0; i < count; i++) h.record(movie(i), `s${i}`, null);
}

describe('History undo and redo', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('');
    expect(h.redoLabel).toBe('');
    expect(h.undo(movie(0))).toBeNull();
    expect(h.redo(movie(0))).toBeNull();
  });

  it('hands back the state before the step on undo and keeps the current one for redo', () => {
    const h = new History();
    const before = movie(1);
    const after = movie(2);
    h.record(before, 'Move', null);
    expect(h.undoLabel).toBe('Move');
    const step = h.undo(after);
    expect(step?.movie).toBe(before);
    expect(step?.label).toBe('Move');
    expect(h.canUndo).toBe(false);
    expect(h.redoLabel).toBe('Move');
    const again = h.redo(before);
    expect(again?.movie).toBe(after);
    expect(h.canRedo).toBe(false);
    expect(h.past[0].movie).toBe(before);
  });

  it('walks back through several steps in reverse order', () => {
    const h = new History();
    fill(h, 3);
    expect(h.undo(movie(3))?.label).toBe('s2');
    expect(h.undo(movie(2))?.label).toBe('s1');
    expect(h.undo(movie(1))?.label).toBe('s0');
    expect(h.redo(movie(0))?.label).toBe('s0');
    expect(h.redoLabel).toBe('s1');
  });

  it('drops the redo steps when a new step is recorded', () => {
    const h = new History();
    fill(h, 2);
    h.undo(movie(9));
    h.record(movie(5), 'New', null);
    expect(h.canRedo).toBe(false);
    expect(labels(h)).toEqual(['s0', 'New']);
  });

  it('records one step for a gesture that repeats the same merge key', () => {
    const h = new History();
    h.record(movie(0), 'Drag', 'drag:a');
    h.record(movie(1), 'Drag', 'drag:a');
    h.record(movie(2), 'Drag', 'drag:a');
    expect(h.past).toHaveLength(1);
    expect(h.past[0].movie).toEqual({ n: 0 });
  });

  it('records a new step for a different merge key or after the gesture ends', () => {
    const h = new History();
    h.record(movie(0), 'Drag', 'drag:a');
    h.record(movie(1), 'Drag', 'drag:b');
    expect(h.past).toHaveLength(2);
    h.endGesture();
    h.record(movie(2), 'Drag', 'drag:b');
    expect(h.past).toHaveLength(3);
  });

  it('does not merge into a step across an undo', () => {
    const h = new History();
    h.record(movie(0), 'A', null);
    h.record(movie(1), 'Drag', 'k');
    h.undo(movie(2));
    h.record(movie(1), 'Drag', 'k');
    expect(labels(h)).toEqual(['A', 'Drag']);
  });

  it('clears both lists but keeps recovery points', () => {
    const h = new History();
    fill(h, 3);
    for (let i = 0; i < 3; i++) h.undo(movie(10 + i));
    h.record(movie(20), 'Branch', null);
    h.undo(movie(21));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.recovery).toHaveLength(1);
  });
});

describe('History depth', () => {
  it('keeps only the newest steps up to the depth', () => {
    const h = new History(3);
    fill(h, 5);
    expect(labels(h)).toEqual(['s2', 's3', 's4']);
  });

  it('treats a depth of zero as unlimited', () => {
    const h = new History(0);
    fill(h, 1200);
    expect(h.past).toHaveLength(1200);
  });

  it('trims at once when the depth is lowered', () => {
    const h = new History(100);
    fill(h, 10);
    h.setDepth(4);
    expect(labels(h)).toEqual(['s6', 's7', 's8', 's9']);
  });

  it('rounds the depth and turns a negative depth into unlimited', () => {
    const h = new History();
    h.setDepth(2.6);
    expect(h.depth).toBe(3);
    h.setDepth(-7);
    expect(h.depth).toBe(0);
    fill(h, 300);
    expect(h.past).toHaveLength(300);
  });

  it('clamps the recent share between 10 and 100 percent', () => {
    const h = new History();
    h.setRecentPercent(3);
    expect(h.recentPercent).toBe(10);
    h.setRecentPercent(250);
    expect(h.recentPercent).toBe(100);
    h.setRecentPercent(49.6);
    expect(h.recentPercent).toBe(50);
  });

  it('thins older steps but keeps the newest ones and the order when the recent share is lowered', () => {
    const h = new History(10);
    h.setRecentPercent(50);
    fill(h, 40);
    expect(h.past).toHaveLength(10);
    expect(labels(h).slice(-5)).toEqual(['s35', 's36', 's37', 's38', 's39']);
    const order = labels(h).map((l) => Number(l.slice(1)));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(10);
    expect(order[0]).toBeLessThan(30);
  });
});

describe('History shed', () => {
  it('keeps the newest undo and redo steps on a memory warning', () => {
    const h = new History();
    fill(h, 8);
    for (let i = 0; i < 4; i++) h.undo(movie(100 + i));
    h.shed(2);
    expect(labels(h)).toEqual(['s2', 's3']);
    expect(h.future.map((s) => s.label)).toEqual(['s5', 's4']);
  });

  it('ignores a shed of zero, a negative, NaN or infinity', () => {
    const h = new History();
    fill(h, 5);
    h.shed(0);
    h.shed(-3);
    h.shed(Number.NaN);
    h.shed(Number.POSITIVE_INFINITY);
    expect(h.past).toHaveLength(5);
  });
});

describe('History recovery points', () => {
  afterEach(() => { vi.useRealTimers(); });

  function branch(h: History, tag: string): Movie {
    fill(h, 3);
    const tip = movie(999);
    h.undo(tip);
    h.undo(movie(1));
    h.undo(movie(2));
    h.record(movie(3), tag, null);
    return tip;
  }

  it('saves the abandoned tip when a new step replaces three or more undone steps', () => {
    const h = new History();
    const tip = branch(h, 'Branch');
    expect(h.recovery).toHaveLength(1);
    expect(h.recovery[0].movie).toBe(tip);
    expect(h.recovery[0].label).toBe('s2');
  });

  it('saves nothing when fewer than three steps were undone', () => {
    const h = new History();
    fill(h, 3);
    h.undo(movie(7));
    h.undo(movie(8));
    h.record(movie(9), 'Branch', null);
    expect(h.recovery).toHaveLength(0);
  });

  it('keeps at most the newest recovery points, newest first', () => {
    vi.useFakeTimers();
    const h = new History();
    const tips: Movie[] = [];
    for (let i = 0; i < MAX_RECOVERY + 2; i++) {
      vi.setSystemTime(1_000_000 + i * 1000);
      tips.push(branch(h, `b${i}`));
    }
    expect(h.recovery).toHaveLength(MAX_RECOVERY);
    expect(h.recovery[0].movie).toBe(tips[tips.length - 1]);
    expect(h.recovery[0].time).toBeGreaterThan(h.recovery[1].time);
  });

  it('removes one recovery point by id and leaves the others', () => {
    vi.useFakeTimers();
    const h = new History();
    vi.setSystemTime(2_000_000);
    branch(h, 'one');
    vi.setSystemTime(2_050_000);
    branch(h, 'two');
    const [newer, older] = h.recovery;
    expect(newer.id).not.toBe(older.id);
    h.removeRecovery(older.id);
    expect(h.recovery).toEqual([newer]);
    h.removeRecovery('missing');
    expect(h.recovery).toHaveLength(1);
  });

  it('keeps a single recovery point after a memory warning', () => {
    vi.useFakeTimers();
    const h = new History();
    vi.setSystemTime(3_000_000);
    branch(h, 'one');
    vi.setSystemTime(3_050_000);
    const tip = branch(h, 'two');
    h.shed(50);
    expect(h.recovery).toHaveLength(1);
    expect(h.recovery[0].movie).toBe(tip);
  });
});

describe('packStates and unpackStates', () => {
  it('round trips nested states', () => {
    const states = [{ name: 'a', tracks: [{ id: 1, on: true, note: null }], size: [1920, 1080] }, { name: 'b', tracks: [] }];
    expect(unpackStates(packStates(states))).toEqual(states);
  });

  it('stores an object shared by several states once and restores the sharing', () => {
    const shared = { id: 't1', frames: [1, 2, 3] };
    const packed = packStates([{ tracks: [shared] }, { tracks: [shared], extra: 1 }]);
    const objects = packed.nodes.filter((n) => n[0] === 'o' && n[1].includes('frames'));
    expect(objects).toHaveLength(1);
    const [a, b] = unpackStates(packed) as { tracks: unknown[] }[];
    expect(a.tracks[0]).toBe(b.tracks[0]);
    expect(a.tracks[0]).toEqual(shared);
    expect(a.tracks[0]).not.toBe(shared);
  });

  it('survives a JSON round trip of the packed form', () => {
    const shared = { k: [0.5, 'x'] };
    const states = [{ a: shared }, { b: shared, c: { d: false } }];
    const restored = unpackStates(JSON.parse(JSON.stringify(packStates(states))));
    expect(restored).toEqual(states);
  });

  it('restores a state that refers to itself', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    const [out] = unpackStates(packStates([loop])) as Record<string, unknown>[];
    expect(out.name).toBe('loop');
    expect(out.self).toBe(out);
  });

  it('packs no states into empty lists', () => {
    const packed = packStates([]);
    expect(packed).toEqual({ nodes: [], roots: [] });
    expect(unpackStates(packed)).toEqual([]);
  });

  it('refuses packed data that points at a missing node', () => {
    expect(() => unpackStates({ nodes: [], roots: [4] })).toThrow();
    expect(() => unpackStates({ nodes: [['a', [{ r: 9 }]]], roots: [0] })).toThrow();
  });
});
