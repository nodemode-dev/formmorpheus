import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/media/key-thumbs', () => ({ THUMB_VERSION: 'tv1' }));

import { ThumbCache, blobHash } from '@src/media/thumb-cache';

const bytes = (n: number, seed = 0): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('blobHash', () => {
  it('gives the same hash for the same content', async () => {
    expect(await blobHash(new Blob([bytes(5000)]))).toBe(await blobHash(new Blob([bytes(5000)])));
  });

  it('starts with the size in base 36', async () => {
    const h = await blobHash(new Blob([bytes(100000)]));
    expect(h.split('-')[0]).toBe((100000).toString(36));
  });

  it('changes when a sampled byte changes', async () => {
    const a = bytes(5000);
    const b = bytes(5000);
    b[10] ^= 1;
    expect(await blobHash(new Blob([a]))).not.toBe(await blobHash(new Blob([b])));
  });

  it('notices a change in the last byte of a large blob', async () => {
    const a = bytes(300000);
    const b = bytes(300000);
    b[b.length - 1] ^= 255;
    expect(await blobHash(new Blob([a]))).not.toBe(await blobHash(new Blob([b])));
  });

  it('tells apart blobs that differ only in size', async () => {
    expect(await blobHash(new Blob([new Uint8Array(10)]))).not.toBe(await blobHash(new Blob([new Uint8Array(11)])));
  });

  it('hashes an empty blob', async () => {
    expect(await blobHash(new Blob([]))).toMatch(/^0-[0-9a-z]+$/);
  });
});

describe('ThumbCache without storage', () => {
  it('misses every key and stores nothing when indexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const c = new ThumbCache();
    await c.put('h|tv1|0|64', 2, 1, new Uint8ClampedArray(8));
    const got = await c.getMany(['h|tv1|0|64']);
    expect(got.size).toBe(0);
    expect(c.bytes).toBe(0);
  });

  it('returns an empty map for an empty key list', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect((await new ThumbCache().getMany([])).size).toBe(0);
  });
});
