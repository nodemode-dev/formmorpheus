// PenSample v2: everything a pen, a mouse, a finger or a linked tablet can say about one point, plus the maths
// that shapes pressure (user curve, min and max, smoothing, missing first sample). Pure: no DOM, no window.

import type { PenSample } from './types';

export type PenSource = 'pen' | 'mouse' | 'touch' | 'link';

/** A PenSample with the whole pointer record. `pressure` is the shaped value; `rawPressure` is -1 when the device gave none. */
export interface PenSampleV2 extends PenSample {
  /** ms, performance.now() timebase (same as `time`). */
  t: number;
  /** As reported, 0..1, or -1 when missing (a pen in contact that says 0). */
  rawPressure: number;
  /** -1..1, 0 when absent. */
  tangential: number;
  /** Radians, 0 (flat) to pi/2 (upright). */
  altitude: number;
  /** Radians, 0..2pi. */
  azimuth: number;
  /** Contact size in CSS pixels. */
  width: number;
  height: number;
  eraser: boolean;
  /** Barrel bits: 1 = first button, 2 = second button. */
  barrel: number;
  hover: boolean;
  /** persistentDeviceId or 0. */
  deviceId: number;
  source: PenSource;
}

/** The fields of a PointerEvent this module reads (so a synthetic or linked event works the same). */
export interface PointerLike {
  pointerType: string;
  pressure: number;
  tangentialPressure?: number;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  width?: number;
  height?: number;
  button: number;
  buttons: number;
  timeStamp: number;
  isTrusted?: boolean;
  persistentDeviceId?: number;
}

const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

// ---- tilt <-> altitude / azimuth ------------------------------------------

/** Tilt in degrees (as PointerEvent) to altitude and azimuth in radians. Upright gives (pi/2, 0). */
export function tiltToAltAz(tiltX: number, tiltY: number): { altitude: number; azimuth: number } {
  const tx = Math.tan(tiltX * DEG), ty = Math.tan(tiltY * DEG);
  if (!tx && !ty) return { altitude: HALF_PI, azimuth: 0 };
  const altitude = HALF_PI - Math.atan(Math.hypot(tx, ty));
  let azimuth = Math.atan2(ty, tx);
  if (azimuth < 0) azimuth += Math.PI * 2;
  return { altitude, azimuth };
}

/** The reverse: altitude and azimuth in radians to tilt degrees. */
export function altAzToTilt(altitude: number, azimuth: number): { tiltX: number; tiltY: number } {
  if (altitude >= HALF_PI - 1e-6) return { tiltX: 0, tiltY: 0 };
  const k = Math.tan(HALF_PI - Math.max(0.0001, altitude));
  return { tiltX: Math.atan(k * Math.cos(azimuth)) / DEG, tiltY: Math.atan(k * Math.sin(azimuth)) / DEG };
}

// ---- pressure curve --------------------------------------------------------

export type CurvePoint = [number, number];

export const CURVE_PRESETS: { id: string; label: string; points: CurvePoint[] }[] = [
  { id: 'soft', label: 'Soft', points: gammaPoints(0.6) },
  { id: 'normal', label: 'Normal', points: gammaPoints(0.8) },
  { id: 'firm', label: 'Firm', points: gammaPoints(1.8) },
  { id: 'linear', label: 'Linear', points: [[0, 0], [1, 1]] },
  // a tablet driven from another device tends to answer harshly; this lifts the light end
  { id: 'ipad', label: 'Linked tablet', points: gammaPoints(0.5) },
];

function gammaPoints(g: number): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i <= 6; i++) out.push([i / 6, Math.pow(i / 6, g)]);
  return out;
}

const LUT_N = 256;

/** Clean control points: clamp, sort, drop near duplicates, pin the ends at x 0 and 1. */
export function cleanCurve(points: CurvePoint[]): CurvePoint[] {
  const pts = points
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map((p): CurvePoint => [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))])
    .sort((a, b) => a[0] - b[0]);
  const out: CurvePoint[] = [];
  for (const p of pts) if (!out.length || p[0] - out[out.length - 1][0] > 1e-3) out.push(p);
  if (!out.length || out[0][0] > 0) out.unshift([0, 0]);
  if (out[out.length - 1][0] < 1) out.push([1, 1]);
  return out;
}

/** The user's pressure curve: monotone cubic through control points, clamped by min and max, read from a 256-entry table. */
export class PressureCurve {
  readonly lut = new Float32Array(LUT_N + 1);
  points: CurvePoint[] = [[0, 0], [1, 1]];
  min = 0;
  max = 1;

  constructor(points?: CurvePoint[], min = 0, max = 1) { this.set(points ?? this.points, min, max); }

  set(points: CurvePoint[], min = this.min, max = this.max): void {
    this.points = cleanCurve(points);
    this.min = Math.min(0.9, Math.max(0, min));
    this.max = Math.max(this.min + 0.05, Math.min(1, max));
    this.build();
  }

  private build(): void {
    const p = this.points, n = p.length;
    const dx: number[] = [], m: number[] = [], t: number[] = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0]); m.push((p[i + 1][1] - p[i][1]) / dx[i]); }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let seg = 0;
    for (let k = 0; k <= LUT_N; k++) {
      const x = k / LUT_N;
      while (seg < n - 2 && x > p[seg + 1][0]) seg++;
      const h = dx[seg], s = Math.min(1, Math.max(0, (x - p[seg][0]) / h)), s2 = s * s, s3 = s2 * s;
      const y = (2 * s3 - 3 * s2 + 1) * p[seg][1] + (s3 - 2 * s2 + s) * h * t[seg]
        + (-2 * s3 + 3 * s2) * p[seg + 1][1] + (s3 - s2) * h * t[seg + 1];
      this.lut[k] = Math.min(1, Math.max(0, y));
    }
  }

  /** The curve alone, x in 0..1 (what the editor draws). */
  at(x: number): number {
    const f = Math.min(1, Math.max(0, x)) * LUT_N, i = Math.floor(f);
    return i >= LUT_N ? this.lut[LUT_N] : this.lut[i] + (this.lut[i + 1] - this.lut[i]) * (f - i);
  }

  /** Raw pressure to shaped pressure: below min is 0, above max is full, the curve between. */
  apply(raw: number): number {
    return this.at((raw - this.min) / (this.max - this.min));
  }
}

