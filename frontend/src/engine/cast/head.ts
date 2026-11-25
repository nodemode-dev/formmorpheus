import type { CastPrim, CastSpec } from './spec';
import type { Metrics } from './metrics';
import { blob, D, E, L, n, P, R, shade, type Pt } from './prims';
import { mirror } from './body';

export const SPECIES = ['human', 'robot', 'alien', 'monster'] as const;

export function headPath(W: number, H: number, jaw: number): string {
  const w = W / 2, mid = -H * .52, jw = w * jaw;
  return D`M0 ${-H}C${w * .62} ${-H} ${w} ${-H * .86} ${w} ${mid}C${w} ${-H * .2} ${jw * .75} 0 0 0C${-jw * .75} 0 ${-w} ${-H * .2} ${-w} ${mid}C${-w} ${-H * .86} ${-w * .62} ${-H} 0 ${-H}Z`;
}

export interface HeadParts {
  behind: CastPrim[]; head: CastPrim[]; eyes: CastPrim[]; brows: CastPrim[];
  mouth: CastPrim[]; mouthO: CastPrim[]; acc: CastPrim[];
}

export function headBuild(c: Pick<CastSpec, 'species' | 'skin' | 'face' | 'hair'>, M: Metrics): HeadParts {
  const W = M.headW, H = M.headH, u = M.u, sk = c.skin, sd = shade(sk, -.16), f = c.face, ey = -H * .44, ex = W * .22;
  const o: HeadParts = { behind: [], head: [], eyes: [], brows: [], mouth: [], mouthO: [], acc: [] }, bc = shade(c.hair.color, -.3), X = (x: number) => x * W / 2, Y = (v: number) => -v * H;
  if (c.species === 'robot') {
    const g = f.eyeColor, dk = shade(sk, -.35);
    o.behind = [L(0, -H, 0, -H - 20 * u, 4 * u, dk), E(0, -H - 25 * u, 7 * u, 7 * u, g)];
    o.head = [R(-W / 2 - 7 * u, -H * .58, W + 14 * u, H * .26, 5 * u, dk), R(-W / 2, -H, W, H, 18 * u, sk), R(-W / 2 + 5 * u, -H + 5 * u, W * .5, 6 * u, 3 * u, shade(sk, .3), { op: .6 }), R(-W * .4, -H * .76, W * .8, H * .58, 14 * u, '#18222e')];
    o.eyes = mirror((s) => [R(s * ex - 9 * u, -9 * u, 18 * u, 17 * u, 6 * u, g), R(s * ex - 5 * u, -6 * u, 5 * u, 5 * u, 2 * u, '#ffffff', { op: .7 })]);
    o.mouth = [P(D`M${-11 * u} ${-1 * u}Q0 ${6 * u} ${11 * u} ${-1 * u}`, null, { stroke: g, sw: n(3.2 * u) })]; o.mouthO = [R(-9 * u, -3 * u, 18 * u, 10 * u, 3.5 * u, g)];
  } else if (c.species === 'alien') {
    o.behind = mirror((s) => [P(D`M${s * 12 * u} ${-H + 5 * u}Q${s * 20 * u} ${-H - 22 * u} ${s * 32 * u} ${-H - 26 * u}`, null, { stroke: sd, sw: n(4 * u) }), E(s * 33 * u, -H - 27 * u, 6.5 * u, 6.5 * u, shade(sk, .35))]);
    o.head = [P(headPath(W, H, .5), sk), E(-W * .2, -H * .84, W * .14, H * .06, shade(sk, .3), { op: .55, rot: -16 }), E(-2.6 * u, ey + 17 * u, 1.4 * u, 2 * u, sd), E(2.6 * u, ey + 17 * u, 1.4 * u, 2 * u, sd)];
    o.eyes = mirror((s) => [E(s * ex * 1.22, 2 * u, 12.5 * u, 18 * u, '#14151c', { rot: -s * 20 }), E(s * ex * 1.22 + 3 * u, -5 * u, 3.6 * u, 5 * u, f.eyeColor, { op: .9, rot: -s * 20 })]);
    o.mouth = [P(D`M${-6 * u} ${-1 * u}Q0 ${4 * u} ${6 * u} ${-1 * u}`, null, { stroke: shade(sk, -.5), sw: n(2.6 * u) })]; o.mouthO = [E(0, 1 * u, 4.5 * u, 4.5 * u, shade(sk, -.6))];
  } else if (c.species === 'monster') {
    const horn = '#f3e7c9';
    o.behind = [...mirror((s) => [P(D`M${s * W * .36} ${-H * .9}Q${s * W * .56} ${-H * 1.2} ${s * W * .3} ${-H * 1.3}Q${s * W * .3} ${-H * 1.06} ${s * W * .14} ${-H * .97}Z`, horn),
      P(D`M${s * (W / 2 - 6)} ${-H * .56}L${s * (W / 2 + 12 * u)} ${-H * .44}L${s * (W / 2 - 2)} ${-H * .36}L${s * (W / 2 + 11 * u)} ${-H * .24}L${s * (W / 2 - 8)} ${-H * .14}Z`, sd)])];
    o.head = [P(headPath(W, H, .98), sk), E(0, -H * .1, W * .3, H * .09, shade(sk, .22), { op: .5 })];
    o.eyes = [E(0, -2 * u, 17 * u, 17 * u, '#ffffff'), E(0, 0, 8.5 * u, 8.5 * u, f.eyeColor), E(0, 0, 4.2 * u, 4.2 * u, '#15151a'), E(3 * u, -4 * u, 2.4 * u, 2.4 * u, '#ffffff')];
    o.brows = [L(-15 * u, -8 * u, 15 * u, -8 * u, 5 * u, shade(sk, -.45))];
    o.mouth = [P(D`M${-15 * u} ${-2 * u}Q0 ${9 * u} ${15 * u} ${-2 * u}`, null, { stroke: shade(sk, -.55), sw: n(3.4 * u) }), ...monsterFangs(u)];
    o.mouthO = [E(0, 3 * u, 8 * u, 6 * u, shade(sk, -.65))];
  } else {
    o.head = [...mirror((s) => [E(s * W / 2, -H * .42, 7 * u, 10 * u, sk), E(s * W / 2, -H * .42, 3.5 * u, 6 * u, sd, { op: .6 })]), P(headPath(W, H, f.jaw), sk)];
    if (f.earrings) o.head.push(...mirror((s) => [E(s * (W / 2 + 1), -H * .3, 3.2 * u, 3.2 * u, '#f2c14e')]));
    if (f.blush) o.head.push(...mirror((s) => [E(s * W * .33, ey + 15 * u, 8 * u, 5 * u, '#ff6b6b', { op: .22 })]));
    if (f.freckles) o.head.push(...mirror((s) => [E(s * W * .27, ey + 13 * u, 1.3 * u, 1.3 * u, sd), E(s * W * .34, ey + 16 * u, 1.3 * u, 1.3 * u, sd), E(s * W * .31, ey + 10 * u, 1.3 * u, 1.3 * u, sd)]));
    o.head.push(P(D`M${-3 * u} ${ey + 13 * u}Q${.5 * u} ${ey + 18 * u} ${4 * u} ${ey + 13 * u}`, null, { stroke: shade(sk, -.26), sw: n(2.4 * u) }));
    const bd = f.beard, bcol = c.hair.color;
    const m = (pts: readonly Pt[]) => blob(pts.map((p): Pt => [X(p[0]), Y(p[1])]));
    if (bd === 'full' || bd === 'stubble') o.head.push(P(m([[-1.0, .44], [-.97, .2], [-.6, -.03], [0, -.08], [.6, -.03], [.97, .2], [1.0, .44], [.78, .34], [.45, .31], [0, .3], [-.45, .31], [-.78, .34]]), bd === 'stubble' ? shade(sk, -.4) : bcol, { op: bd === 'stubble' ? .22 : 1 }));
    if (bd === 'mustache' || bd === 'full') o.head.push(P(m([[-.42, .235], [-.2, .31], [0, .29], [.2, .31], [.42, .235], [.15, .25], [0, .262], [-.15, .25]]), bd === 'full' ? shade(bcol, -.15) : bcol));
    if (bd === 'goatee') o.head.push(P(m([[-.2, .15], [0, .17], [.2, .15], [.22, .04], [0, -.05], [-.22, .04]]), bcol));
    o.eyes = mirror((s) => [E(s * ex, 0, 5.3 * u, 7.4 * u, f.eyeColor), E(s * ex + 1.7 * u, -2.6 * u, 1.9 * u, 1.9 * u, '#ffffff')]);
    if (f.lashes) o.eyes.push(...mirror((s) => [P(D`M${s * (ex + 3.5 * u)} ${-5.5 * u}Q${s * (ex + 8 * u)} ${-7 * u} ${s * (ex + 9.5 * u)} ${-11 * u}`, null, { stroke: f.eyeColor, sw: n(2.2 * u) })]));
    o.brows = mirror((s) => [L(s * (ex - 7 * u), -1 * u, s * (ex + 7 * u), 0, 3.4 * u, bc)]);
    o.mouth = [P(D`M${-9 * u} ${-2 * u}Q0 ${7 * u} ${9 * u} ${-2 * u}`, null, { stroke: f.lip, sw: n(3 * u) })];
    o.mouthO = [E(0, 2 * u, 6.5 * u, 6 * u, '#5a1f24'), E(0, 5 * u, 4 * u, 2.4 * u, '#e2707a')];
  }
  if (f.glasses) {
    const gc = '#2b2b33';
    o.acc.push(...mirror((s) => [R(s * ex - 11.5 * u, ey - 10 * u, 23 * u, 19 * u, 7 * u, '#ffffff', { op: .2 }), R(s * ex - 11.5 * u, ey - 10 * u, 23 * u, 19 * u, 7 * u, null, { stroke: gc, sw: n(2.4 * u) })]), L(-ex + 11.5 * u, ey - 2 * u, ex - 11.5 * u, ey - 2 * u, 2.4 * u, gc, 'butt'));
  }
  return o;
}

export const monsterFangs = (u: number): CastPrim[] => mirror((s) => [P(D`M${s * 10 * u} ${1 * u}L${s * 7 * u} ${9 * u}L${s * 4 * u} ${3.6 * u}Z`, '#ffffff')]);
