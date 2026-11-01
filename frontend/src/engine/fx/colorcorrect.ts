// Color correction in one effect: exposure, temperature and tint, levels (master and per channel), curves (master and
// per channel), color balance (shadows, midtones, highlights) and vibrance, in that order. Levels and curves are
// baked into one table per channel (1024 steps, linear between) that both paths read the same way.
import { cleanPoints, curveAt, curveLut, MAX_NODES } from '../../paint/curves';
import { registerEffect, type Effect, type FxOpts, type FxParam, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20c4-1 5-6 8-8s5-5 8-8"/><path d="M4 20h16V4" opacity=".4"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/></svg>';

export const CURVE_IDS = ['L', 'R', 'G', 'B'] as const;
export const TABLE_N = 1024;
const CH = ['r', 'g', 'b'] as const;
const levelsDef = (pre: string, group: string, adv: boolean) => [
  { id: pre + 'In0', label: 'In black', short: `${group[0]} In 0`, min: 0, max: 1, step: 0.005, unit: '%' as const, display: 100, def: 0, group, adv },
  { id: pre + 'In1', label: 'In white', short: `${group[0]} In 1`, min: 0, max: 1, step: 0.005, unit: '%' as const, display: 100, def: 1, group, adv },
  { id: pre + 'Gamma', label: 'Gamma', short: `${group[0]} Gamma`, min: 0.1, max: 4, step: 0.01, unit: '' as const, display: 1, def: 1, group, adv },
  { id: pre + 'Out0', label: 'Out black', short: `${group[0]} Out 0`, min: 0, max: 1, step: 0.005, unit: '%' as const, display: 100, def: 0, group, adv },
  { id: pre + 'Out1', label: 'Out white', short: `${group[0]} Out 1`, min: 0, max: 1, step: 0.005, unit: '%' as const, display: 100, def: 1, group, adv },
];

const bal = (id: string, label: string, short: string, group: string) => ({ id, label, short, min: -1, max: 1, step: 0.01, unit: '%' as const, display: 100, def: 0, group, adv: true });

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function levels(v: number, p: FxParams, pre: string): number {
  const i0 = p[pre + 'In0'], i1 = Math.max(p[pre + 'In1'], i0 + 1e-4), g = Math.max(0.01, p[pre + 'Gamma']);
  const o0 = p[pre + 'Out0'], o1 = p[pre + 'Out1'];
  return o0 + (o1 - o0) * Math.pow(clamp01((v - i0) / (i1 - i0)), 1 / g);
}

/** Curve points of an option string ("x,y,x,y"), or null for the straight line. */
export function parseCurve(s: unknown): number[] | null {
  if (typeof s !== 'string' || !s) return null;
  const v = s.split(',').map(Number);
  if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null;
  const pts = cleanPoints(v);
  return pts.length === 4 && pts[1] === 0 && pts[3] === 1 ? null : pts;
}

/** Keyable curve points: channel `cv${id}${i}` moves point i of that curve up or down (from the saved curve; a straight curve has two points). */
const CURVE_NAMES: Record<string, string> = { L: 'Master', R: 'Red', G: 'Green', B: 'Blue' };
const POINTS = MAX_NODES + 2;
export const curvePointId = (id: string, i: number): string => `cv${id}${i}`;
const curvePointParams = (): FxParam[] => CURVE_IDS.flatMap((id) => Array.from({ length: POINTS }, (_, i): FxParam => ({
  id: curvePointId(id, i), label: `${CURVE_NAMES[id]} curve point ${i + 1}`, short: `${id} pt ${i + 1}`,
  min: -1, max: 1, step: 0.005, unit: '%', display: 100, def: 0, group: 'Curve points', adv: true, demand: true,
})));

/** A curve's points at this frame: the saved ones with their keyed offsets laid on, or null for the straight line. */
export function curveAtFrame(id: string, p: FxParams, o: FxOpts): number[] | null {
  const base = parseCurve(o['curve' + id]);
  let moved = false;
  for (let i = 0; i < POINTS; i++) if (p[curvePointId(id, i)]) { moved = true; break; }
  if (!moved) return base;
  const pts = (base ?? [0, 0, 1, 1]).slice();
  for (let i = 0; i < pts.length / 2; i++) pts[i * 2 + 1] += p[curvePointId(id, i)] ?? 0;
  const clean = cleanPoints(pts);
  return clean.length === 4 && clean[1] === 0 && clean[3] === 1 ? null : clean;
}

/** Per-channel table: levels then curves, RGBA float (alpha unused), TABLE_N rows. */
export function buildTable(p: FxParams, o: FxOpts): Float32Array {
  const t = new Float32Array(TABLE_N * 4);
  const mix = clamp01(p.curveMix);
  const luts = CURVE_IDS.map((id) => { const pts = curveAtFrame(id, p, o); return pts ? curveLut({ pts }) : null; });
  for (let i = 0; i < TABLE_N; i++) {
    const x = i / (TABLE_N - 1);
    for (let c = 0; c < 3; c++) {
      let v = levels(levels(x, p, CH[c]), p, 'lv');
      for (const lut of [luts[1 + c], luts[0]]) if (lut) v += (curveAt(lut, clamp01(v)) - v) * mix;
      t[i * 4 + c] = clamp01(v);
    }
  }
  return t;
}

function tableAt(t: Float32Array, v: number, c: number): number {
  const x = clamp01(v) * (TABLE_N - 1), i0 = Math.floor(x), i1 = Math.min(i0 + 1, TABLE_N - 1), f = x - i0;
  return t[i0 * 4 + c] + (t[i1 * 4 + c] - t[i0 * 4 + c]) * f;
}

const BALANCE = ['sR', 'sG', 'sB', 'mR', 'mG', 'mB', 'hR', 'hG', 'hB'];

const FX = `
uniform sampler2D uTable;
uniform float uExp;
uniform vec3 uGain;
uniform float uVib;
uniform vec3 uSh;
uniform vec3 uMid;
uniform vec3 uHi;
vec3 lut(vec3 c) {
  vec3 x = clamp(c, 0.0, 1.0) * 1023.0;
  ivec3 i0 = ivec3(floor(x));
  ivec3 i1 = min(i0 + 1, ivec3(1023));
  vec3 f = x - vec3(i0);
  return vec3(
    mix(texelFetch(uTable, ivec2(i0.r, 0), 0).r, texelFetch(uTable, ivec2(i1.r, 0), 0).r, f.r),
    mix(texelFetch(uTable, ivec2(i0.g, 0), 0).g, texelFetch(uTable, ivec2(i1.g, 0), 0).g, f.g),
    mix(texelFetch(uTable, ivec2(i0.b, 0), 0).b, texelFetch(uTable, ivec2(i1.b, 0), 0).b, f.b));
}
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  if (s.a <= 0.0) return vec4(0.0);
  vec3 c = s.rgb / s.a * uGain;
  c = lut(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float wS = (1.0 - l) * (1.0 - l), wH = l * l, wM = 1.0 - wS - wH;
  c = clamp(c + 0.5 * (wS * uSh + wM * uMid + wH * uHi), 0.0, 1.0);
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float k = uVib >= 0.0 ? uVib * (1.0 - (mx - mn)) : uVib;
  float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(l2 + (c - l2) * (1.0 + k), 0.0, 1.0);
  return vec4(c * s.a, s.a);
}`;

function gains(p: FxParams): [number, number, number] {
  const e = Math.pow(2, p.exposure);
  return [e * (1 + 0.25 * p.temp), e * (1 - 0.25 * p.tint), e * (1 - 0.25 * p.temp)];
}

const effect: Effect = {
  id: 'colorcorrect',
  label: 'Color Correction',
  icon: ICON,
  custom: 'curves',
  params: [
    { id: 'exposure', label: 'Exposure', short: 'Exposure', min: -4, max: 4, step: 0.01, unit: '', display: 1, def: 0, group: 'Light' },
    { id: 'temp', label: 'Temp', short: 'Temp', min: -1, max: 1, step: 0.01, unit: '%', display: 100, def: 0 },
    { id: 'tint', label: 'Tint', short: 'Tint', min: -1, max: 1, step: 0.01, unit: '%', display: 100, def: 0 },
    { id: 'vibrance', label: 'Vibrance', short: 'Vibrance', min: -1, max: 1, step: 0.01, unit: '%', display: 100, def: 0 },
    ...levelsDef('lv', 'Levels', false),
    { id: 'curveMix', label: 'Curve mix', short: 'Curves', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 1, group: 'Curves' },
    ...levelsDef('r', 'Red levels', true),
    ...levelsDef('g', 'Green levels', true),
    ...levelsDef('b', 'Blue levels', true),
    bal('sR', 'Shadows red', 'Sh R', 'Color balance'), bal('sG', 'Shadows green', 'Sh G', 'Color balance'), bal('sB', 'Shadows blue', 'Sh B', 'Color balance'),
    bal('mR', 'Midtones red', 'Mid R', 'Color balance'), bal('mG', 'Midtones green', 'Mid G', 'Color balance'), bal('mB', 'Midtones blue', 'Mid B', 'Color balance'),
    bal('hR', 'Highlights red', 'Hi R', 'Color balance'), bal('hG', 'Highlights green', 'Hi G', 'Color balance'), bal('hB', 'Highlights blue', 'Hi B', 'Color balance'),
    ...curvePointParams(),
  ],
  options: CURVE_IDS.map((id) => ({ id: 'curve' + id, label: `Curve ${id}`, def: '', hidden: true })),
  active(p, o) {
    if (p.exposure || p.temp || p.tint || p.vibrance) return true;
    for (const pre of ['lv', 'r', 'g', 'b']) if (p[pre + 'In0'] || p[pre + 'In1'] !== 1 || p[pre + 'Gamma'] !== 1 || p[pre + 'Out0'] || p[pre + 'Out1'] !== 1) return true;
    if (BALANCE.some((k) => p[k])) return true;
    return CURVE_IDS.some((id) => curveAtFrame(id, p, o) !== null) && p.curveMix > 0;
  },
  pad: () => 0,
  cpu(src, dst, w, _h, p, o, _c, box) {
    const t = buildTable(p, o), [gr, gg, gb] = gains(p);
    const sh = [p.sR, p.sG, p.sB], mi = [p.mR, p.mG, p.mB], hi = [p.hR, p.hG, p.hB];
    const vib = p.vibrance;
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const a = src[i + 3];
        if (a === 0) continue;
        let r = tableAt(t, (src[i] / 255) * gr, 0), g = tableAt(t, (src[i + 1] / 255) * gg, 1), b = tableAt(t, (src[i + 2] / 255) * gb, 2);
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        const wS = (1 - l) * (1 - l), wH = l * l, wM = 1 - wS - wH;
        r = clamp01(r + 0.5 * (wS * sh[0] + wM * mi[0] + wH * hi[0]));
        g = clamp01(g + 0.5 * (wS * sh[1] + wM * mi[1] + wH * hi[1]));
        b = clamp01(b + 0.5 * (wS * sh[2] + wM * mi[2] + wH * hi[2]));
        const k = vib >= 0 ? vib * (1 - (Math.max(r, g, b) - Math.min(r, g, b))) : vib;
        const l2 = r * 0.2126 + g * 0.7152 + b * 0.0722;
        dst[i] = clamp01(l2 + (r - l2) * (1 + k)) * 255; dst[i + 1] = clamp01(l2 + (g - l2) * (1 + k)) * 255; dst[i + 2] = clamp01(l2 + (b - l2) * (1 + k)) * 255; dst[i + 3] = a;
      }
    }
  },
  gpu: (): GpuStep[] => [
    {
      kind: 'shader', glsl: FX, table: buildTable,
      uniforms: (p: FxParams) => ({ uGain: gains(p), uVib: p.vibrance, uSh: [p.sR, p.sG, p.sB], uMid: [p.mR, p.mG, p.mB], uHi: [p.hR, p.hG, p.hB] }),
    },
  ],
};

registerEffect(effect);
