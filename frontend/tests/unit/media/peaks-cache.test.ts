import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('@src/media/peaks-cache');
type Peaks = Parameters<Mod['savePeaks']>[1];

class Req<T> {
  result!: T;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

function req<T>(fn: () => T): Req<T> {
  const r = new Req<T>();
  queueMicrotask(() => {
    try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); }
  });
  return r;
}

function fakeIdb(rows: Map<string, unknown>): { open: (name: string, v: number) => Req<unknown> } {
  const store = {
    get: (k: string) => req(() => rows.get(k)),
    put: (v: unknown, k: string) => req(() => { rows.set(k, v); return k; }),
    getAllKeys: () => req(() => [...rows.keys()]),
    getAll: () => req(() => [...rows.values()]),
    delete: (k: string) => req(() => { rows.delete(k); }),
  };
  const db = { createObjectStore: () => store, transaction: () => ({ objectStore: () => store }) };
  return {
    open: () => {
      const r = new Req<unknown>();
      queueMicrotask(() => { r.result = db; r.onupgradeneeded?.(); r.onsuccess?.(); });
      return r;
    },
  };
}

const peaks = (v: number): Peaks => ({ min: Float32Array.from([-v]), max: Float32Array.from([v]) }) as unknown as Peaks;

async function load(): Promise<Mod> {
  vi.resetModules();
  return import('@src/media/peaks-cache');
}

let clock = 0;
beforeEach(() => {
  clock = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++clock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('peaks cache', () => {
  it('has no cache and never throws without storage', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const m = await load();
    await expect(m.savePeaks('a:10', peaks(1))).resolves.toBeUndefined();
    await expect(m.loadPeaks('a:10')).resolves.toBeNull();
  });

  it('reads back what was saved under the same key', async () => {
    vi.stubGlobal('indexedDB', fakeIdb(new Map()));
    const m = await load();
    const p = peaks(0.5);
    await m.savePeaks('clip:2048', p);
    const got = await m.loadPeaks('clip:2048');
    expect(got).not.toBeNull();
    expect(Array.from((got as unknown as { max: Float32Array }).max)).toEqual([0.5]);
  });

  it('returns null for a key that was never saved', async () => {
    vi.stubGlobal('indexedDB', fakeIdb(new Map()));
    const m = await load();
    await m.savePeaks('one', peaks(1));
    await expect(m.loadPeaks('two')).resolves.toBeNull();
  });

  it('ignores a stored entry that does not hold typed arrays', async () => {
    const rows = new Map<string, unknown>([['old', { p: { min: [0], max: [1] }, t: 1 }]]);
    vi.stubGlobal('indexedDB', fakeIdb(rows));
    const m = await load();
    await expect(m.loadPeaks('old')).resolves.toBeNull();
  });

  it('keeps only the newest 200 entries', async () => {
    const rows = new Map<string, unknown>();
    vi.stubGlobal('indexedDB', fakeIdb(rows));
    const m = await load();
    for (let i = 0; i < 203; i++) await m.savePeaks(`k${i}`, peaks(i));
    expect(rows.size).toBe(200);
    expect(rows.has('k0')).toBe(false);
    expect(rows.has('k1')).toBe(false);
    expect(rows.has('k2')).toBe(false);
    expect(rows.has('k3')).toBe(true);
    expect(rows.has('k202')).toBe(true);
  });

  it('has no cache when opening the database throws', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('denied'); } });
    const m = await load();
    await expect(m.savePeaks('a', peaks(1))).resolves.toBeUndefined();
    await expect(m.loadPeaks('a')).resolves.toBeNull();
  });
});
