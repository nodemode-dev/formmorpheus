// Outline: a stroke around the alpha edge, outside, inside or centered on it. The stroke reach is the largest alpha
// (or, inside, the largest transparency) within a round window of the stroke width, with an antialiased falloff.
// Wide strokes sample every Nth pixel (at most 12 steps a side) and soften the edge by that step. Same taps on both paths.
import { colorParams, registerEffect, rgbOf, type Effect, type FxCtx, type FxOpts, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" opacity=".35"/><rect x="4" y="4" width="16" height="16" rx="4"/></svg>';

const POS = ['outside', 'inside', 'center'];
const posOf = (o: FxOpts): number => Math.max(0, POS.indexOf(String(o.position)));
const MAXN = 12;

interface Geo { out: number; inn: number; step: number; n: number; ramp: number }
/** Reach outside and inside the edge (surface px), the sampling step, taps per side and the edge ramp length. */
function geo(p: FxParams, o: FxOpts, c: FxCtx): Geo {
  const wpx = p.width * c.scale, pos = posOf(o);
  const out = pos === 0 ? wpx : pos === 2 ? wpx / 2 : 0;
  const inn = pos === 1 ? wpx : pos === 2 ? wpx / 2 : 0;
  const reach = Math.max(out, inn);
  const step = Math.max(1, Math.ceil(reach / MAXN));
  const ramp = Math.max(1, p.soft * c.scale, step);
  const n = Math.min(MAXN + 1, Math.ceil((reach + ramp / 2) / step));
  return { out, inn, step, n, ramp };
}

const FX = `
uniform vec3 uInk;
uniform float uOp;
uniform float uOut;
uniform float uIn;
uniform float uStep;
uniform float uN;
uniform float uRamp;
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  vec4 s = texelFetch(uSrc, p, 0);
  float dil = 0.0;
  float ero = 0.0;
  for (int j = -13; j <= 13; j++) {
    if (abs(float(j)) > uN) continue;
    for (int i = -13; i <= 13; i++) {
      if (abs(float(i)) > uN) continue;
      float d = length(vec2(float(i), float(j))) * uStep;
      ivec2 q = p + ivec2(i, j) * int(uStep);
      float a = (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) ? 0.0 : texelFetch(uSrc, q, 0).a;
      if (uOut > 0.0) dil = max(dil, a * clamp((uOut - d) / uRamp + 0.5, 0.0, 1.0));
      if (uIn > 0.0) ero = max(ero, (1.0 - a) * clamp((uIn - d) / uRamp + 0.5, 0.0, 1.0));
    }
  }
  vec4 r = s;
  if (uOut > 0.0) {
    float k = dil * uOp * (1.0 - s.a);
    r = s + vec4(uInk * k, k);
  }
  if (uIn > 0.0) {
    float k = ero * uOp;
    r = vec4(r.rgb * (1.0 - k) + uInk * r.a * k, r.a);
  }
  return r;
}`;

const effect: Effect = {
  id: 'outline',
  label: 'Outline',
  icon: ICON,
  params: [
    { id: 'width', label: 'Width', min: 0, max: 60, step: 0.5, unit: 'px', def: 8 },
    { id: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 1 },
    { id: 'soft', label: 'Softness', min: 0, max: 40, step: 0.5, unit: 'px', def: 0 },
    ...colorParams('ink', 'Color', [1, 0.45, 0.05]),
  ],
  options: [{ id: 'position', label: 'Position', choices: POS, def: 'outside' }],
  active: (p) => p.width > 0 && p.opacity > 0,
  pad: (p, o, c) => { const g = geo(p, o, c); return Math.ceil(g.out + g.ramp / 2) + 2; },
  cpu(src, dst, w, h, p, o, c, box) {
    const g = geo(p, o, c), op = p.opacity;
    const [ir, ig, ib] = rgbOf(p, 'ink');
    const stp = g.step | 0;
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const si = (y * w + x) * 4;
        const sa = src[si + 3] / 255;
        let dil = 0, ero = 0;
        for (let j = -g.n; j <= g.n; j++) {
          const qy = y + j * stp;
          for (let i = -g.n; i <= g.n; i++) {
            const d = Math.hypot(i, j) * g.step;
            const qx = x + i * stp;
            const a = qx < 0 || qy < 0 || qx >= w || qy >= h ? 0 : src[(qy * w + qx) * 4 + 3] / 255;
            if (g.out > 0) { const v = a * Math.min(1, Math.max(0, (g.out - d) / g.ramp + 0.5)); if (v > dil) dil = v; }
            if (g.inn > 0) { const v = (1 - a) * Math.min(1, Math.max(0, (g.inn - d) / g.ramp + 0.5)); if (v > ero) ero = v; }
          }
        }
        let pr = (src[si] / 255) * sa, pg = (src[si + 1] / 255) * sa, pb = (src[si + 2] / 255) * sa, pa = sa;
        if (g.out > 0) {
          const k = dil * op * (1 - sa);
          pr += ir * k; pg += ig * k; pb += ib * k; pa += k;
        }
        if (g.inn > 0) {
          const k = ero * op;
          pr = pr * (1 - k) + ir * pa * k; pg = pg * (1 - k) + ig * pa * k; pb = pb * (1 - k) + ib * pa * k;
        }
        if (pa <= 0) continue;
        dst[si] = (pr / pa) * 255 + 0.5; dst[si + 1] = (pg / pa) * 255 + 0.5; dst[si + 2] = (pb / pa) * 255 + 0.5; dst[si + 3] = pa * 255 + 0.5;
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams, o: FxOpts, c: FxCtx) => {
      const g = geo(p, o, c);
      return { uInk: rgbOf(p, 'ink'), uOp: p.opacity, uOut: g.out, uIn: g.inn, uStep: g.step, uN: g.n, uRamp: g.ramp };
    },
  }],
};

registerEffect(effect);
