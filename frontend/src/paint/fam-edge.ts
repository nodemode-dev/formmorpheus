// Dry-brush rim (v0.17.1): the outer band of a dab is cut by the paper's tooth and a little noise, so a stroke's edge
// breaks into the paper while its body stays solid. Opt-in per brush (`edgeBreak`, 0 or absent does nothing). The mask
// is anchored to the canvas, so every dab that reaches a pixel agrees on it and the broken edge survives dense stamping;
// it cuts deeper at light pressure (the dab's flow is low) and as the load runs down (burnout lowers the flow).
// Pure maths on the dab's coverage buffer; shared by the worker and the main thread.

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) & 0xffff) / 65535;
}

/** Value noise in 3 px cells (a tile of 42 x 42 cells, 126 px, that wraps), so the cut breaks the rim into small flakes
 *  rather than single pixels. Built once; a dab only looks it up. */
const T = 126;
let clumpTab: Float32Array | null = null;
function clumps(): Float32Array {
  if (clumpTab) return clumpTab;
  const t = new Float32Array(T * T), L = 42;
  for (let y = 0; y < T; y++) {
    const fy = y / 3, iy = Math.floor(fy);
    let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < T; x++) {
      const fx = x / 3, ix = Math.floor(fx);
      let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
      const a = hash2(ix, iy), b = hash2((ix + 1) % L, iy), c = hash2(ix, (iy + 1) % L), d = hash2((ix + 1) % L, (iy + 1) % L);
      t[y * T + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  clumpTab = t;
  return t;
}

const sstep = (a: number, b: number, x: number): number => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/**
 * Cut the rim of a dab. `ab` is the dab's coverage (bw x bh, origin x0,y0), `cx`,`cy` its centre, `rad` its radius,
 * `flow` its flow in 0..1, `amt` the brush's edgeBreak (about 1), `tooth` the stroke's 256 x 256 grain or null.
 */
export function edgeBreak(ab: Float32Array, bw: number, bh: number, x0: number, y0: number, cx: number, cy: number, rad: number, flow: number, amt: number, tooth: Float32Array | null): void {
  if (rad < 2) return;
  // dense stamping piles each rim pixel up to a solid one, so the cut has to reach well into the body edge (about a third of the radius)
  const band = Math.min(0.5, 0.2 + 0.15 * amt), inner = 1 - band;
  const lowp = 1 - Math.min(1, flow);
  const dry = Math.min(1, 0.6 + 1.2 * lowp) * Math.min(1.4, amt);
  const ir = 1 / rad, in2 = inner * inner, span = 1 - in2, tab = clumps();
  for (let y = 0; y < bh; y++) {
    const py = y0 + y, dy = (py + 0.5 - cy) * ir, row = y * bw, ty = (py % T) * T, gy = (py & 255) << 8;
    for (let x = 0; x < bw; x++) {
      const v = ab[row + x];
      if (v <= 0) continue;
      const px = x0 + x, dx = (px + 0.5 - cx) * ir, r2 = dx * dx + dy * dy;
      if (r2 < in2) continue;
      // e from the squared radius: no square root per pixel
      const u = (r2 - in2) / span, e = u >= 1 ? 1 : u * u * (3 - 2 * u);
      const hn = tab[ty + (px % T)];
      // summed noise is narrow around one half: stretch it, or the cut lands on one radius and the edge is crisp, not broken
      const raw = tooth ? 0.4 * tooth[gy | (px & 255)] + 0.6 * hn : hn;
      const n = 0.5 + (raw - 0.5) * 2.6;
      const thr = Math.sqrt(e) * dry * 1.3;
      if (n >= thr + 0.08) continue;
      ab[row + x] = n <= thr - 0.08 ? v * (1 - e) : v * (1 - e * (1 - sstep(thr - 0.08, thr + 0.08, n)));
    }
  }
}
