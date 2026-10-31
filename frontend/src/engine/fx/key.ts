// Chroma key and luma key: knock a colour or a brightness range out of a video or picture.
import { colorParams, registerEffect, rgbOf, type FxCtx, type FxParams } from './registry';
import { chromaKeyCpu, lumaKeyCpu } from './fx2-cpu';
import { GLSL_CHROMA, GLSL_LUMA } from './fx2-glsl';

const svg = (b: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;

const chokePx = (p: FxParams, c: FxCtx): number => {
  const v = Math.round(p.choke * c.scale);
  return Math.max(-8, Math.min(8, v));
};

registerEffect({
  id: 'chromakey',
  label: 'Chroma Key',
  icon: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 14l5-4 4 3 3-2 5 4" opacity=".6"/><circle cx="16.5" cy="9" r="1.4" fill="currentColor" stroke="none"/>'),
  params: [
    ...colorParams('key', 'Key', [0, 177 / 255, 64 / 255], { step: 1 / 255 }),
    { id: 'tolerance', label: 'Tolerance', short: 'Tol', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.3 },
    { id: 'softness', label: 'Softness', short: 'Soft', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.2 },
    { id: 'spill', label: 'Spill suppression', short: 'Spill', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.8 },
    { id: 'choke', label: 'Choke', short: 'Choke', min: -8, max: 8, step: 1, unit: 'px', def: 0 },
  ],
  options: [{ id: 'view', label: 'View matte', def: false }],
  active: () => true,
  pad: () => 0,
  cpu(src, dst, w, h, p, o, c) {
    const [r, g, b] = rgbOf(p, 'key');
    chromaKeyCpu({ width: w, height: h, data: src }, { width: w, height: h, data: dst },
      { r, g, b, tolerance: p.tolerance, softness: p.softness, spill: p.spill, choke: chokePx(p, c), view: o.view === true });
  },
  gpu: [{
    kind: 'shader',
    glsl: GLSL_CHROMA,
    uniforms: (p, o, c) => ({
      uKey: rgbOf(p, 'key'), uThr: p.tolerance * 0.6, uSoft: Math.max(0.0005, p.softness * 0.6),
      uSpill: p.spill, uChoke: chokePx(p, c), uView: o.view === true ? 1 : 0,
    }),
  }],
});

registerEffect({
  id: 'lumakey',
  label: 'Luma Key',
  icon: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15" /><path d="M12 4.5h8.5v15H12z" fill="currentColor" stroke="none" opacity=".5"/>'),
  params: [
    { id: 'threshold', label: 'Threshold', short: 'Thresh', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.5 },
    { id: 'softness', label: 'Softness', short: 'Soft', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0.1 },
  ],
  options: [{ id: 'invert', label: 'Invert', def: false }],
  active: () => true,
  pad: () => 0,
  cpu(src, dst, w, h, p, o) {
    lumaKeyCpu({ width: w, height: h, data: src }, { width: w, height: h, data: dst }, { threshold: p.threshold, softness: p.softness, invert: o.invert === true });
  },
  gpu: [{
    kind: 'shader',
    glsl: GLSL_LUMA,
    uniforms: (p, o) => ({ uThr: p.threshold, uSoft: Math.max(0.0005, p.softness), uInvert: o.invert === true ? 1 : 0 }),
  }],
});
