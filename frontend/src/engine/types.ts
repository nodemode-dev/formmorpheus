export const FORMAT_VERSION = 1;

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'add' | 'passthrough'
  | 'linear-burn' | 'darker-color' | 'lighter-color' | 'vivid-light' | 'linear-light' | 'pin-light' | 'hard-mix' | 'subtract' | 'divide';

export const BLEND_MODES: { id: BlendMode; label: string; short: string }[] = [
  { id: 'normal', label: 'Normal', short: 'N' },
  { id: 'darken', label: 'Darken', short: 'D' },
  { id: 'multiply', label: 'Multiply', short: 'M' },
  { id: 'color-burn', label: 'Color Burn', short: 'Cb' },
  { id: 'linear-burn', label: 'Linear Burn', short: 'Lb' },
  { id: 'darker-color', label: 'Darker Color', short: 'Dc' },
  { id: 'lighten', label: 'Lighten', short: 'L' },
  { id: 'screen', label: 'Screen', short: 'S' },
  { id: 'color-dodge', label: 'Color Dodge', short: 'Cd' },
  { id: 'add', label: 'Add', short: 'A' },
  { id: 'lighter-color', label: 'Lighter Color', short: 'Lc' },
  { id: 'overlay', label: 'Overlay', short: 'O' },
  { id: 'soft-light', label: 'Soft Light', short: 'Sl' },
  { id: 'hard-light', label: 'Hard Light', short: 'Hl' },
  { id: 'vivid-light', label: 'Vivid Light', short: 'Vl' },
  { id: 'linear-light', label: 'Linear Light', short: 'Ll' },
  { id: 'pin-light', label: 'Pin Light', short: 'Pl' },
  { id: 'hard-mix', label: 'Hard Mix', short: 'Hm' },
  { id: 'difference', label: 'Difference', short: 'Di' },
  { id: 'exclusion', label: 'Exclusion', short: 'E' },
  { id: 'subtract', label: 'Subtract', short: 'Sb' },
  { id: 'divide', label: 'Divide', short: 'Dv' },
  { id: 'hue', label: 'Hue', short: 'H' },
  { id: 'saturation', label: 'Saturation', short: 'Sa' },
  { id: 'color', label: 'Color', short: 'C' },
  { id: 'luminosity', label: 'Luminosity', short: 'Lu' },
  { id: 'passthrough', label: 'Passthrough', short: 'P' },
];

export type MaskMode = 'none' | 'clipping' | 'alpha' | 'luminance';

export type ContentKind = 'drawing' | 'flipbook' | 'image' | 'video' | 'audio' | 'text' | 'group';

export type Mode = 'compose' | 'perform' | 'keyframe';

export type PlaybackMode = 'loop' | 'pingpong' | 'oneshot';

export const HIGHLIGHTS = ['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type Highlight = (typeof HIGHLIGHTS)[number];

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** One-axis stretch from a Stage side node, multiplying `scale` along that axis (1 when absent). */
  stretchX?: number;
  stretchY?: number;
}

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  alphaLock: boolean;
  clipping: boolean;
  pixels: string | null;
  /** True for a layer group: no pixels of its own, the layers that name it as `parent` form its content. */
  group?: boolean;
  /** Id of the group this entry sits in; absent at the top. A group's descendants follow it in the list. */
  parent?: string | null;
  /** Group shown folded in the Layers panel. */
  collapsed?: boolean;
  /** Asset id of the greyscale mask PNG (white reveals, black hides); absent when there is no mask. */
  mask?: string | null;
  /** Mask is applied; false keeps it but shows the layer whole. */
  maskOn?: boolean;
  /** Mask moves with the layer when it is transformed (kept for the file; the paint view always edits it in place). */
  maskLinked?: boolean;
}

export interface FlipbookFrame {
  id: string;
  hold: number;
  layers: DrawingLayer[];
  /** Label of the frame (a mouth shape's name); absent unless set. */
  name?: string;
}

/** One row of a Flipbook: its frames play in order, each for `hold` movie frames, and loop. */
export interface FlipTrack {
  id: string;
  name: string;
  hidden: boolean;
  opacity: number;
  blend: BlendMode;
  highlight: Highlight;
  frames: FlipbookFrame[];
  /** A masking row is not drawn: it cuts the row below it (alpha or luminance). Absent in older files. */
  mask?: FlipMask;
  maskInvert?: boolean;
}

export type FlipMask = 'none' | 'clipping' | 'alpha' | 'luminance';

/** Easing of the span that leaves a key; 'hold' keeps the value until the next key. */
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'hold' | 'custom';

/** A Bezier handle of a span as a point in the span's unit square: x is the time fraction (0..1), y the value fraction (may leave 0..1 to overshoot). */
export type EaseHandle = [number, number];

export const EASES: { id: Ease; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'in', label: 'Ease in' },
  { id: 'out', label: 'Ease out' },
  { id: 'inout', label: 'Ease in & out' },
  { id: 'hold', label: 'Hold' },
];

/** A key at a frame local to its content (0 is the content's first frame). */
export interface Key {
  frame: number;
  value: number;
  ease: Ease;
  /** Only with ease 'custom': the Bezier handles of the span that leaves this key (leaving handle `out`, arriving handle `in`). */
  out?: EaseHandle;
  in?: EaseHandle;
  /** Move keys only (on the x channel): the curve of the motion path through this key. */
  sp?: SpatialTangents;
}

