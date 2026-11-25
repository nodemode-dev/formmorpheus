import type { CastPrim } from './spec';
import type { Metrics } from './metrics';
import { D, E, L, P, R, shade } from './prims';
import { limbs, mirror, pelvisPath, skirtPath, torsoPath, type Kit, type LimbParts } from './body';

export interface OutfitParts extends LimbParts {
  torso: CastPrim[];
  pelvis: CastPrim[];
  skirt?: CastPrim[];
  cape?: CastPrim[];
  hoodBack?: CastPrim[];
}

export interface Outfit {
  id: string;
  name: string;
  /** What each of the three colour channels paints. */
  labels: readonly [string, string, string];
  def: readonly [string, string, string];
  fn: (M: Metrics, k: Kit) => OutfitParts;
}

export const OUTFITS: readonly Outfit[] = [
  { id: 'tee', name: 'Tee & Jeans', labels: ['Tee', 'Jeans', 'Sneakers'], def: ['#ef6f53', '#3d5a8c', '#f4f1ea'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3;
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .55 }), k.A), P(D`M${-nh} ${-T}Q0 ${-T + 10} ${nh} ${-T}`, null, { stroke: shade(k.A, -.16), sw: 3 }),
      E(0, -T * .56, 11, 11, shade(k.A, .4)), P(D`M-16 ${-T * .44}Q-8 ${-T * .52} 0 ${-T * .44}Q8 ${-T * .36} 16 ${-T * .44}`, null, { stroke: shade(k.A, .4), sw: 3 })],
      pelvis: [P(pelvisPath(M), k.B)], ...limbs(M, k, { sleeve: .5, sleeveCol: k.A, legs: 2, legCol: k.B, hem: shade(k.B, .28), shoe: 'sneaker', shoeCol: k.C }) };
  } },
  { id: 'hoodie', name: 'Hoodie & Joggers', labels: ['Hoodie', 'Joggers', 'Sneakers'], def: ['#6c8f6b', '#3a3d46', '#e9e4d8'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, W = M.waistW / 2, d = shade(k.A, -.14);
    return { hoodBack: [E(0, -T - 3, M.neckW * 1.3 + 8, 16, d)],
      torso: [P(torsoPath(M, { hem: 'hip', hemY: .95 }), k.A), P(D`M${-nh - 2} ${-T - 1}L0 ${-T + 17}L${nh + 2} ${-T - 1}Q0 ${-T + 9} ${-nh - 2} ${-T - 1}Z`, d),
        L(-5, -T + 13, -6, -T + 32, 2, '#f4f1ea'), L(5, -T + 13, 6, -T + 30, 2, '#f4f1ea'),
        P(D`M${-W * .62} ${-T * .3}L${W * .62} ${-T * .3}L${W * .82} ${-T * .02}L${-W * .82} ${-T * .02}Z`, d)],
      pelvis: [P(pelvisPath(M), k.B)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, cuff: d, legs: 2, legCol: k.B, hem: shade(k.B, -.2), shoe: 'sneaker', shoeCol: k.C }) };
  } },
  { id: 'suit', name: 'Business Suit', labels: ['Suit', 'Tie', 'Shoes'], def: ['#34415e', '#c0392b', '#2a2320'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, d = shade(k.A, -.2);
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .75 }), k.A), P(D`M${-nh - 2} ${-T}L${nh + 2} ${-T}L0 ${-T * .42}Z`, '#fbfaf7'),
      P(D`M-4 ${-T + 4}L4 ${-T + 4}L3 ${-T + 12}L7 ${-T * .53}L0 ${-T * .45}L-7 ${-T * .53}L-3 ${-T + 12}Z`, k.B),
      ...mirror((s) => [P(D`M${s * (nh + 2)} ${-T - 1}L${s * 1.5} ${-T * .42}L${s * (nh + 14)} ${-T * .7}Z`, d), P(D`M${s * 1} ${-T + 11}L${s * (nh + 3)} ${-T - 4}L${s * (nh + 6)} ${-T + 6}Z`, '#fbfaf7')]),
      E(0, -T * .3, 2.6, 2.6, d), E(0, -T * .14, 2.6, 2.6, d), L(M.shoulderW * .2, -T * .6, M.shoulderW * .33, -T * .6, 3, '#fbfaf7', 'butt')],
      pelvis: [P(pelvisPath(M), k.A)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, cuff: '#fbfaf7', legs: 2, legCol: k.A, shoe: 'dress', shoeCol: k.C }) };
  } },
  { id: 'sundress', name: 'Sundress', labels: ['Dress', 'Trim', 'Shoes'], def: ['#f2b84b', '#fff6df', '#d9614c'], fn(M, k) {
    const S = M.shoulderW / 2, W = M.waistW / 2, len = M.thighLen * .92, fl = 14, xe = M.hipX + M.legW / 2 + 2 + fl * 1.3;
    const dots: CastPrim[] = [];
    for (let i = 0; i < 7; i++) dots.push(E((((i * 37) % 50) - 25) / 25 * xe * .6 * (.5 + i / 12), len * (.22 + ((i * 29) % 60) / 100), 3.2, 3.2, k.B, { op: .8 }));
    return { torso: [P(torsoPath(M, { dip: 0 }), k.skin), P(torsoPath(M, { tank: true, nh: S * .4, dip: 9, strapX: S * .7 }), k.A)],
      pelvis: [P(pelvisPath(M), shade(k.A, -.2))],
      skirt: [P(skirtPath(M, len, fl), k.A), ...dots, P(D`M${-xe + 1} ${len - 1}Q0 ${len + 7} ${xe - 1} ${len - 1}`, null, { stroke: k.B, sw: 4.5 }), R(-W - 1.5, -M.pelvisH - 4, 2 * W + 3, 7, 3, k.B)],
      ...limbs(M, k, { sleeve: 0, legs: 0, shoe: 'flat', shoeCol: k.C }) };
  } },
  { id: 'athletic', name: 'Athletic', labels: ['Tank', 'Shorts', 'Trainers'], def: ['#27b3a7', '#2b2f3a', '#ff7a59'], fn(M, k) {
    const T = M.torsoLen, S = M.shoulderW / 2;
    return { torso: [P(torsoPath(M, { dip: 0 }), k.skin), P(torsoPath(M, { tank: true, nh: S * .38, dip: 8, strapX: S * .74, hem: 'hip', hemY: .35 }), k.A),
      P(D`M-12 ${-T * .52}L0 ${-T * .44}L12 ${-T * .52}`, null, { stroke: '#ffffff', sw: 3.5 }), P(D`M-12 ${-T * .42}L0 ${-T * .34}L12 ${-T * .42}`, null, { stroke: '#ffffff', sw: 3.5, op: .55 })],
      pelvis: [P(pelvisPath(M), k.B)], ...limbs(M, k, { sleeve: 0, legs: .56, legCol: k.B, sock: '#ffffff', wrist: k.C, shoe: 'sneaker', shoeCol: k.C, sole: '#ffffff' }) };
  } },
  { id: 'lab', name: 'Lab Coat', labels: ['Coat', 'Shirt', 'Trousers'], def: ['#f6f6f2', '#5aa9d6', '#3f4756'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, d = shade(k.A, -.12), S = M.shoulderW / 2, len = M.thighLen * .72;
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .9 }), k.A), P(D`M${-nh - 2} ${-T}L${nh + 2} ${-T}L0 ${-T * .4}Z`, k.B),
      ...mirror((s) => [P(D`M${s * (nh + 2)} ${-T - 1}L${s * 1.5} ${-T * .4}L${s * (nh + 13)} ${-T * .68}Z`, d)]),
      L(0, -T * .4, 0, M.pelvisH * .9, 1.6, d, 'butt'), E(-4, -T * .26, 2.2, 2.2, d), E(-4, -T * .1, 2.2, 2.2, d),
      R(S * .2, -T * .58, S * .42, S * .4, 2, d), L(S * .3, -T * .66, S * .3, -T * .52, 2.6, '#e2574c'), L(S * .44, -T * .66, S * .44, -T * .52, 2.6, '#3b6fd4')],
      pelvis: [P(pelvisPath(M), k.C)],
      skirt: [P(skirtPath(M, len, 3), k.A), L(0, -M.pelvisH, 0, len + 3, 1.6, d, 'butt'), ...mirror((s) => [R(s > 0 ? M.waistW * .14 : -M.waistW * .14 - M.waistW * .3, len * .25, M.waistW * .3, len * .36, 3, d)])],
      ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, cuff: d, legs: 2, legCol: k.C, shoe: 'dress', shoeCol: '#2b2b33' }) };
  } },
  { id: 'chef', name: 'Chef', labels: ['Jacket', 'Apron', 'Neckerchief'], def: ['#fbfaf5', '#2f3b4c', '#d8463a'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, d = shade(k.A, -.2), W = M.waistW / 2, len = M.thighLen * .86, bt: CastPrim[] = [];
    for (const y of [.62, .44, .26]) for (const s of [-1, 1]) bt.push(E(s * W * .34, -T * y, 2.8, 2.8, d));
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .6 }), k.A), L(W * .05, -T * .75, W * .05, -T * .1, 1.5, d, 'butt'), ...bt,
      P(D`M${-nh - 3} ${-T - 3}L${nh + 3} ${-T - 3}L0 ${-T + 17}Z`, k.C), E(0, -T + 5, 4, 4, shade(k.C, -.2))],
      pelvis: [P(pelvisPath(M), '#3a3d46')],
      skirt: [P(D`M${-W + 1} ${-M.pelvisH - 1}L${W - 1} ${-M.pelvisH - 1}L${W + 4} ${len}Q0 ${len + 5} ${-W - 4} ${len}Z`, k.B), R(-W - 2, -M.pelvisH - 4, 2 * W + 4, 6, 3, shade(k.B, .18)),
        R(-W * .5, len * .3, W, len * .3, 3, shade(k.B, .14))],
      ...limbs(M, k, { sleeve: 1.6, sleeveCol: k.A, legs: 2, legCol: '#3a3d46', shoe: 'dress', shoeCol: '#22232a' }) };
  } },
  { id: 'worker', name: 'Hi-Vis Crew', labels: ['Vest', 'Tee', 'Jeans'], def: ['#ff7a1a', '#5b6b7a', '#3d5a8c'], fn(M, k) {
    const T = M.torsoLen, S = M.shoulderW / 2, W = M.waistW / 2, y = '#f0f25a';
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .55 }), k.B), P(torsoPath(M, { tank: true, nh: S * .3, v: true, dip: 30, strapX: S * .92, hem: 'hip', hemY: .4 }), k.A),
      ...mirror((s) => [L(s * S * .56, -T + 3, s * W * .6, M.pelvisH * .3, 7, y, 'butt'), L(s * S * .56, -T + 3, s * W * .6, M.pelvisH * .3, 2, '#d9dde2', 'butt')]),
      L(-W - .5, -T * .16, W + .5, -T * .16, 8, y, 'butt'), L(-W - .5, -T * .16, W + .5, -T * .16, 2.2, '#d9dde2', 'butt')],
      pelvis: [P(pelvisPath(M), k.C)], ...limbs(M, k, { sleeve: .5, sleeveCol: k.B, legs: 2, legCol: k.C, hem: shade(k.C, .25), shoe: 'boot', shoeCol: '#a8672e' }) };
  } },
  { id: 'tux', name: 'Tuxedo', labels: ['Jacket', 'Bow tie', 'Shoes'], def: ['#1f2029', '#b3202a', '#111114'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, d = shade(k.A, .16);
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .75 }), k.A), P(D`M${-nh - 2} ${-T}L${nh + 2} ${-T}L0 ${-T * .34}Z`, '#fbfaf7'),
      E(0, -T * .66, 1.8, 1.8, '#2a2a30'), E(0, -T * .54, 1.8, 1.8, '#2a2a30'),
      ...mirror((s) => [P(D`M${s * (nh + 2)} ${-T - 1}L${s * 1.5} ${-T * .34}L${s * (nh + 15)} ${-T * .66}Z`, d), P(D`M${s * 13} ${-T}L0 ${-T + 7}L${s * 13} ${-T + 14}Z`, k.B)]),
      E(0, -T + 7, 3.4, 3.4, shade(k.B, -.25)), E(0, -T * .22, 2.6, 2.6, d)],
      pelvis: [P(pelvisPath(M), k.A)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, cuff: '#fbfaf7', legs: 2, legCol: k.A, shoe: 'dress', shoeCol: k.C, sole: '#3a3a44' }) };
  } },
  { id: 'puffer', name: 'Winter Puffer', labels: ['Jacket', 'Scarf', 'Trousers'], def: ['#3f7fbf', '#f2c14e', '#3b3f4a'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, S = M.shoulderW / 2, W = M.waistW / 2, d = shade(k.A, -.16), pH = M.pelvisH;
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: 1 }), k.A), L(-S + 3, -T * .68, S - 3, -T * .68, 2, d, 'butt'), L(-W - 1, -T * .4, W + 1, -T * .4, 2, d, 'butt'), L(-W, -T * .12, W, -T * .12, 2, d, 'butt'), L(-W - 3, pH * .45, W + 3, pH * .45, 2, d, 'butt'),
      L(0, -T + 8, 0, pH, 2.2, shade(k.A, .3), 'butt'), R(-nh - 8, -T - 10, 2 * nh + 16, 16, 8, k.B), R(3, -T + 2, 12, 32, 4, shade(k.B, -.12)), L(5, -T + 35, 5, -T + 40, 2, k.B), L(9, -T + 35, 9, -T + 40, 2, k.B), L(13, -T + 35, 13, -T + 40, 2, k.B)],
      pelvis: [P(pelvisPath(M), k.C)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, quilt: d, cuff: d, glove: k.B, legs: 2, legCol: k.C, shoe: 'boot', shoeCol: '#5a4634' }) };
  } },
  { id: 'hero', name: 'Hero Suit', labels: ['Suit', 'Cape & trim', 'Emblem'], def: ['#3d4fd1', '#e63f5c', '#ffd23f'], fn(M, k) {
    const T = M.torsoLen, S = M.shoulderW / 2, W = M.waistW / 2;
    return { cape: [P(D`M${-S + 5} ${-T + 3}L${S - 5} ${-T + 3}C${S + 14} ${-T * .3} ${S + 20} ${T * .5} ${S + 26} ${T * 1.25}Q${S * .5} ${T * 1.14} 0 ${T * 1.3}Q${-S * .5} ${T * 1.14} ${-S - 26} ${T * 1.25}C${-S - 20} ${T * .5} ${-S - 14} ${-T * .3} ${-S + 5} ${-T + 3}Z`, k.B),
      P(D`M0 ${-T * .2}L0 ${T * 1.28}`, null, { stroke: shade(k.B, -.18), sw: 2.5 })],
      torso: [P(torsoPath(M), k.A), P(D`M0 ${-T * .8}L16 ${-T * .6}L0 ${-T * .38}L-16 ${-T * .6}Z`, k.C),
        P(D`M4 ${-T * .72}L-6 ${-T * .58}L0 ${-T * .58}L-3 ${-T * .46}L7 ${-T * .61}L1 ${-T * .61}Z`, k.A), L(-W - .5, -1, W + .5, -1, 7.5, k.B, 'butt'), R(-6, -6, 12, 10, 2.5, k.C)],
      pelvis: [P(pelvisPath(M), k.A)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, glove: k.B, cuff: k.B, legs: 2, legCol: k.A, shoe: 'boot', shoeCol: k.B }) };
  } },
  { id: 'pajamas', name: 'Pajamas', labels: ['Fabric', 'Stripes', 'Slippers'], def: ['#cfe0f5', '#7d9bd1', '#f29fb5'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, W = M.waistW / 2, st: CastPrim[] = [];
    for (let x = -W + 5; x <= W - 4; x += 9) if (Math.abs(x) > 3) st.push(L(x, -T + 7, x, M.pelvisH * .75, 2.2, k.B, 'butt'));
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .9 }), k.A), ...st, L(0, -T + 12, 0, M.pelvisH * .85, 1.6, shade(k.A, -.2), 'butt'),
      ...mirror((s) => [P(D`M${s * 1} ${-T + 16}L${s * (nh + 3)} ${-T - 3}L${s * (nh + 10)} ${-T + 9}Z`, shade(k.A, .35))]), E(0, -T * .55, 2.5, 2.5, k.B), E(0, -T * .32, 2.5, 2.5, k.B), E(0, -T * .09, 2.5, 2.5, k.B)],
      pelvis: [P(pelvisPath(M), k.A)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, stripe: k.B, legs: 2, legCol: k.A, shoe: 'slipper', shoeCol: k.C, sole: '#ffffff' }) };
  } },
  { id: 'overalls', name: 'Overalls', labels: ['Shirt', 'Denim', 'Boots'], def: ['#c8443a', '#4a6fa5', '#7a4a2a'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, W = M.waistW / 2, S = M.shoulderW / 2, d = shade(k.A, -.22), pl: CastPrim[] = [];
    for (const y of [.8, .56, .32]) pl.push(L(-S + 3, -T * y, S - 3, -T * y, 2, d, 'butt'));
    for (const x of [-.5, .5]) pl.push(L(x * S, -T + 4, x * W, 0, 2, d, 'butt'));
    return { torso: [P(torsoPath(M), k.A), ...pl, ...mirror((s) => [P(D`M${s * 1} ${-T + 13}L${s * (nh + 3)} ${-T - 3}L${s * (nh + 9)} ${-T + 8}Z`, shade(k.A, .25)), L(s * W * .56, -T * .62, s * (nh + 7), -T + 1, 8, k.B, 'butt')]),
      P(D`M${-W * .74} ${-T * .66}L${W * .74} ${-T * .66}L${W + .6} ${-T * .12}L${W + .6} 4L${-W - .6} 4L${-W - .6} ${-T * .12}Z`, k.B),
      R(-W * .36, -T * .5, W * .72, T * .24, 3, shade(k.B, -.14)), ...mirror((s) => [E(s * W * .56, -T * .6, 3.2, 3.2, '#e9c46a')])],
      pelvis: [P(pelvisPath(M), k.B)], ...limbs(M, k, { sleeve: 1.55, sleeveCol: k.A, legs: 2, legCol: k.B, hem: shade(k.B, .22), shoe: 'boot', shoeCol: k.C }) };
  } },
  { id: 'varsity', name: 'Varsity Jacket', labels: ['Jacket', 'Sleeves', 'Trim'], def: ['#2d4a8a', '#f4f1ea', '#e0a526'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, S = M.shoulderW / 2, W = M.waistW / 2, Hp = M.hipW / 2, hy = M.pelvisH * .55, d = shade(k.A, -.22), jn = '#3d5a8c', fl = M.foreLen, aw = M.armW;
    const lp = limbs(M, k, { sleeve: 2, sleeveCol: k.B, legs: 2, legCol: jn, hem: shade(jn, .28), shoe: 'sneaker', shoeCol: '#f4f1ea' });
    const rib = (y: number, x: number, w: number): CastPrim[] => [L(-x, y, x, y, w, d, 'butt'), L(-x, y - w * .22, x, y - w * .22, 1.6, k.C, 'butt'), L(-x, y + w * .22, x, y + w * .22, 1.6, k.C, 'butt')];
    const px = -S * .36, py = -T * .6;
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .55 }), k.A), P(D`M${-nh} ${-T}Q0 ${-T + 12} ${nh} ${-T}`, null, { stroke: d, sw: 6 }), P(D`M${-nh + 1} ${-T + 3}Q0 ${-T + 14} ${nh - 1} ${-T + 3}`, null, { stroke: k.C, sw: 1.6 }),
      L(0, -T + 9, 0, hy, 1.6, d, 'butt'), ...[.66, .46, .26, .06].map((y) => E(1.8, -T * y, 2, 2, shade(k.B, -.1))),
      ...rib(hy - 4, Hp + 1.5, 8),
      P(D`M${px - 8} ${py - 8}L${px - 3} ${py - 8}L${px} ${py + 2}L${px + 3} ${py - 8}L${px + 8} ${py - 8}L${px + 2.5} ${py + 8}L${px - 2.5} ${py + 8}Z`, k.C, { stroke: k.B, sw: 1.6 }),
      R(W * .3, -T * .32, W * .44, T * .2, 3, d)],
      pelvis: [P(pelvisPath(M), jn)], ...lp,
      armF: (s) => [...lp.armF(s), L(0, fl - 9, 0, fl, aw + 4, k.A, 'butt'), L(-aw / 2 - 2, fl - 6.5, aw / 2 + 2, fl - 6.5, 1.6, k.C, 'butt'), L(-aw / 2 - 2, fl - 3, aw / 2 + 2, fl - 3, 1.6, k.C, 'butt')] };
  } },
  { id: 'cardigan', name: 'Cardigan', labels: ['Cardigan', 'Shirt', 'Slacks'], def: ['#8a5a3c', '#e9e2d0', '#4a4a52'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, W = M.waistW / 2, hy = M.pelvisH * .75, d = shade(k.A, -.2), vy = -T * .38;
    return { torso: [P(torsoPath(M, { hem: 'hip', hemY: .75 }), k.A), P(D`M${-nh - 5} ${-T}L${nh + 5} ${-T}L0 ${vy}Z`, k.B),
      ...mirror((s) => [P(D`M${s * 1} ${-T + 12}L${s * (nh + 2)} ${-T - 3}L${s * (nh + 8)} ${-T + 7}Z`, shade(k.B, -.1)), P(D`M${s * (nh + 4)} ${-T - 1}L0 ${vy}`, null, { stroke: d, sw: 5, cap: 'butt' }),
        R(s > 0 ? W * .32 : -W * .32 - W * .46, -T * .2, W * .46, T * .19, 3, d)]),
      L(0, vy - 2, 0, hy + 2, 5, d, 'butt'), E(0, -T * .26, 2.8, 2.8, shade(k.A, .38)), E(0, -T * .06, 2.8, 2.8, shade(k.A, .38))],
      pelvis: [P(pelvisPath(M), k.C)], ...limbs(M, k, { sleeve: 2, sleeveCol: k.A, cuff: d, legs: 2, legCol: k.C, shoe: 'dress', shoeCol: '#4a3226' }) };
  } },
  { id: 'scrubs', name: 'Scrubs', labels: ['Scrubs', 'Badge', 'Shoes'], def: ['#3fae8c', '#f4f1ea', '#f4f1ea'], fn(M, k) {
    const T = M.torsoLen, nh = M.neckW / 2 + 3, S = M.shoulderW / 2, dv = 22, d = shade(k.A, -.18), tr = shade(k.A, -.26);
    return { torso: [P(torsoPath(M, { dip: 0 }), k.skin), P(torsoPath(M, { v: true, dip: dv, nh: nh + 2, hem: 'hip', hemY: .5 }), k.A),
      P(D`M${-nh - 2} ${-T}L0 ${-T + dv}L${nh + 2} ${-T}`, null, { stroke: d, sw: 3.5 }),
      R(-S * .66, -T * .6, S * .42, S * .38, 2.5, d), L(-S * .56, -T * .66, -S * .56, -T * .54, 2.4, k.B), L(-S * .44, -T * .64, -S * .44, -T * .54, 2.4, shade(k.A, .45)),
      L(S * .43, -T * .74, S * .43, -T * .66, 1.6, shade(k.B, -.35)), R(S * .26, -T * .66, S * .34, S * .44, 2.5, k.B), R(S * .3, -T * .62, S * .12, S * .14, 1.5, shade(k.A, -.1)),
      L(S * .3, -T * .45, S * .54, -T * .45, 1.6, shade(k.B, -.3), 'butt')],
      pelvis: [P(pelvisPath(M), tr)], ...limbs(M, k, { sleeve: .55, sleeveCol: k.A, legs: 2, legCol: tr, hem: shade(tr, -.14), shoe: 'sneaker', shoeCol: k.C }) };
  } },
];
