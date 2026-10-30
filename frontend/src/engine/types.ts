export const FORMAT_VERSION = 1;

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'add' | 'passthrough';

export const BLEND_MODES: { id: BlendMode; label: string; short: string }[] = [
  { id: 'normal', label: 'Normal', short: 'N' },
  { id: 'multiply', label: 'Multiply', short: 'M' },
  { id: 'darken', label: 'Darken', short: 'D' },
  { id: 'color-burn', label: 'Color Burn', short: 'Cb' },
  { id: 'screen', label: 'Screen', short: 'S' },
  { id: 'lighten', label: 'Lighten', short: 'L' },
  { id: 'color-dodge', label: 'Color Dodge', short: 'Cd' },
  { id: 'add', label: 'Add', short: 'A' },
  { id: 'overlay', label: 'Overlay', short: 'O' },
  { id: 'soft-light', label: 'Soft Light', short: 'Sl' },
  { id: 'hard-light', label: 'Hard Light', short: 'Hl' },
  { id: 'difference', label: 'Difference', short: 'Di' },
  { id: 'exclusion', label: 'Exclusion', short: 'E' },
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

export type FlipMask = 'none' | 'alpha' | 'luminance';

/** Easing of the span that leaves a key; 'hold' keeps the value until the next key. */
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'hold';

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
}

export type KeyKind = 'move' | 'warp' | 'distort' | 'opacity' | 'blur' | 'sharpen' | 'noise' | 'hsb' | 'lensblur' | 'volume';

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
}

export interface Track {
  id: string;
  name: string;
  hidden: boolean;
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
