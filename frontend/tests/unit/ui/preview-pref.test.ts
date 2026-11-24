import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'fm.previewSounds';

afterEach(() => {
  vi.unstubAllGlobals();
});

const fresh = async (): Promise<typeof import('@src/ui/preview-pref')> => {
  vi.resetModules();
  return import('@src/ui/preview-pref');
};

beforeEach(() => {
  localStorage.clear();
});

describe('previewSounds', () => {
  it('is on when nothing is stored', async () => {
    const { previewSounds } = await fresh();
    expect(previewSounds.on).toBe(true);
  });

  it('starts off when it was turned off before', async () => {
    localStorage.setItem(KEY, '0');
    const { previewSounds } = await fresh();
    expect(previewSounds.on).toBe(false);
  });

  it('treats any other stored value as on', async () => {
    localStorage.setItem(KEY, 'garbage');
    const { previewSounds } = await fresh();
    expect(previewSounds.on).toBe(true);
  });

  it('keeps a change across a reload', async () => {
    const first = await fresh();
    first.previewSounds.set(false);
    expect(first.previewSounds.on).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('0');
    const second = await fresh();
    expect(second.previewSounds.on).toBe(false);
    second.previewSounds.set(true);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('stays on and still changes in memory when storage is blocked', async () => {
    localStorage.setItem(KEY, '0');
    const blocked = (): never => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    const { previewSounds } = await fresh();
    expect(previewSounds.on).toBe(true);
    expect(() => previewSounds.set(false)).not.toThrow();
    expect(previewSounds.on).toBe(false);
  });
});
