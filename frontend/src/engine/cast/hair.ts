import type { CastPrim } from './spec';
import { blob, D, E, L, n, P, R, shade, type Pt } from './prims';
import { mirror } from './body';

export interface HairStyle { id: string; name: string }

export const HAIRS: readonly HairStyle[] = ([['crop', 'Short Crop'], ['side', 'Side Part'], ['buzz', 'Buzz Cut'], ['afro', 'Afro'], ['bob', 'Bob'], ['long', 'Long Straight'], ['wavy', 'Long Wavy'],
  ['pony', 'Ponytail'], ['bun', 'Top Bun'], ['pigtails', 'Pigtails'], ['spiky', 'Spiky'], ['quiff', 'Quiff'], ['locs', 'Locs']] as const).map(([id, name]) => ({ id, name }));

export const CAPS: Readonly<Record<'crop' | 'back' | 'buzz' | 'part' | 'bangs' | 'side', readonly Pt[]>> = {
  crop: [[-1.06, .5], [-1.09, .8], [-.72, 1.07], [0, 1.13], [.72, 1.07], [1.09, .8], [1.06, .5], [.93, .6], [.84, .78], [.35, .85], [-.3, .81], [-.82, .75], [-.94, .6]],
  back: [[-1.05, .52], [-1.08, .8], [-.72, 1.06], [0, 1.11], [.72, 1.06], [1.08, .8], [1.05, .52], [.92, .66], [.6, .86], [0, .92], [-.6, .86], [-.92, .66]],
  buzz: [[-1.02, .54], [-1.04, .8], [-.7, 1.03], [0, 1.07], [.7, 1.03], [1.04, .8], [1.02, .54], [.92, .68], [.6, .87], [0, .91], [-.6, .87], [-.92, .68]],
  part: [[-1.06, .45], [-1.1, .8], [-.7, 1.08], [0, 1.13], [.7, 1.08], [1.1, .8], [1.06, .45], [.92, .62], [.55, .84], [0, .97], [-.55, .84], [-.92, .62]],
  bangs: [[-1.07, .48], [-1.1, .8], [-.7, 1.08], [0, 1.14], [.7, 1.08], [1.1, .8], [1.07, .48], [.96, .64], [.5, .69], [0, .68], [-.5, .69], [-.96, .64]],
  side: [[-1.07, .48], [-1.1, .8], [-.7, 1.08], [0, 1.14], [.75, 1.07], [1.1, .8], [1.07, .48], [.94, .6], [.88, .8], [.5, .9], [-.1, .78], [-.7, .63], [-.94, .56]],
};

export interface HairParts { back: CastPrim[]; front: CastPrim[]; sway: CastPrim[] }

