/** A dual brush's second tip as a grain-like mask. The source app multiplies the main tip with a second tip stamped along
 *  the same stroke; this app has one tip and a grain, so the second tip's coverage is laid out as a 256 x 256 tile of
 *  dabs (at its spacing, scattered by its scatter) and used as the grain. Pure typed-array maths. */

const TILE = 256;
/** How many tile pixels one dab spans; the brush's grain scale turns this into the file's diameter. */
export const DUAL_DAB = 32;

export interface DualSource {
  /** The second tip's pixels (255 paints), or null for a soft round tip. */
  tip: { w: number; h: number; data: Uint8Array } | null;
  /** 0..1, for a round tip. */
  hardness: number;
  /** A fraction of the dab's diameter. */
  spacing: number;
  /** 0..1 of the dab, how far a dab strays. */
  scatter: number;
  /** Dabs per step. */
  count: number;
  flip: boolean;
}

/** The second tip drawn at DUAL_DAB pixels across (bilinear), as 0..1 coverage. */
function dab(src: DualSource): Float32Array {
  const S = DUAL_DAB, out = new Float32Array(S * S);
  if (src.tip) {
    const { w, h, data } = src.tip, k = Math.max(w, h) / S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) * k - (k * S - w) / 2 - 0.5, fy = (y + 0.5) * k - (k * S - h) / 2 - 0.5;
      if (fx < -0.5 || fy < -0.5 || fx > w - 0.5 || fy > h - 0.5) continue;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
      const a = data[y0 * w + x0] + (data[y0 * w + x1] - data[y0 * w + x0]) * tx, b = data[y1 * w + x0] + (data[y1 * w + x1] - data[y1 * w + x0]) * tx;
      out[y * S + x] = (a + (b - a) * ty) / 255;
    }
  } else {
    const R = S / 2, hard = Math.max(0, Math.min(0.98, src.hardness));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;
      out[y * S + x] = d >= 1 ? 0 : d <= hard ? 1 : 1 - (d - hard) / (1 - hard);
    }
  }
  if (src.flip) for (let y = 0; y < S; y++) for (let x = 0; x < S >> 1; x++) { const i = y * S + x, j = y * S + S - 1 - x, v = out[i]; out[i] = out[j]; out[j] = v; }
  return out;
}

/** The tile, in the tooth band (0.3 to 0.7 of the byte range) the grain engine reads; light holds paint. */
export function dualToGrain(src: DualSource): Uint8Array {
  const S = DUAL_DAB, d = dab(src), cov = new Float32Array(TILE * TILE);
  let seed = 0x9e3779b9;
  const rnd = (): number => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const step = Math.max(3, Math.round(S * Math.max(0.05, src.spacing)));
  const n = Math.max(1, Math.min(8, Math.round(src.count)));
  const stray = Math.max(0, src.scatter) * S;
  for (let row = 0, y0 = 0; y0 < TILE; row++, y0 += step) {
    for (let x0 = (row & 1) * (step >> 1); x0 < TILE; x0 += step) {
      for (let c = 0; c < n; c++) {
        const cx = x0 + (rnd() - 0.5) * 2 * stray, cy = y0 + (rnd() - 0.5) * 2 * stray;
        const ox = Math.round(cx - S / 2), oy = Math.round(cy - S / 2);
        for (let y = 0; y < S; y++) {
          const ty = (((oy + y) % TILE) + TILE) % TILE;
          for (let x = 0; x < S; x++) {
            const v = d[y * S + x];
            if (v <= 0) continue;
            const i = ty * TILE + ((((ox + x) % TILE) + TILE) % TILE);
            if (v > cov[i]) cov[i] = v;
          }
        }
      }
    }
  }
  const out = new Uint8Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = Math.round((0.3 + 0.4 * cov[i]) * 255);
  return out;
}