/**
 * Spatial tangents of a Move key, stored on its x channel key (the y key of the same frame takes part in the path).
 * `in` / `out` are offsets from the key's position in px; absent means automatic. `corner`: the handles move alone
 * (smooth keeps them in line); `linear`: straight path on both sides of this key.
 */
export interface SpatialTangents {
  in: [number, number];
  out: [number, number];
  corner?: boolean;
  linear?: boolean;
}

export type KeyKind = 'camera' | 'move' | 'warp' | 'distort' | 'bones' | 'opacity' | 'blur' | 'sharpen' | 'noise' | 'hsb' | 'lensblur' | 'boil' | 'volume';

/** One lane under a content: a set of channels keyed together (Move & Scale has x, y, scaleX, scaleY, rotation). */
export interface KeyLane {
  kind: KeyKind;
  expanded: boolean;
  channels: Record<string, Key[]>;
  /** Settings of the lane that are not animated (the Noise style, Additive, Multichannel). */
  options: Record<string, string | number | boolean>;
}

export interface TextStyle {
  text: string;
  font: string;
  size: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
}

/** A bone at rest, in content pixels: `x`, `y` is its head, `angle` (degrees) points to its tip at `length`. */
export interface Bone {
  id: string;
  parent?: string;
  x: number;
  y: number;
  length: number;
  angle: number;
}

/** A bone chain (or tree) on a picture or drawing; a 'bones' lane keys one rotation channel per bone id. */
export interface Rig {
  bones: Bone[];
  /** Cell size of the skin mesh in pixels (default 24). */
  mesh?: number;
}

export interface Content {
  id: string;
  kind: ContentKind;
  name: string;
  start: number;
  duration: number;
  offset: number;
  opacity: number;
  blend: BlendMode;
  mask: MaskMode;
  maskInvert: boolean;
  highlight: Highlight;
  transform: Transform;
  asset: string | null;
  layers: DrawingLayer[];
  flip: FlipTrack[];
  onion: OnionSettings | null;
  keys: KeyLane[];
  text: TextStyle | null;
  tracks: Track[];
  volume: number;
  /** Pivot (anchor) that rotation and scale turn around: an offset in px from the movie centre, which is also a picture's centre. Absent: the centre. Keyed by the Move lane's px / py channels. */
  pivot?: { x: number; y: number };
  /** Bones skinned onto this content; absent when unused. Applied before Warp / Distort. */
  rig?: Rig;
  /** Id of the content this one follows: its transform is applied inside the parent's. Absent: none. */
  parent?: string;
}

export interface Track {
  id: string;
  name: string;
  hidden: boolean;
  /** Fixed to the screen: the movie camera does not move this track (titles, overlays). */
  screen?: true;
  content: Content[];
}

export interface Asset {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'pixels' | 'font';
  name: string;
  mime: string;
  width: number;
  height: number;
  frames: number;
  size: number;
  /** Video and sound: length in seconds (movie frames follow from the movie's frame rate). */
  seconds?: number;
  /** Video: whether the file carries sound (so it can be separated into an audio block). */
  hasAudio?: boolean;
  /** Fonts: the family name registered for Text content. */
  family?: string;
}

export interface OnionSettings {
  enabled: boolean;
  /** Ghost frames shown before and after the current frame; 0 turns that side off. */
  backFrames: number;
  foreFrames: number;
  opacity: number;
  tint: boolean;
  backColor: string;
  foreColor: string;
  blendPrimary: boolean;
}

export interface Movie {
  format: number;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: string;
  transparent: boolean;
  playback: PlaybackMode;
  addKeyAtStart: boolean;
  /** Playback loops only the part of the movie the Timeline shows. Absent in older files. */
  loopVisible?: boolean;
  /** How visible content outside the Stage is on the Stage view, 0 to 1. Absent: the default (0.2). */
  backstage?: number;
  /** The Stage shows its Timecode. Absent: it does. */
  timecode?: boolean;
  /** The movie camera: one 'camera' lane (panX, panY, zoom, rotation) keyed in movie frames. Absent: none. */
  camera?: { keys: KeyLane[] };
  onion: OnionSettings;
  tracks: Track[];
  assets: Record<string, Asset>;
}

export interface Selection {
  content: string[];
  track: string | null;
}

export interface MoviePreset {
  id: string;
  label: string;
  aspect: [number, number];
  sizes: [number, number][];
}

export const MOVIE_PRESETS: MoviePreset[] = [
  { id: 'wide', label: 'Wide screen', aspect: [16, 9], sizes: [[3840, 2160], [2560, 1440], [1920, 1080], [1280, 720]] },
  { id: 'ultrawide', label: 'Ultrawide', aspect: [21, 9], sizes: [[3840, 1646], [2560, 1097], [1920, 823], [1280, 549]] },
  { id: 'social', label: 'Social', aspect: [9, 16], sizes: [[2160, 3840], [1440, 2560], [1080, 1920], [720, 1280]] },
  { id: 'square', label: 'Square', aspect: [1, 1], sizes: [[3840, 3840], [2160, 2160], [1080, 1080], [720, 720]] },
];

export const MAX_SIDE = 3840;