export function hairBuild(style: number, W: number, H: number, c: string): HairParts {
  const out: HairParts = { back: [], front: [], sway: [] };
  if (style < 0 || !HAIRS[style]) return out;
  const X = (u: number) => u * W / 2, Y = (v: number) => -v * H, mp = (pts: readonly Pt[]): Pt[] => pts.map((p) => [X(p[0]), Y(p[1])]);
  const m = (pts: readonly Pt[], k?: number) => blob(mp(pts), k), cs = shade(c, -.22), ch = shade(c, .25);
  const cap = (name: keyof typeof CAPS) => P(m(CAPS[name]), c), hl = (pts: readonly Pt[]) => P(blob(mp(pts), 1, false), null, { stroke: ch, sw: n(W * .035), op: .5 }), band = '#e85d75';
  switch (HAIRS[style].id) {
    case 'crop': out.front = [cap('crop'), hl([[-.45, 1.02], [0, 1.06], [.45, 1.0]])]; break;
    case 'side': out.front = [cap('side'), hl([[-.2, 1.04], [.3, 1.02], [.7, .92]])]; break;
    case 'buzz': out.front = [P(m(CAPS.buzz), c, { op: .86 })]; break;
    case 'afro': {
      const cy = Y(.76), rx = W * .76, ry = H * .58; out.back = [E(0, cy, rx, ry, c)];
      for (let i = 0; i < 14; i++) { const a = Math.PI * (.95 + i / 13 * 1.1 + 1.0); out.back.push(E(Math.cos(a) * rx * .96, cy + Math.sin(a) * ry * .96, W * .15, W * .15, i % 2 ? c : cs)); }
      out.front = [cap('back'), hl([[-.5, 1.0], [0, 1.05], [.5, 1.0]])]; break;
    }
    case 'bob': out.back = [P(m([[-1.22, .18], [-1.26, .75], [-.75, 1.1], [0, 1.16], [.75, 1.1], [1.26, .75], [1.22, .18], [.8, .08], [-.8, .08]]), cs)]; out.front = [cap('bangs'), hl([[-.5, 1.03], [0, 1.07], [.5, 1.03]])]; break;
    case 'long': out.sway = [P(m([[-1.2, -.52], [-1.25, .3], [-1.2, .8], [-.72, 1.1], [0, 1.16], [.72, 1.1], [1.2, .8], [1.25, .3], [1.2, -.52], [.5, -.62], [-.5, -.62]]), cs)];
      out.front = [cap('part'), L(0, Y(1.12), 0, Y(.97), 1.6, cs, 'butt')]; break;
    case 'wavy': out.sway = [P(m([[-1.3, -.5], [-1.18, -.1], [-1.36, .3], [-1.22, .8], [-.72, 1.12], [0, 1.18], [.72, 1.12], [1.22, .8], [1.36, .3], [1.18, -.1], [1.3, -.5], [.6, -.62], [0, -.5], [-.6, -.62]]), cs)];
      out.front = [cap('side'), hl([[-.2, 1.04], [.3, 1.02], [.7, .92]])]; break;
    case 'pony': out.sway = [P(m([[.45, 1.02], [1.2, 1.08], [1.62, .62], [1.52, .05], [1.28, -.18], [1.22, .3], [1.02, .72]]), cs)]; out.front = [cap('back'), E(X(.86), Y(1.0), W * .07, W * .09, band)]; break;
    case 'bun': out.front = [E(0, Y(1.2), W * .25, H * .19, c), P(D`M${X(-.25)} ${Y(1.24)}Q0 ${Y(1.34)} ${X(.25)} ${Y(1.24)}`, null, { stroke: ch, sw: n(W * .035), op: .5 }), cap('back'), R(X(-.22), Y(1.1), X(.44), H * .05, 3, band)]; break;
    case 'pigtails': out.sway = mirror((s) => [P(m([[-.95 * s, .72], [-1.45 * s, .78], [-1.66 * s, .3], [-1.5 * s, -.15], [-1.22 * s, -.28], [-1.2 * s, .25]]), cs), E(X(-1.1 * s), Y(.7), W * .075, W * .085, band)]);
      out.front = [cap('bangs'), L(0, Y(1.13), 0, Y(.7), 1.6, cs, 'butt')]; break;
    case 'spiky': out.front = [P(m([[-1.05, .5], [-1.22, .86], [-.92, .9], [-.86, 1.22], [-.5, 1.08], [-.3, 1.34], [0, 1.12], [.3, 1.36], [.5, 1.1], [.9, 1.24], [.92, .92], [1.24, .88], [1.05, .5], [.9, .66], [.55, .84], [0, .88], [-.55, .84], [-.9, .66]], .3), c)]; break;
    case 'quiff': out.front = [P(m([[-1.05, .5], [-1.08, .8], [-.8, 1.08], [-.3, 1.3], [.4, 1.36], [.98, 1.16], [1.1, .8], [1.05, .5], [.9, .64], [.85, .8], [.3, .93], [-.4, .86], [-.9, .64]]), c), hl([[-.4, 1.16], [.2, 1.24], [.75, 1.12]])]; break;
    case 'locs': {
      const w = n(W * .12);
      [-.6, -.3, 0, .3, .6].forEach((u, i) => out.sway.push(L(X(u), Y(.5), X(u * 1.05), Y(-.14 + (i % 2) * .06), w, i % 2 ? c : cs)));
      [-1.1, -.9, .9, 1.1].forEach((u, i) => out.sway.push(L(X(u), Y(.82), X(u * 1.07), Y(-.06 + (i % 2) * .1), w, i % 2 ? cs : c)));
      out.front = [cap('back'), ...mirror((s) => [L(X(.35 * s), Y(1.05), X(.84 * s), Y(.7), w, c), L(X(.66 * s), Y(1.0), X(1.0 * s), Y(.58), w, cs)]), L(X(-.1), Y(1.08), X(.1), Y(1.08), w, c)]; break;
    }
  }
  return out;
}