// ---- smoothing -------------------------------------------------------------

/** A 1-pole low-pass on pressure whose time constant is in milliseconds, so it behaves the same at 60 and 240 Hz. */
export class PressureSmoother {
  private v = -1;
  private t = 0;

  reset(): void { this.v = -1; }

  /** `amount` 0..1: 0 passes through, 1 is a 40 ms time constant. */
  push(p: number, t: number, amount: number): number {
    if (this.v < 0 || amount <= 0.001) { this.v = p; this.t = t; return p; }
    const dt = Math.max(0.25, Math.min(100, t - this.t));
    const tau = amount * 40;
    this.v += (p - this.v) * (1 - Math.exp(-dt / tau));
    this.t = t;
    return this.v;
  }

  get last(): number { return this.v; }
}

// ---- reading a pointer -----------------------------------------------------

/** Where a sample came from: a synthetic pen event (not trusted) is a linked tablet. */
export function sourceOf(e: PointerLike): PenSource {
  if (e.pointerType === 'pen') return e.isTrusted === false ? 'link' : 'pen';
  return e.pointerType === 'touch' ? 'touch' : 'mouse';
}

/** Barrel and eraser bits of a pointer event. Chromium: buttons 2 and 4 are the barrel buttons, 32 the eraser end. */
export function barrelBits(e: Pick<PointerLike, 'button' | 'buttons' | 'pointerType'>): { eraser: boolean; barrel: number } {
  if (e.pointerType !== 'pen') return { eraser: false, barrel: 0 };
  const eraser = e.button === 5 || (e.buttons & 32) !== 0;
  let barrel = 0;
  if (e.button === 2 || (e.buttons & 2) !== 0) barrel |= 1;
  if (e.button === 1 || (e.buttons & 4) !== 0) barrel |= 2;
  return { eraser, barrel };
}

export interface ReadOptions {
  /** False reports a flat pen (tilt 0) for brushes that should ignore it. */
  tiltAngle: boolean;
  curve: PressureCurve;
  smoother: PressureSmoother;
  smoothing: number;
  /** Run the smoother (not for a predicted point, which must not move its state). */
  advance: boolean;
  /** Applied last: the older global curve. */
  after: (p: number) => number;
  /** Pressure to use when a pen in contact reports 0; -1 to leave it missing. */
  fallback: number;
  /** A mouse event that carries a pressure above 0 is read like a pen (curve and smoother). Off: a mouse is full pressure. */
  mousePressure?: boolean;
}

/** Turn one pointer record into a v2 sample at canvas position (x, y). A missing pen pressure comes back as rawPressure -1. */
export function readPointer(e: PointerLike, x: number, y: number, o: ReadOptions): PenSampleV2 {
  const source = sourceOf(e);
  const kind = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
  const bits = barrelBits(e);
  const pen = kind === 'pen';
  const hover = pen && e.buttons === 0;
  let raw = e.pressure;
  let pressure = 1;
  if (pen) {
    if (hover) { raw = 0; pressure = 0; }
    else if (!(raw > 0)) {
      raw = -1;
      pressure = o.fallback >= 0 ? o.after(o.curve.apply(o.fallback)) : -1;
    } else {
      const sm = o.advance ? o.smoother.push(raw, e.timeStamp, o.smoothing) : raw;
      pressure = o.after(o.curve.apply(sm));
    }
  } else if (kind === 'touch') {
    raw = e.pressure > 0 ? e.pressure : 0.5;
    pressure = o.after(raw);
  } else if (o.mousePressure && e.buttons !== 0 && e.pressure > 0) {
    // a tablet that arrives as a mouse and still sends pressure
    raw = e.pressure;
    const sm = o.advance ? o.smoother.push(raw, e.timeStamp, o.smoothing) : raw;
    pressure = o.after(o.curve.apply(sm));
  } else raw = 1;
  const tx = pen && o.tiltAngle ? e.tiltX || 0 : 0, ty = pen && o.tiltAngle ? e.tiltY || 0 : 0;
  let { altitude, azimuth } = tiltToAltAz(tx, ty);
  // a device that reports altitude and azimuth but no tilt still gets them
  if (pen && o.tiltAngle && !tx && !ty && typeof e.altitudeAngle === 'number' && e.altitudeAngle < HALF_PI - 1e-3) {
    altitude = e.altitudeAngle;
    azimuth = e.azimuthAngle ?? 0;
  }
  const tilt = altitude < HALF_PI - 1e-6 && !tx && !ty ? altAzToTilt(altitude, azimuth) : { tiltX: tx, tiltY: ty };
  return {
    x, y, pressure, tiltX: tilt.tiltX, tiltY: tilt.tiltY, twist: pen ? e.twist || 0 : 0, time: e.timeStamp, kind,
    t: e.timeStamp, rawPressure: raw, tangential: pen ? e.tangentialPressure || 0 : 0, altitude, azimuth,
    width: e.width || 0, height: e.height || 0, eraser: bits.eraser, barrel: bits.barrel, hover,
    deviceId: e.persistentDeviceId || 0, source,
  };
}
