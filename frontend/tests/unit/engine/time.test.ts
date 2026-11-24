import { describe, expect, it } from 'vitest';
import { FPS_PRESETS, MAX_FPS, MIN_FPS, clampFps, durationLabel, framesFor, parseTime, secondsOf, timecode } from '@src/engine/time';

describe('clampFps', () => {
  it('falls back to 24 for a rate that is not a number', () => {
    expect(clampFps(Number.NaN)).toBe(24);
    expect(clampFps(Number.POSITIVE_INFINITY)).toBe(24);
  });

  it('clamps to the allowed range', () => {
    expect(clampFps(0)).toBe(MIN_FPS);
    expect(clampFps(-30)).toBe(MIN_FPS);
    expect(clampFps(500)).toBe(MAX_FPS);
  });

  it('keeps three decimals of a fractional rate', () => {
    expect(clampFps(23.97602)).toBe(23.976);
    expect(clampFps(29.97)).toBe(29.97);
  });

  it('accepts every preset rate unchanged', () => {
    for (const p of FPS_PRESETS) expect(clampFps(p.fps)).toBe(p.fps);
  });
});

describe('framesFor and secondsOf', () => {
  it('converts seconds to whole frames', () => {
    expect(framesFor(2, 24)).toBe(48);
    expect(framesFor(0.5, 25)).toBe(13);
  });

  it('never gives less than one frame', () => {
    expect(framesFor(0, 24)).toBe(1);
    expect(framesFor(-3, 24)).toBe(1);
  });

  it('converts frames back to seconds', () => {
    expect(secondsOf(48, 24)).toBe(2);
    expect(secondsOf(framesFor(7, 30), 30)).toBe(7);
  });
});

describe('timecode', () => {
  it('writes minutes, seconds and frames', () => {
    expect(timecode(0, 24)).toBe('00:00:00');
    expect(timecode(49, 24)).toBe('00:02:01');
    expect(timecode(61 * 24 + 5, 24)).toBe('01:01:05');
  });

  it('adds the hours only when there are some', () => {
    expect(timecode(3600 * 24, 24)).toBe('1:00:00:00');
    expect(timecode(3600 * 24 - 1, 24)).toBe('59:59:23');
  });

  it('marks a negative frame with a minus sign', () => {
    expect(timecode(-25, 24)).toBe('-00:01:01');
  });

  it('wraps the frame part at the rounded rate', () => {
    expect(timecode(30, 29.97)).toBe('00:01:00');
    expect(timecode(29, 29.97)).toBe('00:00:29');
  });
});

describe('durationLabel', () => {
  it('writes whole seconds without decimals', () => {
    expect(durationLabel(48, 24)).toBe('2s');
  });

  it('writes one decimal for a part of a second', () => {
    expect(durationLabel(36, 24)).toBe('1.5s');
  });

  it('adds minutes and hours when they are reached', () => {
    expect(durationLabel(24 * 90, 24)).toBe('1m 30s');
    expect(durationLabel(24 * 3661, 24)).toBe('1h 1m 1s');
    expect(durationLabel(24 * 3600, 24)).toBe('1h 0m 0s');
  });
});

describe('parseTime', () => {
  it('refuses empty and malformed text', () => {
    expect(parseTime('', 24)).toBeNull();
    expect(parseTime('   ', 24)).toBeNull();
    expect(parseTime('abc', 24)).toBeNull();
    expect(parseTime('1:x', 24)).toBeNull();
  });

  it('reads a bare number or a number with f as frames', () => {
    expect(parseTime('48', 24)).toBe(48);
    expect(parseTime(' 48f ', 24)).toBe(48);
    expect(parseTime('-3', 24)).toBe(-3);
    expect(parseTime('+7', 24)).toBe(7);
  });

  it('reads a number with s as seconds', () => {
    expect(parseTime('1.5s', 24)).toBe(36);
    expect(parseTime('.5s', 24)).toBe(12);
    expect(parseTime('2s', 30)).toBe(60);
  });

  it('reads a timecode with colons or semicolons', () => {
    expect(parseTime('00:02:01', 24)).toBe(49);
    expect(parseTime('1;12', 24)).toBe(36);
    expect(parseTime('1:00:00:00', 24)).toBe(86400);
  });

  it('round trips with timecode', () => {
    for (const f of [0, 1, 23, 24, 49, 1469, 86399, 86400, 200000]) {
      expect(parseTime(timecode(f, 24), 24)).toBe(f);
      expect(parseTime(timecode(f, 60), 60)).toBe(f);
    }
  });
});
