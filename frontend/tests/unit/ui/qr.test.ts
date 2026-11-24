import { describe, expect, it, vi } from 'vitest';
import { drawQr, qrMatrix } from '@src/ui/qr';

const M_FORMATS = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

const maskOn = (k: number, x: number, y: number): boolean => {
  switch (k) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
};

const toNum = (bits: boolean[]): number => bits.reduce((acc, on, i) => acc | (on ? 1 << i : 0), 0);

function formatWords(m: boolean[][]): { first: number; second: number } {
  const s = m.length;
  const a: boolean[] = [];
  for (let i = 0; i <= 5; i++) a[i] = m[i][8];
  a[6] = m[7][8]; a[7] = m[8][8]; a[8] = m[8][7];
  for (let i = 9; i < 15; i++) a[i] = m[8][14 - i];
  const b: boolean[] = [];
  for (let i = 0; i < 8; i++) b[i] = m[8][s - 1 - i];
  for (let i = 8; i < 15; i++) b[i] = m[s - 15 + i][8];
  return { first: toNum(a), second: toNum(b) };
}

function readV1Codewords(m: boolean[][]): number[] {
  const s = m.length;
  const mask = M_FORMATS.indexOf(formatWords(m).first);
  const fn = (x: number, y: number): boolean => (x < 9 && y < 9) || (x >= s - 8 && y < 9) || (x < 9 && y >= s - 8) || x === 6 || y === 6;
  const bits: number[] = [];
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < s; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - vert : vert;
      if (!fn(x, y)) bits.push((m[y][x] !== maskOn(mask, x, y)) ? 1 : 0);
    }
  }
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  return words;
}

