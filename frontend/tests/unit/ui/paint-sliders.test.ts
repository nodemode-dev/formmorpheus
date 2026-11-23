import { describe, expect, it, vi } from 'vitest';
import { fineFactor, wireSlider, type SliderHost, type SliderKind } from '@src/ui/paint-sliders';

vi.mock('@src/ui/a11y', () => ({ keyboardSlider: (): void => undefined }));

describe('fineFactor', () => {
  it('is a flat fraction while Alt is held', () => {
    expect(fineFactor(0, true)).toBe(0.12);
    expect(fineFactor(500, true)).toBe(0.12);
  });

  it('stays at full speed within the sideways allowance', () => {
    expect(fineFactor(0, false)).toBe(1);
    expect(fineFactor(34, false)).toBe(1);
    expect(fineFactor(-34, false)).toBe(1);
  });

  it('gets finer the further the pointer is to either side', () => {
    expect(fineFactor(56, false)).toBeCloseTo(0.15, 10);
    expect(fineFactor(-56, false)).toBeCloseTo(0.15, 10);
    expect(fineFactor(35, false)).toBeLessThan(1);
    let last = 1;
    for (let dx = 35; dx < 2000; dx += 15) {
      const f = fineFactor(dx, false);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });

  it('never goes below the finest step', () => {
    expect(fineFactor(100000, false)).toBe(0.04);
  });
});

interface Rig { node: HTMLElement; apply: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }

const rig = (kind: SliderKind, current: number): Rig => {
  const node = document.createElement('div');
  node.setPointerCapture = vi.fn();
  node.getBoundingClientRect = (): DOMRect => ({ top: 100, left: 0, width: 20, height: 200, right: 20, bottom: 300, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
  const apply = vi.fn();
  const end = vi.fn();
  const host: SliderHost = { apply, end };
  wireSlider(node, kind, () => current, host);
  return { node, apply, end };
};

const fire = (node: HTMLElement, type: string, x: number, y: number, o: { id?: number; alt?: boolean } = {}): void => {
  node.dispatchEvent(new PointerEvent(type, { pointerId: o.id ?? 1, clientX: x, clientY: y, altKey: !!o.alt, bubbles: true }));
};

describe('wireSlider', () => {
  it('jumps to the pressed height with the top as full', () => {
    const r = rig('size', 0.2);
    fire(r.node, 'pointerdown', 10, 150);
    expect(r.apply).toHaveBeenLastCalledWith('size', 0.75, false);
  });

  it('clamps a press beyond either end', () => {
    const r = rig('opacity', 0.2);
    fire(r.node, 'pointerdown', 10, 20);
    expect(r.apply).toHaveBeenLastCalledWith('opacity', 1, false);
    fire(r.node, 'pointerdown', 10, 900);
    expect(r.apply).toHaveBeenLastCalledWith('opacity', 0, false);
  });

  it('follows the pointer exactly on a straight drag', () => {
    const r = rig('size', 0.2);
    fire(r.node, 'pointerdown', 0, 150);
    fire(r.node, 'pointermove', 10, 200);
    expect(r.apply).toHaveBeenLastCalledWith('size', 0.5, false);
    expect(r.node.classList.contains('is-fine')).toBe(false);
  });

  it('switches to fine control from the host value when dragged aside', () => {
    const r = rig('strength', 0.6);
    fire(r.node, 'pointerdown', 0, 150);
    fire(r.node, 'pointermove', 56, 130);
    const [kind, v, fine] = r.apply.mock.calls[r.apply.mock.calls.length - 1] as [SliderKind, number, boolean];
    expect(kind).toBe('strength');
    expect(v).toBeCloseTo(0.615, 10);
    expect(fine).toBe(true);
    expect(r.node.classList.contains('is-fine')).toBe(true);
  });

  it('uses the Alt fraction for fine control', () => {
    const r = rig('size', 0.6);
    fire(r.node, 'pointerdown', 0, 150);
    fire(r.node, 'pointermove', 0, 100, { alt: true });
    expect(r.apply.mock.calls[r.apply.mock.calls.length - 1][1]).toBeCloseTo(0.63, 10);
  });

  it('returns to exact following when the pointer comes back', () => {
    const r = rig('size', 0.6);
    fire(r.node, 'pointerdown', 0, 150);
    fire(r.node, 'pointermove', 80, 140);
    fire(r.node, 'pointermove', 5, 250);
    expect(r.apply).toHaveBeenLastCalledWith('size', 0.25, false);
    expect(r.node.classList.contains('is-fine')).toBe(false);
  });

  it('ignores other pointers and ends only for its own', () => {
    const r = rig('size', 0.6);
    fire(r.node, 'pointerdown', 0, 150);
    const n = r.apply.mock.calls.length;
    fire(r.node, 'pointermove', 0, 200, { id: 7 });
    fire(r.node, 'pointerup', 0, 200, { id: 7 });
    expect(r.apply.mock.calls.length).toBe(n);
    expect(r.end).not.toHaveBeenCalled();
    fire(r.node, 'pointerup', 0, 200);
    expect(r.end).toHaveBeenCalledWith('size');
    fire(r.node, 'pointermove', 0, 250);
    expect(r.apply.mock.calls.length).toBe(n);
  });

  it('ends fine control on cancel', () => {
    const r = rig('opacity', 0.6);
    fire(r.node, 'pointerdown', 0, 150);
    fire(r.node, 'pointermove', 80, 140);
    fire(r.node, 'pointercancel', 80, 140);
    expect(r.end).toHaveBeenCalledWith('opacity');
    expect(r.node.classList.contains('is-fine')).toBe(false);
  });
});
