// Waveform peaks kept across reopen (IndexedDB), so a reopened movie draws its sound at once instead of after the decode.
// Keyed by asset id and byte size; every call is wrapped, so a browser without storage simply has no cache.
import type { Peaks } from './audio';

const DB = 'formmorpheus-peaks';
const CAP = 200;

let db: Promise<IDBDatabase | null> | null = null;
const wrap = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function open(): Promise<IDBDatabase | null> {
  if (db) return db;
  db = (async () => {
    try {
      if (typeof indexedDB === 'undefined') return null;
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('peaks'); };
      return await wrap(req);
    } catch { return null; }
  })();
  return db;
}

export async function loadPeaks(key: string): Promise<Peaks | null> {
  try {
    const d = await open();
    if (!d) return null;
    const v = (await wrap(d.transaction('peaks', 'readonly').objectStore('peaks').get(key))) as { p: Peaks; t: number } | undefined;
    return v && v.p.min instanceof Float32Array ? v.p : null;
  } catch { return null; }
}

export async function savePeaks(key: string, p: Peaks): Promise<void> {
  try {
    const d = await open();
    if (!d) return;
    const store = d.transaction('peaks', 'readwrite').objectStore('peaks');
    store.put({ p, t: Date.now() }, key);
    // keep the newest CAP entries
    const keys = (await wrap(store.getAllKeys())) as string[];
    if (keys.length > CAP) {
      const all = (await wrap(store.getAll())) as Array<{ t: number }>;
      const order = keys.map((k, i) => ({ k, t: all[i]?.t ?? 0 })).sort((a, b) => a.t - b.t);
      for (const o of order.slice(0, keys.length - CAP)) store.delete(o.k);
    }
  } catch { /* no cache */ }
}
