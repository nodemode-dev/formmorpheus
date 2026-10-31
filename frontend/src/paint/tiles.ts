// Sparse tile storage for the pixels of idle layers. A Drawing layer is mostly transparent, but a flat
// Raster holds width * height * 4 bytes (33 MB at 4K), so 200 layers cost 6.6 GB. A parked raster keeps only
// the 256 px tiles that hold ink, and `raster.data` turns back into a flat array the first time anything
// reads it, so the rest of the paint core never sees the difference. Pure typed arrays: no DOM.

import type { Raster } from './types';

export const PARK_TILE = 128;

interface Parked {
  cols: number;
  /** Null: empty. A number: every pixel of the tile is that 32-bit value. Else the tile's bytes. */
  tiles: (Uint8ClampedArray | number | null)[];
  /** Bytes of the tiles that exist. */
  bytes: number;
}

// Tiles are never written once parked (unpark copies them out), so two parked rasters may share one record.
const parked = new WeakMap<Raster, Parked>();
const lastUse = new WeakMap<Raster, number>();

/** Marks a raster as in use now: the document parks the least recently used first. */
export function noteUse(r: Raster): void {
  lastUse.set(r, Date.now());
}

export function usedAt(r: Raster): number {
  return lastUse.get(r) ?? 0;
}

export function isParked(r: Raster): boolean {
  return parked.has(r);
}

/** Bytes a raster holds right now: its tiles when parked (reading `data` would unpark it), else the flat array. */
export function rasterBytes(r: Raster): number {
  const p = parked.get(r);
  return p ? p.bytes : r.data.byteLength;
}

/** True for a parked raster with no ink at all (no tile exists). */
export function parkedEmpty(r: Raster): boolean {
  const p = parked.get(r);
  return !!p && p.bytes === 0;
}

function plain(r: Raster, data: Uint8ClampedArray): void {
  Object.defineProperty(r, 'data', { value: data, writable: true, configurable: true, enumerable: true });
}

function lazy(r: Raster): void {
  Object.defineProperty(r, 'data', {
    configurable: true,
    enumerable: true,
    get: () => unpark(r),
    set: (v: Uint8ClampedArray) => { parked.delete(r); plain(r, v); },
  });
}

/** Moves a raster's pixels into tiles (empty tiles are not kept). False when it is too small to bother or already parked. */
export function parkRaster(r: Raster): boolean {
  if (parked.has(r)) return false;
  const w = r.width, h = r.height;
  const d = r.data;
  if (w * h < 4096 || d.length !== w * h * 4) return false;
  const T = PARK_TILE;
  const cols = Math.ceil(w / T), rows = Math.ceil(h / T);
  const tiles: (Uint8ClampedArray | number | null)[] = new Array(cols * rows).fill(null);
  const u = d.byteOffset % 4 === 0 ? new Uint32Array(d.buffer, d.byteOffset, d.length >> 2) : null;
  let bytes = 0;
  for (let ty = 0; ty < rows; ty++) {
    const y0 = ty * T, th = Math.min(T, h - y0);
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * T, tw = Math.min(T, w - x0);
      let any = false;
      for (let y = 0; y < th && !any; y++) {
        const o = (y0 + y) * w + x0;
        if (u) { for (let x = 0; x < tw; x++) if (u[o + x] !== 0) { any = true; break; } }
        else for (let x = o * 4, e = (o + tw) * 4; x < e; x++) if (d[x] !== 0) { any = true; break; }
      }
      if (!any) continue;
      const t = new Uint8ClampedArray(tw * th * 4);
      for (let y = 0; y < th; y++) {
        const o = ((y0 + y) * w + x0) * 4;
        t.set(d.subarray(o, o + tw * 4), y * tw * 4);
      }
      // a flat fill (every pixel the same) is one value, not 256 KB
      const tu = new Uint32Array(t.buffer);
      let same = true;
      for (let i = 1; i < tu.length; i++) if (tu[i] !== tu[0]) { same = false; break; }
      if (same) { tiles[ty * cols + tx] = tu[0]; bytes += 4; } else { tiles[ty * cols + tx] = t; bytes += t.byteLength; }
    }
  }
  parked.set(r, { cols, tiles, bytes });
  lazy(r);
  return true;
}

/** Turns a parked raster back into a flat array (what reading `data` does); returns it. */
export function unpark(r: Raster): Uint8ClampedArray {
  const p = parked.get(r);
  if (!p) return r.data;
  const w = r.width, h = r.height, T = PARK_TILE;
  const data = new Uint8ClampedArray(w * h * 4);
  const du = new Uint32Array(data.buffer);
  for (let i = 0; i < p.tiles.length; i++) {
    const t = p.tiles[i];
    if (t === null) continue;
    const x0 = (i % p.cols) * T, y0 = Math.floor(i / p.cols) * T;
    const tw = Math.min(T, w - x0), th = Math.min(T, h - y0);
    if (typeof t === 'number') { for (let y = 0; y < th; y++) { const o = (y0 + y) * w + x0; du.fill(t, o, o + tw); } continue; }
    for (let y = 0; y < th; y++) data.set(t.subarray(y * tw * 4, (y + 1) * tw * 4), ((y0 + y) * w + x0) * 4);
  }
  parked.delete(r);
  plain(r, data);
  lastUse.set(r, Date.now());
  return data;
}

/** Calls `fn` for each tile that exists (position and size in pixels, its bytes); false when the raster is not parked. */
export function eachParkedTile(r: Raster, fn: (x: number, y: number, w: number, h: number, bytes: Uint8ClampedArray) => void): boolean {
  const p = parked.get(r);
  if (!p) return false;
  const w = r.width, h = r.height, T = PARK_TILE;
  for (let i = 0; i < p.tiles.length; i++) {
    const t = p.tiles[i];
    if (t === null) continue;
    const x0 = (i % p.cols) * T, y0 = Math.floor(i / p.cols) * T;
    const tw = Math.min(T, w - x0), th = Math.min(T, h - y0);
    if (typeof t === 'number') {
      const b = new Uint8ClampedArray(tw * th * 4);
      new Uint32Array(b.buffer).fill(t);
      fn(x0, y0, tw, th, b);
    } else fn(x0, y0, tw, th, t);
  }
  return true;
}

/** A copy of a raster; a parked one is copied for free (the tiles are shared until either is read). */
export function cloneRaster(r: Raster): Raster {
  const p = parked.get(r);
  if (!p) return { width: r.width, height: r.height, data: r.data.slice() };
  const c: Raster = { width: r.width, height: r.height, data: new Uint8ClampedArray(0) };
  parked.set(c, p);
  lazy(c);
  return c;
}
