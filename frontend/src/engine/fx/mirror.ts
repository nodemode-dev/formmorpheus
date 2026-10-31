// Mirror: one side of the Stage reflected onto the other along a vertical or horizontal line, or into four quarters.
// The line sits at a fraction of the Stage. Whole-pixel samples on both paths.
import { registerEffect, type Effect, type FxOpts, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7l-5 5 5 5z" fill="currentColor" stroke="none" opacity=".85"/><path d="M15 7l5 5-5 5z" opacity=".5"/></svg>';

// 0 left over right, 1 right over left, 2 top over bottom, 3 bottom over top, 4 four ways (top left quarter)
const MODES = ['left to right', 'right to left', 'top to bottom', 'bottom to top', 'four ways'];
const modeOf = (o: FxOpts): number => Math.max(0, MODES.indexOf(String(o.mode)));

const FX = `
uniform float uPos;
uniform float uMode;
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  vec2 u = vec2(p) + 0.5;
  vec2 a = uO + uM * uScale * uPos;
  if (uMode < 0.5) { if (u.x > a.x) u.x = 2.0 * a.x - u.x; }
  else if (uMode < 1.5) { if (u.x < a.x) u.x = 2.0 * a.x - u.x; }
  else if (uMode < 2.5) { if (u.y > a.y) u.y = 2.0 * a.y - u.y; }
  else if (uMode < 3.5) { if (u.y < a.y) u.y = 2.0 * a.y - u.y; }
  else { if (u.x > a.x) u.x = 2.0 * a.x - u.x; if (u.y > a.y) u.y = 2.0 * a.y - u.y; }
  return texelFetch(uSrc, clamp(ivec2(floor(u)), ivec2(0), sz - 1), 0);
}`;

const effect: Effect = {
  id: 'mirror',
  label: 'Mirror',
  icon: ICON,
  params: [{ id: 'pos', label: 'Line position', min: 0, max: 1, step: 0.005, unit: '%', display: 100, def: 0.5 }],
  options: [{ id: 'mode', label: 'Reflect', choices: MODES, def: 'left to right' }],
  active: () => true,
  pad: () => 0,
  cpu(src, dst, w, h, p, o, c, box) {
    const mode = modeOf(o);
    const ax = c.ox + c.mw * c.scale * p.pos, ay = c.oy + c.mh * c.scale * p.pos;
    const cl = (v: number, n: number): number => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        let ux = x + 0.5, uy = y + 0.5;
        if (mode === 0) { if (ux > ax) ux = 2 * ax - ux; }
        else if (mode === 1) { if (ux < ax) ux = 2 * ax - ux; }
        else if (mode === 2) { if (uy > ay) uy = 2 * ay - uy; }
        else if (mode === 3) { if (uy < ay) uy = 2 * ay - uy; }
        else { if (ux > ax) ux = 2 * ax - ux; if (uy > ay) uy = 2 * ay - uy; }
        const si = (cl(Math.floor(uy), h) * w + cl(Math.floor(ux), w)) * 4, di = (y * w + x) * 4;
        dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
      }
    }
  },
  gpu: (): GpuStep[] => [{ kind: 'shader', glsl: FX, uniforms: (p: FxParams, o: FxOpts) => ({ uPos: p.pos, uMode: modeOf(o) }) }],
};

registerEffect(effect);
