import { describe, expect, it } from 'vitest';
import { LiveLoudness, gatedLufs, integratedLufs, kWeigh, lufsText, normalizeGain, normalizeInPlace, samplePeak, shortTermMax } from '@src/media/loudness';

const FS = 48000;

function sine(freq: number, amp: number, seconds: number, fs = FS): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / fs);
  return out;
}

describe('lufsText', () => {
  it('prints a finite loudness with one decimal', () => {
    expect(lufsText(-14.04)).toBe('-14.0 LUFS');
    expect(lufsText(-23.06)).toBe('-23.1 LUFS');
  });

  it('prints minus infinity for silence and for a value that is not a number', () => {
    expect(lufsText(-Infinity)).toBe('-inf LUFS');
    expect(lufsText(Number.NaN)).toBe('-inf LUFS');
  });
});

describe('samplePeak', () => {
  it('returns the largest magnitude over every channel, negative samples included', () => {
    expect(samplePeak([Float32Array.from([0.1, -0.2]), Float32Array.from([0.3, -0.75, 0.5])])).toBeCloseTo(0.75, 6);
  });

  it('is zero for no channels and for empty channels', () => {
    expect(samplePeak([])).toBe(0);
    expect(samplePeak([new Float32Array(0)])).toBe(0);
  });
});

describe('gatedLufs', () => {
  it('is minus infinity with no blocks', () => {
    expect(gatedLufs([])).toBe(-Infinity);
  });

  it('is minus infinity when every block is under the absolute gate of -70', () => {
    expect(gatedLufs([1e-9, 1e-10, 0])).toBe(-Infinity);
  });

  it('reads a steady energy of one as -0.691', () => {
    expect(gatedLufs([1, 1, 1])).toBeCloseTo(-0.691, 6);
  });

  it('drops a quiet block below the relative gate from the average', () => {
    expect(gatedLufs([1, 1, 1, 0.0001])).toBeCloseTo(-0.691, 6);
  });

  it('keeps blocks within 10 LU of the loud average', () => {
    const r = gatedLufs([1, 0.5]);
    expect(r).toBeCloseTo(-0.691 + 10 * Math.log10(0.75), 6);
  });
});

describe('kWeigh', () => {
  it('returns a new array of the same length and leaves the input alone', () => {
    const x = sine(1000, 0.5, 0.05);
    const copy = Float32Array.from(x);
    const w = kWeigh(x, FS);
    expect(w).not.toBe(x);
    expect(w.length).toBe(x.length);
    expect(Array.from(x)).toEqual(Array.from(copy));
  });

  it('removes a steady offset through its high pass', () => {
    const w = kWeigh(new Float32Array(FS).fill(0.5), FS);
    expect(Math.abs(w[w.length - 1])).toBeLessThan(1e-3);
  });

  it('lifts high frequencies above low ones', () => {
    const energy = (a: Float32Array): number => { let s = 0; for (let i = a.length >> 1; i < a.length; i++) s += a[i] * a[i]; return s; };
    expect(energy(kWeigh(sine(8000, 0.5, 0.5), FS))).toBeGreaterThan(energy(kWeigh(sine(500, 0.5, 0.5), FS)) * 1.5);
  });
});

describe('integratedLufs', () => {
  it('reads a full scale 1 kHz sine on one channel near -3.01', () => {
    expect(Math.abs(integratedLufs([sine(1000, 1, 3)], FS) + 3.01)).toBeLessThan(0.1);
  });

  it('drops by about 6.02 LU when the amplitude halves', () => {
    const a = integratedLufs([sine(1000, 0.8, 2)], FS);
    const b = integratedLufs([sine(1000, 0.4, 2)], FS);
    expect(a - b).toBeCloseTo(6.02, 1);
  });

  it('sums the energy of two identical channels, about 3 LU louder than one', () => {
    const one = integratedLufs([sine(1000, 0.5, 2)], FS);
    const two = integratedLufs([sine(1000, 0.5, 2), sine(1000, 0.5, 2)], FS);
    expect(two - one).toBeCloseTo(3.01, 1);
  });

  it('is minus infinity for silence', () => {
    expect(integratedLufs([new Float32Array(FS)], FS)).toBe(-Infinity);
  });

  it('is minus infinity for a sound shorter than one 400 ms block', () => {
    expect(integratedLufs([sine(1000, 1, 0.3)], FS)).toBe(-Infinity);
  });

  it('is minus infinity with no channels', () => {
    expect(integratedLufs([], FS)).toBe(-Infinity);
  });
});

