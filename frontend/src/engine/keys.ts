// Keyframe model: channel specs, temporal Bezier evaluation, and per-frame animation of a content.
// Ported from the temporal ease maths of the owner's formvfx key model (speed and influence per side,
// Newton then bisection for x(t)). Pure, no DOM.
import type { Content, Ease, Key, KeyKind, KeyLane } from './types';

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
  group: 'motion' | 'filter' | 'audio';
  icon: string;
  channels: ChannelSpec[];
  options?: { id: string; label: string; choices?: string[]; def: string | number | boolean }[];
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS: Record<KeyKind, string> = {
  move: svg(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M12 7.5v9M7.5 12h9M12 7.5l-1.6 1.7M12 7.5l1.6 1.7M12 16.5l-1.6-1.7M12 16.5l1.6-1.7M7.5 12l1.7-1.6M7.5 12l1.7 1.6M16.5 12l-1.7-1.6M16.5 12l-1.7 1.6"/>',
  ),
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

export const KEY_KINDS: KindSpec[] = [
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
    ],
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
    kind: 'volume',
    label: 'Volume',
    group: 'audio',
    icon: ICONS.volume,
    channels: [ch('level', 'Level', 'Level', 0, 2, 0.01, '%', 100, 1)],
  },
];

const SPEC_BY_KIND = new Map<KeyKind, KindSpec>(KEY_KINDS.map((k) => [k.kind, k]));

export function kindSpec(kind: KeyKind): KindSpec {
  return SPEC_BY_KIND.get(kind) as KindSpec;
}

export function laneOf(c: Content, kind: KeyKind): KeyLane | null {
  const keys = c.keys;
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
    return out;
  }
  if (kind === 'volume') {
    out.level = c.volume;
    return out;
  }
  const spec = kindSpec(kind);
  for (const ch of spec.channels) out[ch.id] = ch.def;
  return out;
}

// ---- Temporal Bezier -------------------------------------------------------

const EASY = 1 / 3;

/** Normalised ease between two values. oe/ie: whether the leaving/arriving side is eased (speed 0, 33% influence). */
function bezierSpan(u: number, y0: number, y1: number, oe: boolean, ie: boolean): number {
  // Handles in x are at 1/3 on both sides, so x(s) = 3(1-s)^2 s x1 + 3(1-s) s^2 x2 + s^3 with x1 = x2 swapped to 1/3, 2/3.
  // A non-eased side has speed = average slope with influence 1/3, which puts its handle on the straight line.
  const x1 = EASY;
  const x2 = 1 - EASY;
  const d = y1 - y0;
  const yy1 = oe ? y0 : y0 + d * EASY;
  const yy2 = ie ? y1 : y1 - d * EASY;
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
  return spanValue(e, u, a.value, b.value);
}

export function evalLane(c: Content, lane: KeyLane, frame: number): Record<string, number> {
  const out = baseValues(c, lane.kind);
  const spec = kindSpec(lane.kind);
  for (const s of spec.channels) {
    const keys = lane.channels[s.id];
    if (keys && keys.length) {
      const v = evalChannel(keys, frame);
      if (v !== null) out[s.id] = v;
    }
  }
  return out;
}

export interface Animated {
  x: number;
  y: number;
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
  volume: number;
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

export function animate(c: Content, local: number): Animated {
  const t = c.transform;
  const a: Animated = {
    x: t.x,
    y: t.y,
    scaleX: t.scale,
    scaleY: t.scale,
    rotation: t.rotation,
    flipH: t.flipH,
    flipV: t.flipV,
    opacity: c.opacity,
    blur: 0,
    sharpen: 0,
    noise: null,
    hsb: null,
    lens: null,
    volume: c.volume,
  };
  const lanes = c.keys;
  const n = lanes.length;
  if (n === 0) return a;
  for (let i = 0; i < n; i++) {
    const lane = lanes[i];
    switch (lane.kind) {
      case 'move':
        a.x = chv(lane, 'x', local, t.x);
        a.y = chv(lane, 'y', local, t.y);
        a.scaleX = chv(lane, 'scaleX', local, t.scale);
        a.scaleY = chv(lane, 'scaleY', local, t.scale);
        a.rotation = chv(lane, 'rotation', local, t.rotation);
        break;
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
      case 'volume':
        a.volume = chv(lane, 'level', local, c.volume);
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
  for (const spec of kindSpec(lane.kind).channels) {
    const k = (lane.channels[spec.id] ?? []).find((q) => q.frame === frame);
    if (k) return k.ease;
  }
  return null;
}
