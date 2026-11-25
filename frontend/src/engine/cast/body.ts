import type { CastPrim } from './spec';
import type { Metrics } from './metrics';
import { D, E, L, R, shade } from './prims';

export interface TorsoOpts { nh?: number; dip?: number; hem?: 'tuck' | 'hip'; strapX?: number; v?: boolean; tank?: boolean; hemY?: number }

export function torsoPath(M: Metrics, o: TorsoOpts = {}): string {
  const S = M.shoulderW / 2, T = M.torsoLen, Wst = M.waistW / 2, Hp = M.hipW / 2, aw = M.armW, pH = M.pelvisH;
  const nh = o.nh ?? (M.neckW / 2 + 3), dip = o.dip ?? 5, hem = o.hem || 'tuck', sx = o.strapX ?? S * .72;
  let d = D`M${-nh} ${-T}`;
  d += o.v ? D`L0 ${-T + dip}L${nh} ${-T}` : D`Q0 ${-T + dip * 2} ${nh} ${-T}`;
  d += o.tank ? D`L${sx} ${-T + 1}Q${sx - 5} ${-T * .72} ${S - 2} ${-T * .6}` : D`C${S * .75} ${-T} ${S} ${-T + 2} ${S} ${-T + aw * .6}L${S - 1} ${-T * .62}`;
  d += D`C${S - 1} ${-T * .45} ${Wst} ${-T * .4} ${Wst} ${-T * .2}`;
  if (hem === 'tuck') d += D`L${Wst + .5} 3Q0 9 ${-Wst - .5} 3L${-Wst} ${-T * .2}`;
  else {
    const hy = pH * (o.hemY ?? .8);
    d += D`C${Wst} ${-T * .05} ${Hp + 2} ${hy * .3} ${Hp + 2} ${hy}Q0 ${hy + 6} ${-Hp - 2} ${hy}C${-Hp - 2} ${hy * .3} ${-Wst} ${-T * .05} ${-Wst} ${-T * .2}`;
  }
  d += D`C${-Wst} ${-T * .4} ${-S + 1} ${-T * .45} ${-S + 1} ${-T * .62}`;
  d += o.tank ? D`L${-S + 2} ${-T * .6}Q${-sx + 5} ${-T * .72} ${-sx} ${-T + 1}L${-nh} ${-T}` : D`L${-S} ${-T + aw * .6}C${-S} ${-T + 2} ${-S * .75} ${-T} ${-nh} ${-T}`;
  return d + 'Z';
}

export function pelvisPath(M: Metrics): string {
  const Wst = M.waistW / 2, pH = M.pelvisH, ox = M.hipX + M.legW / 2 + 1;
  return D`M${-Wst} ${-pH - 6}L${Wst} ${-pH - 6}C${Wst} ${-pH * .5} ${ox} ${-pH * .4} ${ox} 0L${ox} 5Q${ox} 9 ${ox - 5} 9L${-ox + 5} 9Q${-ox} 9 ${-ox} 5L${-ox} 0C${-ox} ${-pH * .4} ${-Wst} ${-pH * .5} ${-Wst} ${-pH - 6}Z`;
}

export function skirtPath(M: Metrics, len: number, flare: number): string {
  const Wst = M.waistW / 2 + 1, pH = M.pelvisH, ox = M.hipX + M.legW / 2 + 2 + flare;
  return D`M${-Wst} ${-pH - 2}L${Wst} ${-pH - 2}C${Wst + 2} ${-pH * .3} ${ox} ${len * .3} ${ox + flare * .3} ${len}Q0 ${len + 8} ${-ox - flare * .3} ${len}C${-ox} ${len * .3} ${-Wst - 2} ${-pH * .3} ${-Wst} ${-pH - 2}Z`;
}

export function limb(len: number, w: number, skin: string, cov: number, col: string | undefined, stripe: string | undefined): CastPrim[] {
  const a: CastPrim[] = [];
  if (cov < 1) a.push(L(0, 0, 0, len, w, skin));
  if (cov >= 1) a.push(L(0, 0, 0, len, w + 3, col as string));
  else if (cov > 0) { a.push(E(0, 0, (w + 3) / 2, (w + 3) / 2, col as string)); a.push(L(0, 0, 0, len * cov, w + 3, col as string, 'butt')); }
  if (stripe && cov > 0) {
    const e = len * Math.min(cov, 1) - 2;
    a.push(L(-w * .22, 3, -w * .22, e, 2.2, stripe, 'butt')); a.push(L(w * .22, 3, w * .22, e, 2.2, stripe, 'butt'));
  }
  return a;
}

