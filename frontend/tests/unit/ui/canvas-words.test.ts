import { describe, expect, it, vi } from 'vitest';

const lang = vi.hoisted(() => ({
  listeners: [] as (() => void)[],
  table: {} as Record<string, string>,
}));

vi.mock('@src/ui/i18n', () => ({
  t: (english: string): string => lang.table[english] ?? english,
  onLanguage: (fn: () => void): (() => void) => {
    lang.listeners.push(fn);
    return () => undefined;
  },
}));

const { contentName, redrawOnLanguage, secondsLabel, word, wordsEpoch } = await import('@src/ui/canvas-words');

function switchLanguage(table: Record<string, string>): void {
  lang.table = table;
  for (const fn of lang.listeners) fn();
}

describe('canvas words', () => {
  it('moves the epoch on every language change', () => {
    const before = wordsEpoch();
    switchLanguage({});
    switchLanguage({});
    expect(wordsEpoch()).toBe(before + 2);
  });

  it('calls a redraw after each language change until it is stopped', () => {
    const redraw = vi.fn();
    const stop = redrawOnLanguage(redraw);
    switchLanguage({});
    expect(redraw).toHaveBeenCalledTimes(1);
    stop();
    switchLanguage({});
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('looks a word up in the current language at the time it is asked', () => {
    switchLanguage({ Frame: 'Bild' });
    expect(word('Frame')).toBe('Bild');
    switchLanguage({});
    expect(word('Frame')).toBe('Frame');
  });

  it('translates a default block name but keeps a name the person typed', () => {
    switchLanguage({ Drawing: 'Zeichnung', Video: 'Film', 'My drawing': 'Meine Zeichnung', Layer: 'Ebene' });
    expect(contentName('Drawing')).toBe('Zeichnung');
    expect(contentName('Video')).toBe('Film');
    expect(contentName('My drawing')).toBe('My drawing');
    expect(contentName('Layer')).toBe('Layer');
    expect(contentName('')).toBe('');
  });

  it('puts the number of seconds into the language unit', () => {
    switchLanguage({ '{n}s': '{n} Sek.' });
    expect(secondsLabel(12)).toBe('12 Sek.');
    switchLanguage({});
    expect(secondsLabel(0)).toBe('0s');
    expect(secondsLabel(2.5)).toBe('2.5s');
  });
});
