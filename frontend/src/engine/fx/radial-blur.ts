// Radial blur: spin (degrees) or zoom (percent) about a centre given in movie px from the Stage centre.
import { registerEffect, type FxCtx, type FxParams } from './registry';
import { radialBlurCpu } from './fx2-cpu';
import { GLSL_RADBLUR } from './fx2-glsl';

const svg = (b: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${b}</svg>`;

/** Centre on the surface in px. */
export const radialCenter = (p: FxParams, c: FxCtx): [number, number] =>
  [c.ox + (c.mw / 2 + p.centerX) * c.scale, c.oy + (c.mh / 2 + p.centerY) * c.scale];

registerEffect({
  id: 'radblur',
  label: 'Radial Blur',
  icon: svg('<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2L18 18M18 6l-2.8 2.8M8.8 15.2L6 18" opacity=".6"/>'),
  params: [
    { id: 'amount', label: 'Amount', short: 'Amount', min: 0, max: 360, step: 0.5, unit: '', def: 10 },
    { id: 'centerX', label: 'Center X', short: 'CX', min: -20000, max: 20000, step: 1, unit: 'px', def: 0 },
    { id: 'centerY', label: 'Center Y', short: 'CY', min: -20000, max: 20000, step: 1, unit: 'px', def: 0 },
    { id: 'quality', label: 'Quality', short: 'Quality', min: 2, max: 64, step: 1, unit: '', def: 16 },
  ],
  options: [{ id: 'mode', label: 'Mode', choices: ['spin', 'zoom'], def: 'spin' }],
  active: (p) => p.amount > 0,
  // the smear can reach anywhere on the frame
  pad: (_p, _o, c) => Math.ceil(Math.max(c.mw, c.mh) * c.scale),
  cpu(src, dst, w, h, p, o, c, box) {
    const [cx, cy] = radialCenter(p, c);
    radialBlurCpu({ width: w, height: h, data: src }, { width: w, height: h, data: dst }, o.mode === 'zoom', p.amount, cx, cy, p.quality, box);
  },
  gpu: [{
    kind: 'shader',
    glsl: GLSL_RADBLUR,
    uniforms: (p, o, c) => {
      const zoom = o.mode === 'zoom';
      return { uC: radialCenter(p, c), uAmount: zoom ? p.amount / 100 : (p.amount * Math.PI) / 180, uZoom: zoom ? 1 : 0, uTaps: Math.max(1, Math.round(p.quality)) };
    },
  }],
});
