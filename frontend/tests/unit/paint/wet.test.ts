import { describe, expect, it } from 'vitest';
import { ksToRgb, mixPigment, rgbToKs, steer } from '@src/paint/wet';

type C3 = [number, number, number];

function ksOf(c: C3): Float32Array {
  const k = new Float32Array(6);
  rgbToKs(c[0], c[1], c[2], k, 0);
  return k;
}

describe('pigment space', () => {
  it('round trips colours through the pigment vector', () => {
    const colours: C3[] = [[255, 255, 255], [200, 30, 40], [20, 60, 200], [250, 220, 30], [128, 128, 128], [40, 160, 90]];
    for (const c of colours) {
      const out = [0, 0, 0];
      ksToRgb(ksOf(c), 0, out);
      for (let i = 0; i < 3; i++) expect(Math.abs(out[i] - c[i])).toBeLessThanOrEqual(2);
    }
  });

  it('produces finite absorption that is never negative', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [3, 250, 7]] as C3[]) {
      for (const v of ksOf(c)) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
    }
  });

  it('gives black more absorption than white in every band', () => {
    const k = ksOf([0, 0, 0]), w = ksOf([255, 255, 255]);
    for (let i = 0; i < 6; i++) expect(k[i]).toBeGreaterThan(w[i]);
  });

  it('clamps colour values outside the byte range', () => {
    expect(Array.from(ksOf([300, -20, 999]))).toEqual(Array.from(ksOf([255, 0, 255])));
  });

  it('writes and reads at the given offset', () => {
    const buf = new Float32Array(18);
    rgbToKs(10, 200, 90, buf, 6);
    expect(Array.from(buf.slice(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(buf.slice(12))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(buf.slice(6, 12))).toEqual(Array.from(ksOf([10, 200, 90])));
    const a = [0, 0, 0], b = [0, 0, 0];
    ksToRgb(buf, 6, a);
    ksToRgb(ksOf([10, 200, 90]), 0, b);
    expect(a).toEqual(b);
  });
});

describe('pigment mixing', () => {
  it('lets a light pigment steer more than a dark one', () => {
    expect(steer(ksOf([250, 220, 30]), 0)).toBeGreaterThan(steer(ksOf([10, 20, 120]), 0));
    expect(steer(new Float32Array(6), 0)).toBeCloseTo(Math.pow(0.25, -0.75), 9);
  });

  it('returns each end colour at the ends of the mix', () => {
    const a: C3 = [200, 30, 40], b: C3 = [20, 60, 200];
    const m0 = mixPigment(a, b, 0), m1 = mixPigment(a, b, 1);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(m0[i] - a[i])).toBeLessThanOrEqual(2);
      expect(Math.abs(m1[i] - b[i])).toBeLessThanOrEqual(2);
    }
  });

  it('mixes a colour with itself to the same colour', () => {
    const c: C3 = [90, 140, 200];
    const m = mixPigment(c, c, 0.37);
    for (let i = 0; i < 3; i++) expect(Math.abs(m[i] - c[i])).toBeLessThanOrEqual(2);
  });

  it('mixes yellow and blue to a green', () => {
    const m = mixPigment([250, 220, 30], [20, 60, 200], 0.5);
    expect(m[1]).toBeGreaterThan(m[0]);
    expect(m[1]).toBeGreaterThan(m[2]);
  });

  it('darkens white as more black is mixed in', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((t) => mixPigment([255, 255, 255], [0, 0, 0], t)[1]);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
  });

  it('returns whole byte values', () => {
    const m = mixPigment([12, 99, 240], [240, 180, 3], 0.3);
    for (const v of m) { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
  });
});
