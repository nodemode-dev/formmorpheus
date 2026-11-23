import { describe, expect, it } from 'vitest';
import { fuzzyScore } from '@src/ui/command-palette';

function score(query: string, text: string): number {
  const s = fuzzyScore(query, text);
  if (s === null) throw new Error(`no match for ${query} in ${text}`);
  return s;
}

describe('fuzzyScore', () => {
  it('scores an empty query as zero for any text', () => {
    expect(fuzzyScore('', 'Save')).toBe(0);
    expect(fuzzyScore('', '')).toBe(0);
  });

  it('refuses a query longer than the text', () => {
    expect(fuzzyScore('saved', 'Save')).toBeNull();
  });

  it('refuses letters that are missing or out of order', () => {
    expect(fuzzyScore('ba', 'ab')).toBeNull();
    expect(fuzzyScore('sz', 'Save as')).toBeNull();
  });

  it('ignores case in both the query and the text', () => {
    expect(fuzzyScore('SAVE', 'save as')).toBe(fuzzyScore('save', 'save as'));
  });

  it('ranks letters next to each other above scattered letters', () => {
    expect(score('ab', 'abxx')).toBeGreaterThan(score('ab', 'axxb'));
  });

  it('ranks a letter at the start of a word above one inside a word', () => {
    expect(score('s', 'Save')).toBeGreaterThan(score('s', 'base'));
    expect(score('e', 'Edit > Export')).toBeGreaterThan(score('e', 'xxxxxxxxxxxxe'));
  });

  it('counts a capital after a small letter as the start of a word', () => {
    expect(score('b', 'canvasBrush')).toBeGreaterThan(score('b', 'canvasbrush'));
  });

  it('ranks a shorter name first when the letters match the same way', () => {
    expect(score('cut', 'Cut')).toBeGreaterThan(score('cut', 'Cut the selected layers into a new document'));
  });

  it('finds the best placing of the letters, not the first one', () => {
    expect(score('ex', 'Edit > Export')).toBeGreaterThan(score('ex', 'Edit > Ebxort'));
  });

  it('handles letters outside the basic range', () => {
    expect(fuzzyScore('ü', 'Über')).not.toBeNull();
    expect(fuzzyScore('é', 'Ebene')).toBeNull();
  });
});
