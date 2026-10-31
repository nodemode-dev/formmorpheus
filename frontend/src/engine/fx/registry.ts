// Effect registry: one place that describes a live effect (parameters, options, CPU maths, GPU passes) so the
// keyframe lanes, the Action menu, the CPU renderer and the GPU compositor all read the same definition.
//
// STABLE API (other builders add effects against this; do not change it without telling them):
//   1. Write engine/fx/<name>.ts that builds an `Effect` and calls `registerEffect(effect)` at module load.
//   2. Add one line `import './<name>';` to engine/fx/index.ts. That is all: the lane kind `fx:<id>`, the Action
//      menu row (Live Filters list) and the CPU and GPU passes follow from the definition.
//   Effect: { id, label, icon, params[], options?, custom?, active(p,o), pad(p,o,ctx), cpu(src,dst,w,h,p,o,ctx,box), gpu[] }
//   - params are keyable lane channels (movie px params are multiplied by ctx.scale by the effect itself); a colour is
//     three channels made by colorParams(); options are not keyed (choices or booleans, or a string for `custom`).
//   - cpu: src and dst are straight-alpha RGBA8 w*h, dst is zeroed and only `box` needs writing; pure, no DOM.
//   - gpu: ordered steps on premultiplied surfaces. A 'shader' step is the body of `vec4 fx(ivec2 p)` (helpers and
//     uniforms declared above it; `uSrc` is the effect input, `uS0..uS3` earlier step results, `uTable` a float
//     table, `uScale`, `uO` (stage origin px), `uM` (stage size in movie px) always exist; do not name a uniform
//     `uSize` or `uBox`, the vertex shader owns those). A 'blur' step is a
//     Gaussian of the given sigma (px) of an earlier result. The last step is the effect's output.
//   Effects run after the built-in filters, in lane order (the order of the KEY_KINDS list).
// Pure, no DOM.
import { registerKind, type ChannelSpec, type FxInst, type KindSpec } from '../keys';
import type { KeyKind } from '../types';

export type FxParams = Record<string, number>;
export type FxOpts = Record<string, string | number | boolean>;

/** Surface geometry an effect works in: px on the surface = movie px * scale + origin. */
export interface FxCtx {
  scale: number;
  ox: number;
  oy: number;
  /** The movie's size in movie px (the Stage the effect is framed to). */
  mw: number;
  mh: number;
}

export interface FxBox { x0: number; y0: number; x1: number; y1: number }

export type Uniforms = Record<string, number | number[]>;

export type GpuStep =
  | { kind: 'shader'; glsl: string; reads?: number[]; uniforms?: (p: FxParams, o: FxOpts, c: FxCtx) => Uniforms; table?: (p: FxParams, o: FxOpts) => Float32Array }
  | { kind: 'blur'; from: number; sigma: (p: FxParams, o: FxOpts, c: FxCtx) => number };

export interface FxParam {
  id: string;
  label: string;
  short?: string;
  min: number;
  max: number;
  step: number;
  unit: ChannelSpec['unit'];
  /** Multiply the stored value by this to display it (100 for percent). */
  display?: number;
  def: number;
  /** Heading of the section the row sits under in the card. */
  group?: string;
  /** Rows of less use sit in the card's Advanced part. */
  adv?: boolean;
  /** First channel of a colour: the card draws a swatch for the channels `${swatch}R`, `G`, `B`. */
  swatch?: string;
}

/** `hidden`: stored on the lane but drawn by the card's `custom` control, not as a row. */
export interface FxOption { id: string; label: string; choices?: string[]; def: string | number | boolean; hidden?: boolean }

export interface Effect {
  id: string;
  label: string;
  icon: string;
  params: FxParam[];
  options?: FxOption[];
  /** A card extra drawn by ui/fx-card.ts (a curve editor). */
  custom?: 'curves';
  /** False when the values change nothing (the effect is then skipped on both paths). */
  active(p: FxParams, o: FxOpts): boolean;
  /** Surface px the result may reach past the source's own bounds (a shadow, a glow, a blur). */
  pad(p: FxParams, o: FxOpts, c: FxCtx): number;
  cpu(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, p: FxParams, o: FxOpts, c: FxCtx, box: FxBox): void;
  /** The passes, or a function of the values when the pass list depends on them (a mode that skips a blur). */
  gpu: GpuStep[] | ((p: FxParams, o: FxOpts) => GpuStep[]);
}

export function gpuSteps(e: Effect, p: FxParams, o: FxOpts): GpuStep[] {
  return typeof e.gpu === 'function' ? e.gpu(p, o) : e.gpu;
}

