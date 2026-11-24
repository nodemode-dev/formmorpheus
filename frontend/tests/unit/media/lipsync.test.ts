import { describe, expect, it } from 'vitest';
import { VISEMES, analyseFrames, fft, lipsync, lipsyncDetail, mono, shapeRuns } from '@src/media/lipsync';

const SR = 48000;

function tone(freq: number, amp: number, seconds: number): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

describe('fft', () => {
  it('turns an impulse into a flat spectrum', () => {
    const re = new Float64Array(16), im = new Float64Array(16);
    re[0] = 1;
    fft(re, im);
    for (let i = 0; i < 16; i++) {
      expect(re[i]).toBeCloseTo(1, 9);
      expect(im[i]).toBeCloseTo(0, 9);
    }
  });

  it('puts a cosine at its own bin and its mirror', () => {
    const n = 64, k = 5;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k * i) / n);
    fft(re, im);
    const mag = (b: number): number => Math.hypot(re[b], im[b]);
    expect(mag(k)).toBeCloseTo(n / 2, 6);
    expect(mag(n - k)).toBeCloseTo(n / 2, 6);
    for (let b = 0; b < n; b++) if (b !== k && b !== n - k) expect(mag(b)).toBeLessThan(1e-6);
  });

  it('sums the samples into bin zero', () => {
    const re = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]), im = new Float64Array(8);
    fft(re, im);
    expect(re[0]).toBeCloseTo(36, 9);
  });
});

describe('mono', () => {
  it('returns a single channel as it is', () => {
    const c = Float32Array.from([0.1, 0.2]);
    expect(mono([c])).toBe(c);
  });

  it('averages several channels', () => {
    expect(Array.from(mono([Float32Array.from([1, 0, -1]), Float32Array.from([0, 0.5, 1])]))).toEqual([0.5, 0.25, 0]);
  });
});

describe('shapeRuns', () => {
  it('groups consecutive equal shapes with their frame counts', () => {
    expect(shapeRuns(['rest', 'rest', 'AI', 'E', 'E', 'E'])).toEqual([
      { shape: 'rest', frames: 2 }, { shape: 'AI', frames: 1 }, { shape: 'E', frames: 3 },
    ]);
  });

  it('is empty for no shapes', () => {
    expect(shapeRuns([])).toEqual([]);
  });
});

describe('analyseFrames', () => {
  it('measures the level and crossing rate of a steady tone', () => {
    const feat = analyseFrames(tone(1000, 0.5, 1), SR, 0.2, 5, 24);
    expect(feat).toHaveLength(5);
    for (const f of feat) {
      expect(f.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
      expect(Math.abs(f.zcr - 2000)).toBeLessThan(100);
    }
  });

  it('reports no spectral peaks for silence', () => {
    const feat = analyseFrames(new Float32Array(SR), SR, 0, 3, 24);
    for (const f of feat) expect([f.rms, f.f1, f.f2, f.high]).toEqual([0, 0, 0, 0]);
  });

  it('finds the hiss share of a high tone above that of a low one', () => {
    const hi = analyseFrames(tone(6000, 0.5, 1), SR, 0.3, 1, 24)[0];
    const lo = analyseFrames(tone(300, 0.5, 1), SR, 0.3, 1, 24)[0];
    expect(hi.high).toBeGreaterThan(0.9);
    expect(lo.high).toBeLessThan(0.1);
  });
});

describe('lipsync', () => {
  it('returns nothing for zero or negative frames', () => {
    expect(lipsync(tone(500, 0.5, 1), SR, 0, 0, 24)).toEqual([]);
    expect(lipsync(tone(500, 0.5, 1), SR, 0, -3, 24)).toEqual([]);
  });

  it('keeps the mouth at rest for silence', () => {
    const shapes = lipsync(new Float32Array(SR), SR, 0, 24, 24);
    expect(shapes).toHaveLength(24);
    expect(shapes.every((s) => s === 'rest')).toBe(true);
  });

  it('opens the mouth for sound after silence and gives one known shape per frame', () => {
    const x = new Float32Array(2 * SR);
    x.set(tone(700, 0.5, 1), SR);
    const shapes = lipsync(x, SR, 0, 48, 24);
    expect(shapes).toHaveLength(48);
    expect(shapes.every((s) => VISEMES.includes(s))).toBe(true);
    expect(shapes.slice(0, 20).every((s) => s === 'rest')).toBe(true);
    expect(shapes.slice(28).every((s) => s !== 'rest')).toBe(true);
  });

  it('gives the same shapes as the detailed analysis', () => {
    const x = new Float32Array(2 * SR);
    x.set(tone(700, 0.5, 0.5), SR / 2);
    const d = lipsyncDetail(x, SR, 0, 48, 24, { minHold: 3, sensitivity: 0.8 });
    expect(d.shapes).toEqual(lipsync(x, SR, 0, 48, 24, { minHold: 3, sensitivity: 0.8 }));
    expect(d.features).toHaveLength(48);
    for (const f of d.features) {
      expect(f.level).toBeGreaterThanOrEqual(0);
      expect(f.level).toBeLessThanOrEqual(1);
    }
  });
});
