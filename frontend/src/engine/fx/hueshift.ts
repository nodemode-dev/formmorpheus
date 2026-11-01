// Hue range shift: the colors inside a band of hues are turned (and made more or less vivid); the rest stays.
// Band: a center hue, a width and a soft edge, all in degrees. Straight color maths in HSV on both paths.
import { registerEffect, type Effect, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 6.9 4" stroke-width="3.2" opacity=".8"/><path d="M12 12l5-3" opacity=".6"/></svg>';

const FX = `
uniform float uCen;
uniform float uWid;
uniform float uSoft;
uniform float uShift;
uniform float uSat;
vec3 rgb2hsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  float h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) h = (c.g - c.b) / d - 6.0 * floor((c.g - c.b) / d / 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  return vec3(h, mx > 0.0 ? d / mx : 0.0, mx);
}
vec3 hsv2rgb(vec3 c) {
  float h = c.x - 360.0 * floor(c.x / 360.0);
  float hp = h / 60.0, ch = c.z * c.y;
  float x = ch * (1.0 - abs(hp - 2.0 * floor(hp / 2.0) - 1.0));
  float m = c.z - ch;
  vec3 r;
  if (hp < 1.0) r = vec3(ch, x, 0.0);
  else if (hp < 2.0) r = vec3(x, ch, 0.0);
  else if (hp < 3.0) r = vec3(0.0, ch, x);
  else if (hp < 4.0) r = vec3(0.0, x, ch);
  else if (hp < 5.0) r = vec3(x, 0.0, ch);
  else r = vec3(ch, 0.0, x);
  return r + m;
}
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  if (s.a <= 0.0) return s;
  vec3 c = clamp(s.rgb / s.a, 0.0, 1.0);
  vec3 hsv = rgb2hsv(c);
  float d = abs(hsv.x - uCen);
  d = min(d, 360.0 - d);
  float e0 = uWid * 0.5, e1 = e0 + max(uSoft, 0.5);
  float t = clamp((d - e0) / (e1 - e0), 0.0, 1.0);
  float w = 1.0 - t * t * (3.0 - 2.0 * t);
  hsv.x += uShift * w;
  hsv.y = clamp(hsv.y * (1.0 + uSat * w), 0.0, 1.0);
  return vec4(hsv2rgb(hsv) * s.a, s.a);
}`;

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = (g - b) / d - 6 * Math.floor((g - b) / d / 6);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

function hsv2rgb(h0: number, s: number, v: number, out: number[]): void {
  const h = h0 - 360 * Math.floor(h0 / 360);
  const hp = h / 60, ch = v * s;
  const x = ch * (1 - Math.abs(hp - 2 * Math.floor(hp / 2) - 1));
  const m = v - ch;
  let r: number, g: number, b: number;
  if (hp < 1) { r = ch; g = x; b = 0; }
  else if (hp < 2) { r = x; g = ch; b = 0; }
  else if (hp < 3) { r = 0; g = ch; b = x; }
  else if (hp < 4) { r = 0; g = x; b = ch; }
  else if (hp < 5) { r = x; g = 0; b = ch; }
  else { r = ch; g = 0; b = x; }
  out[0] = r + m; out[1] = g + m; out[2] = b + m;
}

const effect: Effect = {
  id: 'hueshift',
  label: 'Hue Range Shift',
  icon: ICON,
  params: [
    { id: 'center', label: 'Band center', short: 'Center', min: 0, max: 360, step: 1, unit: 'deg', def: 120 },
    { id: 'width', label: 'Band width', short: 'Width', min: 0, max: 360, step: 1, unit: 'deg', def: 80 },
    { id: 'soft', label: 'Band softness', short: 'Soft', min: 0, max: 180, step: 1, unit: 'deg', def: 40 },
    { id: 'shift', label: 'Hue shift', short: 'Shift', min: -360, max: 360, step: 1, unit: 'deg', def: -90 },
    { id: 'sat', label: 'Saturation change', short: 'Sat', min: -1, max: 1, step: 0.01, unit: '%', display: 100, def: 0 },
  ],
  active: (p) => p.shift !== 0 || p.sat !== 0,
  pad: () => 0,
  cpu(src, dst, w, _h, p, _o, _c, box) {
    const out = [0, 0, 0];
    const e0 = p.width * 0.5, e1 = e0 + Math.max(p.soft, 0.5);
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const a = src[i + 3];
        if (a === 0) continue;
        const hsv = rgb2hsv(src[i] / 255, src[i + 1] / 255, src[i + 2] / 255);
        let d = Math.abs(hsv[0] - p.center);
        d = Math.min(d, 360 - d);
        let t = (d - e0) / (e1 - e0);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const wt = 1 - t * t * (3 - 2 * t);
        const sat = Math.min(1, Math.max(0, hsv[1] * (1 + p.sat * wt)));
        hsv2rgb(hsv[0] + p.shift * wt, sat, hsv[2], out);
        dst[i] = out[0] * 255 + 0.5; dst[i + 1] = out[1] * 255 + 0.5; dst[i + 2] = out[2] * 255 + 0.5; dst[i + 3] = a;
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams) => ({ uCen: p.center, uWid: p.width, uSoft: p.soft, uShift: p.shift, uSat: p.sat }),
  }],
};

registerEffect(effect);
