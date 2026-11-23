import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/ui/i18n', () => ({ t: (s: string) => s }));

import { missingCapabilities, showUnsupported } from '@src/app/capability';

class GoodCanvas { getContext(): object { return {}; } }

function stubAll(): void {
  vi.stubGlobal('OffscreenCanvas', GoodCanvas);
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({}));
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('AudioContext', class {});
  vi.stubGlobal('CSS', { supports: () => true });
}

describe('missingCapabilities', () => {
  beforeEach(stubAll);
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('reports nothing when every capability is present', () => {
    expect(missingCapabilities()).toEqual([]);
  });

  it('reports one sentence when workers are missing', () => {
    vi.stubGlobal('Worker', undefined);
    expect(missingCapabilities()).toHaveLength(1);
  });

  it('reports every missing capability with a distinct sentence', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('CSS', undefined);
    const out = missingCapabilities();
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBe(5);
  });

  it('treats an offscreen surface that throws as missing', () => {
    vi.stubGlobal('OffscreenCanvas', class { constructor() { throw new Error('no'); } });
    expect(missingCapabilities()).toHaveLength(1);
  });

  it('treats an offscreen surface without a 2d context as missing', () => {
    vi.stubGlobal('OffscreenCanvas', class { getContext(): null { return null; } });
    expect(missingCapabilities()).toHaveLength(1);
  });

  it('treats a style engine without the needed selectors as missing', () => {
    vi.stubGlobal('CSS', { supports: (q: string) => !q.startsWith('selector') });
    expect(missingCapabilities()).toHaveLength(1);
  });

  it('treats a style check that throws as missing', () => {
    vi.stubGlobal('CSS', { supports: () => { throw new Error('old'); } });
    expect(missingCapabilities()).toHaveLength(1);
  });
});

describe('showUnsupported', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('adds one alert holding the title and every missing sentence', () => {
    showUnsupported(['First gap.', 'Second gap.'], 'Cannot start.');
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    const text = alerts[0].textContent ?? '';
    expect(text).toContain('Cannot start.');
    expect(text).toContain('First gap. Second gap.');
  });

  it('adds the system requirements line only for a system problem', () => {
    showUnsupported(['Gap.'], 'Title.', true);
    const withSystem = document.querySelector('[role="alert"] > div')?.children.length;
    document.body.innerHTML = '';
    showUnsupported(['Gap.'], 'Title.', false);
    const without = document.querySelector('[role="alert"] > div')?.children.length;
    expect(withSystem).toBe(3);
    expect(without).toBe(2);
  });
});
