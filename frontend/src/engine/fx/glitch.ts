// Glitch: horizontal bands of the picture slide sideways and the red and blue channels split apart.
// Which bands slide is a hash of the band number and Seed (key Seed to make it jump), so both paths pick the same bands.
import { registerEffect, type Effect, type FxCtx, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 6h11M8 10h13M3 14h9M10 18h11"/></svg>';

const FX = `
uniform float uAmt;
uniform float uBand;
uniform float uDens;
uniform float uSeed;
uniform float uSplit;
uniform float uOy;
uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
float rnd(int band, int seed, uint salt) {
  uint x = (uint(band + 65536) ^ (uint(seed) * 0x9e3779b1u)) + salt * 0x85ebca6bu;
  return float(hashu(x) >> 8) / 16777216.0;
}
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(uSrc, 0);
  int band = int(floor((float(p.y) + 0.5 - uOy) / uBand));
  int seed = int(floor(uSeed));
  bool on = rnd(band, seed, 1u) < uDens;
  int dx = on ? int(floor((rnd(band, seed, 2u) * 2.0 - 1.0) * uAmt + 0.5)) : 0;
  int sp = int(floor(uSplit * (on ? 1.0 : 0.3) + 0.5));
  ivec2 qr = ivec2(p.x - dx - sp, p.y), qg = ivec2(p.x - dx, p.y), qb = ivec2(p.x - dx + sp, p.y);
  vec4 r = (qr.x < 0 || qr.x >= sz.x) ? vec4(0.0) : texelFetch(uSrc, qr, 0);
  vec4 g = (qg.x < 0 || qg.x >= sz.x) ? vec4(0.0) : texelFetch(uSrc, qg, 0);
  vec4 b = (qb.x < 0 || qb.x >= sz.x) ? vec4(0.0) : texelFetch(uSrc, qb, 0);
  return vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
}`;

function hashu(x0: number): number {
  let x = x0 >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0; x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0; x = (x ^ (x >>> 16)) >>> 0;
  return x;
}
function rnd(band: number, seed: number, salt: number): number {
  const x = (((band + 65536) >>> 0) ^ (Math.imul(seed, 0x9e3779b1) >>> 0)) >>> 0;
  return (hashu((x + Math.imul(salt, 0x85ebca6b)) >>> 0) >>> 8) / 16777216;
}

const bandOf = (p: FxParams, c: FxCtx): number => Math.max(1, Math.round(p.band * c.scale));

const effect: Effect = {
  id: 'glitch',
  label: 'Glitch',
  icon: ICON,
  params: [
    { id: 'amount', label: 'Slide', min: 0, max: 400, step: 1, unit: 'px', def: 40 },
    { id: 'band', label: 'Band height', short: 'Band', min: 1, max: 200, step: 1, unit: 'px', def: 14 },
    { id: 'density', label: 'Share of bands', short: 'Share', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.35 },
    { id: 'split', label: 'Color split', short: 'Split', min: 0, max: 60, step: 0.5, unit: 'px', def: 6 },
    { id: 'seed', label: 'Seed', min: 0, max: 100000, step: 1, unit: '', def: 1 },
  ],
  active: (p) => p.amount > 0 || p.split > 0,
  pad: (p, _o, c) => Math.ceil((p.amount + p.split) * c.scale) + 2,
  cpu(src, dst, w, _h, p, _o, c, box) {
    const bh = bandOf(p, c), seed = Math.floor(p.seed), amt = p.amount * c.scale, spl = p.split * c.scale;
    for (let y = box.y0; y < box.y1; y++) {
      const band = Math.floor((y + 0.5 - c.oy) / bh);
      const on = rnd(band, seed, 1) < p.density;
      const dx = on ? Math.floor((rnd(band, seed, 2) * 2 - 1) * amt + 0.5) : 0;
      const sp = Math.floor(spl * (on ? 1 : 0.3) + 0.5);
      for (let x = box.x0; x < box.x1; x++) {
        const xr = x - dx - sp, xg = x - dx, xb = x - dx + sp;
        const ar = xr < 0 || xr >= w ? 0 : src[(y * w + xr) * 4 + 3];
        const ag = xg < 0 || xg >= w ? 0 : src[(y * w + xg) * 4 + 3];
        const ab = xb < 0 || xb >= w ? 0 : src[(y * w + xb) * 4 + 3];
        const a = Math.max(ar, ag, ab);
        if (a === 0) continue;
        const di = (y * w + x) * 4;
        dst[di] = ar ? Math.min(255, Math.round((src[(y * w + xr) * 4] * ar) / a)) : 0;
        dst[di + 1] = ag ? Math.min(255, Math.round((src[(y * w + xg) * 4 + 1] * ag) / a)) : 0;
        dst[di + 2] = ab ? Math.min(255, Math.round((src[(y * w + xb) * 4 + 2] * ab) / a)) : 0;
        dst[di + 3] = a;
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams, _o, c: FxCtx) => ({ uAmt: p.amount * c.scale, uBand: bandOf(p, c), uDens: p.density, uSeed: Math.floor(p.seed), uSplit: p.split * c.scale, uOy: c.oy }),
  }],
};

registerEffect(effect);
