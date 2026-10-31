// Keyframe model: channel specs, temporal Bezier evaluation, and per-frame animation of a content.
// Ported from the temporal ease maths of the owner's formvfx key model (speed and influence per side,
// Newton then bisection for x(t)). Pure, no DOM.
import type { Content, Ease, Key, KeyKind, KeyLane } from './types';
import { boilSeed } from '../paint/boil';
import { pathAt, type Pt } from './path';
import { DISTORT_IDS, WARP_DEFAULT, WARP_MAX, WARP_MIN, warpId } from './warp-draw';

export interface ChannelSpec {
  id: string;
  label: string;
  short: string;
  min: number;
  max: number;
  step: number;
  unit: '%' | 'px' | 'deg' | 'x' | '';
  /** Multiply the stored value by this for display (100 for percent). */
  display: number;
  def: number;
}

export interface KindSpec {
  kind: KeyKind;
  label: string;
  group: 'motion' | 'filter' | 'audio' | 'camera';
  icon: string;
  channels: ChannelSpec[];
  options?: { id: string; label: string; choices?: string[]; def: string | number | boolean }[];
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS: Record<KeyKind, string> = {
  camera: svg('<path d="M3.5 8.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 16v-6a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M16 11.5l5.5-3v7l-5.5-3"/>'),
  move: svg(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M12 7.5v9M7.5 12h9M12 7.5l-1.6 1.7M12 7.5l1.6 1.7M12 16.5l-1.6-1.7M12 16.5l1.6-1.7M7.5 12l1.7-1.6M7.5 12l1.7 1.6M16.5 12l-1.7-1.6M16.5 12l-1.7 1.6"/>',
  ),
  warp: svg('<path d="M3.5 7c3-2.6 5.5 2.6 8.5 0s5.5 2.6 8.5 0M3.5 12c3-2.6 5.5 2.6 8.5 0s5.5 2.6 8.5 0M3.5 17c3-2.6 5.5 2.6 8.5 0s5.5 2.6 8.5 0"/><path d="M7 4.5v15M12 4.5v15M17 4.5v15" opacity=".45"/>'),
  distort: svg('<path d="M5 6.5l14-2v15l-14-2z"/><circle cx="5" cy="6.5" r="1.4" fill="currentColor"/><circle cx="19" cy="4.5" r="1.4" fill="currentColor"/><circle cx="19" cy="19.5" r="1.4" fill="currentColor"/><circle cx="5" cy="17.5" r="1.4" fill="currentColor"/>'),
  bones: svg('<circle cx="6.5" cy="17.5" r="2.2"/><circle cx="12" cy="9.5" r="2.2"/><circle cx="18" cy="5.5" r="1.6" fill="currentColor"/><path d="M8 15.6l2.6-4.2M13.9 8.6l2.7-2"/>'),
  opacity: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'),
  blur: svg('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.2" opacity=".7"/><circle cx="12" cy="12" r="9.2" opacity=".4"/>'),
  sharpen: svg('<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/><path d="M12 8.5l3.5 3.5-3.5 3.5L8.5 12z"/>'),
  noise: svg(
    '<circle cx="6" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="6" r=".8" fill="currentColor"/><circle cx="18" cy="6" r="1.1" fill="currentColor"/><circle cx="6" cy="12" r=".8" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r=".9" fill="currentColor"/><circle cx="6" cy="18" r="1.2" fill="currentColor"/><circle cx="12" cy="18" r="1" fill="currentColor"/><circle cx="18" cy="18" r="1.5" fill="currentColor"/>',
  ),
  hsb: svg('<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>'),
  lensblur: svg(
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5l3.2 5.5M20.2 9.8l-6.4-.6M17.9 18l-3.2-5.6M12 20.5l-3.2-5.5M3.8 14.2l6.4.6M6.1 6l3.2 5.6"/>',
  ),
  boil: svg('<path d="M3.5 9c2-2.5 3.5 2.5 5.5 0s3.5 2.5 5.5 0 3.5 2.5 5.5 0"/><path d="M3.5 15c2-2.5 3.5 2.5 5.5 0s3.5 2.5 5.5 0 3.5 2.5 5.5 0" opacity=".5"/>'),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
};

const ch = (
  id: string,
  label: string,
  short: string,
  min: number,
  max: number,
  step: number,
  unit: ChannelSpec['unit'],
  display: number,
  def: number,
): ChannelSpec => ({ id, label, short, min, max, step, unit, display, def });

const warpChannels = (): ChannelSpec[] => {
  const out: ChannelSpec[] = [];
  for (let r = 0; r < WARP_MAX; r++) {
    for (let c = 0; c < WARP_MAX; c++) {
      for (const axis of ['x', 'y'] as const) {
        out.push(ch(warpId(r, c, axis), `Node R${r + 1} C${c + 1} ${axis.toUpperCase()}`, `R${r + 1}C${c + 1} ${axis.toUpperCase()}`, -20000, 20000, 1, 'px', 1, 0));
      }
    }
  }
  return out;
};

const CORNER_NAMES = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const distortChannels = (): ChannelSpec[] => DISTORT_IDS.map((id, i) => {
  const axis = i % 2 ? 'Y' : 'X';
  return ch(id, `${CORNER_NAMES[i >> 1]} ${axis}`, `${['TL', 'TR', 'BR', 'BL'][i >> 1]} ${axis}`, -20000, 20000, 1, 'px', 1, 0);
});

export const KEY_KINDS: KindSpec[] = [
  {
    kind: 'camera',
    label: 'Camera',
    group: 'camera',
    icon: ICONS.camera,
    channels: [
      ch('panX', 'Pan X', 'PX', -20000, 20000, 1, 'px', 1, 0),
      ch('panY', 'Pan Y', 'PY', -20000, 20000, 1, 'px', 1, 0),
      ch('zoom', 'Zoom', 'Zoom', 0.05, 20, 0.01, '%', 100, 1),
      ch('rotation', 'Rotation', 'R', -3600, 3600, 0.1, 'deg', 1, 0),
    ],
  },
  {
    kind: 'move',
    label: 'Move and Scale',
    group: 'motion',
    icon: ICONS.move,
    channels: [
      ch('x', 'X', 'X', -20000, 20000, 1, 'px', 1, 0),
      ch('y', 'Y', 'Y', -20000, 20000, 1, 'px', 1, 0),
      ch('scaleX', 'Scale X', 'SX', 0, 20, 0.01, '%', 100, 1),
      ch('scaleY', 'Scale Y', 'SY', 0, 20, 0.01, '%', 100, 1),
      ch('rotation', 'Rotation', 'R', -3600, 3600, 0.1, 'deg', 1, 0),
      // pivot offset from the movie centre (Content.pivot is its unkeyed value)
      ch('px', 'Pivot X', 'PX', -20000, 20000, 1, 'px', 1, 0),
      ch('py', 'Pivot Y', 'PY', -20000, 20000, 1, 'px', 1, 0),
    ],
    options: [{ id: 'path', label: 'Smooth path', def: false }],
  },
  {
    kind: 'warp',
    label: 'Warp',
    group: 'motion',
    icon: ICONS.warp,
    channels: warpChannels(),
    options: [{ id: 'size', label: 'Mesh size', def: WARP_DEFAULT }],
  },
  {
    kind: 'distort',
    label: 'Distort',
    group: 'motion',
    icon: ICONS.distort,
    channels: distortChannels(),
  },
  {
    // one rotation channel per bone of the content's rig (channel id = bone id); see boneSpec
    kind: 'bones',
    label: 'Bones',
    group: 'motion',
    icon: ICONS.bones,
    channels: [],
  },
  {
    kind: 'opacity',
    label: 'Opacity',
    group: 'filter',
    icon: ICONS.opacity,
    channels: [ch('amount', 'Amount', 'Amount', 0, 1, 0.01, '%', 100, 1)],
  },
  {
    kind: 'blur',
    label: 'Gaussian Blur',
    group: 'filter',
    icon: ICONS.blur,
    channels: [ch('amount', 'Amount', 'Amount', 0, 1, 0.01, '%', 100, 0)],
  },
  {
    kind: 'sharpen',
    label: 'Sharpen',
    group: 'filter',
    icon: ICONS.sharpen,
    channels: [ch('amount', 'Amount', 'Amount', 0, 1, 0.01, '%', 100, 0)],
  },
  {
    kind: 'noise',
    label: 'Noise',
    group: 'filter',
    icon: ICONS.noise,
    channels: [
      ch('amount', 'Amount', 'Amount', 0, 1, 0.01, '%', 100, 0.25),
      ch('scale', 'Scale', 'Scale', 1, 2000, 1, 'px', 1, 200),
      ch('octaves', 'Octaves', 'Octaves', 1, 8, 1, '', 1, 3),
      ch('turbulence', 'Turbulence', 'Turbulence', 0, 1, 0.01, '%', 100, 0.5),
      ch('offsetX', 'Offset X', 'X', -20000, 20000, 1, 'px', 1, 0),
      ch('offsetY', 'Offset Y', 'Y', -20000, 20000, 1, 'px', 1, 0),
      ch('travel', 'Travel', 'Travel', 0, 10, 0.01, '', 1, 0),
    ],
    options: [
      { id: 'style', label: 'Style', choices: ['clouds', 'billows', 'ridges'], def: 'clouds' },
      { id: 'additive', label: 'Additive', def: false },
      { id: 'multichannel', label: 'Multichannel', def: false },
    ],
  },
  {
    kind: 'hsb',
    label: 'Hue, Saturation, Brightness',
    group: 'filter',
    icon: ICONS.hsb,
    channels: [
      ch('hue', 'Hue', 'Hue', -180, 180, 1, 'deg', 1, 0),
      ch('saturation', 'Saturation', 'Saturation', -1, 1, 0.01, '%', 100, 0),
      ch('brightness', 'Brightness', 'Brightness', -1, 1, 0.01, '%', 100, 0),
    ],
  },
  {
    kind: 'lensblur',
    label: 'Lens Blur',
    group: 'filter',
    icon: ICONS.lensblur,
    channels: [
      ch('radius', 'Radius', 'Radius', 0, 1, 0.01, '%', 100, 0),
      ch('brightness', 'Brightness', 'Brightness', 0, 1, 0.01, '%', 100, 0),
      ch('contrast', 'Contrast', 'Contrast', 0, 1, 0.01, '%', 100, 0),
    ],
  },
  {
    kind: 'boil',
    label: 'Boil',
    group: 'filter',
    icon: ICONS.boil,
    channels: [
      ch('amount', 'Amount', 'Amount', 0, 8, 0.1, 'px', 1, 3),
      ch('rate', 'Rate', 'Rate', 1, 6, 1, '', 1, 2),
      ch('variations', 'Variations', 'Variations', 2, 8, 1, '', 1, 3),
      ch('scale', 'Scale', 'Scale', 4, 400, 1, 'px', 1, 40),
    ],
  },
  {
    kind: 'volume',
    label: 'Volume',
    group: 'audio',
    icon: ICONS.volume,
    channels: [ch('level', 'Level', 'Level', 0, 4, 0.01, '%', 100, 1), ch('pan', 'Pan', 'Pan', -1, 1, 0.01, '%', 100, 0)],
  },
];

const SPEC_BY_KIND = new Map<KeyKind, KindSpec>(KEY_KINDS.map((k) => [k.kind, k]));

export function kindSpec(kind: KeyKind): KindSpec {
  return SPEC_BY_KIND.get(kind) as KindSpec;
}

/** Spec of a bone's rotation channel (degrees relative to rest); the id is the bone's id ("b3" reads "Bone 3"). */
export function boneSpec(id: string): ChannelSpec {
  const m = /^b(\d+)$/.exec(id);
  return ch(id, m ? `Bone ${m[1]}` : id, m ? `B${m[1]}` : id, -3600, 3600, 0.1, 'deg', 1, 0);
}

/** The spec of one channel of a kind; bone channels are made on demand. */
export function channelSpec(kind: KeyKind, id: string): ChannelSpec | undefined {
  return kind === 'bones' ? boneSpec(id) : kindSpec(kind).channels.find((s) => s.id === id);
}

export function laneOf(c: Content, kind: KeyKind): KeyLane | null {
  const keys = c.keys ?? [];   // movies saved before keyframes (v0.3.0) have no `keys`
  for (let i = 0; i < keys.length; i++) if (keys[i].kind === kind) return keys[i];
  return null;
}

export function baseValues(c: Content, kind: KeyKind): Record<string, number> {
  const out: Record<string, number> = {};
  if (kind === 'move') {
    out.x = c.transform.x;
    out.y = c.transform.y;
    out.scaleX = c.transform.scale;
    out.scaleY = c.transform.scale;
    out.rotation = c.transform.rotation;
    out.px = c.pivot?.x ?? 0;
    out.py = c.pivot?.y ?? 0;
    return out;
  }
  if (kind === 'volume') {
    out.level = c.volume;
    out.pan = c.pan ?? 0;
    return out;
  }
  const spec = kindSpec(kind);
  const ids = kind === 'warp' ? new Set(warpChannelIds(warpSize(laneOf(c, 'warp')))) : null;
  for (const ch of spec.channels) if (!ids || ids.has(ch.id)) out[ch.id] = ch.def;
  return out;
}

/** Mesh size (nodes per side) of a Warp lane. */
export function warpSize(lane: KeyLane | null): number {
  const n = lane ? Number(lane.options.size) : WARP_DEFAULT;
  return Number.isFinite(n) ? Math.min(WARP_MAX, Math.max(WARP_MIN, Math.round(n))) : WARP_DEFAULT;
}

export function warpChannelIds(n: number): string[] {
  const out: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push(warpId(r, c, 'x'), warpId(r, c, 'y'));
  return out;
}

/** The channels a lane shows and keys: all of them, except a Warp lane only has its own mesh's nodes. */
export function laneChannels(lane: KeyLane): ChannelSpec[] {
  if (lane.kind === 'bones') return Object.keys(lane.channels).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(boneSpec);
  const spec = kindSpec(lane.kind).channels;
  if (lane.kind !== 'warp') return spec;
  const ids = new Set(warpChannelIds(warpSize(lane)));
  return spec.filter((s) => ids.has(s.id));
}

// ---- Temporal Bezier -------------------------------------------------------

const EASY = 1 / 3;
const LIN_OUT: [number, number] = [1 / 3, 1 / 3];
const LIN_IN: [number, number] = [2 / 3, 2 / 3];

/** Normalised ease between two values. oe/ie: whether the leaving/arriving side is eased (speed 0, 33% influence). */
function bezierSpan(u: number, y0: number, y1: number, oe: boolean, ie: boolean): number {
  // Handles in x are at 1/3 on both sides, so x(s) = 3(1-s)^2 s x1 + 3(1-s) s^2 x2 + s^3 with x1 = x2 swapped to 1/3, 2/3.
  // A non-eased side has speed = average slope with influence 1/3, which puts its handle on the straight line.
  const d = y1 - y0;
  return bezierSeg(u, y0, y1, EASY, 1 - EASY, oe ? y0 : y0 + d * EASY, ie ? y1 : y1 - d * EASY);
}

/** The same Bezier with free handles: x1, x2 are the handles' time fractions, yy1, yy2 their values. */
export function bezierSeg(u: number, y0: number, y1: number, x1: number, x2: number, yy1: number, yy2: number): number {
  let s = u;
  for (let n = 0; n < 8; n++) {
    const v = 1 - s;
    const e = 3 * v * v * s * x1 + 3 * v * s * s * x2 + s * s * s - u;
    if (e < 1e-9 && e > -1e-9) break;
    const dx = 3 * v * v * x1 + 6 * v * s * (x2 - x1) + 3 * s * s * (1 - x2);
    if (dx < 1e-9 && dx > -1e-9) break;
    s -= e / dx;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  }
  {
    const v = 1 - s;
    const e = 3 * v * v * s * x1 + 3 * v * s * s * x2 + s * s * s - u;
    if (e > 1e-6 || e < -1e-6) {
      let lo = 0;
      let hi = 1;
      for (let n = 0; n < 60; n++) {
        s = (lo + hi) / 2;
        const w = 1 - s;
        if (3 * w * w * s * x1 + 3 * w * s * s * x2 + s * s * s < u) lo = s;
        else hi = s;
      }
    }
  }
  const v = 1 - s;
  return v * v * v * y0 + 3 * v * v * s * yy1 + 3 * v * s * s * yy2 + s * s * s * y1;
}

/** Settling curves (0 to 1 at u = 0 and 1): a ball that lands and bounces, a spring, a push past the target and back. */
function bounceOut(u: number): number {
  const n = 7.5625, d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) { const v = u - 1.5 / d; return n * v * v + 0.75; }
  if (u < 2.5 / d) { const v = u - 2.25 / d; return n * v * v + 0.9375; }
  const v = u - 2.625 / d;
  return n * v * v + 0.984375;
}

