// The Animation library: eighteen sets of ten original brushes, aimed at line work, boiling lines,
// lettering, paint and texture for frame-by-frame drawing. Made in code from the tip shapes in
// tips.ts plus the engine parameters (colour dynamics, wet mix, build-up modes, speed, wiggle).
// Ids start with "an-" and stay stable: saved movies and brush slots resolve them by id.

import type { Brush, TipShape } from './types';

// Kept local so this file does not import brushes.ts, which imports it.
function makePresets(opacity = 1): Brush['presets'] {
  return [
    { size: 0.1, opacity },
    { size: 0.3, opacity },
    { size: 0.55, opacity },
    { size: 0.9, opacity: Math.max(0.35, opacity * 0.6) },
  ];
}

const BASE: Omit<Brush, 'id' | 'name' | 'set' | 'presets'> = {
  tip: 'round', softness: 0, maxSize: 30, minSize: 1, spacing: 0.1, flow: 1,
  pressureSize: [1, 1], pressureFlow: [1, 1], tilt: 0, scatter: 0, rotationJitter: 0,
  followStroke: false, roundness: 1, grain: 0, smoothing: 0.25, pickup: 0.5,
};

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A row maker for one set: tip, softness, max, min, spacing, flow, size at light touch, flow at light touch, extras, opacity. */
function set(name: string) {
  return (n: string, tip: TipShape, soft: number, max: number, min: number, sp: number, flow: number, ps0: number, pf0: number, extra: Partial<Brush> = {}, opacity = 1): Brush => ({
    ...BASE, tip, softness: soft, maxSize: max, minSize: min, spacing: sp, flow,
    pressureSize: [ps0, 1], pressureFlow: [pf0, 1], ...extra,
    id: `an-${slug(name)}-${slug(n)}`, name: n, set: name, lib: 'animation', presets: makePresets(opacity),
  });
}

const SKETCH = set('Sketch');
const OUTLINE = set('Outline');
const MONO = set('Monoline');
const WIGGLE = set('Wiggle');
const SCRIPT = set('Script');
const CHALK = set('Chalk');
const INK = set('Ink');
const PAINT = set('Paint');
const BRISTLE = set('Bristle');
const WASH_ROW = set('Wash');
// Uniform build-up caps coverage at the strongest dab, so washes need twice the flow to read as paint.
const WASH: typeof WASH_ROW = (n, tip, soft, max, min, sp, flow, ps0, pf0, extra, op) => WASH_ROW(n, tip, soft, max, min, sp, Math.min(1, flow * 2.2), ps0, pf0, extra, op);
const SPONGE = set('Sponge');
const GRAPHIC = set('Graphic');
const AIR = set('Airbrush');
const NOISE = set('Noise');
const TEXTURE = set('Texture');
const PATTERN = set('Pattern');
const ENV = set('Environment');
const METRO = set('Metro');

const Q = Math.PI / 4;

export const ANIMATION_SETS: string[] = ['Sketch', 'Outline', 'Monoline', 'Wiggle', 'Script', 'Chalk', 'Ink', 'Paint', 'Bristle', 'Wash', 'Sponge', 'Graphic', 'Airbrush', 'Noise', 'Texture', 'Pattern', 'Environment', 'Metro'];

