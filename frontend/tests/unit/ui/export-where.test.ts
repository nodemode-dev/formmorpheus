import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';

const features = vi.hoisted(() => ({ folderPicker: true }));
vi.mock('@src/platform', () => ({ platform: { features } }));
vi.mock('@src/ui/i18n', () => ({ t: (s: string) => s }));

import { canPickFolder, pickDestination, saveFileTo, saveFramesTo, type Dest } from '@src/ui/export-where';

class FakeDir {
  files = new Map<string, Blob>();
  dirs = new Map<string, FakeDir>();
  constructor(public name: string) {}
  async getFileHandle(n: string, opts?: { create?: boolean }): Promise<{ createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> }> {
    if (!this.files.has(n)) {
      if (!opts?.create) throw new DOMException('missing', 'NotFoundError');
      this.files.set(n, new Blob([]));
    }
    return {
      createWritable: async () => {
        let data = new Blob([]);
        return { write: async (d: Blob) => { data = d; }, close: async () => { this.files.set(n, data); } };
      },
    };
  }
  async getDirectoryHandle(n: string, opts?: { create?: boolean }): Promise<FakeDir> {
    let d = this.dirs.get(n);
    if (!d) {
      if (!opts?.create) throw new DOMException('missing', 'NotFoundError');
      d = new FakeDir(n);
      this.dirs.set(n, d);
    }
    return d;
  }
}

const browserDest = (dir: FakeDir): Dest => ({ kind: 'browser', dir: dir as unknown as FileSystemDirectoryHandle });
const win = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete win.showDirectoryPicker;
  features.folderPicker = true;
});

describe('saveFileTo in a browser folder', () => {
  it('writes the file and returns the folder and name', async () => {
    const dir = new FakeDir('Out');
    const where = await saveFileTo(browserDest(dir), new Blob(['hello']), 'movie.mp4');
    expect(where).toBe('Out/movie.mp4');
    expect(await dir.files.get('movie.mp4')?.text()).toBe('hello');
  });

  it('replaces characters a file name may not hold', async () => {
    const dir = new FakeDir('Out');
    const where = await saveFileTo(browserDest(dir), new Blob(['x']), 'a/b:c*d?.mp4');
    expect(where).toBe('Out/a-b-c-d-.mp4');
  });

  it('strips leading dots so no hidden or parent name is made', async () => {
    const dir = new FakeDir('Out');
    expect(await saveFileTo(browserDest(dir), new Blob(['x']), '..secret.mp4')).toBe('Out/secret.mp4');
    expect(await saveFileTo(browserDest(dir), new Blob(['x']), '...')).toBe('Out/export');
  });

  it('never replaces an existing file and numbers the new one', async () => {
    const dir = new FakeDir('Out');
    dir.files.set('movie.mp4', new Blob(['old']));
    expect(await saveFileTo(browserDest(dir), new Blob(['new']), 'movie.mp4')).toBe('Out/movie 2.mp4');
    expect(await saveFileTo(browserDest(dir), new Blob(['newer']), 'movie.mp4')).toBe('Out/movie 3.mp4');
    expect(await dir.files.get('movie.mp4')?.text()).toBe('old');
    expect(await dir.files.get('movie 2.mp4')?.text()).toBe('new');
  });

  it('counts a folder of the same name as taken', async () => {
    const dir = new FakeDir('Out');
    dir.dirs.set('clip.gif', new FakeDir('clip.gif'));
    expect(await saveFileTo(browserDest(dir), new Blob(['x']), 'clip.gif')).toBe('Out/clip 2.gif');
  });

  it('numbers a name without an extension at its end', async () => {
    const dir = new FakeDir('Out');
    dir.files.set('movie', new Blob(['old']));
    expect(await saveFileTo(browserDest(dir), new Blob(['x']), 'movie')).toBe('Out/movie 2');
  });
});

