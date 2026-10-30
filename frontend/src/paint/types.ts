// Shared contract of the paint core (Phase 4). Pure data and signatures: no DOM.
// Pixels are straight-alpha RGBA8 in ImageData layout, so a Raster moves to and
// from a canvas with putImageData / getImageData and no conversion.

import type { BlendMode } from '../engine/types';

export interface RGB { r: number; g: number; b: number }

export interface Rect { x: number; y: number; w: number; h: number }

export interface Raster {
  width: number;
  height: number;
  /** width * height * 4 bytes, straight alpha. */
  data: Uint8ClampedArray;
}

/** A selection: one byte per pixel, 0 outside, 255 inside, soft in between. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Bytes of a rectangle before and after an edit; undo puts `before` back. */
export interface PixelPatch {
  layer: string;
  rect: Rect;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

export type PointerKind = 'pen' | 'touch' | 'mouse';

/** One input point in canvas pixels (the movie's coordinate space). */
export interface PenSample {
  x: number;
  y: number;
  /** 0 to 1; a mouse reports 0.5 while a button is down. */
  pressure: number;
  /** Degrees, -90 to 90, as PointerEvent.tiltX / tiltY. */
  tiltX: number;
  tiltY: number;
  /** Degrees 0 to 359 (barrel roll), 0 when not reported. */
  twist: number;
  /** ms, performance.now() timebase. */
  time: number;
  kind: PointerKind;
  /** True for a predicted point: drawn on the live preview only, never committed. */
  predicted?: boolean;
}

export type PaintTool = 'paint' | 'smudge' | 'erase';

export type TipShape = 'round' | 'square' | 'chisel' | 'grain-round' | 'speckle' | 'bristle' | 'chalk' | 'blob'
  | 'sponge' | 'ring' | 'hatch' | 'star' | 'leaf' | 'splat' | 'fibre' | 'dots' | 'cross' | 'grunge' | 'pixel' | 'comb' | 'blade'
  | 'sampled';

/** A picture-made dab or grain: 8-bit coverage, row-major. `key` names it for the tip cache. */
export interface TipImage { w: number; h: number; data: Uint8Array; key: string }

export interface Brush {
  id: string;
  name: string;
  /** Brush set it is listed in: Sketch, Ink, Paint, Chalk, Airbrush, Texture, Wash. */
  set: string;
  tip: TipShape;
  /** 0 hard edge to 1 fully soft (round tips). */
  softness: number;
  /** Largest diameter in canvas pixels at size 100%. */
  maxSize: number;
  /** Smallest diameter in canvas pixels at size 0%. */
  minSize: number;
  /** Dab spacing as a fraction of the dab diameter (0.02 to 1). */
  spacing: number;
  /** Per-dab alpha before the stroke opacity cap, 0 to 1. */
  flow: number;
  /** Pressure maps diameter from size * pressureSize[0] to size * pressureSize[1]. */
  pressureSize: [number, number];
  /** Pressure maps flow multiplier from pressureFlow[0] to pressureFlow[1]. */
  pressureFlow: [number, number];
  /** 0 to 1: how much pen tilt flattens and widens the dab (pencil shading). */
  tilt: number;
  /** 0 to 1: random dab offset as a fraction of the diameter. */
  scatter: number;
  /** 0 to 1: random dab rotation. */
  rotationJitter: number;
  /** Dab angle follows the stroke direction. */
  followStroke: boolean;
  /** 0 to 1: dab roundness (1 = circle, 0.2 = thin ellipse, chisel nibs). */
  roundness: number;
  /** 0 to 1: paper grain texture strength (stamped in canvas space, so it does not smear). */
  grain: number;
  /** 0 to 1: streamline smoothing applied by the input pipeline for this brush. */
  smoothing: number;
  /** Wet mixing for smudge: 0 to 1 how much colour is picked up per dab. */
  pickup: number;
  /** Remembered size and opacity (0 to 1) slots: the four values the sidebar recalls per brush. */
  presets: { size: number; opacity: number }[];
  /** Pixels of a `sampled` tip (imported brushes). */
  tipImage?: TipImage;
  /** A 256 x 256 grain tile of an imported brush; replaces the paper grain. */
  grainImage?: Uint8Array;
  /** Grain size multiplier, 0.25 to 4 (1 when absent). */
  grainScale?: number;
  /** 0 to 1: the stroke starts thin and thick up over its first stretch. */
  taper?: number;
  /** 0 to 1: the stroke thins out over a tail past the lift. Absent: the same as `taper`. */
  taperEnd?: number;
  /** Pressure response exponent, 0.4 (soft) to 2.5 (firm); 1 when absent. */
  pressureGamma?: number;
  /** Per-brush smoothing card, each 0 to 100; the input pipeline reads these. */
  stabilization?: number;
  /** A hard 1-pixel-grid stamp with no anti-alias, for pixel art; absent is off. */
  pixelPerfect?: boolean;
  motionFilter?: number;
  expression?: number;
  /** Made or imported by the person, not part of the starter library. */
  custom?: boolean;
  /** Library a starter brush belongs to; absent means Classic. */
  lib?: 'animation';
  /** Colour dynamics: jitter per stamp and per stroke (0 to 1), signed pressure and tilt shifts (-1 to 1). */
  colorDyn?: ColorDyn;
  /** Wet mix: the brush carries paint, dilutes it, and picks up what is already on the layer. */
  wet?: WetMix;
  /** How dabs build up inside one stroke; absent is the plain build-up. */
  render?: RenderMode;
  /** 0 to 1: paint pools at the edge of the stroke. */
  wetEdges?: number;
  /** 0 to 1: the paint runs out along the stroke (opacity fades with distance). */
  burnout?: number;
  /** 0 to 1: the stroke shrinks along its path. */
  fallOff?: number;
  /** -1 to 1: stamp size follows pen speed (negative: faster is smaller). */
  speedSize?: number;
  /** -1 to 1: stamp opacity follows pen speed. */
  speedOpacity?: number;
  /** 0 to 1: random size and opacity per stamp. */
  jitterSize?: number;
  jitterOpacity?: number;
  /** Stamps laid per dab (1 to 16), spread around the dab. */
  shapeCount?: number;
  /** The stamp turns with the direction the pen leans. */
  azimuth?: boolean;
  /** Fixed stamp rotation in radians. */
  baseRot?: number;
  /** 0 to 1: the line wanders sideways as it is drawn (boiling line). */
  wiggle?: number;
  /** Grain sticks to the stamp (moving) or to the canvas (texturized, the default). */
  grainMode?: 'moving' | 'texturized';
  /** 0 to 1: random grain depth per stamp. */
  grainJitter?: number;
  /** 0 to 1: grain is lit as relief (light and dark flecks). */
  bump?: number;
}

export interface ColorDyn {
  stampHue?: number; stampSat?: number; stampBri?: number;
  strokeHue?: number; strokeSat?: number; strokeBri?: number;
  pressureHue?: number; pressureSat?: number; pressureBri?: number;
  tiltHue?: number; tiltSat?: number; tiltBri?: number;
}

export interface WetMix { dilution: number; charge: number; attack: number; pull: number; grade: number }

export type RenderMode = 'light-glaze' | 'uniform-glaze' | 'intense-glaze' | 'heavy-glaze' | 'uniform-blending' | 'intense-blending';

export interface StrokeSettings {
  tool: PaintTool;
  brush: Brush;
  color: RGB;
  /** 0 to 1 slider value, mapped between brush.minSize and brush.maxSize. */
  size: number;
  /** 0 to 1 stroke opacity cap (the stroke never exceeds it, however many dabs overlap). */
  opacity: number;
  /** Paint only where the layer already has alpha. */
  alphaLock: boolean;
  /** Limit the stroke to the selection when given. */
  selection: Mask | null;
  /** Dab sizes scale with 1 / zoom when true (the Dynamic brush scaling preference). */
  zoom: number;
  dynamicScaling: boolean;
  /** Seed for scatter, rotation jitter and grain so a replay is identical. */
  seed: number;
  /** Barrel roll (pen twist) sets the stamp angle. */
  roll?: boolean;
}

/** A live stroke on one layer. `add` returns the changed rectangle (or null), `finish` the undo patch. */
export interface StrokeLike {
  add(sample: PenSample): Rect | null;
  finish(): PixelPatch | null;
  /** Throw the stroke away and restore the layer. */
  cancel(): Rect | null;
}

/** Layer state the paint view keeps while a Drawing (or one Flipbook frame) is open. */
export interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  alphaLock: boolean;
  clipping: boolean;
  /** Asset id the pixels came from; null for a new or changed layer until it is saved. */
  source: string | null;
  raster: Raster;
  /** Bumped on every pixel change; caches compare it. */
  version: number;
  /** A layer group: no pixels (the raster is a 1 px placeholder); the entries naming it as parent are its content. */
  group?: boolean;
  parent?: string | null;
  collapsed?: boolean;
  mask?: PaintMask | null;
  /** Asset id the mask pixels came from; null for a new or changed mask until it is saved. */
  maskSource?: string | null;
}

/** A layer mask: an opaque grey raster (255 reveals, 0 hides). Replace the object to change `on` or `linked`; never edit it. */
export interface PaintMask {
  raster: Raster;
  on: boolean;
  linked: boolean;
}

export type Interpolation = 'nearest' | 'bilinear' | 'bicubic';

export type SelectMode = 'automatic' | 'freehand' | 'rectangle' | 'ellipse';

export type CombineMode = 'replace' | 'add' | 'remove';

export type TransformMode = 'freeform' | 'uniform' | 'distort' | 'warp';

export interface Point { x: number; y: number }
