// The arithmetic between a phoneme string and the speech model's inputs. Pure, so the worker and the tests share it.

export const SAMPLE_RATE = 24000;
/** Rows in a voice file, one per phoneme count. */
export const STYLE_ROWS = 510;
export const STYLE_WIDTH = 256;
/** The most phoneme characters one call may carry: the model's limit is under 510. */
export const MAX_TOKENS = 509;

export type Vocab = Record<string, number>;

/** One id per phoneme character the model knows, wrapped in the zeros that open and close a call. */
export function tokenIds(phonemes: string, vocab: Vocab): number[] {
  const ids = [...phonemes].map((c) => (Object.hasOwn(vocab, c) ? vocab[c] : undefined)).filter((id): id is number => typeof id === 'number');
  return [0, ...ids, 0];
}

/** The voice file's row for a call of `tokens` phoneme characters (the two zeros not counted). */
export function styleRow(tokens: number): number {
  return Math.min(STYLE_ROWS - 1, Math.max(0, Math.floor(Number.isFinite(tokens) ? tokens : 0)));
}

/** A copy of that row: the 256 numbers that give a call its voice. */
export function styleFor(voice: Float32Array, tokens: number): Float32Array {
  const at = styleRow(tokens) * STYLE_WIDTH;
  if (voice.length < at + STYLE_WIDTH) throw new Error('The voice file is shorter than it should be.');
  return voice.slice(at, at + STYLE_WIDTH);
}

/** A phoneme string cut at spaces into pieces of at most `max` characters, for the rare sentence over the limit. */
export function chunkPhonemes(phonemes: string, max: number = MAX_TOKENS): string[] {
  const limit = Math.max(1, Math.floor(max));
  const out: string[] = [];
  let rest = phonemes.trim();
  while ([...rest].length > limit) {
    const chars = [...rest];
    const space = chars.lastIndexOf(' ', limit);
    const cut = space > 0 ? space : limit;
    out.push(chars.slice(0, cut).join('').trim());
    rest = chars.slice(cut).join('').trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Sentences laid end to end with a silence between them; `starts[i]` is the second at which sentence i begins. */
export function joinSamples(parts: readonly Float32Array[], gapSeconds: number): { samples: Float32Array; starts: number[] } {
  const gap = Math.max(0, Math.round((Number.isFinite(gapSeconds) ? gapSeconds : 0) * SAMPLE_RATE));
  const total = parts.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const samples = new Float32Array(total);
  const starts: number[] = [];
  let at = 0;
  for (const part of parts) {
    starts.push(at / SAMPLE_RATE);
    samples.set(part, at);
    at += part.length + gap;
  }
  return { samples, starts };
}
