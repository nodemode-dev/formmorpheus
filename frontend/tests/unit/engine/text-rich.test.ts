import { describe, expect, it } from 'vitest';
import { baseEff, diffText, hasRuns, looksOf, paintRun, runValue, shiftRuns, type TextRun } from '@src/engine/text-rich';
import type { TextStyle } from '@src/engine/types';

function style(text: string, runs?: TextRun[], extra: Record<string, unknown> = {}): TextStyle {
  return { text, font: 'Body', size: 40, weight: 400, color: '#ffffff', ...(runs ? { runs } : {}), ...extra } as unknown as TextStyle;
}

describe('baseEff', () => {
  it('fills the defaults a block leaves out', () => {
    const e = baseEff(style('a'));
    expect(e).toEqual({ font: 'Body', size: 40, weight: 400, italic: false, color: '#ffffff', underline: false, strike: false, tracking: 0, baseline: 0, stroke: null });
  });

  it('drops an outline of no width and keeps a real one', () => {
    expect(baseEff(style('a', undefined, { stroke: { color: '#000', width: 0 } })).stroke).toBeNull();
    expect(baseEff(style('a', undefined, { stroke: { color: '#000', width: 3 } })).stroke).toEqual({ color: '#000', width: 3 });
  });
});

describe('hasRuns', () => {
  it('is false without runs or with only empty ones', () => {
    expect(hasRuns(style('abc'))).toBe(false);
    expect(hasRuns(style('abc', []))).toBe(false);
    expect(hasRuns(style('abc', [{ from: 2, to: 2, color: '#f00' }]))).toBe(false);
  });

  it('is true with a run that covers text', () => {
    expect(hasRuns(style('abc', [{ from: 0, to: 1, color: '#f00' }]))).toBe(true);
  });
});

describe('looksOf', () => {
  it('gives one look and no table for plain text', () => {
    const l = looksOf(style('hello'));
    expect(l.at).toBeNull();
    expect(l.list).toHaveLength(1);
  });

  it('folds overlapping runs per character', () => {
    const l = looksOf(style('hello', [{ from: 0, to: 2, color: '#ff0000' }, { from: 1, to: 3, weight: 900 }]));
    const at = l.at as Uint16Array;
    const eff = (i: number) => l.list[at[i]];
    expect(eff(0)).toMatchObject({ color: '#ff0000', weight: 400 });
    expect(eff(1)).toMatchObject({ color: '#ff0000', weight: 900 });
    expect(eff(2)).toMatchObject({ color: '#ffffff', weight: 900 });
    expect(at[3]).toBe(0);
    expect(at[4]).toBe(0);
    expect(l.list[0]).toMatchObject({ color: '#ffffff', weight: 400 });
  });

  it('lets a later run win over an earlier one', () => {
    const l = looksOf(style('abc', [{ from: 0, to: 3, color: '#111111' }, { from: 1, to: 2, color: '#222222' }]));
    const at = l.at as Uint16Array;
    expect(l.list[at[0]].color).toBe('#111111');
    expect(l.list[at[1]].color).toBe('#222222');
    expect(l.list[at[2]].color).toBe('#111111');
  });

  it('shares one look between separate spans that look the same', () => {
    const l = looksOf(style('abc', [{ from: 0, to: 1, italic: true }, { from: 2, to: 3, italic: true }]));
    const at = l.at as Uint16Array;
    expect(l.list).toHaveLength(2);
    expect(at[0]).toBe(at[2]);
    expect(at[1]).toBe(0);
  });

  it('clamps a run that reaches outside the text', () => {
    const l = looksOf(style('ab', [{ from: -5, to: 99, underline: true }]));
    const at = l.at as Uint16Array;
    expect(at).toHaveLength(3);
    expect(l.list[at[0]].underline).toBe(true);
    expect(l.list[at[1]].underline).toBe(true);
    expect(at[2]).toBe(0);
  });

  it('switches the outline off for a span with a width of zero', () => {
    const l = looksOf(style('ab', [{ from: 0, to: 1, stroke: { color: '#000', width: 0 } }], { stroke: { color: '#123456', width: 4 } }));
    const at = l.at as Uint16Array;
    expect(l.list[at[0]].stroke).toBeNull();
    expect(l.list[at[1]].stroke).toEqual({ color: '#123456', width: 4 });
  });

  it('answers the same object for the same style', () => {
    const s = style('abc', [{ from: 0, to: 1, size: 80 }]);
    expect(looksOf(s)).toBe(looksOf(s));
  });
});

