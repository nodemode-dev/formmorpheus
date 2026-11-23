import { describe, expect, it } from 'vitest';
import { lz4FrameDecompress, lzo1xDecompress } from '@src/io/lzo';

const END = [0x11, 0x00, 0x00];
const text = (b: Uint8Array): string => String.fromCharCode(...b);
const ascii = (s: string): number[] => s.split('').map((c) => c.charCodeAt(0));
const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

describe('lzo1xDecompress', () => {
  it('decodes a stream that is one literal run', () => {
    const src = new Uint8Array([17 + 5, ...ascii('hello'), ...END]);
    expect(text(lzo1xDecompress(src, 5))).toBe('hello');
  });

  it('decodes a match that repeats the last byte', () => {
    const src = new Uint8Array([17 + 4, ...ascii('abcd'), 0x60, 0x00, ...END]);
    expect(text(lzo1xDecompress(src, 8))).toBe('abcddddd');
  });

  it('copies an overlapping match from further back', () => {
    const src = new Uint8Array([17 + 4, ...ascii('abcd'), 0x60 | (3 << 2), 0x00, ...END]);
    expect(text(lzo1xDecompress(src, 8))).toBe('abcdabcd');
  });

  it('zero fills output the stream does not reach', () => {
    const src = new Uint8Array([17 + 4, ...ascii('abcd'), ...END]);
    const out = lzo1xDecompress(src, 7);
    expect(out.length).toBe(7);
    expect(Array.from(out.subarray(4))).toEqual([0, 0, 0]);
  });

  it('refuses empty input', () => {
    expect(() => lzo1xDecompress(new Uint8Array(0), 4)).toThrow('lzo: input ends early');
  });

  it('refuses a stream with no end marker', () => {
    const src = new Uint8Array([17 + 4, ...ascii('abcd')]);
    expect(() => lzo1xDecompress(src, 4)).toThrow('lzo: input ends early');
  });

  it('refuses a literal run larger than the output', () => {
    const src = new Uint8Array([17 + 5, ...ascii('hello'), ...END]);
    expect(() => lzo1xDecompress(src, 3)).toThrow('lzo: literal run out of range');
  });

  it('refuses a literal run longer than the input', () => {
    const src = new Uint8Array([17 + 9, ...ascii('ab')]);
    expect(() => lzo1xDecompress(src, 64)).toThrow('lzo: literal run out of range');
  });

  it('refuses a match that reaches before the start of the output', () => {
    const src = new Uint8Array([17 + 4, ...ascii('abcd'), 0x60, 0x01, ...END]);
    expect(() => lzo1xDecompress(src, 16)).toThrow('lzo: match out of range');
  });

  it('refuses a match that would overrun the output', () => {
    const src = new Uint8Array([17 + 4, ...ascii('abcd'), 0x60, 0x00, ...END]);
    expect(() => lzo1xDecompress(src, 6)).toThrow('lzo: match out of range');
  });
});

describe('lz4FrameDecompress', () => {
  const packed = (raw: number, data: number[]): number[] => [...ascii('bv41'), ...u32(raw), ...u32(data.length), ...data];
  const stored = (data: number[]): number[] => [...ascii('bv4-'), ...u32(data.length), ...data];
  const end = ascii('bv4$');

  it('decodes a block of literals', () => {
    const src = new Uint8Array([...packed(4, [0x40, ...ascii('abcd')]), ...end]);
    expect(text(lz4FrameDecompress(src, 4))).toBe('abcd');
  });

  it('decodes a match inside a block', () => {
    const src = new Uint8Array([...packed(5, [0x10, 0x61, 1, 0]), ...end]);
    expect(text(lz4FrameDecompress(src, 5))).toBe('aaaaa');
  });

  it('copies a stored block as it is', () => {
    const src = new Uint8Array([...stored(ascii('raw!')), ...end]);
    expect(text(lz4FrameDecompress(src, 4))).toBe('raw!');
  });

  it('lets a later block match into an earlier block', () => {
    const src = new Uint8Array([...stored(ascii('xyz')), ...packed(5, [0x10, 0x51, 4, 0]), ...end]);
    expect(text(lz4FrameDecompress(src, 8))).toBe('xyzQxyzQ');
  });

  it('ignores bytes after the end mark', () => {
    const src = new Uint8Array([...stored(ascii('ab')), ...end, ...ascii('junk')]);
    expect(text(lz4FrameDecompress(src, 2))).toBe('ab');
  });

  it('returns zeros for empty input', () => {
    expect(Array.from(lz4FrameDecompress(new Uint8Array(0), 3))).toEqual([0, 0, 0]);
  });

  it('refuses an unknown block mark', () => {
    expect(() => lz4FrameDecompress(new Uint8Array(ascii('nope1234')), 8)).toThrow('lz4: unknown block mark');
  });

  it('refuses a block header that is cut short', () => {
    expect(() => lz4FrameDecompress(new Uint8Array([...ascii('bv41'), 1, 0, 0, 0]), 8)).toThrow('lz4: block header cut short');
    expect(() => lz4FrameDecompress(new Uint8Array([...ascii('bv4-'), 1, 0]), 8)).toThrow('lz4: block header cut short');
  });

  it('refuses a block that claims more output than the buffer holds', () => {
    const src = new Uint8Array(packed(4000, [0x40, ...ascii('abcd')]));
    expect(() => lz4FrameDecompress(src, 4)).toThrow('lz4: block out of range');
  });

  it('refuses a block that claims more input than the file holds', () => {
    const src = new Uint8Array([...ascii('bv41'), ...u32(4), ...u32(900), 0x40]);
    expect(() => lz4FrameDecompress(src, 4)).toThrow('lz4: block out of range');
  });

  it('refuses a stored block longer than the file', () => {
    const src = new Uint8Array([...ascii('bv4-'), ...u32(50), 1, 2]);
    expect(() => lz4FrameDecompress(src, 64)).toThrow('lz4: block out of range');
  });

  it('refuses a block whose decoded size differs from its header', () => {
    const src = new Uint8Array(packed(6, [0x10, 0x61, 1, 0]));
    expect(() => lz4FrameDecompress(src, 16)).toThrow('lz4: block size differs from its header');
  });

  it('refuses a match with a distance of zero', () => {
    const src = new Uint8Array(packed(5, [0x10, 0x61, 0, 0]));
    expect(() => lz4FrameDecompress(src, 16)).toThrow('lz4: match out of range');
  });

  it('refuses a match that reaches before the output', () => {
    const src = new Uint8Array(packed(5, [0x10, 0x61, 9, 0]));
    expect(() => lz4FrameDecompress(src, 16)).toThrow('lz4: match out of range');
  });

  it('refuses a literal run longer than its block', () => {
    const src = new Uint8Array(packed(9, [0x90, 0x61]));
    expect(() => lz4FrameDecompress(src, 16)).toThrow('lz4: literal run out of range');
  });
});
