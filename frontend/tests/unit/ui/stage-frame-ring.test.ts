import { describe, expect, it } from 'vitest';
import { FrameRing } from '@src/ui/stage-frame-ring';

const make = (): { space: HTMLElement; ring: FrameRing } => {
  const space = document.createElement('div');
  return { space, ring: new FrameRing(space) };
};

describe('FrameRing', () => {
  it('starts hidden, hidden from assistive tech and placed inside the space', () => {
    const { space, ring } = make();
    expect(ring.el.parentElement).toBe(space);
    expect(ring.el.hidden).toBe(true);
    expect(ring.el.getAttribute('aria-hidden')).toBe('true');
    expect(ring.el.className).toBe('fm-frame-ring');
  });

  it('stays hidden when there is no view', () => {
    const { ring } = make();
    ring.sync(null, 1920, 1080);
    expect(ring.el.hidden).toBe(true);
  });

  it('covers the scaled frame with whole pixel position and size', () => {
    const { ring } = make();
    ring.sync({ ox: 10.4, oy: 20.6, scale: 0.5 }, 401, 300);
    expect(ring.el.hidden).toBe(false);
    expect(ring.el.style.transform).toBe('translate(10px, 21px)');
    expect(ring.el.style.width).toBe('201px');
    expect(ring.el.style.height).toBe('150px');
  });

  it('follows a new view', () => {
    const { ring } = make();
    ring.sync({ ox: 0, oy: 0, scale: 1 }, 100, 50);
    ring.sync({ ox: -30, oy: 12, scale: 2 }, 100, 50);
    expect(ring.el.style.transform).toBe('translate(-30px, 12px)');
    expect(ring.el.style.width).toBe('200px');
    expect(ring.el.style.height).toBe('100px');
  });

  it('hides again when the view goes away', () => {
    const { ring } = make();
    ring.sync({ ox: 5, oy: 5, scale: 1 }, 100, 100);
    ring.sync(null, 100, 100);
    expect(ring.el.hidden).toBe(true);
  });

  it('shows again for the same view after being hidden', () => {
    const { ring } = make();
    const v = { ox: 5, oy: 6, scale: 1 };
    ring.sync(v, 100, 100);
    ring.sync(null, 100, 100);
    ring.sync(v, 100, 100);
    expect(ring.el.hidden).toBe(false);
    expect(ring.el.style.transform).toBe('translate(5px, 6px)');
  });
});
