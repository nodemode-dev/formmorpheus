import { beforeEach, describe, expect, it } from 'vitest';
import { tutorialsDone } from '@src/ui/tutorials';

const KEY = 'formmorpheus.tutorialsDone';

beforeEach(() => {
  localStorage.clear();
});

describe('tutorialsDone', () => {
  it('is empty when nothing is stored', () => {
    expect(tutorialsDone()).toEqual([]);
  });

  it('reads the stored list in order', () => {
    localStorage.setItem(KEY, JSON.stringify(['draw', 'animate']));
    expect(tutorialsDone()).toEqual(['draw', 'animate']);
  });

  it('drops entries that are not text', () => {
    localStorage.setItem(KEY, JSON.stringify(['draw', 3, null, { id: 'x' }, 'sound']));
    expect(tutorialsDone()).toEqual(['draw', 'sound']);
  });

  it('is empty when the stored value is not a list', () => {
    localStorage.setItem(KEY, JSON.stringify({ draw: true }));
    expect(tutorialsDone()).toEqual([]);
  });

  it('is empty when the stored value is not valid JSON', () => {
    localStorage.setItem(KEY, '[draw');
    expect(tutorialsDone()).toEqual([]);
  });
});
