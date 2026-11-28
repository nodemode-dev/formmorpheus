// Speech to text, the page's side: sound is brought to 16 kHz mono here, a Worker (listen-worker.ts) runs the speech
// model on files the engine serves, and what comes back is turned into words with times. The maths is in plain
// functions so it can be tested with no Worker and no model.
import { windowKey } from '../../io/window-key';
import { t } from '../../ui/i18n';

/** Seconds from the start of the samples. */
export interface HeardWord { text: string; start: number; end: number }
export interface ListenOptions { language?: string; signal?: AbortSignal; onProgress?: (fraction: number) => void }

/** A piece of text with its span as the speech model gives it: one word, or a whole segment. The end may be missing. */
export interface HeardChunk { text: string; timestamp: [number | null, number | null] }

export interface ListenJob { samples: Float32Array; language?: string; key: string }
export type ListenReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; chunks: HeardChunk[]; byWord: boolean }
  | { type: 'error'; message: string };

/** The rate the speech model hears at. */
export const LISTEN_RATE = 16000;
const STATUS_URL = '/api/speech-models';
/** Words closer than this, with no sentence end between them, are judged together when looking for a loop. */
const RUN_GAP_SECONDS = 0.7;
const RUN_WORDS = 30;
/** Lengths given to a word or a segment whose end the model left out. */
const WORD_SECONDS = 0.3;
const SEGMENT_SECONDS = 2;

const ms = (seconds: number): number => Math.round(seconds * 1000) / 1000;

/** Mono samples at any rate brought to 16 kHz: averaged over each step going down (so highs do not fold back), interpolated going up. */
export function resample16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (!(sampleRate > 0) || !samples.length) return new Float32Array(0);
  if (sampleRate === LISTEN_RATE) return Float32Array.from(samples);
  const ratio = sampleRate / LISTEN_RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  const last = samples.length - 1;
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    if (ratio > 1) {
      const from = Math.floor(at), to = Math.min(samples.length, Math.max(from + 1, Math.floor(at + ratio)));
      let sum = 0;
      for (let k = from; k < to; k++) sum += samples[k];
      out[i] = sum / (to - from);
    } else {
      const lo = Math.min(last, Math.floor(at)), hi = Math.min(last, lo + 1), f = at - lo;
      out[i] = samples[lo] * (1 - f) + samples[hi] * f;
    }
  }
  return out;
}

/** True for text that loops: a small speech model repeats a phrase or a word over silence and noise. */
export function looped(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  for (let len = 2; len <= 4; len++) {
    const seen = new Map<string, number>();
    for (let i = 0; i + len <= words.length; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const n = (seen.get(phrase) ?? 0) + 1;
      if (n > 3) return true;
      seen.set(phrase, n);
    }
  }
  const counts = new Map<string, number>();
  for (const w of words) {
    const n = (counts.get(w) ?? 0) + 1;
    if (n > 4 && n > words.length * 0.5) return true;
    counts.set(w, n);
  }
  return false;
}

/** Word timing is usable when there is some and every chunk really is about a word (a model without it hands back phrases). */
export function wordTimed(chunks: HeardChunk[]): boolean {
  return chunks.length > 0 && !chunks.some((c) => c.text.trim().split(/\s+/).length > 3);
}

/** A segment's words with its span shared between them by length (a letter takes about as long as any other). */
export function spreadWords(text: string, start: number, end: number): HeardWord[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const total = parts.reduce((sum, p) => sum + p.length + 1, 0) || 1;
  const span = Math.max(0.05, end - start);
  let used = 0;
  return parts.map((p) => {
    const from = start + (span * used) / total;
    used += p.length + 1;
    return { text: p, start: ms(from), end: ms(start + (span * used) / total) };
  });
}

