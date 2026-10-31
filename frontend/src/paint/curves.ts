// Per-channel pen response: pressure curves (size, opacity, flow, bleed, roundness) with a response speed each,
// the tilt curve, and the barrel roll amount. Pure maths; the stroke engine owns one PenResponse per stroke.

import type { Brush, PenCurve } from './types';

const N = 256;
export const MAX_NODES = 4;
const lutCache = new WeakMap<PenCurve, Float32Array>();

export function identityCurve(): PenCurve { return { pts: [0, 0, 1, 1] }; }

/** Clean control points: sorted, ends pinned to x = 0 and x = 1, values 0..1, at most MAX_NODES between. */
export function cleanPoints(pts: number[]): number[] {
  const p: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) p.push({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  }
  p.sort((a, b) => a.x - b.x);
  const first = p.length && p[0].x <= 0.001 ? p[0].y : 0;
  const last = p.length && p[p.length - 1].x >= 0.999 ? p[p.length - 1].y : 1;
  const mid = p.filter((q) => q.x > 0.001 && q.x < 0.999);
  const keep: { x: number; y: number }[] = [];
  for (const q of mid) if (!keep.length || q.x - keep[keep.length - 1].x > 0.01) keep.push(q);
  while (keep.length > MAX_NODES) keep.splice(Math.floor(keep.length / 2), 1);
  const out: number[] = [0, first];
  for (const q of keep) out.push(q.x, q.y);
  out.push(1, last);
  return out;
}

export function isIdentity(c: PenCurve | undefined): boolean {
  if (!c) return true;
  const p = c.pts;
  return p.length === 4 && p[0] === 0 && p[1] === 0 && p[2] === 1 && p[3] === 1 && (c.speed === undefined || c.speed >= 1);
}

/** A 257-entry table of the curve (monotone cubic through its nodes, so it never overshoots). */
export function curveLut(c: PenCurve): Float32Array {
  let lut = lutCache.get(c);
  if (lut && (lut as unknown as { k?: string }).k === c.pts.join(',')) return lut;
  const pts = cleanPoints(c.pts);
  const n = pts.length / 2;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < n; i++) { xs.push(pts[i * 2]); ys.push(pts[i * 2 + 1]); }
  const dx: number[] = [], m: number[] = [], t: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); m.push((ys[i + 1] - ys[i]) / dx[i]); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  lut = new Float32Array(N + 1);
  let seg = 0;
  for (let k = 0; k <= N; k++) {
    const x = k / N;
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const h = dx[seg], s = Math.min(1, Math.max(0, (x - xs[seg]) / h)), s2 = s * s, s3 = s2 * s;
    const y = (2 * s3 - 3 * s2 + 1) * ys[seg] + (s3 - 2 * s2 + s) * h * t[seg] + (-2 * s3 + 3 * s2) * ys[seg + 1] + (s3 - s2) * h * t[seg + 1];
    lut[k] = Math.min(1, Math.max(0, y));
  }
  (lut as unknown as { k?: string }).k = c.pts.join(',');
  lutCache.set(c, lut);
  return lut;
}

export function curveAt(lut: Float32Array, v: number): number {
  const x = (v < 0 ? 0 : v > 1 ? 1 : v) * N, i = x | 0;
  return i >= N ? lut[N] : lut[i] + (lut[i + 1] - lut[i]) * (x - i);
}

/** Value of a curve (identity when absent). */
export function curveValue(c: PenCurve | undefined, v: number): number {
  return c ? curveAt(curveLut(c), v) : v;
}

/** The lean (0 upright to 1 flat) reshaped by the brush's tilt curve. */
export function shapeLean(b: Brush, lean: number): number {
  const c = b.curves?.tilt;
  return c ? curveAt(curveLut(c), lean) : lean;
}

/** 0..1 barrel roll amount: 0 at twist 0 (or along the stroke when relative), smooth around the turn. */
export function rollAmount(twistDeg: number, dir: number | null, relative: boolean): number {
  let a = (twistDeg * Math.PI) / 180;
  if (relative && dir !== null) a -= dir;
  return 0.5 - 0.5 * Math.cos(a);
}

const KEYS = ['size', 'opacity', 'flow', 'bleed', 'roundness'] as const;

/** Per-stroke state: low-passes pressure per channel (the response speed) and runs it through the channel's curve. */
export class PenResponse {
  size = 0; opacity = 0; flow = 0; bleed = 0; round = 0;
  private readonly st = new Float32Array(5);
  private readonly luts: (Float32Array | null)[] = [];
  private readonly speed = new Float32Array(5);
  private started = false;

  constructor(b: Brush) {
    const cv = b.curves;
    for (let i = 0; i < 5; i++) {
      const c = cv ? cv[KEYS[i]] : undefined;
      this.luts.push(c && !isIdentity({ pts: c.pts }) ? curveLut(c) : null);
      this.speed[i] = c && c.speed !== undefined ? Math.min(1, Math.max(0, c.speed)) : 1;
    }
  }

  static wanted(b: Brush): boolean {
    const c = b.curves;
    if (!c) return false;
    for (const k of KEYS) if (c[k] && !isIdentity(c[k])) return true;
    return false;
  }

  /** `step` is the distance the pen moved since the last dab and `dia` the dab size, so the speed is per length, not per dab. */
  update(p: number, step: number, dia: number): void {
    const first = !this.started;
    this.started = true;
    for (let i = 0; i < 5; i++) {
      let s = p;
      const sp = this.speed[i];
      if (sp < 1) {
        const len = (1 - sp) * (1 - sp) * 8 * Math.max(4, dia);
        const k = 1 - Math.exp(-Math.max(0.5, step) / len);
        s = first ? p : this.st[i] + (p - this.st[i]) * k;
      }
      this.st[i] = s;
      const l = this.luts[i];
      const v = l ? curveAt(l, s) : s;
      if (i === 0) this.size = v; else if (i === 1) this.opacity = v; else if (i === 2) this.flow = v; else if (i === 3) this.bleed = v; else this.round = v;
    }
  }
}
