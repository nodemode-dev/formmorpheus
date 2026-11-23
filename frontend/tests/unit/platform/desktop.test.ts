import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktop } from '@src/platform/desktop';
import { clipboard } from '@src/platform/common';
import type { PlatformInfo } from '@src/platform/types';

const info: PlatformInfo = { kind: 'desktop', appVersion: 'test', build: '1', os: 'linux' };

interface FakeClipboard {
  writeText: ReturnType<typeof vi.fn>;
  readText: ReturnType<typeof vi.fn>;
  write?: ReturnType<typeof vi.fn>;
  read?: ReturnType<typeof vi.fn>;
}

function useClipboard(fake: FakeClipboard): void {
  vi.stubGlobal('navigator', { clipboard: fake });
}

let clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createDesktop', () => {
  it('turns on every desktop feature', () => {
    const p = createDesktop(info);
    expect(p.kind).toBe('desktop');
    expect(p.info).toBe(info);
    expect(Object.values(p.features).every((v) => v === true)).toBe(true);
    expect(Object.keys(p.features).sort()).toEqual(['desktopMenus', 'folderPicker', 'liveRecoverySocket', 'mp3Export', 'penLink', 'pictureConvert', 'soundConvert']);
  });

  it('has no native share sheet, no pen extras and no reachable bridge', () => {
    const p = createDesktop(info);
    expect(p.share.native).toBe(false);
    expect(p.penExtras.available).toBe(false);
    expect(p.bridge.available).toBe(false);
    expect(p.bridge.post('ready')).toBe(false);
    const off = p.penExtras.on('squeeze', () => undefined);
    expect(off()).toBeUndefined();
  });

  it('saves a file as a hidden anchor download and revokes the URL later', async () => {
    vi.useFakeTimers();
    const p = createDesktop(info);
    const blob = new Blob(['abc'], { type: 'text/plain' });
    await p.files.save(blob, 'scene.fmp');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('scene.fmp');
    expect(clicked[0].getAttribute('href')).toBe('blob:fake-1');
    expect(clicked[0].isConnected).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
  });

  it('shares a file by downloading it', async () => {
    const p = createDesktop(info);
    const ok = await p.share.share({ file: { blob: new Blob(['x']), name: 'clip.gif' } });
    expect(ok).toBe(true);
    expect(clicked.map((a) => a.download)).toEqual(['clip.gif']);
  });

  it('shares text and a link by copying them joined with a space', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard({ writeText, readText: vi.fn() });
    const p = createDesktop(info);
    await expect(p.share.share({ text: 'look', url: 'https://example.test/a' })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('look https://example.test/a');
  });

  it('refuses to share when there is nothing to share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    useClipboard({ writeText, readText: vi.fn() });
    const p = createDesktop(info);
    await expect(p.share.share({ text: '', url: '' })).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('common clipboard', () => {
  it('reports false when writing text is refused', async () => {
    useClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')), readText: vi.fn() });
    await expect(clipboard.writeText('x')).resolves.toBe(false);
  });

  it('reads an empty string when reading is refused or empty', async () => {
    useClipboard({ writeText: vi.fn(), readText: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(clipboard.readText()).resolves.toBe('');
    useClipboard({ writeText: vi.fn(), readText: vi.fn().mockResolvedValue(undefined) });
    await expect(clipboard.readText()).resolves.toBe('');
    useClipboard({ writeText: vi.fn(), readText: vi.fn().mockResolvedValue('hello') });
    await expect(clipboard.readText()).resolves.toBe('hello');
  });

  it('returns the first image item from the clipboard', async () => {
    const png = new Blob(['p'], { type: 'image/png' });
    const getType = vi.fn().mockResolvedValue(png);
    const read = vi.fn().mockResolvedValue([
      { types: ['text/plain'], getType: vi.fn() },
      { types: ['text/html', 'image/png'], getType },
    ]);
    useClipboard({ writeText: vi.fn(), readText: vi.fn(), read });
    await expect(clipboard.readImage()).resolves.toBe(png);
    expect(getType).toHaveBeenCalledWith('image/png');
  });

  it('returns null when there is no image, no read support or reading fails', async () => {
    useClipboard({ writeText: vi.fn(), readText: vi.fn(), read: vi.fn().mockResolvedValue([{ types: ['text/plain'], getType: vi.fn() }]) });
    await expect(clipboard.readImage()).resolves.toBeNull();
    useClipboard({ writeText: vi.fn(), readText: vi.fn() });
    await expect(clipboard.readImage()).resolves.toBeNull();
    useClipboard({ writeText: vi.fn(), readText: vi.fn(), read: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(clipboard.readImage()).resolves.toBeNull();
  });

  it('refuses to write an image without clipboard write support', async () => {
    useClipboard({ writeText: vi.fn(), readText: vi.fn() });
    await expect(clipboard.writeImage(new Blob(['p'], { type: 'image/png' }))).resolves.toBe(false);
  });

  it('writes an image as a png clipboard item when supported', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    useClipboard({ writeText: vi.fn(), readText: vi.fn(), write });
    class FakeItem { constructor(public items: Record<string, Blob>) {} }
    vi.stubGlobal('ClipboardItem', FakeItem);
    const png = new Blob(['p'], { type: 'image/png' });
    await expect(clipboard.writeImage(png)).resolves.toBe(true);
    const arg = write.mock.calls[0][0] as FakeItem[];
    expect(arg[0].items).toEqual({ 'image/png': png });
  });
});
