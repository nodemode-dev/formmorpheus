import type { CastSpec } from './spec';

export type Metrics = {
  headW: number; headH: number; neckW: number; neckLen: number;
  shoulderW: number; waistW: number; hipW: number; torsoLen: number; pelvisH: number;
  armW: number; upperLen: number; foreLen: number; handR: number;
  legW: number; thighLen: number; shinLen: number; footH: number; footL: number; h: number;
  hipX: number; u: number;
};

export function metrics(c: Pick<CastSpec, 'frame' | 'body' | 'headWide'>): Metrics {
  const f = c.frame === 'f', b = c.body, k = b.build, h = b.h;
  const M = {
    headW: 92 * b.head * (c.headWide || 1), headH: 100 * b.head, neckW: (f ? 20 : 25) * Math.sqrt(k), neckLen: 10,
    shoulderW: (f ? 80 : 98) * k * b.shoulders, waistW: (f ? 54 : 72) * k, hipW: (f ? 80 : 82) * k, torsoLen: (f ? 92 : 100) * h, pelvisH: 26 * h,
    armW: (f ? 18 : 22) * Math.pow(k, .6), upperLen: 60 * h, foreLen: 56 * h, handR: (f ? 10.5 : 12) * Math.pow(k, .3),
    legW: (f ? 24 : 27) * Math.pow(k, .7), thighLen: 80 * h, shinLen: 78 * h, footH: 15, footL: f ? 30 : 35, h,
    hipX: 0, u: 0,
  };
  M.hipX = M.hipW * .26; M.u = M.headH / 100;
  return M;
}
