// Motion blur: per-content, from the content's own motion between frames. The renderer draws the content at
// several sub-frame poses (its Move and Scale, Warp, Distort and bones keys, its parents and the camera) and
// averages them. The lane `fx:motionblur` (shutter angle, samples) is keyable per content; Movie settings can
// switch it on for the whole movie. Pure, no DOM.
import { registerEffect } from './registry';
import type { Animated } from '../keys';
import type { Mat } from '../transform';
import type { Movie } from '../types';

export interface MotionCfg { shutter: number; samples: number }

export const SHUTTER_MAX = 720;

registerEffect({
  id: 'motionblur',
  label: 'Motion Blur',
  icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="12" y="7.5" width="8" height="9" rx="1.5"/><path d="M3.5 9.5h6M2.5 12h7M3.5 14.5h6" opacity=".6"/></svg>',
  params: [
    { id: 'shutter', label: 'Shutter angle', short: 'Shutter', min: 0, max: SHUTTER_MAX, step: 1, unit: 'deg', def: 180 },
    { id: 'samples', label: 'Maximum samples', short: 'Samples', min: 2, max: 64, step: 1, unit: '', def: 16 },
  ],
  // a render-level effect: the renderer reads the lane itself, there is nothing to run on the picture
  active: () => false,
  pad: () => 0,
  cpu: () => undefined,
  gpu: [],
});

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The motion blur in force for a content: its own lane wins over the movie-wide switch. Null: none. */
export function motionCfg(movie: Movie, a: Animated): MotionCfg | null {
  const inst = a.fx?.find((f) => f.id === 'motionblur');
  if (inst) {
    const s = clampN(inst.p.shutter ?? 180, 0, SHUTTER_MAX);
    return s > 0 ? { shutter: s, samples: Math.round(clampN(inst.p.samples ?? 16, 2, 64)) } : null;
  }
  const m = movie.motionBlur;
  if (m && m.on && m.shutter > 0) return { shutter: clampN(m.shutter, 0, SHUTTER_MAX), samples: Math.round(clampN(m.samples, 2, 64)) };
  return null;
}

/** Sub-frame offsets (in frames) centred on the frame: the shutter is open for shutter/360 of a frame. */
export function subOffsets(cfg: MotionCfg): number[] {
  const out: number[] = [];
  const span = cfg.shutter / 360;
  for (let i = 0; i < cfg.samples; i++) out.push(((i + 0.5) / cfg.samples - 0.5) * span);
  return out;
}

const arrDiffer = (p: number[] | null, q: number[] | null): boolean => {
  if (p === q) return false;
  if (!p || !q || p.length !== q.length) return true;
  for (let i = 0; i < p.length; i++) if (Math.abs(p[i] - q[i]) > 1e-4) return true;
  return false;
};

/** Whether two poses of one content (matrix and mesh keys) differ enough to smear. */
export function poseMoves(m0: Mat, m1: Mat, a0: Animated, a1: Animated): boolean {
  for (let i = 0; i < 6; i++) if (Math.abs(m0[i] - m1[i]) > 1e-4) return true;
  if (arrDiffer(a0.distort, a1.distort)) return true;
  if ((a0.warp || a1.warp) && (arrDiffer(a0.warp?.dx ?? null, a1.warp?.dx ?? null) || arrDiffer(a0.warp?.dy ?? null, a1.warp?.dy ?? null))) return true;
  if (a0.bones || a1.bones) {
    const ids = new Set([...Object.keys(a0.bones ?? {}), ...Object.keys(a1.bones ?? {})]);
    for (const id of ids) if (Math.abs((a0.bones?.[id] ?? 0) - (a1.bones?.[id] ?? 0)) > 1e-3) return true;
  }
  return false;
}
