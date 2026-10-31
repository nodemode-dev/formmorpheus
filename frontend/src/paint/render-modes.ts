// The rendering modes as distinct compositing algorithms (not gain tables).
//   Glaze modes lay a thin, transparent pigment film: the film's absorption ADDS to what is already there
//   (Beer-Lambert, in K/S space), so blue glazed over yellow goes green and keeps darkening as it is layered.
//   They never pick canvas paint up.
//   Blending modes mix the pigments as opaque paint (Kubelka-Munk mixing weighted by area), pick the paint
//   under the stamp up into the stroke's reservoir and drag it along.
// k is the build-up of a stroke's coverage per overlapping dab, uniform caps coverage at the strongest dab.

import type { RenderMode, WetMix } from './types';

export interface RenderAlgo {
  k: number;
  uniform: boolean;
  /** True: absorption adds on the canvas. False: pigments mix by weight. */
  glaze: boolean;
  /** Film density multiplier for glaze, pigment strength for blending. */
  gain: number;
  /** Wet mix used when the brush has none of its own (blending modes only). */
  wet: WetMix | null;
  /** Glaze only: films keep stacking inside one stroke (heavy glaze); otherwise one stroke lays one film over what was there. */
  stack?: boolean;
  /** Blending only: the share of the canvas pigment that stays in the mix where the stroke is fully deposited. */
  keep: number;
}

export const RENDER_ALGOS: Record<RenderMode, RenderAlgo> = {
  'light-glaze': { k: 0.45, uniform: false, glaze: true, gain: 0.7, wet: null, keep: 0 },
  'uniform-glaze': { k: 1, uniform: true, glaze: true, gain: 1, wet: null, keep: 0 },
  'intense-glaze': { k: 1.8, uniform: false, glaze: true, gain: 1.2, wet: null, keep: 0 },
  'heavy-glaze': { k: 2.4, uniform: false, glaze: true, gain: 2, wet: null, keep: 0, stack: true },
  'uniform-blending': { k: 1, uniform: true, glaze: false, gain: 1, wet: { dilution: 0.1, charge: 0.7, attack: 0.3, pull: 0.45, grade: 0.5 }, keep: 0.3 },
  'intense-blending': { k: 1.8, uniform: false, glaze: false, gain: 1.05, wet: { dilution: 0.15, charge: 0.55, attack: 0.6, pull: 0.8, grade: 0.4 }, keep: 0.4 },
  'heavy-blending': { k: 2.4, uniform: false, glaze: false, gain: 1.25, wet: { dilution: 0.2, charge: 0.45, attack: 0.8, pull: 1, grade: 0.35 }, keep: 0.5 },
};

/** Plain wet paint (a brush with a wet mix and no rendering mode): blends like the intense blending mode with its own build-up. */
export const WET_DEFAULT: RenderAlgo = { k: 1, uniform: false, glaze: false, gain: 1, wet: null, keep: 0.3 };
