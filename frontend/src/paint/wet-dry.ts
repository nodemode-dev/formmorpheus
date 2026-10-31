// What a wet wash does as it dries, applied once when the stroke ends: pigment pools at the rim of the stroke
// (a darker, crisper edge) and settles into the valleys of the paper (granulation). Both are a change of the film's
// thickness m, applied as transmittance^m on the paint the stroke laid, so on paper the edge deepens in colour and on
// a transparent layer it gains alpha. Pure typed-array maths; deterministic (no random numbers).

export interface DryOptions {
  data: Uint8ClampedArray;
  w: number;
  /** Dirty box, max exclusive. */
  x0: number; y0: number; x1: number; y1: number;
  /** The stroke's coverage, 16 bit, one per pixel of the layer. */
  cov: Uint16Array;
  /** The stroke's untouched 64 px tiles (what the pixels were before the stroke). */
  snap: (Uint8ClampedArray | undefined)[];
  tilesX: number;
  /** 0 to 1 rim pooling (the brush's wet edges). */
  pool: number;
  /** 0 to 1 granulation from the paper tooth. */
  gran: number;
  /** Rim band width in pixels. */
  radius: number;
  /** 256 x 256 paper tooth, 0 (valley) to 1 (peak), canvas anchored. */
  tooth: Float32Array | null;
  lock: boolean;
  sel: Uint8Array | null;
}

const sstep = (a: number, b: number, x: number): number => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

/** Box blur of a rw x rh float map with a radius, zero outside the map (running sums, O(area)). */
function boxBlur(src: Float32Array, rw: number, rh: number, r: number): Float32Array {
  const tmp = new Float32Array(rw * rh), out = new Float32Array(rw * rh);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < rh; y++) {
    const o = y * rw;
    let s = 0;
    for (let x = 0; x <= r && x < rw; x++) s += src[o + x];
    for (let x = 0; x < rw; x++) {
      tmp[o + x] = s * inv;
      const add = x + r + 1, sub = x - r;
      if (add < rw) s += src[o + add];
      if (sub >= 0) s -= src[o + sub];
    }
  }
  for (let x = 0; x < rw; x++) {
    let s = 0;
    for (let y = 0; y <= r && y < rh; y++) s += tmp[y * rw + x];
    for (let y = 0; y < rh; y++) {
      out[y * rw + x] = s * inv;
      const add = y + r + 1, sub = y - r;
      if (add < rh) s += tmp[add * rw + x];
      if (sub >= 0) s -= tmp[sub * rw + x];
    }
  }
  return out;
}

export function dryWash(o: DryOptions): void {
  const { data, w, x0, y0, x1, y1, cov, snap, tilesX, pool, gran, tooth, lock, sel } = o;
  const rw = x1 - x0, rh = y1 - y0;
  if (rw <= 0 || rh <= 0 || (pool <= 0 && (gran <= 0 || !tooth))) return;
  let presence: Float32Array | null = null;
  let near: Float32Array | null = null;
  if (pool > 0) {
    presence = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      const co = (y0 + y) * w + x0;
      for (let x = 0; x < rw; x++) presence[y * rw + x] = sstep(0.02, 0.22, cov[co + x] / 65535);
    }
    near = boxBlur(presence, rw, rh, Math.max(1, Math.round(o.radius)));
  }
  for (let y = 0; y < rh; y++) {
    const py = y0 + y, co = py * w + x0, trow = (py >> 6) * tilesX, yo = (py & 63) << 6;
    for (let x = 0; x < rw; x++) {
      const c = cov[co + x] / 65535;
      if (c < 0.004) continue;
      const px = x0 + x, i = y * rw + x;
      let m = 1;
      if (pool > 0) {
        const p = presence![i];
        const e = Math.min(1, p * (1 - near![i]) * 2.3);
        m += pool * 2.3 * e;
      }
      if (gran > 0 && tooth) m += gran * (0.5 - tooth[((py & 255) << 8) | (px & 255)]) * 0.9;
      if (sel) m = 1 + (m - 1) * (sel[py * w + px] / 255);
      m = m < 0.4 ? 0.4 : m > 4 ? 4 : m;
      if (Math.abs(m - 1) < 0.01) continue;
      const t = snap[trow + (px >> 6)];
      if (!t) continue;
      const so = (yo | (px & 63)) << 2, di = (py * w + px) << 2;
      const sa = t[so + 3] / 255, da = data[di + 3] / 255;
      if (sa > 0.02) {
        for (let k = 0; k < 3; k++) {
          const s = t[so + k], d = data[di + k];
          if (s < 6) continue;
          const ratio = d >= s ? 1 : d / s;
          const target = s * Math.pow(ratio, m);
          data[di + k] = d + (target - d) * (sa > 1 ? 1 : sa);
        }
      }
      if (!lock && da > sa + 0.002 && sa < 0.999) {
        const film = (da - sa) / (1 - sa);
        const f2 = 1 - Math.pow(1 - (film > 1 ? 1 : film), m);
        data[di + 3] = (sa + (1 - sa) * f2) * 255 + 0.5;
      }
    }
  }
}
