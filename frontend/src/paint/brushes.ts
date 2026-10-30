// The starter brush library: 18 original brushes in seven sets.

import type { Brush } from './types';

const BASE: Omit<Brush, 'id' | 'name' | 'set' | 'presets'> = {
  tip: 'round',
  softness: 0,
  maxSize: 40,
  minSize: 1,
  spacing: 0.1,
  flow: 1,
  pressureSize: [1, 1],
  pressureFlow: [1, 1],
  tilt: 0,
  scatter: 0,
  rotationJitter: 0,
  followStroke: false,
  roundness: 1,
  grain: 0,
  smoothing: 0.2,
  pickup: 0.5,
};

function mk(id: string, name: string, set: string, over: Partial<Brush>, opacity = 1): Brush {
  return {
    ...BASE,
    ...over,
    id,
    name,
    set,
    presets: [
      { size: 0.1, opacity },
      { size: 0.3, opacity },
      { size: 0.55, opacity: Math.min(1, opacity) },
      { size: 0.9, opacity: Math.max(0.35, opacity * 0.6) },
    ],
  };
}

export const BRUSHES: Brush[] = [
  // Sketch
  mk('pencil-hb', 'Pencil HB', 'Sketch', {
    tip: 'grain-round', softness: 0.15, maxSize: 14, minSize: 1.2, spacing: 0.07, flow: 0.7,
    pressureSize: [0.6, 1], pressureFlow: [0.3, 1], tilt: 0.8, grain: 0.7, smoothing: 0.1, pickup: 0.25,
  }, 0.9),
  mk('soft-pencil', 'Soft pencil', 'Sketch', {
    softness: 0.55, maxSize: 30, minSize: 2, spacing: 0.05, flow: 0.28,
    pressureSize: [0.5, 1], pressureFlow: [0.15, 1], tilt: 1, grain: 0.7, smoothing: 0.1, pickup: 0.35,
  }, 0.85),
  mk('sketch-liner', 'Sketch liner', 'Sketch', {
    softness: 0.06, maxSize: 10, minSize: 1, spacing: 0.05, flow: 1,
    pressureSize: [0.35, 1], pressureFlow: [0.75, 1], grain: 0.18, smoothing: 0.3, pickup: 0.2,
  }),

  // Ink
  mk('studio-ink', 'Studio ink', 'Ink', {
    softness: 0.02, maxSize: 26, minSize: 1, spacing: 0.04, flow: 1,
    pressureSize: [0.12, 1], smoothing: 0.55, pickup: 0.2,
  }),
  mk('brush-pen', 'Brush pen', 'Ink', {
    softness: 0.08, maxSize: 52, minSize: 2, spacing: 0.035, flow: 1,
    pressureSize: [0.04, 1], pressureFlow: [0.85, 1], smoothing: 0.65, pickup: 0.3,
  }),
  mk('fine-liner', 'Fine liner', 'Ink', {
    softness: 0, maxSize: 8, minSize: 0.8, spacing: 0.05, flow: 1,
    pressureSize: [0.85, 1], smoothing: 0.4, pickup: 0.15,
  }),
  mk('dry-ink', 'Dry ink', 'Ink', {
    tip: 'bristle', softness: 0.1, maxSize: 64, minSize: 4, spacing: 0.06, flow: 0.95,
    pressureSize: [0.5, 1], pressureFlow: [0.6, 1], followStroke: true, roundness: 0.85, grain: 0.4,
    smoothing: 0.45, pickup: 0.4,
  }),

  // Paint
  mk('round-paint', 'Round paint', 'Paint', {
    softness: 0.25, maxSize: 96, minSize: 4, spacing: 0.07, flow: 0.9,
    pressureSize: [0.4, 1], pressureFlow: [0.5, 1], smoothing: 0.3, pickup: 0.55,
  }),
  mk('flat-paint', 'Flat paint', 'Paint', {
    tip: 'square', softness: 0.08, maxSize: 84, minSize: 6, spacing: 0.06, flow: 0.95,
    pressureSize: [0.55, 1], pressureFlow: [0.6, 1], followStroke: true, roundness: 0.3, grain: 0.2,
    smoothing: 0.35, pickup: 0.5,
  }),
  mk('gouache', 'Gouache', 'Paint', {
    tip: 'blob', softness: 0.12, maxSize: 76, minSize: 5, spacing: 0.1, flow: 1,
    pressureSize: [0.7, 1], rotationJitter: 1, grain: 0.25, smoothing: 0.35, pickup: 0.45,
  }),

  // Chalk
  mk('chalk', 'Chalk', 'Chalk', {
    tip: 'chalk', softness: 0.2, maxSize: 64, minSize: 6, spacing: 0.1, flow: 0.9,
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], tilt: 0.5, rotationJitter: 1, grain: 0.75, smoothing: 0.15, pickup: 0.3,
  }),
  mk('pastel', 'Pastel', 'Chalk', {
    tip: 'chalk', softness: 0.35, maxSize: 96, minSize: 8, spacing: 0.08, flow: 0.65,
    pressureSize: [0.6, 1], pressureFlow: [0.3, 1], tilt: 1, roundness: 0.7, rotationJitter: 1, scatter: 0.03,
    grain: 0.9, smoothing: 0.15, pickup: 0.4,
  }, 0.9),

  // Airbrush
  mk('soft-airbrush', 'Soft airbrush', 'Airbrush', {
    softness: 1, maxSize: 180, minSize: 8, spacing: 0.05, flow: 0.14,
    pressureSize: [0.7, 1], pressureFlow: [0.3, 1], smoothing: 0.3, pickup: 0.6,
  }, 0.8),
  mk('hard-airbrush', 'Hard airbrush', 'Airbrush', {
    softness: 0.55, maxSize: 130, minSize: 6, spacing: 0.04, flow: 0.22,
    pressureSize: [0.8, 1], pressureFlow: [0.3, 1], smoothing: 0.3, pickup: 0.5,
  }, 0.85),

  // Texture
  mk('speckle', 'Speckle', 'Texture', {
    tip: 'speckle', softness: 0, maxSize: 96, minSize: 10, spacing: 0.3, flow: 1,
    pressureSize: [0.6, 1], scatter: 0.4, rotationJitter: 1, smoothing: 0.1, pickup: 0.3,
  }),
  mk('grain-wash', 'Grain wash', 'Texture', {
    tip: 'grain-round', softness: 0.6, maxSize: 160, minSize: 12, spacing: 0.09, flow: 0.5,
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], rotationJitter: 1, grain: 0.9, smoothing: 0.3, pickup: 0.5,
  }, 0.85),

  // Wash
  mk('watercolor-wash', 'Watercolor wash', 'Wash', {
    tip: 'blob', softness: 0.7, maxSize: 140, minSize: 10, spacing: 0.06, flow: 0.2,
    pressureSize: [0.7, 1], pressureFlow: [0.35, 1], rotationJitter: 1, grain: 0.35, smoothing: 0.5, pickup: 0.4,
  }, 0.75),
  mk('wet-blend', 'Wet blend', 'Wash', {
    softness: 0.8, maxSize: 120, minSize: 8, spacing: 0.05, flow: 0.35,
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], grain: 0.1, smoothing: 0.4, pickup: 0.8,
  }, 0.9),
];

export const BRUSH_SETS: string[] = ['Sketch', 'Ink', 'Paint', 'Chalk', 'Airbrush', 'Texture', 'Wash'];

export const DEFAULT_PAINT = 'studio-ink';
export const DEFAULT_SMUDGE = 'wet-blend';
export const DEFAULT_ERASE = 'round-paint';

const byId = new Map(BRUSHES.map((b) => [b.id, b]));

export function brushById(id: string): Brush | undefined {
  return byId.get(id);
}
