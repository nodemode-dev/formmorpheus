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

export type ContentKind = 'drawing' | 'flipbook' | 'image' | 'video' | 'audio' | 'text' | 'group' | 'shape' | 'solid' | 'adjust';

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
  /** A note for this drawing, shown in the exposure sheet's notes column; absent unless set. */
  note?: string;
}

/** A picture or video shown under the drawing area while drawing a Flipbook. Never drawn on the Stage or exported. */
export interface FlipUnderlay {
  asset: string;
  /** Shown while drawing (false keeps the settings but hides it). */
  visible: boolean;
  opacity: number;
  /** Offset from the centre of the canvas in canvas pixels, and a scale on top of the fit-to-canvas size. */
  x: number;
  y: number;
  scale: number;
  /** Frames added to the Flipbook's time before the underlay is read (its own time offset). */
  offset: number;
  /** Light table: the paper is lit and the underlay shows through it (multiplied). */
  table?: boolean;
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
  /** Shoot on: how many movie frames a new frame of this row is held (2 is twos). Absent: ones. */
  shoot?: number;
}

export type FlipMask = 'none' | 'clipping' | 'alpha' | 'luminance';

/** Easing of the span that leaves a key; 'hold' keeps the value until the next key. */
export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'hold' | 'custom' | 'bounce' | 'elastic' | 'overshoot';

/** A Bezier handle of a span as a point in the span's unit square: x is the time fraction (0..1), y the value fraction (may leave 0..1 to overshoot). */
export type EaseHandle = [number, number];

