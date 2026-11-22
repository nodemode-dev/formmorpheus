// The Classic brush library: original brushes in eighteen sets, all made in code
// (tip shapes and grain are generated, see tips.ts). `brushById` reads a registry that
// the brush store (ui/brush-store.ts) keeps current with renames, edits and imports.

import type { Brush, TipShape } from './types';
import { ANIMATION_BRUSHES } from './brushes-animation';
import { withMaterials } from './brush-materials';
import { migrateBrush } from './brush-migrate';

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

/** Shipped brushes keep fast corners: the lazy rope and the card's Stabilization stay short unless a person raises them. */
export function keepCorners(b: Brush): Brush {
  const out: Brush = { ...b, smoothing: Math.min(0.14, Math.round(b.smoothing * 0.3 * 100) / 100) };
  if (b.stabilization !== undefined) {
    out.stabilization = Math.round(b.stabilization * 0.2);
    // the card's value now adds to the rope, so the shipped brush gives that part back: its total stays what it was
    out.smoothing = Math.max(0, out.smoothing - stabilizationRope(out));
  }
  return out;
}

/** The share of the lazy rope (0 to 1) that a brush's Stabilization card value (0 to 100) adds. */
export function stabilizationRope(b: Brush): number {
  return Math.max(0, Math.min(100, b.stabilization ?? 0)) / 100 * 0.5;
}

/** The Classic sets in library order: `id` is the stored set id (fixed for good), `name` what the panel shows. */
export const CLASSIC_SETS: { id: string; name: string }[] = [
  { id: 'sketching', name: 'Graphite' }, { id: 'charcoals', name: 'Charcoal' }, { id: 'drawing', name: 'Pens and markers' },
  { id: 'inking', name: 'Comic ink' }, { id: 'calligraphy', name: 'Nibs' }, { id: 'painting', name: 'Studio paint' },
  { id: 'water', name: 'Wet media' }, { id: 'airbrushing', name: 'Mist' }, { id: 'spraypaints', name: 'Graffiti' },
  { id: 'artistic', name: 'Mark making' }, { id: 'textures', name: 'Grit' }, { id: 'materials', name: 'Finishes' },
  { id: 'vintage', name: 'Printmaking' }, { id: 'industrial', name: 'Metalwork' }, { id: 'abstract', name: 'Shapes' },
  { id: 'luminance', name: 'Glow' }, { id: 'elements', name: 'Atmosphere' }, { id: 'organic', name: 'Nature' },
];

/** A row's short set name to the stored set id it lands in (any other row name is its id in lower case); Touch-ups folds into Drawing. Libraries saved long ago used these short names too. */
export const OLD_SET_NAMES: Record<string, string> = {
  Sketch: 'sketching', Airbrush: 'airbrushing', Texture: 'textures', Charcoal: 'charcoals', Spray: 'spraypaints',
  Material: 'materials', Glow: 'luminance', 'Touch-ups': 'drawing',
};

const classicName = (row: string): string => {
  const id = OLD_SET_NAMES[row] ?? row.toLowerCase();
  return CLASSIC_SETS.find((s) => s.id === id)?.name ?? row;
};