describe('shiftRuns', () => {
  it('passes through nothing', () => {
    expect(shiftRuns(undefined, 0, 0, 3)).toBeUndefined();
    expect(shiftRuns([], 0, 0, 3)).toEqual([]);
  });

  it('moves a span when text is typed before it', () => {
    expect(shiftRuns([{ from: 5, to: 8, color: '#f00' }], 0, 0, 2)).toEqual([{ from: 7, to: 10, color: '#f00' }]);
  });

  it('leaves a span alone when text is typed after it', () => {
    expect(shiftRuns([{ from: 1, to: 3, color: '#f00' }], 6, 0, 4)).toEqual([{ from: 1, to: 3, color: '#f00' }]);
  });

  it('grows a span when text is typed inside it', () => {
    expect(shiftRuns([{ from: 2, to: 6, weight: 700 }], 4, 0, 3)).toEqual([{ from: 2, to: 9, weight: 700 }]);
  });

  it('pulls a span back when text before it is deleted', () => {
    expect(shiftRuns([{ from: 5, to: 8, weight: 700 }], 1, 2, 0)).toEqual([{ from: 3, to: 6, weight: 700 }]);
  });

  it('trims a span whose start is deleted', () => {
    expect(shiftRuns([{ from: 2, to: 6, weight: 700 }], 0, 4, 0)).toEqual([{ from: 0, to: 2, weight: 700 }]);
  });

  it('trims a span whose end is deleted', () => {
    expect(shiftRuns([{ from: 2, to: 6, weight: 700 }], 4, 5, 0)).toEqual([{ from: 2, to: 4, weight: 700 }]);
  });

  it('drops a span that is deleted whole', () => {
    expect(shiftRuns([{ from: 2, to: 4, weight: 700 }], 1, 5, 0)).toBeUndefined();
    expect(shiftRuns([{ from: 2, to: 4, weight: 700 }, { from: 8, to: 9, italic: true }], 1, 5, 0)).toEqual([{ from: 3, to: 4, italic: true }]);
  });

  it('does not change the runs it was given', () => {
    const runs: TextRun[] = [{ from: 5, to: 8, color: '#f00' }];
    shiftRuns(runs, 0, 0, 2);
    expect(runs).toEqual([{ from: 5, to: 8, color: '#f00' }]);
  });
});

describe('diffText', () => {
  it('finds an insertion in the middle', () => {
    expect(diffText('hello', 'helXlo')).toEqual({ at: 3, removed: 0, added: 1 });
  });

  it('finds a replacement', () => {
    expect(diffText('hello world', 'hello there')).toEqual({ at: 6, removed: 5, added: 5 });
  });

  it('reports no change for equal strings', () => {
    expect(diffText('abc', 'abc')).toEqual({ at: 3, removed: 0, added: 0 });
  });

  it('handles clearing and filling the whole text', () => {
    expect(diffText('abc', '')).toEqual({ at: 0, removed: 3, added: 0 });
    expect(diffText('', 'abc')).toEqual({ at: 0, removed: 0, added: 3 });
  });

  it('does not count the same repeated letter twice', () => {
    expect(diffText('aaa', 'aa')).toEqual({ at: 2, removed: 1, added: 0 });
  });

  it('describes an edit that turns one string into the other', () => {
    const pairs: Array<[string, string]> = [['kitten', 'sitting'], ['abcabc', 'abc'], ['', ''], ['xay', 'xbby']];
    for (const [a, b] of pairs) {
      const d = diffText(a, b);
      expect(a.slice(0, d.at) + b.slice(d.at, d.at + d.added) + a.slice(d.at + d.removed)).toBe(b);
    }
  });
});

