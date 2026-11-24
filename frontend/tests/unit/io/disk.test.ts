import { describe, expect, it } from 'vitest';
import { baseName, isDiskPath } from '@src/io/disk';

describe('disk path helpers', () => {
  it('takes the last part of a path with either kind of slash', () => {
    expect(baseName('/home/me/shot.fmo')).toBe('shot.fmo');
    expect(baseName('C:\\Users\\me\\shot.fmo')).toBe('shot.fmo');
    expect(baseName('mixed/dir\\shot.fmo')).toBe('shot.fmo');
    expect(baseName('shot.fmo')).toBe('shot.fmo');
  });

  it('gives an empty name for a path that ends in a slash', () => {
    expect(baseName('/home/me/')).toBe('');
  });

  it('accepts absolute, drive and network paths as disk paths', () => {
    expect(isDiskPath('/a/b')).toBe(true);
    expect(isDiskPath('C:\\a')).toBe(true);
    expect(isDiskPath('d:/a')).toBe(true);
    expect(isDiskPath('\\\\server\\share')).toBe(true);
  });

  it('refuses relative names, addresses and bare drive letters as disk paths', () => {
    expect(isDiskPath('a/b')).toBe(false);
    expect(isDiskPath('')).toBe(false);
    expect(isDiskPath('blob:http://x/1')).toBe(false);
    expect(isDiskPath('https://example.test/a')).toBe(false);
    expect(isDiskPath('C:')).toBe(false);
    expect(isDiskPath('..\\up')).toBe(false);
  });
});
