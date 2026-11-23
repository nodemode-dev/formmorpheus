import { describe, expect, it } from 'vitest';
import { resample, reversed, stretch } from '@src/engine/time-stretch';

function sine(hz: number, sampleRate: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

function crossings(ch: Float32Array): number {
  let n = 0;
  let last = 0;
  for (const v of ch) {
    if (Math.abs(v) < 0.02) continue;
    if (last !== 0 && v * last < 0) n++;
    last = v;
  }
  return n;
}

describe('reversed', () => {
  it('returns the samples back to front in a new array', () => {
    const src = Float32Array.from([1, 2, 3, 4]);
    const out = reversed(src);
    expect(Array.from(out)).toEqual([4, 3, 2, 1]);
    expect(Array.from(src)).toEqual([1, 2, 3, 4]);
    expect(out).not.toBe(src);
  });

  it('gives the original back when applied twice', () => {
    const src = Float32Array.from([0.5, -0.25, 0.125]);
    expect(Array.from(reversed(reversed(src)))).toEqual(Array.from(src));
  });

  it('handles an empty channel', () => {
    expect(reversed(new Float32Array(0)).length).toBe(0);
  });
});

describe('resample', () => {
  it('halves the length at twice the speed', () => {
    expect(Array.from(resample(Float32Array.from([0, 1, 2, 3]), 2))).toEqual([0, 2]);
  });

  it('interpolates between samples at half speed and holds the last one', () => {
    expect(Array.from(resample(Float32Array.from([0, 2, 4]), 0.5))).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('copies the samples at speed one', () => {
    const src = Float32Array.from([0.5, -0.5, 0.25]);
    const out = resample(src, 1);
    expect(Array.from(out)).toEqual(Array.from(src));
    expect(out).not.toBe(src);
  });

  it('gives one silent sample for an empty channel', () => {
    expect(Array.from(resample(new Float32Array(0), 2))).toEqual([0]);
  });

  it('raises the pitch with the speed', () => {
    const out = resample(sine(200, 8000, 8000), 2);
    expect(out.length).toBe(4000);
    expect(Math.abs(crossings(out) - 400)).toBeLessThan(6);
  });
});

describe('stretch', () => {
  it('returns copies at speed one', () => {
    const a = Float32Array.from([1, 2, 3]);
    const [out] = stretch([a], 1, 48000);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out).not.toBe(a);
  });

  it('returns nothing for no channels', () => {
    expect(stretch([], 2, 48000)).toEqual([]);
  });

  it('returns empty channels for empty input', () => {
    const out = stretch([new Float32Array(0)], 2, 48000);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(0);
  });

  it('makes every channel the input length divided by the speed', () => {
    const l = sine(200, 8000, 8000);
    const r = sine(300, 8000, 8000);
    const fast = stretch([l, r], 2, 8000);
    expect(fast.map((c) => c.length)).toEqual([4000, 4000]);
    const slow = stretch([l, r], 0.5, 8000);
    expect(slow.map((c) => c.length)).toEqual([16000, 16000]);
  });

  it('keeps the pitch while the speed doubles', () => {
    const [out] = stretch([sine(200, 8000, 8000)], 2, 8000);
    const n = crossings(out);
    expect(n).toBeGreaterThan(170);
    expect(n).toBeLessThan(230);
  });

  it('keeps the level bounded and finite', () => {
    const [out] = stretch([sine(200, 8000, 8000)], 1.5, 8000);
    let peak = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1.6);
  });

  it('copes with a clip shorter than its window', () => {
    const [out] = stretch([sine(200, 8000, 100)], 2, 8000);
    expect(out.length).toBe(50);
  });

  it('leaves the input untouched', () => {
    const src = sine(200, 8000, 2000);
    const before = Array.from(src);
    stretch([src], 2, 8000);
    expect(Array.from(src)).toEqual(before);
  });
});