describe('shortTermMax', () => {
  it('needs three seconds of sound', () => {
    expect(shortTermMax([sine(1000, 1, 2)], FS)).toBe(-Infinity);
  });

  it('finds the loud part of a sound that starts quiet', () => {
    const quiet = sine(1000, 0.05, 4);
    const loud = sine(1000, 0.8, 4);
    const joined = new Float32Array(quiet.length + loud.length);
    joined.set(quiet);
    joined.set(loud, quiet.length);
    const st = shortTermMax([joined], FS);
    const loudOnly = integratedLufs([loud], FS);
    expect(Math.abs(st - loudOnly)).toBeLessThan(0.2);
    expect(st).toBeGreaterThan(integratedLufs([joined], FS));
  });
});

describe('normalizeGain', () => {
  it('leaves silence at unity gain', () => {
    const r = normalizeGain([new Float32Array(FS)], FS, -14);
    expect(r).toEqual({ gain: 1, limited: false, measured: -Infinity });
  });

  it('gives the gain that brings a quiet sound to the target', () => {
    const chs = [sine(1000, 0.1, 2)];
    const r = normalizeGain(chs, FS, -14);
    expect(r.limited).toBe(false);
    expect(r.gain).toBeCloseTo(Math.pow(10, (-14 - r.measured) / 20), 6);
    expect(r.gain).toBeGreaterThan(2.5);
    expect(r.gain).toBeLessThan(3.2);
  });

  it('holds the gain back so the peak stays under -1 dBFS', () => {
    const r = normalizeGain([sine(1000, 0.5, 2)], FS, 0);
    expect(r.limited).toBe(true);
    expect(r.gain).toBeCloseTo(0.891 / 0.5, 2);
  });

  it('turns a loud sound down without limiting', () => {
    const r = normalizeGain([sine(1000, 0.9, 2)], FS, -23);
    expect(r.limited).toBe(false);
    expect(r.gain).toBeLessThan(1);
  });
});

describe('normalizeInPlace', () => {
  it('scales the samples so the sound measures at the target', () => {
    const chs = [sine(1000, 0.1, 2), sine(1000, 0.1, 2)];
    const before = chs[0][100];
    const r = normalizeInPlace(chs, FS, -16);
    expect(chs[0][100]).toBeCloseTo(before * r.gain, 5);
    expect(integratedLufs(chs, FS)).toBeCloseTo(-16, 1);
  });

  it('does not touch silence', () => {
    const chs = [new Float32Array(FS)];
    const r = normalizeInPlace(chs, FS, -14);
    expect(r.gain).toBe(1);
    expect(chs[0].every((v) => v === 0)).toBe(true);
  });
});

describe('LiveLoudness', () => {
  const windowOf = (amp: number): Float32Array[] => [sine(1000, amp, 4096 / FS)];

  it('reports nothing before enough has been heard', () => {
    const live = new LiveLoudness();
    expect(live.shortTerm()).toBe(-Infinity);
    expect(live.integrated()).toBe(-Infinity);
    expect(live.truePeak()).toBe(-Infinity);
    live.push(windowOf(0.5), FS, 0);
    live.push(windowOf(0.5), FS, 0.125);
    expect(live.shortTerm()).toBe(-Infinity);
  });

  it('measures a steady sine near its offline loudness', () => {
    const live = new LiveLoudness();
    for (let i = 0; i < 40; i++) live.push(windowOf(0.5), FS, i * 0.125);
    const offline = integratedLufs([sine(1000, 0.5, 3)], FS);
    expect(Math.abs(live.shortTerm() - offline)).toBeLessThan(0.3);
    expect(Math.abs(live.integrated() - offline)).toBeLessThan(0.3);
  });

  it('finds a peak between samples above the sample peak', () => {
    const live = new LiveLoudness();
    const n = 64;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((Math.PI * i) / 2 + Math.PI / 4);
    live.push([x], FS, 0);
    const sampleDb = 20 * Math.log10(samplePeak([x]));
    expect(live.truePeak()).toBeGreaterThan(sampleDb + 1);
    expect(live.truePeak()).toBeLessThan(0.1);
  });

  it('forgets everything on reset', () => {
    const live = new LiveLoudness();
    for (let i = 0; i < 20; i++) live.push(windowOf(0.5), FS, i * 0.125);
    expect(Number.isFinite(live.shortTerm())).toBe(true);
    live.reset();
    expect(live.shortTerm()).toBe(-Infinity);
    expect(live.integrated()).toBe(-Infinity);
    expect(live.truePeak()).toBe(-Infinity);
  });
});
