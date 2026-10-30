// The starter brush library: original brushes in nineteen sets, all made in code
// (tip shapes and grain are generated, see tips.ts). `brushById` reads a registry that
// the brush store (ui/brush-store.ts) keeps current with renames, edits and imports.

import type { Brush, TipShape } from './types';
import { ANIMATION_BRUSHES } from './brushes-animation';

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

export function makePresets(opacity = 1): Brush['presets'] {
  return [
    { size: 0.1, opacity },
    { size: 0.3, opacity },
    { size: 0.55, opacity: Math.min(1, opacity) },
    { size: 0.9, opacity: Math.max(0.35, opacity * 0.6) },
  ];
}

function mk(id: string, name: string, set: string, over: Partial<Brush>, opacity = 1): Brush {
  return { ...BASE, ...over, id, name, set, presets: makePresets(opacity) };
}

/** Terse row: tip, softness, max, min, spacing, flow, size at light touch, flow at light touch, extras. */
function d(id: string, name: string, set: string, tip: TipShape, soft: number, max: number, min: number, sp: number, flow: number, ps0: number, pf0: number, extra: Partial<Brush> = {}, opacity = 1): Brush {
  return mk(id, name, set, { tip, softness: soft, maxSize: max, minSize: min, spacing: sp, flow, pressureSize: [ps0, 1], pressureFlow: [pf0, 1], ...extra }, opacity);
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
  d('graphite-2b', 'Graphite 2B', 'Sketch', 'grain-round', 0.3, 22, 2, 0.06, 0.55, 0.55, 0.2, { tilt: 0.9, grain: 0.85, smoothing: 0.12 }, 0.9),
  d('hard-4h', 'Hard 4H', 'Sketch', 'grain-round', 0.05, 8, 1, 0.06, 0.5, 0.8, 0.4, { grain: 0.5, smoothing: 0.15 }, 0.8),
  d('mech-pencil', 'Mechanical', 'Sketch', 'round', 0, 5, 0.8, 0.05, 0.85, 0.9, 0.6, { grain: 0.25, smoothing: 0.25 }),
  d('colored-pencil', 'Color pencil', 'Sketch', 'grain-round', 0.2, 16, 2, 0.05, 0.4, 0.7, 0.2, { tilt: 0.7, grain: 1, grainScale: 0.7, roundness: 0.9 }, 0.9),
  d('hatch-pencil', 'Hatch pencil', 'Sketch', 'hatch', 0.1, 26, 6, 0.12, 0.7, 0.7, 0.4, { followStroke: true, roundness: 0.6, grain: 0.5 }),
  d('carpenter', 'Carpenter', 'Sketch', 'chisel', 0.1, 24, 3, 0.05, 0.6, 0.7, 0.3, { roundness: 0.3, grain: 0.7, tilt: 0.6 }, 0.9),

  // Drawing
  d('tech-pen', 'Technical pen', 'Drawing', 'round', 0, 7, 1, 0.04, 1, 1, 1, { smoothing: 0.45 }),
  d('felt-tip', 'Felt tip', 'Drawing', 'round', 0.08, 18, 3, 0.04, 0.85, 0.85, 0.7, { smoothing: 0.35, grain: 0.1 }, 0.9),
  d('marker', 'Marker', 'Drawing', 'round', 0.05, 34, 6, 0.05, 0.9, 0.9, 0.8, { smoothing: 0.3 }, 0.8),
  d('chisel-marker', 'Chisel marker', 'Drawing', 'chisel', 0.04, 44, 8, 0.05, 0.9, 0.9, 0.8, { roundness: 0.28, smoothing: 0.3, rotationJitter: 0 }, 0.8),
  d('highlighter', 'Highlighter', 'Drawing', 'chisel', 0.02, 56, 14, 0.05, 1, 1, 1, { roundness: 0.4, smoothing: 0.35 }, 0.45),
  d('ballpoint', 'Ballpoint', 'Drawing', 'round', 0.1, 6, 1, 0.05, 0.75, 0.9, 0.35, { grain: 0.2, smoothing: 0.3 }),
  d('gel-pen', 'Gel pen', 'Drawing', 'round', 0.18, 9, 1.5, 0.04, 1, 0.85, 0.9, { smoothing: 0.4 }),
  d('crayon', 'Crayon', 'Drawing', 'grunge', 0.1, 38, 8, 0.07, 0.8, 0.7, 0.4, { grain: 0.95, grainScale: 1.4, rotationJitter: 1, tilt: 0.6 }, 0.95),
  d('wax-stick', 'Wax stick', 'Drawing', 'chalk', 0.05, 46, 10, 0.06, 0.95, 0.75, 0.5, { grain: 0.7, roundness: 0.8, rotationJitter: 1, tilt: 0.8 }),

  // Inking
  mk('studio-ink', 'Studio ink', 'Inking', {
    softness: 0.02, maxSize: 26, minSize: 1, spacing: 0.04, flow: 1,
    pressureSize: [0.12, 1], smoothing: 0.55, pickup: 0.2, stabilization: 40,
  }),
  mk('brush-pen', 'Brush pen', 'Inking', {
    softness: 0.08, maxSize: 52, minSize: 2, spacing: 0.035, flow: 1,
    pressureSize: [0.04, 1], pressureFlow: [0.85, 1], smoothing: 0.65, pickup: 0.3, stabilization: 50,
  }),
  mk('fine-liner', 'Fine liner', 'Inking', {
    softness: 0, maxSize: 8, minSize: 0.8, spacing: 0.05, flow: 1,
    pressureSize: [0.85, 1], smoothing: 0.4, pickup: 0.15,
  }),
  mk('dry-ink', 'Dry ink', 'Inking', {
    tip: 'bristle', softness: 0.1, maxSize: 64, minSize: 4, spacing: 0.06, flow: 0.95,
    pressureSize: [0.5, 1], pressureFlow: [0.6, 1], followStroke: true, roundness: 0.85, grain: 0.4,
    smoothing: 0.45, pickup: 0.4,
  }),
  d('tapered-ink', 'Tapered ink', 'Inking', 'round', 0.03, 30, 1.5, 0.035, 1, 0.1, 1, { taper: 0.8, smoothing: 0.6, stabilization: 45 }),
  d('nib-pen', 'Nib pen', 'Inking', 'round', 0.02, 16, 1, 0.04, 1, 0.08, 0.95, { roundness: 0.8, smoothing: 0.5, stabilization: 35 }),
  d('rough-ink', 'Rough ink', 'Inking', 'grunge', 0, 30, 3, 0.05, 1, 0.45, 0.8, { grain: 0.35, smoothing: 0.4, rotationJitter: 1 }),
  d('comic-liner', 'Comic liner', 'Inking', 'round', 0, 22, 2, 0.035, 1, 0.3, 1, { smoothing: 0.7, stabilization: 60, taper: 0.4 }),
  d('bold-outline', 'Bold outline', 'Inking', 'round', 0, 60, 12, 0.03, 1, 0.8, 1, { smoothing: 0.7, stabilization: 55 }),
  d('ink-splatter', 'Ink splatter', 'Inking', 'splat', 0, 80, 14, 0.7, 1, 0.7, 1, { rotationJitter: 1, scatter: 0.3, smoothing: 0.1 }),

  // Painting
  mk('round-paint', 'Round paint', 'Painting', {
    softness: 0.25, maxSize: 96, minSize: 4, spacing: 0.07, flow: 0.9,
    pressureSize: [0.4, 1], pressureFlow: [0.5, 1], smoothing: 0.3, pickup: 0.55,
  }),
  mk('flat-paint', 'Flat paint', 'Painting', {
    tip: 'square', softness: 0.08, maxSize: 84, minSize: 6, spacing: 0.06, flow: 0.95,
    pressureSize: [0.55, 1], pressureFlow: [0.6, 1], followStroke: true, roundness: 0.3, grain: 0.2,
    smoothing: 0.35, pickup: 0.5,
  }),
  mk('gouache', 'Gouache', 'Painting', {
    tip: 'blob', softness: 0.12, maxSize: 76, minSize: 5, spacing: 0.1, flow: 1,
    pressureSize: [0.7, 1], rotationJitter: 1, grain: 0.25, smoothing: 0.35, pickup: 0.45,
  }),
  d('oil-bristle', 'Oil bristle', 'Painting', 'bristle', 0.05, 90, 10, 0.05, 1, 0.6, 0.8, { followStroke: true, roundness: 0.9, grain: 0.3, smoothing: 0.35, pickup: 0.7 }),
  d('impasto', 'Impasto', 'Painting', 'bristle', 0.02, 110, 16, 0.04, 1, 0.7, 1, { followStroke: true, roundness: 0.55, grain: 0.5, grainScale: 1.6, smoothing: 0.4, pickup: 0.85 }),
  d('fan-paint', 'Fan brush', 'Painting', 'comb', 0.35, 110, 18, 0.07, 0.8, 0.7, 0.7, { followStroke: true, roundness: 0.3, grain: 0.5, pickup: 0.6, rotationJitter: 0.04 }, 0.9),
  d('palette-knife', 'Palette knife', 'Painting', 'chisel', 0.02, 70, 12, 0.03, 1, 0.8, 1, { followStroke: true, roundness: 0.18, smoothing: 0.5, pickup: 0.9 }),
  d('acrylic', 'Acrylic', 'Painting', 'round', 0.1, 80, 6, 0.06, 1, 0.55, 0.9, { grain: 0.15, smoothing: 0.35 }),
  d('filbert', 'Filbert', 'Painting', 'blob', 0.1, 88, 8, 0.05, 0.95, 0.6, 0.7, { followStroke: true, roundness: 0.55, grain: 0.3, smoothing: 0.4, pickup: 0.6 }),
  d('dry-brush', 'Dry brush', 'Painting', 'fibre', 0.1, 96, 14, 0.05, 0.85, 0.6, 0.4, { followStroke: true, roundness: 0.9, grain: 0.6, grainScale: 1.3, smoothing: 0.35, pickup: 0.5 }),

  // Artistic
  d('rake', 'Rake', 'Artistic', 'comb', 0, 90, 20, 0.04, 1, 0.75, 1, { followStroke: true, roundness: 0.8, smoothing: 0.4 }),
  d('dabber', 'Dabber', 'Artistic', 'sponge', 0.1, 70, 14, 0.4, 0.9, 0.7, 0.7, { rotationJitter: 1, scatter: 0.12 }),
  d('stipple', 'Stipple', 'Artistic', 'dots', 0, 60, 10, 0.5, 1, 0.6, 1, { rotationJitter: 1, scatter: 0.25 }),
  d('crosshatcher', 'Cross-hatcher', 'Artistic', 'hatch', 0, 44, 10, 0.25, 0.85, 0.7, 0.6, { rotationJitter: 0.08, followStroke: true, roundness: 0.9 }),
  d('leaf-stamp', 'Leaf stamp', 'Artistic', 'leaf', 0, 60, 14, 0.7, 1, 0.7, 1, { rotationJitter: 1, scatter: 0.4, roundness: 0.55 }),
  d('petal', 'Petal', 'Artistic', 'leaf', 0.3, 50, 12, 0.5, 0.8, 0.7, 0.8, { rotationJitter: 0.5, roundness: 0.7, scatter: 0.2 }, 0.8),
  d('scribble', 'Scribble', 'Artistic', 'hatch', 0.1, 38, 8, 0.3, 0.8, 0.8, 0.8, { rotationJitter: 1, scatter: 0.15 }),
  d('splash-art', 'Splash', 'Artistic', 'splat', 0, 90, 20, 0.6, 1, 0.8, 1, { rotationJitter: 1, scatter: 0.2 }, 0.9),
  d('torn-edge', 'Torn edge', 'Artistic', 'grunge', 0.05, 80, 16, 0.12, 1, 0.8, 0.9, { rotationJitter: 1, grain: 0.4 }),

  // Calligraphy
  d('broad-nib', 'Broad nib', 'Calligraphy', 'chisel', 0, 40, 6, 0.03, 1, 0.9, 1, { roundness: 0.2, smoothing: 0.5, stabilization: 40 }),
  d('italic-nib', 'Italic nib', 'Calligraphy', 'chisel', 0, 30, 4, 0.03, 1, 0.8, 1, { roundness: 0.14, smoothing: 0.5, stabilization: 40 }),
  d('pointed-pen', 'Pointed pen', 'Calligraphy', 'round', 0, 24, 1, 0.03, 1, 0.04, 1, { roundness: 0.7, smoothing: 0.6, stabilization: 55 }),
  d('flourish', 'Flourish', 'Calligraphy', 'round', 0.02, 36, 1.5, 0.03, 1, 0.05, 1, { taper: 1, smoothing: 0.75, stabilization: 70 }),
  d('brush-script', 'Brush script', 'Calligraphy', 'blob', 0.1, 64, 2, 0.04, 1, 0.05, 0.9, { smoothing: 0.65, grain: 0.15, stabilization: 50 }),
  d('reed-pen', 'Reed pen', 'Calligraphy', 'square', 0.02, 36, 6, 0.04, 1, 0.9, 1, { roundness: 0.25, grain: 0.2, smoothing: 0.4 }),
  d('quill', 'Quill', 'Calligraphy', 'leaf', 0, 26, 3, 0.04, 1, 0.25, 1, { followStroke: true, roundness: 0.35, smoothing: 0.55 }),
  d('uncial', 'Uncial', 'Calligraphy', 'chisel', 0.05, 50, 10, 0.03, 0.95, 0.95, 1, { roundness: 0.3, grain: 0.15, smoothing: 0.45 }),

  // Airbrush
  mk('soft-airbrush', 'Soft airbrush', 'Airbrush', {
    softness: 1, maxSize: 180, minSize: 8, spacing: 0.05, flow: 0.14,
    pressureSize: [0.7, 1], pressureFlow: [0.3, 1], smoothing: 0.3, pickup: 0.6,
  }, 0.8),
  mk('hard-airbrush', 'Hard airbrush', 'Airbrush', {
    softness: 0.55, maxSize: 130, minSize: 6, spacing: 0.04, flow: 0.22,
    pressureSize: [0.8, 1], pressureFlow: [0.3, 1], smoothing: 0.3, pickup: 0.5,
  }, 0.85),
  d('medium-airbrush', 'Medium airbrush', 'Airbrush', 'round', 0.8, 150, 8, 0.05, 0.18, 0.75, 0.3, { smoothing: 0.3 }, 0.85),
  d('fine-mist', 'Fine mist', 'Airbrush', 'round', 1, 50, 4, 0.06, 0.12, 0.7, 0.2, { smoothing: 0.35 }, 0.85),
  d('wide-mist', 'Wide mist', 'Airbrush', 'round', 1, 360, 40, 0.05, 0.06, 0.8, 0.3, { smoothing: 0.3 }, 0.8),
  d('fade-brush', 'Fade', 'Airbrush', 'round', 1, 240, 20, 0.04, 0.04, 0.9, 0.5, { smoothing: 0.4 }, 0.7),
  d('grain-airbrush', 'Grain airbrush', 'Airbrush', 'round', 0.9, 160, 10, 0.05, 0.22, 0.7, 0.3, { grain: 0.8, grainScale: 0.6 }, 0.85),
  d('shader', 'Shader', 'Airbrush', 'round', 0.85, 120, 10, 0.05, 0.2, 0.8, 0.3, { roundness: 0.4, followStroke: true }, 0.85),
  d('detail-airbrush', 'Detail airbrush', 'Airbrush', 'round', 0.35, 40, 3, 0.04, 0.4, 0.8, 0.3, { smoothing: 0.35 }, 0.9),

  // Texture
  mk('speckle', 'Speckle', 'Texture', {
    tip: 'speckle', softness: 0, maxSize: 96, minSize: 10, spacing: 0.3, flow: 1,
    pressureSize: [0.6, 1], scatter: 0.4, rotationJitter: 1, smoothing: 0.1, pickup: 0.3,
  }),
  mk('grain-wash', 'Grain wash', 'Texture', {
    tip: 'grain-round', softness: 0.6, maxSize: 160, minSize: 12, spacing: 0.09, flow: 0.5,
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], rotationJitter: 1, grain: 0.9, smoothing: 0.3, pickup: 0.5,
  }, 0.85),
  d('fine-grain', 'Fine grain', 'Texture', 'round', 0.7, 110, 10, 0.06, 0.6, 0.8, 0.4, { grain: 1, grainScale: 0.4 }, 0.9),
  d('coarse-grain', 'Coarse grain', 'Texture', 'round', 0.7, 130, 10, 0.06, 0.6, 0.8, 0.4, { grain: 1, grainScale: 3 }, 0.9),
  d('dust', 'Dust', 'Texture', 'speckle', 0.2, 140, 20, 0.35, 0.7, 0.8, 0.5, { scatter: 0.6, rotationJitter: 1 }, 0.8),
  d('pixel-noise', 'Pixel noise', 'Texture', 'pixel', 0, 70, 10, 0.4, 1, 0.8, 1, { scatter: 0.3 }),
  d('stone', 'Stone', 'Texture', 'grunge', 0.05, 90, 14, 0.15, 0.9, 0.8, 0.7, { rotationJitter: 1, grain: 0.5, grainScale: 1.5 }),
  d('paper-tooth', 'Paper tooth', 'Texture', 'grain-round', 0.9, 170, 20, 0.08, 0.35, 0.8, 0.4, { grain: 1, grainScale: 2, rotationJitter: 1 }, 0.8),
  d('foam', 'Foam', 'Texture', 'sponge', 0.2, 100, 18, 0.2, 0.8, 0.7, 0.6, { rotationJitter: 1, scatter: 0.1 }),

  // Abstract
  d('ring-stamp', 'Ring stamp', 'Abstract', 'ring', 0, 60, 10, 0.5, 1, 0.8, 1, {}),
  d('star-stamp', 'Star stamp', 'Abstract', 'star', 0, 56, 10, 0.7, 1, 0.8, 1, { rotationJitter: 0.4 }),
  d('dot-cluster', 'Dot cluster', 'Abstract', 'dots', 0, 80, 14, 0.5, 1, 0.8, 1, { rotationJitter: 1, scatter: 0.1 }),
  d('cross-stamp', 'Cross stamp', 'Abstract', 'cross', 0, 40, 8, 0.6, 1, 0.8, 1, { rotationJitter: 0.3 }),
  d('confetti', 'Confetti', 'Abstract', 'square', 0, 20, 5, 0.9, 1, 0.8, 1, { roundness: 0.5, rotationJitter: 1, scatter: 1.4 }),
  d('glitch-bars', 'Glitch bars', 'Abstract', 'hatch', 0, 90, 14, 0.35, 1, 0.9, 1, { roundness: 0.5, scatter: 0.3 }),
  d('ripple', 'Ripple', 'Abstract', 'ring', 0.4, 120, 20, 0.35, 0.5, 0.8, 0.5, {}, 0.7),
  d('star-scatter', 'Star scatter', 'Abstract', 'star', 0, 26, 6, 1.1, 1, 0.8, 1, { rotationJitter: 1, scatter: 1.3 }),

  // Charcoal
  mk('chalk', 'Chalk', 'Charcoal', {
    tip: 'chalk', softness: 0.2, maxSize: 64, minSize: 6, spacing: 0.1, flow: 0.9,
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], tilt: 0.5, rotationJitter: 1, grain: 0.75, smoothing: 0.15, pickup: 0.3,
  }),
  mk('pastel', 'Pastel', 'Charcoal', {
    tip: 'chalk', softness: 0.35, maxSize: 96, minSize: 8, spacing: 0.08, flow: 0.65,
    pressureSize: [0.6, 1], pressureFlow: [0.3, 1], tilt: 1, roundness: 0.7, rotationJitter: 1, scatter: 0.03,
    grain: 0.9, smoothing: 0.15, pickup: 0.4,
  }, 0.9),
  d('charcoal-stick', 'Charcoal stick', 'Charcoal', 'chalk', 0.1, 50, 6, 0.07, 0.85, 0.6, 0.2, { tilt: 1, grain: 0.9, grainScale: 1.2, rotationJitter: 1 }),
  d('compressed', 'Compressed', 'Charcoal', 'chalk', 0.02, 36, 5, 0.06, 1, 0.65, 0.5, { tilt: 0.7, grain: 0.7, rotationJitter: 1 }),
  d('charcoal-powder', 'Powder', 'Charcoal', 'grain-round', 0.9, 190, 30, 0.1, 0.3, 0.8, 0.2, { grain: 1, grainScale: 1.6, rotationJitter: 1 }, 0.8),
  d('willow', 'Willow', 'Charcoal', 'fibre', 0.1, 44, 6, 0.06, 0.7, 0.6, 0.3, { followStroke: true, roundness: 0.9, grain: 0.8, tilt: 0.8 }, 0.9),
  d('conte', 'Conte', 'Charcoal', 'chisel', 0.1, 42, 6, 0.05, 0.9, 0.7, 0.4, { roundness: 0.4, grain: 0.8, grainScale: 0.8, tilt: 0.7 }),
  d('chalk-block', 'Chalk block', 'Charcoal', 'square', 0.1, 90, 18, 0.06, 0.8, 0.8, 0.5, { roundness: 0.5, grain: 0.85, rotationJitter: 0.1 }, 0.9),
  mk('stump', 'Stump', 'Charcoal', {
    softness: 0.9, maxSize: 70, minSize: 8, spacing: 0.06, flow: 0.5, pressureSize: [0.8, 1], pressureFlow: [0.5, 1],
    grain: 0.3, smoothing: 0.3, pickup: 0.9,
  }, 0.9),

  // Elements
  d('grass', 'Grass', 'Elements', 'blade', 0, 70, 14, 0.6, 1, 0.8, 1, { scatter: 0.5, rotationJitter: 0.12 }, 0.95),
  d('leaves', 'Leaves', 'Elements', 'leaf', 0.05, 40, 8, 0.9, 1, 0.8, 1, { rotationJitter: 1, scatter: 1.1, roundness: 0.5 }),
  d('snow', 'Snow', 'Elements', 'round', 0.7, 14, 3, 0.9, 0.9, 0.9, 1, { scatter: 3, rotationJitter: 1 }),
  d('rain', 'Rain', 'Elements', 'leaf', 0.1, 46, 12, 1.3, 0.8, 0.9, 1, { roundness: 0.1, scatter: 1.1, rotationJitter: 0.03 }, 0.8),
  d('embers', 'Embers', 'Elements', 'splat', 0.4, 30, 6, 0.9, 0.9, 0.8, 1, { scatter: 2, rotationJitter: 1 }),
  d('smoke', 'Smoke', 'Elements', 'grunge', 1, 200, 40, 0.08, 0.06, 0.8, 0.4, { rotationJitter: 1, grain: 0.5, scatter: 0.3, smoothing: 0.5 }, 0.7),
  d('clouds', 'Clouds', 'Elements', 'sponge', 0.9, 220, 50, 0.1, 0.12, 0.8, 0.4, { rotationJitter: 1, scatter: 0.2 }, 0.75),
  d('night-stars', 'Night stars', 'Elements', 'star', 0.2, 20, 4, 1.6, 1, 0.8, 1, { scatter: 3, rotationJitter: 0.3 }),
  d('fur-strokes', 'Fur', 'Elements', 'fibre', 0.2, 70, 12, 0.18, 0.7, 0.6, 0.5, { followStroke: true, roundness: 0.85, grain: 0.2, scatter: 0.1 }),
  d('sparks', 'Sparks', 'Elements', 'leaf', 0.3, 20, 4, 1, 1, 0.9, 1, { scatter: 2.4, rotationJitter: 1, roundness: 0.2 }),

  // Spray
  d('spray-can', 'Spray can', 'Spray', 'speckle', 0.3, 140, 20, 0.25, 0.8, 0.8, 0.5, { scatter: 0.55, rotationJitter: 1, smoothing: 0.25 }, 0.9),
  d('fat-cap', 'Fat cap', 'Spray', 'speckle', 0.6, 220, 40, 0.2, 0.7, 0.8, 0.5, { scatter: 0.4, rotationJitter: 1, grain: 0.3 }, 0.9),
  d('thin-cap', 'Thin cap', 'Spray', 'speckle', 0.15, 50, 8, 0.25, 0.9, 0.8, 0.5, { scatter: 0.35, rotationJitter: 1 }),
  d('drip-splat', 'Drip splat', 'Spray', 'splat', 0.05, 100, 20, 0.8, 1, 0.8, 1, { scatter: 0.3, rotationJitter: 1 }),
  d('stencil-mist', 'Stencil mist', 'Spray', 'round', 0.6, 140, 20, 0.06, 0.25, 0.9, 0.5, { grain: 0.6, grainScale: 0.5 }, 0.9),
  d('grit-spray', 'Grit spray', 'Spray', 'pixel', 0, 120, 20, 0.5, 0.8, 0.8, 0.5, { scatter: 0.6, rotationJitter: 1 }),
  d('fade-spray', 'Fade spray', 'Spray', 'speckle', 0.9, 260, 40, 0.15, 0.4, 0.8, 0.3, { scatter: 0.8, rotationJitter: 1 }, 0.7),

  // Material
  d('canvas-weave', 'Canvas weave', 'Material', 'cross', 0, 30, 8, 0.7, 0.9, 0.9, 1, { scatter: 0.3, rotationJitter: 0.04 }, 0.7),
  d('linen', 'Linen', 'Material', 'hatch', 0, 60, 12, 0.5, 0.7, 0.9, 1, { roundness: 0.8, grain: 0.4 }, 0.7),
  d('leather', 'Leather', 'Material', 'grunge', 0.1, 70, 14, 0.2, 0.9, 0.9, 1, { rotationJitter: 1, grain: 0.6, grainScale: 0.8 }),
  d('wood-grain', 'Wood grain', 'Material', 'fibre', 0, 90, 20, 0.08, 0.6, 0.9, 1, { followStroke: true, roundness: 0.6, grain: 0.4 }, 0.85),
  d('sandpaper', 'Sandpaper', 'Material', 'speckle', 0, 80, 14, 0.2, 1, 0.9, 1, { scatter: 0.5, grain: 0.7, grainScale: 0.4 }),
  d('brushed-metal', 'Brushed metal', 'Material', 'fibre', 0, 100, 20, 0.05, 0.5, 0.9, 1, { followStroke: true, roundness: 0.3, grain: 0.2 }, 0.8),
  d('concrete', 'Concrete', 'Material', 'sponge', 0.1, 120, 30, 0.25, 0.8, 0.9, 1, { rotationJitter: 1, grain: 0.7, grainScale: 2 }),
  d('fabric', 'Fabric weave', 'Material', 'cross', 0, 20, 6, 0.55, 1, 1, 1, { scatter: 0.1 }, 0.8),

  // Vintage
  d('letterpress', 'Letterpress', 'Vintage', 'grunge', 0, 50, 10, 0.1, 1, 0.9, 1, { grain: 0.5, rotationJitter: 0.5 }),
  d('woodcut', 'Woodcut', 'Vintage', 'hatch', 0, 38, 8, 0.1, 1, 0.8, 1, { followStroke: true, roundness: 0.35, grain: 0.3 }),
  d('halftone', 'Halftone', 'Vintage', 'dots', 0, 90, 20, 0.3, 0.9, 0.9, 1, { grain: 0.1 }, 0.9),
  d('mimeograph', 'Mimeograph', 'Vintage', 'sponge', 0.1, 70, 12, 0.18, 0.8, 0.9, 0.8, { grain: 0.55, rotationJitter: 1 }, 0.85),
  d('typewriter', 'Typewriter', 'Vintage', 'pixel', 0, 26, 6, 0.9, 0.9, 1, 1, { scatter: 0.1 }, 0.9),
  d('ink-stamp', 'Ink stamp', 'Vintage', 'ring', 0.05, 60, 14, 0.4, 0.9, 1, 1, { grain: 0.6, rotationJitter: 1 }, 0.9),
  d('etching', 'Etching', 'Vintage', 'hatch', 0, 24, 5, 0.08, 1, 0.5, 0.9, { followStroke: true, roundness: 0.8, smoothing: 0.5 }, 0.9),
  d('faded-print', 'Faded print', 'Vintage', 'grain-round', 0.5, 110, 16, 0.1, 0.5, 0.8, 0.5, { grain: 1, grainScale: 2.5 }, 0.7),

  // Glow
  d('soft-glow', 'Soft glow', 'Glow', 'round', 1, 200, 20, 0.04, 0.12, 0.8, 0.5, { smoothing: 0.3 }, 0.8),
  d('neon-tube', 'Neon tube', 'Glow', 'round', 0.55, 30, 6, 0.03, 0.5, 0.9, 0.9, { smoothing: 0.5 }, 0.9),
  d('light-streak', 'Light streak', 'Glow', 'leaf', 0.5, 140, 30, 0.1, 0.4, 0.8, 0.5, { roundness: 0.1, followStroke: true }, 0.8),
  d('bokeh', 'Bokeh', 'Glow', 'ring', 0.55, 70, 14, 0.9, 0.5, 0.9, 0.6, { scatter: 0.9 }, 0.7),
  d('lens-dots', 'Lens dots', 'Glow', 'round', 0.8, 36, 6, 1, 0.5, 0.9, 0.8, { scatter: 1.2 }, 0.7),
  d('sparkle', 'Sparkle', 'Glow', 'star', 0.5, 40, 8, 1.2, 0.9, 0.9, 1, { scatter: 0.9, rotationJitter: 0.2 }, 0.9),
  d('halo', 'Halo', 'Glow', 'ring', 0.9, 120, 30, 0.2, 0.25, 0.9, 0.6, {}, 0.7),
  d('aurora', 'Aurora', 'Glow', 'blob', 1, 220, 50, 0.07, 0.07, 0.9, 0.5, { rotationJitter: 1, smoothing: 0.5 }, 0.7),

  // Industrial
  d('rivets', 'Rivets', 'Industrial', 'ring', 0.08, 22, 8, 2, 1, 1, 1, {}),
  d('scratches', 'Scratches', 'Industrial', 'hatch', 0, 70, 14, 0.2, 0.5, 0.9, 0.8, { rotationJitter: 0.6, scatter: 0.3, roundness: 0.15 }, 0.8),
  d('rust', 'Rust', 'Industrial', 'grunge', 0.2, 100, 20, 0.12, 0.6, 0.8, 0.6, { rotationJitter: 1, grain: 0.7, grainScale: 1.5 }, 0.85),
  d('grid-dots', 'Grid dots', 'Industrial', 'pixel', 0, 40, 10, 1, 1, 1, 1, { roundness: 1 }),
  d('stencil-bars', 'Stencil bars', 'Industrial', 'square', 0, 60, 14, 0.9, 1, 1, 1, { roundness: 0.3, followStroke: true }),
  d('panel-line', 'Panel line', 'Industrial', 'square', 0, 6, 2, 0.04, 1, 1, 1, { smoothing: 0.6, stabilization: 50 }),
  d('gritty-marker', 'Gritty marker', 'Industrial', 'chisel', 0.05, 40, 8, 0.05, 0.9, 0.9, 0.9, { roundness: 0.35, grain: 0.9, grainScale: 0.6 }),
  d('weld', 'Weld bead', 'Industrial', 'blob', 0.1, 20, 6, 0.4, 1, 1, 1, { rotationJitter: 1 }),

  // Organic
  d('moss', 'Moss', 'Organic', 'sponge', 0.2, 80, 14, 0.15, 0.9, 0.8, 0.8, { rotationJitter: 1, scatter: 0.3 }),
  d('bark', 'Bark', 'Organic', 'grunge', 0, 90, 20, 0.1, 0.9, 0.8, 0.8, { followStroke: true, roundness: 0.5, grain: 0.5, grainScale: 1.4 }),
  d('vein', 'Vein', 'Organic', 'leaf', 0, 50, 6, 0.05, 1, 0.1, 1, { followStroke: true, roundness: 0.18, smoothing: 0.6, taper: 0.7 }),
  d('pebbles', 'Pebbles', 'Organic', 'blob', 0.1, 34, 8, 1.1, 1, 0.8, 1, { scatter: 0.7, rotationJitter: 1, roundness: 0.8 }),
  d('scales', 'Scales', 'Organic', 'ring', 0, 40, 10, 0.55, 1, 0.9, 1, { followStroke: true, roundness: 0.8 }),
  d('coral', 'Coral', 'Organic', 'splat', 0.05, 60, 12, 0.5, 1, 0.8, 1, { rotationJitter: 1, scatter: 0.15 }),
  d('fern', 'Fern', 'Organic', 'blade', 0, 56, 12, 0.35, 1, 0.8, 1, { followStroke: true, scatter: 0.1 }),
  d('seed-pods', 'Seed pods', 'Organic', 'leaf', 0.1, 24, 6, 0.8, 1, 0.8, 1, { rotationJitter: 1, scatter: 1.2, roundness: 0.45 }),

  // Water
  mk('watercolor-wash', 'Watercolor wash', 'Water', {
    tip: 'blob', softness: 0.7, maxSize: 140, minSize: 10, spacing: 0.06, flow: 0.2,
    pressureSize: [0.7, 1], pressureFlow: [0.35, 1], rotationJitter: 1, grain: 0.35, smoothing: 0.5, pickup: 0.4,
  }, 0.75),
  mk('wet-blend', 'Wet blend', 'Water', {
    softness: 0.8, maxSize: 120, minSize: 8, spacing: 0.05, flow: 0.35,
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], grain: 0.1, smoothing: 0.4, pickup: 0.8,
  }, 0.9),
  d('soft-wash', 'Soft wash', 'Water', 'blob', 0.9, 200, 30, 0.07, 0.1, 0.8, 0.4, { rotationJitter: 1, grain: 0.2, smoothing: 0.55 }, 0.7),
  d('wet-edge', 'Wet edge', 'Water', 'ring', 0.55, 80, 14, 0.06, 0.18, 0.7, 0.4, { smoothing: 0.5, grain: 0.2 }, 0.8),
  d('bleed', 'Bleed', 'Water', 'grunge', 0.9, 120, 20, 0.08, 0.15, 0.8, 0.4, { rotationJitter: 1, grain: 0.4, smoothing: 0.5 }, 0.75),
  d('droplets', 'Droplets', 'Water', 'splat', 0.2, 50, 10, 1, 0.6, 0.8, 0.5, { scatter: 0.8, rotationJitter: 1 }, 0.8),
  d('salt', 'Salt', 'Water', 'speckle', 0, 60, 8, 0.5, 1, 0.9, 1, { scatter: 0.8, rotationJitter: 1 }),
  d('ink-wash', 'Ink wash', 'Water', 'round', 0.7, 110, 12, 0.05, 0.15, 0.6, 0.3, { grain: 0.3, smoothing: 0.5, pickup: 0.5 }, 0.8),
  d('puddle', 'Puddle', 'Water', 'blob', 0.35, 180, 40, 0.1, 0.3, 0.8, 0.6, { rotationJitter: 1, smoothing: 0.6, grain: 0.15 }, 0.7),

  // Touch-ups
  mk('smoother', 'Smoother', 'Touch-ups', { softness: 1, maxSize: 110, minSize: 10, spacing: 0.05, flow: 0.4, pressureSize: [0.8, 1], pressureFlow: [0.4, 1], smoothing: 0.4, pickup: 0.95 }, 0.9),
  mk('blender', 'Blender', 'Touch-ups', { softness: 0.7, maxSize: 90, minSize: 8, spacing: 0.05, flow: 0.55, pressureSize: [0.8, 1], pressureFlow: [0.5, 1], grain: 0.15, smoothing: 0.3, pickup: 0.7 }, 0.9),
  mk('streak-blend', 'Streak blend', 'Touch-ups', { tip: 'fibre', softness: 0.1, maxSize: 80, minSize: 10, spacing: 0.05, flow: 0.7, pressureSize: [0.8, 1], followStroke: true, roundness: 0.9, smoothing: 0.35, pickup: 0.85 }),
  mk('grain-smudge', 'Grain smudge', 'Touch-ups', { tip: 'grain-round', softness: 0.6, maxSize: 90, minSize: 8, spacing: 0.06, flow: 0.6, pressureSize: [0.8, 1], grain: 0.8, smoothing: 0.3, pickup: 0.75 }, 0.9),
  d('highlighter-touch', 'Highlight', 'Touch-ups', 'round', 0.8, 90, 8, 0.05, 0.2, 0.8, 0.4, { smoothing: 0.35 }, 0.7),
  d('shadow-touch', 'Shadow', 'Touch-ups', 'round', 0.9, 120, 10, 0.05, 0.16, 0.8, 0.4, { smoothing: 0.35 }, 0.7),
  d('detail-pick', 'Detail', 'Touch-ups', 'round', 0.2, 12, 2, 0.05, 1, 0.8, 1, { smoothing: 0.35 }),
  d('edge-clean', 'Edge clean', 'Touch-ups', 'round', 0, 40, 4, 0.04, 1, 0.9, 1, { smoothing: 0.5, stabilization: 30 }),
  d('spot-heal', 'Spot dab', 'Touch-ups', 'blob', 0.55, 36, 6, 0.35, 0.8, 0.9, 0.7, { rotationJitter: 1 }, 0.9),
];

