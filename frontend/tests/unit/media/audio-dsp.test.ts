import { describe, expect, it } from 'vitest';
import { applyFx, applyGainCurve, duckGain, eqResponse, fxTail } from '@src/media/audio-dsp';
import type { Comp, Eq, Gate, Reverb } from '@src/engine/audio-fx';

const SR = 48000;
const flat = (): Eq => ({ lowCut: 0, highCut: 0, low: { gain: 0, freq: 120 }, mid: { gain: 0, freq: 1000, q: 1 }, high: { gain: 0, freq: 6000 } });
const constant = (n: number, v: number): Float32Array => new Float32Array(n).fill(v);
const reverb = (over: Partial<Reverb> = {}): Reverb => ({ size: 0.5, decay: 1.8, damping: 0.5, mix: 0.25, preDelay: 15, ...over });

describe('fxTail', () => {
  it('is zero without a reverb', () => {
    expect(fxTail({})).toBe(0);
  });

  it('is zero when the reverb is fully dry', () => {
    expect(fxTail({ reverb: reverb({ mix: 0 }) })).toBe(0);
  });

  it('adds the pre-delay to the decay', () => {
    expect(fxTail({ reverb: reverb({ decay: 1.8, preDelay: 15 }) })).toBeCloseTo(1.815, 9);
  });

  it('caps the tail at six seconds', () => {
    expect(fxTail({ reverb: reverb({ decay: 30, preDelay: 500 }) })).toBe(6);
  });

  it('treats a negative decay as zero', () => {
    expect(fxTail({ reverb: reverb({ decay: -4, preDelay: 100 }) })).toBeCloseTo(0.1, 9);
  });
});

describe('applyFx', () => {
  it('returns an empty list for no channels', () => {
    expect(applyFx([], SR, { comp: { threshold: -20, ratio: 4, attack: 1, release: 50, makeup: 0, knee: 0 } })).toEqual([]);
  });

  it('returns copies and leaves the inputs untouched', () => {
    const input = [constant(1000, 0.5), constant(1000, -0.5)];
    const out = applyFx(input, SR, { comp: { threshold: -40, ratio: 8, attack: 1, release: 50, makeup: 0, knee: 0 } });
    expect(out[0]).not.toBe(input[0]);
    expect(input[0][999]).toBe(0.5);
    expect(input[1][999]).toBe(-0.5);
    expect(Math.abs(out[0][999])).toBeLessThan(0.5);
  });

  it('passes the signal through unchanged with an empty chain', () => {
    const input = [Float32Array.from([0.1, -0.2, 0.3, -0.4])];
    expect(Array.from(applyFx(input, SR, {})[0])).toEqual(Array.from(input[0]));
  });

  it('passes the signal through unchanged with a flat EQ', () => {
    const input = [Float32Array.from([0.1, -0.2, 0.3, -0.4])];
    expect(Array.from(applyFx(input, SR, { eq: flat() })[0])).toEqual(Array.from(input[0]));
  });

  it('leaves a signal below the compressor threshold alone with a hard knee', () => {
    const comp: Comp = { threshold: -20, ratio: 4, attack: 1, release: 50, makeup: 0, knee: 0 };
    const out = applyFx([constant(2000, 0.01)], SR, { comp })[0];
    expect(out[1999]).toBeCloseTo(0.01, 7);
  });

  it('applies only the makeup gain at a ratio of one', () => {
    const comp: Comp = { threshold: -30, ratio: 1, attack: 1, release: 50, makeup: 6, knee: 0 };
    const out = applyFx([constant(500, 0.25)], SR, { comp })[0];
    expect(out[0]).toBeCloseTo(0.25 * Math.pow(10, 6 / 20), 5);
    expect(out[499]).toBeCloseTo(0.25 * Math.pow(10, 6 / 20), 5);
  });

  it('settles a loud signal at the ratio of the overshoot', () => {
    const comp: Comp = { threshold: -20, ratio: 4, attack: 1, release: 100, makeup: 0, knee: 0 };
    const out = applyFx([constant(SR, 1)], SR, { comp })[0];
    expect(20 * Math.log10(out[SR - 1])).toBeCloseTo(-15, 2);
  });

  it('treats a ratio below one as one', () => {
    const comp: Comp = { threshold: -20, ratio: 0.25, attack: 1, release: 100, makeup: 0, knee: 0 };
    const out = applyFx([constant(4800, 1)], SR, { comp })[0];
    expect(out[4799]).toBeCloseTo(1, 6);
  });

  it('holds a quiet signal at the gate range', () => {
    const gate: Gate = { threshold: -40, range: -60, attack: 1, hold: 10, release: 50 };
    const out = applyFx([constant(4800, 0.001)], SR, { gate })[0];
    expect(out[4799]).toBeCloseTo(0.001 * 0.001, 9);
  });

  it('opens the gate for a signal above the threshold', () => {
    const gate: Gate = { threshold: -40, range: -60, attack: 1, hold: 10, release: 50 };
    const out = applyFx([constant(4800, 0.5)], SR, { gate })[0];
    expect(out[4799]).toBeCloseTo(0.5, 4);
  });

  it('links the gate across channels so a loud side opens the quiet one', () => {
    const gate: Gate = { threshold: -40, range: -60, attack: 1, hold: 10, release: 50 };
    const out = applyFx([constant(4800, 0.5), constant(4800, 0.001)], SR, { gate });
    expect(out[1][4799]).toBeCloseTo(0.001, 6);
  });

  it('removes a steady offset with a low cut', () => {
    const eq = { ...flat(), lowCut: 200 };
    const out = applyFx([constant(SR, 1)], SR, { eq })[0];
    expect(Math.abs(out[SR - 1])).toBeLessThan(1e-3);
  });

  it('skips a reverb with a zero mix', () => {
    const input = [Float32Array.from([1, 0, 0, 0, 0])];
    expect(Array.from(applyFx(input, SR, { reverb: reverb({ mix: 0 }) })[0])).toEqual([1, 0, 0, 0, 0]);
  });

  it('keeps the dry part before the pre-delay and rings after the input ends', () => {
    const n = SR;
    const x = new Float32Array(n);
    x[0] = 1;
    const out = applyFx([x], SR, { reverb: reverb({ mix: 0.5, preDelay: 20 }) })[0];
    expect(out[0]).toBeCloseTo(0.5, 6);
    let tail = 0;
    for (let i = SR / 10; i < n; i++) tail += out[i] * out[i];
    expect(tail).toBeGreaterThan(0);
  });
});