export const ANIMATION_BRUSHES: Brush[] = [
  // Sketch: rough construction lines
  SKETCH('Lead stub', 'grain-round', 0.2, 12, 1.5, 0.06, 0.65, 0.55, 0.25, { tilt: 0.8, grain: 0.7, smoothing: 0.1 }, 0.9),
  SKETCH('Soft lead', 'grain-round', 0.55, 28, 3, 0.05, 0.3, 0.5, 0.15, { tilt: 1, grain: 0.65, smoothing: 0.1 }, 0.85),
  SKETCH('Scribble', 'grain-round', 0.15, 14, 2, 0.08, 0.6, 0.6, 0.3, { scatter: 0.12, grain: 0.6, jitterOpacity: 0.4, smoothing: 0.05 }, 0.9),
  SKETCH('Blue lead', 'grain-round', 0.15, 10, 1.5, 0.06, 0.55, 0.55, 0.25, { grain: 0.55, colorDyn: { strokeBri: 0.12 }, smoothing: 0.1 }, 0.8),
  SKETCH('Rough hatch', 'hatch', 0.1, 26, 6, 0.12, 0.6, 0.7, 0.4, { followStroke: true, roundness: 0.55, grain: 0.5, jitterOpacity: 0.3 }),
  SKETCH('Side shade', 'grain-round', 0.4, 30, 8, 0.05, 0.22, 0.5, 0.1, { tilt: 1, roundness: 0.5, grain: 0.85, azimuth: true, smoothing: 0.1 }, 0.8),
  SKETCH('Sepia pencil', 'grain-round', 0.2, 12, 1.5, 0.06, 0.6, 0.6, 0.25, { grain: 0.7, grainScale: 0.8, colorDyn: { strokeSat: 0.08, strokeBri: 0.1 }, tilt: 0.7 }, 0.9),
  SKETCH('Ghost line', 'round', 0.3, 12, 1, 0.05, 0.5, 0.6, 0.3, { burnout: 0.8, fallOff: 0.3, grain: 0.3, smoothing: 0.2 }, 0.8),
  SKETCH('Napkin pen', 'round', 0.18, 8, 1.2, 0.05, 0.85, 0.7, 0.6, { speedSize: -0.5, grain: 0.15, smoothing: 0.3 }),
  SKETCH('Cross-hatcher', 'comb', 0.05, 22, 5, 0.18, 0.7, 0.7, 0.5, { followStroke: true, grain: 0.3, rotationJitter: 0.05 }),

  // Outline: clean contour work for inking over roughs
  OUTLINE('Clean outline', 'round', 0.02, 10, 1.5, 0.04, 1, 0.5, 1, { smoothing: 0.5, stabilization: 35, taper: 0.35 }),
  OUTLINE('Heavy outline', 'round', 0.02, 22, 3, 0.04, 1, 0.45, 1, { smoothing: 0.5, stabilization: 40, taper: 0.25 }),
  OUTLINE('Tapered line', 'round', 0.02, 14, 1, 0.04, 1, 0.1, 1, { smoothing: 0.5, taper: 0.9, taperEnd: 0.9, stabilization: 40 }),
  OUTLINE('Brush outline', 'round', 0.06, 26, 2, 0.04, 1, 0.12, 0.9, { smoothing: 0.55, taper: 0.5, pressureGamma: 1.3, stabilization: 45 }),
  OUTLINE('Swell line', 'round', 0.02, 24, 2, 0.04, 1, 0.08, 1, { smoothing: 0.5, speedSize: -0.6, taper: 0.4, stabilization: 40 }),
  OUTLINE('Contour pen', 'round', 0.04, 12, 2, 0.04, 1, 0.3, 1, { smoothing: 0.6, stabilization: 60, taper: 0.2 }),
  OUTLINE('Fine liner', 'round', 0, 5, 0.8, 0.04, 1, 0.7, 1, { smoothing: 0.5, stabilization: 40 }),
  OUTLINE('Marker outline', 'round', 0.04, 20, 4, 0.04, 0.95, 0.8, 0.9, { smoothing: 0.4, grain: 0.1 }, 0.9),
  OUTLINE('Dry-edge outline', 'round', 0.05, 16, 2, 0.04, 1, 0.3, 0.9, { grain: 0.8, grainScale: 0.6, smoothing: 0.45, taper: 0.3, stabilization: 30 }),
  OUTLINE('Inner line', 'round', 0.1, 7, 1, 0.04, 0.9, 0.3, 0.6, { taper: 0.8, taperEnd: 0.8, smoothing: 0.5, stabilization: 40 }, 0.9),

  // Monoline: one weight, no pressure change
  MONO('Mono fine', 'round', 0, 5, 1, 0.03, 1, 1, 1, { smoothing: 0.45, stabilization: 35 }),
  MONO('Mono medium', 'round', 0, 11, 2, 0.03, 1, 1, 1, { smoothing: 0.45, stabilization: 35 }),
  MONO('Mono bold', 'round', 0, 26, 5, 0.03, 1, 1, 1, { smoothing: 0.45, stabilization: 35 }),
  MONO('Mono soft', 'round', 0.7, 18, 3, 0.04, 1, 1, 1, { smoothing: 0.4, stabilization: 30 }),
  MONO('Round cap', 'round', 0, 16, 3, 0.02, 1, 1, 1, { smoothing: 0.5, stabilization: 50 }),
  MONO('Square cap', 'square', 0, 14, 3, 0.03, 1, 1, 1, { smoothing: 0.4, stabilization: 40 }),
  MONO('Dashes', 'chisel', 0, 14, 3, 1.5, 1, 1, 1, { followStroke: true, roundness: 0.35, smoothing: 0.4 }),
  MONO('Dots', 'round', 0, 12, 3, 1.7, 1, 1, 1, { smoothing: 0.4 }),
  MONO('Twin line', 'ring', 0, 18, 6, 0.05, 1, 1, 1, { smoothing: 0.4, stabilization: 30 }),
  MONO('Neon line', 'round', 0.55, 16, 4, 0.04, 0.9, 1, 1, { smoothing: 0.4, bump: 0 }, 0.9),

  // Wiggle: lines that boil and wander
  WIGGLE('Boil fine', 'round', 0.05, 6, 1.2, 0.05, 1, 0.6, 1, { wiggle: 0.5, smoothing: 0.3 }),
  WIGGLE('Boil bold', 'round', 0.05, 18, 3, 0.05, 1, 0.6, 1, { wiggle: 0.55, smoothing: 0.3 }),
  WIGGLE('Shaky pencil', 'grain-round', 0.2, 12, 1.5, 0.06, 0.7, 0.6, 0.3, { wiggle: 0.4, grain: 0.7, tilt: 0.6 }, 0.9),
  WIGGLE('Jitter ink', 'round', 0.03, 12, 1.5, 0.05, 1, 0.3, 1, { wiggle: 0.3, scatter: 0.06, jitterSize: 0.35 }),
  WIGGLE('Wobble marker', 'round', 0.08, 26, 6, 0.05, 0.9, 0.8, 0.8, { wiggle: 0.6, smoothing: 0.3 }, 0.85),
  WIGGLE('Squiggle', 'round', 0.03, 10, 2, 0.05, 1, 0.7, 1, { wiggle: 1, smoothing: 0.3 }),
  WIGGLE('Trembling chalk', 'chalk', 0.05, 30, 6, 0.08, 0.9, 0.7, 0.5, { wiggle: 0.5, grain: 0.7, rotationJitter: 1 }),
  WIGGLE('Nervous line', 'round', 0.02, 8, 1, 0.04, 1, 0.5, 1, { wiggle: 0.8, speedSize: -0.4, taper: 0.3 }),
  WIGGLE('Wave', 'round', 0.04, 14, 2, 0.05, 1, 0.8, 1, { wiggle: 0.9, smoothing: 0.6 }),
  WIGGLE('Jelly', 'round', 0.3, 30, 6, 0.05, 0.95, 0.8, 0.9, { wiggle: 0.7, colorDyn: { strokeHue: 0.2 } }, 0.9),

  // Script: pens with a nib
  SCRIPT('Copperplate', 'chisel', 0.04, 14, 2, 0.04, 1, 0.15, 1, { roundness: 0.28, baseRot: 0.5, smoothing: 0.5, stabilization: 45 }),
  SCRIPT('Brush script', 'round', 0.05, 26, 2, 0.04, 1, 0.1, 1, { taper: 0.7, taperEnd: 0.8, smoothing: 0.55, pressureGamma: 1.2, stabilization: 50 }),
  SCRIPT('Italic nib', 'chisel', 0.03, 18, 3, 0.04, 1, 0.8, 1, { roundness: 0.22, baseRot: 0.7, smoothing: 0.4 }),
  SCRIPT('Pointed pen', 'round', 0.02, 12, 1, 0.04, 1, 0.12, 1, { speedSize: -0.5, taper: 0.5, smoothing: 0.5, stabilization: 40 }),
  SCRIPT('Signature', 'round', 0.03, 9, 1, 0.04, 1, 0.2, 1, { taper: 0.8, taperEnd: 1, smoothing: 0.6, stabilization: 60 }),
  SCRIPT('Dry script', 'round', 0.08, 20, 3, 0.04, 1, 0.2, 0.9, { grain: 0.85, grainScale: 0.6, taper: 0.5, smoothing: 0.5 }),
  SCRIPT('Felt script', 'round', 0.1, 16, 3, 0.04, 0.9, 0.5, 0.8, { taper: 0.3, smoothing: 0.5, speedSize: -0.3 }, 0.9),
  SCRIPT('Uncial', 'chisel', 0.03, 24, 6, 0.04, 1, 0.9, 1, { roundness: 0.4, baseRot: 0.3, smoothing: 0.4 }),
  SCRIPT('Hand letter', 'round', 0.04, 18, 3, 0.04, 1, 0.5, 1, { smoothing: 0.5, wiggle: 0.12, stabilization: 40 }),
  SCRIPT('Quill', 'blade', 0.04, 14, 2, 0.04, 1, 0.3, 1, { followStroke: true, roundness: 0.3, smoothing: 0.45, speedSize: -0.3 }),

  // Chalk
  CHALK('Stick chalk', 'chalk', 0.05, 38, 8, 0.07, 0.9, 0.75, 0.5, { grain: 0.8, rotationJitter: 1, tilt: 0.7 }),
  CHALK('Soft pastel', 'chalk', 0.3, 50, 12, 0.06, 0.55, 0.6, 0.3, { grain: 0.75, grainScale: 1.3, tilt: 1, bump: 0.2, rotationJitter: 1 }, 0.9),
  CHALK('Blackboard', 'chalk', 0.08, 30, 6, 0.06, 0.95, 0.8, 0.5, { grain: 0.9, grainScale: 0.9, jitterOpacity: 0.25, rotationJitter: 1 }),
  CHALK('Pavement', 'grunge', 0.1, 54, 12, 0.07, 0.8, 0.8, 0.5, { grain: 1, grainScale: 1.6, rotationJitter: 1, tilt: 0.5 }),
  CHALK('Pastel side', 'chalk', 0.2, 60, 18, 0.06, 0.5, 0.5, 0.2, { roundness: 0.35, grain: 0.9, tilt: 1, azimuth: true }, 0.85),
  CHALK('Dust chalk', 'speckle', 0.2, 44, 10, 0.1, 0.6, 0.7, 0.3, { grain: 0.6, scatter: 0.2, rotationJitter: 1 }, 0.9),
  CHALK('Crumbly', 'grunge', 0.1, 36, 8, 0.1, 0.85, 0.7, 0.4, { grain: 0.95, jitterSize: 0.4, rotationJitter: 1, grainJitter: 0.5 }),
  CHALK('Oil pastel', 'chalk', 0.03, 40, 8, 0.05, 1, 0.7, 0.7, { grain: 0.5, roundness: 0.8, rotationJitter: 1, render: 'uniform-glaze', colorDyn: { stampBri: 0.08 } }),
  CHALK('Conte', 'grain-round', 0.12, 26, 5, 0.05, 0.75, 0.6, 0.3, { grain: 0.85, grainMode: 'moving', tilt: 0.8, bump: 0.15 }, 0.9),
  CHALK('Sidewalk', 'chalk', 0.1, 64, 16, 0.08, 0.9, 0.8, 0.6, { grain: 1, grainScale: 2, rotationJitter: 1, grainMode: 'moving' }),

  // Ink
  INK('Dip pen', 'round', 0.02, 12, 1.5, 0.04, 1, 0.1, 1, { smoothing: 0.5, taper: 0.4, speedSize: -0.35, stabilization: 40 }),
  INK('Fountain', 'round', 0.03, 14, 2, 0.04, 1, 0.3, 1, { smoothing: 0.5, taper: 0.2, wetEdges: 0.3 }),
  INK('Reed ink', 'chisel', 0.04, 26, 4, 0.04, 1, 0.5, 1, { roundness: 0.35, baseRot: 0.6, grain: 0.3, smoothing: 0.4 }),
  INK('Splatter ink', 'splat', 0.1, 40, 6, 0.4, 1, 0.5, 0.8, { shapeCount: 5, scatter: 0.9, jitterSize: 0.7, rotationJitter: 1 }),
  INK('Pooled ink', 'round', 0.03, 20, 3, 0.04, 0.85, 0.4, 0.8, { wetEdges: 1, render: 'uniform-glaze', smoothing: 0.5 }, 0.95),
  INK('Brush ink', 'round', 0.06, 30, 3, 0.04, 1, 0.1, 0.9, { taper: 0.6, smoothing: 0.55, grain: 0.15, pressureGamma: 1.3 }),
  INK('Sumi', 'bristle', 0.05, 36, 5, 0.05, 0.9, 0.2, 0.8, { grain: 0.4, taper: 0.4, wetEdges: 0.5, smoothing: 0.55, pressureGamma: 1.2 }),
  INK('Stipple ink', 'dots', 0.05, 22, 5, 0.25, 1, 0.6, 0.8, { scatter: 0.6, shapeCount: 3, jitterSize: 0.5, rotationJitter: 1 }),
  INK('Rollerball', 'round', 0.05, 7, 1, 0.04, 0.95, 0.9, 0.7, { smoothing: 0.4, wetEdges: 0.2, burnout: 0.2 }),
  INK('Ink wash line', 'round', 0.3, 24, 4, 0.04, 0.55, 0.4, 0.4, { render: 'light-glaze', wetEdges: 0.6, wet: { dilution: 0.5, charge: 0.8, attack: 0.2, pull: 0.3, grade: 0.6 } }, 0.8),

  // Paint
  PAINT('Flat paint', 'chisel', 0.04, 48, 8, 0.05, 1, 0.8, 0.8, { roundness: 0.35, baseRot: 0.8, grain: 0.2, render: 'uniform-glaze' }),
  PAINT('Round paint', 'round', 0.06, 42, 6, 0.05, 1, 0.5, 0.8, { grain: 0.2, wet: { dilution: 0.1, charge: 0.7, attack: 0.3, pull: 0.5, grade: 0.5 } }),
  PAINT('Impasto', 'bristle', 0.04, 52, 10, 0.05, 1, 0.7, 0.9, { grain: 0.6, bump: 0.7, grainScale: 0.8, render: 'heavy-glaze', followStroke: true, roundness: 0.7 }),
  PAINT('Gouache', 'round', 0.03, 40, 6, 0.05, 1, 0.7, 0.9, { grain: 0.15, render: 'uniform-glaze', colorDyn: { strokeBri: 0.06 } }),
  PAINT('Acrylic', 'round', 0.05, 38, 5, 0.05, 0.9, 0.6, 0.8, { grain: 0.3, render: 'intense-glaze', wetEdges: 0.2 }),
  PAINT('Oil blend', 'bristle', 0.06, 46, 8, 0.05, 1, 0.7, 0.9, { grain: 0.3, render: 'intense-blending', roundness: 0.8, followStroke: true }),
  PAINT('Knife', 'blade', 0.03, 48, 12, 0.05, 1, 0.8, 1, { followStroke: true, roundness: 0.3, render: 'uniform-blending', bump: 0.3, grain: 0.3 }),
  PAINT('Dab', 'blob', 0.1, 40, 8, 0.7, 1, 0.8, 0.9, { rotationJitter: 1, scatter: 0.1, jitterSize: 0.3, colorDyn: { stampBri: 0.15, stampHue: 0.04 } }),
  PAINT('Glaze', 'round', 0.3, 56, 12, 0.05, 0.5, 0.6, 0.3, { render: 'light-glaze', wet: { dilution: 0.5, charge: 0.9, attack: 0.1, pull: 0.2, grade: 0.7 } }, 0.7),
  PAINT('Mixed color', 'bristle', 0.06, 44, 8, 0.07, 0.9, 0.7, 0.8, { grain: 0.4, colorDyn: { stampHue: 0.1, stampSat: 0.15, stampBri: 0.2, strokeHue: 0.1, pressureBri: 0.4 }, render: 'intense-glaze' }),

  // Bristle
  BRISTLE('Fan', 'bristle', 0.04, 54, 12, 0.05, 0.8, 0.8, 0.6, { followStroke: true, roundness: 0.8, grain: 0.4, rotationJitter: 0.02 }),
  BRISTLE('Hog hair', 'bristle', 0.05, 46, 8, 0.05, 0.95, 0.7, 0.8, { followStroke: true, roundness: 0.7, grain: 0.5, bump: 0.3 }),
  BRISTLE('Dry brush', 'bristle', 0.04, 50, 10, 0.06, 0.75, 0.5, 0.4, { followStroke: true, roundness: 0.75, grain: 0.95, grainScale: 0.7, burnout: 0.5 }, 0.9),
  BRISTLE('Streaky', 'comb', 0.04, 48, 10, 0.04, 0.9, 0.7, 0.7, { followStroke: true, roundness: 0.8, grain: 0.3, jitterOpacity: 0.3 }),
  BRISTLE('Flat bristle', 'bristle', 0.03, 54, 12, 0.05, 1, 0.8, 0.8, { roundness: 0.35, baseRot: 0.6, grain: 0.4, render: 'uniform-glaze' }),
  BRISTLE('Rigger', 'bristle', 0.03, 14, 2, 0.04, 1, 0.2, 0.9, { followStroke: true, roundness: 0.7, taper: 0.6, taperEnd: 0.8, smoothing: 0.5 }),
  BRISTLE('Stiff', 'comb', 0.03, 42, 8, 0.05, 1, 0.9, 0.9, { followStroke: true, roundness: 0.9, grain: 0.3 }),
  BRISTLE('Splay', 'bristle', 0.05, 52, 12, 0.05, 0.7, 0.7, 0.4, { followStroke: true, roundness: 0.9, speedOpacity: -0.5, grain: 0.6, wiggle: 0.12 }),
  BRISTLE('Toothbrush', 'speckle', 0.1, 40, 8, 0.4, 0.9, 0.8, 0.7, { shapeCount: 6, scatter: 0.8, jitterSize: 0.6, rotationJitter: 1 }),
  BRISTLE('Worn comb', 'comb', 0.04, 38, 8, 0.05, 0.85, 0.7, 0.5, { followStroke: true, grain: 0.7, burnout: 0.3, jitterOpacity: 0.3 }),

  // Wash
  WASH('Watercolor', 'round', 0.45, 56, 12, 0.05, 0.4, 0.6, 0.3, { render: 'uniform-glaze', wetEdges: 0.8, grain: 0.3, grainScale: 1.4 }, 0.7),
  WASH('Light wash', 'round', 0.6, 64, 16, 0.05, 0.3, 0.6, 0.2, { render: 'light-glaze', grain: 0.2 }, 0.6),
  WASH('Bleed', 'round', 0.5, 50, 10, 0.05, 0.45, 0.6, 0.3, { render: 'uniform-blending', wetEdges: 0.4, wet: { dilution: 0.4, charge: 0.6, attack: 0.5, pull: 0.8, grade: 0.4 } }, 0.7),
  WASH('Granulate', 'grain-round', 0.4, 52, 12, 0.05, 0.4, 0.6, 0.3, { render: 'uniform-glaze', grain: 1, grainScale: 0.7, grainMode: 'moving', wetEdges: 0.5 }, 0.7),
  WASH('Sky wash', 'round', 0.8, 90, 30, 0.06, 0.25, 0.6, 0.2, { render: 'light-glaze', colorDyn: { strokeHue: 0.04, strokeBri: 0.08 }, wet: { dilution: 0.6, charge: 0.9, attack: 0.1, pull: 0.3, grade: 0.8 } }, 0.55),
  WASH('Tide', 'blob', 0.5, 60, 14, 0.07, 0.35, 0.5, 0.2, { render: 'uniform-glaze', wetEdges: 1, rotationJitter: 1, jitterSize: 0.2 }, 0.65),
  WASH('Ink stain', 'round', 0.35, 34, 6, 0.05, 0.5, 0.5, 0.3, { render: 'uniform-glaze', wetEdges: 0.9, burnout: 0.4 }, 0.8),
  WASH('Soft stain', 'blob', 0.7, 70, 20, 0.08, 0.3, 0.6, 0.2, { render: 'light-glaze', grain: 0.4 }, 0.6),
  WASH('Dilute', 'round', 0.5, 44, 8, 0.05, 0.5, 0.6, 0.3, { wet: { dilution: 0.9, charge: 0.3, attack: 0.5, pull: 0.7, grade: 0.5 }, render: 'uniform-blending' }, 0.75),
  WASH('Salt wash', 'round', 0.45, 56, 12, 0.05, 0.4, 0.6, 0.3, { render: 'uniform-glaze', wetEdges: 0.6, grain: 1, grainScale: 0.4, bump: 0.2 }, 0.65),

  // Sponge
  SPONGE('Natural', 'sponge', 0.1, 50, 12, 0.18, 0.8, 0.8, 0.6, { rotationJitter: 1, scatter: 0.1, grain: 0.4 }),
  SPONGE('Sea sponge', 'sponge', 0.1, 64, 18, 0.25, 0.85, 0.8, 0.6, { rotationJitter: 1, scatter: 0.15, jitterSize: 0.3, bump: 0.3 }),
  SPONGE('Foam', 'sponge', 0.3, 56, 14, 0.2, 0.55, 0.7, 0.4, { rotationJitter: 1, render: 'light-glaze', grain: 0.2 }, 0.8),
  SPONGE('Stipple', 'sponge', 0.05, 34, 8, 0.2, 0.9, 0.8, 0.6, { rotationJitter: 1, scatter: 0.3, shapeCount: 3 }),
  SPONGE('Lichen', 'sponge', 0.1, 48, 12, 0.3, 0.75, 0.7, 0.5, { rotationJitter: 1, scatter: 0.3, colorDyn: { stampHue: 0.08, stampBri: 0.2 } }),
  SPONGE('Porous', 'speckle', 0.2, 46, 10, 0.2, 0.8, 0.8, 0.5, { rotationJitter: 1, scatter: 0.12, grain: 0.5 }),
  SPONGE('Coral', 'sponge', 0.05, 54, 12, 0.35, 1, 0.8, 0.8, { rotationJitter: 1, jitterSize: 0.4, colorDyn: { stampHue: 0.05, stampSat: 0.15 } }),
  SPONGE('Mop', 'sponge', 0.4, 70, 18, 0.15, 0.4, 0.6, 0.3, { rotationJitter: 1, render: 'uniform-glaze', grain: 0.4 }, 0.7),
  SPONGE('Dab sponge', 'blob', 0.1, 44, 10, 0.5, 0.9, 0.8, 0.6, { rotationJitter: 1, scatter: 0.2, grain: 0.5, jitterOpacity: 0.3 }),
  SPONGE('Rough pad', 'grunge', 0.1, 60, 16, 0.2, 0.8, 0.8, 0.5, { rotationJitter: 1, grain: 0.8, grainMode: 'moving', bump: 0.2 }),

  // Graphic: stamps and flat shapes
  GRAPHIC('Square stamp', 'square', 0, 40, 6, 0.9, 1, 1, 1, { followStroke: true }),
  GRAPHIC('Star stamp', 'star', 0, 40, 8, 0.9, 1, 1, 1, { rotationJitter: 0.2 }),
  GRAPHIC('Cross stamp', 'cross', 0, 36, 8, 0.9, 1, 1, 1, { followStroke: true }),
  GRAPHIC('Ring stamp', 'ring', 0, 38, 8, 0.9, 1, 1, 1, {}),
  GRAPHIC('Leaf stamp', 'leaf', 0, 42, 8, 0.8, 1, 0.9, 1, { followStroke: true, jitterSize: 0.3 }),
  GRAPHIC('Flat shape', 'round', 0, 60, 8, 0.03, 1, 1, 1, { render: 'uniform-glaze', smoothing: 0.5 }),
  GRAPHIC('Cut paper', 'square', 0, 54, 10, 0.4, 1, 1, 1, { rotationJitter: 0.1, scatter: 0.05, colorDyn: { stampBri: 0.1 } }),
  GRAPHIC('Sticker', 'ring', 0.1, 46, 10, 0.8, 1, 0.9, 1, { rotationJitter: 1, colorDyn: { stampHue: 0.5, stampSat: 0.1 } }),
  GRAPHIC('Halftone', 'dots', 0, 36, 8, 0.35, 1, 0.8, 0.8, { rotationJitter: 0, grain: 0 }),
  GRAPHIC('Confetti', 'star', 0, 34, 8, 0.8, 1, 0.9, 1, { shapeCount: 6, scatter: 0.7, rotationJitter: 1, jitterSize: 0.5, colorDyn: { stampHue: 1, stampSat: 0.2, stampBri: 0.2 } }),

  // Airbrush
  AIR('Soft airbrush', 'round', 1, 90, 12, 0.06, 0.25, 0.6, 0.15, { smoothing: 0.35 }, 0.9),
  AIR('Medium airbrush', 'round', 0.7, 70, 10, 0.06, 0.3, 0.6, 0.15, { smoothing: 0.35 }, 0.9),
  AIR('Hard airbrush', 'round', 0.35, 56, 8, 0.05, 0.35, 0.6, 0.2, { smoothing: 0.3 }, 0.95),
  AIR('Round soft', 'round', 0.9, 120, 20, 0.07, 0.2, 0.7, 0.1, { smoothing: 0.35 }, 0.8),
  AIR('Spray fine', 'speckle', 0.2, 60, 10, 0.12, 0.6, 0.8, 0.4, { scatter: 0.5, shapeCount: 4, grain: 0.3, rotationJitter: 1 }),
  AIR('Mist', 'round', 0.95, 100, 24, 0.08, 0.15, 0.7, 0.1, { grain: 0.4, grainScale: 1.5 }, 0.8),
  AIR('Tint', 'round', 0.85, 80, 12, 0.07, 0.25, 0.6, 0.15, { colorDyn: { stampHue: 0.08, stampBri: 0.1, pressureSat: 0.3 } }, 0.9),
  AIR('Glow', 'round', 1, 110, 20, 0.07, 0.2, 0.7, 0.1, { render: 'light-glaze', speedOpacity: -0.4 }, 0.9),
  AIR('Fade tip', 'round', 0.8, 70, 10, 0.06, 0.45, 0.6, 0.2, { burnout: 0.7, fallOff: 0.5 }, 0.9),
  AIR('Spatter mist', 'dots', 0.4, 70, 10, 0.2, 0.5, 0.8, 0.3, { scatter: 0.8, shapeCount: 6, jitterSize: 0.7 }),

  // Noise
  NOISE('Grain', 'speckle', 0.1, 46, 8, 0.1, 0.7, 0.8, 0.5, { scatter: 0.3, rotationJitter: 1, grain: 0.5 }),
  NOISE('Static', 'pixel', 0, 40, 6, 0.2, 1, 1, 1, { scatter: 0.4, shapeCount: 5, jitterOpacity: 0.7, jitterSize: 0.6 }),
  NOISE('Film grain', 'speckle', 0.1, 58, 12, 0.08, 0.5, 0.8, 0.3, { scatter: 0.4, grain: 0.8, grainMode: 'moving', rotationJitter: 1 }, 0.8),
  NOISE('Fine noise', 'dots', 0.05, 32, 6, 0.1, 0.7, 0.8, 0.5, { scatter: 0.5, shapeCount: 3, jitterSize: 0.5 }),
  NOISE('Sand', 'speckle', 0.05, 44, 8, 0.1, 0.85, 0.8, 0.5, { scatter: 0.4, shapeCount: 4, colorDyn: { stampBri: 0.25 } }),
  NOISE('Dust', 'speckle', 0.3, 60, 12, 0.12, 0.35, 0.7, 0.3, { scatter: 0.7, shapeCount: 5, jitterOpacity: 0.6 }, 0.8),
  NOISE('Fibres', 'fibre', 0.05, 40, 8, 0.2, 0.8, 0.8, 0.5, { rotationJitter: 1, scatter: 0.3, jitterSize: 0.4 }),
  NOISE('Pixel noise', 'pixel', 0, 36, 6, 0.3, 1, 1, 1, { shapeCount: 6, scatter: 0.7, colorDyn: { stampBri: 0.5 } }),
  NOISE('Rough', 'grunge', 0.1, 50, 10, 0.1, 0.8, 0.8, 0.6, { grain: 1, grainScale: 0.5, rotationJitter: 1, bump: 0.2 }),
  NOISE('Cloud noise', 'blob', 0.8, 70, 16, 0.12, 0.25, 0.7, 0.2, { grain: 0.8, grainScale: 1.6, scatter: 0.3, jitterOpacity: 0.5 }, 0.8),

  // Texture: surfaces and materials
  TEXTURE('Paper tooth', 'round', 0.15, 44, 8, 0.05, 0.8, 0.8, 0.5, { grain: 1, grainScale: 0.7, bump: 0.15 }, 0.9),
  TEXTURE('Canvas', 'round', 0.1, 50, 10, 0.05, 0.85, 0.8, 0.6, { grain: 1, grainScale: 1.1, bump: 0.4 }),
  TEXTURE('Concrete', 'grunge', 0.1, 56, 12, 0.07, 0.9, 0.8, 0.6, { grain: 1, grainScale: 1.8, bump: 0.5, rotationJitter: 1 }),
  TEXTURE('Bark', 'comb', 0.05, 50, 10, 0.06, 0.9, 0.8, 0.6, { followStroke: true, grain: 0.9, grainScale: 1.4, bump: 0.5, roundness: 0.8 }),
  TEXTURE('Linen', 'square', 0.05, 46, 10, 0.06, 0.8, 0.8, 0.6, { grain: 1, grainScale: 0.6, bump: 0.35, roundness: 0.9 }),
  TEXTURE('Rust', 'grunge', 0.1, 54, 12, 0.08, 0.85, 0.8, 0.5, { grain: 1, grainScale: 1.2, colorDyn: { stampBri: 0.3, stampHue: 0.04, stampSat: 0.2 }, bump: 0.3, rotationJitter: 1 }),
  TEXTURE('Plaster', 'blob', 0.15, 60, 14, 0.1, 0.9, 0.8, 0.6, { grain: 0.8, grainScale: 2, bump: 0.6, rotationJitter: 1 }),
  TEXTURE('Stone', 'grunge', 0.05, 52, 12, 0.07, 1, 0.8, 0.8, { grain: 1, grainScale: 1.4, bump: 0.7, rotationJitter: 1, colorDyn: { stampBri: 0.12 } }),
  TEXTURE('Burlap', 'cross', 0.05, 44, 10, 0.08, 0.8, 0.8, 0.6, { grain: 0.9, grainScale: 0.8, bump: 0.5, roundness: 0.9 }),
  TEXTURE('Weathered', 'grunge', 0.15, 58, 12, 0.07, 0.7, 0.8, 0.5, { grain: 1, grainScale: 1.5, burnout: 0.3, jitterOpacity: 0.4, bump: 0.2, rotationJitter: 1 }, 0.9),

  // Pattern: repeated motifs along the stroke
  PATTERN('Dot row', 'dots', 0, 30, 8, 0.9, 1, 1, 1, { followStroke: true }),
  PATTERN('Cross row', 'cross', 0, 28, 8, 0.9, 1, 1, 1, { followStroke: true }),
  PATTERN('Hatch row', 'hatch', 0, 34, 10, 0.5, 1, 0.9, 1, { followStroke: true }),
  PATTERN('Star row', 'star', 0, 30, 8, 0.95, 1, 1, 1, { followStroke: true, baseRot: 0.3 }),
  PATTERN('Ring row', 'ring', 0, 30, 8, 0.8, 1, 1, 1, { followStroke: true }),
  PATTERN('Leaf row', 'leaf', 0, 34, 8, 0.7, 1, 0.9, 1, { followStroke: true, jitterSize: 0.2 }),
  PATTERN('Pixel row', 'pixel', 0, 28, 8, 1, 1, 1, 1, { followStroke: true }),
  PATTERN('Comb row', 'comb', 0, 34, 10, 0.5, 1, 0.9, 1, { followStroke: true }),
  PATTERN('Rain of dots', 'dots', 0, 36, 8, 0.4, 1, 0.9, 1, { shapeCount: 4, scatter: 0.9, jitterSize: 0.6 }),
  PATTERN('Colour row', 'square', 0, 28, 8, 1, 1, 1, 1, { followStroke: true, colorDyn: { stampHue: 1, stampSat: 0.1 } }),

  // Environment
  ENV('Grass', 'blade', 0.05, 46, 12, 0.35, 1, 0.8, 1, { shapeCount: 5, scatter: 0.5, rotationJitter: 0.15, jitterSize: 0.5, colorDyn: { stampBri: 0.2, stampHue: 0.04 } }),
  ENV('Leaves', 'leaf', 0.05, 40, 10, 0.6, 1, 0.8, 1, { shapeCount: 3, scatter: 0.8, rotationJitter: 1, jitterSize: 0.4, colorDyn: { stampHue: 0.06, stampBri: 0.25 } }),
  ENV('Rain', 'hatch', 0, 36, 8, 0.7, 0.7, 0.9, 0.8, { shapeCount: 6, scatter: 0.9, baseRot: 0.4, roundness: 0.2, jitterOpacity: 0.5 }, 0.8),
  ENV('Stars', 'star', 0.05, 26, 5, 0.9, 1, 0.8, 1, { shapeCount: 4, scatter: 1, rotationJitter: 1, jitterSize: 0.8, jitterOpacity: 0.5 }),
  ENV('Snow', 'dots', 0.4, 34, 6, 0.5, 0.95, 0.8, 0.8, { shapeCount: 6, scatter: 1, jitterSize: 0.8 }),
  ENV('Cloud', 'blob', 0.7, 90, 24, 0.12, 0.45, 0.7, 0.25, { rotationJitter: 1, scatter: 0.2, jitterSize: 0.3 }, 0.85),
  ENV('Foliage', 'leaf', 0.1, 50, 14, 0.5, 0.95, 0.8, 1, { shapeCount: 6, scatter: 0.9, rotationJitter: 1, jitterSize: 0.5, colorDyn: { stampHue: 0.08, stampSat: 0.15, stampBri: 0.3 } }),
  ENV('Pebbles', 'blob', 0.05, 38, 8, 0.8, 1, 0.8, 1, { scatter: 0.4, rotationJitter: 1, jitterSize: 0.5, bump: 0.5, grain: 0.3, colorDyn: { stampBri: 0.3 } }),
  ENV('Sparks', 'speckle', 0.3, 40, 6, 0.4, 0.9, 0.8, 0.8, { shapeCount: 5, scatter: 0.9, jitterSize: 0.8, colorDyn: { stampHue: 0.05, stampBri: 0.3 } }),
  ENV('Haze', 'round', 0.95, 100, 28, 0.08, 0.15, 0.7, 0.1, { grain: 0.5, grainScale: 2, jitterOpacity: 0.4 }, 0.7),

  // Metro: geometric, flat, hard-edged
  METRO('Grid line', 'square', 0, 8, 2, 0.03, 1, 1, 1, { smoothing: 0.5, stabilization: 60 }),
  METRO('Tile', 'square', 0, 40, 8, 1, 1, 1, 1, { followStroke: true, colorDyn: { stampBri: 0.12 } }),
  METRO('Mosaic', 'square', 0, 34, 8, 0.9, 1, 1, 1, { scatter: 0.05, rotationJitter: 0.1, colorDyn: { stampHue: 0.12, stampSat: 0.2, stampBri: 0.25 } }),
  METRO('Block pixel', 'pixel', 0, 30, 6, 1, 1, 1, 1, {}),
  METRO('Diamond', 'square', 0, 34, 8, 0.9, 1, 1, 1, { baseRot: Q }),
  METRO('Stripe', 'chisel', 0, 50, 10, 0.04, 1, 1, 1, { roundness: 0.25, baseRot: Q, render: 'uniform-glaze' }),
  METRO('Bar', 'square', 0, 46, 10, 0.05, 1, 1, 1, { roundness: 0.2, followStroke: true, render: 'uniform-glaze' }),
  METRO('Glass', 'ring', 0, 40, 10, 0.5, 0.7, 1, 1, { followStroke: true }, 0.8),
  METRO('Slab', 'square', 0, 64, 16, 0.05, 1, 1, 1, { roundness: 0.5, baseRot: 0.4, render: 'uniform-glaze' }),
  METRO('Cut line', 'blade', 0, 18, 3, 0.04, 1, 1, 1, { followStroke: true, roundness: 0.2, smoothing: 0.5, stabilization: 50 }),
];
