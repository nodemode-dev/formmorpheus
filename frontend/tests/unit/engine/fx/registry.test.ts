import { describe, expect, it, vi } from 'vitest';
import '@src/engine/fx';
import { kindSpec } from '@src/engine/keys';
import {
  activeFx, allEffects, alphaBox, applyFxCpu, colorParams, effectOf, fxKind, gpuSteps, registerEffect, rgbOf,
  type Effect, type FxBox, type FxCtx, type GpuStep,
} from '@src/engine/fx/registry';

const ctx = (over: Partial<FxCtx> = {}): FxCtx => ({ scale: 1, ox: 0, oy: 0, mw: 4, mh: 4, ...over });

function picture(w: number, h: number, opaque: [number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) d.set([10, 20, 30, 255], (y * w + x) * 4);
  return d;
}

function fake(id: string, over: Partial<Effect> = {}): Effect {
  return {
    id, label: id, icon: '', params: [], active: () => true, pad: () => 0,
    cpu(src, dst, _w, _h, _p, _o, _c, box) {
      for (let i = 0; i < src.length; i += 4) { dst[i] = src[i] + 1; dst[i + 1] = box.x0; dst[i + 2] = box.x1; dst[i + 3] = src[i + 3]; }
    },
    gpu: [],
    ...over,
  };
}

