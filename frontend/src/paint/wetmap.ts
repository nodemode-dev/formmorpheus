// A layer's wet map: where a wash has been laid and how long it stays wet. A wet stroke laid over a still-wet wash
// bleeds into it (colours run together, no hard rim). There are no timers: each wet pixel keeps the time it dries,
// and its wetness is read lazily from the pen sample times of the stroke that asks. 64 px tiles, made when first
// touched, so a layer that was never washed costs nothing. Pure typed-array maths.

const TILE = 64;
/** Time unit: 0.1 s. */
const UNIT = 100;
/** A pixel is fully wet while more than this many units remain, and fades out over them. */
const FADE = 40;

interface LayerWet { base: number; tiles: Map<number, Uint16Array>; tilesX: number }

const layers = new Map<string, LayerWet>();

function layerOf(id: string, w: number, make: boolean): LayerWet | undefined {
  let l = layers.get(id);
  if (!l && make) {
    // a wash dries in seconds: only the most recent layers keep a map, so a long session or many movies cannot pile them up
    while (layers.size >= 24) layers.delete(layers.keys().next().value as string);
    l = { base: -1, tiles: new Map(), tilesX: Math.ceil(w / TILE) }; layers.set(id, l);
  }
  if (l && l.tilesX !== Math.ceil(w / TILE)) { layers.delete(id); return make ? layerOf(id, w, true) : undefined; }
  return l;
}

/** Wetness 0..1 of every pixel in the rect at time `tMs`, or null when nothing in it is wet. */
export function wetSample(id: string, w: number, x0: number, y0: number, x1: number, y1: number, tMs: number): Float32Array | null {
  const l = layerOf(id, w, false);
  if (!l || l.tiles.size === 0 || l.base < 0) return null;
  // times are whole units from an integer origin, so two threads with different origins read the same wetness bit for bit
  const now = tMs / UNIT, base = l.base, rw = x1 - x0;
  let out: Float32Array | null = null;
  for (let ty = y0 >> 6; ty <= (y1 - 1) >> 6; ty++) {
    for (let tx = x0 >> 6; tx <= (x1 - 1) >> 6; tx++) {
      const t = l.tiles.get(ty * l.tilesX + tx);
      if (!t) continue;
      const ya = Math.max(y0, ty * TILE), yb = Math.min(y1, ty * TILE + TILE), xa = Math.max(x0, tx * TILE), xb = Math.min(x1, tx * TILE + TILE);
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const e = t[((y & 63) << 6) | (x & 63)];
          if (e === 0) continue;
          const v = (e + base - now) / FADE;
          if (v <= 0) continue;
          if (!out) out = new Float32Array(rw * (y1 - y0));
          out[(y - y0) * rw + (x - x0)] = v > 1 ? 1 : v;
        }
      }
    }
  }
  return out;
}

/** Mark the pixels where `mask` (one byte per layer pixel) is at least `min` as wet from `tMs` for `seconds`. */
export function wetMark(id: string, w: number, x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, min: number, tMs: number, seconds: number, cols?: { top: Int32Array; bot: Int32Array }): void {
  record(id, w, x0, y0, x1, y1, mask, min, tMs, seconds, cols);
  mark(id, w, x0, y0, x1, y1, mask, min, tMs, seconds, cols);
}

