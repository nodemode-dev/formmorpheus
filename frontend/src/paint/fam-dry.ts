// Dry media on their side (charcoal, willow, pastel, graphite): the wide mark of a leaning pen is a swath of stamps at
// the tip's own size. The stamps sit close enough that no gap is left between rows (a sparse grid read as hollow
// rails), and each lays only its share of the flow so the many overlaps do not turn the swath solid or dark.

/** True for a grid corner that lies outside the swath's rounded outline, so the mark ends in a curve and not a square. */
export function swathCorner(u: number, v: number, spanA: number, spanB: number): boolean {
  if (spanA <= 0 || spanB <= 0) return false;
  const a = (2 * u) / spanA, b = (2 * v) / spanB;
  return a * a + b * b > 1.5;
}

/** Stamps along (nA) and across (nB) a lean swath of span spanA by spanB, for stamps of diameter d0, and the flow share of each. */
export function swathGrid(spanA: number, spanB: number, d0: number): { nA: number; nB: number; flowK: number } {
  const cells = (c: number): [number, number] => [Math.max(2, Math.ceil(spanA / c) + 1), Math.max(1, Math.ceil(spanB / c) + 1)];
  let c = Math.max(0.6, d0 * 0.36);
  let [nA, nB] = cells(c);
  // bounded cost: a very wide swath loosens its grid evenly, never past a gap between neighbouring stamps
  for (let g = 0; g < 8 && nA * nB > 150 && c < d0 * 0.6; g++) { c *= 1.12; [nA, nB] = cells(c); }
  const cover = (nA * nB * d0 * d0 * 0.785) / Math.max(1, (spanA + d0) * (spanB + d0));
  return { nA, nB, flowK: Math.min(1, Math.max(0.2, 1 / Math.sqrt(Math.max(1, cover)))) };
}
