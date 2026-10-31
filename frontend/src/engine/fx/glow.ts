// Glow: bright parts of the picture (luminance over Threshold) blur outward and are screened over it (outer), and/or
// the picture's edges glow inward (inner). Color tints the glow, or the picture's own colors glow with "Picture colors".
import { gaussianBlur, scratchRaster } from '../../paint/filters';
import { colorParams, registerEffect, rgbOf, type Effect, type FxOpts, type FxParams, type GpuStep } from './registry';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3L18 18M18 6l-1.7 1.7M7.7 16.3L6 18" opacity=".7"/></svg>';

const KNEE = 0.1;
const modeOf = (o: FxOpts): 'outer' | 'inner' | 'both' => (o.mode === 'inner' || o.mode === 'both' ? o.mode : 'outer');
const wantsOuter = (o: FxOpts): boolean => modeOf(o) !== 'inner';
const wantsInner = (o: FxOpts): boolean => modeOf(o) !== 'outer';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const EXTRACT = `
uniform float uThresh;
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  if (s.a <= 0.0) return vec4(0.0);
  float l = dot(s.rgb / s.a, vec3(0.299, 0.587, 0.114));
  return s * clamp((l - uThresh) / ${KNEE.toFixed(2)} + 1.0, 0.0, 1.0);
}`;

const COMPLEMENT = `
vec4 fx(ivec2 p) { return vec4(0.0, 0.0, 0.0, 1.0 - texelFetch(uSrc, p, 0).a); }`;

/** Compose shader for a mode; `o` is the blurred bright part (step index), `i` the blurred complement. */
function compose(outerIdx: number, innerIdx: number): string {
  return `
uniform vec3 uColor;
uniform float uInt;
uniform float uSource;
vec4 fx(ivec2 p) {
  vec4 s = texelFetch(uSrc, p, 0);
  vec4 b = s;
  ${outerIdx >= 0 ? `
  vec4 g = texelFetch(uS${outerIdx}, p, 0);
  vec3 gs = g.a > 0.0 ? clamp(g.rgb / g.a, 0.0, 1.0) : vec3(0.0);
  vec4 gp = vec4((uSource > 0.5 ? gs : uColor) * g.a, g.a);
  gp = clamp(gp * uInt, 0.0, 1.0);
  b = vec4(1.0) - (vec4(1.0) - s) * (vec4(1.0) - gp);` : ''}
  ${innerIdx >= 0 ? `
  float k = clamp(texelFetch(uS${innerIdx}, p, 0).a * uInt, 0.0, 1.0) * s.a;
  b = vec4(b.rgb * (1.0 - k) + uColor * k * b.a, b.a);` : ''}
  return b;
}`;
}

