import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tips } from '@src/ui/tips';
import { loadPrefs, updatePrefs } from '@src/ui/prefs';

const rootOf = (): HTMLElement => document.querySelectorAll<HTMLElement>('.fm-tip')[document.querySelectorAll('.fm-tip').length - 1];

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Tips', () => {
  it('shows a tip the first time and remembers that it was seen', () => {
    const tips = new Tips();
    tips.enter('perform');
    expect(tips.visible).toBe('perform');
    expect(rootOf().hidden).toBe(false);
    expect(rootOf().querySelector('.fm-tip-text')?.textContent).not.toBe('');
    expect(loadPrefs().tipsSeen).toEqual(['perform']);
  });

  it('does not show a tip a second time', () => {
    const tips = new Tips();
    tips.enter('keyframe');
    tips.dismiss();
    tips.enter('keyframe');
    expect(tips.visible).toBeNull();
    expect(rootOf().hidden).toBe(true);
  });

  it('shows nothing when tips are turned off and does not mark the tip seen', () => {
    updatePrefs({ showTips: false });
    const tips = new Tips();
    tips.enter('paint');
    expect(tips.visible).toBeNull();
    expect(loadPrefs().tipsSeen).toEqual([]);
  });

  it('gives each tip its own text', () => {
    const tips = new Tips();
    tips.enter('flipbook');
    const a = rootOf().querySelector('.fm-tip-text')?.textContent;
    tips.enter('paint');
    const b = rootOf().querySelector('.fm-tip-text')?.textContent;
    expect(a).not.toBe(b);
    expect(loadPrefs().tipsSeen).toEqual(['flipbook', 'paint']);
  });

  it('leaves by itself after four seconds', () => {
    vi.useFakeTimers();
    const tips = new Tips();
    tips.enter('perform');
    vi.advanceTimersByTime(3999);
    expect(tips.visible).toBe('perform');
    vi.advanceTimersByTime(2);
    expect(tips.visible).toBeNull();
    expect(rootOf().hidden).toBe(true);
  });

  it('stays while the pointer rests on it and starts the clock again when it leaves', () => {
    vi.useFakeTimers();
    const tips = new Tips();
    tips.enter('perform');
    rootOf().dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(10000);
    expect(tips.visible).toBe('perform');
    rootOf().dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(3999);
    expect(tips.visible).toBe('perform');
    vi.advanceTimersByTime(2);
    expect(tips.visible).toBeNull();
  });

  it('closes from its button', () => {
    const tips = new Tips();
    tips.enter('keyframe');
    rootOf().querySelector<HTMLButtonElement>('.fm-tip-got')!.click();
    expect(tips.visible).toBeNull();
    expect(rootOf().hidden).toBe(true);
  });

  it('goes into the overlay layer when there is one', () => {
    const overlay = document.createElement('div');
    overlay.id = 'overlay-root';
    document.body.appendChild(overlay);
    new Tips();
    expect(overlay.querySelector('.fm-tip')).not.toBeNull();
  });

  it('sits in the top left corner when no movie frame is in the way', () => {
    const tips = new Tips();
    tips.enter('perform');
    expect(rootOf().style.getPropertyValue('--x')).toBe('16px');
    expect(rootOf().style.getPropertyValue('--y')).toBe('52px');
  });

  it('moves to the top right corner when the movie frame covers the top left', () => {
    const tips = new Tips();
    tips.frame = () => new DOMRect(0, 0, 400, 200);
    tips.enter('perform');
    expect(rootOf().style.getPropertyValue('--x')).toBe(`${Math.round(window.innerWidth - 360 - 16)}px`);
    expect(rootOf().style.getPropertyValue('--y')).toBe('52px');
  });
});
