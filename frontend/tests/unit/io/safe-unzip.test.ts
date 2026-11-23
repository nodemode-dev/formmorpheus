import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { safeUnzip, safeUnzipOr, UNZIP_ENTRY_MAX, UNZIP_TOTAL_MAX } from '@src/io/safe-unzip';

const archive = (files: Record<string, number>): Uint8Array => {
  const out: Record<string, Uint8Array> = {};
  for (const [name, size] of Object.entries(files)) out[name] = new Uint8Array(size).fill(7);
  return zipSync(out);
};

describe('safeUnzip', () => {
  it('gives back every entry of an archive byte for byte', () => {
    const zip = zipSync({ 'a.txt': strToU8('hello'), 'dir/b.bin': new Uint8Array([1, 2, 3, 250]) });
    const got = safeUnzip(zip);
    expect(Object.keys(got).sort()).toEqual(['a.txt', 'dir/b.bin']);
    expect(new TextDecoder().decode(got['a.txt'])).toBe('hello');
    expect(Array.from(got['dir/b.bin'])).toEqual([1, 2, 3, 250]);
  });

  it('refuses an entry larger than the entry cap', () => {
    expect(() => safeUnzip(archive({ 'big.bin': 2 * 1048576 + 1 }), { entry: 2 * 1048576 })).toThrow(/too large \(over 2 MB unpacked\)/);
  });

  it('accepts an entry exactly at the entry cap', () => {
    const got = safeUnzip(archive({ 'edge.bin': 1000 }), { entry: 1000 });
    expect(got['edge.bin'].length).toBe(1000);
  });

  it('refuses an archive whose entries add up to more than the total cap', () => {
    const zip = archive({ 'a.bin': 600, 'b.bin': 600 });
    expect(() => safeUnzip(zip, { total: 1000 })).toThrow(/unpacks to more than/);
    expect(Object.keys(safeUnzip(zip, { total: 1200 }))).toHaveLength(2);
  });

  it('refuses an archive with more entries than the count cap', () => {
    const zip = archive({ a: 1, b: 1, c: 1 });
    expect(() => safeUnzip(zip, { count: 2 })).toThrow('This archive holds too many files.');
    expect(Object.keys(safeUnzip(zip, { count: 3 }))).toHaveLength(3);
  });

  it('leaves skipped entries out of the result and out of every cap', () => {
    const zip = archive({ 'keep.txt': 10, 'huge.bin': 5000, 'other.bin': 5000 });
    const got = safeUnzip(zip, { only: (f) => f.name.endsWith('.txt'), entry: 100, total: 100, count: 1 });
    expect(Object.keys(got)).toEqual(['keep.txt']);
  });

  it('tells the filter the declared unpacked size of each entry', () => {
    const sizes: Record<string, number> = {};
    safeUnzip(archive({ 'a.bin': 321, 'b.bin': 0 }), { only: (f) => { sizes[f.name] = f.originalSize; return false; } });
    expect(sizes).toEqual({ 'a.bin': 321, 'b.bin': 0 });
  });

  it('throws on bytes that are not an archive', () => {
    expect(() => safeUnzip(strToU8('this is plainly not a zip file at all'))).toThrow();
  });

  it('keeps default caps that are larger for the whole archive than for one entry', () => {
    expect(UNZIP_ENTRY_MAX).toBeGreaterThan(0);
    expect(UNZIP_TOTAL_MAX).toBeGreaterThan(UNZIP_ENTRY_MAX);
  });
});

describe('safeUnzipOr', () => {
  it('reads a good archive like safeUnzip', () => {
    const got = safeUnzipOr(zipSync({ 'x.txt': strToU8('ok') }), 'unreadable');
    expect(new TextDecoder().decode(got['x.txt'])).toBe('ok');
  });

  it('replaces the error for unreadable bytes with the given message', () => {
    expect(() => safeUnzipOr(strToU8('garbage garbage garbage garbage'), 'picture.zip is not readable.')).toThrow('picture.zip is not readable.');
  });

  it('replaces the error for an empty input with the given message', () => {
    expect(() => safeUnzipOr(new Uint8Array(0), 'empty')).toThrow('empty');
  });

  it('keeps the more useful message of a cap', () => {
    expect(() => safeUnzipOr(archive({ a: 1, b: 1 }), 'unreadable', { count: 1 })).toThrow('This archive holds too many files.');
    expect(() => safeUnzipOr(archive({ 'a.bin': 2000 }), 'unreadable', { entry: 10 })).toThrow(/too large/);
  });

  it('replaces the error of a truncated archive with the given message', () => {
    const zip = zipSync({ 'a.txt': strToU8('hello hello hello') });
    expect(() => safeUnzipOr(zip.subarray(0, zip.length - 12), 'cut short')).toThrow('cut short');
  });
});