describe('saveFileTo through the engine', () => {
  it('posts the file with the folder and a cleaned name and returns the path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ path: '/home/me/a-b.mp4' }), { status: 200 }));
    const blob = new Blob(['data']);
    const where = await saveFileTo({ kind: 'engine', dir: '/home/me & you' }, blob, 'a/b.mp4');
    expect(where).toBe('/home/me/a-b.mp4');
    const [url, init] = fetchSpy.mock.calls[0];
    const u = new URL(String(url), 'http://localhost');
    expect(u.pathname).toBe('/api/save-to/file');
    expect(u.searchParams.get('dir')).toBe('/home/me & you');
    expect(u.searchParams.get('name')).toBe('a-b.mp4');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(blob);
  });

  it('rejects with the engine detail when the save is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: 'disk full' }), { status: 507 }));
    await expect(saveFileTo({ kind: 'engine', dir: '/x' }, new Blob(['d']), 'a.mp4')).rejects.toThrow('disk full');
  });

  it('rejects with an error when the refusal body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const err = await saveFileTo({ kind: 'engine', dir: '/x' }, new Blob(['d']), 'a.mp4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toBe('');
    expect((err as Error).message).not.toContain('boom');
  });
});

describe('saveFramesTo', () => {
  const zipBlob = (entries: Record<string, Uint8Array>): Blob => new Blob([zipSync(entries) as BlobPart]);

  it('unpacks the pictures into a new folder named after the movie', async () => {
    const dir = new FakeDir('Out');
    const zip = zipBlob({ 'seq/0001.png': strToU8('one'), 'seq/0002.png': strToU8('two') });
    const r = await saveFramesTo(browserDest(dir), zip, 'My: Movie');
    expect(r).toEqual({ where: 'Out/My- Movie', files: 2 });
    const sub = dir.dirs.get('My- Movie');
    expect(await sub?.files.get('0001.png')?.text()).toBe('one');
    expect(await sub?.files.get('0002.png')?.text()).toBe('two');
  });

  it('uses a numbered folder when the name is taken', async () => {
    const dir = new FakeDir('Out');
    dir.dirs.set('Movie', new FakeDir('Movie'));
    const r = await saveFramesTo(browserDest(dir), zipBlob({ 'a.png': strToU8('a') }), 'Movie');
    expect(r).toEqual({ where: 'Out/Movie 2', files: 1 });
    expect(dir.dirs.get('Movie')?.files.size).toBe(0);
  });

  it('posts the zip to the engine and reports its path and count', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ path: '/out/Movie', files: 7 }), { status: 200 }));
    const zip = zipBlob({ 'a.png': strToU8('a') });
    const r = await saveFramesTo({ kind: 'engine', dir: '/out' }, zip, 'Mo/vie');
    expect(r).toEqual({ where: '/out/Movie', files: 7 });
    const u = new URL(String(fetchSpy.mock.calls[0][0]), 'http://localhost');
    expect(u.pathname).toBe('/api/save-to/frames');
    expect(u.searchParams.get('folder')).toBe('Mo-vie');
    expect(unzipSync(new Uint8Array(await zip.arrayBuffer()))['a.png']).toBeDefined();
  });

  it('rejects when the engine refuses the frames', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: 'no room' }), { status: 400 }));
    await expect(saveFramesTo({ kind: 'engine', dir: '/out' }, zipBlob({ 'a.png': strToU8('a') }), 'M')).rejects.toThrow('no room');
  });
});

describe('canPickFolder and pickDestination', () => {
  it('cannot pick a folder without a picker or the desktop app', () => {
    expect(canPickFolder()).toBe(false);
  });

  it('can pick a folder when the browser has a directory picker', () => {
    win.showDirectoryPicker = vi.fn();
    expect(canPickFolder()).toBe(true);
  });

  it('cannot pick a folder when the platform turns the feature off', () => {
    win.showDirectoryPicker = vi.fn();
    features.folderPicker = false;
    expect(canPickFolder()).toBe(false);
  });

  it('reports unavailable when there is no picker', async () => {
    expect(await pickDestination()).toBe('unavailable');
  });

  it('returns the chosen browser folder', async () => {
    const dir = new FakeDir('Picked');
    const pick = vi.fn().mockResolvedValue(dir);
    win.showDirectoryPicker = pick;
    expect(await pickDestination()).toEqual({ kind: 'browser', dir });
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ mode: 'readwrite' }));
  });

  it('treats an instant refusal as unavailable rather than a cancel', async () => {
    win.showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException('no gesture', 'AbortError'));
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1010);
    expect(await pickDestination()).toBe('unavailable');
  });

  it('treats a later abort as the person cancelling', async () => {
    win.showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(3000);
    expect(await pickDestination()).toBeNull();
  });

  it('treats a non-abort failure as unavailable', async () => {
    win.showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException('denied', 'SecurityError'));
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(3000);
    expect(await pickDestination()).toBe('unavailable');
  });
});
