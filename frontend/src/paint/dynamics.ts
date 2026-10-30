// Pen dynamics: the global pressure curve, size and flow ranges, tilt, and the seeded PRNG.

import type { Brush, Point } from './types';

// ---- pressure curve --------------------------------------------------------

const LUT_N = 256;
let lut = new Float32Array(LUT_N + 1);
let curvePoints: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

function rebuild(): void {
  const pts = curvePoints;
  const n = pts.length;
  // Monotone cubic (Fritsch-Carlson) so a hand-drawn curve never overshoots.
  const dx: number[] = [], m: number[] = [], t: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  if (n > 1) {
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) t[i] = 0;
      else t[i] = (m[i - 1] + m[i]) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        t[i] = k * a * m[i];
        t[i + 1] = k * b * m[i];
      }
    }
  }
  let seg = 0;
  for (let k = 0; k <= LUT_N; k++) {
    const x = k / LUT_N;
    while (seg < n - 2 && x > pts[seg + 1].x) seg++;
    let y: number;
    if (n < 2) y = x;
    else {
      const h = dx[seg];
      const s = Math.min(1, Math.max(0, (x - pts[seg].x) / h));
      const s2 = s * s, s3 = s2 * s;
      y = (2 * s3 - 3 * s2 + 1) * pts[seg].y + (s3 - 2 * s2 + s) * h * t[seg]
        + (-2 * s3 + 3 * s2) * pts[seg + 1].y + (s3 - s2) * h * t[seg + 1];
    }
    lut[k] = Math.min(1, Math.max(0, y));
  }
}
rebuild();

/** Set the global pressure curve from control points (x ascending, both 0..1). */
export function setPressureCurve(points: Point[]): void {
  const pts = points
    .map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }))
    .sort((a, b) => a.x - b.x);
  const clean: Point[] = [];
  for (const p of pts) {
    if (clean.length && p.x - clean[clean.length - 1].x < 1e-4) continue;
    clean.push(p);
  }
  if (clean.length < 2 || clean[0].x > 0 || clean[clean.length - 1].x < 1) {
    if (!clean.length || clean[0].x > 0) clean.unshift({ x: 0, y: 0 });
    if (clean[clean.length - 1].x < 1) clean.push({ x: 1, y: 1 });
  }
  curvePoints = clean;
  rebuild();
}

/** Convenience: a power curve y = x^gamma (gamma below 1 is softer, above 1 firmer). */
export function setPressureGamma(gamma: number): void {
  const g = Math.min(4, Math.max(0.25, gamma));
  const pts: Point[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = i / 8;
    pts.push({ x, y: Math.pow(x, g) });
  }
  setPressureCurve(pts);
}

export function getPressureCurve(): Point[] {
  return curvePoints.map((p) => ({ ...p }));
}

export function applyPressure(p: number): number {
  const x = Math.min(1, Math.max(0, p)) * LUT_N;
  const i = Math.floor(x);
  if (i >= LUT_N) return lut[LUT_N];
  const f = x - i;
  return lut[i] + (lut[i + 1] - lut[i]) * f;
}

// ---- size, flow, tilt ------------------------------------------------------

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Diameter in canvas pixels for a 0..1 size slider value. */
export function baseDiameter(brush: Brush, size: number): number {
  return lerp(brush.minSize, brush.maxSize, Math.min(1, Math.max(0, size)));
}

export function pressureDiameter(base: number, brush: Brush, pressure: number): number {
  return base * lerp(brush.pressureSize[0], brush.pressureSize[1], brush.pressureGamma ? Math.pow(pressure, brush.pressureGamma) : pressure);
}

export function pressureFlow(brush: Brush, pressure: number): number {
  return lerp(brush.pressureFlow[0], brush.pressureFlow[1], brush.pressureGamma ? Math.pow(pressure, brush.pressureGamma) : pressure);
}

export interface TiltInfo {
  /** Degrees above the surface: 90 is upright, 0 is lying flat. */
  altitude: number;
  /** Radians, direction the pen leans towards. */
  azimuth: number;
  /** 0 upright to 1 flat. */
  lean: number;
}

export function tiltInfo(tiltX: number, tiltY: number): TiltInfo {
  const tx = Math.max(-90, Math.min(90, tiltX)), ty = Math.max(-90, Math.min(90, tiltY));
  // Tilt planes to spherical: tan(angle from vertical) combines per axis.
  const tanX = Math.tan((tx * Math.PI) / 180), tanY = Math.tan((ty * Math.PI) / 180);
  const fromVertical = Math.atan(Math.hypot(tanX, tanY));
  const altitude = 90 - (fromVertical * 180) / Math.PI;
  return { altitude, azimuth: Math.atan2(tanY, tanX), lean: Math.min(1, Math.max(0, 1 - altitude / 90)) };
}

export interface TiltShape {
  roundnessMul: number;
  sizeMul: number;
  /** Angle override in radians, or null when the pen is upright. */
  angle: number | null;
}

const UPRIGHT: TiltShape = { roundnessMul: 1, sizeMul: 1, angle: null };

/** How a leaning pen reshapes the dab, scaled by the brush's tilt amount. */
export function tiltShape(brush: Brush, tiltX: number, tiltY: number): TiltShape {
  if (brush.tilt <= 0 || (tiltX === 0 && tiltY === 0)) return UPRIGHT;
  const info = tiltInfo(tiltX, tiltY);
  const k = Math.min(1, info.lean * 1.25) * brush.tilt;
  if (k < 0.02) return UPRIGHT;
  return {
    roundnessMul: lerp(1, 0.32, k),
    sizeMul: lerp(1, 2.4, k),
    angle: info.azimuth,
  };
}

/** Fixed tip angle for shapes that have one when the dab does not follow the stroke. */
export function baseAngle(brush: Brush): number {
  return brush.tip === 'chisel' && !brush.followStroke ? (-40 * Math.PI) / 180 : 0;
}

// ---- colour --------------------------------------------------------------

/** r g b 0..255 to h s v, each 0..1. */
export function rgbToHsv(r: number, g: number, b: number, out: number[]): void {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  out[0] = h; out[1] = mx === 0 ? 0 : d / mx; out[2] = mx / 255;
}

/** h wraps, s and v are clamped; fills out with r g b 0..255. */
export function hsvToRgb(h: number, s: number, v: number, out: number[]): void {
  h = h - Math.floor(h);
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  out[0] = r * 255; out[1] = g * 255; out[2] = b * 255;
}

/** True when a brush needs the per-pixel stroke colour path (colour, wet mix, build-up modes, pooled edges, relief). */
export function needsColourPath(b: Brush): boolean {
  return !!(b.colorDyn || b.wet || b.render || (b.wetEdges ?? 0) > 0 || (b.bump ?? 0) > 0);
}

// ---- seeded PRNG -----------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
