// Directional blur: a line blur at any angle. Distance is in movie px; quality is the number of taps.
import { registerEffect, type FxOpts, type FxParams } from './registry';
import { directionalBlurCpu } from './fx2-cpu';
import { GLSL_DIRBLUR } from './fx2-glsl';

const svg = (b: string): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${b}</svg>`;

const shiftOf = (o: FxOpts): number => (o.sides === 'trailing' ? 0.5 : o.sides === 'leading' ? -0.5 : 0);

registerEffect({
  id: 'dirblur',
  label: 'Directional Blur',
  icon: svg('<path d="M3 8h18M3 12h18M3 16h18" opacity=".45"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>'),
  params: [
    { id: 'angle', label: 'Angle', short: 'Angle', min: -3600, max: 3600, step: 0.5, unit: 'deg', def: 0 },
    { id: 'distance', label: 'Distance', short: 'Dist', min: 0, max: 2000, step: 1, unit: 'px', def: 40 },
    { id: 'quality', label: 'Quality', short: 'Quality', min: 2, max: 64, step: 1, unit: '', def: 16 },
  ],
  options: [{ id: 'sides', label: 'Sides', choices: ['centered', 'trailing', 'leading'], def: 'centered' }],
  active: (p: FxParams) => p.distance > 0,
  pad: (p, o, c) => Math.ceil(p.distance * c.scale * (o.sides === 'centered' || o.sides === undefined ? 0.5 : 1)) + 1,
  cpu(src, dst, w, h, p, o, c, box) {
    directionalBlurCpu({ width: w, height: h, data: src }, { width: w, height: h, data: dst }, p.angle, p.distance * c.scale, p.quality, shiftOf(o), box);
  },
  gpu: [{
    kind: 'shader',
    glsl: GLSL_DIRBLUR,
    uniforms: (p, o, c) => {
      const th = (p.angle * Math.PI) / 180, d = p.distance * c.scale;
      return { uVec: [Math.cos(th) * d, -Math.sin(th) * d], uTaps: Math.max(1, Math.round(p.quality)), uShift: shiftOf(o) };
    },
  }],
});
