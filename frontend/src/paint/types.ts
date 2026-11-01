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
  /** 0 to 1: Scatter, a random turn of every stamp whatever way the stroke runs (1 is any angle). Before `ver` 2 this field was the
   *  random sideways offset of the stamp; `scatterPos` now holds that (paint/brush-migrate.ts converts older brushes). */
  scatter: number;
  /** Legacy alias of `scatter`: the larger of the two turns the stamp. Brushes of `ver` 2 keep it at 0. */
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
  /** Bristle bundle (paint/bristle.ts): hairs that each lay a streak and carry paint. count 0 = by size; lenVar, tone, clump 0 to 1. */
  bristle?: { count: number; lenVar: number; tone: number; clump: number };
  /** Grain sticks to the stamp (moving) or to the canvas (texturized, the default). */
  grainMode?: 'moving' | 'texturized';
  /** 0 to 1: random grain depth per stamp. */
  grainJitter?: number;
  /** 0 to 1: grain is lit as relief (light and dark flecks). */
  bump?: number;
  /** Material: depth (a raised ridge), gloss (a glint) and metal (a tinted sheen), lit from `light` degrees. */
  shine?: Shine;

  // ---- Authored library (paint/tips-lib.ts, grains-lib.ts) ----
  /** A library stamp by id; replaces `tip` while set. */
  tipId?: string;
  /** A library grain by id; the paper grain is used while absent. */
  grainId?: string;
  /** 0 to 1: moving grain only. 0 drags with the stroke and smears, 1 renews at every stamp like a roller. */
  grainMovement?: number;
  /** 0 to 1: the floor the grain never cuts below (less contrast). */
  grainDepthMin?: number;
  /** Raised and pitted parts of the grain swap places. */
  grainInvert?: boolean;
  /** Tiles the grain this many times across its square (1 to 8); every repeat is seamless. */
  grainRepeat?: number;
  /** Blends the grain's edges so a picture repeats without a seam. */
  grainSeamless?: boolean;
  /** Sizes are fixed canvas pixels; absent means they scale with the canvas's long side (1920 px = 100%). */
  sizeAbs?: boolean;

  // ---- Brush Studio fields (all optional; written only when not default) ----
  /** 0 to 1: each stamp slides sideways off the path (stroke path jitter). */
  pathJitter?: number;
  /** 0 to 1: pressure is low-pass filtered before it drives the stamp. */
  pressureSmooth?: number;
  /** Taper lengths used when the input is a pen (0 to 1); touch and mouse use `taper` / `taperEnd`. */
  pTaper?: number;
  pTaperEnd?: number;
  /** 0 to 1: size at the very end of a taper as a share of the full size (absent: about 0.1). */
  taperSize?: number;
  /** 0 to 1: opacity lost at the very end of a taper. */
  taperOpacity?: number;
  /** 0 to 1: how pointed the taper tip is (0 blunt, 1 needle). */
  taperTip?: number;
  /** Mirror the stamp across its own axes. */
  flipX?: boolean;
  flipY?: boolean;
  /** Stamp picture sampled without smoothing (crisp edges). */
  tipSharp?: boolean;
  /** 0 to 1: grain scales with the stamp size (0: fixed on the canvas). */
  grainZoom?: number;
  /** Grain turn in radians. */
  grainRot?: number;
  /** 0 to 1: random grain offset per stamp. */
  grainOffsetJitter?: number;
  /** How grain cuts into the stamp; absent is multiply. */
  grainBlend?: GrainBlend;
  /** -1 to 1 and -1 to 1: grain brightness and contrast. */
  grainBright?: number;
  grainContrast?: number;
  /** 0 to 1: the edge of the stroke darkens. */
  burntEdges?: number;
  /** How the stroke lands on the layer; absent is normal. */
  blend?: BlendMode;
  /** 0 to 1: light colors glow over what is under them. */
  lumBlend?: number;
  /** 0 to 1: pressure widens the soft edge. */
  pressureBleed?: number;
  /** 0 to 1: opacity ramps up with pressure (the lowest share it starts from is 1 minus this). */
  pressureOpacity?: number;
  /** Degrees (0 to 80): the pen must lean past this angle before tilt reshapes the stamp. */
  tiltAngle?: number;
  /** -1 to 1: tilt lightens (negative) or deepens the stamp. */
  tiltOpacity?: number;
  /** 0 to 1: leaning builds grain (shading gradation). */
  tiltGradation?: number;
  /** 0 to 1: leaning softens the edge. */
  tiltBleed?: number;
  /** -1 to 1: leaning shrinks (negative) or grows the stamp. */
  tiltSize?: number;
  /** Size compression: a leaning pen's wider mark is laid with the stamp at its own size, side by side, so the tip's texture does not stretch. */
  tiltCompress?: boolean;
  /** The stamp rotation stays put on screen while the canvas is turned. */
  orientScreen?: boolean;
  /** 0.2 to 1: size of the sample stroke in the brush list, as a share of the row. */
  previewSize?: number;
  /** Bounds of the opacity slider for this brush (0 to 1); absent is 0 and 1. */
  minOpacity?: number;
  maxOpacity?: number;
  /** About this brush. */
  author?: string;
  /** ms since 1970. */
  created?: number;
  /** A small PNG data URL of a hand signature. */
  signature?: string;

  // ---- pen response and shape dynamics (optional; written only when not default) ----
  /** Per-channel pressure curves and response speeds (see paint/curves.ts). */
  curves?: PenCurves;
  /** -1 to 1: barrel roll (pen twist) scales the size, the opacity and the edge softness. */
  rollSize?: number;
  rollOpacity?: number;
  rollBleed?: number;
  /** Barrel roll is measured against the stroke direction instead of the page. */
  rollRelative?: boolean;
  /** -1 to 1: pressure squashes the stamp (positive: light pressure is flatter). */
  pressureRoundness?: number;
  /** -1 to 1: leaning squashes the stamp. */
  tiltRoundness?: number;
  /** 0 to 1: random squash along the horizontal or the vertical axis per stamp. */
  roundJitterH?: number;
  roundJitterV?: number;
  /** 0 to 1: random number of stamps per dab. */
  countJitter?: number;
  /** 0 to 1: random gap between stamps. */
  spacingJitter?: number;
  /** 0 to 1: stamps slide forward and back along the stroke. */
  jitterLinear?: number;
  /** -1 to 1: the gap between stamps grows (positive) or shrinks with pen speed. */
  speedSpacing?: number;
  /** The cursor over the canvas for this brush: its own tip shape, a plain circle, or none. Unset: the global outline style. */
  cursor?: 'tip' | 'circle' | 'none';
  /** Brush Studio only (the stroke engine ignores these): the library row and the thumbnail show one stamp instead of a stroke. */
  stampPreview?: boolean;
  /** Brush Studio only: the start and end taper tips are edited together. */
  taperLink?: boolean;
  /** Brush Studio only: the settings (without pictures) saved by "Create reset point"; Reset brush returns to them. */
  resetPoint?: Record<string, unknown>;

  // ---- engine fields added with the Scatter change (all optional) ----
  /** 2 once the brush uses Scatter as a turn (see `scatter`); absent or 1 is the old meaning and is converted when the brush is registered. */
  ver?: number;
  /** 0 to 3: random offset of each stamp in any direction, as a share of the diameter (what `scatter` used to be). */
  scatterPos?: number;
  /** -1 to 1: how far the stamp's turn follows the stroke (1 follows, 0 is fixed, -1 turns against it). Absent: 1 when `followStroke`, else 0. */
  rotFollow?: number;
  /** -1 to 1: the same for the moving grain, which turns with the stroke's direction. */
  grainRotFollow?: number;
  /** How the edge darkening of Burnt Edges blends; absent is the plain multiply. */
  burntMode?: BlendMode;
  /** 0 to 1: a stamp pixel at least this strong becomes fully solid, the rest clear (no soft edge). Absent: off. */
  alphaThreshold?: number;
  /** How the stamp picture is sampled: none (crisp), classic (bilinear), improved (bicubic). Absent: classic, or none while `tipSharp`. */
  tipFilter?: 'none' | 'classic' | 'improved';
}

