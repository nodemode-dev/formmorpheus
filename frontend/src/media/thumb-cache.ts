// Filmstrip thumbnails kept across reopen: IndexedDB, keyed by the video's content hash + time bucket + size.
// Raw RGBA rows (no encode cost); a meta store lets us evict the least recently used entries past a byte cap.
// Every call is wrapped: a browser without IndexedDB (private window, blocked storage) simply has no cache.

const DB = 'formmorpheus-thumbs';
const CAP_BYTES = 64 * 1024 * 1024;

interface Meta { key: string; bytes: number; used: number }
export interface CachedThumb { w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> }

const wrapReq = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const wrapTx = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export class ThumbCache {
  private db: Promise<IDBDatabase | null> | null = null;
  private index = new Map<string, Meta>();
  private total = 0;
  private dead = false;

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = (async () => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('meta', { keyPath: 'key' });
          req.result.createObjectStore('data');
        };
        const db = await wrapReq(req);
        const metas = await wrapReq(db.transaction('meta', 'readonly').objectStore('meta').getAll() as IDBRequest<Meta[]>);
        for (const m of metas) { this.index.set(m.key, m); this.total += m.bytes; }
        return db;
      } catch {
        this.dead = true;
        return null;
      }
    })();
    return this.db;
  }

  /** Cached thumbnails for these keys (missing keys are absent from the map). */
  async getMany(keys: string[]): Promise<Map<string, CachedThumb>> {
    const out = new Map<string, CachedThumb>();
    if (this.dead || !keys.length) return out;
    try {
      const db = await this.open();
      if (!db) return out;
      const want = keys.filter((k) => this.index.has(k));
      if (!want.length) return out;
      const tx = db.transaction(['data', 'meta'], 'readwrite');
      const data = tx.objectStore('data');
      const meta = tx.objectStore('meta');
      const now = Date.now();
      const reads = want.map(async (k) => {
        const v = (await wrapReq(data.get(k))) as { w: number; h: number; buf: ArrayBuffer } | undefined;
        if (!v) return;
        out.set(k, { w: v.w, h: v.h, rgba: new Uint8ClampedArray(v.buf) });
        const m = this.index.get(k);
        if (m) { m.used = now; meta.put(m); }
      });
      await Promise.all(reads);
      await wrapTx(tx);
    } catch { /* a failed read is a cache miss */ }
    return out;
  }

  async put(key: string, w: number, h: number, rgba: Uint8ClampedArray): Promise<void> {
    if (this.dead) return;
    try {
      const db = await this.open();
      if (!db || this.index.has(key)) return;
      const bytes = rgba.byteLength;
      const meta: Meta = { key, bytes, used: Date.now() };
      const tx = db.transaction(['data', 'meta'], 'readwrite');
      const buf = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + bytes);
      tx.objectStore('data').put({ w, h, buf }, key);
      tx.objectStore('meta').put(meta);
      this.index.set(key, meta);
      this.total += bytes;
      if (this.total > CAP_BYTES) {
        const oldest = [...this.index.values()].sort((a, b) => a.used - b.used);
        for (const m of oldest) {
          if (this.total <= CAP_BYTES * 0.9) break;
          if (m.key === key) continue;
          tx.objectStore('data').delete(m.key);
          tx.objectStore('meta').delete(m.key);
          this.index.delete(m.key);
          this.total -= m.bytes;
        }
      }
      await wrapTx(tx);
    } catch {
      // keep the in-memory index honest if the write failed
      this.index.delete(key);
    }
  }

  /** Bytes the cache believes it holds (for diagnostics). */
  get bytes(): number { return this.total; }
}

/** A cheap content hash of a blob: size plus a few sampled slices, so a reopened asset finds its thumbnails. */
export async function blobHash(blob: Blob): Promise<string> {
  const SLICE = 32 * 1024;
  const at = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.max(0, Math.min(blob.size - SLICE, Math.floor(blob.size * f - (f === 1 ? SLICE : 0)))));
  let a = 0x811c9dc5 | 0;
  let b = 0x01000193 ^ blob.size;
  for (const off of at) {
    const bytes = new Uint8Array(await blob.slice(off, off + SLICE).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) {
      a = Math.imul(a ^ bytes[i], 0x01000193);
      b = Math.imul(b + bytes[i] + i, 0x85ebca6b) ^ (b >>> 13);
    }
  }
  return `${blob.size.toString(36)}-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
