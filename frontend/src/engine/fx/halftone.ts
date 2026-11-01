// Halftone: the picture rebuilt as a grid of round dots, turned to an angle. Each cell reads the picture once at its
// centre and sizes its dot by brightness. Colors: dots keep the picture color, or one ink color (on clear, or on a paper color).
// The grid is anchored to the Stage corner. Same cell reads and dot maths on both paths.
import { colorParams, registerEffect, rgbOf, type Effect, type FxCtx, type FxOpts, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="6" cy="6" r="2.6"/><circle cx="12" cy="6" r="1.8"/><circle cx="18" cy="6" r="1"/><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="2.6"/><circle cx="18" cy="12" r="1.8"/><circle cx="6" cy="18" r="1"/><circle cx="12" cy="18" r="1.8"/><circle cx="18" cy="18" r="2.6"/></svg>';

const MODES = ['picture color', 'ink on clear', 'ink on paper'];
const modeOf = (o: FxOpts): number => Math.max(0, MODES.indexOf(String(o.mode)));
// cells under 5 surface px alias into a moire (a zoomed-out Stage): the dot shape fades into its flat average coverage
const cell = (p: FxParams, c: FxCtx): number => Math.max(1, p.size * c.scale);
const flatW = (s: number): number => { const t = (5 - s) / 3; return t < 0 ? 0 : t > 1 ? 1 : t; };
const rad = (p: FxParams): number => (p.angle * Math.PI) / 180;
const edge = (p: FxParams, c: FxCtx): number => Math.max(1, p.soft * cell(p, c) * 0.5);

const FX = `
uniform float uCell;
uniform float uCos;
uniform float uSin;
uniform float uEdge;
uniform float uGain;
uniform float uMode;
uniform float uAmount;
uniform vec3 uInk;
uniform vec3 uPaper;
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  vec4 s0 = texelFetch(uSrc, p, 0);
  vec2 u = vec2(p) + 0.5 - uO;
  vec2 r = vec2(uCos * u.x + uSin * u.y, -uSin * u.x + uCos * u.y);
  vec2 c = (floor(r / uCell) + 0.5) * uCell;
  vec2 cs = vec2(uCos * c.x - uSin * c.y, uSin * c.x + uCos * c.y) + uO;
  vec4 s = texelFetch(uSrc, clamp(ivec2(floor(cs + 0.01)), ivec2(0), sz - 1), 0);
  vec3 col = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float cov = uMode < 0.5 ? max(col.r, max(col.g, col.b)) : 1.0 - l;
  cov = clamp(cov * uGain, 0.0, 1.0) * s.a;
  float radius = 0.70710678 * uCell * sqrt(cov);
  float k = clamp((radius - length(r - c)) / uEdge + 0.5, 0.0, 1.0);
  k = mix(k, min(1.0, cov * 1.5708), clamp((5.0 - uCell) / 3.0, 0.0, 1.0));
  vec4 h;
  if (uMode < 0.5) h = s * k;
  else if (uMode < 1.5) { float a = s.a * k; h = vec4(uInk * a, a); }
  else h = vec4(mix(uPaper, uInk, k) * s0.a, s0.a);
  return mix(s0, h, uAmount);
}`;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const effect: Effect = {
  id: 'halftone',
  label: 'Halftone',
  icon: ICON,
  params: [
    { id: 'size', label: 'Cell size', min: 3, max: 120, step: 0.5, unit: 'px', def: 12 },
    { id: 'angle', label: 'Angle', min: -360, max: 360, step: 1, unit: 'deg', def: 45 },
    { id: 'soft', label: 'Softness', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.1 },
    { id: 'gain', label: 'Dot size', short: 'Dots', min: 0.2, max: 2, step: 0.01, unit: '%', display: 100, def: 1 },
    { id: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 1 },
    ...colorParams('ink', 'Ink', [0.05, 0.05, 0.08]),
    ...colorParams('paper', 'Paper', [0.97, 0.95, 0.9], { adv: true }),
  ],
  options: [{ id: 'mode', label: 'Colors', choices: MODES, def: 'picture color' }],
  active: (p) => p.amount > 0,
  // a dot whose cell centre is inside the picture can reach past its edge
  pad: (p, _o, c) => Math.ceil(cell(p, c)) + 1,
  cpu(src, dst, w, h, p, o, c, box) {
    const mode = modeOf(o), s = cell(p, c), th = rad(p), cs = Math.cos(th), sn = Math.sin(th), ed = edge(p, c), amt = p.amount;
    const [ir, ig, ib] = rgbOf(p, 'ink'), [pr, pg, pb] = rgbOf(p, 'paper');
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const di = (y * w + x) * 4;
        const a0 = src[di + 3] / 255;
        const ux = x + 0.5 - c.ox, uy = y + 0.5 - c.oy;
        const rx = cs * ux + sn * uy, ry = -sn * ux + cs * uy;
        const cx = (Math.floor(rx / s) + 0.5) * s, cy = (Math.floor(ry / s) + 0.5) * s;
        const sx = Math.min(w - 1, Math.max(0, Math.floor(cs * cx - sn * cy + c.ox + 0.01))), sy = Math.min(h - 1, Math.max(0, Math.floor(sn * cx + cs * cy + c.oy + 0.01)));
        const ci = (sy * w + sx) * 4;
        const ca = src[ci + 3] / 255;
        const cr = src[ci] / 255, cg = src[ci + 1] / 255, cb = src[ci + 2] / 255;
        const l = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        let cov = ca > 0 ? (mode === 0 ? Math.max(cr, cg, cb) : 1 - l) : 0;
        cov = clamp01(cov * p.gain) * ca;
        const radius = 0.70710678 * s * Math.sqrt(cov);
        const fw = flatW(s);
        let k = clamp01((radius - Math.hypot(rx - cx, ry - cy)) / ed + 0.5);
        if (fw > 0) k += (Math.min(1, cov * 1.5708) - k) * fw;
        // premultiplied halftone value, then mixed with the premultiplied original
        let hr: number, hg: number, hb: number, ha: number;
        if (mode === 0) { ha = ca * k; hr = cr * ha; hg = cg * ha; hb = cb * ha; }
        else if (mode === 1) { ha = ca * k; hr = ir * ha; hg = ig * ha; hb = ib * ha; }
        else { ha = a0; hr = (pr + (ir - pr) * k) * a0; hg = (pg + (ig - pg) * k) * a0; hb = (pb + (ib - pb) * k) * a0; }
        const or = (src[di] / 255) * a0, og = (src[di + 1] / 255) * a0, ob = (src[di + 2] / 255) * a0;
        const fr = or + (hr - or) * amt, fg = og + (hg - og) * amt, fb = ob + (hb - ob) * amt, fa = a0 + (ha - a0) * amt;
        if (fa <= 0) continue;
        dst[di] = (fr / fa) * 255 + 0.5; dst[di + 1] = (fg / fa) * 255 + 0.5; dst[di + 2] = (fb / fa) * 255 + 0.5; dst[di + 3] = fa * 255 + 0.5;
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams, o: FxOpts, c: FxCtx) => ({
      uCell: cell(p, c), uCos: Math.cos(rad(p)), uSin: Math.sin(rad(p)), uEdge: edge(p, c), uGain: p.gain, uMode: modeOf(o), uAmount: p.amount,
      uInk: rgbOf(p, 'ink'), uPaper: rgbOf(p, 'paper'),
    }),
  }],
};

registerEffect(effect);
