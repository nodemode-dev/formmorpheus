import { afterEach, describe, expect, it } from 'vitest';
import { MENU_KEEP, setMenuStyle, trimMenu, type MenuItem } from '@src/ui/menu';

describe('trimMenu', () => {
  afterEach(() => { setMenuStyle([], {}); });

  it('returns the items unchanged when nothing is hidden', () => {
    const items: MenuItem[] = ['-', 'open', '-', '-', 'save', '-'];
    expect(trimMenu(items)).toBe(items);
  });

  it('drops hidden commands', () => {
    setMenuStyle(['save'], {});
    expect(trimMenu(['open', 'save', 'close'])).toEqual(['open', 'close']);
  });

  it('leaves no leading, trailing or doubled separator', () => {
    setMenuStyle(['a', 'c'], {});
    expect(trimMenu(['-', 'a', '-', 'b', '-', 'c', '-', '-', 'd', '-'])).toEqual(['b', '-', 'd']);
  });

  it('keeps the commands that lead back to the settings even when hidden', () => {
    setMenuStyle([...MENU_KEEP, 'open'], {});
    expect(trimMenu(['open', ...MENU_KEEP])).toEqual([...MENU_KEEP]);
  });

  it('drops a submenu left with nothing but separators', () => {
    setMenuStyle(['x', 'y'], {});
    expect(trimMenu(['open', { label: 'More', items: ['x', '-', 'y'] }, 'close'])).toEqual(['open', 'close']);
  });

  it('trims inside a submenu and keeps it when something is left', () => {
    setMenuStyle(['x'], {});
    expect(trimMenu([{ label: 'More', items: ['x', '-', 'y', '-'] }])).toEqual([{ label: 'More', items: ['y'] }]);
  });

  it('does not change the items it was given', () => {
    setMenuStyle(['x'], {});
    const items: MenuItem[] = ['x', 'y', { label: 'More', items: ['x', 'z'] }];
    trimMenu(items);
    expect(items).toEqual(['x', 'y', { label: 'More', items: ['x', 'z'] }]);
  });
});
