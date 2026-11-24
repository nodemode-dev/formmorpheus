import { describe, expect, it } from 'vitest';
import {
  MIN_TRANSITION, TRANSITION_KINDS, anyTransitionAt, defaultTransition, halves, previousOf, tracksHaveTransition,
  transitionAt, windowOf,
} from '@src/engine/transitions';
import { content, track } from '@src/engine/model';
import type { Content, Transition } from '@src/engine/types';

function pair(duration = 4, kind: Transition['kind'] = 'crossfade'): { a: Content; b: Content; items: Content[] } {
  const a = content('solid', 0, 10);
  const b = content('solid', 10, 10, { transition: { kind, duration } });
  return { a, b, items: [a, b] };
}

describe('halves', () => {
  it('splits an even length in two equal parts', () => {
    expect(halves({ kind: 'crossfade', duration: 4 })).toEqual([2, 2]);
  });

  it('gives the extra frame of an odd length to the incoming side', () => {
    expect(halves({ kind: 'crossfade', duration: 5 })).toEqual([2, 3]);
  });

  it('rounds a fractional length and never goes below the minimum', () => {
    expect(halves({ kind: 'crossfade', duration: 2.6 })).toEqual([1, 2]);
    expect(halves({ kind: 'crossfade', duration: 0 })).toEqual([1, 1]);
    expect(halves({ kind: 'crossfade', duration: -9 })).toEqual([1, 1]);
    expect(MIN_TRANSITION).toBe(2);
  });
});

describe('previousOf', () => {
  it('finds the block that ends where the given block starts', () => {
    const { a, b, items } = pair();
    expect(previousOf(items, b)).toBe(a);
    expect(previousOf(items, a)).toBeNull();
  });

  it('finds nothing across a gap', () => {
    const a = content('solid', 0, 9);
    const b = content('solid', 10, 10);
    expect(previousOf([a, b], b)).toBeNull();
  });
});

describe('transitionAt', () => {
  it('is live only inside the window around the cut', () => {
    const { items } = pair(4);
    expect(transitionAt(items, 7)).toBeNull();
    expect(transitionAt(items, 8)).not.toBeNull();
    expect(transitionAt(items, 11)).not.toBeNull();
    expect(transitionAt(items, 12)).toBeNull();
  });

  it('reports both blocks, their local frames and the progress', () => {
    const { a, b, items } = pair(4);
    const first = transitionAt(items, 8);
    expect(first?.a).toBe(a);
    expect(first?.b).toBe(b);
    expect(first?.tr).toBe(b.transition);
    expect(first?.aLocal).toBe(8);
    expect(first?.bLocal).toBe(0);
    expect(first?.p).toBeCloseTo(1 / 5, 9);
    const last = transitionAt(items, 11);
    expect(last?.aLocal).toBe(9);
    expect(last?.bLocal).toBe(1);
    expect(last?.p).toBeCloseTo(4 / 5, 9);
  });

  it('keeps progress strictly between the ends and rising', () => {
    const { items } = pair(7);
    let prev = 0;
    let seen = 0;
    for (let f = 0; f < 20; f++) {
      const t = transitionAt(items, f);
      if (!t) continue;
      seen++;
      expect(t.p).toBeGreaterThan(prev);
      expect(t.p).toBeLessThan(1);
      prev = t.p;
    }
    expect(seen).toBe(7);
  });

  it('needs a block that touches the start', () => {
    const a = content('solid', 0, 8);
    const b = content('solid', 10, 10, { transition: { kind: 'wipe', duration: 4 } });
    expect(transitionAt([a, b], 10)).toBeNull();
    expect(anyTransitionAt([a, b], 10)).toBe(false);
  });

  it('does not run before a short outgoing block exists', () => {
    const a = content('solid', 9, 1);
    const b = content('solid', 10, 10, { transition: { kind: 'crossfade', duration: 6 } });
    expect(transitionAt([a, b], 8)).toBeNull();
    expect(transitionAt([a, b], 9)?.aLocal).toBe(0);
  });

  it('does not run after a short incoming block has ended', () => {
    const a = content('solid', 0, 10);
    const b = content('solid', 10, 1, { transition: { kind: 'crossfade', duration: 6 } });
    expect(transitionAt([a, b], 10)?.bLocal).toBe(0);
    expect(transitionAt([a, b], 11)).toBeNull();
  });

  it('answers the yes or no question the same way', () => {
    const { items } = pair(4);
    expect(anyTransitionAt(items, 9)).toBe(true);
    expect(anyTransitionAt(items, 3)).toBe(false);
    expect(anyTransitionAt([], 0)).toBe(false);
  });
});

describe('tracksHaveTransition', () => {
  it('sees a running transition on a shown track only', () => {
    const t = track('T', pair(4).items);
    expect(tracksHaveTransition([t], 9)).toBe(true);
    expect(tracksHaveTransition([t], 2)).toBe(false);
    expect(tracksHaveTransition([{ ...t, hidden: true }], 9)).toBe(false);
  });

  it('looks inside a group at the group local frame', () => {
    const group = content('group', 20, 30, { tracks: [track('inner', pair(4).items)] });
    const t = track('T', [group]);
    expect(tracksHaveTransition([t], 29)).toBe(true);
    expect(tracksHaveTransition([t], 9)).toBe(false);
    expect(tracksHaveTransition([t], 40)).toBe(false);
  });

  it('ignores a group whose span does not cover the frame', () => {
    const group = content('group', 20, 5, { tracks: [track('inner', pair(4).items)] });
    expect(tracksHaveTransition([track('T', [group])], 29)).toBe(false);
  });
});

describe('defaults and windows', () => {
  it('makes a half second transition with the extras each kind needs', () => {
    expect(defaultTransition('crossfade', 24)).toEqual({ kind: 'crossfade', duration: 12 });
    expect(defaultTransition('dip', 30)).toEqual({ kind: 'dip', duration: 15, color: '#000000' });
    expect(defaultTransition('wipe', 24)).toEqual({ kind: 'wipe', duration: 12, dir: 'l' });
    expect(defaultTransition('push', 25)).toEqual({ kind: 'push', duration: 13, dir: 'l' });
  });

  it('never makes a default shorter than the minimum', () => {
    expect(defaultTransition('crossfade', 1).duration).toBe(MIN_TRANSITION);
    expect(defaultTransition('wipe', 0).duration).toBe(MIN_TRANSITION);
  });

  it('lists each kind once and every listed kind has a default', () => {
    const ids = TRANSITION_KINDS.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(defaultTransition(id, 24).kind).toBe(id);
  });

  it('gives the window a transition covers, or nothing without one', () => {
    const { a, b } = pair(5);
    expect(windowOf(a)).toBeNull();
    expect(windowOf(b)).toEqual({ from: 8, to: 13 });
  });

  it('agrees with transitionAt about where the window starts and stops', () => {
    const { b, items } = pair(5);
    const w = windowOf(b) as { from: number; to: number };
    expect(transitionAt(items, w.from - 1)).toBeNull();
    expect(transitionAt(items, w.from)).not.toBeNull();
    expect(transitionAt(items, w.to - 1)).not.toBeNull();
    expect(transitionAt(items, w.to)).toBeNull();
  });
});
