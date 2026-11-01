// Sharpen with a radius: the picture plus Amount times its difference from a Gaussian blur of that Radius (an unsharp mask).
// A small radius sharpens fine detail, a large one adds local contrast. Threshold leaves flat areas alone. Alpha is kept.
import { gaussianBlur, scratchRaster } from '../../paint/filters';
import { registerEffect, type Effect, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l8 14H4z"/><path d="M12 9.5v4" opacity=".6"/></svg>';

const COPY = `vec4 fx(ivec2 p) { return texelFetch(uSrc, p, 0); }`;

const MIX = `
uniform float uAmt;
uniform float uThr;
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  vec4 b = texelFetch(uS1, p, 0);
  vec3 d = s.rgb - b.rgb;
  float l = dot(d, vec3(0.299, 0.587, 0.114));
  float k = uThr <= 0.0 ? 1.0 : smoothstep(0.0, uThr, abs(l));
  return vec4(clamp(s.rgb + d * uAmt * k, 0.0, s.a), s.a);
}`;

const sstep = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const effect: Effect = {
  id: 'unsharp',
  label: 'Sharpen Radius',
  icon: ICON,
  params: [
    { id: 'amount', label: 'Amount', min: 0, max: 5, step: 0.05, unit: '%', display: 100, def: 1.5 },
    { id: 'radius', label: 'Radius', min: 0.5, max: 60, step: 0.5, unit: 'px', def: 3 },
    { id: 'threshold', label: 'Threshold', min: 0, max: 0.5, step: 0.005, unit: '%', display: 100, def: 0 },
  ],
  active: (p) => p.amount > 0,
  pad: () => 0,
  cpu(src, dst, w, h, p, _o, c, box) {
    const A = scratchRaster('fx-us-a', w, h), B = scratchRaster('fx-us-b', w, h);
    A.data.set(src);
    gaussianBlur(A, B, p.radius * c.scale);
    const bd = B.data, amt = p.amount, thr = p.threshold;
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const al = src[i + 3];
        if (al === 0) continue;
        const sa = al / 255, ba = bd[i + 3] / 255;
        const sr = (src[i] / 255) * sa, sg = (src[i + 1] / 255) * sa, sb = (src[i + 2] / 255) * sa;
        const dr = sr - (bd[i] / 255) * ba, dg = sg - (bd[i + 1] / 255) * ba, db = sb - (bd[i + 2] / 255) * ba;
        const k = thr <= 0 ? 1 : sstep(0, thr, Math.abs(0.299 * dr + 0.587 * dg + 0.114 * db));
        const r = Math.min(sa, Math.max(0, sr + dr * amt * k)), g = Math.min(sa, Math.max(0, sg + dg * amt * k)), b = Math.min(sa, Math.max(0, sb + db * amt * k));
        dst[i] = (r / sa) * 255 + 0.5; dst[i + 1] = (g / sa) * 255 + 0.5; dst[i + 2] = (b / sa) * 255 + 0.5; dst[i + 3] = al;
      }
    }
  },
  gpu: (): GpuStep[] => [
    { kind: 'shader', glsl: COPY },
    { kind: 'blur', from: 0, sigma: (p: FxParams, _o, c) => (p.radius * c.scale) / 2 },
    { kind: 'shader', glsl: MIX, reads: [1], uniforms: (p: FxParams) => ({ uAmt: p.amount, uThr: p.threshold }) },
  ],
};

registerEffect(effect);
