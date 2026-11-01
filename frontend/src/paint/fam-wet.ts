// Watercolor and wet inks: the parts of a wash that a smooth film does not give. Pure maths, deterministic.
// A dried wash is never an even tint: pigment settles in blotches (low-frequency thickness variation), pools
// darker where the pen lingered and at the rim, and stays thin where the brush ran fast.

const hash = (x: number, y: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Smooth value noise, 0..1, one lattice cell per `cell` pixels. */
function vnoise(x: number, y: number, cell: number): number {
  const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
  let tx = fx - ix, ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * Thickness factor for the interior of a dried wash at a pixel (about 0.7 to 1.35): blotches of settled pigment at the
 * scale of the stroke and a finer mottle. `dia` is the stroke's base diameter, `amt` 0..1 the brush's wet edges,
 * `inner` 0 at the rim and 1 deep inside (the rim keeps its own pooling), `t` the pressure share of the stroke (0 light, 1 firm).
 */
export function washVariation(px: number, py: number, dia: number, amt: number, inner: number): number {
  const big = vnoise(px + 17, py + 91, Math.max(24, dia * 1.6));
  const small = vnoise(px + 503, py + 211, Math.max(7, dia * 0.35));
  const v = (big - 0.5) * 0.9 + (small - 0.5) * 0.5;
  return 1 + v * 0.55 * Math.min(1, 0.35 + amt) * inner;
}