function mark(id: string, w: number, x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, min: number, tMs: number, seconds: number, cols?: { top: Int32Array; bot: Int32Array }): void {
  const l = layerOf(id, w, true)!;
  if (l.base < 0) l.base = Math.floor(tMs / UNIT);
  const exp = Math.min(65535, Math.max(1, Math.round(tMs / UNIT + seconds * 10 + FADE) - l.base));
  // a long stroke marks only the rows each 64 px column of it reached, not its whole rectangle
  for (let cx = x0 >> 6; cx <= (x1 - 1) >> 6; cx++) {
    const xa = Math.max(x0, cx << 6), xb = Math.min(x1, (cx << 6) + TILE);
    const ya = cols ? Math.max(y0, cols.top[cx]) : y0, yb = cols ? Math.min(y1, cols.bot[cx]) : y1;
    for (let y = ya; y < yb; y++) {
      const mo = y * w;
      for (let x = xa; x < xb; x++) {
        if (mask[mo + x] < min) continue;
        const ti = (y >> 6) * l.tilesX + (x >> 6);
        let t = l.tiles.get(ti);
        if (!t) { t = new Uint16Array(TILE * TILE); l.tiles.set(ti, t); }
        const i = ((y & 63) << 6) | (x & 63);
        if (t[i] < exp) t[i] = exp;
      }
    }
  }
}

// ---- keeping two threads in step ---------------------------------------------------------------------------------
// The wet map lives in the thread that paints. A stroke painted in the worker and the next one painted on the page
// (or the other way round) must see the same wet paper, so each mark is also kept as a small record (the covered
// pixels as bits) that the other side takes with its next message and replays.

/** One wet mark in a form that crosses a thread boundary. */
export interface WetRecord { id: string; w: number; x0: number; y0: number; x1: number; y1: number; bits: Uint8Array; tMs: number; seconds: number }

let outbox: WetRecord[] = [];
const OUT_MAX = 8;

function record(id: string, w: number, x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, min: number, tMs: number, seconds: number, cols?: { top: Int32Array; bot: Int32Array }): void {
  const rw = x1 - x0, rh = y1 - y0, bits = new Uint8Array(Math.ceil((rw * rh) / 8));
  for (let cx = x0 >> 6; cx <= (x1 - 1) >> 6; cx++) {
    const xa = Math.max(x0, cx << 6), xb = Math.min(x1, (cx << 6) + TILE);
    const ya = cols ? Math.max(y0, cols.top[cx]) : y0, yb = cols ? Math.min(y1, cols.bot[cx]) : y1;
    for (let y = ya; y < yb; y++) {
      const mo = y * w;
      for (let x = xa; x < xb; x++) if (mask[mo + x] >= min) { const k = (y - y0) * rw + (x - x0); bits[k >> 3] |= 1 << (k & 7); }
    }
  }
  outbox.push({ id, w, x0, y0, x1, y1, bits, tMs, seconds });
  while (outbox.length > OUT_MAX) outbox.shift();
}

/** The marks made here that the other thread has not seen (empties the list). */
export function wetTake(): WetRecord[] {
  const o = outbox;
  outbox = [];
  return o;
}

/** Replays marks made by the other thread. They are not sent back. */
export function wetIngest(recs: WetRecord[]): void {
  for (const r of recs) {
    const rw = r.x1 - r.x0, rh = r.y1 - r.y0, mask = new Uint8Array(rw * rh);
    for (let k = 0; k < rw * rh; k++) if (r.bits[k >> 3] & (1 << (k & 7))) mask[k] = 255;
    markLocal(r, mask);
  }
}

function markLocal(r: WetRecord, mask: Uint8Array): void {
  const l = layerOf(r.id, r.w, true)!;
  if (l.base < 0) l.base = Math.floor(r.tMs / UNIT);
  const exp = Math.min(65535, Math.max(1, Math.round(r.tMs / UNIT + r.seconds * 10 + FADE) - l.base));
  const rw = r.x1 - r.x0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      if (!mask[(y - r.y0) * rw + (x - r.x0)]) continue;
      const ti = (y >> 6) * l.tilesX + (x >> 6);
      let t = l.tiles.get(ti);
      if (!t) { t = new Uint16Array(TILE * TILE); l.tiles.set(ti, t); }
      const i = ((y & 63) << 6) | (x & 63);
      if (t[i] < exp) t[i] = exp;
    }
  }
}

/** Forget a layer's wet map (the layer was cleared or replaced). */
export function wetForget(id: string): void { layers.delete(id); }