describe('alphaBox', () => {
  it('returns null for a fully transparent picture', () => {
    expect(alphaBox(new Uint8ClampedArray(3 * 2 * 4), 3, 2)).toBeNull();
  });

  it('returns null for a picture of zero size', () => {
    expect(alphaBox(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });

  it('bounds a single pixel with an exclusive far edge', () => {
    expect(alphaBox(picture(5, 4, [[2, 1]]), 5, 4)).toEqual({ x0: 2, y0: 1, x1: 3, y1: 2 });
  });

  it('spans scattered pixels on both axes', () => {
    expect(alphaBox(picture(6, 5, [[4, 0], [1, 3], [3, 2]]), 6, 5)).toEqual({ x0: 1, y0: 0, x1: 5, y1: 4 });
  });

  it('counts a pixel with the faintest alpha', () => {
    const d = new Uint8ClampedArray(2 * 2 * 4);
    d[15] = 1;
    expect(alphaBox(d, 2, 2)).toEqual({ x0: 1, y0: 1, x1: 2, y1: 2 });
  });
});

describe('colour parameters', () => {
  it('makes three channels with the swatch on the first only', () => {
    const ps = colorParams('tint', 'Tint', [0.1, 0.2, 0.3]);
    expect(ps.map((q) => q.id)).toEqual(['tintR', 'tintG', 'tintB']);
    expect(ps.map((q) => q.def)).toEqual([0.1, 0.2, 0.3]);
    expect(ps.map((q) => q.swatch)).toEqual(['tint', undefined, undefined]);
    expect(ps.every((q) => q.min === 0 && q.max === 1 && q.display === 255)).toBe(true);
  });

  it('applies the extra fields to every channel', () => {
    const ps = colorParams('c', 'Color', [0, 0, 0], { adv: true, step: 0.5 });
    expect(ps.every((q) => q.adv === true && q.step === 0.5)).toBe(true);
  });

  it('reads a colour back and treats missing channels as zero', () => {
    expect(rgbOf({ kR: 0.25, kB: 1 }, 'k')).toEqual([0.25, 0, 1]);
    expect(rgbOf({}, 'k')).toEqual([0, 0, 0]);
  });
});

describe('registerEffect', () => {
  it('keeps the first effect registered under an id', () => {
    const first = fake('f21-once', { label: 'First' });
    registerEffect(first);
    registerEffect(fake('f21-once', { label: 'Second' }));
    expect(effectOf('f21-once')).toBe(first);
    expect(allEffects().filter((e) => e.id === 'f21-once')).toHaveLength(1);
  });

  it('answers undefined for an unknown id', () => {
    expect(effectOf('f21-nobody')).toBeUndefined();
  });

  it('publishes a lane kind with display factors derived from the unit', () => {
    registerEffect(fake('f21-spec', {
      label: 'Spec',
      params: [
        { id: 'a', label: 'Amount', min: 0, max: 1, step: 0.01, unit: '%', def: 0.5 },
        { id: 'b', label: 'Size', short: 'Sz', min: 0, max: 9, step: 1, unit: 'px', def: 3, adv: true },
        { id: 'c', label: 'Raw', min: 0, max: 1, step: 0.01, unit: '%', display: 7, def: 0 },
      ],
      options: [{ id: 'mode', label: 'Mode', choices: ['x', 'y'], def: 'x' }, { id: 'h', label: 'Hidden', def: 'v', hidden: true }],
    }));
    const spec = kindSpec(fxKind('f21-spec'));
    expect(spec.kind).toBe('fx:f21-spec');
    expect(spec.fx).toBe(true);
    expect(spec.label).toBe('Spec');
    expect(spec.channels.map((q) => [q.id, q.short, q.display, q.def])).toEqual([
      ['a', 'Amount', 100, 0.5], ['b', 'Sz', 1, 3], ['c', 'Raw', 7, 0],
    ]);
    expect(spec.channels[1].adv).toBe(true);
    expect(spec.channels[0].adv).toBeUndefined();
    expect(spec.options).toEqual([{ id: 'mode', label: 'Mode', choices: ['x', 'y'], def: 'x' }, { id: 'h', label: 'Hidden', def: 'v', hidden: true }]);
  });
});

describe('activeFx', () => {
  it('returns nothing for a missing list', () => {
    expect(activeFx(null)).toEqual([]);
    expect(activeFx(undefined)).toEqual([]);
  });

  it('keeps the order and drops unknown and inactive effects', () => {
    registerEffect(fake('f21-on'));
    registerEffect(fake('f21-gated', { active: (p) => p.amount > 0 }));
    const list = [
      { id: 'f21-gated', p: { amount: 0 }, o: {} },
      { id: 'f21-on', p: {}, o: {} },
      { id: 'f21-missing', p: {}, o: {} },
      { id: 'f21-gated', p: { amount: 2 }, o: {} },
    ];
    const out = activeFx(list);
    expect(out.map((x) => x.e.id)).toEqual(['f21-on', 'f21-gated']);
    expect(out[1].inst).toBe(list[3]);
  });
});

describe('applyFxCpu', () => {
  it('returns the input untouched for an empty list', () => {
    const d = picture(2, 2, [[0, 0]]);
    expect(applyFxCpu([], d, 2, 2, ctx())).toBe(d);
  });

  it('returns a different buffer holding the result of one effect', () => {
    const d = picture(2, 2, [[0, 0]]);
    const out = applyFxCpu([{ e: fake('one'), inst: { id: 'one', p: {}, o: {} } }], d, 2, 2, ctx());
    expect(out).not.toBe(d);
    expect(out[0]).toBe(11);
    expect(d[0]).toBe(10);
  });

  it('chains two effects and ends in the caller array', () => {
    const d = picture(2, 2, [[0, 0]]);
    const step = { e: fake('two'), inst: { id: 'two', p: {}, o: {} } };
    const out = applyFxCpu([step, step], d, 2, 2, ctx());
    expect(out).toBe(d);
    expect(out[0]).toBe(12);
  });

  it('does not run an effect on an empty picture', () => {
    const cpu = vi.fn();
    const d = new Uint8ClampedArray(2 * 2 * 4);
    const out = applyFxCpu([{ e: fake('none', { cpu }), inst: { id: 'none', p: {}, o: {} } }], d, 2, 2, ctx());
    expect(cpu).not.toHaveBeenCalled();
    expect(out).toBe(d);
  });

  it('grows the box by the rounded up pad and clamps it to the surface', () => {
    const seen: FxBox[] = [];
    const spy = (pad: number): Effect => fake('spy', { pad: () => pad, cpu: (_s, _d, _w, _h, _p, _o, _c, box) => { seen.push({ ...box }); } });
    const d = picture(10, 10, [[5, 5]]);
    applyFxCpu([{ e: spy(1.2), inst: { id: 'spy', p: {}, o: {} } }], d, 10, 10, ctx());
    applyFxCpu([{ e: spy(50), inst: { id: 'spy', p: {}, o: {} } }], d, 10, 10, ctx());
    expect(seen).toEqual([{ x0: 3, y0: 3, x1: 8, y1: 8 }, { x0: 0, y0: 0, x1: 10, y1: 10 }]);
  });

  it('hands each effect a zeroed destination', () => {
    const d = picture(2, 1, [[0, 0], [1, 0]]);
    const blank = fake('blank', { cpu: (_s, dst) => { expect(Array.from(dst)).toEqual(new Array(8).fill(0)); } });
    const paint = { e: fake('paint'), inst: { id: 'paint', p: {}, o: {} } };
    applyFxCpu([paint, paint, { e: blank, inst: { id: 'blank', p: {}, o: {} } }], d, 2, 1, ctx());
  });
});

describe('gpuSteps', () => {
  it('returns a fixed pass list as it is', () => {
    const steps: GpuStep[] = [{ kind: 'shader', glsl: 'x' }];
    expect(gpuSteps(fake('g', { gpu: steps }), {}, {})).toBe(steps);
  });

  it('asks a pass function with the values', () => {
    const e = fake('g2', { gpu: (p) => (p.soft > 0 ? [{ kind: 'blur', from: 0, sigma: () => p.soft }] : []) });
    expect(gpuSteps(e, { soft: 0 }, {})).toEqual([]);
    expect(gpuSteps(e, { soft: 3 }, {})).toHaveLength(1);
  });
});

describe('the built-in effects', () => {
  const builtIn = (): Effect[] => allEffects().filter((e) => !e.id.startsWith('f21-'));
  const defaults = (e: Effect): Record<string, number> => Object.fromEntries(e.params.map((q) => [q.id, q.def]));
  const need = (id: string): Effect => {
    const e = effectOf(id);
    if (!e) throw new Error(`effect ${id} is not registered`);
    return e;
  };

  it('registers every effect of the assignment', () => {
    for (const id of ['shadow', 'vignette', 'pixelate', 'radblur', 'chromakey', 'lumakey', 'motionblur', 'mirror', 'ripple', 'outline', 'kaleido', 'unsharp']) {
      expect(effectOf(id), id).toBeDefined();
    }
  });

  it('keeps every default inside its range with a positive step', () => {
    for (const e of builtIn()) {
      for (const q of e.params) {
        expect(q.min, `${e.id}.${q.id}`).toBeLessThan(q.max);
        expect(q.def, `${e.id}.${q.id}`).toBeGreaterThanOrEqual(q.min);
        expect(q.def, `${e.id}.${q.id}`).toBeLessThanOrEqual(q.max);
        expect(q.step, `${e.id}.${q.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('never repeats a parameter id inside one effect', () => {
    for (const e of builtIn()) {
      const ids = e.params.map((q) => q.id);
      expect(new Set(ids).size, e.id).toBe(ids.length);
    }
  });

  it('defaults every choice option to one of its choices', () => {
    for (const e of builtIn()) {
      for (const o of e.options ?? []) if (o.choices) expect(o.choices, `${e.id}.${o.id}`).toContain(o.def);
    }
  });

  it('skips effects whose amount is zero', () => {
    for (const [id, key] of [['shadow', 'opacity'], ['vignette', 'amount'], ['radblur', 'amount'], ['ripple', 'amount'], ['unsharp', 'amount'], ['outline', 'width'], ['outline', 'opacity']] as const) {
      const e = need(id);
      const p = defaults(e);
      expect(e.active(p, {}), id).toBe(true);
      expect(e.active({ ...p, [key]: 0 }, {}), `${id}.${key}`).toBe(false);
    }
  });

  it('never runs motion blur as a per-picture pass', () => {
    const e = need('motionblur');
    expect(e.active(defaults(e), {})).toBe(false);
  });

  it('pads a shadow by its offset and softness in surface pixels', () => {
    const e = need('shadow');
    const p = { ...defaults(e), angle: 0, distance: 10, softness: 4 };
    expect(e.pad(p, {}, ctx({ scale: 2 }))).toBeCloseTo(20 + 12 + 2, 6);
    expect(e.pad({ ...p, angle: 90 }, {}, ctx({ scale: 2 }))).toBeCloseTo(34, 6);
  });

  it('pads a ripple by its scaled amount', () => {
    const e = need('ripple');
    expect(e.pad({ ...defaults(e), amount: 2.5 }, {}, ctx({ scale: 3 }))).toBe(10);
  });

  it('pads the whole stage for kaleidoscope and radial blur', () => {
    const c = ctx({ scale: 1.5, mw: 100, mh: 31 });
    expect(need('kaleido').pad({}, {}, c)).toBe(150);
    expect(need('radblur').pad({}, {}, c)).toBe(150);
  });

  it('pads pixelate by one cell and never by less than a pixel', () => {
    const e = need('pixelate');
    expect(e.pad({ size: 16, dot: 1 }, {}, ctx({ scale: 0.5 }))).toBe(8);
    expect(e.pad({ size: 2, dot: 1 }, {}, ctx({ scale: 0.1 }))).toBe(1);
  });

  it('clamps the chroma key choke to eight surface pixels either way', () => {
    const e = need('chromakey');
    const step = gpuSteps(e, {}, {})[0];
    if (step.kind !== 'shader' || !step.uniforms) throw new Error('expected a shader step with uniforms');
    const p = defaults(e);
    expect(step.uniforms({ ...p, choke: 6 }, {}, ctx({ scale: 4 })).uChoke).toBe(8);
    expect(step.uniforms({ ...p, choke: -6 }, {}, ctx({ scale: 4 })).uChoke).toBe(-8);
    expect(step.uniforms({ ...p, choke: 3 }, {}, ctx({ scale: 2 })).uChoke).toBe(6);
    expect(step.uniforms({ ...p, softness: 0 }, {}, ctx()).uSoft).toBeGreaterThan(0);
    expect(step.uniforms(p, { view: true }, ctx()).uView).toBe(1);
    expect(step.uniforms(p, { view: 'yes' }, ctx()).uView).toBe(0);
  });

  it('keeps the luma key softness above zero and reads the invert switch', () => {
    const e = need('lumakey');
    const step = gpuSteps(e, {}, {})[0];
    if (step.kind !== 'shader' || !step.uniforms) throw new Error('expected a shader step with uniforms');
    const u = step.uniforms({ threshold: 0.4, softness: 0 }, { invert: true }, ctx());
    expect(u.uThr).toBe(0.4);
    expect(u.uSoft).toBeGreaterThan(0);
    expect(u.uInvert).toBe(1);
  });
});
