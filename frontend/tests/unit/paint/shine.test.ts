import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bakeShine, hasShine } from '@src/paint/shine';
import type { ShineOptions } from '@src/paint/shine';
import type { Shine } from '@src/paint/types';

const W = 48;
const H = 48;
const OPT: ShineOptions = { baseDia: 20, tooth: null, bump: 0, sel: null, lock: false };

function disc(): { data: Uint8ClampedArray; cov: Uint16Array } {
  const data = new Uint8ClampedArray(W * H * 4);
  const cov = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (Math.hypot(x - 23.5, y - 23.5) <= 14) {
        cov[i] = 65535;
        data.set([120, 120, 120, 200], i * 4);
      }
    }
  }
  return { data, cov };
}

function quad(data: Uint8ClampedArray, left: boolean, top: boolean): number {
  let s = 0;
  for (let y = top ? 0 : 24; y < (top ? 24 : H); y++) {
    for (let x = left ? 0 : 24; x < (left ? 24 : W); x++) s += data[(y * W + x) * 4];
  }
  return s;
}

function bake(s: Shine): Uint8ClampedArray {
  const { data, cov } = disc();
  bakeShine(data, W, H, cov, { x0: 0, y0: 0, x1: W, y1: H }, s, OPT);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('hasShine', () => {
  it('is false for a missing material', () => {
    expect(hasShine(undefined)).toBe(false);
  });

  it('is false when depth, gloss and metal are all at or below the threshold', () => {
    expect(hasShine({ depth: 0, gloss: 0, metal: 0 })).toBe(false);
    expect(hasShine({ depth: 0.001, gloss: 0.001, metal: 0.001 })).toBe(false);
  });

  it('is true when any one of depth, gloss or metal is set', () => {
    expect(hasShine({ depth: 0.5, gloss: 0, metal: 0 })).toBe(true);
    expect(hasShine({ depth: 0, gloss: 0.2, metal: 0 })).toBe(true);
    expect(hasShine({ depth: 0, gloss: 0, metal: 0.01 })).toBe(true);
  });
});

describe('bakeShine', () => {
  it('changes the colour of covered pixels', () => {
    const out = bake({ depth: 1, gloss: 0.5, metal: 0 });
    const base = disc().data;
    let changed = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i] !== base[i]) changed++;
    expect(changed).toBeGreaterThan(50);
  });

  it('never touches alpha or pixels the stroke did not cover', () => {
    const out = bake({ depth: 1, gloss: 1, metal: 0.5 });
    const { data: base, cov } = disc();
    for (let i = 0; i < cov.length; i++) {
      expect(out[i * 4 + 3]).toBe(base[i * 4 + 3]);
      if (cov[i] === 0) expect(out[i * 4]).toBe(0);
    }
  });

  it('lights the side facing the default light more than the far side', () => {
    const out = bake({ depth: 1, gloss: 0, metal: 0 });
    expect(quad(out, true, true)).toBeGreaterThan(quad(out, false, false));
  });

  it('moves the lit side when the light angle is turned around', () => {
    const out = bake({ depth: 1, gloss: 0, metal: 0, light: 315 });
    expect(quad(out, false, false)).toBeGreaterThan(quad(out, true, true));
  });

  it('leaves the pixels alone when the rect is thinner than two pixels', () => {
    const { data, cov } = disc();
    const base = data.slice();
    bakeShine(data, W, H, cov, { x0: 30, y0: 10, x1: 30, y1: 40 }, { depth: 1, gloss: 1, metal: 1 }, OPT);
    bakeShine(data, W, H, cov, { x0: 60, y0: 60, x1: 80, y1: 80 }, { depth: 1, gloss: 1, metal: 1 }, OPT);
    expect(Array.from(data)).toEqual(Array.from(base));
  });

  it('only lights pixels inside the given rect', () => {
    const { data, cov } = disc();
    const base = data.slice();
    bakeShine(data, W, H, cov, { x0: 10, y0: 10, x1: 24, y1: 24 }, { depth: 1, gloss: 1, metal: 0 }, OPT);
    let outside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < 24 && y < 24) continue;
        if (data[(y * W + x) * 4] !== base[(y * W + x) * 4]) outside++;
      }
    }
    expect(outside).toBe(0);
  });
});