describe('paintRun', () => {
  it('ignores an empty range', () => {
    const runs: TextRun[] = [{ from: 0, to: 2, color: '#f00' }];
    expect(paintRun(runs, 3, 3, { weight: 700 })).toBe(runs);
    expect(paintRun(undefined, 5, 2, { weight: 700 })).toBeUndefined();
  });

  it('makes the first run on plain text', () => {
    expect(paintRun(undefined, 2, 5, { color: '#f00' })).toEqual([{ from: 2, to: 5, color: '#f00' }]);
  });

  it('splits a run around the painted range', () => {
    expect(paintRun([{ from: 0, to: 10, weight: 700 }], 3, 6, { color: '#f00' })).toEqual([
      { from: 0, to: 3, weight: 700 },
      { from: 3, to: 6, weight: 700, color: '#f00' },
      { from: 6, to: 10, weight: 700 },
    ]);
  });

  it('fills the gaps between runs inside the range', () => {
    expect(paintRun([{ from: 2, to: 4, weight: 700 }], 0, 6, { italic: true })).toEqual([
      { from: 0, to: 2, italic: true },
      { from: 2, to: 4, weight: 700, italic: true },
      { from: 4, to: 6, italic: true },
    ]);
  });

  it('clears a field with undefined and drops runs left empty', () => {
    expect(paintRun([{ from: 0, to: 10, weight: 700 }], 0, 10, { weight: undefined })).toBeUndefined();
    expect(paintRun([{ from: 0, to: 10, weight: 700 }], 3, 6, { weight: undefined })).toEqual([
      { from: 0, to: 3, weight: 700 },
      { from: 6, to: 10, weight: 700 },
    ]);
  });

  it('joins neighbours that end up with the same look', () => {
    expect(paintRun([{ from: 0, to: 3, color: '#f00' }], 3, 6, { color: '#f00' })).toEqual([{ from: 0, to: 6, color: '#f00' }]);
  });

  it('overwrites the value already painted there', () => {
    expect(paintRun([{ from: 0, to: 4, color: '#f00' }], 0, 4, { color: '#00f' })).toEqual([{ from: 0, to: 4, color: '#00f' }]);
  });

  it('does not change the runs it was given', () => {
    const runs: TextRun[] = [{ from: 0, to: 10, weight: 700 }];
    paintRun(runs, 3, 6, { color: '#f00' });
    expect(runs).toEqual([{ from: 0, to: 10, weight: 700 }]);
  });

  it('feeds looksOf with what was painted', () => {
    const runs = paintRun(paintRun(undefined, 0, 3, { weight: 900 }), 2, 5, { color: '#00ff00' });
    const s = style('abcdef', runs);
    expect(runValue(s, 0, 3, 'weight')).toBe(900);
    expect(runValue(s, 2, 5, 'color')).toBe('#00ff00');
  });
});

describe('runValue', () => {
  const s = style('abcdef', [{ from: 0, to: 3, weight: 900 }, { from: 0, to: 2, stroke: { color: '#000', width: 2 } }]);

  it('gives the value shared by the whole range', () => {
    expect(runValue(s, 0, 3, 'weight')).toBe(900);
    expect(runValue(s, 0, 2, 'stroke')).toEqual({ color: '#000', width: 2 });
  });

  it('gives undefined when the range is mixed', () => {
    expect(runValue(s, 1, 5, 'weight')).toBeUndefined();
    expect(runValue(s, 1, 3, 'stroke')).toBeUndefined();
  });

  it('gives undefined for an empty range', () => {
    expect(runValue(s, 2, 2, 'weight')).toBeUndefined();
  });
});
