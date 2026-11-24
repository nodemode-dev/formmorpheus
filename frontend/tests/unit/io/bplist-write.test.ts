import { describe, expect, it } from 'vitest';
import { Uid, writeBinaryPlist } from '@src/io/bplist-write';
import { parsePlist } from '@src/io/brush-import';

const trailer = (b: Uint8Array): { offSize: number; refSize: number; count: number; table: number } => {
  const v = new DataView(b.buffer, b.byteOffset + b.length - 32, 32);
  return { offSize: v.getUint8(6), refSize: v.getUint8(7), count: Number(v.getBigUint64(8)), table: Number(v.getBigUint64(24)) };
};
const body = (b: Uint8Array, n: number): number[] => Array.from(b.subarray(8, 8 + n));

describe('writeBinaryPlist', () => {
  it('starts with the binary property list signature', () => {
    const b = writeBinaryPlist('x');
    expect(String.fromCharCode(...b.subarray(0, 8))).toBe('bplist00');
  });

  it('records the object count and the offset table position in the trailer', () => {
    const b = writeBinaryPlist(['a', 'b']);
    const t = trailer(b);
    expect(t.count).toBe(3);
    expect(t.table).toBe(b.length - 32 - 3 * t.offSize);
    expect(b[t.table]).toBe(8);
  });

  it('writes null, false and true as their single marker bytes', () => {
    expect(writeBinaryPlist(null)[8]).toBe(0x00);
    expect(writeBinaryPlist(false)[8]).toBe(0x08);
    expect(writeBinaryPlist(true)[8]).toBe(0x09);
  });

  it('picks the smallest integer width that holds the value', () => {
    expect(body(writeBinaryPlist(255), 2)).toEqual([0x10, 0xff]);
    expect(body(writeBinaryPlist(256), 3)).toEqual([0x11, 0x01, 0x00]);
    expect(body(writeBinaryPlist(65536), 5)).toEqual([0x12, 0x00, 0x01, 0x00, 0x00]);
    expect(body(writeBinaryPlist(2 ** 32), 9)).toEqual([0x13, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('writes negative and fractional numbers as eight byte reals', () => {
    for (const x of [-3, 0.25]) {
      const b = writeBinaryPlist(x);
      expect(b[8]).toBe(0x23);
      expect(new DataView(b.buffer, b.byteOffset + 9, 8).getFloat64(0)).toBe(x);
    }
  });

  it('writes a uid with its own marker', () => {
    expect(body(writeBinaryPlist(new Uid(5)), 2)).toEqual([0x80, 5]);
    expect(body(writeBinaryPlist(new Uid(300)), 3)).toEqual([0x81, 0x01, 0x2c]);
  });

  it('uses an extended length for a string of fifteen or more characters', () => {
    const b = writeBinaryPlist('abcdefghijklmnopqrst');
    expect(body(b, 4)).toEqual([0x5f, 0x10, 20, 0x61]);
  });

  it('writes a string outside ASCII as sixteen bit units', () => {
    expect(body(writeBinaryPlist('\u00e9'), 3)).toEqual([0x61, 0x00, 0xe9]);
  });

  it('stores equal strings and numbers once', () => {
    expect(trailer(writeBinaryPlist(['a', 'a', 'a', 7, 7])).count).toBe(3);
    expect(trailer(writeBinaryPlist([0, -0])).count).toBe(2);
  });

  it('does not merge the string and the number that print alike', () => {
    expect(trailer(writeBinaryPlist(['1', 1])).count).toBe(3);
  });

  it('round trips a nested value through the reader', () => {
    const src = { name: 'Round', size: 42, big: 70000, ratio: 0.5, neg: -12, on: true, off: false, list: [1, 'two', [3]], inner: { deep: 'caf\u00e9' } };
    expect(parsePlist(writeBinaryPlist(src))).toEqual(src);
  });

  it('round trips data bytes', () => {
    const data = Uint8Array.from({ length: 40 }, (_, i) => (i * 7) & 255);
    const back = parsePlist(writeBinaryPlist({ d: data })) as { d: Uint8Array };
    expect(Array.from(back.d)).toEqual(Array.from(data));
  });

  it('round trips more objects than one reference byte can number', () => {
    const src = Array.from({ length: 300 }, (_, i) => `item ${i}`);
    const b = writeBinaryPlist(src);
    expect(trailer(b).refSize).toBe(2);
    expect(parsePlist(b)).toEqual(src);
  });

  it('round trips an empty array and an empty object', () => {
    expect(parsePlist(writeBinaryPlist([]))).toEqual([]);
    expect(parsePlist(writeBinaryPlist({}))).toEqual({});
  });
});
