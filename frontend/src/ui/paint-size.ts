// The size slider's curve. The slider position (0..1, what is stored and shown as a percent) maps to the brush's
// size range through a power curve, so the first part of the travel is fine (a hairline to a few pixels) and the
// top still reaches the brush's largest size. The paint engine keeps its own linear range: only the host converts.

import type { Brush } from '../paint/types';
import { paintWant } from '../paint/fam-paint-size';

/** Exponent of the curve: 1 is linear, higher is finer at small sizes. */
export const SIZE_EXP = 2;

/** Slider position to the engine's 0..1 size value. */
export function engineSize(s: number): number {
  return Math.pow(Math.min(1, Math.max(0, s)), SIZE_EXP);
}

/** The slider position that gives an engine size value. */
export function sliderOf(engine: number): number {
  return Math.pow(Math.min(1, Math.max(0, engine)), 1 / SIZE_EXP);
}

/** First slider position of a brush with no saved size: its stroke reads as a clear mark (about 10 px on a 1920 canvas), not a hairline. */
export function defaultSlider(b: Brush): number {
  const range = b.maxSize - b.minSize;
  if (range <= 0) return 1;
  let want = Math.max(b.minSize * 1.2, Math.min(14, b.maxSize * 0.85));
  // a wash is laid broad: at a pen's size its rim, pool and bleed are a few pixels and read as a marker
  if ((b.wetEdges ?? 0) > 0 || b.wet || (b.render && /glaze|blending/.test(b.render))) want = Math.max(want, Math.min(b.maxSize * 0.6, 64));
  // an imported brush's picture is a stamp: at pen size it is a smudge a few pixels wide, so it starts at a readable size
  if (b.custom && (b.tip === 'sampled' || b.set === 'Imported')) want = Math.max(want, Math.min(b.maxSize * 0.7, 56));
  // an airbrush or mist is a cloud: at pen size its soft falloff is a few pixels and reads as a hairline
  if (b.softness >= 0.3 && b.flow <= 0.45 && !b.grain && /air|mist|fade|haze/i.test(b.set + ' ' + b.name)) want = Math.max(want, Math.min(b.maxSize * 0.55, 90));
  want = paintWant(b, want);
  return Math.round(sliderOf(Math.min(1, Math.max(0, (want - b.minSize) / range))) * 100) / 100;
}

/** One keyboard step of 5 percent; multiplicative below 20 percent so the small end keeps fine steps. */
export function stepSlider(v: number, dir: 1 | -1): number {
  if (v < 0.2 || (dir < 0 && v <= 0.2)) {
    const n = dir > 0 ? v * 1.25 + 0.005 : v / 1.25 - 0.005;
    return Math.min(1, Math.max(0.01, n));
  }
  return Math.min(1, Math.max(0.01, v + dir * 0.05));
}