export const BRUSH_SETS: string[] = ['Sketch', 'Drawing', 'Inking', 'Painting', 'Artistic', 'Calligraphy', 'Airbrush', 'Texture', 'Abstract', 'Charcoal', 'Elements', 'Spray', 'Material', 'Vintage', 'Glow', 'Industrial', 'Organic', 'Water', 'Touch-ups'];

export const DEFAULT_PAINT = 'studio-ink';
export const DEFAULT_SMUDGE = 'wet-blend';
export const DEFAULT_ERASE = 'round-paint';

/** Every starter brush: the Classic library, then the Animation library. */
export const ALL_STARTERS: Brush[] = [...BRUSHES, ...ANIMATION_BRUSHES];
const starterMap = new Map<string, Brush>(ALL_STARTERS.map((b) => [b.id, b]));

const registry = new Map<string, Brush>(ALL_STARTERS.map((b) => [b.id, b]));

export function brushById(id: string): Brush | undefined {
  return registry.get(id);
}

/** Puts a brush (a starter one with edits, or one the person made) into the lookup. */
export function registerBrush(b: Brush): void { registry.set(b.id, b); }

export function unregisterBrush(id: string): void { registry.delete(id); }

export function allBrushes(): Brush[] { return Array.from(registry.values()); }

/** The untouched starter brush of an id. */
export function starterBrush(id: string): Brush | undefined { return starterMap.get(id); }
