// Surface grains for the texture brushes (paint family, v0.17.0): a crisp woven cloth, a fine mottled concrete and an
// even paper tooth. They are strong and never blotchy, so a band laid with them reads as one continuous surface.
// Every grain is periodic, so the tile repeats without a seam. tips-lib-style hook: grains-lib.ts calls `textureGrains`.

export interface GrainHelpers {
  per: (fn: (u: number, v: number) => number) => (b: Float32Array) => void;
  fbm: (u: number, v: number, fx: number, fy: number, oct: number, s: number, gain?: number) => number;
  pvn: (u: number, v: number, fx: number, fy: number, s: number) => number;
  sstep: (a: number, b: number, x: number) => number;
}
export interface GrainDef { id: string; name: string; group: string; std: number; fill: (b: Float32Array) => void }

function lane(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hair marks for a loaded brush (v0.17.2): the tile runs along the stroke (u) and its lanes across it (v), so a stroke
 *  laid in stroke space (`grainAlign`) shows a streak per hair. Each lane has its own load, and its load wanders along
 *  the stroke in runs, so a hair goes dry for a stretch and picks up again. `lanes` is the count across the tile,
 *  `dry` how deep a dry lane is, `run` how many dry-and-loaded changes a lane makes along the tile. */
function hairLanes(h: GrainHelpers, lanes: number, dry: number, run: number, seed: number, fine: number): (b: Float32Array) => void {
  const { per, pvn, sstep } = h;
  return per((u, v) => {
    const y = v * lanes, i = Math.floor(y), f = y - i;
    // a lane keeps a soft edge so two hairs blend a little (a bristle is not a pixel column)
    const j = f < 0.5 ? i - 1 : i + 1, e = f < 0.5 ? f : 1 - f;
    const mix = 0.5 * (1 - sstep(0, 0.28, e));
    const li = (i + lanes) % lanes, lj = (j + lanes) % lanes;
    const lv = (k: number): number => {
      const base = lane(k, seed);
      // most hairs are loaded, a few carry little
      const load = 1 - dry * Math.pow(1 - base, 2.4);
      const along = pvn(u, (k + 0.5) / lanes, run, lanes, seed + 7);
      return load * (0.55 + 0.45 * sstep(0.2, 0.75, along));
    };
    const a = lv(li), b = lv(lj);
    return a + (b - a) * mix + fine * (pvn(u, v, 220, 220, seed + 19) - 0.5);
  });
}

export function textureGrains(h: GrainHelpers): GrainDef[] {
  const { per, fbm, pvn, sstep } = h;
  return [
    { id: 'paint-hair', name: 'Paint hairs', group: 'Paint', std: 0.21, fill: hairLanes(h, 96, 0.95, 3, 401, 0.16) },
    { id: 'paint-hair-soft', name: 'Soft paint hairs', group: 'Paint', std: 0.15, fill: hairLanes(h, 128, 0.7, 2, 411, 0.14) },
    { id: 'paint-matte', name: 'Matte paint', group: 'Paint', std: 0.12, fill: hairLanes(h, 160, 0.5, 2, 421, 0.3) },
    {
      id: 'tex-weave', name: 'Woven cloth', group: 'Fabric', std: 0.2,
      fill: per((u, v) => {
        // 48 threads a tile (about 5 px at the tile's own size): a stroke covers several, so it reads as cloth, not a ladder
        const n = 48, x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), fu = x - i, fv = y - j;
        const pu = Math.sin(Math.PI * fu), pv = Math.sin(Math.PI * fv);
        const over = ((i + j) & 1) === 0;
        const t = over ? 0.4 + 0.6 * Math.pow(pu, 0.7) * (0.75 + 0.25 * pv) : 0.4 + 0.6 * Math.pow(pv, 0.7) * (0.75 + 0.25 * pu);
        // thread to thread variation along each thread, so the cloth is not a printed grid
        const slub = over ? pvn(i / n, v, n, 9, 5) : pvn(u, j / n, 9, n, 6);
        return t * (0.7 + 0.3 * slub) - 0.1 * (1 - pu * pv) + 0.08 * (pvn(u, v, 200, 200, 17) - 0.5);
      }),
    },
    {
      id: 'tex-burlap', name: 'Burlap', group: 'Fabric', std: 0.2,
      fill: per((u, v) => {
        // a loose coarse weave: fat uneven threads with open gaps between them
        const n = 20, x = u * n + 0.5 * pvn(u, v, 40, 7, 31), y = v * n + 0.5 * pvn(u, v, 7, 40, 33), i = Math.floor(x), j = Math.floor(y), fu = x - i, fv = y - j;
        const pu = Math.sin(Math.PI * fu), pv = Math.sin(Math.PI * fv);
        const over = ((i + j) & 1) === 0;
        const th = over ? pu * (0.55 + 0.45 * pv) : pv * (0.55 + 0.45 * pu);
        const fibre = over ? pvn(i / n, v, n, 60, 41) : pvn(u, j / n, 60, n, 43);
        return th * (0.55 + 0.45 * fibre) + 0.1 * (pvn(u, v, 120, 120, 47) - 0.5) - 0.12 * (1 - pu * pv);
      }),
    },
    {
      id: 'tex-linen', name: 'Linen', group: 'Fabric', std: 0.17,
      fill: per((u, v) => {
        const n = 44, x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), fu = x - i, fv = y - j;
        const pu = Math.sin(Math.PI * fu), pv = Math.sin(Math.PI * fv);
        const t = ((i + j) & 1) === 0 ? 0.5 + 0.5 * pu * (0.7 + 0.3 * pv) : 0.5 + 0.5 * pv * (0.7 + 0.3 * pu);
        // slubs: long uneven threads run both ways, which is what makes linen read as linen at a glance
        const sl = 0.55 * pvn(u, v, 3, 120, 233) + 0.45 * pvn(u, v, 120, 3, 237);
        return 0.55 * t + 0.9 * (sl - 0.5) + 0.3;
      }),
    },
    {
      id: 'tex-concrete', name: 'Fine concrete', group: 'Surface', std: 0.17,
      fill: per((u, v) => {
        const m = 0.28 * fbm(u, v, 16, 16, 4, 201, 0.55) + 0.42 * fbm(u, v, 48, 48, 3, 205, 0.6) + 0.3 * pvn(u, v, 150, 150, 209);
        // pits: small, sparse and soft, not black dots
        const pit = sstep(0.8, 0.95, pvn(u, v, 120, 120, 213));
        return m - 0.18 * pit;
      }),
    },
    {
      id: 'tex-tooth', name: 'Even tooth', group: 'Paper', std: 0.17,
      fill: per((u, v) => 0.5 * pvn(u, v, 170, 170, 221) + 0.3 * pvn(u, v, 96, 96, 225) + 0.2 * pvn(u, v, 256, 256, 229)),
    },
  ];
}
