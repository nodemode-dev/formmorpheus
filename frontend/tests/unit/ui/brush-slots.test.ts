import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrushSlots, type SlotHost, type SlotKind } from '@src/ui/brush-slots';

interface Rig {
  slots: BrushSlots;
  cur: { size: number; opacity: number };
  id: { key: string };
  recall: ReturnType<typeof vi.fn>;
  say: ReturnType<typeof vi.fn>;
  sliders: Record<SlotKind, HTMLElement>;
}

function rig(): Rig {
  const cur = { size: 0.5, opacity: 1 };
  const id = { key: 'pen:ink' };
  const recall = vi.fn();
  const say = vi.fn();
  const host: SlotHost = {
    key: () => id.key,
    defaults: () => [],
    current: () => ({ ...cur }),
    recall: (kind, value) => recall(kind, value),
    say: (text) => say(text),
  };
  const sliders = { size: document.createElement('div'), opacity: document.createElement('div') };
  return { slots: new BrushSlots(sliders, host), cur, id, recall, say, sliders };
}

function fill(r: Rig, kind: SlotKind, values: number[]): void {
  values.forEach((v, i) => {
    r.cur[kind] = v;
    r.slots.store(kind, i);
  });
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

describe('BrushSlots', () => {
  it('adds four markers to each slider, all empty at first', () => {
    const r = rig();
    expect(r.sliders.size.querySelectorAll('button').length).toBe(4);
    expect(r.sliders.opacity.querySelectorAll('button').length).toBe(4);
    expect(r.slots.slots()).toEqual(Array.from({ length: 4 }, () => ({ size: null, opacity: null })));
  });

  it('stores the current value in a slot and reads it back in a new session', () => {
    const r = rig();
    r.cur.size = 0.42;
    r.slots.store('size', 2);
    expect(r.slots.slots()[2]).toEqual({ size: 0.42, opacity: null });
    expect(r.say).toHaveBeenCalledWith(expect.stringContaining('42'));
    const again = rig();
    expect(again.slots.slots()[2].size).toBe(0.42);
  });

  it('keeps slots apart per tool and brush', () => {
    const r = rig();
    r.cur.opacity = 0.3;
    r.slots.store('opacity', 0);
    r.id.key = 'eraser:soft';
    expect(r.slots.slots()[0].opacity).toBeNull();
    r.id.key = 'pen:ink';
    expect(r.slots.slots()[0].opacity).toBe(0.3);
  });

  it('starts empty when the saved data is not valid', () => {
    localStorage.setItem('formmorpheus.paint.slots2', '{not json');
    const r = rig();
    expect(r.slots.slots().every((s) => s.size === null && s.opacity === null)).toBe(true);
  });

  it('store next fills the first free slot', () => {
    const r = rig();
    fill(r, 'size', [0.1]);
    r.cur.size = 0.6;
    r.slots.storeNext('size');
    expect(r.slots.slots().map((s) => s.size)).toEqual([0.1, 0.6, null, null]);
  });

  it('store next does not store a value that a slot already holds', () => {
    const r = rig();
    fill(r, 'size', [0.25]);
    r.say.mockClear();
    r.cur.size = 0.255;
    r.slots.storeNext('size');
    expect(r.slots.slots().map((s) => s.size)).toEqual([0.25, null, null, null]);
    expect(r.say).toHaveBeenCalledWith(expect.stringContaining('1'));
  });

  it('store next goes round the slots once all four are full', () => {
    const r = rig();
    fill(r, 'size', [0.1, 0.2, 0.3, 0.4]);
    r.cur.size = 0.9;
    r.slots.storeNext('size');
    r.cur.size = 0.8;
    r.slots.storeNext('size');
    expect(r.slots.slots().map((s) => s.size)).toEqual([0.9, 0.8, 0.3, 0.4]);
  });

  it('clear at empties only the marker that holds the current value', () => {
    const r = rig();
    fill(r, 'opacity', [0.2, 0.5]);
    fill(r, 'size', [0.7]);
    r.cur.opacity = 0.505;
    r.slots.clearAt('opacity');
    expect(r.slots.slots().map((s) => s.opacity)).toEqual([0.2, null, null, null]);
    expect(r.slots.slots()[0].size).toBe(0.7);
  });

  it('clear at changes nothing when no marker holds the current value', () => {
    const r = rig();
    fill(r, 'opacity', [0.2]);
    r.cur.opacity = 0.9;
    r.slots.clearAt('opacity');
    expect(r.slots.slots()[0].opacity).toBe(0.2);
  });

  it('steps to the next and previous remembered value and wraps round the ends', () => {
    const r = rig();
    fill(r, 'size', [0.8, 0.2, 0.5]);
    r.cur.size = 0.5;
    r.slots.step('size', 1);
    r.slots.step('size', -1);
    r.cur.size = 0.8;
    r.slots.step('size', 1);
    r.cur.size = 0.2;
    r.slots.step('size', -1);
    expect(r.recall.mock.calls).toEqual([['size', 0.8], ['size', 0.2], ['size', 0.2], ['size', 0.8]]);
  });

  it('does not recall anything when no value is remembered', () => {
    const r = rig();
    r.slots.step('opacity', 1);
    expect(r.recall).not.toHaveBeenCalled();
    expect(r.say).toHaveBeenCalledTimes(1);
  });

  it('sync marks empty markers, lights the one at the current value and clamps its position', () => {
    const r = rig();
    fill(r, 'size', [1.5, 0.3]);
    r.cur.size = 0.3;
    r.slots.sync();
    const m = [...r.sliders.size.querySelectorAll('button')];
    expect(m.map((b) => b.classList.contains('is-empty'))).toEqual([false, false, true, true]);
    expect(m.map((b) => b.classList.contains('is-at'))).toEqual([false, true, false, false]);
    expect(m[0].style.getPropertyValue('--m')).toBe('1');
    expect(m[1].style.getPropertyValue('--m')).toBe('0.3');
  });

  it('a click on a filled marker recalls its value, on an empty one does nothing', () => {
    const r = rig();
    fill(r, 'size', [0.35]);
    const [first, second] = [...r.sliders.size.querySelectorAll('button')];
    first.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, bubbles: true }));
    first.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, bubbles: true }));
    second.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, bubbles: true }));
    second.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, bubbles: true }));
    expect(r.recall.mock.calls).toEqual([['size', 0.35]]);
  });

  it('a shift click on a marker stores the current value there instead of recalling', () => {
    const r = rig();
    r.cur.opacity = 0.65;
    const third = r.sliders.opacity.querySelectorAll('button')[2];
    third.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    third.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, shiftKey: true, bubbles: true }));
    expect(r.slots.slots()[2].opacity).toBe(0.65);
    expect(r.recall).not.toHaveBeenCalled();
  });
});
