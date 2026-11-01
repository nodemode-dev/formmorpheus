// Gradient map: each pixel's brightness looks up a color on a three-stop ramp (shadows, midtones, highlights).
// Black and white points stretch the brightness first; Amount mixes the result with the original. Alpha is kept.
import { colorParams, registerEffect, rgbOf, type Effect, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><defs><linearGradient id="fmgm" x1="0" x2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".15"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><rect x="3" y="7" width="18" height="10" rx="2" fill="url(#fmgm)"/></svg>';

const FX = `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uMid;
uniform float uLo;
uniform float uHi;
uniform float uAmount;
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  if (s.a <= 0.0) return s;
  vec3 c = s.rgb / s.a;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float t = clamp((l - uLo) / max(uHi - uLo, 0.001), 0.0, 1.0);
  vec3 g = t < uMid ? mix(uC0, uC1, t / max(uMid, 0.001)) : mix(uC1, uC2, (t - uMid) / max(1.0 - uMid, 0.001));
  return vec4(mix(c, g, uAmount) * s.a, s.a);
}`;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const effect: Effect = {
  id: 'gradmap',
  label: 'Gradient Map',
  icon: ICON,
  params: [
    { id: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 1 },
    ...colorParams('lo', 'Shadows', [0.05, 0.02, 0.2]),
    ...colorParams('mid', 'Midtones', [0.85, 0.2, 0.4]),
    ...colorParams('hi', 'Highlights', [1, 0.95, 0.6]),
    { id: 'midpos', label: 'Midtone position', short: 'Mid pos', min: 0.02, max: 0.98, step: 0.01, unit: '%', display: 100, def: 0.5 },
    { id: 'black', label: 'Black point', short: 'Black', min: 0, max: 0.95, step: 0.01, unit: '%', display: 100, def: 0, adv: true },
    { id: 'white', label: 'White point', short: 'White', min: 0.05, max: 1, step: 0.01, unit: '%', display: 100, def: 1, adv: true },
  ],
  active: (p) => p.amount > 0,
  pad: () => 0,
  cpu(src, dst, w, _h, p, _o, _c, box) {
    const c0 = rgbOf(p, 'lo'), c1 = rgbOf(p, 'mid'), c2 = rgbOf(p, 'hi');
    const mid = p.midpos, lo = p.black, span = Math.max(p.white - p.black, 0.001), amt = p.amount;
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const a = src[i + 3];
        if (a === 0) continue;
        const r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const t = clamp01((l - lo) / span);
        let k: number, A: number[], B: number[];
        if (t < mid) { k = t / Math.max(mid, 0.001); A = c0; B = c1; } else { k = (t - mid) / Math.max(1 - mid, 0.001); A = c1; B = c2; }
        dst[i] = (r + (A[0] + (B[0] - A[0]) * k - r) * amt) * 255 + 0.5;
        dst[i + 1] = (g + (A[1] + (B[1] - A[1]) * k - g) * amt) * 255 + 0.5;
        dst[i + 2] = (b + (A[2] + (B[2] - A[2]) * k - b) * amt) * 255 + 0.5;
        dst[i + 3] = a;
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams) => ({ uC0: rgbOf(p, 'lo'), uC1: rgbOf(p, 'mid'), uC2: rgbOf(p, 'hi'), uMid: p.midpos, uLo: p.black, uHi: p.black + Math.max(p.white - p.black, 0.001), uAmount: p.amount }),
  }],
};

registerEffect(effect);
