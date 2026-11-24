import { describe, expect, it } from 'vitest';
import { detectOnsets } from '@src/media/beats';

const FS = 44100;

function clicks(seconds: number, at: number[]): Float32Array {
  const x = new Float32Array(Math.round(seconds * FS));
  for (const t of at) {
    const start = Math.round(t * FS);
    for (let i = 0; i < Math.round(0.05 * FS) && start + i < x.length; i++) x[start + i] = (i % 2 ? -0.8 : 0.8) * Math.exp(-i / 800);
  }
  return x;
}

describe('detectOnsets', () => {
  it('finds nothing in a stretch shorter than four windows', () => {
    expect(detectOnsets([clicks(0.05, [0.01])], FS, 0, 0.05)).toEqual([]);
  });

  it('finds nothing in silence', () => {
    expect(detectOnsets([new Float32Array(FS * 2)], FS, 0, 2)).toEqual([]);
  });

  it('finds nothing without channels', () => {
    expect(detectOnsets([], FS, 0, 2)).toEqual([]);
  });

  it('finds one onset near each click', () => {
    const times = [0.5, 1.0, 1.5, 2.0, 2.5];
    const found = detectOnsets([clicks(3, times)], FS, 0, 3);
    expect(found).toHaveLength(times.length);
    found.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.03));
  });

  it('reports times offset by the start of the stretch and ignores clicks before it', () => {
    const times = [0.5, 1.0, 1.5, 2.0, 2.5];
    const found = detectOnsets([clicks(3, times)], FS, 0.8, 3);
    expect(found).toHaveLength(4);
    found.forEach((t, i) => expect(Math.abs(t - times[i + 1])).toBeLessThan(0.03));
  });

  it('gives the same onsets for the same sound on two channels', () => {
    const x = clicks(3, [0.5, 1.2, 2.1]);
    expect(detectOnsets([x, x], FS, 0, 3)).toEqual(detectOnsets([x], FS, 0, 3));
  });

  it('merges onsets closer than the minimum gap', () => {
    const x = clicks(3, [1.0, 1.15]);
    expect(detectOnsets([x], FS, 0, 3, { minGap: 0.1 })).toHaveLength(2);
    expect(detectOnsets([x], FS, 0, 3, { minGap: 0.4 })).toHaveLength(1);
  });

  it('returns times in ascending order', () => {
    const found = detectOnsets([clicks(3, [0.3, 0.9, 1.4, 2.2])], FS, 0, 3);
    expect(found).toEqual([...found].sort((a, b) => a - b));
    expect(found.length).toBeGreaterThan(0);
  });
});
