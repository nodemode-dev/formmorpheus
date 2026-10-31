// Pixelate: the picture sampled once per cell, on a square grid, a hex grid, or as round dots on a square grid.
// The grid is anchored to the Stage's corner so it does not swim when the view moves.
import { registerEffect, type Effect, type FxOpts, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" fill="currentColor" stroke="none" opacity=".85"/><rect x="13.5" y="3.5" width="7" height="7" opacity=".5"/><rect x="3.5" y="13.5" width="7" height="7" opacity=".5"/><rect x="13.5" y="13.5" width="7" height="7" fill="currentColor" stroke="none" opacity=".4"/></svg>';

const SHAPES = ['square', 'hex', 'dot'];
const shapeOf = (o: FxOpts): number => Math.max(0, SHAPES.indexOf(String(o.shape)));
const SQ3 = Math.sqrt(3);
const cell = (p: FxParams, scale: number): number => Math.max(1, p.size * scale);

/** Centre of the hex cell holding (ux, uy); pointy-top cells whose width is `s`. */
function hexCenter(ux: number, uy: number, s: number, out: number[]): void {
  const size = s / SQ3;
  const q = ((SQ3 / 3) * ux - uy / 3) / size, r = ((2 / 3) * uy) / size;
  let x = q, z = r, y = -x - z;
  let rx = Math.floor(x + 0.5), ry = Math.floor(y + 0.5), rz = Math.floor(z + 0.5);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  x = rx; y = ry; z = rz;
  out[0] = size * (SQ3 * x + (SQ3 / 2) * z);
  out[1] = size * 1.5 * z;
}

const FX = `
uniform float uCell;
uniform float uShape;
uniform float uDot;
vec2 hexCenter(vec2 u, float s) {
  float size = s / 1.7320508;
  float q = (0.57735027 * u.x - u.y / 3.0) / size;
  float r = (2.0 / 3.0 * u.y) / size;
  float x = q, z = r, y = -x - z;
  float rx = floor(x + 0.5), ry = floor(y + 0.5), rz = floor(z + 0.5);
  float dx = abs(rx - x), dy = abs(ry - y), dz = abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return vec2(size * (1.7320508 * rx + 0.8660254 * rz), size * 1.5 * rz);
}
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  vec2 u = vec2(p) + 0.5 - uO;
  vec2 c = uShape > 0.5 && uShape < 1.5 ? hexCenter(u, uCell) : (floor(u / uCell) + 0.5) * uCell;
  ivec2 q = clamp(ivec2(floor(c + uO)), ivec2(0), sz - 1);
  vec4 s = texelFetch(uSrc, q, 0);
  if (uShape > 1.5) s *= clamp(uCell * 0.5 * uDot - length(u - c) + 0.5, 0.0, 1.0);
  return s;
}`;

const effect: Effect = {
  id: 'pixelate',
  label: 'Pixelate',
  icon: ICON,
  params: [
    { id: 'size', label: 'Cell size', min: 2, max: 300, step: 1, unit: 'px', def: 16 },
    { id: 'dot', label: 'Dot size', min: 0.1, max: 1.3, step: 0.01, unit: '%', display: 100, def: 0.9 },
  ],
  options: [{ id: 'shape', label: 'Shape', choices: SHAPES, def: 'square' }],
  active: () => true,
  pad: (p, _o, c) => cell(p, c.scale),
  cpu(src, dst, w, h, p, o, c, box) {
    const s = cell(p, c.scale), shape = shapeOf(o), dotK = s * 0.5 * p.dot;
    const ctr = [0, 0];
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const ux = x + 0.5 - c.ox, uy = y + 0.5 - c.oy;
        let cx: number, cy: number;
        if (shape === 1) { hexCenter(ux, uy, s, ctr); cx = ctr[0]; cy = ctr[1]; }
        else { cx = (Math.floor(ux / s) + 0.5) * s; cy = (Math.floor(uy / s) + 0.5) * s; }
        const qx = Math.min(w - 1, Math.max(0, Math.floor(cx + c.ox))), qy = Math.min(h - 1, Math.max(0, Math.floor(cy + c.oy)));
        const si = (qy * w + qx) * 4, di = (y * w + x) * 4;
        const a = src[si + 3];
        if (a === 0) continue;
        let k = 1;
        if (shape === 2) { k = dotK - Math.hypot(ux - cx, uy - cy) + 0.5; k = k < 0 ? 0 : k > 1 ? 1 : k; if (k === 0) continue; }
        dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = a * k;
      }
    }
  },
  gpu: (): GpuStep[] => [
    { kind: 'shader', glsl: FX, uniforms: (p: FxParams, o: FxOpts, c) => ({ uCell: cell(p, c.scale), uShape: shapeOf(o), uDot: p.dot }) },
  ],
};

registerEffect(effect);
