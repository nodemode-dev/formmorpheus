// Brush Studio: every parameter the editor shows, as data. Each one reads and writes a Brush field and each
// field is read by the stroke engine (paint/stroke.ts, dynamics.ts), so a control that is here changes strokes.
// Optional fields are removed again at their default so old brushes and the .brush round trip stay plain.
// No DOM here: the editor (brush-studio.ts) builds its rows from this list once and patches them in place.

import type { Brush, TipShape, WetMix } from '../paint/types';

export interface NumParam {
  kind: 'num'; id: string; label: string;
  /** Range in the brush's own units. */
  min: number; max: number; step: number; def: number;
  /** Shown value = stored value * mul, followed by unit (a percent for 0..1 fields, degrees for angles). */
  mul: number; unit: string;
  get(b: Brush): number;
  set(b: Brush, v: number): void;
  /** Fields that must exist for the control to act (used by the parameter check). */
  needs?: Partial<Brush>;
}
export interface BoolParam { kind: 'bool'; id: string; label: string; get(b: Brush): boolean; set(b: Brush, v: boolean): void; needs?: Partial<Brush> }
export interface SelectParam {
  kind: 'select'; id: string; label: string;
  options: { value: string; label: string }[];
  get(b: Brush): string; set(b: Brush, v: string): void; needs?: Partial<Brush>;
}
/** A picture import (the stamp or the grain); the editor owns the file dialog. */
export interface FileParam { kind: 'file'; id: string; label: string; what: 'tip' | 'grain' }
/** A picker over the authored library (paint/tips-lib.ts, grains-lib.ts); the editor owns the grid. */
export interface PickParam { kind: 'pick'; id: string; label: string; what: 'tip' | 'grain'; set(b: Brush, id: string): void }
export interface GroupHead { kind: 'group'; id: string; label: string }
export type Param = NumParam | BoolParam | SelectParam | FileParam | PickParam | GroupHead;
export interface Section { id: string; label: string; params: Param[] }

type Rec = Record<string, unknown>;
const R = (b: Brush): Rec => b as unknown as Rec;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const cap = (s: string): string => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/-/g, ' ');

/** A number stored in a top-level field. `req` fields always exist on a Brush; the others are removed at their default. */
function top(key: keyof Brush & string, label: string, min: number, max: number, step: number, def: number, o: { mul?: number; unit?: string; req?: boolean; needs?: Partial<Brush> } = {}): NumParam {
  return {
    kind: 'num', id: key, label, min, max, step, def, mul: o.mul ?? 100, unit: o.unit ?? '%', needs: o.needs,
    get: (b) => (R(b)[key] as number | undefined) ?? def,
    set: (b, v) => { if (!o.req && near(v, def)) delete R(b)[key]; else R(b)[key] = v; },
  };
}

/** An angle kept in radians, shown in degrees. */
function angle(key: 'baseRot' | 'grainRot', label: string, needs?: Partial<Brush>): NumParam {
  return {
    kind: 'num', id: key, label, min: 0, max: 360, step: 1, def: 0, mul: 1, unit: '°', needs,
    get: (b) => Math.round((((R(b)[key] as number | undefined) ?? 0) * 180) / Math.PI),
    set: (b, v) => { if (v === 0) delete R(b)[key]; else R(b)[key] = (v * Math.PI) / 180; },
  };
}

export const NEUTRAL_WET: WetMix = { dilution: 0, charge: 1, attack: 0, pull: 0, grade: 0.5 };
const WET_NEEDS: Partial<Brush> = { wet: { dilution: 0.25, charge: 0.8, attack: 0.3, pull: 0.5, grade: 0.5 } };

function wet(key: 'dilution' | 'charge' | 'attack' | 'pull' | 'grade' | 'blur' | 'blurJitter' | 'wetJitter', label: string, def: number): NumParam {
  return {
    kind: 'num', id: `wet.${key}`, label, min: 0, max: 1, step: 0.01, def, mul: 100, unit: '%', needs: WET_NEEDS,
    get: (b) => b.wet?.[key] ?? def,
    set: (b, v) => { const w = { ...(b.wet ?? NEUTRAL_WET) }; w[key] = v; b.wet = w; },
  };
}

