// Ripple: the picture displaced by a travelling sine, as rings from a center or as a horizontal or vertical wave.
// Phase is keyable, so keying it over time makes the rings travel. Bilinear taps on premultiplied color on both paths.
import { registerEffect, type Effect, type FxCtx, type FxOpts, type FxParams, type GpuStep } from './registry';
import { premul, store, tap } from './fx2-cpu';
import { BILINEAR } from './fx2-glsl';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.5" opacity=".7"/><circle cx="12" cy="12" r="9" opacity=".4"/></svg>';

const MODES = ['rings', 'wave across', 'wave down'];
const modeOf = (o: FxOpts): number => Math.max(0, MODES.indexOf(String(o.mode)));
const TAU = Math.PI * 2;
const phaseOf = (p: FxParams): number => ((((p.phase * Math.PI) / 180) % TAU) + TAU) % TAU;
const centre = (p: FxParams, c: FxCtx): [number, number] => [c.ox + (c.mw / 2 + p.centerX) * c.scale, c.oy + (c.mh / 2 + p.centerY) * c.scale];
const diagOf = (c: FxCtx): number => Math.max(1, Math.hypot(c.mw, c.mh) * c.scale);

const FX = `
uniform float uAmt;
uniform float uWl;
uniform float uPh;
uniform vec2 uC;
uniform float uDecay;
uniform float uMode;
uniform float uDiag;
${BILINEAR}
vec4 fx(ivec2 p) {
  vec2 u = vec2(p) + 0.5;
  vec2 v = u - uC;
  float d = length(v);
  float amp = uAmt * exp(-uDecay * 4.0 * d / uDiag);
  vec2 q = u;
  if (uMode < 0.5) {
    vec2 dir = d > 0.001 ? v / d : vec2(0.0);
    q = u + dir * (amp * sin(6.2831853 * d / uWl - uPh));
  } else if (uMode < 1.5) {
    q.y = u.y + amp * sin(6.2831853 * v.x / uWl - uPh);
  } else {
    q.x = u.x + amp * sin(6.2831853 * v.y / uWl - uPh);
  }
  return bil(q);
}`;

const effect: Effect = {
  id: 'ripple',
  label: 'Ripple',
  icon: ICON,
  params: [
    { id: 'amount', label: 'Amount', min: 0, max: 200, step: 0.5, unit: 'px', def: 12 },
    { id: 'wavelength', label: 'Wavelength', short: 'Length', min: 4, max: 1000, step: 1, unit: 'px', def: 80 },
    { id: 'phase', label: 'Phase', min: -7200, max: 7200, step: 1, unit: 'deg', def: 0 },
    { id: 'decay', label: 'Fade with distance', short: 'Fade', min: 0, max: 1, step: 0.01, unit: '%', display: 100, def: 0 },
    { id: 'centerX', label: 'Center X', short: 'CX', min: -20000, max: 20000, step: 1, unit: 'px', def: 0, adv: true },
    { id: 'centerY', label: 'Center Y', short: 'CY', min: -20000, max: 20000, step: 1, unit: 'px', def: 0, adv: true },
  ],
  options: [{ id: 'mode', label: 'Shape', choices: MODES, def: 'rings' }],
  active: (p) => p.amount > 0,
  pad: (p, _o, c) => Math.ceil(p.amount * c.scale) + 2,
  cpu(src, dst, w, h, p, o, c, box) {
    const ras = { width: w, height: h, data: src };
    const pm = premul(ras);
    const out = { width: w, height: h, data: dst };
    const [cx, cy] = centre(p, c);
    const mode = modeOf(o), amt = p.amount * c.scale, wl = Math.max(1, p.wavelength * c.scale), ph = phaseOf(p), diag = diagOf(c);
    const acc = new Float32Array(4);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const ux = x + 0.5, uy = y + 0.5, vx = ux - cx, vy = uy - cy;
        const d = Math.hypot(vx, vy);
        const amp = amt * Math.exp((-p.decay * 4 * d) / diag);
        let qx = ux, qy = uy;
        if (mode === 0) {
          if (d > 0.001) { const s = amp * Math.sin((TAU * d) / wl - ph); qx += (vx / d) * s; qy += (vy / d) * s; }
        } else if (mode === 1) qy += amp * Math.sin((TAU * vx) / wl - ph);
        else qx += amp * Math.sin((TAU * vy) / wl - ph);
        acc.fill(0);
        tap(pm, w, h, qx, qy, acc);
        store(out, (y * w + x) * 4, acc, 1);
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams, o: FxOpts, c: FxCtx) => ({ uAmt: p.amount * c.scale, uWl: Math.max(1, p.wavelength * c.scale), uPh: phaseOf(p), uC: centre(p, c), uDecay: p.decay, uMode: modeOf(o), uDiag: diagOf(c) }),
  }],
};

registerEffect(effect);
