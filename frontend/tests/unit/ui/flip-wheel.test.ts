import { describe, expect, it, vi } from 'vitest';
import type { Content } from '@src/engine/types';

const prefs = vi.hoisted(() => ({ scrubSpeed: 'medium' as string }));

vi.mock('@src/ui/prefs', () => ({ loadPrefs: () => prefs }));
vi.mock('@src/ui/toast', () => ({ toast: vi.fn() }));

const { ScrubWheel } = await import('@src/ui/flip-wheel');

type Wheel = InstanceType<typeof ScrubWheel>;

const setup = (start = 2, row = 0): { wheel: Wheel; picks: [number, number][]; host: { r: number; i: number } } => {
  const state = { r: row, i: start };
  const picks: [number, number][] = [];
  const c = { flip: [{ frames: [1, 2, 3, 4, 5, 6] }, { frames: [1, 2, 3] }] } as unknown as Content;
  const wheel = new ScrubWheel({
    content: () => c,
    row: () => state.r,
    index: () => state.i,
    select: (r, i) => { picks.push([r, i]); state.i = i; },
  });
  wheel.root.setPointerCapture = (): void => undefined;
  return { wheel, picks, host: state };
};

const fire = (w: Wheel, type: string, clientX: number, pointerId = 1, button = 0): void => {
  w.root.dispatchEvent(new PointerEvent(type, { clientX, pointerId, button, bubbles: true }));
};

const mid = (w: Wheel): HTMLButtonElement => w.root.querySelector('.fm-sw-mid') as HTMLButtonElement;

describe('ScrubWheel dragging', () => {
  it('moves forward one frame per notch when dragged left', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(2);
    fire(wheel, 'pointerdown', 100);
    fire(wheel, 'pointermove', 64);
    expect(picks).toEqual([[0, 4]]);
  });

  it('moves backward when dragged right and stops at the first frame', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(2);
    fire(wheel, 'pointerdown', 100);
    fire(wheel, 'pointermove', 118);
    fire(wheel, 'pointermove', 400);
    expect(picks).toEqual([[0, 1], [0, 0]]);
  });

  it('stops at the last frame of the track', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(4);
    fire(wheel, 'pointerdown', 500);
    fire(wheel, 'pointermove', 0);
    expect(picks).toEqual([[0, 5]]);
  });

  it('does not select again while the pointer stays inside the same notch', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(2);
    fire(wheel, 'pointerdown', 100);
    fire(wheel, 'pointermove', 95);
    fire(wheel, 'pointermove', 80);
    fire(wheel, 'pointermove', 78);
    expect(picks).toEqual([[0, 3]]);
  });

  it('spaces notches by the scrub speed setting', () => {
    prefs.scrubSpeed = 'precise';
    const a = setup(0);
    fire(a.wheel, 'pointerdown', 100);
    fire(a.wheel, 'pointermove', 72);
    expect(a.picks).toEqual([[0, 1]]);
    prefs.scrubSpeed = 'fast';
    const b = setup(0);
    fire(b.wheel, 'pointerdown', 100);
    fire(b.wheel, 'pointermove', 72);
    expect(b.picks).toEqual([[0, 3]]);
    prefs.scrubSpeed = 'medium';
  });

  it('ignores a secondary button and moves from another pointer', () => {
    prefs.scrubSpeed = 'medium';
    const a = setup(2);
    fire(a.wheel, 'pointerdown', 100, 1, 2);
    fire(a.wheel, 'pointermove', 0);
    expect(a.picks).toEqual([]);
    expect(a.wheel.scrubbing).toBe(false);
    const b = setup(2);
    fire(b.wheel, 'pointerdown', 100, 1);
    fire(b.wheel, 'pointermove', 0, 2);
    expect(b.picks).toEqual([]);
  });

  it('reports scrubbing while turning and calls onScrub at start and end', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel } = setup(2);
    const seen: boolean[] = [];
    wheel.onScrub = (): void => { seen.push(wheel.scrubbing); };
    fire(wheel, 'pointerdown', 100);
    expect(wheel.scrubbing).toBe(true);
    fire(wheel, 'pointerup', 100);
    expect(wheel.scrubbing).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('stops following the pointer after release', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(2);
    fire(wheel, 'pointerdown', 100);
    fire(wheel, 'pointerup', 100);
    fire(wheel, 'pointermove', 0);
    expect(picks).toEqual([]);
  });
});

describe('ScrubWheel lock', () => {
  it('locks the frame it was on and returns there on release', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(1);
    mid(wheel).click();
    expect(wheel.locked).toBe(true);
    expect(wheel.lockedIndex()).toBe(1);
    fire(wheel, 'pointerdown', 100);
    fire(wheel, 'pointermove', 46);
    fire(wheel, 'pointerup', 46);
    expect(picks).toEqual([[0, 4], [0, 1]]);
  });

  it('reports no locked frame for another track', () => {
    const { wheel, host } = setup(1, 0);
    mid(wheel).click();
    host.r = 1;
    expect(wheel.lockedIndex()).toBe(-1);
  });

  it('a second tap on the notch unlocks and release stays put', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(1);
    mid(wheel).click();
    mid(wheel).click();
    expect(wheel.locked).toBe(false);
    fire(wheel, 'pointerdown', 100);
    fire(wheel, 'pointermove', 82);
    fire(wheel, 'pointerup', 82);
    expect(picks).toEqual([[0, 2]]);
  });

  it('reset forgets the lock', () => {
    const { wheel } = setup(3);
    mid(wheel).click();
    wheel.reset();
    expect(wheel.locked).toBe(false);
    expect(wheel.lockedIndex()).toBe(-1);
  });

  it('a press on the notch does not start a scrub', () => {
    prefs.scrubSpeed = 'medium';
    const { wheel, picks } = setup(2);
    mid(wheel).dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, pointerId: 1, button: 0, bubbles: true }));
    fire(wheel, 'pointermove', 0);
    expect(wheel.scrubbing).toBe(false);
    expect(picks).toEqual([]);
  });
});
