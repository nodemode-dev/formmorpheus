// Grain feature size against dab size (v0.17.0). A coarse tile (blobs, pits, cells) laid by a hairline dab shows its
// features as pale rectangular patches along the stroke, because one feature is wider than the stroke. The fit finds
// how wide a tile's features are once, and returns the scale that brings them down to about the dab width. Fine tiles
// (pencil tooth, speckle) are already smaller than any dab and are left alone. Pure maths, shared by worker and main.

const cache = new WeakMap<ArrayLike<number>, number>();

/** Feature width of a 256 x 256 tile in pixels: twice the lag where its correlation first falls below one half. */
export function grainFeature(g: ArrayLike<number>): number {
  const hit = cache.get(g);
  if (hit !== undefined) return hit;
  let m = 0;
  for (let i = 0; i < 65536; i += 7) m += g[i];
  m /= Math.ceil(65536 / 7);
  let v = 0, n = 0;
  for (let i = 0; i < 65536; i += 7) { const d = g[i] - m; v += d * d; n++; }
  v /= n;
  let feat = 2;
  if (v > 1e-8) {
    feat = 128;
    for (let L = 1; L <= 64; L++) {
      let c = 0, k = 0;
      for (let y = 0; y < 256; y += 5) {
        const r = y << 8, rl = ((y + L) & 255) << 8;
        for (let x = 0; x < 256; x += 5) {
          const d = g[r | x] - m;
          c += d * (g[r | ((x + L) & 255)] - m) + d * (g[rl | x] - m);
          k += 2;
        }
      }
      if (c / k / v < 0.5) { feat = 2 * L; break; }
    }
  }
  cache.set(g, feat);
  return feat;
}

/** Extra grain scale (at most 1, at least 0.25) for a dab of diameter `dia` laid with tile `g` stretched by `gs`. */
export function grainFit(g: ArrayLike<number>, dia: number, gs: number): number {
  const feat = grainFeature(g) * gs;  const want = Math.max(2, dia) * 0.7;
  return feat <= want ? 1 : Math.max(0.25, want / feat);
}
