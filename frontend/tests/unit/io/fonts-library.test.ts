import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Movie } from '@src/engine/types';

type Lib = typeof import('@src/io/fonts-library');
const load = async (): Promise<Lib> => { vi.resetModules(); return import('@src/io/fonts-library'); };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const two = { items: [{ file: 'a.ttf', family: 'Alpha', size: 3 }, { file: 'a-bold.otf', family: 'Alpha', size: 4 }, { file: 'b.woff2', family: 'Beta', size: 5 }] };
const serve = (): ReturnType<typeof vi.fn> => {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/fonts') return json(two);
    return new Response('bytes');
  });
  vi.stubGlobal('fetch', f);
  return f;
};

describe('fonts library', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('stays empty and not ready when the engine cannot be reached', async () => {
    const lib = await load();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const register = vi.fn(async () => undefined);
    await lib.loadLibrary(register);
    expect(lib.libraryReady()).toBe(false);
    expect(lib.libraryFonts()).toEqual([]);
    expect(register).not.toHaveBeenCalled();
  });

  it('stays not ready when the engine answers with an error', async () => {
    const lib = await load();
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    await lib.loadLibrary(vi.fn(async () => undefined));
    expect(lib.libraryReady()).toBe(false);
  });

  it('loads the list, registers every file and tells its watchers', async () => {
    const lib = await load();
    serve();
    const register = vi.fn(async () => undefined);
    const seen = vi.fn();
    const off = lib.onLibraryChange(seen);
    await lib.loadLibrary(register);
    expect(lib.libraryReady()).toBe(true);
    expect(lib.libraryFamilies()).toEqual(['Alpha', 'Beta']);
    expect(register.mock.calls.map((c) => [c[0], c[1]])).toEqual([['lib:a.ttf', 'Alpha'], ['lib:a-bold.otf', 'Alpha'], ['lib:b.woff2', 'Beta']]);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    await lib.loadLibrary(register);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps loading when one font fails to register', async () => {
    const lib = await load();
    serve();
    await lib.loadLibrary(vi.fn(async (key: string) => { if (key === 'lib:a.ttf') throw new Error('damaged'); }));
    expect(lib.inLibrary('Alpha')).toBe(true);
    expect(lib.inLibrary('Gamma')).toBe(false);
  });

  it('adds a font with an encoded name and replaces an entry of the same file', async () => {
    const lib = await load();
    const f = vi.fn(async () => json({ file: 'my font.ttf', family: 'Mine', size: 9 }));
    vi.stubGlobal('fetch', f);
    const register = vi.fn(async () => undefined);
    expect(await lib.addToLibrary(new Blob(['x']), 'my font.ttf', 'Mine & Co', register)).toBe(true);
    expect(await lib.addToLibrary(new Blob(['y']), 'my font.ttf', 'Mine & Co', register)).toBe(true);
    expect(f.mock.calls[0][0]).toBe('/api/fonts/my%20font.ttf?family=Mine%20%26%20Co');
    expect(lib.libraryFonts()).toEqual([{ file: 'my font.ttf', family: 'Mine', size: 9 }]);
    expect(register).toHaveBeenCalledWith('lib:my font.ttf', 'Mine', expect.any(Blob));
  });

  it('reports failure and adds nothing when the engine refuses a font', async () => {
    const lib = await load();
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 413)));
    expect(await lib.addToLibrary(new Blob(['x']), 'big.ttf', 'Big', vi.fn(async () => undefined))).toBe(false);
    expect(lib.libraryFonts()).toEqual([]);
  });

  it('removes every file of a family and unregisters each', async () => {
    const lib = await load();
    serve();
    await lib.loadLibrary(vi.fn(async () => undefined));
    const unregister = vi.fn();
    expect(await lib.removeFamily('Alpha', unregister)).toBe(true);
    expect(lib.libraryFamilies()).toEqual(['Beta']);
    expect(unregister.mock.calls.map((c) => c[0])).toEqual(['lib:a.ttf', 'lib:a-bold.otf']);
  });

  it('treats a file already gone from the engine as removed', async () => {
    const lib = await load();
    serve();
    await lib.loadLibrary(vi.fn(async () => undefined));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    expect(await lib.removeFamily('Beta', vi.fn())).toBe(true);
    expect(lib.inLibrary('Beta')).toBe(false);
  });

  it('keeps a file the engine would not delete and reports failure', async () => {
    const lib = await load();
    serve();
    await lib.loadLibrary(vi.fn(async () => undefined));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    const unregister = vi.fn();
    expect(await lib.removeFamily('Beta', unregister)).toBe(false);
    expect(lib.inLibrary('Beta')).toBe(true);
    expect(unregister).not.toHaveBeenCalled();
  });

  it('lists the library families a movie uses in text, nested groups included, but does not carry yet', async () => {
    const lib = await load();
    serve();
    await lib.loadLibrary(vi.fn(async () => undefined));
    const movie = {
      assets: { f1: { id: 'f1', kind: 'font', family: 'Alpha' } },
      tracks: [{ content: [
        { kind: 'text', text: { font: 'Alpha', runs: [{ font: 'Unknown' }] } },
        { kind: 'group', tracks: [{ content: [{ kind: 'text', text: { font: 'Elsewhere', runs: [{ font: 'Beta' }] } }] }] },
      ] }],
    } as unknown as Movie;
    expect(lib.missingEmbeds(movie)).toEqual(['Beta']);
  });
});
