import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importScale, importSize, setImportSize } from '@src/media/import-size';
import { scaleFor } from '@src/engine/fit-ops';

beforeEach(() => { localStorage.clear(); });

describe('importSize', () => {
  it('defaults to fit when nothing is kept', () => {
    expect(importSize()).toBe('fit');
  });

  it('reads back each mode that was set', () => {
    for (const mode of ['fill', 'original', 'fit'] as const) {
      setImportSize(mode);
      expect(importSize()).toBe(mode);
    }
  });

  it('falls back to fit for an unknown stored value', () => {
    localStorage.setItem('fm.importSize', 'stretch');
    expect(importSize()).toBe('fit');
  });

  it('falls back to fit when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(importSize()).toBe('fit');
  });

  it('does not throw when storage refuses a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => setImportSize('fill')).not.toThrow();
  });
});

describe('importScale', () => {
  it('scales with the mode that is kept', () => {
    setImportSize('fill');
    expect(importScale(1920, 1080, 800, 800)).toBe(scaleFor('fill', 1920, 1080, 800, 800));
    setImportSize('fit');
    expect(importScale(1920, 1080, 800, 800)).toBe(scaleFor('fit', 1920, 1080, 800, 800));
  });

  it('gives a different scale for fit and fill on a picture of another shape', () => {
    setImportSize('fill');
    const fill = importScale(1920, 1080, 1000, 1000);
    setImportSize('fit');
    const fit = importScale(1920, 1080, 1000, 1000);
    expect(fill).toBeGreaterThan(fit);
  });
});
