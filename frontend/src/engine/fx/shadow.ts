// Drop shadow: the picture's alpha shifted by angle and distance, blurred (softness), widened (spread) and tinted,
// drawn under the picture. Knockout keeps the shadow alone. CPU and GPU run the same steps.
import { gaussianBlur, scratchRaster } from '../../paint/filters';
import { colorParams, registerEffect, rgbOf, type Effect, type FxOpts, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="11" height="11" rx="2"/><path d="M8 18.5h9.5a2 2 0 0 0 2-2V8" opacity=".55"/><path d="M10.5 20.5h6.5a3.5 3.5 0 0 0 3.5-3.5v-6.5" opacity=".3"/></svg>';

const spreadOf = (p: FxParams): number => Math.min(0.99, Math.max(0, p.spread));

/** Whole-pixel offset of the shadow on the surface (both paths round the same way). */
function offset(p: FxParams, scale: number): [number, number] {
  const a = (p.angle * Math.PI) / 180, d = p.distance * scale;
  return [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)];
}

const SHIFT = `
uniform vec2 uShift;
vec4 fx(ivec2 p) {
  ivec2 q = p - ivec2(uShift);
  ivec2 sz = textureSize(uSrc, 0);
  if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) return vec4(0.0);
  return vec4(0.0, 0.0, 0.0, texelFetch(uSrc, q, 0).a);
}`;

const COMPOSE = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSpread;
uniform float uKnock;
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  float a = min(1.0, texelFetch(uS1, p, 0).a / (1.0 - uSpread)) * uOpacity;
  vec4 sh = vec4(uColor * a, a) * (1.0 - s.a);
  return uKnock > 0.5 ? sh : s + sh;
}`;

const effect: Effect = {
  id: 'shadow',
  label: 'Drop Shadow',
  icon: ICON,
  params: [
    ...colorParams('col', 'Color', [0, 0, 0], { adv: true }),
    { id: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.6 },
    { id: 'angle', label: 'Angle', min: -360, max: 360, step: 1, unit: 'deg', def: 45 },
    { id: 'distance', label: 'Distance', min: 0, max: 400, step: 1, unit: 'px', def: 24 },
    { id: 'softness', label: 'Softness', min: 0, max: 300, step: 1, unit: 'px', def: 20 },
    { id: 'spread', label: 'Spread', min: 0, max: 0.99, step: 0.01, unit: '%', display: 100, def: 0 },
  ],
  options: [{ id: 'knockout', label: 'Shadow only', def: false }],
  active: (p) => p.opacity > 0,
  pad: (p, _o, c) => Math.hypot(...offset(p, c.scale)) + p.softness * c.scale * 1.5 + 2,
  cpu(src, dst, w, h, p, o, c, box) {
    const [dx, dy] = offset(p, c.scale);
    const A = scratchRaster('fx-sh-a', w, h), B = scratchRaster('fx-sh-b', w, h);
    A.data.fill(0);
    const sd = src;
    // alpha of the source moved by (dx, dy); everything else stays clear
    for (let y = box.y0; y < box.y1; y++) {
      const sy = y - dy;
      if (sy < 0 || sy >= h) continue;
      for (let x = box.x0; x < box.x1; x++) {
        const sx = x - dx;
        if (sx < 0 || sx >= w) continue;
        A.data[(y * w + x) * 4 + 3] = sd[(sy * w + sx) * 4 + 3];
      }
    }
    gaussianBlur(A, B, p.softness * c.scale);
    const [cr, cg, cb] = rgbOf(p, 'col');
    const k = 1 / (1 - spreadOf(p)), op = p.opacity, knock = o.knockout === true;
    const bd = B.data;
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const sa = sd[i + 3] / 255;
        const a = Math.min(1, (bd[i + 3] / 255) * k) * op;
        const sh = a * (1 - sa);
        // premultiplied: source (unless knocked out) plus shadow underneath
        const base = knock ? 0 : 1;
        const oa = base * sa + sh;
        if (oa <= 0) continue;
        const r = base * (sd[i] / 255) * sa + cr * sh, g = base * (sd[i + 1] / 255) * sa + cg * sh, b = base * (sd[i + 2] / 255) * sa + cb * sh;
        dst[i] = (r / oa) * 255; dst[i + 1] = (g / oa) * 255; dst[i + 2] = (b / oa) * 255; dst[i + 3] = oa * 255;
      }
    }
  },
  gpu: (): GpuStep[] => [
    { kind: 'shader', glsl: SHIFT, uniforms: (p, _o, c) => ({ uShift: offset(p, c.scale) }) },
    { kind: 'blur', from: 0, sigma: (p, _o, c) => (p.softness * c.scale) / 2 },
    { kind: 'shader', glsl: COMPOSE, reads: [1], uniforms: (p: FxParams, o: FxOpts) => ({ uColor: rgbOf(p, 'col'), uOpacity: p.opacity, uSpread: spreadOf(p), uKnock: o.knockout === true ? 1 : 0 }) },
  ],
};

registerEffect(effect);