export type ShoeType = 'bare' | 'flat' | 'boot' | 'slipper' | 'dress' | 'sneaker';

export function shoe(M: Metrics, s: number, type: ShoeType, col: string, sole?: string): CastPrim[] {
  const lw = M.legW, fl = M.footL, fh = M.footH; sole = sole || shade(col, -.4);
  const x0 = s > 0 ? -lw / 2 - 1 : -(fl - lw / 2 - 1), a: CastPrim[] = [];
  if (type === 'bare') return [R(x0, fh - 11, fl, 11, 5.5, col)];
  if (type === 'flat') { a.push(R(x0, fh - 10, fl, 10, 5, col)); a.push(R(x0, fh - 3, fl, 3, 1.5, sole)); return a; }
  if (type === 'boot') a.push(R(-lw / 2 - 2, -18, lw + 4, fh + 12, 4, col));
  a.push(R(x0, fh - 13, fl, 13, 6, col));
  if (type === 'slipper') a.push(E(s > 0 ? x0 + fl - 8 : x0 + 8, fh - 10, 5, 4.5, sole));
  else a.push(R(x0, fh - (type === 'dress' ? 3 : 4.5), fl, type === 'dress' ? 3 : 4.5, 2, sole));
  if (type === 'sneaker') a.push(L(-4, fh - 9, 4, fh - 9, 2, sole, 'round'));
  return a;
}

export interface Kit { A: string; B: string; C: string; skin: string }

export interface LimbOpts {
  sleeve?: number; sleeveCol?: string; legs?: number; legCol?: string; stripe?: string; quilt?: string;
  cuff?: string; wrist?: string; glove?: string; sock?: string; hem?: string; shoe: ShoeType; shoeCol: string; sole?: string;
}

export interface LimbParts {
  armU: (s: number) => CastPrim[];
  armF: (s: number) => CastPrim[];
  hand: (s: number) => CastPrim[];
  thigh: (s: number) => CastPrim[];
  shin: (s: number) => CastPrim[];
  foot: (s: number) => CastPrim[];
}

export function limbs(M: Metrics, k: Kit, o: LimbOpts): LimbParts {
  const aw = M.armW, lw = M.legW, sl = o.sleeve || 0, lg = o.legs || 0, sc = o.sleeveCol, lc = o.legCol;
  return {
    armU: () => {
      const a = limb(M.upperLen, aw, k.skin, Math.min(sl, 1), sc, o.stripe);
      if (o.quilt) [.38, .78].forEach((f) => a.push(L(-aw / 2 - 1.5, M.upperLen * f, aw / 2 + 1.5, M.upperLen * f, 2, o.quilt as string, 'butt')));
      return a;
    },
    armF: () => {
      const a = limb(M.foreLen, aw, k.skin, Math.max(0, sl - 1), sc, o.stripe);
      if (o.quilt) a.push(L(-aw / 2 - 1.5, M.foreLen * .45, aw / 2 + 1.5, M.foreLen * .45, 2, o.quilt, 'butt'));
      if (o.cuff && sl >= 2) a.push(L(0, M.foreLen - 6, 0, M.foreLen, aw + 4, o.cuff, 'butt'));
      if (o.wrist) a.push(L(0, M.foreLen - 11, 0, M.foreLen - 4, aw + 2, o.wrist, 'butt'));
      return a;
    },
    hand: () => [E(0, M.handR * .55, M.handR, M.handR * 1.1, o.glove || k.skin)],
    thigh: () => limb(M.thighLen, lw, k.skin, Math.min(lg, 1), lc, o.stripe),
    shin: () => {
      const a = limb(M.shinLen, lw, k.skin, Math.max(0, lg - 1), lc, o.stripe);
      if (o.sock) a.push(L(0, M.shinLen - 16, 0, M.shinLen, lw + 1, o.sock, 'butt'));
      if (o.hem && lg >= 2) a.push(L(0, M.shinLen - 9, 0, M.shinLen - 1, lw + 4.5, o.hem, 'butt'));
      return a;
    },
    foot: (s) => shoe(M, s, o.shoe, o.shoeCol, o.sole),
  };
}

export const mirror = <T>(fn: (s: number) => T[]): T[] => [fn(1), fn(-1)].flat();
