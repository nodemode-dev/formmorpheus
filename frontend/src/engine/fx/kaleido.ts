// Kaleidoscope: one wedge of the picture (turned by Angle, zoomed by Zoom) repeated and mirrored around a center.
// Bilinear taps on premultiplied color on both paths.
import { registerEffect, type Effect, type FxCtx, type FxParams, type GpuStep } from './registry';
import { premul, store, tap } from './fx2-cpu';
import { BILINEAR } from './fx2-glsl';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 4v7l-7 7-7-7V7z"/><path d="M12 3v18M5 7l14 7M19 7L5 14" opacity=".5"/></svg>';

const FX = `
uniform float uSeg;
uniform float uRot;
uniform vec2 uC;
uniform float uZoom;
${BILINEAR}
vec4 fx(ivec2 p) {
  vec2 v = vec2(p) + 0.5 - uC;
  float r = length(v) / uZoom;
  float ang = atan(v.y, v.x) - uRot;
  float seg = 6.2831853 / uSeg;
  float a = ang - seg * floor(ang / seg);
  if (a > seg * 0.5) a = seg - a;
  a += uRot;
  return bil(uC + r * vec2(cos(a), sin(a)));
}`;

const segs = (p: FxParams): number => Math.max(2, Math.round(p.segments));
const centre = (p: FxParams, c: FxCtx): [number, number] => [c.ox + (c.mw / 2 + p.centerX) * c.scale, c.oy + (c.mh / 2 + p.centerY) * c.scale];
const rotOf = (p: FxParams): number => (((p.angle * Math.PI) / 180) % (Math.PI * 2));

const effect: Effect = {
  id: 'kaleido',
  label: 'Kaleidoscope',
  icon: ICON,
  params: [
    { id: 'segments', label: 'Segments', min: 2, max: 32, step: 1, unit: '', def: 6 },
    { id: 'angle', label: 'Angle', min: -3600, max: 3600, step: 1, unit: 'deg', def: 0 },
    { id: 'zoom', label: 'Zoom', min: 0.2, max: 5, step: 0.01, unit: '%', display: 100, def: 1 },
    { id: 'centerX', label: 'Center X', short: 'CX', min: -20000, max: 20000, step: 1, unit: 'px', def: 0 },
    { id: 'centerY', label: 'Center Y', short: 'CY', min: -20000, max: 20000, step: 1, unit: 'px', def: 0 },
  ],
  active: () => true,
  // wedges fold the whole frame
  pad: (_p, _o, c) => Math.ceil(Math.max(c.mw, c.mh) * c.scale),
  cpu(src, dst, w, h, p, _o, c, box) {
    const pm = premul({ width: w, height: h, data: src });
    const out = { width: w, height: h, data: dst };
    const [cx, cy] = centre(p, c);
    const seg = (Math.PI * 2) / segs(p), rot = rotOf(p), zoom = Math.max(0.01, p.zoom);
    const acc = new Float32Array(4);
    for (let y = box.y0; y < box.y1; y++) {
      for (let x = box.x0; x < box.x1; x++) {
        const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
        const r = Math.hypot(vx, vy) / zoom;
        const ang = Math.atan2(vy, vx) - rot;
        let a = ang - seg * Math.floor(ang / seg);
        if (a > seg * 0.5) a = seg - a;
        a += rot;
        acc.fill(0);
        tap(pm, w, h, cx + r * Math.cos(a), cy + r * Math.sin(a), acc);
        store(out, (y * w + x) * 4, acc, 1);
      }
    }
  },
  gpu: (): GpuStep[] => [{
    kind: 'shader', glsl: FX,
    uniforms: (p: FxParams, _o, c: FxCtx) => ({ uSeg: segs(p), uRot: rotOf(p), uC: centre(p, c), uZoom: Math.max(0.01, p.zoom) }),
  }],
};

registerEffect(effect);