describe('eqResponse', () => {
  it('is flat at zero decibels with no bands', () => {
    for (const hz of [20, 440, 1000, 9000, 20000]) expect(eqResponse(flat(), SR, hz)).toBeCloseTo(0, 6);
  });

  it('reaches the mid gain at the mid frequency', () => {
    const eq = { ...flat(), mid: { gain: 6, freq: 1000, q: 1 } };
    expect(eqResponse(eq, SR, 1000)).toBeCloseTo(6, 3);
    expect(eqResponse(eq, SR, 50)).toBeLessThan(1);
  });

  it('cuts low frequencies with a low cut and keeps the highs', () => {
    const eq = { ...flat(), lowCut: 1000 };
    expect(eqResponse(eq, SR, 50)).toBeLessThan(-30);
    expect(eqResponse(eq, SR, 10000)).toBeGreaterThan(-1);
  });

  it('cuts high frequencies with a high cut and keeps the lows', () => {
    const eq = { ...flat(), highCut: 1000 };
    expect(eqResponse(eq, SR, 15000)).toBeLessThan(-30);
    expect(eqResponse(eq, SR, 50)).toBeGreaterThan(-1);
  });

  it('lifts only the bottom with a low shelf', () => {
    const eq = { ...flat(), low: { gain: 9, freq: 100 } };
    expect(eqResponse(eq, SR, 20)).toBeGreaterThan(8);
    expect(Math.abs(eqResponse(eq, SR, 10000))).toBeLessThan(0.5);
  });

  it('cuts only the top with a negative high shelf', () => {
    const eq = { ...flat(), high: { gain: -9, freq: 4000 } };
    expect(eqResponse(eq, SR, 18000)).toBeLessThan(-8);
    expect(Math.abs(eqResponse(eq, SR, 100))).toBeLessThan(0.5);
  });
});

describe('duckGain', () => {
  const duck = { source: 'x', amount: 12, threshold: -20, attack: 1, release: 100 };

  it('is empty without side-chain channels', () => {
    expect(duckGain([], SR, duck).length).toBe(0);
  });

  it('stays at unity while the side-chain is silent', () => {
    const g = duckGain([new Float32Array(1000)], SR, duck);
    expect(Array.from(g).every((v) => v === 1)).toBe(true);
  });

  it('settles at the duck amount while the side-chain is loud and never exceeds unity', () => {
    const g = duckGain([constant(SR, 0.5)], SR, duck);
    expect(20 * Math.log10(g[SR - 1])).toBeCloseTo(-12, 2);
    expect(Math.max(...Array.from(g))).toBeLessThanOrEqual(1);
  });
});

describe('applyGainCurve', () => {
  it('multiplies each sample and uses unity past the end of the curve', () => {
    const input = [Float32Array.from([1, 1, 1, 1]), Float32Array.from([2, 2, 2, 2])];
    const out = applyGainCurve(input, Float32Array.from([0, 0.5]));
    expect(Array.from(out[0])).toEqual([0, 0.5, 1, 1]);
    expect(Array.from(out[1])).toEqual([0, 1, 2, 2]);
    expect(Array.from(input[0])).toEqual([1, 1, 1, 1]);
  });
});
