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
  const now = (tMs - l.base) / UNIT, rw = x1 - x0;
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
          const v = (e - now) / FADE;
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
export function wetMark(id: string, w: number, x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, min: number, tMs: number, seconds: number): void {
  const l = layerOf(id, w, true)!;
  if (l.base < 0) l.base = tMs;
  const exp = Math.min(65535, Math.max(1, Math.round((tMs - l.base) / UNIT + seconds * 10 + FADE)));
  for (let y = y0; y < y1; y++) {
    const mo = y * w;
    for (let x = x0; x < x1; x++) {
      if (mask[mo + x] < min) continue;
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
