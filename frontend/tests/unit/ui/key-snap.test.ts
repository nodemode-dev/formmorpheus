import { beforeEach, describe, expect, it } from 'vitest';
import type { Engine } from '@src/engine/engine';
import type { Content, KeyKind } from '@src/engine/types';
import { keyHome, keyTip, snapKeyFrame } from '@src/ui/key-snap';

interface LaneSpec { kind: string; frames: number[] }

function block(id: string, start: number, duration: number, lanes: LaneSpec[] = []): Content {
  return {
    id,
    start,
    duration,
    keys: lanes.map((l) => ({ kind: l.kind, channels: { v: l.frames.map((frame) => ({ frame, value: 0 })) } })),
  } as unknown as Content;
}

function engineWith(...content: Content[]): Engine {
  return { movie: { tracks: [{ content }] } } as unknown as Engine;
}

const noMovie = { movie: null } as unknown as Engine;
const MOVE = 'move' as KeyKind;

beforeEach(() => {
  keyHome.frame = -1;
});

describe('snapKeyFrame', () => {
  it('keeps the raw frame with no target when snapping is off', () => {
    keyHome.frame = 12;
    const c = block('a', 10, 100);
    expect(snapKeyFrame(engineWith(c), c, MOVE, 3, 1, true)).toEqual({ frame: 3, to: null });
  });

  it('snaps to the Playhead in content-local frames within six pixels', () => {
    keyHome.frame = 30;
    const c = block('a', 10, 100);
    expect(snapKeyFrame(noMovie, c, MOVE, 24, 1, false)).toEqual({ frame: 20, to: 'playhead' });
  });

  it('does not snap to a Playhead farther than six pixels away', () => {
    keyHome.frame = 30;
    const c = block('a', 10, 100);
    expect(snapKeyFrame(noMovie, c, MOVE, 27, 1, false)).toEqual({ frame: 27, to: null });
  });

  it('measures the reach in pixels, so a wide zoom shrinks it in frames', () => {
    keyHome.frame = 30;
    const c = block('a', 10, 100);
    expect(snapKeyFrame(noMovie, c, MOVE, 21, 10, false)).toEqual({ frame: 21, to: null });
    expect(snapKeyFrame(noMovie, c, MOVE, 21, 3, false)).toEqual({ frame: 20, to: 'playhead' });
  });

  it('snaps to a key of another lane of the same block', () => {
    const c = block('a', 0, 100, [{ kind: 'move', frames: [40] }, { kind: 'opacity', frames: [50] }]);
    expect(snapKeyFrame(engineWith(c), c, MOVE, 47, 1, false)).toEqual({ frame: 50, to: 'key' });
  });

  it('ignores the keys of the lane being dragged', () => {
    const c = block('a', 0, 100, [{ kind: 'move', frames: [46] }]);
    expect(snapKeyFrame(engineWith(c), c, MOVE, 47, 1, false)).toEqual({ frame: 47, to: null });
  });

  it('snaps to the keys of the same kind in another block, shifted by the start difference', () => {
    const c = block('a', 100, 50);
    const other = block('b', 90, 50, [{ kind: 'move', frames: [30] }]);
    expect(snapKeyFrame(engineWith(c, other), c, MOVE, 22, 1, false)).toEqual({ frame: 20, to: 'key' });
  });

  it('picks the nearest target when several are in reach', () => {
    keyHome.frame = 15;
    const c = block('a', 0, 100, [{ kind: 'opacity', frames: [18, 22] }]);
    expect(snapKeyFrame(engineWith(c), c, MOVE, 19, 1, false)).toEqual({ frame: 18, to: 'key' });
    expect(snapKeyFrame(engineWith(c), c, MOVE, 16, 1, false)).toEqual({ frame: 15, to: 'playhead' });
  });

  it('never snaps to a frame outside the dragged block', () => {
    keyHome.frame = 5;
    const c = block('a', 10, 20);
    const other = block('b', 0, 100, [{ kind: 'move', frames: [31] }]);
    expect(snapKeyFrame(engineWith(c, other), c, MOVE, 1, 1, false)).toEqual({ frame: 1, to: null });
    expect(snapKeyFrame(engineWith(c, other), c, MOVE, 18, 1, false)).toEqual({ frame: 18, to: null });
  });

  it('looks for keys on every track of the movie', () => {
    const c = block('a', 0, 100);
    const far = block('c', 0, 100, [{ kind: 'blur', frames: [61] }]);
    const engine = { movie: { tracks: [{ content: [c] }, { content: [] }, { content: [far] }] } } as unknown as Engine;
    expect(snapKeyFrame(engine, c, MOVE, 64, 1, false)).toEqual({ frame: 61, to: 'key' });
  });
});

describe('keyTip', () => {
  it('shows the frame text beside the pointer and hides again', () => {
    keyTip.show(100, 200, 'Frame 12');
    const tip = document.querySelector<HTMLElement>('.fm-keytip');
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toBe('Frame 12');
    expect(tip?.hidden).toBe(false);
    expect(tip?.style.transform).toBe('translate(114px, 166px)');
    keyTip.hide();
    expect(tip?.hidden).toBe(true);
  });
});