function decodeV1(m: boolean[][]): string {
  const w = readV1Codewords(m).slice(0, 16);
  const bits = w.flatMap((v) => Array.from({ length: 8 }, (_, i) => (v >>> (7 - i)) & 1));
  const take = (at: number, n: number): number => bits.slice(at, at + n).reduce((v, b) => (v << 1) | b, 0);
  expect(take(0, 4)).toBe(4);
  const len = take(4, 8);
  const bytes = Array.from({ length: len }, (_, i) => take(12 + i * 8, 8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
let g = 1;
for (let i = 0; i < 255; i++) { EXP[i] = g; LOG[g] = i; g <<= 1; if (g & 256) g ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

describe('qrMatrix', () => {
  it('picks version 1 for short text and grows the grid four modules per version', () => {
    expect(qrMatrix('hello')?.length).toBe(21);
    expect(qrMatrix('a'.repeat(14))?.length).toBe(21);
    expect(qrMatrix('a'.repeat(15))?.length).toBe(25);
    expect(qrMatrix('a'.repeat(27))?.length).toBe(29);
  });

  it('returns a square grid of booleans', () => {
    const m = qrMatrix('square check');
    expect(m).not.toBeNull();
    for (const row of m ?? []) {
      expect(row.length).toBe(m?.length);
      for (const cell of row) expect(typeof cell).toBe('boolean');
    }
  });

  it('accepts 213 bytes and refuses 214 bytes at the version 10 limit', () => {
    expect(qrMatrix('a'.repeat(213))?.length).toBe(57);
    expect(qrMatrix('a'.repeat(214))).toBeNull();
  });

  it('counts multi-byte characters by their encoded bytes', () => {
    const e = String.fromCharCode(233);
    expect(qrMatrix(e.repeat(106))).not.toBeNull();
    expect(qrMatrix(e.repeat(107))).toBeNull();
  });

  it('is deterministic for the same text', () => {
    expect(qrMatrix('https://example.test/x?y=1')).toEqual(qrMatrix('https://example.test/x?y=1'));
  });

  it('draws the three finder patterns with light separators', () => {
    const m = qrMatrix('finder') ?? [];
    const s = m.length;
    for (const [ox, oy] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
        const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        expect(m[oy + dy][ox + dx]).toBe(d !== 2);
      }
    }
    for (let i = 0; i < 8; i++) {
      expect(m[7][i]).toBe(false);
      expect(m[i][7]).toBe(false);
      expect(m[7][s - 1 - i]).toBe(false);
      expect(m[s - 8][i]).toBe(false);
    }
  });

  it('draws alternating timing patterns on row and column six', () => {
    const m = qrMatrix('timing pattern text that is longer') ?? [];
    const s = m.length;
    for (let i = 8; i < s - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  it('sets the always dark module beside the lower left finder', () => {
    for (const text of ['a', 'b'.repeat(40), 'c'.repeat(150)]) {
      const m = qrMatrix(text) ?? [];
      expect(m[m.length - 8][8]).toBe(true);
    }
  });

  it('writes two identical level M format words', () => {
    for (const text of ['x', 'format words', 'y'.repeat(60), 'z'.repeat(200)]) {
      const { first, second } = formatWords(qrMatrix(text) ?? []);
      expect(M_FORMATS).toContain(first);
      expect(second).toBe(first);
    }
  });

  it('writes the version 7 information blocks from version 7 upward', () => {
    const m = qrMatrix('v'.repeat(107)) ?? [];
    const s = m.length;
    expect(s).toBe(45);
    const top: boolean[] = [], left: boolean[] = [];
    for (let i = 0; i < 18; i++) {
      top.push(m[Math.floor(i / 3)][s - 11 + (i % 3)]);
      left.push(m[s - 11 + (i % 3)][Math.floor(i / 3)]);
    }
    expect(toNum(top)).toBe(0x07c94);
    expect(toNum(left)).toBe(0x07c94);
  });

  it('encodes text that decodes back to the same bytes', () => {
    for (const text of ['hello', 'QR 123', `caf${String.fromCharCode(233)}`, 'a'.repeat(14)]) {
      expect(decodeV1(qrMatrix(text) ?? [])).toBe(text);
    }
  });

  it('pads unused data codewords with the alternating pad bytes', () => {
    const w = readV1Codewords(qrMatrix('hi') ?? []).slice(0, 16);
    expect(w.slice(4)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]);
  });

  it('appends error correction codewords whose syndromes are zero', () => {
    for (const text of ['hello', 'error check', '']) {
      const cw = readV1Codewords(qrMatrix(text) ?? []).slice(0, 26);
      expect(cw.length).toBe(26);
      for (let i = 0; i < 10; i++) {
        let acc = 0;
        for (const c of cw) acc = mul(acc, EXP[i]) ^ c;
        expect(acc).toBe(0);
      }
    }
  });
});

describe('drawQr', () => {
  const fakeCanvas = (withCtx: boolean): { cv: HTMLCanvasElement; rects: number[][] } => {
    const rects: number[][] = [];
    const cv = document.createElement('canvas');
    const ctx = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number): void => { rects.push([x, y, w, h]); } };
    vi.spyOn(cv, 'getContext').mockReturnValue((withCtx ? ctx : null) as unknown as ReturnType<HTMLCanvasElement['getContext']>);
    return { cv, rects };
  };

  it('sizes the canvas to whole modules with a four module quiet zone', () => {
    const { cv, rects } = fakeCanvas(true);
    expect(drawQr(cv, 'hello', 100)).toBe(true);
    expect(cv.width).toBe(87);
    expect(cv.height).toBe(87);
    const m = qrMatrix('hello') ?? [];
    const dark = m.flat().filter(Boolean).length;
    expect(rects.length).toBe(dark + 1);
    expect(rects[0]).toEqual([0, 0, 87, 87]);
    for (const [x, y, w, h] of rects.slice(1)) {
      expect(w).toBe(3);
      expect(h).toBe(3);
      expect(x).toBeGreaterThanOrEqual(12);
      expect(y).toBeGreaterThanOrEqual(12);
      expect(x).toBeLessThan(87 - 12);
      expect(y).toBeLessThan(87 - 12);
    }
  });

  it('uses at least one pixel per module when the requested size is tiny', () => {
    const { cv } = fakeCanvas(true);
    expect(drawQr(cv, 'hello', 5)).toBe(true);
    expect(cv.width).toBe(29);
  });

  it('returns false when the text does not fit', () => {
    const { cv, rects } = fakeCanvas(true);
    expect(drawQr(cv, 'a'.repeat(300), 200)).toBe(false);
    expect(rects.length).toBe(0);
  });

  it('returns false without a 2d context', () => {
    const { cv } = fakeCanvas(false);
    expect(drawQr(cv, 'hello', 100)).toBe(false);
  });
});
