// Pen dynamics: the global pressure curve, size and flow ranges, tilt, and the seeded PRNG.

import type { Brush, Point } from './types';
import { shapeLean } from './curves';

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

/** Size reference: a brush's sizes are canvas pixels on a 1920 px long side and scale with the canvas from there. */
export const SIZE_REF = 1920;

/** Diameter in canvas pixels for a 0..1 size slider value; `canvasLong` (the canvas's long side) scales it unless the brush is fixed. */
export function baseDiameter(brush: Brush, size: number, canvasLong = 0): number {
  const k = canvasLong > 0 && !brush.sizeAbs ? canvasLong / SIZE_REF : 1;
  return lerp(brush.minSize, brush.maxSize, Math.min(1, Math.max(0, size))) * k;
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
  /** 0 to 1 lean past the brush's tilt angle; opacityMul, gradation and bleed follow it. */
  lean: number;
  opacityMul: number;
  gradation: number;
  bleed: number;
}

const UPRIGHT: TiltShape = { roundnessMul: 1, sizeMul: 1, angle: null, lean: 0, opacityMul: 1, gradation: 0, bleed: 0 };

/** How a leaning pen reshapes the dab, scaled by the brush's tilt amount. */
export function tiltShape(brush: Brush, tiltX: number, tiltY: number): TiltShape {
  const extra = !!(brush.tiltOpacity || brush.tiltGradation || brush.tiltBleed || brush.tiltSize);
  if ((brush.tilt <= 0 && !extra) || (tiltX === 0 && tiltY === 0)) return UPRIGHT;
  const info = tiltInfo(tiltX, tiltY);
  const th = Math.min(0.95, Math.max(0, (brush.tiltAngle ?? 0) / 90));
  const lean = shapeLean(brush, Math.min(1, Math.max(0, (info.lean - th) / (1 - th))));
  // a side-shading medium reaches its full swath sooner: a pen leaning 35 degrees already lays a clearly broader mark
  // (a bristle bundle is paint, not a dry stick: oil and impasto keep their own lean, so this dry-media rule skips them)
  const paintLike = !!brush.bristle || !!brush.wet || !!brush.render || ['bristle', 'comb', 'speckle', 'dots', 'sponge', 'splat'].includes(brush.tip);
  // a scattered brush (toothbrush, spatter) keeps its size on a lean: growing it only throws the scatter wider
  const scattered = (brush.shapeCount ?? 1) > 1 || (brush.scatterPos ?? 0) > 0.3;
  const sideOn = brush.tilt >= 0.6 && !paintLike && !scattered;
  const k = (sideOn ? Math.min(1, lean * 1.7) * Math.min(1, brush.tilt * 1.15) : Math.min(1, lean * 1.25) * brush.tilt);
  const flat = k >= 0.02;
  // Shading with the side of the lead: the mark grows wide (also along the lean), softens, lightens and shows more
  // of the paper's tooth, unless the brush sets its own tilt opacity, gradation or bleed.
  // The oval's long axis (along the lean) grows to 4x; its short axis keeps growing too (to 2x), so a pen leaning
  // along the stroke still lays a wider line, and one leaning across it lays a broad shading band.
  // a pencil, charcoal or pastel (tilt 0.6 and up) shades with its whole side: a broad, soft swath that lies across the lean
  const side = sideOn;
  const grow = flat && !scattered;
  // paint on a bundle (hair, oil, knife) leans into a modest, round-ended oval: a wide stretched one reads as a box
  const longK = grow ? 1 + (side ? (brush.maxSize < 30 ? 7.4 : 5.2) : paintLike ? 1.6 : 3) * k : 1, shortK = grow ? 1 + (side ? 0.68 * (brush.maxSize < 30 ? 7.4 : 5.2) : paintLike ? 0.6 : 1) * k : 1;
  return {
    roundnessMul: flat ? shortK / longK : 1,
    sizeMul: longK * (brush.tiltSize ? Math.max(0.2, 1 + brush.tiltSize * lean * 1.2) : 1),
    angle: flat ? info.azimuth : null,
    lean,
    opacityMul: brush.tiltOpacity ? Math.max(0.05, 1 + brush.tiltOpacity * lean) : 1 - (side ? 0.42 : 0.3) * k,
    gradation: (brush.tiltGradation ?? 0.45 * brush.tilt) * lean,
    bleed: (brush.tiltBleed ?? (side ? 0.5 : 0.3) * brush.tilt) * lean,
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
  return !!(b.colorDyn || b.wet || b.render || (b.wetEdges ?? 0) > 0 || (b.bump ?? 0) > 0
    || (b.burntEdges ?? 0) > 0 || (b.blend && b.blend !== 'normal') || (b.lumBlend ?? 0) > 0);
}

/** One channel of a separable blend, base and source 0..255. Unknown modes act as normal. */
export function blendChannel(mode: string, b: number, s: number): number {
  const bn = b / 255, sn = s / 255;
  let r: number;
  switch (mode) {
    case 'multiply': r = bn * sn; break;
    case 'screen': r = 1 - (1 - bn) * (1 - sn); break;
    case 'overlay': r = bn < 0.5 ? 2 * bn * sn : 1 - 2 * (1 - bn) * (1 - sn); break;
    case 'hard-light': r = sn < 0.5 ? 2 * bn * sn : 1 - 2 * (1 - bn) * (1 - sn); break;
    case 'soft-light': r = sn < 0.5 ? bn - (1 - 2 * sn) * bn * (1 - bn) : bn + (2 * sn - 1) * (Math.sqrt(bn) - bn); break;
    case 'darken': r = Math.min(bn, sn); break;
    case 'lighten': r = Math.max(bn, sn); break;
    case 'color-dodge': r = sn >= 1 ? 1 : Math.min(1, bn / (1 - sn)); break;
    case 'color-burn': r = sn <= 0 ? 0 : 1 - Math.min(1, (1 - bn) / sn); break;
    case 'linear-burn': r = Math.max(0, bn + sn - 1); break;
    case 'difference': r = Math.abs(bn - sn); break;
    case 'exclusion': r = bn + sn - 2 * bn * sn; break;
    case 'add': r = Math.min(1, bn + sn); break;
    case 'subtract': r = Math.max(0, bn - sn); break;
    case 'divide': r = sn <= 0 ? 1 : Math.min(1, bn / sn); break;
    case 'linear-light': r = Math.min(1, Math.max(0, bn + 2 * sn - 1)); break;
    case 'vivid-light': r = sn < 0.5 ? (sn <= 0 ? 0 : 1 - Math.min(1, (1 - bn) / (2 * sn))) : (sn >= 1 ? 1 : Math.min(1, bn / (2 * (1 - sn)))); break;
    case 'pin-light': r = sn < 0.5 ? Math.min(bn, 2 * sn) : Math.max(bn, 2 * (sn - 0.5)); break;
    case 'hard-mix': r = bn + sn >= 1 ? 1 : 0; break;
    default: r = sn;
  }
  return r * 255;
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