const EFFECTS = new Map<string, Effect>();

export const FX_PREFIX = 'fx:';

export function fxKind(id: string): KeyKind { return (FX_PREFIX + id) as KeyKind; }
export function effectOf(id: string): Effect | undefined { return EFFECTS.get(id); }
export function allEffects(): Effect[] { return [...EFFECTS.values()]; }

/** Three channels (`${id}R`, `G`, `B`, 0..1 shown as 0 to 255) for a colour; the first carries the swatch. */
export function colorParams(id: string, label: string, def: [number, number, number], extra: Partial<FxParam> = {}): FxParam[] {
  return (['R', 'G', 'B'] as const).map((k, i) => ({
    id: id + k, label: `${label} ${k === 'R' ? 'red' : k === 'G' ? 'green' : 'blue'}`, short: `${label.slice(0, 3)} ${k}`,
    min: 0, max: 1, step: 0.01, unit: '' as const, display: 255, def: def[i], ...extra, ...(i === 0 ? { swatch: id } : {}),
  }));
}

export function rgbOf(p: FxParams, id: string): [number, number, number] {
  return [p[id + 'R'] ?? 0, p[id + 'G'] ?? 0, p[id + 'B'] ?? 0];
}

function specOf(e: Effect): KindSpec {
  return {
    kind: fxKind(e.id),
    label: e.label,
    group: 'filter',
    icon: e.icon,
    fx: true,
    custom: e.custom,
    channels: e.params.map((q) => ({
      id: q.id, label: q.label, short: q.short ?? q.label, min: q.min, max: q.max, step: q.step, unit: q.unit, display: q.display ?? (q.unit === '%' ? 100 : 1), def: q.def,
      ...(q.group ? { group: q.group } : {}), ...(q.adv ? { adv: true } : {}), ...(q.swatch ? { swatch: q.swatch } : {}),
    })),
    options: e.options?.map((q) => ({ id: q.id, label: q.label, ...(q.choices ? { choices: q.choices } : {}), def: q.def, ...(q.hidden ? { hidden: true } : {}) })),
  };
}

/** Add an effect (once per id); its lane kind is `fx:<id>`. */
export function registerEffect(e: Effect): void {
  if (EFFECTS.has(e.id)) return;
  EFFECTS.set(e.id, e);
  registerKind(specOf(e));
}

/** The effects a content shows, in order, minus the ones whose values change nothing. */
export function activeFx(list: FxInst[] | null | undefined): { e: Effect; inst: FxInst }[] {
  const out: { e: Effect; inst: FxInst }[] = [];
  if (!list) return out;
  for (const inst of list) {
    const e = EFFECTS.get(inst.id);
    if (e && e.active(inst.p, inst.o)) out.push({ e, inst });
  }
  return out;
}

let spareBuf: Uint8ClampedArray | null = null;

/**
 * CPU path: runs the active effects on straight RGBA8 `data` (w*h). Returns the array holding the result, which is
 * `data` or the internal spare buffer (valid until the next call): the caller copies it back if it is not `data`.
 */
export function applyFxCpu(list: { e: Effect; inst: FxInst }[], data: Uint8ClampedArray, w: number, h: number, c: FxCtx): Uint8ClampedArray {
  if (!list.length) return data;
  if (!spareBuf || spareBuf.length !== data.length) spareBuf = new Uint8ClampedArray(data.length);
  let cur = data;
  let other = spareBuf;
  for (const { e, inst } of list) {
    const box = alphaBox(cur, w, h);
    if (!box) continue;
    const pad = Math.ceil(e.pad(inst.p, inst.o, c));
    box.x0 = Math.max(0, box.x0 - pad); box.y0 = Math.max(0, box.y0 - pad);
    box.x1 = Math.min(w, box.x1 + pad); box.y1 = Math.min(h, box.y1 + pad);
    other.fill(0);
    e.cpu(cur, other, w, h, inst.p, inst.o, c, box);
    const t = cur; cur = other; other = t;
  }
  return cur;
}

/** Bounds of the pixels with alpha, or null for an empty picture. */
export function alphaBox(d: Uint8ClampedArray, w: number, h: number): FxBox | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let i = y * w * 4 + 3;
    let first = -1, last = -1;
    for (let x = 0; x < w; x++, i += 4) if (d[i] !== 0) { if (first < 0) first = x; last = x; }
    if (first >= 0) { if (first < x0) x0 = first; if (last > x1) x1 = last; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
