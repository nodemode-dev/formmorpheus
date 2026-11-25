import type { CastPrim, CastRig } from './spec';
import { n } from './prims';

/** A 2D affine matrix [a, b, c, d, e, f], as SVG's matrix(). */
export type Mat = [number, number, number, number, number, number];

const IDENT: Mat = [1, 0, 0, 1, 0, 0];

export const mul = (a: Mat, b: Mat): Mat => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];

/** World matrix of every bone at rest, by bone name. */
export function solveRest(rig: CastRig, rootM: Mat = IDENT): Record<string, Mat> {
  const W: Record<string, Mat> = {};
  for (const b of rig.bones) {
    const r = b.rot, x = b.x, y = b.y, sx = b.sx, sy = b.sy;
    const a = r * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), l: Mat = [cs * sx, sn * sx, -sn * sy, cs * sy, x, y];
    W[b.name] = mul(b.parent ? W[b.parent] : rootM, l);
  }
  return W;
}

export function primSVG(p: CastPrim): string {
  const cap = p.t === 'p' ? p.cap : undefined;
  const st = (p.fill ? ` fill="${p.fill}"` : ' fill="none"') + (p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linecap="${cap || 'round'}" stroke-linejoin="round"` : '') + (p.op != null ? ` opacity="${p.op}"` : '');
  if (p.t === 'e') return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}"${p.rot ? ` transform="rotate(${p.rot} ${p.cx} ${p.cy})"` : ''}${st}/>`;
  if (p.t === 'r') return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${Math.min(p.r, p.w / 2, p.h / 2)}"${st}/>`;
  return `<path d="${p.d}"${st}/>`;
}

const mat = (m: Mat) => `matrix(${m.map((v) => +v.toFixed(3)).join(' ')})`;

export function slotsSVG(rig: CastRig, W: Record<string, Mat>): string {
  return rig.slots.map((s) => {
    const m = s.oy ? mul(W[s.bone], [1, 0, 0, 1, s.ox, s.oy]) : W[s.bone];
    return `<g data-slot="${s.name}" transform="${mat(m)}">${s.prims.map(primSVG).join('')}</g>`;
  }).join('');
}

export interface RigSvgOpts {
  /** full: the whole figure (default); head: a square close on the head. */
  mode?: 'full' | 'head';
}

/** The rest pose as one SVG document. */
export function rigToSvg(rig: CastRig, opts: RigSvgOpts = {}): string {
  const W = solveRest(rig);
  let vb: number[];
  if (opts.mode === 'head') { const cy = -(rig.height - rig.M.headH * .5), s = rig.M.headH * 2.05; vb = [-s / 2, cy - s * .56, s, s]; }
  else vb = [-125, -rig.height - 48, 250, rig.height + 62];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(n).join(' ')}">${slotsSVG(rig, W)}</svg>`;
}
