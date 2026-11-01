// The paper's own tooth: one 512 x 512 height map of fine value noise (three octaves), seamless on both axes,
// the same on every page and worker (no random numbers), made on first use. Pigment of a wash settles into its
// valleys (granulation). It is a field of its own, not the brush's grain tile, so a long wash shows paper, not a
// repeating tile. Pure typed-array maths.

const N = 512;
let map: Float32Array | null = null;

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Periodic value noise: `cells` lattice points across the map. */
function octave(out: Float32Array, cells: number, seed: number, weight: number): void {
  const lat = new Float32Array(cells * cells);
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) lat[y * cells + x] = hash(x, y, seed);
  const k = cells / N;
  for (let y = 0; y < N; y++) {
    const fy = y * k, y0 = Math.floor(fy), ty0 = fy - y0, ty = ty0 * ty0 * (3 - 2 * ty0), ya = (y0 % cells) * cells, yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < N; x++) {
      const fx = x * k, x0 = Math.floor(fx), tx0 = fx - x0, tx = tx0 * tx0 * (3 - 2 * tx0), xa = x0 % cells, xb = (x0 + 1) % cells;
      const top = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * tx, bot = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * tx;
      out[y * N + x] += (top + (bot - top) * ty) * weight;
    }
  }
}

/** The paper map, 0 (valley) to 1 (peak), contrast stretched around 0.5. Index with `((y & 511) << 9) | (x & 511)`. */
export function paperMap(): Float32Array {
  if (map) return map;
  const m = new Float32Array(N * N);
  octave(m, 170, 11, 0.5);
  octave(m, 75, 23, 0.3);
  octave(m, 31, 37, 0.2);
  for (let i = 0; i < m.length; i++) { const v = 0.5 + (m[i] - 0.5) * 2.4; m[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  map = m;
  return m;
}
