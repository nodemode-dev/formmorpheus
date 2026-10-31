// Vignette: the Stage's edges tinted toward a color. Size is where it starts (as a share of the corner distance),
// Feather how far it takes to reach full strength, Roundness blends the Stage-shaped ellipse into a true circle.
import { colorParams, registerEffect, rgbOf, type Effect, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3"/><ellipse cx="12" cy="12" rx="6" ry="4.6" opacity=".55"/><path d="M3 4.5l3.6 3.4M21 4.5l-3.6 3.4M3 19.5l3.6-3.4M21 19.5l-3.6-3.4" opacity=".35"/></svg>';

const SQ2 = Math.SQRT2;

/** Vignette weight 0..1 at a surface pixel (centre of pixel (x, y)). */
function weight(x: number, y: number, p: FxParams, ox: number, oy: number, sw: number, sh: number, a: number): number {
  const vx = ((x + 0.5 - ox) / sw - 0.5) * 2, vy = ((y + 0.5 - oy) / sh - 0.5) * 2;
  const m = Math.max(a, 1);
  const cx = (vx * a) / m, cy = vy / m;
  const r = p.round;
  const d = Math.hypot(vx + (cx - vx) * r, vy + (cy - vy) * r) / SQ2;
  let w = (d - p.size) / Math.max(p.feather, 0.001);
  w = w < 0 ? 0 : w > 1 ? 1 : w;
  return w * w * (3 - 2 * w);
}

const FX = `
uniform vec3 uColor;
uniform float uAmount;
uniform float uStart;
uniform float uRound;
uniform float uFeather;
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  vec2 v = ((vec2(p) + 0.5 - uO) / (uM * uScale) - 0.5) * 2.0;
  float a = uM.x / uM.y;
  vec2 circ = vec2(v.x * a, v.y) / max(a, 1.0);
  float d = length(mix(v, circ, uRound)) / 1.41421356;
  float w = clamp((d - uStart) / max(uFeather, 0.001), 0.0, 1.0);
  w = w * w * (3.0 - 2.0 * w);
  float k = clamp(uAmount, 0.0, 1.0) * w;
  return vec4(s.rgb * (1.0 - k) + uColor * k * s.a, s.a);
}`;

const effect: Effect = {
  id: 'vignette',
  label: 'Vignette',
  icon: ICON,
  params: [
    { id: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.6 },
    { id: 'size', label: 'Size', min: 0, max: 1.2, step: 0.01, unit: '%', display: 100, def: 0.5 },
    { id: 'round', label: 'Roundness', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.5 },
    { id: 'feather', label: 'Feather', min: 0, max: 1.5, step: 0.01, unit: '%', display: 100, def: 0.5 },
    ...colorParams('col', 'Color', [0, 0, 0], { adv: true }),
  ],
  active: (p) => p.amount > 0,
  pad: () => 0,
  cpu(src, dst, w, _h, p, _o, c, box) {
    const sw = c.mw * c.scale, sh = c.mh * c.scale, a = c.mw / c.mh;
    const [cr, cg, cb] = rgbOf(p, 'col');
    const amt = p.amount > 1 ? 1 : p.amount < 0 ? 0 : p.amount;
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const al = src[i + 3];
        if (al === 0) continue;
        const k = amt * weight(x, y, p, c.ox, c.oy, sw, sh, a);
        const sa = al / 255;
        const pr = (src[i] / 255) * sa * (1 - k) + cr * k * sa, pg = (src[i + 1] / 255) * sa * (1 - k) + cg * k * sa, pb = (src[i + 2] / 255) * sa * (1 - k) + cb * k * sa;
        dst[i] = (pr / sa) * 255; dst[i + 1] = (pg / sa) * 255; dst[i + 2] = (pb / sa) * 255; dst[i + 3] = al;
      }
    }
  },
  gpu: (): GpuStep[] => [
    { kind: 'shader', glsl: FX, uniforms: (p: FxParams) => ({ uColor: rgbOf(p, 'col'), uAmount: p.amount, uStart: p.size, uRound: p.round, uFeather: p.feather }) },
  ],
};

registerEffect(effect);
