import type { CastBone, CastPrim, CastRig, CastSlot, CastSpec } from './spec';
import { metrics } from './metrics';
import { E, n, R, shade } from './prims';
import { OUTFITS } from './outfits';
import { headBuild } from './head';
import { hairBuild } from './hair';

/** The studio's character input: any field left out takes its group's default. */
export interface CastInput {
  id: string;
  name: string;
  group: CastSpec['group'];
  tag: string;
  species?: string;
  frame?: CastSpec['frame'];
  headWide?: number;
  skin: string;
  hair: readonly [number, string];
  outfit: number;
  colors?: Record<number, string[]>;
  body?: Partial<CastSpec['body']>;
  face?: Partial<CastSpec['face']>;
}

export function mkSpec(o: CastInput): CastSpec {
  return {
    id: o.id, name: o.name, group: o.group, tag: o.tag, species: o.species || 'human', frame: o.frame || (o.group === 'F' ? 'f' : 'm'), headWide: o.headWide || 1, skin: o.skin,
    hair: { style: o.hair[0], color: o.hair[1] }, outfit: o.outfit, colors: o.colors || {}, body: Object.assign({ h: 1, build: 1, head: 1, shoulders: 1 }, o.body),
    face: Object.assign({ eyeColor: '#2b2320', lashes: o.group === 'F', blush: true, freckles: false, glasses: false, beard: 'none' as const, earrings: false, lip: o.group === 'F' ? '#b5485a' : '#8a4a3c', jaw: o.group === 'F' ? .72 : .86 }, o.face),
  };
}

export function build(c: CastSpec): CastRig {
  const M = metrics(c), of = OUTFITS[c.outfit], col = (c.colors && c.colors[c.outfit]) || of.def, k = { A: col[0], B: col[1], C: col[2], skin: c.skin };
  const pt = of.fn(M, k), hd = headBuild(c, M), hr = hairBuild(c.hair.style, M.headW, M.headH, c.hair.color);
  const T = M.torsoLen, S = M.shoulderW / 2, H = M.headH, legLen = M.thighLen + M.shinLen + M.footH, bones: CastBone[] = [], slots: CastSlot[] = [];
  const B = (name: string, parent: string | null, x: number, y: number, rot?: number, tx?: number, ty?: number, sy?: number) =>
    bones.push({ name, parent, x: n(x), y: n(y), rot: rot || 0, sx: 1, sy: sy ?? 1, tx: n(tx || 0), ty: n(ty || 0) });
  const SL = (name: string, bone: string, prims: CastPrim[] | undefined, oy?: number) => { if (prims && prims.length) slots.push({ name, bone, prims, ox: 0, oy: n(oy || 0) }); };
  B('root', null, 0, 0); B('shadow', 'root', 0, 0); B('hip', 'root', 0, -legLen); B('torso', 'hip', 0, -M.pelvisH, 0, 0, -T); B('neck', 'torso', 0, -T, 0, 0, -M.neckLen);
  B('head', 'neck', 0, -M.neckLen, 0, 0, -H); B('eyes', 'head', 0, -H * .44); B('brows', 'head', 0, -H * .44 - 14 * M.u); B('mouth', 'head', 0, -H * .2); B('mouthO', 'head', 0, -H * .2, 0, 0, 0, 0);
  B('hairSway', 'head', 0, -H * .62, 0, 0, H * .55);
  for (const s of [-1, 1]) {
    const x = s < 0 ? 'L' : 'R';
    B(`arm_${x}_upper`, 'torso', s * (S - M.armW * .42), -T + M.armW * .55, -s * 7, 0, M.upperLen); B(`arm_${x}_fore`, `arm_${x}_upper`, 0, M.upperLen, s * 3, 0, M.foreLen); B(`hand_${x}`, `arm_${x}_fore`, 0, M.foreLen, 0, 0, M.handR * 1.6);
    B(`thigh_${x}`, 'hip', s * M.hipX, 0, -s * 1.5, 0, M.thighLen); B(`shin_${x}`, `thigh_${x}`, 0, M.thighLen, s * 1.5, 0, M.shinLen); B(`foot_${x}`, `shin_${x}`, 0, M.shinLen, 0, s * M.footL * .55, M.footH - 4);
  }
  SL('shadow', 'shadow', [E(0, 2, M.hipW * .75 + 18, 9, '#000000', { op: .16 })]);
  SL('cape', 'torso', pt.cape); SL('hairSway', 'hairSway', hr.sway, H * .62); SL('hairBack', 'head', hr.back); SL('hoodBack', 'torso', pt.hoodBack);
  for (const s of [-1, 1]) { const x = s < 0 ? 'L' : 'R'; SL(`thigh_${x}`, `thigh_${x}`, pt.thigh(s)); SL(`shin_${x}`, `shin_${x}`, pt.shin(s)); SL(`foot_${x}`, `foot_${x}`, pt.foot(s)); }
  SL('pelvis', 'hip', pt.pelvis); SL('neck', 'torso', [R(-M.neckW / 2, -T - M.neckLen - 6, M.neckW, M.neckLen + 14, 5, shade(c.skin, -.08))]);
  SL('torso', 'torso', pt.torso); SL('skirt', 'hip', pt.skirt);
  for (const s of [-1, 1]) { const x = s < 0 ? 'L' : 'R'; SL(`arm_${x}_upper`, `arm_${x}_upper`, pt.armU(s)); SL(`arm_${x}_fore`, `arm_${x}_fore`, pt.armF(s)); SL(`hand_${x}`, `hand_${x}`, pt.hand(s)); }
  SL('headBehind', 'head', hd.behind); SL('head', 'head', hd.head); SL('eyes', 'eyes', hd.eyes, H * .44); SL('brows', 'brows', hd.brows);
  SL('mouth', 'mouth', hd.mouth); SL('mouthOpen', 'mouthO', hd.mouthO); SL('hairFront', 'head', hr.front); SL('headAcc', 'head', hd.acc);
  // Eye prims sit on the eye line already, so the slot takes no offset.
  const eyes = slots.find((s) => s.name === 'eyes');
  if (eyes) eyes.oy = 0;
  return { M, bones, slots, height: legLen + M.pelvisH + T + M.neckLen + H };
}
