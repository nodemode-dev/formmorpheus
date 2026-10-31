// Chromatic aberration: red and blue sampled on opposite sides of the green, a little further apart toward the
// Stage's corners, like a lens that does not focus every color to one spot. Whole-pixel samples on both paths.
import { registerEffect, type Effect, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9.5" cy="12" r="6" opacity=".9"/><circle cx="14.5" cy="12" r="6" opacity=".55"/></svg>';

const FX = `
uniform float uAmt;
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  vec2 ctr = uO + uM * uScale * 0.5;
  float half_diag = length(uM * uScale) * 0.5;
  vec2 sh = uAmt * (vec2(p) + 0.5 - ctr) / half_diag;
  ivec2 qr = clamp(ivec2(floor(vec2(p) + 0.5 + sh)), ivec2(0), sz - 1);
  ivec2 qb = clamp(ivec2(floor(vec2(p) + 0.5 - sh)), ivec2(0), sz - 1);
  vec4 r = texelFetch(uSrc, qr, 0), g = texelFetch(uSrc, p, 0), b = texelFetch(uSrc, qb, 0);
  return vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
}`;

const effect: Effect = {
  id: 'chromatic',
  label: 'Chromatic Aberration',
  icon: ICON,
  params: [{ id: 'amount', label: 'Amount', min: 0, max: 80, step: 0.5, unit: 'px', def: 6 }],
  active: (p: FxParams) => p.amount > 0,
  pad: (p, _o, c) => Math.ceil(p.amount * c.scale),
  cpu(src, dst, w, h, p, _o, c, box) {
    const amt = p.amount * c.scale;
    const cx = c.ox + (c.mw * c.scale) / 2, cy = c.oy + (c.mh * c.scale) / 2;
    const hd = Math.hypot(c.mw * c.scale, c.mh * c.scale) / 2;
    const cl = (v: number, n: number): number => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const sx = (amt * (x + 0.5 - cx)) / hd, sy = (amt * (y + 0.5 - cy)) / hd;
        const ri = (cl(Math.floor(y + 0.5 + sy), h) * w + cl(Math.floor(x + 0.5 + sx), w)) * 4;
        const bi = (cl(Math.floor(y + 0.5 - sy), h) * w + cl(Math.floor(x + 0.5 - sx), w)) * 4;
        const gi = (y * w + x) * 4;
        const ar = src[ri + 3], ag = src[gi + 3], ab = src[bi + 3];
        const a = Math.max(ar, ag, ab);
        if (a === 0) continue;
        // premultiplied channel picked per sample, then back to straight alpha
        dst[gi] = Math.min(255, Math.round((src[ri] * ar) / a));
        dst[gi + 1] = Math.min(255, Math.round((src[gi + 1] * ag) / a));
        dst[gi + 2] = Math.min(255, Math.round((src[bi + 2] * ab) / a));
        dst[gi + 3] = a;
      }
    }
  },
  gpu: (): GpuStep[] => [{ kind: 'shader', glsl: FX, uniforms: (p: FxParams, _o, c) => ({ uAmt: p.amount * c.scale }) }],
};

registerEffect(effect);