const RAW_BRUSHES: Brush[] = [
  // Sketch
  mk('pencil-hb', 'Pencil HB', 'Sketch', {
    tip: 'grain-round', softness: 0.15, maxSize: 14, minSize: 1.2, spacing: 0.07, flow: 0.7,
    pressureSize: [0.35, 1.1], pressureFlow: [0.1, 1], pressureOpacity: 0.6, tilt: 0.8, grain: 0.7, smoothing: 0.1, pickup: 0.25,
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
  d('hard-4h', 'Hard 4H', 'Sketch', 'grain-round', 0.05, 8, 1, 0.06, 0.5, 0.8, 0.4, { grain: 0.5, smoothing: 0.15, tilt: 0.4 }, 0.8),
  d('mech-pencil', 'Mechanical', 'Sketch', 'round', 0, 5, 0.8, 0.05, 0.85, 0.9, 0.6, { grain: 0.25, smoothing: 0.25 }),
  d('colored-pencil', 'Color pencil', 'Sketch', 'grain-round', 0.2, 22, 2, 0.05, 0.9, 0.6, 0.2, { tilt: 0.7, grain: 1, grainScale: 0.7, roundness: 0.9 }, 0.9),
  d('hatch-pencil', 'Hatch pencil', 'Sketch', 'hatch', 0.1, 26, 6, 0.12, 0.7, 0.7, 0.4, { followStroke: true, roundness: 0.6, grain: 0.5 }),
  d('carpenter', 'Carpenter', 'Sketch', 'chisel', 0.1, 24, 3, 0.05, 0.6, 0.7, 0.3, { roundness: 0.3, grain: 0.7, tilt: 0.6 }, 0.9),

  // Drawing
  d('tech-pen', 'Technical pen', 'Drawing', 'round', 0, 7, 1, 0.04, 1, 1, 1, { smoothing: 0.45 }),
  d('felt-tip', 'Felt tip', 'Drawing', 'round', 0.08, 18, 3, 0.04, 0.85, 0.85, 0.7, { smoothing: 0.35, grain: 0.1 }, 0.9),
  d('marker', 'Marker', 'Drawing', 'round', 0.05, 34, 6, 0.05, 0.9, 0.9, 0.8, { smoothing: 0.3 }, 0.8),
  d('chisel-marker', 'Chisel marker', 'Drawing', 'chisel', 0.04, 44, 8, 0.05, 0.9, 0.9, 0.8, { roundness: 0.28, smoothing: 0.3, rotationJitter: 0 }, 0.8),
  d('marker-roll', 'Marker roll', 'Drawing', 'chisel', 0.04, 48, 8, 0.05, 0.9, 0.9, 0.8, { roundness: 0.26, smoothing: 0.3 }, 0.8),
  d('highlighter', 'Highlighter', 'Drawing', 'chisel', 0.02, 56, 14, 0.05, 1, 1, 1, { roundness: 0.4, smoothing: 0.35, blend: 'multiply' }, 0.45),
  d('ballpoint', 'Ballpoint', 'Drawing', 'round', 0.1, 6, 1, 0.05, 0.75, 0.9, 0.35, { grain: 0.2, smoothing: 0.3 }),
  d('gel-pen', 'Gel pen', 'Drawing', 'round', 0.18, 9, 1.5, 0.04, 1, 0.85, 0.9, { smoothing: 0.4 }),
  d('crayon', 'Crayon', 'Drawing', 'grunge', 0.1, 38, 8, 0.07, 0.8, 0.7, 0.4, { grain: 0.95, grainScale: 1.4, rotationJitter: 1, tilt: 0.6 }, 0.95),
  d('wax-stick', 'Wax stick', 'Drawing', 'chalk', 0.05, 46, 10, 0.06, 0.95, 0.75, 0.5, { grain: 0.7, roundness: 0.8, rotationJitter: 1, tilt: 0.8 }),

  // Inking
  mk('studio-ink', 'Studio ink', 'Inking', {
    softness: 0.02, maxSize: 26, minSize: 1, spacing: 0.04, flow: 1,
    pressureSize: [0.12, 1], smoothing: 0.55, pickup: 0.2, stabilization: 40,
    taper: 0.3, taperEnd: 0.55, taperSize: 0.12,
  }),
  mk('brush-pen', 'Brush pen', 'Inking', {
    softness: 0.08, maxSize: 52, minSize: 2, spacing: 0.035, flow: 1,
    pressureSize: [0.04, 1], pressureFlow: [0.85, 1], smoothing: 0.65, pickup: 0.3, stabilization: 50,
    taper: 0.4, taperEnd: 0.7, taperSize: 0.08, taperTip: 0.4,
  }),
  mk('fine-liner', 'Fine liner', 'Inking', {
    softness: 0, maxSize: 8, minSize: 0.8, spacing: 0.05, flow: 1,
    pressureSize: [0.3, 1], pressureGamma: 0.85, smoothing: 0.4, pickup: 0.15,
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
  // opaque paint: a solid body with a combed, grainy rim (paint/fam-paint-tips.ts); light pressure thins the load and the paper shows
  mk('round-paint', 'Round paint', 'Painting', {
    softness: 0, maxSize: 96, minSize: 4, spacing: 0.05, flow: 0.85, followStroke: true,
    pressureSize: [0.25, 1], pressureFlow: [0.3, 1], pressureOpacity: 0.5, grain: 0.22, grainScale: 0.6, grainAlign: true, grainDepthMin: 0.1, scatterPos: 0.006, burnout: 0.3, edgeBreak: 0.6, smoothing: 0.3, pickup: 0.55,
  }),
  mk('flat-paint', 'Flat paint', 'Painting', {
    tip: 'square', softness: 0, maxSize: 84, minSize: 6, spacing: 0.05, flow: 0.8,
    pressureSize: [0.3, 1], pressureFlow: [0.25, 1], pressureOpacity: 0.55, followStroke: true, roundness: 1, grain: 0.5, grainScale: 0.5, grainAlign: true, grainDepthMin: 0.08, scatterPos: 0.006,
    burnout: 0.35, edgeBreak: 0.6, smoothing: 0.35, pickup: 0.5,
  }),
  // matte and opaque: a nearly solid stroke with a fine tooth, a softer ragged rim and a little loss of load along a long pull
  mk('gouache', 'Gouache', 'Painting', {
    softness: 0, maxSize: 76, minSize: 5, spacing: 0.05, flow: 1, followStroke: true,
    pressureSize: [0.28, 1], pressureFlow: [0.45, 1], pressureOpacity: 0.22, grain: 0.25, grainScale: 0.6, grainAlign: true, grainDepthMin: 0.12, scatterPos: 0.01, burnout: 0.2, edgeBreak: 1,
    smoothing: 0.35, pickup: 0.45,
  }),
  // a bundle of hairs (paint/bristle.ts): per-hair streaks, pickup of the paint under it, canvas grain that travels
  d('oil-bristle', 'Oil bristle', 'Painting', 'bristle', 0.05, 90, 10, 0.04, 1, 0.45, 0.8, { tilt: 0.6, followStroke: true, roundness: 0.9, grain: 0.55, grainMode: 'moving', grainMovement: 0.95, grainJitter: 0.19, grainContrast: 0.12, smoothing: 0.35, pickup: 0.7, bristle: { count: 0, lenVar: 0.45, tone: 0.3, clump: 0.5 }, render: 'intense-blending', burntEdges: 0.25, wet: { dilution: 0.15, charge: 0.8, attack: 0.15, pull: 0.45, grade: 0.25 } }),
  d('impasto', 'Impasto', 'Painting', 'bristle', 0.02, 110, 16, 0.04, 1, 0.5, 0.7, { tilt: 0.6, bristle: { count: 0, lenVar: 0.35, tone: 0.25, clump: 0.7 }, followStroke: true, roundness: 0.55, grain: 0.5, grainScale: 1.6, smoothing: 0.4, pickup: 0.85, render: 'heavy-blending', wet: { dilution: 0.05, charge: 0.85, attack: 0.3, pull: 0.45, grade: 0.3 }, bump: 0.7, shine: { depth: 0.8, gloss: 0.45, metal: 0 } }),
  d('fan-paint', 'Fan brush', 'Painting', 'comb', 0.35, 110, 18, 0.07, 0.8, 0.7, 0.7, { followStroke: true, roundness: 0.3, grain: 0.5, pickup: 0.6, rotationJitter: 0.04 }, 0.9),
  // a flat blade (paint/bristle.ts, body): one solid band that scrapes the paint under it along and leaves it dragged
  d('palette-knife', 'Palette knife', 'Painting', 'bristle', 0.02, 70, 12, 0.03, 1, 0.8, 1, { tilt: 0.7, followStroke: true, roundness: 0.18, smoothing: 0.5, pickup: 0.9, grain: 0.18, bump: 0.35, bristle: { count: 64, lenVar: 0.05, tone: 0.1, clump: 0.9, body: 0.95 }, render: 'uniform-blending', wet: { dilution: 0, charge: 0.97, attack: 0.15, pull: 0.5, grade: 0.3 }, shine: { depth: 0.5, gloss: 0.5, metal: 0.15 } }),
  d('acrylic', 'Acrylic', 'Painting', 'round', 0, 80, 6, 0.05, 0.8, 0.28, 0.2, { followStroke: true, grain: 0.45, grainScale: 0.5, grainDepthMin: 0.05, burnout: 0.35, scatterPos: 0.012, smoothing: 0.35 }),
  d('filbert', 'Filbert', 'Painting', 'blob', 0, 88, 8, 0.05, 0.8, 0.3, 0.2, { followStroke: true, roundness: 1, grain: 0.5, grainScale: 0.5, grainAlign: true, grainDepthMin: 0.08, burnout: 0.35, scatterPos: 0.006, pressureOpacity: 0.5, edgeBreak: 0.5, smoothing: 0.4, pickup: 0.6 }),
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
  d('nib-roll', 'Calligraphy roll', 'Calligraphy', 'chisel', 0.02, 30, 4, 0.03, 1, 0.9, 1, { roundness: 0.2, smoothing: 0.45 }),
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
  d('paper-tooth', 'Paper tooth', 'Texture', 'round', 0.3, 120, 20, 0.05, 0.7, 0.6, 0.4, { grain: 0.85, grainScale: 1.8, grainDepthMin: 0.1, smoothing: 0.3 }, 0.85),
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
    pressureSize: [0.7, 1], pressureFlow: [0.4, 1], tilt: 0.85, rotationJitter: 1, grain: 0.75, smoothing: 0.15, pickup: 0.3,
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
  // roll brushes: a flat stick that turns with the pen's barrel roll (names with "roll" opt in), thicker when it lies across the stroke
  d('charcoal-roll', 'Charcoal roll', 'Charcoal', 'chalk', 0.1, 72, 12, 0.06, 0.8, 0.6, 0.25, { roundness: 0.32, grain: 0.9, grainScale: 1.2, rollSize: 0.35, tilt: 0.5 }, 0.9),
  d('chalk-block', 'Chalk block', 'Charcoal', 'square', 0.1, 90, 18, 0.06, 0.8, 0.8, 0.5, { roundness: 0.5, grain: 0.85, rotationJitter: 0.1, tilt: 0.8 }, 0.9),
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
  // paint/spray: many light stamps of a fine particle cloud (spacing near 1 percent of the cloud), so the mist is continuous and the speckle stays fine
  d('spray-can', 'Spray can', 'Spray', 'speckle', 0.3, 100, 16, 0.04, 0.35, 0.6, 0.4, { scatter: 0.55, rotationJitter: 1, smoothing: 0.25 }, 0.9),
  d('fat-cap', 'Fat cap', 'Spray', 'speckle', 0.6, 150, 30, 0.03, 0.25, 0.6, 0.4, { scatter: 0.4, rotationJitter: 1, grain: 0.3 }, 0.9),
  d('thin-cap', 'Thin cap', 'Spray', 'speckle', 0.15, 40, 6, 0.04, 0.4, 0.6, 0.4, { scatter: 0.35, rotationJitter: 1 }),
  d('drip-splat', 'Drip splat', 'Spray', 'splat', 0.05, 100, 20, 0.8, 1, 0.8, 1, { scatter: 0.3, rotationJitter: 1 }),
  d('stencil-mist', 'Stencil mist', 'Spray', 'round', 0.6, 140, 20, 0.06, 0.25, 0.9, 0.5, { grain: 0.6, grainScale: 0.5 }, 0.9),
  d('grit-spray', 'Grit spray', 'Spray', 'pixel', 0, 90, 16, 0.02, 0.16, 0.6, 0.4, { scatter: 0.6, rotationJitter: 1 }),
  d('fade-spray', 'Fade spray', 'Spray', 'speckle', 0.6, 120, 20, 0.03, 0.35, 0.6, 0.3, { scatter: 0.25, rotationJitter: 1 }, 0.7),

  // Material
  // a continuous band of woven cloth (the grain is the weave), not a row of stamps; light pressure keeps the threads, only fainter
  d('canvas-weave', 'Canvas weave', 'Material', 'round', 0.12, 40, 10, 0.05, 0.9, 0.6, 0.5, { grain: 1, grainDepthMin: 0.3, smoothing: 0.3 }, 0.9),
  d('linen', 'Linen', 'Material', 'round', 0.1, 60, 12, 0.05, 0.85, 0.6, 0.5, { grain: 1, grainDepthMin: 0.25, smoothing: 0.3 }, 0.9),
  d('leather', 'Leather', 'Material', 'grunge', 0.1, 70, 14, 0.2, 0.9, 0.9, 1, { rotationJitter: 1, grain: 0.6, grainScale: 0.8 }),
  d('wood-grain', 'Wood grain', 'Material', 'fibre', 0, 90, 20, 0.08, 0.6, 0.9, 1, { followStroke: true, roundness: 0.6, grain: 0.4 }, 0.85),
  d('sandpaper', 'Sandpaper', 'Material', 'speckle', 0, 80, 14, 0.2, 1, 0.9, 1, { scatter: 0.5, grain: 0.7, grainScale: 0.4 }),
  d('brushed-metal', 'Brushed metal', 'Material', 'fibre', 0, 100, 20, 0.05, 0.5, 0.9, 1, { followStroke: true, roundness: 0.3, grain: 0.2 }, 0.8),
  d('concrete', 'Concrete', 'Material', 'round', 0.2, 90, 20, 0.05, 0.9, 0.6, 0.5, { grain: 0.75, grainScale: 1.3, grainDepthMin: 0.3, smoothing: 0.3 }),
  d('fabric', 'Fabric weave', 'Material', 'round', 0.1, 26, 6, 0.05, 0.9, 0.7, 0.5, { grain: 1, grainDepthMin: 0.3, smoothing: 0.3 }, 0.9),
  // lit materials: the stroke is read as a raised ridge and lit (paint/shine.ts)
  d('enamel', 'Glossy enamel', 'Material', 'round', 0.05, 70, 8, 0.05, 1, 0.8, 1, { smoothing: 0.3, shine: { depth: 0.5, gloss: 0.9, metal: 0 } }),
  d('chrome', 'Chrome', 'Material', 'round', 0.05, 60, 8, 0.05, 1, 0.8, 1, { smoothing: 0.3, shine: { depth: 0.7, gloss: 0.8, metal: 1 } }),
  d('gold-leaf', 'Gold leaf', 'Material', 'grunge', 0.05, 70, 10, 0.08, 1, 0.8, 1, { rotationJitter: 1, grain: 0.5, grainScale: 0.9, bump: 0.25, shine: { depth: 0.35, gloss: 0.6, metal: 0.9 } }),
  d('thick-oil', 'Thick oil', 'Material', 'bristle', 0.02, 100, 14, 0.04, 1, 0.5, 0.7, { tilt: 0.6, bristle: { count: 0, lenVar: 0.35, tone: 0.25, clump: 0.7 }, followStroke: true, roundness: 0.6, grain: 0.55, grainScale: 1.5, bump: 0.6, shine: { depth: 1, gloss: 0.5, metal: 0 }, render: 'intense-blending', wet: { dilution: 0.04, charge: 0.8, attack: 0.5, pull: 0.55, grade: 0.3 } }),

  // Vintage
  d('letterpress', 'Letterpress', 'Vintage', 'grunge', 0, 50, 10, 0.1, 1, 0.9, 1, { grain: 0.5, rotationJitter: 0.5 }),
  d('woodcut', 'Woodcut', 'Vintage', 'chisel', 0.02, 38, 8, 0.04, 1, 0.8, 1, { followStroke: true, roundness: 0.5, grain: 0.5, grainDepthMin: 0.3 }),
  d('halftone', 'Halftone', 'Vintage', 'dots', 0, 90, 20, 0.3, 0.9, 0.9, 1, { grain: 0.1 }, 0.9),
  d('mimeograph', 'Mimeograph', 'Vintage', 'sponge', 0.1, 70, 12, 0.18, 0.8, 0.9, 0.8, { grain: 0.55, rotationJitter: 1 }, 0.85),
  d('typewriter', 'Typewriter', 'Vintage', 'pixel', 0, 26, 6, 0.9, 0.9, 1, 1, { scatter: 0.1 }, 0.9),
  d('ink-stamp', 'Ink stamp', 'Vintage', 'ring', 0.05, 60, 14, 0.4, 0.9, 1, 1, { grain: 0.6, rotationJitter: 1 }, 0.9),
  d('etching', 'Etching', 'Vintage', 'hatch', 0, 24, 5, 0.08, 1, 0.5, 0.9, { followStroke: true, roundness: 0.8, smoothing: 0.5 }, 0.9),
  d('faded-print', 'Faded print', 'Vintage', 'grain-round', 0.5, 110, 16, 0.1, 0.5, 0.8, 0.5, { grain: 1, grainScale: 1.5, grainDepthMin: 0.15 }, 0.7),

  // Glow
  d('soft-glow', 'Soft glow', 'Glow', 'round', 1, 200, 20, 0.04, 0.12, 0.8, 0.5, { smoothing: 0.3 }, 0.8),
  d('neon-tube', 'Neon tube', 'Glow', 'round', 0.55, 30, 6, 0.03, 0.5, 0.9, 0.9, { smoothing: 0.5 }, 0.9),
  // a streak of light runs along the stroke: the long axis of the stamp lies on the path
  d('light-streak', 'Light streak', 'Glow', 'round', 0.7, 140, 30, 0.04, 0.3, 0.8, 0.5, { roundness: 0.18, followStroke: true, baseRot: -Math.PI / 2 }, 0.8),
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
  d('vein', 'Vein', 'Organic', 'round', 0.05, 50, 6, 0.04, 1, 0.1, 1, { followStroke: true, roundness: 0.3, baseRot: -Math.PI / 2, smoothing: 0.6, taper: 0.7 }),
  d('pebbles', 'Pebbles', 'Organic', 'blob', 0.1, 34, 8, 1.1, 1, 0.8, 1, { scatter: 0.7, rotationJitter: 1, roundness: 0.8 }),
  d('scales', 'Scales', 'Organic', 'ring', 0, 40, 10, 0.55, 1, 0.9, 1, { followStroke: true, roundness: 0.8 }),
  d('coral', 'Coral', 'Organic', 'splat', 0.05, 60, 12, 0.5, 1, 0.8, 1, { rotationJitter: 1, scatter: 0.15 }),
  d('fern', 'Fern', 'Organic', 'blade', 0, 56, 12, 0.35, 1, 0.8, 1, { followStroke: true, scatter: 0.1 }),
  d('seed-pods', 'Seed pods', 'Organic', 'leaf', 0.1, 24, 6, 0.8, 1, 0.8, 1, { rotationJitter: 1, scatter: 1.2, roundness: 0.45 }),

  // Water
  mk('watercolor-wash', 'Watercolor wash', 'Water', {
    tip: 'blob', softness: 0.7, maxSize: 140, minSize: 10, spacing: 0.06, flow: 0.3,
    pressureSize: [0.4, 1], pressureFlow: [0.3, 1], rotationJitter: 1, grain: 0.22, smoothing: 0.5, pickup: 0.4,
    // a transparent wash: it never drags what is under it, its rim pools and it bleeds a little into neighbours
    render: 'light-glaze', wetEdges: 0.9, wet: { dilution: 0.3, charge: 0.85, attack: 0.1, pull: 0.12, grade: 0.7, blur: 0.4 },
  }, 0.9),
  mk('wet-blend', 'Wet blend', 'Water', {
    softness: 0.8, maxSize: 120, minSize: 8, spacing: 0.05, flow: 0.35,
    pressureSize: [0.45, 1], pressureFlow: [0.4, 1], grain: 0.3, smoothing: 0.4, pickup: 0.8, wetEdges: 0.3,
    // used as paint it is a blender: it carries what is under it a long way
    render: 'intense-blending', wet: { dilution: 0.2, charge: 0.4, attack: 0.3, pull: 1, grade: 0.7, blur: 0.5 },
  }, 0.9),
  d('soft-wash', 'Soft wash', 'Water', 'blob', 0.9, 200, 30, 0.07, 0.1, 0.8, 0.4, { rotationJitter: 1, grain: 0.2, smoothing: 0.55 }, 0.7),
  d('wet-edge', 'Wet edge', 'Water', 'round', 0.45, 90, 26, 0.06, 0.5, 0.45, 0.4, { smoothing: 0.5, grain: 0.2, render: 'light-glaze', wetEdges: 1 }, 0.85),
  d('bleed', 'Bleed', 'Water', 'grunge', 0.9, 120, 20, 0.08, 0.15, 0.8, 0.4, { rotationJitter: 1, grain: 0.4, smoothing: 0.5 }, 0.75),
  d('droplets', 'Droplets', 'Water', 'splat', 0.2, 50, 10, 1, 0.6, 0.8, 0.5, { scatter: 0.8, rotationJitter: 1 }, 0.8),
  d('salt', 'Salt', 'Water', 'speckle', 0, 60, 8, 0.5, 1, 0.9, 1, { scatter: 0.8, rotationJitter: 1 }),
  d('ink-wash', 'Ink wash', 'Water', 'round', 0.6, 110, 22, 0.05, 0.5, 0.45, 0.3, { grain: 0.3, smoothing: 0.5, pickup: 0.5, render: 'light-glaze', wetEdges: 0.6 }, 0.85),
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

export const BRUSHES: Brush[] = RAW_BRUSHES.map((b) => migrateBrush(withMaterials(keepCorners({ ...b, set: classicName(b.set) }))));

export const DEFAULT_PAINT = 'studio-ink';
export const DEFAULT_SMUDGE = 'wet-blend';
export const DEFAULT_ERASE = 'round-paint';

/** Every starter brush: the Classic library, then the Animation library. */
export const ALL_STARTERS: Brush[] = [...BRUSHES, ...ANIMATION_BRUSHES.map((b) => migrateBrush(withMaterials(keepCorners(b))))];
const starterMap = new Map<string, Brush>(ALL_STARTERS.map((b) => [b.id, b]));

const registry = new Map<string, Brush>(ALL_STARTERS.map((b) => [b.id, b]));

export function brushById(id: string): Brush | undefined {
  return registry.get(id);
}

/** Puts a brush (a starter one with edits, or one the person made) into the lookup. */
export function registerBrush(b: Brush): void { registry.set(b.id, migrateBrush(b)); }

export function unregisterBrush(id: string): void { registry.delete(id); }

export function allBrushes(): Brush[] { return Array.from(registry.values()); }

/** The untouched starter brush of an id. */
export function starterBrush(id: string): Brush | undefined { return starterMap.get(id); }
