// Pen feel: motion filtering, the three dynamic scaling modes and pen button
// decoding. Pure maths on numbers and event fields, no DOM.

import type { PenSample } from './types';

/** Per-brush Pressure and Smoothing choices; a missing field falls back to the global preference. */
export interface FeelOverride {
  /** 0 to 1 stabilization (path averaging) for this brush. */
  stabilization?: number;
  motion?: boolean;
  /** 0 to 1: how much natural expression motion filtering gives back at speed. */
  expression?: number;
  /** Barrel roll turns the stamp (pens that report twist). */
  roll?: boolean;
  /** Pressure response for this brush instead of the global curve: a power curve exponent (below 1 softer, above 1 firmer). */
  gamma?: number;
}

export type ScalingMode = 'off' | 'canvas' | 'screen';
export type CursorMode = 'hover' | 'painting' | 'both' | 'off';
export type OutlineStyle = 'contrast' | 'colour' | 'brush';
export type PenButton = 'cycle' | 'eyedropper' | 'off';

export const ROLL_NAME = /roll/i;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Tremor compensation: slow, small wobble is averaged hard while a quick deliberate
 * move passes almost untouched. Expression widens how early a move counts as quick.
 */
export class MotionFilter {
  private x = 0;
  private y = 0;
  private p = 1;
  private t = 0;
  private has = false;

  reset(): void { this.has = false; }

  apply(s: PenSample, expression: number, amount = 1): PenSample {
    const out = this.step(s, expression);
    if (amount >= 1 || out === s) return out;
    return { ...out, x: s.x + (out.x - s.x) * amount, y: s.y + (out.y - s.y) * amount, pressure: s.pressure + (out.pressure - s.pressure) * amount };
  }

  private step(s: PenSample, expression: number): PenSample {
    if (!this.has) {
      this.x = s.x; this.y = s.y; this.p = s.pressure; this.t = s.time; this.has = true;
      return s;
    }
    const dt = Math.max(1, s.time - this.t);
    const dist = Math.hypot(s.x - this.x, s.y - this.y);
    const speed = dist / dt;
    const e = Math.min(1, Math.max(0, expression));
    const alpha = 0.2 + 0.8 * smooth(0.05, 3 - 2.6 * e, speed);
    this.x += (s.x - this.x) * alpha;
    this.y += (s.y - this.y) * alpha;
    this.p += (s.pressure - this.p) * Math.min(1, alpha + 0.25);
    this.t = s.time;
    return { ...s, x: this.x, y: this.y, pressure: this.p };
  }
}

/** Reference size the Canvas scaling mode treats as 1:1. */
const REF_SIDE = 1920;

/**
 * What the stroke and the cursor need for a scaling mode. `zoom` and `dynamic` feed
 * StrokeSettings (a dab is scaled by 1 / zoom when dynamic); `k` is the dab scale in
 * canvas pixels per slider pixel, `screenFixed` is true when the cursor keeps its screen size.
 */
export function brushScale(mode: ScalingMode, viewScale: number, docW: number, docH: number): { zoom: number; dynamic: boolean; k: number; screenFixed: boolean } {
  if (mode === 'screen') return { zoom: viewScale, dynamic: true, k: 1 / Math.max(1e-6, viewScale), screenFixed: true };
  if (mode === 'canvas') {
    const k = Math.min(4, Math.max(0.25, Math.max(docW, docH) / REF_SIDE));
    return { zoom: 1 / k, dynamic: true, k, screenFixed: false };
  }
  return { zoom: 1, dynamic: false, k: 1, screenFixed: false };
}

export interface PenButtons { pointerType: string; button: number; buttons: number }

/** The pen's eraser end, or its barrel button, as pressed on a pointer event. */
export function penButton(e: PenButtons): 'eraser' | 'barrel' | null {
  if (e.pointerType !== 'pen') return null;
  if (e.button === 5 || (e.buttons & 32) !== 0) return 'eraser';
  if (e.button === 2 || (e.buttons & 2) !== 0) return 'barrel';
  return null;
}
