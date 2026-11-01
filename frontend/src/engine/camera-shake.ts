// Camera shake: a smooth, repeatable hand-held wobble. Sums of sines whose phases come from the seed, so the
// same frame always gives the same offset (preview, export and scrubbing agree). Pure, no DOM.
import type { CameraShake } from './types';

function phases(seed: number): number[] {
  const out: number[] = [];
  let s = (Math.floor(seed) * 2654435761) >>> 0 || 1;
  for (let i = 0; i < 6; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push((s / 4294967296) * Math.PI * 2);
  }
  return out;
}

const cache = new Map<number, number[]>();

function phasesOf(seed: number): number[] {
  const have = cache.get(seed);
  if (have) return have;
  if (cache.size > 64) cache.clear();
  const p = phases(seed);
  cache.set(seed, p);
  return p;
}

/** The offset of the camera at a movie frame: pan in movie pixels, a small turn in degrees. */
export function shakeAt(s: CameraShake, frame: number, fps: number): { dx: number; dy: number; rot: number } {
  if (!(s.amp > 0) || !(s.freq > 0)) return { dx: 0, dy: 0, rot: 0 };
  const t = (frame / Math.max(1, fps)) * s.freq * Math.PI * 2;
  const p = phasesOf(s.seed);
  const dx = Math.sin(t + p[0]) * 0.62 + Math.sin(t * 2.3 + p[1]) * 0.38;
  const dy = Math.sin(t * 1.1 + p[2]) * 0.62 + Math.sin(t * 2.7 + p[3]) * 0.38;
  const rot = Math.sin(t * 0.8 + p[4]) * 0.6 + Math.sin(t * 1.9 + p[5]) * 0.4;
  return { dx: dx * s.amp, dy: dy * s.amp, rot: rot * s.amp * 0.02 };
}
