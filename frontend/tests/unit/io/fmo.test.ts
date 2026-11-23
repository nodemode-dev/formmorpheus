import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { newMovie } from '@src/engine/model';
import { FORMAT_VERSION, type Asset, type Movie } from '@src/engine/types';
import { MIME, packMovie, unpackMovie } from '@src/io/fmo';

const zipBlob = (files: Record<string, string>): Blob => {
  const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  return new Blob([z.buffer as ArrayBuffer]);
};
const manifest = (over: Record<string, unknown> = {}): string => JSON.stringify({ app: 'formmorpheus', format: FORMAT_VERSION, version: 'x', saved: 1, history: false, ...over });
const fontAsset = (id: string): Asset => ({ id, kind: 'font', name: 'face', mime: 'font/ttf', width: 0, height: 0, frames: 0, size: 3, family: 'Face' });
const withAsset = (m: Movie, a: Asset): Movie => ({ ...m, assets: { ...m.assets, [a.id]: a } });
const entriesOf = async (b: Blob): Promise<Record<string, Uint8Array>> => unzipSync(new Uint8Array(await b.arrayBuffer()));

describe('movie file round trip', () => {
  it('writes a blob with the movie mime type that reads back as the same movie', async () => {
    const movie = newMovie();
    const blob = await packMovie(movie, [], [], new Map(), null);
    expect(blob.type).toBe(MIME);
    const back = await unpackMovie(blob);
    expect(back.movie.id).toBe(movie.id);
    expect(back.movie.fps).toBe(movie.fps);
    expect(back.movie.duration).toBe(movie.duration);
    expect(back.past).toEqual([]);
    expect(back.recovery).toEqual([]);
    expect(back.playhead).toBeUndefined();
  });

  it('keeps the bytes and mime type of a referenced asset', async () => {
    const movie = withAsset(newMovie(), fontAsset('a1'));
    const blob = await packMovie(movie, [], [], new Map([['a1', new Blob([new Uint8Array([7, 8, 9])])]]), null);
    const back = await unpackMovie(blob);
    const got = back.assets.get('a1');
    expect(got?.type).toBe('font/ttf');
    expect(Array.from(new Uint8Array(await got!.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it('leaves out a blob whose asset the movie does not list', async () => {
    const blob = await packMovie(newMovie(), [], [], new Map([['stray', new Blob(['x'])]]), null);
    expect(Object.keys(await entriesOf(blob)).some((p) => p.startsWith('assets/'))).toBe(false);
  });

  it('leaves out a pixel asset that no saved state uses', async () => {
    const movie = withAsset(newMovie(), { ...fontAsset('p1'), kind: 'pixels', mime: 'image/png' } as Asset);
    const blob = await packMovie(movie, [], [], new Map([['p1', new Blob(['x'])]]), null);
    expect(Object.keys(await entriesOf(blob))).not.toContain('assets/p1');
  });

  it('round trips history step labels and recovery points', async () => {
    const movie = newMovie();
    const older = { ...movie, name: 'Older' };
    const blob = await packMovie(movie, [{ label: 'Rename', movie: older }], [{ id: 'r1', label: 'Safe', time: 5, movie: older }], new Map(), null);
    const back = await unpackMovie(blob);
    expect(back.past.map((s) => s.label)).toEqual(['Rename']);
    expect(back.past[0].movie.name).toBe('Older');
    expect(back.recovery).toHaveLength(1);
    expect(back.recovery[0]).toMatchObject({ id: 'r1', label: 'Safe', time: 5 });
    expect(back.recovery[0].movie.id).toBe(movie.id);
  });

  it('writes no history when asked to save without it', async () => {
    const movie = newMovie();
    const blob = await packMovie(movie, [{ label: 'Step', movie }], [], new Map(), null, false);
    expect(Object.keys(await entriesOf(blob))).not.toContain('history.json');
    expect((await unpackMovie(blob)).past).toEqual([]);
  });

  it('stores the poster and the preview when given', async () => {
    const blob = await packMovie(newMovie(), [], [], new Map(), new Blob(['p']), true, new Blob(['q']));
    const names = Object.keys(await entriesOf(blob));
    expect(names).toContain('poster.png');
    expect(names).toContain('preview.png');
  });

  it('floors the saved playhead and returns it', async () => {
    const blob = await packMovie(newMovie(), [], [], new Map(), null, true, null, 2.7);
    expect((await unpackMovie(blob)).playhead).toBe(2);
  });

  it('does not save a playhead of zero, a negative one or a non-finite one', async () => {
    for (const at of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const blob = await packMovie(newMovie(), [], [], new Map(), null, true, null, at);
      expect((await unpackMovie(blob)).playhead).toBeUndefined();
    }
  });

  it('clamps a playhead beyond the end to the last frame', async () => {
    const movie = newMovie();
    const blob = await packMovie(movie, [], [], new Map(), null, true, null, movie.duration + 500);
    expect((await unpackMovie(blob)).playhead).toBe(movie.duration - 1);
  });
});

describe('movie file refusals', () => {
  const movieJson = (): string => JSON.stringify(newMovie());

  it('refuses bytes that are not an archive', async () => {
    await expect(unpackMovie(new Blob(['plain text, not a zip']))).rejects.toThrow();
  });

  it('refuses an archive without a manifest', async () => {
    await expect(unpackMovie(zipBlob({ 'movie.json': movieJson() }))).rejects.toThrow(/not a FormMorpheus movie/);
  });

  it('refuses a manifest written by another app', async () => {
    await expect(unpackMovie(zipBlob({ 'manifest.json': manifest({ app: 'other' }), 'movie.json': movieJson() }))).rejects.toThrow(/not a FormMorpheus movie/);
  });

  it('refuses a file from a newer format', async () => {
    await expect(unpackMovie(zipBlob({ 'manifest.json': manifest({ format: FORMAT_VERSION + 1 }), 'movie.json': movieJson() }))).rejects.toThrow(/newer/);
  });

  it('refuses a manifest whose format is not a number', async () => {
    await expect(unpackMovie(zipBlob({ 'manifest.json': manifest({ format: '1' }), 'movie.json': movieJson() }))).rejects.toThrow(/newer/);
  });

  it('refuses a file without the movie itself', async () => {
    await expect(unpackMovie(zipBlob({ 'manifest.json': manifest() }))).rejects.toThrow(/damaged/);
  });

  it('refuses a manifest that is not JSON', async () => {
    await expect(unpackMovie(zipBlob({ 'manifest.json': '{oops', 'movie.json': movieJson() }))).rejects.toThrow();
  });

  it('opens the movie with empty history when the history record is damaged', async () => {
    const movie = newMovie();
    const back = await unpackMovie(zipBlob({ 'manifest.json': manifest({ history: true }), 'movie.json': JSON.stringify(movie), 'history.json': '{"labels":' }));
    expect(back.movie.id).toBe(movie.id);
    expect(back.past).toEqual([]);
    expect(back.recovery).toEqual([]);
  });

  it('gives an asset the movie does not describe a neutral mime type', async () => {
    const back = await unpackMovie(zipBlob({ 'manifest.json': manifest(), 'movie.json': movieJson(), 'assets/ghost': 'zz' }));
    expect(back.assets.get('ghost')?.type).toBe('application/octet-stream');
  });

  it('ignores a hand-edited playhead that is not a number', async () => {
    const back = await unpackMovie(zipBlob({ 'manifest.json': manifest({ playhead: '9' }), 'movie.json': movieJson() }));
    expect(back.playhead).toBeUndefined();
  });
});
