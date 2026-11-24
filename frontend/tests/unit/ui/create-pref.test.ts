import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPaintOnCreate, setOpenPaintOnCreate } from '@src/ui/create-pref';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('openPaintOnCreate', () => {
  it('is on when no choice has been stored', () => {
    expect(openPaintOnCreate()).toBe(true);
  });

  it('round trips a choice to turn it off and back on', () => {
    setOpenPaintOnCreate(false);
    expect(openPaintOnCreate()).toBe(false);
    setOpenPaintOnCreate(true);
    expect(openPaintOnCreate()).toBe(true);
  });

  it('treats any stored value other than off as on', () => {
    localStorage.setItem('formmorpheus.openPaintOnCreate', 'garbage');
    expect(openPaintOnCreate()).toBe(true);
  });

  it('is on when storage cannot be read', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(openPaintOnCreate()).toBe(true);
  });

  it('does not throw when storage refuses the write', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(() => setOpenPaintOnCreate(false)).not.toThrow();
  });
});
