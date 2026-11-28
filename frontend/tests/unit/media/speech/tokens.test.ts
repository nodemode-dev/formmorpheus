import { describe, expect, it } from 'vitest';
import { MAX_TOKENS, SAMPLE_RATE, STYLE_ROWS, STYLE_WIDTH, chunkPhonemes, joinSamples, styleFor, styleRow, tokenIds } from '@src/media/speech/tokens';

const vocab = { a: 43, b: 44, c: 45, ' ': 16, '.': 4, 'ˈ': 156 };

describe('tokenIds', () => {
  it('wraps the ids in zeros', () => {
    expect(tokenIds('ab c.', vocab)).toEqual([0, 43, 44, 16, 45, 4, 0]);
    expect(tokenIds('', vocab)).toEqual([0, 0]);
  });

  it('counts a stress mark as its own token', () => {
    expect(tokenIds('ˈa', vocab)).toEqual([0, 156, 43, 0]);
  });

  it('leaves out a character the model does not know, inherited names included', () => {
    expect(tokenIds('a#b', vocab)).toEqual([0, 43, 44, 0]);
    expect(tokenIds('a', Object.create({ a: 9 }) as Record<string, number>)).toEqual([0, 0]);
  });
});

describe('styleRow', () => {
  it('is the token count, kept inside the voice file', () => {
    expect(styleRow(0)).toBe(0);
    expect(styleRow(5)).toBe(5);
    expect(styleRow(STYLE_ROWS - 1)).toBe(509);
    expect(styleRow(STYLE_ROWS)).toBe(509);
    expect(styleRow(9999)).toBe(509);
    expect(styleRow(-3)).toBe(0);
    expect(styleRow(2.7)).toBe(2);
    expect(styleRow(Number.NaN)).toBe(0);
  });
});

describe('styleFor', () => {
  const voice = new Float32Array(STYLE_ROWS * STYLE_WIDTH);
  for (let row = 0; row < STYLE_ROWS; row++) voice.fill(row, row * STYLE_WIDTH, (row + 1) * STYLE_WIDTH);

  it('is the 256 numbers of the row', () => {
    const style = styleFor(voice, 3);
    expect(style).toHaveLength(256);
    expect(new Set(style)).toEqual(new Set([3]));
    expect(new Set(styleFor(voice, 600))).toEqual(new Set([509]));
  });

  it('is a copy, so the cached voice is never changed through it', () => {
    const style = styleFor(voice, 3);
    style[0] = -1;
    expect(voice[3 * STYLE_WIDTH]).toBe(3);
  });

  it('refuses a voice file that is too short', () => {
    expect(() => styleFor(new Float32Array(STYLE_WIDTH * 2), 5)).toThrow(/shorter/);
  });
});

describe('chunkPhonemes', () => {
  it('leaves a string within the limit whole', () => {
    expect(chunkPhonemes('ab c')).toEqual(['ab c']);
    expect(chunkPhonemes('x'.repeat(MAX_TOKENS))).toHaveLength(1);
    expect(MAX_TOKENS).toBeLessThan(510);
  });

  it('cuts a longer one at the last space within the limit', () => {
    expect(chunkPhonemes('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc']);
    expect(chunkPhonemes('aaaa bbbb cccc', 8)).toEqual(['aaaa', 'bbbb', 'cccc']);
  });

  it('cuts at the limit when there is no space', () => {
    expect(chunkPhonemes('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('gives nothing for nothing', () => {
    expect(chunkPhonemes('')).toEqual([]);
    expect(chunkPhonemes('   ')).toEqual([]);
  });

  it('keeps every piece within the limit', () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
    const out = chunkPhonemes(long);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((p) => p.length <= MAX_TOKENS)).toBe(true);
    expect(out.join(' ')).toBe(long);
  });
});

describe('joinSamples', () => {
  it('lays the parts end to end with the gap between them, not after the last', () => {
    const a = new Float32Array(SAMPLE_RATE).fill(0.5);
    const b = new Float32Array(SAMPLE_RATE / 2).fill(-0.5);
    const { samples, starts } = joinSamples([a, b], 0.5);
    expect(starts).toEqual([0, 1.5]);
    expect(samples).toHaveLength(SAMPLE_RATE * 2);
    expect(samples[SAMPLE_RATE - 1]).toBe(0.5);
    expect(samples[SAMPLE_RATE]).toBe(0);
    expect(samples[SAMPLE_RATE * 1.5 - 1]).toBe(0);
    expect(samples[SAMPLE_RATE * 1.5]).toBe(-0.5);
    expect(samples[samples.length - 1]).toBe(-0.5);
  });

  it('treats a negative or broken gap as none', () => {
    const part = new Float32Array(10).fill(1);
    expect(joinSamples([part, part], -1).samples).toHaveLength(20);
    expect(joinSamples([part, part], Number.NaN).starts).toEqual([0, 10 / SAMPLE_RATE]);
  });

  it('gives an empty buffer for no parts', () => {
    expect(joinSamples([], 0.3)).toEqual({ samples: new Float32Array(0), starts: [] });
  });
});
