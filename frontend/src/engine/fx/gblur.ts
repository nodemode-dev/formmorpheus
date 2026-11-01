// Gaussian blur with its own horizontal and vertical radius (a streak blur is X only). Two separable passes with the
// same tap weights on both paths; taps outside the Stage surface count as clear. The radius is a standard deviation in px.
import { registerEffect, type Effect, type FxCtx, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M3 12h3M18 12h3M12 3v3M12 18v3" opacity=".6"/></svg>';

const MAXR = 96;
const sig = (v: number, c: FxCtx): number => Math.min(MAXR / 3, Math.max(0, v * c.scale));

function glsl(horizontal: boolean): string {
  const ax = horizontal ? 'ivec2(i, 0)' : 'ivec2(0, i)';
  const src = horizontal ? 'uSrc' : 'uS0';
  return `
uniform float uSig;
vec4 fx(ivec2 p) {
  ivec2 sz = textureSize(${src}, 0);
  if (uSig < 0.05) return texelFetch(${src}, p, 0);
  int r = int(ceil(uSig * 3.0));
  vec4 s = vec4(0.0);
  float ws = 0.0;
  for (int i = -${MAXR}; i <= ${MAXR}; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-float(i * i) / (2.0 * uSig * uSig));
    ws += w;
    ivec2 q = p + ${ax};
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
    s += texelFetch(${src}, q, 0) * w;
  }
  return s / ws;
}`;
}

/** One 1D pass over `box` rows and columns, premultiplied floats in `a` read, `b` written. */
function pass(a: Float32Array, b: Float32Array, w: number, h: number, sg: number, horiz: boolean, x0: number, y0: number, x1: number, y1: number): void {
  if (sg < 0.05) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; b[i] = a[i]; b[i + 1] = a[i + 1]; b[i + 2] = a[i + 2]; b[i + 3] = a[i + 3]; } return; }
  const r = Math.ceil(sg * 3);
  const wt = new Float32Array(r * 2 + 1);
  let ws = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sg * sg)); wt[i + r] = v; ws += v; }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let i = -r; i <= r; i++) {
        const qx = horiz ? x + i : x, qy = horiz ? y : y + i;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const k = (qy * w + qx) * 4, v = wt[i + r];
        s0 += a[k] * v; s1 += a[k + 1] * v; s2 += a[k + 2] * v; s3 += a[k + 3] * v;
      }
      const o = (y * w + x) * 4;
      b[o] = s0 / ws; b[o + 1] = s1 / ws; b[o + 2] = s2 / ws; b[o + 3] = s3 / ws;
    }
  }
}

let bufA = new Float32Array(0), bufB = new Float32Array(0);

const effect: Effect = {
  id: 'gblur',
  label: 'Gaussian Blur X Y',
  icon: ICON,
  params: [
    { id: 'x', label: 'Blur X', min: 0, max: 200, step: 0.5, unit: 'px', def: 24 },
    { id: 'y', label: 'Blur Y', min: 0, max: 200, step: 0.5, unit: 'px', def: 0 },
  ],
  active: (p) => p.x > 0 || p.y > 0,
  pad: (p, _o, c) => Math.ceil(Math.max(sig(p.x, c), sig(p.y, c)) * 3) + 1,
  cpu(src, dst, w, h, p, _o, c, box) {
    const n = w * h * 4;
    if (bufA.length < n) { bufA = new Float32Array(n); bufB = new Float32Array(n); }
    const a = bufA, b = bufB;
    a.fill(0, 0, n); b.fill(0, 0, n);
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const al = src[i + 3] / 255;
        a[i] = (src[i] / 255) * al; a[i + 1] = (src[i + 1] / 255) * al; a[i + 2] = (src[i + 2] / 255) * al; a[i + 3] = al;
      }
    }
    pass(a, b, w, h, sig(p.x, c), true, box.x0, box.y0, box.x1, box.y1);
    pass(b, a, w, h, sig(p.y, c), false, box.x0, box.y0, box.x1, box.y1);
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const al = a[i + 3];
        if (al <= 1e-6) continue;
        dst[i] = (a[i] / al) * 255 + 0.5; dst[i + 1] = (a[i + 1] / al) * 255 + 0.5; dst[i + 2] = (a[i + 2] / al) * 255 + 0.5; dst[i + 3] = al * 255 + 0.5;
      }
    }
  },
  gpu: (): GpuStep[] => [
    { kind: 'shader', glsl: glsl(true), uniforms: (p: FxParams, _o, c) => ({ uSig: sig(p.x, c) }) },
    { kind: 'shader', glsl: glsl(false), reads: [0], uniforms: (p: FxParams, _o, c) => ({ uSig: sig(p.y, c) }) },
  ],
};

registerEffect(effect);
