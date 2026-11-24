import { describe, expect, it } from 'vitest';
import {
  AUDIO_BPS, BUILTIN_PRESETS, bitrateForSize, estimateBytes, fileTimecode, formatBytes, frameName, movieFrameAt, outFps, stepsFor,
} from '@src/export/delivery';
import type { EstimateIn } from '@src/export/delivery';

describe('output frame mapping', () => {
  it('uses the override rate only when it is positive', () => {
    expect(outFps({ fps: 12 }, 24)).toBe(12);
    expect(outFps({ fps: 0 }, 24)).toBe(24);
    expect(outFps({ fps: -5 }, 24)).toBe(24);
    expect(outFps({}, 30)).toBe(30);
  });

  it('counts the frames of a half open range', () => {
    expect(stepsFor({ from: 10, to: 34, pingpong: false }, 24)).toBe(24);
  });

  it('always exports at least one frame, even for an empty or reversed range', () => {
    expect(stepsFor({ from: 5, to: 5, pingpong: false }, 24)).toBe(1);
    expect(stepsFor({ from: 9, to: 2, pingpong: true }, 24)).toBe(1);
  });

  it('adds the return leg of a ping pong without repeating either end', () => {
    const o = { from: 0, to: 5, pingpong: true };
    expect(stepsFor(o, 24)).toBe(8);
    expect(Array.from({ length: 8 }, (_, i) => movieFrameAt(i, o, 24))).toEqual([0, 1, 2, 3, 4, 3, 2, 1]);
  });

  it('does not ping pong a range shorter than three frames', () => {
    expect(stepsFor({ from: 0, to: 2, pingpong: true }, 24)).toBe(2);
  });

  it('keeps the duration when the rate is halved or doubled', () => {
    const half = { from: 0, to: 30, pingpong: false, fps: 15 };
    expect(stepsFor(half, 30)).toBe(15);
    expect([0, 1, 2, 14].map((i) => movieFrameAt(i, half, 30))).toEqual([0, 2, 4, 28]);
    const twice = { from: 4, to: 8, pingpong: false, fps: 60 };
    expect(stepsFor(twice, 30)).toBe(8);
    expect(Array.from({ length: 8 }, (_, i) => movieFrameAt(i, twice, 30))).toEqual([4, 4, 5, 5, 6, 6, 7, 7]);
  });

  it('clamps an output frame outside the range to its ends', () => {
    const o = { from: 10, to: 20, pingpong: false };
    expect(movieFrameAt(-3, o, 24)).toBe(10);
    expect(movieFrameAt(999, o, 24)).toBe(19);
  });
});

describe('bitrateForSize', () => {
  it('spreads the bytes over the duration with a small container reserve', () => {
    expect(bitrateForSize(1_000_000, 10, false)).toBe(788_000);
  });

  it('leaves room for the sound', () => {
    expect(bitrateForSize(1_000_000, 10, true)).toBe(788_000 - AUDIO_BPS);
  });

  it('never goes below the floor, and survives a zero duration', () => {
    expect(bitrateForSize(1000, 600, true)).toBe(30_000);
    expect(bitrateForSize(1000, 0, false)).toBe(78_800);
  });
});

describe('estimateBytes', () => {
  const base: EstimateIn = { kind: 'video', width: 100, height: 50, steps: 60, fps: 30, audio: false, quality: 'high', alpha: false };

  it('returns the target itself in size mode', () => {
    expect(estimateBytes({ ...base, rate: { mode: 'size', kbps: 0, mb: 23 } })).toBe(23 * 1_048_576);
  });

  it('uses the bitrate and the sound over the duration in bitrate mode', () => {
    expect(estimateBytes({ ...base, audio: true, rate: { mode: 'bitrate', kbps: 1000, mb: 0 } })).toBe(((1_000_000 + AUDIO_BPS) * 2) / 8);
  });

  it('grows with quality for a video', () => {
    const q = (['low', 'medium', 'high', 'very-high'] as const).map((quality) => estimateBytes({ ...base, quality }));
    expect([...q].sort((a, b) => a - b)).toEqual(q);
    expect(new Set(q).size).toBe(4);
  });

  it('scales with pixels and frames for animated pictures', () => {
    expect(estimateBytes({ ...base, kind: 'gif' })).toBe(5000 * 60 * 0.2);
    expect(estimateBytes({ ...base, kind: 'apng', alpha: true })).toBeGreaterThan(estimateBytes({ ...base, kind: 'apng' }));
    expect(estimateBytes({ ...base, kind: 'frames', picture: 'bmp' })).toBe(5000 * 60 * 3);
  });
});

describe('formatBytes', () => {
  it('shows kilobytes below one megabyte and never zero', () => {
    expect(formatBytes(0)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('shows one decimal below ten megabytes and none above', () => {
    expect(formatBytes(1_048_576 * 5.5)).toBe('5.5 MB');
    expect(formatBytes(1_048_576 * 20)).toBe('20 MB');
  });
});

describe('frame file names', () => {
  it('writes a timecode with dashes', () => {
    expect(fileTimecode(3725 * 24 + 7, 24)).toBe('01-02-05-07');
  });

  it('treats a negative frame as zero and a zero rate as one', () => {
    expect(fileTimecode(-9, 24)).toBe('00-00-00-00');
    expect(fileTimecode(61, 0)).toBe('00-01-01-00');
  });

  it('expands the name, the padded number, the movie frame and the timecode', () => {
    expect(frameName('{name}_{n}', 'shot', 7, 4, 12, 24)).toBe('shot_0007');
    expect(frameName('{name}-{f}-{tc}', 'shot', 7, 3, 30, 24)).toBe('shot-030-00-00-01-06');
  });

  it('falls back to the default pattern when the pattern is blank', () => {
    expect(frameName('   ', 'shot', 2, 2, 0, 24)).toBe('shot_02');
  });

  it('replaces path separators and reserved characters', () => {
    expect(frameName('a/b\\c:{n}?', 'x', 1, 4, 0, 24)).toBe('a_b_c_0001_');
    expect(frameName('{name}_{n}', '../../etc', 1, 2, 0, 24)).toBe('_.._etc_01');
  });

  it('strips leading dots and never returns an empty name', () => {
    expect(frameName('..{name}', 'x', 1, 2, 0, 24)).toBe('x');
    expect(frameName('...', 'x', 3, 4, 0, 24)).toBe('frame_0003');
  });
});

describe('built in presets', () => {
  it('have unique ids and size targets only where a size is given', () => {
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
    for (const p of BUILTIN_PRESETS) if (p.spec.rate === 'size') expect(p.spec.mb).toBeGreaterThan(0);
  });
});
