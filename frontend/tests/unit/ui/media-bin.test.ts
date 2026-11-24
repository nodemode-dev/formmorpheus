import { describe, expect, it } from 'vitest';
import { bytesText } from '@src/ui/media-bin';

describe('bytesText', () => {
  it('shows small sizes in whole bytes', () => {
    expect(bytesText(0)).toBe('0 B');
    expect(bytesText(1023)).toBe('1023 B');
  });

  it('shows one decimal under ten of a unit and none above', () => {
    expect(bytesText(1024)).toBe('1.0 KB');
    expect(bytesText(1536)).toBe('1.5 KB');
    expect(bytesText(10240)).toBe('10 KB');
    expect(bytesText(1024 * 1024)).toBe('1.0 MB');
    expect(bytesText(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(bytesText(10 * 1024 * 1024)).toBe('10 MB');
  });

  it('shows gigabytes with two decimals', () => {
    expect(bytesText(1024 ** 3)).toBe('1.00 GB');
    expect(bytesText(1.25 * 1024 ** 3)).toBe('1.25 GB');
    expect(bytesText(3 * 1024 ** 4)).toBe('3072.00 GB');
  });
});
