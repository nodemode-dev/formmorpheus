import type { CastPrim } from './spec';

export type PathPrim = Extract<CastPrim, { t: 'p' }>;
export type EllipsePrim = Extract<CastPrim, { t: 'e' }>;
export type RectPrim = Extract<CastPrim, { t: 'r' }>;
export type Pt = readonly [number, number];

export const n = (v: number): number => Math.round(v * 10) / 10;

export const D = (s: TemplateStringsArray, ...v: number[]): string =>
  s.reduce((a, x, i) => a + x + (i < v.length ? n(v[i]) : ''), '');

export function hex2rgb(h: string): [number, number, number] {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const i = parseInt(h, 16);
  return [(i >> 16) & 255, (i >> 8) & 255, i & 255];
}

export function rgb2hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function shade(h: string, a: number): string {
  const [r, g, b] = hex2rgb(h);
  const t = a < 0 ? 0 : 255, k = Math.abs(a);
  return rgb2hex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

type PathOpts = Partial<Omit<PathPrim, 't' | 'd' | 'fill'>>;
type EllipseOpts = Partial<Omit<EllipsePrim, 't' | 'cx' | 'cy' | 'rx' | 'ry' | 'fill'>>;
type RectOpts = Partial<Omit<RectPrim, 't' | 'x' | 'y' | 'w' | 'h' | 'r' | 'fill'>>;

export const P = (d: string, fill: string | null, o: PathOpts = {}): PathPrim => ({ t: 'p', d, fill, ...o });
export const E = (cx: number, cy: number, rx: number, ry: number, fill: string | null, o: EllipseOpts = {}): EllipsePrim =>
  ({ t: 'e', cx: n(cx), cy: n(cy), rx: n(rx), ry: n(ry), fill, ...o });
export const R = (x: number, y: number, w: number, h: number, r: number, fill: string | null, o: RectOpts = {}): RectPrim =>
  ({ t: 'r', x: n(x), y: n(y), w: n(w), h: n(h), r: n(r), fill, ...o });
export const L = (x1: number, y1: number, x2: number, y2: number, w: number, stroke: string, cap = 'round', o: PathOpts = {}): PathPrim =>
  ({ t: 'p', d: D`M${x1} ${y1}L${x2} ${y2}`, fill: null, stroke, sw: n(w), cap, ...o });

export function blob(pts: readonly Pt[], k = 1, closed = true): string {
  const N = pts.length;
  let d = D`M${pts[0][0]} ${pts[0][1]}`;
  const cnt = closed ? N : N - 1;
  for (let i = 0; i < cnt; i++) {
    const p0 = closed ? pts[(i - 1 + N) % N] : pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = closed ? pts[(i + 2) % N] : pts[Math.min(i + 2, N - 1)];
    d += D`C${p1[0] + (p2[0] - p0[0]) / 6 * k} ${p1[1] + (p2[1] - p0[1]) / 6 * k} ${p2[0] - (p3[0] - p1[0]) / 6 * k} ${p2[1] - (p3[1] - p1[1]) / 6 * k} ${p2[0]} ${p2[1]}`;
  }
  return d + (closed ? 'Z' : '');
}