/** One pressure curve: flat x,y pairs from (0,y0) to (1,y1) with at most four nodes between; `speed` 0 (slow) to 1 (instant) is the response speed. */
export interface PenCurve { pts: number[]; speed?: number }

export interface PenCurves { size?: PenCurve; opacity?: PenCurve; flow?: PenCurve; bleed?: PenCurve; roundness?: PenCurve; tilt?: PenCurve }

/** How grain cuts into the stamp: the three first ones as before, any other blend mode acts on the stamp's alpha by the grain. */
export type GrainBlend = 'multiply' | 'subtract' | 'screen' | BlendMode;

/** Material of a stroke, all 0 to 1; `light` is the angle the light comes from in degrees (0 right, 90 above, 135 upper left). */
export interface Shine { depth: number; gloss: number; metal: number; light?: number }

export interface ColorDyn {
  stampHue?: number; stampSat?: number; stampBri?: number;
  strokeHue?: number; strokeSat?: number; strokeBri?: number;
  /** 0 to 1: how far each stamp (or the whole stroke) leans toward the secondary color. */
  stampSecondary?: number; strokeSecondary?: number;
  pressureHue?: number; pressureSat?: number; pressureBri?: number;
  tiltHue?: number; tiltSat?: number; tiltBri?: number;
}

export interface WetMix {
  dilution: number; charge: number; attack: number; pull: number; grade: number;
  /** 0 to 1: how wide the picked-up color is averaged. */
  blur?: number;
  /** 0 to 1: random blur width per stamp. */
  blurJitter?: number;
  /** 0 to 1: random wetness per stamp. */
  wetJitter?: number;
}

export type RenderMode = 'light-glaze' | 'uniform-glaze' | 'intense-glaze' | 'heavy-glaze' | 'uniform-blending' | 'intense-blending' | 'heavy-blending';

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
  /** The second color, for brushes that lean toward it. */
  color2?: RGB;
  /** Canvas rotation in radians, for brushes that stay oriented to the screen. */
  viewRot?: number;
  /** The long side brush sizes scale with (default: the raster's); previews pass 1920 to keep their sizes plain. */
  sizeRef?: number;
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