/** A field of the material (depth, gloss, metal, light angle). The material is removed again when it does nothing. */
function shine(key: 'depth' | 'gloss' | 'metal' | 'light', label: string, def: number): NumParam {
  const isAngle = key === 'light';
  return {
    kind: 'num', id: `shine.${key}`, label, min: 0, max: isAngle ? 360 : 1, step: isAngle ? 1 : 0.01, def, mul: isAngle ? 1 : 100, unit: isAngle ? '°' : '%',
    needs: { shine: { depth: 0.5, gloss: 0.5, metal: 0 } },
    get: (b) => b.shine?.[key] ?? def,
    set: (b, v) => {
      const s = { depth: 0, gloss: 0, metal: 0, ...(b.shine ?? {}) };
      s[key] = v;
      if (s.depth <= 0 && s.gloss <= 0 && s.metal <= 0) delete b.shine; else b.shine = s;
    },
  };
}

type CdKey = keyof NonNullable<Brush['colorDyn']>;
function cd(key: CdKey, label: string, signed = false): NumParam {
  return {
    kind: 'num', id: `cd.${key}`, label, min: signed ? -1 : 0, max: 1, step: 0.01, def: 0, mul: 100, unit: '%',
    get: (b) => b.colorDyn?.[key] ?? 0,
    set: (b, v) => {
      const o = { ...(b.colorDyn ?? {}) };
      if (v === 0) delete o[key]; else o[key] = v;
      if (Object.keys(o).length) b.colorDyn = o; else delete b.colorDyn;
    },
  };
}

function sel(id: string, label: string, options: [string, string][], get: (b: Brush) => string, set: (b: Brush, v: string) => void, needs?: Partial<Brush>): SelectParam {
  return { kind: 'select', id, label, options: options.map(([value, l]) => ({ value, label: l })), get, set, needs };
}
function flag(key: keyof Brush & string, label: string, needs?: Partial<Brush>): BoolParam {
  return { kind: 'bool', id: key, label, needs, get: (b) => !!R(b)[key], set: (b, v) => { if (v) R(b)[key] = true; else delete R(b)[key]; } };
}
const group = (id: string, label: string): GroupHead => ({ kind: 'group', id, label });

const TIPS: TipShape[] = ['round', 'square', 'chisel', 'grain-round', 'speckle', 'bristle', 'chalk', 'blob', 'sponge', 'ring', 'hatch', 'star', 'leaf', 'splat', 'fibre', 'dots', 'cross', 'grunge', 'pixel', 'comb', 'blade'];
const GRAIN_NEEDS: Partial<Brush> = { grain: 0.7 };

export const BLEND_CHOICES: [string, string][] = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['linear-burn', 'Linear burn'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['add', 'Add'], ['subtract', 'Subtract'],
];

