import { beforeEach, describe, expect, it } from 'vitest';
import { loadView, saveView } from '@src/ui/timeline-view';

beforeEach(() => { localStorage.clear(); });

describe('timeline view memory', () => {
  it('reads back what was saved for a movie', () => {
    saveView('m1', { ppf: 12.5, start: 40, row: 56, fit: true });
    expect(loadView('m1')).toEqual({ ppf: 12.5, start: 40, row: 56, fit: true });
  });

  it('keeps each movie view apart', () => {
    saveView('m1', { ppf: 4, start: 0, row: 30, fit: false });
    saveView('m2', { ppf: 9, start: 100, row: 44, fit: true });
    expect(loadView('m1')?.ppf).toBe(4);
    expect(loadView('m2')?.ppf).toBe(9);
  });

  it('is null for a movie never saved', () => {
    expect(loadView('nothing')).toBeNull();
  });

  it('is null for a damaged entry', () => {
    localStorage.setItem('fm.tl.view.bad', '{not json');
    expect(loadView('bad')).toBeNull();
  });

  it('is null when a number field is missing or of the wrong type', () => {
    localStorage.setItem('fm.tl.view.a', JSON.stringify({ ppf: 3, start: 1 }));
    localStorage.setItem('fm.tl.view.b', JSON.stringify({ ppf: '3', start: 1, row: 2 }));
    expect(loadView('a')).toBeNull();
    expect(loadView('b')).toBeNull();
  });

  it('treats a missing fit flag as off', () => {
    localStorage.setItem('fm.tl.view.c', JSON.stringify({ ppf: 2, start: 3, row: 4 }));
    expect(loadView('c')).toEqual({ ppf: 2, start: 3, row: 4, fit: false });
  });

  it('drops unknown fields from a saved entry', () => {
    localStorage.setItem('fm.tl.view.d', JSON.stringify({ ppf: 2, start: 3, row: 4, fit: 1, extra: 'x' }));
    expect(loadView('d')).toEqual({ ppf: 2, start: 3, row: 4, fit: true });
  });
});
