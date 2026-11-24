import { describe, expect, it } from 'vitest';
import { evalAnim, orderOf, sideSpan, type GlyphBox, type TextPhase } from '@src/engine/text-anim';
import type { TextAnim, TextAnimSide } from '@src/engine/text-rich';

const glyphs = (n = 4): GlyphBox[] => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0, w: 10, size: 20, line: 0, word: Math.floor(i / 2) }));

const phase = (t: number, over: Partial<TextPhase> = {}): TextPhase => ({ t, dur: 100, fps: 24, inP: null, outP: null, typeP: null, ease: () => (u: number) => u, ...over });

const side = (over: Partial<TextAnimSide> = {}): TextAnimSide => ({ unit: 'char', fade: true, dur: 10, stagger: 0, order: 'forward', seed: 1, ease: 'linear', offset: 0, ...over });

const alphas = (anim: TextAnim, ph: TextPhase, n = 4): number[] => evalAnim(anim, glyphs(n), ph).fx.map((f) => f.alpha);

describe('orderOf', () => {
  it('ranks units front to back and back to front', () => {
    expect([...orderOf(4, 'forward', 0)]).toEqual([0, 1, 2, 3]);
    expect([...orderOf(4, 'backward', 0)]).toEqual([3, 2, 1, 0]);
  });

  it('ranks from the middle outward, the earlier unit first on a tie', () => {
    expect([...orderOf(5, 'center', 0)]).toEqual([3, 1, 0, 2, 4]);
    expect([...orderOf(4, 'center', 0)]).toEqual([2, 0, 1, 3]);
  });

  it('shuffles into a permutation that depends only on the seed', () => {
    const a = orderOf(20, 'random', 7);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect([...orderOf(20, 'random', 7)]).toEqual([...a]);
    expect([...orderOf(20, 'random', 8)]).not.toEqual([...a]);
    expect([...a]).not.toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('handles no units', () => {
    expect(orderOf(0, 'random', 1)).toHaveLength(0);
  });
});

describe('sideSpan', () => {
  it('lasts one unit plus a stagger for every further unit', () => {
    expect(sideSpan(side({ stagger: 5 }), 4)).toBe(25);
    expect(sideSpan(side({ stagger: 5 }), 1)).toBe(10);
    expect(sideSpan(side({ stagger: 5 }), 0)).toBe(10);
  });
});

describe('evalAnim without animators', () => {
  it('leaves every glyph at rest', () => {
    const r = evalAnim({}, glyphs(), phase(3));
    expect(r.settled).toBe(true);
    expect(r.cursor).toBeNull();
    expect(r.fx).toHaveLength(4);
    expect(r.fx[2]).toEqual({ vis: 1, show: 1, alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, cx: 25, cy: 0 });
  });
});

describe('build on', () => {
  it('fades from hidden to resting over its duration', () => {
    const anim = { in: side() };
    expect(alphas(anim, phase(0))).toEqual([0, 0, 0, 0]);
    expect(alphas(anim, phase(5))).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(evalAnim(anim, glyphs(), phase(5)).settled).toBe(false);
    const done = evalAnim(anim, glyphs(), phase(10));
    expect(done.settled).toBe(true);
    expect(done.fx.every((f) => f.alpha === 1 && f.show === 1)).toBe(true);
  });

  it('waits for its offset', () => {
    expect(alphas({ in: side({ offset: 20 }) }, phase(20))).toEqual([0, 0, 0, 0]);
    expect(alphas({ in: side({ offset: 20 }) }, phase(25))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('starts each unit one stagger after the one before in the chosen order', () => {
    expect(alphas({ in: side({ stagger: 5 }) }, phase(7.5))).toEqual([0.75, 0.25, 0, 0]);
    expect(alphas({ in: side({ stagger: 5, order: 'backward' }) }, phase(7.5))).toEqual([0, 0, 0.25, 0.75]);
  });

  it('animates whole words together around the centre of the word', () => {
    const r = evalAnim({ in: side({ unit: 'word', stagger: 5 }) }, glyphs(), phase(5));
    expect(r.fx.map((f) => f.alpha)).toEqual([0.5, 0.5, 0, 0]);
    expect(r.fx.map((f) => f.cx)).toEqual([10, 10, 30, 30]);
  });

  it('treats one line as one unit', () => {
    expect(alphas({ in: side({ unit: 'line', stagger: 50 }) }, phase(5))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('slides in from the chosen side and ends in place', () => {
    const up = evalAnim({ in: side({ fade: false, slide: { dir: 'up', dist: 20 } }) }, glyphs(), phase(0)).fx[0];
    expect([up.dx, up.dy]).toEqual([0, 20]);
    const left = evalAnim({ in: side({ fade: false, slide: { dir: 'left', dist: 20 } }) }, glyphs(), phase(5)).fx[0];
    expect([left.dx, left.dy]).toEqual([10, 0]);
    const end = evalAnim({ in: side({ fade: false, slide: { dir: 'down', dist: 20 } }) }, glyphs(), phase(10)).fx[0];
    expect(Math.abs(end.dx) + Math.abs(end.dy)).toBe(0);
  });

  it('scales, turns and blurs in step with how hidden the unit is', () => {
    const f = evalAnim({ in: side({ fade: false, scale: 2, rotate: 90, blur: 8 }) }, glyphs(), phase(5)).fx[0];
    expect(f).toMatchObject({ scale: 1.5, rot: 45, blur: 4, alpha: 1, show: 0.5 });
  });

  it('follows a keyed progress instead of the clock and clamps it', () => {
    const anim = { in: side({ stagger: 5 }) };
    expect(alphas(anim, phase(999, { inP: 0.5 }))).toEqual([1, 0.75, 0.25, 0]);
    expect(evalAnim(anim, glyphs(), phase(0, { inP: 7 })).settled).toBe(true);
    expect(alphas(anim, phase(50, { inP: -3 }))).toEqual([0, 0, 0, 0]);
  });

  it('applies the ease curve it is handed', () => {
    const ph = phase(5, { ease: () => (u: number) => u * u });
    expect(alphas({ in: side() }, ph)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('animates only the units inside the selector window', () => {
    expect(alphas({ in: side({ range: { start: 0, end: 50, shift: 0 } }) }, phase(0))).toEqual([0, 0, 1, 1]);
    expect(alphas({ in: side({ range: { start: 0, end: 50, shift: 50 } }) }, phase(0))).toEqual([1, 1, 0, 0]);
  });
});

describe('build off', () => {
  it('rests until the end of the block and finishes hidden on its last frame', () => {
    const anim = { out: side() };
    expect(evalAnim(anim, glyphs(), phase(50)).settled).toBe(true);
    expect(alphas(anim, phase(95))).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(alphas(anim, phase(100))).toEqual([0, 0, 0, 0]);
  });

  it('finishes earlier by its offset', () => {
    expect(alphas({ out: side({ offset: 10 }) }, phase(90))).toEqual([0, 0, 0, 0]);
    expect(alphas({ out: side({ offset: 10 }) }, phase(80))).toEqual([1, 1, 1, 1]);
  });

  it('slides away opposite to the way a build on arrives', () => {
    const f = evalAnim({ out: side({ fade: false, slide: { dir: 'up', dist: 20 } }) }, glyphs(), phase(100)).fx[0];
    expect([f.dx, f.dy]).toEqual([0, -20]);
  });

  it('keeps units outside the selector window visible', () => {
    expect(alphas({ out: side({ range: { start: 50, end: 100, shift: 0 } }) }, phase(100))).toEqual([1, 1, 0, 0]);
  });

  it('combines with a build on', () => {
    const anim = { in: side(), out: side() };
    expect(alphas(anim, phase(5))).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(evalAnim(anim, glyphs(), phase(50)).settled).toBe(true);
    expect(alphas(anim, phase(95))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe('typewriter', () => {
  const type = (over: Record<string, unknown> = {}): TextAnim => ({ type: { cps: 12, cursor: false, offset: 0, ...over } });
  const vis = (anim: TextAnim, ph: TextPhase): number[] => evalAnim(anim, glyphs(), ph).fx.map((f) => f.vis);

  it('reveals characters at the given rate', () => {
    expect(vis(type(), phase(0))).toEqual([0, 0, 0, 0]);
    expect(vis(type(), phase(4))).toEqual([1, 1, 0, 0]);
    expect(vis(type(), phase(5))).toEqual([1, 1, 0, 0]);
    expect(vis(type(), phase(500))).toEqual([1, 1, 1, 1]);
  });

  it('is settled only once everything is typed', () => {
    expect(evalAnim(type(), glyphs(), phase(4)).settled).toBe(false);
    expect(evalAnim(type(), glyphs(), phase(8)).settled).toBe(true);
  });

  it('waits for its offset and shows nothing before the block starts', () => {
    expect(vis(type({ offset: 10 }), phase(10))).toEqual([0, 0, 0, 0]);
    expect(vis(type({ offset: 10 }), phase(14))).toEqual([1, 1, 0, 0]);
    expect(vis(type(), phase(-6))).toEqual([0, 0, 0, 0]);
  });

  it('follows a keyed progress', () => {
    expect(vis(type(), phase(0, { typeP: 0.5 }))).toEqual([1, 1, 0, 0]);
    expect(vis(type(), phase(0, { typeP: 9 }))).toEqual([1, 1, 1, 1]);
    expect(evalAnim(type(), glyphs(), phase(0, { typeP: 1 })).settled).toBe(false);
  });

  it('erases back to front at the end of the block', () => {
    const anim = type({ erase: true });
    expect(vis(anim, phase(50))).toEqual([1, 1, 1, 1]);
    expect(vis(anim, phase(96))).toEqual([1, 1, 0, 0]);
    expect(vis(anim, phase(100))).toEqual([0, 0, 0, 0]);
    expect(vis(type({ erase: true, eraseOffset: 10 }), phase(90))).toEqual([0, 0, 0, 0]);
  });

  it('puts the cursor after the last typed character', () => {
    expect(evalAnim(type({ cursor: true }), glyphs(), phase(0)).cursor).toEqual({ x: 0, y: 0, size: 20, glyph: 0 });
    expect(evalAnim(type({ cursor: true }), glyphs(), phase(4)).cursor).toEqual({ x: 20, y: 0, size: 20, glyph: 1 });
  });

  it('blinks the cursor twice a second once typing is done', () => {
    const on = evalAnim(type({ cursor: true }), glyphs(), phase(30));
    expect(on.cursor).toEqual({ x: 40, y: 0, size: 20, glyph: 3 });
    expect(on.settled).toBe(false);
    const off = evalAnim(type({ cursor: true }), glyphs(), phase(14));
    expect(off.cursor).toBeNull();
    expect(off.settled).toBe(true);
  });

  it('does nothing on empty text', () => {
    const r = evalAnim(type({ cursor: true }), [], phase(4));
    expect(r).toEqual({ fx: [], settled: true, cursor: null });
  });
});
