import { describe, expect, it, vi } from 'vitest';
import { textSel } from '@src/ui/text-sel';

describe('textSel', () => {
  it('orders a backwards range so from is never past to', () => {
    textSel.set('a1', 9, 3);
    expect(textSel.range('a1')).toEqual({ from: 3, to: 9 });
  });

  it('returns null for an id that is not the selected one', () => {
    textSel.set('a2', 1, 4);
    expect(textSel.range('other')).toBeNull();
  });

  it('returns null for a collapsed caret with no characters selected', () => {
    textSel.set('a3', 5, 5);
    expect(textSel.range('a3')).toBeNull();
  });

  it('notifies listeners when the selection changes', () => {
    const fn = vi.fn();
    const off = textSel.on(fn);
    textSel.set('a4', 0, 2);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
  });

  it('does not notify when the same range is set again, even reversed', () => {
    textSel.set('a5', 2, 6);
    const fn = vi.fn();
    const off = textSel.on(fn);
    textSel.set('a5', 6, 2);
    textSel.set('a5', 2, 6);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it('notifies when only the id changes', () => {
    textSel.set('a6', 1, 3);
    const fn = vi.fn();
    const off = textSel.on(fn);
    textSel.set('a7', 1, 3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(textSel.range('a6')).toBeNull();
    expect(textSel.range('a7')).toEqual({ from: 1, to: 3 });
    off();
  });

  it('stops notifying after the returned unsubscribe is called', () => {
    const fn = vi.fn();
    const off = textSel.on(fn);
    off();
    textSel.set('a8', 0, 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns a copy so changing it does not move the selection', () => {
    textSel.set('a9', 2, 8);
    const r = textSel.range('a9');
    if (r) r.from = 7;
    expect(textSel.range('a9')).toEqual({ from: 2, to: 8 });
  });
});
