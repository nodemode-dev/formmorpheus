import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const copyMovieTo = vi.fn<(name: string, dir: string) => Promise<void>>();
const toast = vi.fn<(msg: string, kind?: string) => void>();

vi.mock('@src/io/api', () => ({
  api: { copyMovieTo: (n: string, d: string) => copyMovieTo(n, d), readMovie: vi.fn() },
  capabilities: vi.fn(async () => null),
  downloadBlob: vi.fn(),
}));
vi.mock('@src/ui/library-folder', () => ({ LibraryFolderDialog: class { show(): Promise<void> { return Promise.resolve(); } } }));
vi.mock('@src/ui/toast', () => ({ toast: (m: string, k?: string) => toast(m, k) }));
vi.mock('@src/ui/theater-flip', () => ({ flipHome: vi.fn(), flipToCloud: vi.fn(), inCloudTheater: vi.fn(async () => false) }));
vi.mock('@src/platform', () => ({ platform: { kind: 'web' } }));
vi.mock('@src/ui/i18n', () => ({ t: (s: string) => s }));
vi.mock('@src/ui/i18n-fill', () => ({ tf: (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k])) }));

const { cloudFolder, setCloudFolder, cloudTarget, locations, copyMoviesToCloud } = await import('@src/ui/theater-storage');

const KEY = 'formmorpheus.cloudFolder';

function answer(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const f = vi.fn(async () => ({ ok, json: async () => body }) as Response);
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => {
  localStorage.clear();
  document.dispatchEvent(new CustomEvent('fm:library-changed'));
  copyMovieTo.mockReset();
  toast.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cloud folder setting', () => {
  it('is empty when nothing was chosen', () => {
    expect(cloudFolder()).toBe('');
  });

  it('remembers a chosen folder', () => {
    setCloudFolder('/Users/me/Sync/Movies');
    expect(cloudFolder()).toBe('/Users/me/Sync/Movies');
    expect(localStorage.getItem(KEY)).toBe('/Users/me/Sync/Movies');
  });

  it('forgets the folder when set to an empty string', () => {
    setCloudFolder('/a/b');
    setCloudFolder('');
    expect(cloudFolder()).toBe('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('announces every change with an fm:cloud-folder event', () => {
    const fn = vi.fn();
    document.addEventListener('fm:cloud-folder', fn);
    setCloudFolder('/x');
    setCloudFolder('');
    document.removeEventListener('fm:cloud-folder', fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('locations', () => {
  it('returns the engine answer', async () => {
    answer({ dir: '/lib', default: '/lib', source: 'default', icloud: null });
    expect(await locations()).toEqual({ dir: '/lib', default: '/lib', source: 'default', icloud: null });
  });

  it('is null when the engine answers with an error status', async () => {
    answer({}, false);
    expect(await locations()).toBeNull();
  });

  it('is null when the engine cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await locations()).toBeNull();
  });

  it('reuses a recent answer for a few seconds instead of asking again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const f = answer({ dir: '/one', default: '/one', source: 'default', icloud: null });
    await locations();
    vi.setSystemTime(1_000_000 + 3000);
    await locations();
    expect(f).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 4500);
    await locations();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('asks again after the library changes', async () => {
    const f = answer({ dir: '/one', default: '/one', source: 'default', icloud: null });
    await locations();
    document.dispatchEvent(new CustomEvent('fm:library-changed'));
    await locations();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('cloudTarget', () => {
  it('uses the chosen folder and names it by its last part', async () => {
    const f = answer({ dir: '/lib', default: '/lib', source: 'default', icloud: '/icloud' });
    setCloudFolder('/Users/me/Sync/Movies/');
    expect(await cloudTarget()).toEqual({ dir: '/Users/me/Sync/Movies/', name: 'Movies' });
    expect(f).not.toHaveBeenCalled();
  });

  it('names a Windows path by its last part', async () => {
    setCloudFolder('C:\\Users\\me\\Drive\\Clips');
    expect((await cloudTarget())?.name).toBe('Clips');
  });

  it('falls back to the iCloud Drive folder when none is chosen', async () => {
    answer({ dir: '/lib', default: '/lib', source: 'default', icloud: '/Users/me/iCloud' });
    expect((await cloudTarget())?.dir).toBe('/Users/me/iCloud');
  });

  it('is null when there is no chosen folder and no iCloud Drive', async () => {
    answer({ dir: '/lib', default: '/lib', source: 'default', icloud: null });
    expect(await cloudTarget()).toBeNull();
  });
});

describe('copyMoviesToCloud', () => {
  it('copies every movie into the cloud folder', async () => {
    setCloudFolder('/sync');
    copyMovieTo.mockResolvedValue(undefined);
    await copyMoviesToCloud(['a', 'b']);
    expect(copyMovieTo.mock.calls).toEqual([['a', '/sync'], ['b', '/sync']]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][1]).toBeUndefined();
  });

  it('copies nothing and reports an error when no cloud folder exists', async () => {
    answer({ dir: '/lib', default: '/lib', source: 'default', icloud: null });
    await copyMoviesToCloud(['a']);
    expect(copyMovieTo).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][1]).toBe('error');
  });

  it('reports the engine error when a copy fails', async () => {
    setCloudFolder('/sync');
    copyMovieTo.mockRejectedValue(new Error('disk full'));
    await copyMoviesToCloud(['a']);
    expect(toast).toHaveBeenCalledWith('disk full', 'error');
  });
});
