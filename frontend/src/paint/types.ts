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

export type TipShape = 'round' | 'square' | 'chisel' | 'grain-round' | 'speckle' | 'bristle' | 'chalk' | 'blob';

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
}

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
