import { beforeEach, describe, expect, it } from 'vitest';
import { tourSeen } from '@src/ui/tour';
import { updatePrefs } from '@src/ui/prefs';

beforeEach(() => {
  localStorage.clear();
});

describe('tourSeen', () => {
  it('is false on a fresh install', () => {
    expect(tourSeen()).toBe(false);
  });

  it('is true when the preference says the tour is done', () => {
    updatePrefs({ tourDone: true });
    expect(tourSeen()).toBe(true);
  });

  it('is true when the older stored flag is set', () => {
    localStorage.setItem('formmorpheus.tour', '1');
    expect(tourSeen()).toBe(true);
  });

  it('ignores any other value of the older stored flag', () => {
    localStorage.setItem('formmorpheus.tour', 'yes');
    expect(tourSeen()).toBe(false);
  });
});