export const SECTIONS: Section[] = [
  {
    id: 'path', label: 'Stroke path', params: [
      top('spacing', 'Spacing', 0.02, 1, 0.01, 0.1, { req: true }),
      top('pathJitter', 'Jitter lateral', 0, 1, 0.01, 0),
      top('jitterLinear', 'Jitter linear', 0, 1, 0.01, 0),
      top('spacingJitter', 'Spacing jitter', 0, 1, 0.01, 0),
      top('speedSpacing', 'Speed spacing', -1, 1, 0.01, 0),
      top('fallOff', 'Fall off', 0, 1, 0.01, 0),
      top('burnout', 'Burn out', 0, 1, 0.01, 0),
      top('wiggle', 'Wobble', 0, 1, 0.01, 0),
      group('g-stream', 'Smoothing'),
      top('smoothing', 'Streamline', 0, 1, 0.01, 0.2, { req: true }),
      top('stabilization', 'Stabilization', 0, 100, 1, 0, { mul: 1, unit: '%' }),
      top('motionFilter', 'Motion filtering', 0, 100, 1, 0, { mul: 1, unit: '%' }),
      top('expression', 'Expression', 0, 100, 1, 50, { mul: 1, unit: '%', needs: { motionFilter: 80 } }),
    ],
  },
  {
    id: 'taper', label: 'Taper', params: [
      group('g-ptaper', 'Pressure taper'),
      top('pTaper', 'Start', 0, 1, 0.01, 0),
      top('pTaperEnd', 'End', 0, 1, 0.01, 0),
      group('g-ttaper', 'Touch taper'),
      top('taper', 'Start', 0, 1, 0.01, 0),
      top('taperEnd', 'End', 0, 1, 0.01, 0),
      group('g-tshape', 'Taper shape'),
      top('taperSize', 'Size', 0, 1, 0.01, 0.12, { needs: { taper: 0.7 } }),
      top('taperOpacity', 'Opacity', 0, 1, 0.01, 0, { needs: { taper: 0.7 } }),
      top('taperTip', 'Tip', 0, 1, 0.01, 0.27, { needs: { taper: 0.7 } }),
    ],
  },
  {
    id: 'shape', label: 'Shape', params: [
      { kind: 'pick', id: 'tipLib', label: 'Library shape', what: 'tip', set: (b, id) => { if (id) { b.tipId = id; delete b.tipImage; if (b.tip === 'sampled') b.tip = 'round'; } else delete b.tipId; } },
      sel('tip', 'Shape', TIPS.map((x) => [x, cap(x)] as [string, string]), (b) => (b.tip === 'sampled' ? 'sampled' : b.tip), (b, v) => { if (v !== 'sampled') { b.tip = v as TipShape; delete b.tipImage; } else if (b.tipImage) b.tip = 'sampled'; }),
      { kind: 'file', id: 'tipFile', label: 'Source', what: 'tip' },
      top('softness', 'Softness', 0, 1, 0.01, 0, { req: true }),
      top('scatter', 'Scatter', 0, 2, 0.01, 0, { req: true }),
      angle('baseRot', 'Rotation', { tip: 'chisel', roundness: 0.3 }),
      top('shapeCount', 'Count', 1, 16, 1, 1, { mul: 1, unit: '' }),
      top('countJitter', 'Count jitter', 0, 1, 0.01, 0, { needs: { shapeCount: 6 } }),
      top('rotationJitter', 'Randomized', 0, 1, 0.01, 0, { req: true, needs: { tip: 'chisel' } }),
      flag('azimuth', 'Azimuth', { tip: 'chisel' }),
      flag('followStroke', 'Follow stroke', { tip: 'chisel' }),
      flag('flipX', 'Flip X', { tip: 'splat' }),
      flag('flipY', 'Flip Y', { tip: 'splat' }),
      top('roundness', 'Roundness', 0.05, 1, 0.01, 1, { req: true }),
      top('pressureRoundness', 'Pressure roundness', -1, 1, 0.01, 0),
      top('tiltRoundness', 'Tilt roundness', 0, 1, 0.01, 0),
      top('roundJitterH', 'Roundness jitter H', 0, 1, 0.01, 0),
      top('roundJitterV', 'Roundness jitter V', 0, 1, 0.01, 0),
      sel('tipFilter', 'Filter', [['smooth', 'Smooth'], ['sharp', 'Sharp']], (b) => (b.tipSharp ? 'sharp' : 'smooth'), (b, v) => { if (v === 'sharp') b.tipSharp = true; else delete b.tipSharp; }, { tip: 'star' }),
    ],
  },
  {
    id: 'grain', label: 'Grain', params: [
      { kind: 'pick', id: 'grainLib', label: 'Library grain', what: 'grain', set: (b, id) => { if (id) { b.grainId = id; delete b.grainImage; if (b.grain <= 0) b.grain = 0.7; } else delete b.grainId; } },
      sel('grainMode', 'Behavior', [['texturized', 'Texturized'], ['moving', 'Moving']], (b) => b.grainMode ?? 'texturized', (b, v) => { if (v === 'moving') b.grainMode = 'moving'; else delete b.grainMode; }, GRAIN_NEEDS),
      top('grainMovement', 'Movement', 0, 1, 0.01, 1, { needs: { grain: 0.7, grainMode: 'moving' } }),
      top('grain', 'Depth', 0, 1, 0.01, 0, { req: true }),
      top('grainDepthMin', 'Depth minimum', 0, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      top('grainScale', 'Scale', 0.25, 4, 0.05, 1, { mul: 100, unit: '%', needs: GRAIN_NEEDS }),
      top('grainRepeat', 'Auto repeat scale', 1, 8, 1, 1, { mul: 1, unit: '×', needs: GRAIN_NEEDS }),
      flag('grainSeamless', 'Auto repeat seamless', GRAIN_NEEDS),
      flag('grainInvert', 'Invert', GRAIN_NEEDS),
      top('grainZoom', 'Zoom', 0, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      angle('grainRot', 'Rotation', GRAIN_NEEDS),
      top('grainJitter', 'Depth jitter', 0, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      top('grainOffsetJitter', 'Offset jitter', 0, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      sel('grainBlend', 'Blend mode', [['multiply', 'Multiply'], ['subtract', 'Subtract'], ['screen', 'Screen']], (b) => b.grainBlend ?? 'multiply', (b, v) => { if (v === 'multiply') delete b.grainBlend; else b.grainBlend = v as Brush['grainBlend']; }, GRAIN_NEEDS),
      top('grainBright', 'Brightness', -1, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      top('grainContrast', 'Contrast', -1, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      { kind: 'file', id: 'grainFile', label: 'Source', what: 'grain' },
    ],
  },
  {
    id: 'render', label: 'Rendering', params: [
      sel('render', 'Render mode', [['', 'Normal'], ['light-glaze', 'Light glaze'], ['uniform-glaze', 'Uniform glaze'], ['intense-glaze', 'Intense glaze'], ['heavy-glaze', 'Heavy glaze'], ['uniform-blending', 'Uniform blending'], ['intense-blending', 'Intense blending'], ['heavy-blending', 'Heavy blending']],
        (b) => b.render ?? '', (b, v) => { if (v) b.render = v as Brush['render']; else delete b.render; }),
      top('flow', 'Flow', 0.02, 1, 0.01, 1, { req: true }),
      top('wetEdges', 'Wet edges', 0, 1, 0.01, 0),
      top('burntEdges', 'Burnt edges', 0, 1, 0.01, 0, { needs: { softness: 0.5 } }),
      sel('blend', 'Blend mode', BLEND_CHOICES, (b) => b.blend ?? 'normal', (b, v) => { if (v === 'normal') delete b.blend; else b.blend = v as Brush['blend']; }),
      top('lumBlend', 'Luminance blending', 0, 1, 0.01, 0),
    ],
  },
  {
    id: 'wet', label: 'Wet mix', params: [
      wet('dilution', 'Dilution', 0),
      wet('charge', 'Charge', 1),
      wet('attack', 'Attack', 0),
      wet('pull', 'Pull', 0),
      wet('grade', 'Grade', 0.5),
      wet('blur', 'Blur', 0),
      wet('blurJitter', 'Blur jitter', 0),
      wet('wetJitter', 'Wetness jitter', 0),
    ],
  },
  {
    id: 'color', label: 'Color dynamics', params: [
      group('g-stamp', 'Stamp color'),
      cd('stampHue', 'Hue'), cd('stampSat', 'Saturation'), cd('stampBri', 'Brightness'), cd('stampSecondary', 'Secondary color'),
      group('g-stroke', 'Stroke color'),
      cd('strokeHue', 'Hue'), cd('strokeSat', 'Saturation'), cd('strokeBri', 'Brightness'), cd('strokeSecondary', 'Secondary color'),
      group('g-pcolor', 'Pressure color'),
      cd('pressureHue', 'Hue', true), cd('pressureSat', 'Saturation', true), cd('pressureBri', 'Brightness', true),
      group('g-tcolor', 'Tilt color'),
      cd('tiltHue', 'Hue', true), cd('tiltSat', 'Saturation', true), cd('tiltBri', 'Brightness', true),
    ],
  },
  {
    id: 'dynamics', label: 'Dynamics', params: [
      top('speedSize', 'Speed size', -1, 1, 0.01, 0),
      top('speedOpacity', 'Speed opacity', -1, 1, 0.01, 0),
      top('jitterSize', 'Jitter size', 0, 1, 0.01, 0),
      top('jitterOpacity', 'Jitter opacity', 0, 1, 0.01, 0),
    ],
  },
  {
    id: 'pencil', label: 'Pencil', params: [
      group('g-press', 'Pressure'),
      {
        kind: 'num', id: 'pressureSize', label: 'Size', min: 0, max: 0.98, step: 0.01, def: 0, mul: 100, unit: '%',
        get: (b) => 1 - b.pressureSize[0], set: (b, v) => { b.pressureSize = [Math.max(0.02, 1 - v), b.pressureSize[1]]; },
      },
      top('pressureOpacity', 'Opacity', 0, 1, 0.01, 0),
      {
        kind: 'num', id: 'pressureFlow', label: 'Flow', min: 0, max: 0.98, step: 0.01, def: 0, mul: 100, unit: '%',
        get: (b) => 1 - b.pressureFlow[0], set: (b, v) => { b.pressureFlow = [Math.max(0.02, 1 - v), b.pressureFlow[1]]; },
      },
      top('pressureBleed', 'Bleed', 0, 1, 0.01, 0, { needs: { softness: 0.1 } }),
      top('pressureSmooth', 'Smoothing', 0, 1, 0.01, 0),
      top('pressureGamma', 'Curve', 0.4, 2.5, 0.05, 1, { mul: 1, unit: '' }),
      group('g-tilt', 'Tilt'),
      top('tilt', 'Amount', 0, 1, 0.01, 0, { req: true }),
      top('tiltAngle', 'Angle', 0, 80, 1, 0, { mul: 1, unit: '°', needs: { tilt: 0.8 } }),
      top('tiltOpacity', 'Opacity', -1, 1, 0.01, 0),
      top('tiltGradation', 'Gradation', 0, 1, 0.01, 0),
      top('tiltBleed', 'Bleed', 0, 1, 0.01, 0, { needs: { softness: 0.1 } }),
      top('tiltSize', 'Size', -1, 1, 0.01, 0),
      group('g-roll', 'Barrel roll'),
      top('rollSize', 'Size', -1, 1, 0.01, 0),
      top('rollOpacity', 'Opacity', -1, 1, 0.01, 0),
      top('rollBleed', 'Bleed', 0, 1, 0.01, 0, { needs: { softness: 0.1 } }),
      flag('rollRelative', 'Relative to stroke'),
    ],
  },
  {
    id: 'props', label: 'Properties', params: [
      flag('orientScreen', 'Orient to screen', { baseRot: 0.8, tip: 'chisel' }),
      top('previewSize', 'Preview size', 0.2, 1, 0.01, 1),
      top('pickup', 'Smudge', 0, 1, 0.01, 0.5, { req: true }),
      { kind: 'bool', id: 'sizeRel', label: 'Size relative to canvas', get: (b) => !b.sizeAbs, set: (b, v) => { if (v) delete b.sizeAbs; else b.sizeAbs = true; } },
      // shown as a share of the canvas's long side (1920 px = 100%)
      top('maxSize', 'Maximum size', 2, 1920, 1, 40, { mul: 100 / 1920, unit: ' %', req: true }),
      top('minSize', 'Minimum size', 0.5, 960, 0.5, 1, { mul: 100 / 1920, unit: ' %', req: true }),
      top('maxOpacity', 'Maximum opacity', 0.05, 1, 0.01, 1),
      top('minOpacity', 'Minimum opacity', 0, 0.95, 0.01, 0),
      flag('pixelPerfect', 'Pixel perfect'),
    ],
  },
  {
    id: 'materials', label: 'Materials', params: [
      top('bump', 'Relief', 0, 1, 0.01, 0, { needs: GRAIN_NEEDS }),
      shine('depth', 'Depth', 0),
      shine('gloss', 'Gloss', 0),
      shine('metal', 'Metallic', 0),
      shine('light', 'Light angle', 135),
    ],
  },
];

/** Labels of the About section, which the editor builds by hand. */
export const ABOUT_LABELS = ['Name', 'Author', 'Created', 'Signature'];

export function allParams(): (NumParam | BoolParam | SelectParam)[] {
  const out: (NumParam | BoolParam | SelectParam)[] = [];
  for (const s of SECTIONS) for (const p of s.params) if (p.kind === 'num' || p.kind === 'bool' || p.kind === 'select') out.push(p);
  return out;
}

/** A copy of a brush the editor may change freely: nested objects are copied, pictures are shared. */
export function cloneBrush(b: Brush): Brush {
  const c: Brush = { ...b, pressureSize: [...b.pressureSize], pressureFlow: [...b.pressureFlow], presets: b.presets.map((p) => ({ ...p })) };
  if (b.colorDyn) c.colorDyn = { ...b.colorDyn };
  if (b.wet) c.wet = { ...b.wet };
  if (b.curves) c.curves = { ...b.curves };
  return c;
}

/** The fields that differ between two brushes (a removed field is undefined), for brushStore.edit. */
export function brushDiff(from: Brush, to: Brush): Partial<Brush> {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const k of keys) {
    if (k === 'id' || k === 'set' || k === 'name' || k === 'custom' || k === 'lib') continue;
    const a = (from as unknown as Rec)[k], b = (to as unknown as Rec)[k];
    const same = a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && !(a instanceof Uint8Array) && !('data' in (a as object)) && JSON.stringify(a) === JSON.stringify(b));
    if (!same) patch[k] = b;
  }
  return patch as Partial<Brush>;
}
