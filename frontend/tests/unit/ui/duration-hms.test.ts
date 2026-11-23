import { describe, expect, it } from 'vitest';
import { formatHms, parseHms } from '@src/ui/duration-hms';

describe('parseHms', () => {
  it('reads a bare number as seconds', () => {
    expect(parseHms('90', 24)).toBe(2160);
  });

  it('reads a fractional bare number and one with a leading dot', () => {
    expect(parseHms('1.5', 24)).toBe(36);
    expect(parseHms('.5', 30)).toBe(15);
  });

  it('reads seconds with an s suffix', () => {
    expect(parseHms('10.5s', 24)).toBe(252);
  });

  it('reads hours, minutes and seconds with unit letters', () => {
    expect(parseHms('1h 2m 3s', 24)).toBe(3723 * 24);
    expect(parseHms('1h2m3s', 24)).toBe(3723 * 24);
  });

  it('accepts unit letters in capitals and surrounding spaces', () => {
    expect(parseHms('  1H 30M  ', 10)).toBe(5400 * 10);
  });

  it('reads a single unit on its own', () => {
    expect(parseHms('2m', 25)).toBe(120 * 25);
    expect(parseHms('1h', 1)).toBe(3600);
  });

  it('reads h:mm:ss and m:ss clock forms', () => {
    expect(parseHms('1:02:03', 24)).toBe(3723 * 24);
    expect(parseHms('2:03', 24)).toBe(123 * 24);
  });

  it('reads a fraction of a second in the clock form', () => {
    expect(parseHms('1:30.5', 2)).toBe(181);
  });

  it('returns null for empty or blank text', () => {
    expect(parseHms('', 24)).toBeNull();
    expect(parseHms('   ', 24)).toBeNull();
  });

  it('returns null for text that is not a duration', () => {
    expect(parseHms('abc', 24)).toBeNull();
    expect(parseHms('1x', 24)).toBeNull();
    expect(parseHms('1:2:3:4', 24)).toBeNull();
    expect(parseHms(':30', 24)).toBeNull();
  });

  it('refuses a negative duration', () => {
    expect(parseHms('-5', 24)).toBeNull();
    expect(parseHms('-1:00', 24)).toBeNull();
  });

  it('never returns fewer than one frame', () => {
    expect(parseHms('0', 24)).toBe(1);
    expect(parseHms('0:00', 24)).toBe(1);
    expect(parseHms('0.001', 24)).toBe(1);
  });

  it('rounds to the nearest whole frame', () => {
    expect(parseHms('1.02', 24)).toBe(24);
    expect(parseHms('1.03', 24)).toBe(25);
  });
});

describe('formatHms', () => {
  it('formats zero frames as 0:00:00', () => {
    expect(formatHms(0, 24)).toBe('0:00:00');
  });

  it('formats whole seconds with padded minutes and seconds', () => {
    expect(formatHms(2160, 24)).toBe('0:01:30');
    expect(formatHms(3723 * 24, 24)).toBe('1:02:03');
  });

  it('shows two decimals when the count is not on a whole second', () => {
    expect(formatHms(36, 24)).toBe('0:00:01.50');
    expect(formatHms(1, 4)).toBe('0:00:00.25');
  });

  it('lets the hours grow past two digits', () => {
    expect(formatHms(100 * 3600 * 30, 30)).toBe('100:00:00');
  });

  it('treats a frame rate below one as one frame per second', () => {
    expect(formatHms(61, 0)).toBe('0:01:01');
    expect(formatHms(61, -5)).toBe('0:01:01');
  });

  it('round trips through parseHms for whole and half seconds', () => {
    for (const frames of [24, 36, 2160, 3723 * 24, 86400 * 24]) {
      expect(parseHms(formatHms(frames, 24), 24)).toBe(frames);
    }
  });
});
