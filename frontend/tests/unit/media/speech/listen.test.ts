import { afterEach, describe, expect, it, vi } from 'vitest';
import { LISTEN_RATE, dropLoops, heardWords, listen, looped, resample16k, spreadWords, wordRuns, wordTimed, type HeardChunk, type HeardWord } from '@src/media/speech/listen';

const word = (text: string, start: number, end: number): HeardWord => ({ text, start, end });
const chunk = (text: string, start: number | null, end: number | null): HeardChunk => ({ text, timestamp: [start, end] });

function tone(hz: number, rate: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return x;
}

function rms(x: Float32Array): number {
  let sum = 0;
  for (const v of x) sum += v * v;
  return Math.sqrt(sum / Math.max(1, x.length));
}

describe('resample16k', () => {
  it('copies sound that is already at 16 kHz', () => {
    const src = tone(440, LISTEN_RATE, 0.1);
    const out = resample16k(src, LISTEN_RATE);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it('keeps the length in seconds going down and going up', () => {
    expect(resample16k(new Float32Array(48000), 48000)).toHaveLength(16000);
    expect(resample16k(new Float32Array(44100), 44100)).toHaveLength(16000);
    expect(resample16k(new Float32Array(24000), 24000)).toHaveLength(16000);
    expect(resample16k(new Float32Array(8000), 8000)).toHaveLength(16000);
  });

  it('keeps a low tone at its pitch and level', () => {
    for (const rate of [48000, 44100, 24000, 8000]) {
      const out = resample16k(tone(200, rate, 0.5), rate);
      const want = tone(200, LISTEN_RATE, 0.5);
      let worst = 0;
      for (let i = 0; i < Math.min(out.length, want.length) - 1; i++) worst = Math.max(worst, Math.abs(out[i] - want[i]));
      expect(worst, `${rate} Hz`).toBeLessThan(0.12);
    }
  });

  it('quiets a tone above what 16 kHz can carry when going down', () => {
    expect(rms(resample16k(tone(15000, 48000, 0.5), 48000))).toBeLessThan(0.35);
    expect(rms(resample16k(tone(200, 48000, 0.5), 48000))).toBeGreaterThan(0.65);
  });

  it('holds a steady level and does not change what it was given', () => {
    const src = new Float32Array(4800).fill(0.5);
    const out = resample16k(src, 48000);
    expect(Math.min(...out)).toBeCloseTo(0.5, 6);
    expect(Math.max(...out)).toBeCloseTo(0.5, 6);
    expect(src.every((v) => v === 0.5)).toBe(true);
  });

  it('gives nothing for no sound or a rate that makes no sense', () => {
    expect(resample16k(new Float32Array(0), 48000)).toHaveLength(0);
    expect(resample16k(new Float32Array(100), 0)).toHaveLength(0);
    expect(resample16k(new Float32Array(100), Number.NaN)).toHaveLength(0);
  });
});

describe('looped', () => {
  it('passes ordinary speech and short text', () => {
    expect(looped('The quick brown fox jumps over the lazy dog.')).toBe(false);
    expect(looped('no no no')).toBe(false);
    expect(looped('')).toBe(false);
    expect(looped('I think that I think so, and I think you do too')).toBe(false);
  });

  it('catches a phrase said more than three times', () => {
    expect(looped('thank you thank you thank you thank you')).toBe(true);
    expect(looped('Thanks for watching thanks for watching THANKS for watching thanks for watching')).toBe(true);
  });

  it('catches one word that is most of the text', () => {
    expect(looped('you you you you you')).toBe(true);
    expect(looped('okay you you so you you you')).toBe(true);
    expect(looped('you you you you')).toBe(false);
  });
});

describe('wordTimed', () => {
  it('needs chunks, each about one word', () => {
    expect(wordTimed([])).toBe(false);
    expect(wordTimed([chunk(' Hello', 0, 0.3), chunk(' there.', 0.3, 0.6)])).toBe(true);
    expect(wordTimed([chunk(' Hello', 0, 0.3), chunk(' this is a whole segment', 0.3, 2)])).toBe(false);
  });
});

describe('spreadWords', () => {
  it('shares the span between the words by their length, end to end', () => {
    const out = spreadWords(' a  bcd ', 10, 12);
    // lengths count one space each: 2 and 4 of 6
    expect(out).toEqual([word('a', 10, 10.667), word('bcd', 10.667, 12)]);
  });

  it('gives a segment with no length a short one, and no words for no text', () => {
    const out = spreadWords('one two', 5, 5);
    expect(out[0].start).toBe(5);
    expect(out[1].end).toBeCloseTo(5.05, 3);
    expect(spreadWords('   ', 0, 1)).toEqual([]);
  });
});

describe('wordRuns and dropLoops', () => {
  it('splits words at a pause and after a sentence end', () => {
    const words = [word('Hello', 0, 0.3), word('there.', 0.3, 0.6), word('Now', 0.7, 0.9), word('wait', 0.9, 1.1), word('then', 2, 2.2)];
    expect(wordRuns(words).map((r) => r.map((w) => w.text).join(' '))).toEqual(['Hello there.', 'Now wait', 'then']);
    expect(wordRuns([])).toEqual([]);
  });

  it('caps a run at thirty words', () => {
    const words = Array.from({ length: 65 }, (_, i) => word(`w${i}`, i * 0.2, i * 0.2 + 0.15));
    expect(wordRuns(words).map((r) => r.length)).toEqual([30, 30, 5]);
  });

  it('drops a looped stretch and keeps the speech around it', () => {
    const speech = [word('Good', 0, 0.3), word('morning.', 0.3, 0.7)];
    const loop = Array.from({ length: 8 }, (_, i) => word(i % 2 ? 'you' : 'thank', 5 + i * 0.3, 5.25 + i * 0.3));
    const after = [word('Right', 20, 20.3), word('then.', 20.3, 20.6)];
    expect(dropLoops([...speech, ...loop, ...after])).toEqual([...speech, ...after]);
  });

  it('leaves the words it was given as they were', () => {
    const words = [word('one', 0, 0.2), word('two', 0.2, 0.4)];
    const before = JSON.stringify(words);
    expect(dropLoops(words)).toEqual(words);
    expect(JSON.stringify(words)).toBe(before);
  });
});

describe('heardWords', () => {
  it('maps word chunks to trimmed words in seconds', () => {
    const out = heardWords([chunk(' Hello', 0.12, 0.5), chunk(' there.', 0.5, 0.914), chunk('  ', 1, 1.1)], true);
    expect(out).toEqual([word('Hello', 0.12, 0.5), word('there.', 0.5, 0.914)]);
  });

  it('gives a word with no end a short length, and one with no start the beginning', () => {
    expect(heardWords([chunk('end', 3, null)], true)).toEqual([word('end', 3, 3.3)]);
    expect(heardWords([chunk('start', null, 0.4)], true)).toEqual([word('start', 0, 0.4)]);
  });

  it('never ends a word before it starts or after the sound', () => {
    expect(heardWords([chunk('odd', 2, 1.5)], true)).toEqual([word('odd', 2, 2)]);
    expect(heardWords([chunk('late', 9.9, null), chunk('gone', 12, 13)], true, 10)).toEqual([word('late', 9.9, 10), word('gone', 10, 10)]);
  });

  it('drops looped words', () => {
    const loop = Array.from({ length: 6 }, (_, i) => chunk(' you', 1 + i * 0.3, 1.2 + i * 0.3));
    expect(heardWords([chunk(' Hi.', 0, 0.3), ...loop], true)).toEqual([word('Hi.', 0, 0.3)]);
  });

  it('spreads the words of a segment inside it when there is no word timing', () => {
    const out = heardWords([chunk(' ab cd', 1, 2), chunk(' ef', 4, null)], false);
    expect(out).toEqual([word('ab', 1, 1.5), word('cd', 1.5, 2), word('ef', 4, 6)]);
  });

  it('drops a looped segment and an empty one', () => {
    const out = heardWords([chunk(' thank you thank you thank you thank you', 0, 4), chunk(' ', 4, 5), chunk(' Real words here.', 5, 6.5)], false);
    expect(out.map((w) => w.text)).toEqual(['Real', 'words', 'here.']);
    expect(out[0].start).toBe(5);
    expect(out[2].end).toBe(6.5);
  });

  it('gives no words for no chunks', () => {
    expect(heardWords([], true)).toEqual([]);
    expect(heardWords([], false)).toEqual([]);
  });
});

describe('listen, before any worker starts', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const status = (installed: boolean): Response => new Response(JSON.stringify({ sets: { listen: { installed }, voice: { installed: true } } }), { status: 200 });
  const noWorker = (): ReturnType<typeof vi.fn> => {
    const made = vi.fn(() => { throw new Error('a worker must not start here'); });
    vi.stubGlobal('Worker', made);
    return made;
  };

  it('refuses with a sentence a person can read when the files are not installed', async () => {
    const fetched = vi.fn(async () => status(false));
    vi.stubGlobal('fetch', fetched);
    const made = noWorker();
    await expect(listen(new Float32Array(1600), 16000)).rejects.toThrow('Speech to text is not installed yet.');
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(fetched.mock.calls[0][0 as never]).toBe('/api/speech-models');
    expect(made).not.toHaveBeenCalled();
  });

  it('refuses readably when the engine does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    noWorker();
    await expect(listen(new Float32Array(1600), 16000)).rejects.toThrow('engine did not answer');
  });

  it('rejects with an AbortError when already aborted, without asking the engine', async () => {
    const fetched = vi.fn(async () => status(true));
    vi.stubGlobal('fetch', fetched);
    const ac = new AbortController();
    ac.abort();
    await expect(listen(new Float32Array(1600), 16000, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetched).not.toHaveBeenCalled();
  });

  it('refuses a language that is not a two-letter code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(true)));
    await expect(listen(new Float32Array(1600), 16000, { language: 'english' })).rejects.toThrow('two-letter');
  });

  it('hears nothing in no sound, with no worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(true)));
    const made = noWorker();
    await expect(listen(new Float32Array(0), 48000)).resolves.toEqual([]);
    expect(made).not.toHaveBeenCalled();
  });

  it('sends the sound at 16 kHz with the language, reports progress, and ends the worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(true)));
    const jobs: Array<{ samples: Float32Array; language?: string }> = [];
    let ended = 0;
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(job: { samples: Float32Array; language?: string }): void {
        jobs.push(job);
        queueMicrotask(() => {
          this.onmessage?.({ data: { type: 'progress', fraction: 0.5 } } as MessageEvent);
          this.onmessage?.({ data: { type: 'done', byWord: true, chunks: [chunk(' Hello', 0.1, 0.4), chunk(' there.', 0.4, 5)] } } as MessageEvent);
        });
      }
      terminate(): void { ended++; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const seen: number[] = [];
    const out = await listen(new Float32Array(48000), 48000, { language: 'FR', onProgress: (f) => seen.push(f) });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].samples).toHaveLength(16000);
    expect(jobs[0].language).toBe('fr');
    expect(seen).toEqual([0.5, 1]);
    expect(ended).toBe(1);
    // the sound is one second long, so the last word is cut to it
    expect(out).toEqual([word('Hello', 0.1, 0.4), word('there.', 0.4, 1)]);
  });

  it('ends the worker and rejects with an AbortError when aborted part way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(true)));
    let ended = 0;
    const ac = new AbortController();
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(): void { queueMicrotask(() => ac.abort()); }
      terminate(): void { ended++; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    await expect(listen(new Float32Array(16000), 16000, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ended).toBe(1);
  });

  it('passes on what the worker says went wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(true)));
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(): void { queueMicrotask(() => this.onmessage?.({ data: { type: 'error', message: 'The model file is damaged.' } } as MessageEvent)); }
      terminate(): void { return; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    await expect(listen(new Float32Array(16000), 16000)).rejects.toThrow('The model file is damaged.');
  });
});