const effect: Effect = {
  id: 'glow',
  label: 'Glow',
  icon: ICON,
  params: [
    { id: 'radius', label: 'Radius', min: 0, max: 300, step: 1, unit: 'px', def: 30 },
    { id: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.01, unit: '%', display: 100, def: 0.8 },
    { id: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.55 },
    ...colorParams('col', 'Color', [1, 0.85, 0.4], { adv: true }),
  ],
  options: [
    { id: 'mode', label: 'Mode', choices: ['outer', 'inner', 'both'], def: 'outer' },
    { id: 'source', label: 'Picture colors', def: false },
  ],
  active: (p) => p.intensity > 0 && p.radius > 0,
  pad: (p, o, c) => (wantsOuter(o) ? p.radius * c.scale * 1.5 + 2 : 0),
  cpu(src, dst, w, h, p, o, c, box) {
    const r = p.radius * c.scale, inten = p.intensity, th = p.threshold;
    const [cr, cg, cb] = rgbOf(p, 'col');
    const useSrc = o.source === true;
    const outer = wantsOuter(o), inner = wantsInner(o);
    let G: Uint8ClampedArray | null = null, E: Uint8ClampedArray | null = null;
    const n = w * h * 4;
    if (outer) {
      const A = scratchRaster('fx-gl-a', w, h), B = scratchRaster('fx-gl-b', w, h);
      const ad = A.data;
      ad.fill(0);
      for (let y = box.y0; y < box.y1; y++) {
        let i = (y * w + box.x0) * 4;
        for (let x = box.x0; x < box.x1; x++, i += 4) {
          const a = src[i + 3];
          if (a === 0) continue;
          const l = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
          const wt = clamp01((l - th) / KNEE + 1);
          ad[i] = src[i]; ad[i + 1] = src[i + 1]; ad[i + 2] = src[i + 2]; ad[i + 3] = a * wt;
        }
      }
      gaussianBlur(A, B, r);
      G = B.data;
    }
    if (inner) {
      const A = scratchRaster('fx-gl-c', w, h), B = scratchRaster('fx-gl-d', w, h);
      const ad = A.data;
      for (let i = 0; i < n; i += 4) { ad[i] = 0; ad[i + 1] = 0; ad[i + 2] = 0; ad[i + 3] = 255 - src[i + 3]; }
      gaussianBlur(A, B, r);
      E = B.data;
    }
    for (let y = box.y0; y < box.y1; y++) {
      let i = (y * w + box.x0) * 4;
      for (let x = box.x0; x < box.x1; x++, i += 4) {
        const sa = src[i + 3] / 255;
        let ba = sa, br = (src[i] / 255) * sa, bg = (src[i + 1] / 255) * sa, bb = (src[i + 2] / 255) * sa;
        if (G) {
          const ga = G[i + 3] / 255;
          let gr = cr * ga, gg = cg * ga, gb = cb * ga;
          if (useSrc) { gr = (G[i] / 255) * ga; gg = (G[i + 1] / 255) * ga; gb = (G[i + 2] / 255) * ga; }
          const pa = clamp01(ga * inten);
          gr = clamp01(gr * inten); gg = clamp01(gg * inten); gb = clamp01(gb * inten);
          br = 1 - (1 - br) * (1 - gr); bg = 1 - (1 - bg) * (1 - gg); bb = 1 - (1 - bb) * (1 - gb); ba = 1 - (1 - ba) * (1 - pa);
        }
        if (E) {
          const k = clamp01((E[i + 3] / 255) * inten) * sa;
          br = br * (1 - k) + cr * k * ba; bg = bg * (1 - k) + cg * k * ba; bb = bb * (1 - k) + cb * k * ba;
        }
        if (ba <= 0) continue;
        dst[i] = (br / ba) * 255; dst[i + 1] = (bg / ba) * 255; dst[i + 2] = (bb / ba) * 255; dst[i + 3] = ba * 255;
      }
    }
  },
  gpu: (p: FxParams, o: FxOpts): GpuStep[] => {
    const steps: GpuStep[] = [];
    const sigma = (q: FxParams, _o: FxOpts, c: { scale: number }): number => (q.radius * c.scale) / 2;
    let outerIdx = -1, innerIdx = -1;
    if (wantsOuter(o)) {
      steps.push({ kind: 'shader', glsl: EXTRACT, uniforms: (q) => ({ uThresh: q.threshold }) });
      steps.push({ kind: 'blur', from: steps.length - 1, sigma });
      outerIdx = steps.length - 1;
    }
    if (wantsInner(o)) {
      steps.push({ kind: 'shader', glsl: COMPLEMENT });
      steps.push({ kind: 'blur', from: steps.length - 1, sigma });
      innerIdx = steps.length - 1;
    }
    steps.push({
      kind: 'shader', glsl: compose(outerIdx, innerIdx), reads: [outerIdx, innerIdx].filter((i) => i >= 0),
      uniforms: (q: FxParams, op: FxOpts) => ({ uColor: rgbOf(q, 'col'), uInt: q.intensity, uSource: op.source === true ? 1 : 0 }),
    });
    void p;
    return steps;
  },
};

registerEffect(effect);