function elasticOut(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return Math.pow(2, -10 * u) * Math.sin(((u * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
}

function overshootOut(u: number): number {
  const c1 = 1.70158, c3 = c1 + 1, v = u - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
}

/** Value across a span for a given ease at normalised position u in 0..1 (y0 to y1). */
function spanValue(ease: Ease, u: number, y0: number, y1: number): number {
  switch (ease) {
    case 'hold':
      return u >= 1 ? y1 : y0;
    case 'in':
      return bezierSpan(u, y0, y1, false, true);
    case 'out':
      return bezierSpan(u, y0, y1, true, false);
    case 'inout':
      return bezierSpan(u, y0, y1, true, true);
    case 'bounce':
      return y0 + (y1 - y0) * bounceOut(u);
    case 'elastic':
      return y0 + (y1 - y0) * elasticOut(u);
    case 'overshoot':
      return y0 + (y1 - y0) * overshootOut(u);
    default:
      return y0 + (y1 - y0) * u;
  }
}

export function easeCurve(ease: Ease): (t: number) => number {
  return (t) => {
    const u = t < 0 ? 0 : t > 1 ? 1 : t;
    return spanValue(ease, u, 0, 1);
  };
}

/** Allocation-free: binary search the span that holds `frame`, then interpolate. */
export function evalChannel(keys: Key[], frame: number): number | null {
  const n = keys.length;
  if (n === 0) return null;
  const first = keys[0];
  if (frame <= first.frame) return first.value;
  const last = keys[n - 1];
  if (frame >= last.frame) return last.value;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const dt = b.frame - a.frame;
  if (dt <= 0) return b.value;
  const e = a.ease;
  if (e === 'hold') return a.value;
  const u = (frame - a.frame) / dt;
  if (e === 'linear') return a.value + (b.value - a.value) * u;
  if (e === 'custom') {
    const o = a.out ?? LIN_OUT, i = a.in ?? LIN_IN, d = b.value - a.value;
    return bezierSeg(u, a.value, b.value, o[0] < 0 ? 0 : o[0] > 1 ? 1 : o[0], i[0] < 0 ? 0 : i[0] > 1 ? 1 : i[0], a.value + d * o[1], a.value + d * i[1]);
  }
  return spanValue(e, u, a.value, b.value);
}

export function evalLane(c: Content, lane: KeyLane, frame: number): Record<string, number> {
  const out = baseValues(c, lane.kind);
  const spec = kindSpec(lane.kind);
  for (const s of lane.kind === 'bones' ? laneChannels(lane) : spec.channels) {
    const keys = lane.channels[s.id];
    if (keys && keys.length) {
      const v = evalChannel(keys, frame);
      if (v !== null) out[s.id] = v;
    }
  }
  if (lane.kind === 'move' && pathAt(lane, frame, pathProgress, PATH_PT)) {
    out.x = PATH_PT[0];
    out.y = PATH_PT[1];
  }
  return out;
}

const PATH_PT: Pt = [0, 0];

/** Eased fraction 0..1 of the span from x key a to b at `frame`: the key's own ease (custom ones too) run on 0 to 1. */
function pathProgress(a: Key, b: Key, frame: number): number {
  const v = evalChannel([{ ...a, value: 0 }, { ...b, value: 1 }], frame) ?? 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface Animated {
  x: number;
  y: number;
  /** Pivot offset from the movie centre in px (absent: the centre). */
  px?: number;
  py?: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  opacity: number;
  blur: number;
  sharpen: number;
  noise: {
    amount: number;
    scale: number;
    octaves: number;
    turbulence: number;
    offsetX: number;
    offsetY: number;
    travel: number;
    style: 'clouds' | 'billows' | 'ridges';
    additive: boolean;
    multichannel: boolean;
  } | null;
  hsb: { hue: number; saturation: number; brightness: number } | null;
  lens: { radius: number; brightness: number; contrast: number } | null;
  /** Boil in movie px; `seed` is the redraw this frame shows. */
  boil: { amount: number; scale: number; seed: number } | null;
  volume: number;
  /** Sound stereo position -1..1 (0: centre). */
  pan: number;
  /** Warp mesh offsets (n x n nodes, row by row, content-space px) or null. */
  warp: { n: number; dx: number[]; dy: number[] } | null;
  /** Distort corner offsets tl, tr, br, bl as x, y pairs (content-space px) or null. */
  distort: number[] | null;
  /** Warp / Distort lane option: straight (bilinear) interpolation between the nodes or corners instead of the smooth surface / perspective. */
  bilinear?: boolean;
  /** Warp / Distort lane option: how the flat picture is resampled (absent: smooth, the default). */
  resample?: 'nearest' | 'high';
  /** Bone rotations by bone id (degrees from rest) when the content has a rig and any bone is turned, else null. */
  bones: Record<string, number> | null;
}

/** Evaluate one channel of a lane, falling back to `base` when it has no keys. */
function chv(lane: KeyLane, id: string, frame: number, base: number): number {
  const keys = lane.channels[id];
  if (!keys || keys.length === 0) return base;
  const v = evalChannel(keys, frame);
  return v === null ? base : v;
}

function noiseStyle(v: string | number | boolean | undefined): 'clouds' | 'billows' | 'ridges' {
  return v === 'billows' || v === 'ridges' ? v : 'clouds';
}

/** The content's values at a local frame. A malformed (NaN, missing) scale counts as 1 for every drawer, CPU and GPU alike. */
export function animate(c: Content, local: number): Animated {
  const a = animateRaw(c, local);
  if (!Number.isFinite(a.scaleX)) a.scaleX = 1;
  if (!Number.isFinite(a.scaleY)) a.scaleY = 1;
  // a malformed move or turn counts as none, so a NaN matrix never blanks the GPU frame
  if (!Number.isFinite(a.x)) a.x = 0;
  if (!Number.isFinite(a.y)) a.y = 0;
  if (!Number.isFinite(a.rotation)) a.rotation = 0;
  if (a.px !== undefined && !Number.isFinite(a.px)) a.px = 0;
  if (a.py !== undefined && !Number.isFinite(a.py)) a.py = 0;
  return a;
}

function animateRaw(c: Content, local: number): Animated {
  const t = c.transform;
  const a: Animated = {
    x: t.x,
    y: t.y,
    px: c.pivot?.x ?? 0,
    py: c.pivot?.y ?? 0,
    scaleX: t.scale * (t.stretchX ?? 1),
    scaleY: t.scale * (t.stretchY ?? 1),
    rotation: t.rotation,
    flipH: t.flipH,
    flipV: t.flipV,
    opacity: c.opacity,
    blur: 0,
    sharpen: 0,
    noise: null,
    hsb: null,
    lens: null,
    boil: null,
    volume: c.volume,
    pan: c.pan ?? 0,
    warp: null,
    distort: null,
    bones: null,
  };
  const lanes = c.keys ?? [];
  const n = lanes.length;
  if (n === 0) return a;
  for (let i = 0; i < n; i++) {
    const lane = lanes[i];
    switch (lane.kind) {
      case 'move':
        if (pathAt(lane, local, pathProgress, PATH_PT)) {
          a.x = PATH_PT[0];
          a.y = PATH_PT[1];
        } else {
          a.x = chv(lane, 'x', local, t.x);
          a.y = chv(lane, 'y', local, t.y);
        }
        a.px = chv(lane, 'px', local, c.pivot?.x ?? 0);
        a.py = chv(lane, 'py', local, c.pivot?.y ?? 0);
        a.scaleX = chv(lane, 'scaleX', local, t.scale) * (t.stretchX ?? 1);
        a.scaleY = chv(lane, 'scaleY', local, t.scale) * (t.stretchY ?? 1);
        a.rotation = chv(lane, 'rotation', local, t.rotation);
        break;
      case 'warp': {
        const n = warpSize(lane);
        const dx: number[] = new Array(n * n), dy: number[] = new Array(n * n);
        let moved = false;
        for (let r = 0; r < n; r++) {
          for (let k = 0; k < n; k++) {
            dx[r * n + k] = chv(lane, warpId(r, k, 'x'), local, 0);
            dy[r * n + k] = chv(lane, warpId(r, k, 'y'), local, 0);
            if (dx[r * n + k] || dy[r * n + k]) moved = true;
          }
        }
        if (moved) { a.warp = { n, dx, dy }; if (lane.options.bilinear === true) a.bilinear = true; const rs = lane.options.resample; if (rs === 'nearest' || rs === 'high') a.resample = rs; }
        break;
      }
      case 'distort': {
        const o = DISTORT_IDS.map((id) => chv(lane, id, local, 0));
        if (o.some((v) => v !== 0)) { a.distort = o; if (lane.options.bilinear === true) a.bilinear = true; const rs = lane.options.resample; if (rs === 'nearest' || rs === 'high') a.resample = rs; }
        break;
      }
      case 'bones': {
        const rig = c.rig;
        if (!rig || !rig.bones.length) break;
        const rot: Record<string, number> = {};
        let turned = false;
        for (const b of rig.bones) {
          const v = chv(lane, b.id, local, 0);
          if (v) { rot[b.id] = v; turned = true; }
        }
        if (turned) a.bones = rot;
        break;
      }
      case 'opacity':
        a.opacity = c.opacity * chv(lane, 'amount', local, 1);
        break;
      case 'blur':
        a.blur = chv(lane, 'amount', local, 0);
        break;
      case 'sharpen':
        a.sharpen = chv(lane, 'amount', local, 0);
        break;
      case 'noise': {
        const o = lane.options;
        a.noise = {
          amount: chv(lane, 'amount', local, 0.25),
          scale: chv(lane, 'scale', local, 200),
          octaves: chv(lane, 'octaves', local, 3),
          turbulence: chv(lane, 'turbulence', local, 0.5),
          offsetX: chv(lane, 'offsetX', local, 0),
          offsetY: chv(lane, 'offsetY', local, 0),
          travel: chv(lane, 'travel', local, 0),
          style: noiseStyle(o.style),
          additive: o.additive === true,
          multichannel: o.multichannel === true,
        };
        break;
      }
      case 'hsb':
        a.hsb = {
          hue: chv(lane, 'hue', local, 0),
          saturation: chv(lane, 'saturation', local, 0),
          brightness: chv(lane, 'brightness', local, 0),
        };
        break;
      case 'lensblur':
        a.lens = {
          radius: chv(lane, 'radius', local, 0),
          brightness: chv(lane, 'brightness', local, 0),
          contrast: chv(lane, 'contrast', local, 0),
        };
        break;
      case 'boil': {
        const amount = chv(lane, 'amount', local, 3);
        if (amount > 0) a.boil = { amount, scale: chv(lane, 'scale', local, 40), seed: boilSeed(local, chv(lane, 'rate', local, 2), chv(lane, 'variations', local, 3)) };
        break;
      }
      case 'volume':
        a.volume = chv(lane, 'level', local, c.volume);
        a.pan = chv(lane, 'pan', local, c.pan ?? 0);
        break;
    }
  }
  return a;
}

export function laneFrames(lane: KeyLane, channel?: string): number[] {
  const set = new Set<number>();
  if (channel) {
    for (const k of lane.channels[channel] ?? []) set.add(k.frame);
  } else {
    for (const id in lane.channels) for (const k of lane.channels[id]) set.add(k.frame);
  }
  return Array.from(set).sort((p, q) => p - q);
}

export function hasKeyAt(lane: KeyLane, frame: number, channel?: string): boolean {
  if (channel) return (lane.channels[channel] ?? []).some((k) => k.frame === frame);
  for (const id in lane.channels) if (lane.channels[id].some((k) => k.frame === frame)) return true;
  return false;
}

export function easeAt(lane: KeyLane, frame: number, channel?: string): Ease | null {
  if (channel) return (lane.channels[channel] ?? []).find((k) => k.frame === frame)?.ease ?? null;
  // bones lanes have one channel per bone, not the kind's fixed list
  if (lane.kind === 'bones') {
    for (const id in lane.channels) {
      const k = lane.channels[id].find((q) => q.frame === frame);
      if (k) return k.ease;
    }
    return null;
  }
  for (const spec of kindSpec(lane.kind).channels) {
    const k = (lane.channels[spec.id] ?? []).find((q) => q.frame === frame);
    if (k) return k.ease;
  }
  return null;
}