export const EASES: { id: Ease; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  // The stored ids keep their playback ('out' leaves slowly and speeds up, 'in' arrives slowly), so old files play unchanged;
  // the labels follow what the curve does: Ease in starts slowly and accelerates, Ease out starts fast and slows into the next key.
  { id: 'out', label: 'Ease in' },
  { id: 'in', label: 'Ease out' },
  { id: 'inout', label: 'Ease in & out' },
  { id: 'hold', label: 'Hold' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'elastic', label: 'Elastic' },
  { id: 'overshoot', label: 'Overshoot' },
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

export type KeyKind = 'camera' | 'move' | 'warp' | 'distort' | 'bones' | 'opacity' | 'blur' | 'sharpen' | 'noise' | 'hsb' | 'lensblur' | 'boil' | 'volume' | 'shape' | 'textanim' | 'time' | `fx:${string}`;

/** One lane under a content: a set of channels keyed together (Move & Scale has x, y, scaleX, scaleY, rotation). */
export interface KeyLane {
  kind: KeyKind;
  expanded: boolean;
  channels: Record<string, Key[]>;
  /** Settings of the lane that are not animated (the Noise style, Additive, Multichannel). */
  options: Record<string, string | number | boolean>;
}

export interface TextStyle {
  /** The title preset last applied (its id), so the Preset select can name it. Absent: none. */
  preset?: string;
  text: string;
  font: string;
  size: number;
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right' | 'justify';
  /** Format fields; each is written only when set (a movie without them draws as before). */
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  caps?: 'upper' | 'lower' | 'small';
  /** Outline drawn around the letters (colour, width in movie pixels). */
  stroke?: { color: string; width: number };
  /** Letter spacing in thousandths of an em. */
  tracking?: number;
  /** Pair kerning: the font's own (default), none, or optical (measured from the letter shapes). */
  kerning?: 'none' | 'optical';
  /** Line height as a multiple of the size (default 1.2). */
  leading?: number;
  /** Baseline shift in movie pixels (positive raises the text). */
  baseline?: number;
  /** Upright letters stacked in columns that run right to left. */
  vertical?: boolean;
  /** Wrap width in movie pixels; unset, the text is one block as wide as its longest line. */
  boxW?: number;
  /** Rich titles (engine/text-rich.ts): styled spans, drop shadow, background box, build on / off animators. Each is written only when used. */
  runs?: import('./text-rich').TextRun[];
  shadow?: import('./text-rich').TextShadow;
  box?: import('./text-rich').TextBoxFx;
  anim?: import('./text-rich').TextAnim;
  /** Gradient fill: the letters run from `color` to this color along `angle` (degrees, 0 left to right, 90 top to bottom) across the block. Spans with their own color keep it. */
  fillTo?: { color: string; angle: number };
  /** A soft light around the letters (color, reach in movie pixels, strength 0 to 3). Drawn behind the letters and the drop shadow. */
  glow?: { color: string; radius: number; intensity: number };
  /** Text set along a curve; written only when used. */
  path?: import('./text-rich').TextPath;
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
  /** Lanes of a kind this build does not know (a newer file): kept out of `keys`, written back on save, restored on load once the kind exists. */
  unknownLanes?: KeyLane[];
  /** Drawing and Flipbook only: the canvas its pictures cover, in movie pixels from the movie's top-left (may reach past the Stage). Absent: the movie rectangle. A Flipbook's frames all share it. */
  canvas?: CanvasRect;
  /** Sound blocks only: fade in and fade out lengths in movie frames (absent: none), and the stereo position -1..1 (absent: centre). */
  fadeIn?: number;
  fadeOut?: number;
  pan?: number;
  /** Sound and video blocks: audio effects on this block's sound (engine/audio-fx.ts). Absent: none. */
  fx?: import('./audio-fx').AudioFx;
  /** Retime (engine/retime.ts): playback speed 0.25 to 4 (0 freezes on `offset`), played backward when `reverse`. Absent: normal. */
  speed?: number;
  reverse?: boolean;
  /** Sound: the pitch follows the speed instead of being kept. */
  speedPitch?: boolean;
  /** Transition into this block from the block that touches its start on the same track (engine/transitions.ts). */
  transition?: Transition;
  /** Hidden by itself (Alt-click on its name chip's box): not drawn on the Stage or in an export, its track stays. Absent: shown. */
  hidden?: true;
  /** Flipbook only: a reference picture or video under the drawing area (never exported). */
  underlay?: FlipUnderlay;
  /** Shape and Solid: the outline, fill and stroke. Adjustment: an optional mask outline (engine/shape.ts). Absent on other kinds. */
  shape?: import('./shape-types').ShapeDef;
  /** Group only: this group is a character (engine/character-ops.ts). Absent: a plain group. */
  character?: CharacterInfo;
}

/** A character: a Group whose inner contents are named parts. `parts` maps a part name to its inner content id. */
export interface CharacterInfo {
  name: string;
  parts: Record<string, string>;
  /** Id of the inner Flipbook that is the mouth chart (lip-sync target). Absent: none. */
  mouth?: string;
  /** The character's own actions (engine/action-ops.ts). A file saved without them reads as none. */
  actions: ActionDef[];
  /** Where actions sit on the character's block. Absent: none. */
  acts?: ActSpan[];
  /** The SVG file the character was made from, when it was opened from a real path (desktop). Absent: no link. */
  source?: SourceLink;
  /** Part names the last Update from Source did not find in the file (kept, with the hint "Not in the source file"). Absent: none. */
  missing?: string[];
  /** Of those parts, the person's own highlight each had before it was marked red; put back when the part returns. */
  missingWas?: Record<string, Highlight>;
  /** A character made in the character builder keeps its recipe, so it can be opened there again. Absent: drawn elsewhere. */
  build?: import('./cast/spec').CastSpec;
  /** Parts a rebuild hid because the recipe no longer draws them; a later rebuild that draws one shows it again. Absent: none. */
  builtHidden?: string[];
}

/** A linked source file as the engine's stat route last saw it (bytes, seconds since the epoch, hex digest). */
export interface SourceLink {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}

/**
 * A named, reusable motion over part names. Key frames count from 0. Move values are relative to each part's rest:
 * x, y, rotation, px and py are added to it, scaleX and scaleY multiply it; bone channels apply only to a part whose rig has that bone.
 */
export interface ActionDef {
  id: string;
  name: string;
  /** Frames of one pass (a loop's last key, at `length`, equals its first). */
  length: number;
  loop: boolean;
  lanes: { part: string; keys: KeyLane[] }[];
  /** The frame rate its frames count at; applied to a movie at another rate the keys are spaced to keep its speed. Absent: the movie's. */
  fps?: number;
  /** Mouth shapes for a part named mouth that is a mouth chart: each holds from its frame to the next. Absent: the mouth is left alone. */
  mouth?: { frame: number; shape: import('../media/lipsync').Viseme }[];
  /** A loop only: frames over which a placed span eases in from the rest pose at its start and back to rest at its end. */
  blend?: number;
}

/** The longest action a file or a movie may carry, in frames (ten minutes at 24 fps). */
export const ACTION_MAX_FRAMES = 24 * 60 * 10;

/** An action placed on a character: `from` and `to` (inclusive) count the frames the character's own tracks see. */
export interface ActSpan {
  action: string;
  from: number;
  to: number;
  /** Where the action's first pass began, when that is before `from` (a span cut from the left by another). */
  start?: number;
  /** A starter placed in its character builder version. Absent: the starter as it is for any character (spans saved before 0.31.0). */
  rig?: true;
  /** The frames (from inclusive, to exclusive) where it put shapes in the mouth chart; only those go back to Rest. Absent on an action with mouth shapes: placed before 0.31.0, every frame showing its shape does. */
  said?: Array<[number, number]>;
}

export type TransitionKind = 'crossfade' | 'dip' | 'wipe' | 'push';

/** Centred on the cut: half of `duration` before it, half after; the outgoing block holds its last frame and the incoming its first. */
export interface Transition {
  kind: TransitionKind;
  /** Frames, at least 2. */
  duration: number;
  /** Dip: the colour dipped through (default black). */
  color?: string;
  /** Wipe and push: the way the new picture travels (default left to right). */
  dir?: 'l' | 'r' | 'u' | 'd';
}

export interface Marker {
  id: string;
  frame: number;
  name: string;
  /** One of the Highlight colour names, or absent for the default. */
  color?: string;
}

/** Hand-held camera shake: amplitude in movie pixels, frequency in shakes per second, a seed for the pattern. */
export interface CameraShake { amp: number; freq: number; seed: number }

/** The camera follows a content: it pans by `amount` (0 to 1) of the content's own move, so 1 keeps the content centred on the frame. */
export interface CameraFollow { id: string; amount: number }

export interface CanvasRect { x: number; y: number; w: number; h: number }

export interface Track {
  id: string;
  name: string;
  hidden: boolean;
  /** Locked: its content cannot be selected, moved, trimmed, split, pasted onto or deleted. It still plays and renders. */
  locked?: true;
  /** Fixed to the screen: the movie camera does not move this track (titles, overlays). */
  screen?: true;
  /** Parallax depth: how far the camera's pan and zoom move this track (1 or absent: normally, 0: not at all, 2: twice as far). */
  depth?: number;
  /** Sound only: the track's sound is silenced (mute) or alone heard (solo, when any track has it). Absent: off. */
  mute?: true;
  solo?: true;
  /** Audio effects on the sum of this track's sound, and ducking under another track (engine/audio-fx.ts). Absent: none. */
  fx?: import('./audio-fx').AudioFx;
  duck?: import('./audio-fx').Duck;
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
  /** Sound recorded in the app (a voice-over take): stored as 16-bit PCM WAV; `take` groups the takes made from one start frame. */
  recorded?: { take: number; start: number };
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
  /** Per-direction overrides of `opacity` and `tint`; absent: the shared value. */
  backOpacity?: number;
  foreOpacity?: number;
  backTint?: boolean;
  foreTint?: boolean;
  /** Ghosts stay visible while the frame strip is scrubbed. Absent: they do. */
  showWhileScrubbing?: boolean;
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
  /** An explicit loop range (first and last frame, inclusive); playback stays inside it. Written only once set. */
  loopFrom?: number;
  loopTo?: number;
  /** How visible content outside the Stage is on the Stage view, 0 to 1. Absent: the default (0.2). */
  backstage?: number;
  /** The Stage shows its Timecode. Absent: it does. */
  timecode?: boolean;
  /** Who made the movie (Movie settings, About this artwork). Absent: not set. */
  author?: string;
  /** The artist's own picture for the movie (a small square data URL, Movie settings > Project). Absent: the Stage frame is shown. */
  authorPicture?: string;
  /** The movie camera: one 'camera' lane (panX, panY, zoom, rotation) keyed in movie frames. Absent: none. */
  camera?: { keys: KeyLane[]; unknownLanes?: KeyLane[]; shake?: CameraShake; follow?: CameraFollow };
  /** Named cue points on the ruler. Absent: none. */
  markers?: Marker[];
  /** Stage guides: grid, thirds, safe areas, guide lines (engine/guides.ts). A drawing aid, never exported. Absent: none. */
  guides?: import('./guides').Guides;
  /** Movie-wide motion blur (engine/fx/motion-blur.ts); a content's own Motion Blur lane overrides it. Absent: off. */
  motionBlur?: { on: boolean; shutter: number; samples: number };
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
