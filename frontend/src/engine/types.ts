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
}

export interface FlipbookFrame {
  id: string;
  hold: number;
  layers: DrawingLayer[];
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
  frames: FlipbookFrame[];
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
  kind: 'image' | 'video' | 'audio' | 'pixels';
  name: string;
  mime: string;
  width: number;
  height: number;
  frames: number;
  size: number;
}

export interface OnionSettings {
  enabled: boolean;
  backwards: boolean;
  forwards: boolean;
  frames: number;
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