/** Words split where speech pauses or a sentence ends, so a loop is judged, and dropped, a stretch at a time. */
export function wordRuns(words: HeardWord[]): HeardWord[][] {
  const runs: HeardWord[][] = [];
  let cur: HeardWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= RUN_WORDS || w.start - prev.end > RUN_GAP_SECONDS || /[.!?]$/.test(prev.text))) { runs.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

export function dropLoops(words: HeardWord[]): HeardWord[] {
  return wordRuns(words).filter((run) => !looped(run.map((w) => w.text).join(' '))).flat();
}

/**
 * The speech model's chunks as words in seconds. `byWord`: each chunk is a word with its own times; otherwise each is
 * a segment whose words share its span. Looped stretches are dropped, and with `seconds` nothing ends after the sound.
 */
export function heardWords(chunks: HeardChunk[], byWord: boolean, seconds: number = Number.POSITIVE_INFINITY): HeardWord[] {
  const span = (c: HeardChunk, fallback: number): [number, number] => {
    const start = Math.min(seconds, Math.max(0, c.timestamp[0] ?? 0));
    const end = c.timestamp[1] ?? start + fallback;
    return [start, Math.min(seconds, Math.max(start, end))];
  };
  if (byWord) {
    const words = chunks.filter((c) => c.text.trim()).map((c) => {
      const [start, end] = span(c, WORD_SECONDS);
      return { text: c.text.trim(), start: ms(start), end: ms(end) };
    });
    return dropLoops(words);
  }
  return chunks.filter((c) => c.text.trim() && !looped(c.text)).flatMap((c) => {
    const [start, end] = span(c, SEGMENT_SECONDS);
    return spreadWords(c.text, start, end);
  });
}

function aborted(): DOMException {
  return new DOMException('Listening was cancelled', 'AbortError');
}

/** Refuses with a sentence a person can read when the speech to text files are not on this computer. */
async function requireInstalled(signal?: AbortSignal): Promise<void> {
  let installed = false;
  try {
    const res = await fetch(STATUS_URL, { signal });
    if (!res.ok) throw new Error(res.statusText);
    const body = (await res.json()) as { sets?: { listen?: { installed?: unknown } } };
    installed = body.sets?.listen?.installed === true;
  } catch (e) {
    if (signal?.aborted) throw aborted();
    console.error('Speech models status failed:', e);
    throw new Error(t('The FormMorpheus engine did not answer, so speech to text cannot start.'));
  }
  if (!installed) throw new Error(t('Speech to text is not installed yet. Download it in the speech settings first.'));
}

function run(samples: Float32Array, opts: ListenOptions): Promise<{ chunks: HeardChunk[]; byWord: boolean }> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./listen-worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      console.error('Speech to text worker did not start:', e);
      reject(new Error(t('Speech to text could not start on this computer.')));
      return;
    }
    const stop = (): void => { finish(); reject(aborted()); };
    // one job per worker: ending it frees the model's memory, and it is the only way to stop a run part way
    const finish = (): void => { worker.terminate(); opts.signal?.removeEventListener('abort', stop); };
    opts.signal?.addEventListener('abort', stop, { once: true });
    worker.onerror = (e): void => { finish(); reject(new Error(e.message || t('Speech to text stopped unexpectedly.'))); };
    worker.onmessage = (e: MessageEvent<ListenReply>): void => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(Math.min(1, Math.max(0, m.fraction)));
      else if (m.type === 'done') { finish(); resolve({ chunks: m.chunks, byWord: m.byWord }); }
      else { finish(); reject(new Error(m.message || t('Speech to text failed.'))); }
    };
    const job: ListenJob = { samples, key: windowKey(), ...(opts.language ? { language: opts.language } : {}) };
    worker.postMessage(job, [samples.buffer as ArrayBuffer]);
  });
}

/**
 * The words spoken in mono `samples`, with times in seconds from their start. `language` is a two-letter code.
 * Rejects with an AbortError when `signal` aborts, and with a readable Error when the files are not installed.
 */
export async function listen(samples: Float32Array, sampleRate: number, opts: ListenOptions = {}): Promise<HeardWord[]> {
  if (opts.signal?.aborted) throw aborted();
  const language = opts.language?.trim().toLowerCase();
  if (language && !/^[a-z]{2}$/.test(language)) throw new Error(t('The language must be a two-letter code such as en.'));
  await requireInstalled(opts.signal);
  const audio = resample16k(samples, sampleRate);
  if (!audio.length) return [];
  const seconds = audio.length / LISTEN_RATE;
  const { chunks, byWord } = await run(audio, { ...opts, language });
  opts.onProgress?.(1);
  return heardWords(chunks, byWord, seconds);
}
