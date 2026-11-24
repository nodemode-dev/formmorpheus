import { effectOf, gpuSteps, type Effect, type FxBox, type FxCtx, type FxOpts, type FxParams, type Uniforms } from '@src/engine/fx/registry';

export function fx(id: string): Effect {
  const e = effectOf(id);
  if (!e) throw new Error(`effect ${id} is not registered`);
  return e;
}

export function defaults(e: Effect, over: FxParams = {}): FxParams {
  const p: FxParams = {};
  for (const q of e.params) p[q.id] = q.def;
  return { ...p, ...over };
}

export function ctx(w: number, h: number, scale = 1): FxCtx {
  return { scale, ox: 0, oy: 0, mw: w / scale, mh: h / scale };
}

export function run(e: Effect, px: number[], w: number, h: number, p: FxParams, o: FxOpts = {}, box?: FxBox, c?: FxCtx): number[] {
  const src = new Uint8ClampedArray(px);
  const dst = new Uint8ClampedArray(px.length);
  const cpu = e.cpu;
  if (!cpu) throw new Error('effect has no cpu path');
  cpu.call(e, src, dst, w, h, p, o, c ?? ctx(w, h), box ?? { x0: 0, y0: 0, x1: w, y1: h });
  return Array.from(dst);
}

export function uniformsOf(e: Effect, p: FxParams, o: FxOpts = {}, c: FxCtx = ctx(4, 4), step = 0): Uniforms {
  const s = gpuSteps(e, p, o)[step];
  if (s.kind !== 'shader' || !s.uniforms) throw new Error('step has no uniforms');
  return s.uniforms(p, o, c);
}
