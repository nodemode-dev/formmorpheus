// Stamps for opaque paint and body texture (paint family, v0.17.0): a solid body whose edge is made of hairs.
// Every hair is a column of the stamp that runs along the stroke (the stamp turns with the stroke), so the stroke's
// side is combed into strands and its start and end are ragged by hair length, not a clean round cap. The body is
// solid, the edge ramp is wide so canvas grain bites there first: grain at the rim, solid in the middle.
// Pure maths on typed arrays. tips-lib.ts calls `paintTips` once with its drawing helpers.

export interface TipHelpers {
  per: (fn: (x: number, y: number) => number) => (b: Float32Array) => void;
  sstep: (a: number, b: number, x: number) => number;
  pvn: (u: number, v: number, fx: number, fy: number, s: number) => number;
  fbm: (u: number, v: number, fx: number, fy: number, oct: number, s: number, gain?: number) => number;
}
export interface TipDef { id: string; name: string; group: string; fill: (b: Float32Array) => void }

function hash(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Body {
  /** Columns of hair across the stamp's width. */
  cols: number;
  /** Half width and half height of the body in stamp units (the stamp spans -1 to 1). */
  hw: number; hh: number;
  /** Corner squareness: 2 is an ellipse, larger is a rounder rectangle. */
  n: number;
  /** Width of the edge ramp, a share of the body size. */
  ramp: number;
  /** How much shorter than the full length a hair may be (0 to 1). */
  lenVar: number;
  /** How many outer hairs are missing or faint (0 to 1). */
  stray: number;
  /** Slight alpha texture of the body between hairs (0 to 0.4). */
  streak: number;
  seed: number;
}

function paintBody(h: TipHelpers, o: Body): (b: Float32Array) => void {
  return h.per((x, y) => {
    const ci = Math.floor((x + 1) * 0.5 * o.cols);
    const h1 = hash(ci, o.seed), h2 = hash(ci, o.seed + 77), h3 = hash(ci >> 1, o.seed + 31);
    const ux = Math.abs(x) / o.hw, uy = Math.abs(y) / o.hh;
    // body radius in its own superellipse metric: 1 at the rim
    const r = Math.pow(Math.pow(ux, o.n) + Math.pow(uy, o.n), 1 / o.n);
    // each hair ends a little short of the rim at its two ends
    const reach = 1 - o.lenVar * (0.35 * h1 + 0.65 * h1 * h1);
    const rr = ux > 0.001 ? Math.pow(Math.pow(ux, o.n) + Math.pow(uy / Math.max(0.2, reach), o.n), 1 / o.n) : r;
    let a = 1 - h.sstep(1 - o.ramp, 1, Math.max(r * 0.6 + rr * 0.4, r));
    // outer hairs: the farther out, the likelier a hair is missing or only half loaded
    const out = h.sstep(0.62, 1.02, ux);
    const miss = out * o.stray;
    if (h2 < miss * 0.9) a *= 0.12 + 0.3 * h2;
    else a *= 1 - miss * 0.35 * h3;
    // fine tone between hairs, along the stroke
    a *= 1 - o.streak * (0.5 * h1 + 0.5 * h.pvn((x + 1) * 0.5, (y + 1) * 0.5, 60, 3, o.seed + 5));
    return a;
  });
}

/** A fine particle cloud, denser at the middle, with the particles spread evenly (a golden-angle spiral with stratified radii)
 *  so no clump survives when thousands of rotated stamps overlap: a mist, not a row of clouds. */
function sprayMist(count: number, seed: number): (b: Float32Array) => void {
  return (b) => {
    const S = 256, H = 128;
    for (let k = 0; k < count; k++) {
      const u = (k + hash(k, seed)) / count;
      // inverse of a gaussian-ish radial density: dense core, thin rim
      const d = Math.min(0.96, 0.62 * Math.sqrt(-Math.log(1 - 0.985 * u)) * 0.85);
      const a = k * 2.399963 + hash(k, seed + 9) * 0.9;
      const cx = H + Math.cos(a) * d * H, cy = H + Math.sin(a) * d * H;
      const r = 0.7 + hash(k, seed + 3) * 0.8, al = 0.55 + 0.45 * hash(k, seed + 5);
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(S - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(S - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (dd >= r) continue;
        const v = al * (1 - dd / r);
        if (v > b[y * S + x]) b[y * S + x] = v;
      }
    }
  };
}

export function paintTips(h: TipHelpers): TipDef[] {
  const d = (id: string, name: string, o: Body): TipDef => ({ id, name, group: 'Paint', fill: paintBody(h, o) });
  return [
    { id: 'spray-mist', name: 'Spray mist', group: 'Airbrush', fill: sprayMist(2200, 311) },
    d('paint-plain', 'Plain body', { cols: 40, hw: 0.94, hh: 0.94, n: 2, ramp: 0.28, lenVar: 0.08, stray: 0.3, streak: 0, seed: 306 }),
    d('paint-round', 'Round paint', { cols: 64, hw: 0.94, hh: 0.94, n: 2, ramp: 0.3, lenVar: 0.3, stray: 1, streak: 0.12, seed: 301 }),
    d('paint-flat', 'Flat paint', { cols: 84, hw: 0.95, hh: 0.34, n: 7, ramp: 0.2, lenVar: 0.5, stray: 0.8, streak: 0.14, seed: 302 }),
    d('paint-filbert', 'Filbert paint', { cols: 76, hw: 0.95, hh: 0.5, n: 3.2, ramp: 0.2, lenVar: 0.4, stray: 0.75, streak: 0.12, seed: 303 }),
    d('paint-gouache', 'Gouache body', { cols: 56, hw: 0.94, hh: 0.94, n: 2, ramp: 0.38, lenVar: 0.15, stray: 0.85, streak: 0.05, seed: 304 }),
    d('paint-dry', 'Dry paint', { cols: 70, hw: 0.95, hh: 0.8, n: 2.6, ramp: 0.16, lenVar: 0.6, stray: 0.95, streak: 0.22, seed: 305 }),
  ];
}
