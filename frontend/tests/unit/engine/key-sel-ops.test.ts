import { describe, expect, it } from 'vitest';
import { copyRefs, deleteRefs, pasteClips, refKey, reverseRefs, type KeyRef } from '@src/engine/key-sel-ops';
import { laneFrames, laneOf } from '@src/engine/keys';
import { content } from '@src/engine/model';
import type { Content, Key, KeyKind, KeyLane } from '@src/engine/types';

const k = (frame: number, value: number): Key => ({ frame, value, ease: 'linear' });
const lane = (kind: KeyKind, channels: Record<string, Key[]>): KeyLane => ({ kind, expanded: false, channels, options: {} });

function sample(): Content {
  return content('image', 0, 100, { keys: [
    lane('move', { x: [k(0, 1), k(10, 2), k(20, 3), k(30, 4)], y: [k(10, 50), k(30, 70)] }),
    lane('volume', { level: [k(5, 0.1), k(20, 0.9)] }),
  ] });
}

const frames = (c: Content, kind: KeyKind, channel?: string): number[] => {
  const l = laneOf(c, kind);
  return l ? laneFrames(l, channel) : [];
};
const values = (c: Content, kind: KeyKind, channel: string): [number, number][] =>
  (laneOf(c, kind)?.channels[channel] ?? []).map((q) => [q.frame, q.value]);

describe('key selection', () => {
  it('names a key by kind and frame', () => {
    expect(refKey({ kind: 'move', frame: 12 })).toBe('move:12');
    expect(refKey({ kind: 'move', frame: 12 })).not.toBe(refKey({ kind: 'volume', frame: 12 }));
  });

  it('copies nothing from an empty selection', () => {
    expect(copyRefs(sample(), [])).toEqual([]);
  });

  it('copies the chosen keys with every channel, rebased to the earliest chosen frame', () => {
    const clips = copyRefs(sample(), [{ kind: 'move', frame: 10 }, { kind: 'move', frame: 30 }]);
    expect(clips).toHaveLength(1);
    expect(clips[0].kind).toBe('move');
    expect(clips[0].span).toBe(20);
    expect(clips[0].channels.x.map((q) => [q.frame, q.value])).toEqual([[0, 2], [20, 4]]);
    expect(clips[0].channels.y.map((q) => [q.frame, q.value])).toEqual([[0, 50], [20, 70]]);
  });

  it('rebases every lane to the same frame so lanes stay in step', () => {
    const clips = copyRefs(sample(), [{ kind: 'move', frame: 20 }, { kind: 'volume', frame: 5 }]);
    const move = clips.find((c) => c.kind === 'move');
    const vol = clips.find((c) => c.kind === 'volume');
    expect(move?.channels.x.map((q) => q.frame)).toEqual([15]);
    expect('y' in (move?.channels ?? {})).toBe(false);
    expect(vol?.channels.level.map((q) => q.frame)).toEqual([0]);
  });

  it('skips a lane the content lacks and frames that hold no key', () => {
    const c = sample();
    expect(copyRefs(c, [{ kind: 'opacity' as KeyKind, frame: 10 }])).toEqual([]);
    expect(copyRefs(c, [{ kind: 'move', frame: 11 }])).toEqual([]);
  });

  it('does not change the content it copies from', () => {
    const c = sample();
    const before = JSON.stringify(c);
    copyRefs(c, [{ kind: 'move', frame: 10 }]);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('pastes a copy at a new frame and makes the lane when it is missing', () => {
    const src = sample();
    const clips = copyRefs(src, [{ kind: 'move', frame: 10 }, { kind: 'volume', frame: 20 }]);
    const bare = content('image', 0, 100);
    const out = pasteClips(bare, clips, 40);
    expect(values(out, 'move', 'x')).toEqual([[40, 2]]);
    expect(values(out, 'move', 'y')).toEqual([[40, 50]]);
    expect(values(out, 'volume', 'level')).toEqual([[50, 0.9]]);
    expect(bare.keys).toEqual([]);
  });

  it('replaces a key already on the frame it pastes onto', () => {
    const src = sample();
    const out = pasteClips(src, copyRefs(src, [{ kind: 'move', frame: 0 }]), 20);
    expect(values(out, 'move', 'x')).toEqual([[0, 1], [10, 2], [20, 1], [30, 4]]);
  });

  it('deletes the chosen keys on every channel and leaves the rest', () => {
    const refs: KeyRef[] = [{ kind: 'move', frame: 10 }, { kind: 'volume', frame: 5 }, { kind: 'move', frame: 99 }];
    const out = deleteRefs(sample(), refs);
    expect(frames(out, 'move', 'x')).toEqual([0, 20, 30]);
    expect(frames(out, 'move', 'y')).toEqual([30]);
    expect(frames(out, 'volume')).toEqual([20]);
  });

  it('returns the same content when nothing matches', () => {
    const c = sample();
    expect(deleteRefs(c, [{ kind: 'move', frame: 77 }])).toBe(c);
    expect(reverseRefs(c, [])).toBe(c);
  });

  it('mirrors only the chosen keys inside their own span', () => {
    const out = reverseRefs(sample(), [{ kind: 'move', frame: 0 }, { kind: 'move', frame: 10 }]);
    expect(values(out, 'move', 'x')).toEqual([[0, 2], [10, 1], [20, 3], [30, 4]]);
    expect(values(out, 'move', 'y')).toEqual([[0, 50], [30, 70]]);
    expect(values(out, 'volume', 'level')).toEqual([[5, 0.1], [20, 0.9]]);
  });

  it('is undone by reversing the same span again', () => {
    const c = sample();
    const refs: KeyRef[] = [0, 10, 20, 30].map((frame) => ({ kind: 'move' as KeyKind, frame }));
    const twice = reverseRefs(reverseRefs(c, refs), refs);
    expect(values(twice, 'move', 'x')).toEqual(values(c, 'move', 'x'));
    expect(values(reverseRefs(c, refs), 'move', 'x')).toEqual([[0, 4], [10, 3], [20, 2], [30, 1]]);
  });

  it('uses one axis for all lanes and lets a key that was not chosen keep its frame', () => {
    const out = reverseRefs(sample(), [{ kind: 'move', frame: 0 }, { kind: 'volume', frame: 20 }]);
    expect(values(out, 'move', 'x')).toEqual([[10, 2], [20, 3], [30, 4]]);
    expect(values(out, 'volume', 'level')).toEqual([[0, 0.9], [5, 0.1]]);
  });
});
