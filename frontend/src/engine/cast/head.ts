import type { CastPrim, CastSpec } from './spec';
import type { Metrics } from './metrics';
import { blob, D, E, L, n, P, R, shade, type Pt } from './prims';
import { mirror } from './body';
import type { HairParts } from './hair';

export const SPECIES = ['human', 'robot', 'alien', 'monster', 'fox', 'dino', 'sprout'] as const;

const FUR = '#fbf3e6', NOSE = '#231c1e', INSIDE = '#5a1f24', TONGUE = '#e2707a';

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
    o.head = [R(-W / 2 - 7 * u, -H * .58, W + 14 * u, H * .26, 5 * u, dk, { z: 's' }), R(-W / 2, -H, W, H, 18 * u, sk, { z: 's' }), R(-W / 2 + 5 * u, -H + 5 * u, W * .5, 6 * u, 3 * u, shade(sk, .3), { op: .6, z: 's' }), R(-W * .4, -H * .76, W * .8, H * .58, 14 * u, '#18222e')];
    o.eyes = mirror((s) => [R(s * ex - 9 * u, -9 * u, 18 * u, 17 * u, 6 * u, g), R(s * ex - 5 * u, -6 * u, 5 * u, 5 * u, 2 * u, '#ffffff', { op: .7 })]);
    o.mouth = [P(D`M${-11 * u} ${-1 * u}Q0 ${6 * u} ${11 * u} ${-1 * u}`, null, { stroke: g, sw: n(3.2 * u) })]; o.mouthO = [R(-9 * u, -3 * u, 18 * u, 10 * u, 3.5 * u, g)];
  } else if (c.species === 'alien') {
    o.behind = mirror((s) => [P(D`M${s * 12 * u} ${-H + 5 * u}Q${s * 20 * u} ${-H - 22 * u} ${s * 32 * u} ${-H - 26 * u}`, null, { stroke: sd, sw: n(4 * u) }), E(s * 33 * u, -H - 27 * u, 6.5 * u, 6.5 * u, shade(sk, .35))]);
    o.head = [P(headPath(W, H, .5), sk, { z: 's' }), E(-W * .2, -H * .84, W * .14, H * .06, shade(sk, .3), { op: .55, rot: -16, z: 's' }), E(-2.6 * u, ey + 17 * u, 1.4 * u, 2 * u, sd), E(2.6 * u, ey + 17 * u, 1.4 * u, 2 * u, sd)];
    o.eyes = mirror((s) => [E(s * ex * 1.22, 2 * u, 12.5 * u, 18 * u, '#14151c', { rot: -s * 20 }), E(s * ex * 1.22 + 3 * u, -5 * u, 3.6 * u, 5 * u, f.eyeColor, { op: .9, rot: -s * 20 })]);
    o.mouth = [P(D`M${-6 * u} ${-1 * u}Q0 ${4 * u} ${6 * u} ${-1 * u}`, null, { stroke: shade(sk, -.5), sw: n(2.6 * u) })]; o.mouthO = [E(0, 1 * u, 4.5 * u, 4.5 * u, shade(sk, -.6))];
  } else if (c.species === 'monster') {
    const horn = '#f3e7c9';
    o.behind = [...mirror((s) => [P(D`M${s * W * .36} ${-H * .9}Q${s * W * .56} ${-H * 1.2} ${s * W * .3} ${-H * 1.3}Q${s * W * .3} ${-H * 1.06} ${s * W * .14} ${-H * .97}Z`, horn),
      P(D`M${s * (W / 2 - 6)} ${-H * .56}L${s * (W / 2 + 12 * u)} ${-H * .44}L${s * (W / 2 - 2)} ${-H * .36}L${s * (W / 2 + 11 * u)} ${-H * .24}L${s * (W / 2 - 8)} ${-H * .14}Z`, sd)])];
    o.head = [P(headPath(W, H, .98), sk, { z: 's' }), E(0, -H * .1, W * .3, H * .09, shade(sk, .22), { op: .5 })];
    o.eyes = [E(0, -2 * u, 17 * u, 17 * u, '#ffffff'), E(0, 0, 8.5 * u, 8.5 * u, f.eyeColor), E(0, 0, 4.2 * u, 4.2 * u, '#15151a'), E(3 * u, -4 * u, 2.4 * u, 2.4 * u, '#ffffff')];
    o.brows = [L(-15 * u, -8 * u, 15 * u, -8 * u, 5 * u, shade(sk, -.45))];
    o.mouth = [P(D`M${-15 * u} ${-2 * u}Q0 ${9 * u} ${15 * u} ${-2 * u}`, null, { stroke: shade(sk, -.55), sw: n(3.4 * u) }), ...monsterFangs(u)];
    o.mouthO = [E(0, 3 * u, 8 * u, 6 * u, shade(sk, -.65))];
  } else if (c.species === 'fox') {
    const m = (pts: readonly Pt[], k?: number) => blob(pts.map((p): Pt => [X(p[0]), Y(p[1])]), k), ln = shade(sk, -.6);
    o.behind = mirror((s) => [P(m([[.18 * s, .88], [.5 * s, 1.3], [.66 * s, 1.4], [.98 * s, .9], [.92 * s, .62]], .7), sk), P(m([[.36 * s, .9], [.58 * s, 1.22], [.7 * s, 1.28], [.86 * s, .92], [.8 * s, .72]], .7), FUR)]);
    o.head = [...mirror((s) => [P(m([[.6 * s, .5], [1.22 * s, .38], [.98 * s, .29], [1.16 * s, .15], [.72 * s, .05], [.5 * s, .2]], .45), sk, { z: 's' })]), P(headPath(W, H, .66), sk, { z: 's' }),
      P(m([[-.86, .3], [-.42, .36], [0, .33], [.42, .36], [.86, .3], [.66, .12], [.3, .02], [0, 0], [-.3, .02], [-.66, .12]]), FUR)];
    if (f.blush) o.head.push(...mirror((s) => [E(s * W * .33, ey + 17 * u, 7 * u, 4.5 * u, '#ff6b6b', { op: .22 })]));
    o.head.push(E(0, ey + 14 * u, 5.6 * u, 3.9 * u, NOSE), E(-1.6 * u, ey + 12.8 * u, 1.8 * u, 1.1 * u, '#ffffff', { op: .5 }), L(0, ey + 17.5 * u, 0, ey + 22 * u, 2.2 * u, ln));
    o.eyes = mirror((s) => [E(s * ex, 0, 5.6 * u, 7.4 * u, f.eyeColor), E(s * ex + 1.7 * u, -2.6 * u, 2 * u, 2 * u, '#ffffff')]);
    if (f.lashes) o.eyes.push(...mirror((s) => [P(D`M${s * (ex + 4 * u)} ${-5 * u}Q${s * (ex + 8 * u)} ${-6 * u} ${s * (ex + 10 * u)} ${-9.5 * u}`, null, { stroke: f.eyeColor, sw: n(2.2 * u) })]));
    o.brows = mirror((s) => [L(s * (ex - 5 * u), 0, s * (ex + 6 * u), -2.5 * u, 3.2 * u, shade(sk, -.45))]);
    o.mouth = [P(D`M${-8 * u} ${-2 * u}Q${-4 * u} ${3.5 * u} 0 ${-1 * u}Q${4 * u} ${3.5 * u} ${8 * u} ${-2 * u}`, null, { stroke: ln, sw: n(2.6 * u) })];
    o.mouthO = [E(0, 3 * u, 5.4 * u, 5.4 * u, INSIDE), E(0, 5.8 * u, 3.2 * u, 1.9 * u, TONGUE)];
  } else if (c.species === 'dino') {
    const m = (pts: readonly Pt[], k?: number) => blob(pts.map((p): Pt => [X(p[0]), Y(p[1])]), k), dk = shade(sk, -.45), bel = shade(sk, .5);
    o.head = [P(m([[0, 1.0], [.62, .97], [.94, .78], [1.0, .5], [1.1, .3], [1.04, .1], [.68, -.02], [0, -.05], [-.68, -.02], [-1.04, .1], [-1.1, .3], [-1.0, .5], [-.94, .78], [-.62, .97]]), sk, { z: 's' }),
      P(m([[-.9, .17], [-.45, .21], [0, .22], [.45, .21], [.9, .17], [.66, .01], [0, -.03], [-.66, .01]]), bel),
      E(X(-.36), Y(.88), W * .08, H * .045, sd, { rot: -14, z: 's' }), E(X(.06), Y(.93), W * .05, H * .03, sd, { z: 's' }), E(X(.42), Y(.84), W * .065, H * .04, sd, { rot: 18, z: 's' }), E(X(.3), Y(.95), W * .035, H * .022, sd, { z: 's' }),
      ...mirror((s) => [E(s * 5.5 * u, ey + 15 * u, 2 * u, 1.4 * u, dk, { rot: s * 20 })])];
    if (f.blush) o.head.push(...mirror((s) => [E(s * W * .36, ey + 13 * u, 7.5 * u, 4.5 * u, '#ff6b6b', { op: .22 })]));
    o.eyes = mirror((s) => [E(s * ex, -1 * u, 6.4 * u, 8.2 * u, f.eyeColor), E(s * ex + 2 * u, -4 * u, 2.2 * u, 2.2 * u, '#ffffff')]);
    o.brows = mirror((s) => [P(D`M${s * (ex - 8 * u)} ${1 * u}Q${s * ex} ${-3.5 * u} ${s * (ex + 8 * u)} ${1 * u}`, null, { stroke: shade(sk, -.3), sw: n(4.2 * u) })]);
    o.mouth = [P(D`M${-17 * u} ${-3 * u}Q0 ${8 * u} ${17 * u} ${-3 * u}`, null, { stroke: dk, sw: n(3.2 * u) }), P(D`M${5 * u} ${2.2 * u}L${11 * u} ${.4 * u}L${8.8 * u} ${6.6 * u}Z`, '#ffffff')];
    o.mouthO = [E(0, 3 * u, 11 * u, 6.5 * u, shade(sk, -.65)), E(0, 6 * u, 6 * u, 2.4 * u, TONGUE)];
  } else if (c.species === 'sprout') {
    const ln = shade(sk, -.5), lf = c.hair.color, petal: CastPrim[] = [];
    for (let i = 0; i < 11; i++) {
      const a = (-8 + i * 19.6) * Math.PI / 180, back = i % 2 === 0;
      petal.push(E(Math.cos(a) * W * .4, -H * .2 + Math.sin(a) * H * .32, W * .2, W * .09, back ? shade(lf, -.22) : lf, { rot: n(a * 180 / Math.PI) }));
    }
    o.behind = [...petal.filter((_, i) => i % 2 === 0), ...petal.filter((_, i) => i % 2 === 1)];
    o.head = [P(headPath(W, H, .8), sk, { z: 's' }), E(-W * .2, -H * .84, W * .14, H * .06, shade(sk, .3), { op: .55, rot: -16, z: 's' })];
    if (f.blush) o.head.push(...mirror((s) => [E(s * W * .33, ey + 15 * u, 7 * u, 4.5 * u, '#ff8a9a', { op: .5 })]));
    if (f.freckles) o.head.push(...mirror((s) => [E(s * W * .27, ey + 13 * u, 1.3 * u, 1.3 * u, sd), E(s * W * .34, ey + 16 * u, 1.3 * u, 1.3 * u, sd), E(s * W * .31, ey + 10 * u, 1.3 * u, 1.3 * u, sd)]));
    o.head.push(P(D`M${-2.5 * u} ${ey + 14 * u}Q${.5 * u} ${ey + 17.5 * u} ${3.5 * u} ${ey + 14 * u}`, null, { stroke: shade(sk, -.3), sw: n(2.2 * u) }));
    o.eyes = mirror((s) => [E(s * ex, 0, 5.3 * u, 7.4 * u, f.eyeColor), E(s * ex + 1.7 * u, -2.6 * u, 1.9 * u, 1.9 * u, '#ffffff')]);
    if (f.lashes) o.eyes.push(...mirror((s) => [P(D`M${s * (ex + 3.5 * u)} ${-5.5 * u}Q${s * (ex + 8 * u)} ${-7 * u} ${s * (ex + 9.5 * u)} ${-11 * u}`, null, { stroke: f.eyeColor, sw: n(2.2 * u) })]));
    o.brows = mirror((s) => [L(s * (ex - 6 * u), -.5 * u, s * (ex + 6 * u), -1 * u, 3 * u, shade(sk, -.42))]);
    o.mouth = [P(D`M${-7.5 * u} ${-1.5 * u}Q0 ${6 * u} ${7.5 * u} ${-1.5 * u}`, null, { stroke: ln, sw: n(2.8 * u) })];
    o.mouthO = [E(0, 2 * u, 5.6 * u, 5 * u, shade(sk, -.66)), E(0, 4.6 * u, 3.4 * u, 1.8 * u, TONGUE)];
  } else {
    o.head = [...mirror((s) => [E(s * W / 2, -H * .42, 7 * u, 10 * u, sk, { z: 'e' }), E(s * W / 2, -H * .42, 3.5 * u, 6 * u, sd, { op: .6, z: 'e' })]), P(headPath(W, H, f.jaw), sk, { z: 's' })];
    if (f.earrings) o.head.push(...mirror((s) => [E(s * (W / 2 + 1), -H * .3, 3.2 * u, 3.2 * u, '#f2c14e', { z: 'e' })]));
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

/** Hair a species draws in place of the hair style: a fox's tuft, a dino's crest, a sprout's leaves. Null keeps the style. */
export function speciesHair(c: Pick<CastSpec, 'species' | 'hair'>, M: Metrics): HairParts | null {
  const W = M.headW, H = M.headH, u = M.u, cr = c.hair.color, X = (x: number) => x * W / 2, Y = (v: number) => -v * H;
  const m = (pts: readonly Pt[], k?: number) => blob(pts.map((p): Pt => [X(p[0]), Y(p[1])]), k), out: HairParts = { back: [], front: [], sway: [] };
  if (c.species === 'fox') {
    if (c.hair.style >= 0) out.front = [P(m([[-.34, .9], [-.28, 1.08], [-.12, 1.02], [0, 1.18], [.12, 1.03], [.3, 1.1], [.34, .9], [0, .94]], .45), cr)];
  } else if (c.species === 'dino') {
    const spike = (x: number, y: number, w: number, h: number, lean: number, col: string) => P(D`M${x - w} ${y}Q${x - w * .3 + lean * .3} ${y - h * .6} ${x + lean} ${y - h}Q${x + w * .3 + lean * .3} ${y - h * .6} ${x + w} ${y}Z`, col);
    out.back = [...mirror((s) => [spike(s * W * .34, -H * .86, 8 * u, 20 * u, s * 7 * u, shade(cr, -.22))]), ...mirror((s) => [spike(s * W * .16, -H * .96, 9 * u, 24 * u, s * 3 * u, cr)]), spike(0, -H * .97, 10 * u, 31 * u, 0, cr)];
  } else if (c.species === 'sprout') {
    const st = shade(cr, -.22), ty = -H - 16 * u;
    out.sway = [P(D`M0 ${-H * .96}Q${-2 * u} ${-H - 8 * u} ${1 * u} ${ty}`, null, { stroke: st, sw: n(3.6 * u) }),
      ...mirror((s) => [P(D`M${1 * u} ${ty}Q${s * 8 * u} ${ty - 22 * u} ${s * 34 * u} ${ty - 14 * u}Q${s * 20 * u} ${ty + 6 * u} ${1 * u} ${ty}Z`, s > 0 ? cr : st),
        P(D`M${s * 4 * u} ${ty - 2 * u}Q${s * 16 * u} ${ty - 10 * u} ${s * 28 * u} ${ty - 13 * u}`, null, { stroke: shade(cr, .3), sw: n(1.8 * u), op: .7 })])];
  } else return null;
  return out;
}

/** A tail on the hip bone, swept out to one side behind the legs. Only the fox and the dino have one. */
export function tailBuild(c: Pick<CastSpec, 'species' | 'skin' | 'hair'>, M: Metrics): CastPrim[] {
  if (c.species !== 'fox' && c.species !== 'dino') return [];
  const q = M.thighLen / 80, sk = c.skin, fox = c.species === 'fox';
  const P0: Pt = fox ? [16, -6] : [22, -16], P1: Pt = fox ? [72, 56] : [60, 10], P2: Pt = fox ? [124, 18] : [100, 70], P3: Pt = fox ? [118, -64] : [150, 74];
  const at = (t: number): Pt => { const a = 1 - t; return [q * (a * a * a * P0[0] + 3 * a * a * t * P1[0] + 3 * a * t * t * P2[0] + t * t * t * P3[0]), q * (a * a * a * P0[1] + 3 * a * a * t * P1[1] + 3 * a * t * t * P2[1] + t * t * t * P3[1])]; };
  const nrm = (t: number): Pt => { const p = at(Math.max(0, t - .01)), r = at(Math.min(1, t + .01)), dx = r[0] - p[0], dy = r[1] - p[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  const tube = (t0: number, t1: number, wf: (t: number) => number, off = 0): string => {
    const a: Pt[] = [], b: Pt[] = [];
    for (let i = 0; i <= 8; i++) { const t = t0 + (t1 - t0) * i / 8, p = at(t), nv = nrm(t), w = wf(t) * q, o = off * w; a.push([p[0] + nv[0] * (w + o), p[1] + nv[1] * (w + o)]); b.push([p[0] - nv[0] * (w - o), p[1] - nv[1] * (w - o)]); }
    return blob([...a, ...b.reverse()]);
  };
  if (fox) {
    const wf = (t: number) => 4 + 27 * Math.pow(Math.sin(Math.PI * Math.pow(t, .75)), .6) + 4 * (1 - t);
    return [P(tube(0, 1, wf), sk), P(tube(.68, 1, wf), FUR)];
  }
  const wf = (t: number) => 28 * Math.pow(1 - t, .9) + 1.5, cr = c.hair.color, sp: CastPrim[] = [];
  for (const t of [.16, .32, .48, .64, .8]) { const p = at(t), nv = nrm(t), w = wf(t) * q, h = (14 - t * 8) * q, bx = p[0] - nv[0] * w * .75, by = p[1] - nv[1] * w * .75, tx = -nv[1], ty = nv[0];
    sp.push(P(D`M${bx - tx * h * .8} ${by - ty * h * .8}Q${bx - nv[0] * h * 1.2 - tx * h * .2} ${by - nv[1] * h * 1.2 - ty * h * .2} ${bx - nv[0] * h * 1.7 + tx * h * .3} ${by - nv[1] * h * 1.7 + ty * h * .3}Q${bx - nv[0] * h * .8 + tx * h * .5} ${by - nv[1] * h * .8 + ty * h * .5} ${bx + tx * h * .8} ${by + ty * h * .8}Z`, cr)); }
  return [...sp, P(tube(0, 1, wf), sk), P(tube(.04, .88, (t) => wf(t) * .4, .58), shade(sk, .5))];
}

export const monsterFangs = (u: number): CastPrim[] => mirror((s) => [P(D`M${s * 10 * u} ${1 * u}L${s * 7 * u} ${9 * u}L${s * 4 * u} ${3.6 * u}Z`, '#ffffff')]);
