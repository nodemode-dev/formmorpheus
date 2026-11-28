import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Spoken } from '@src/media/speech/voice';
import type { SpeakDone, SpeakJob } from '@src/media/speech/voice-worker';

vi.mock('@src/ui/i18n', () => ({ t: (s: string): string => s }));

type Reply = (job: SpeakJob) => Omit<Extract<SpeakDone, { ok: true }>, 'id'> | Omit<Extract<SpeakDone, { ok: false }>, 'id'> | 'silent' | 'crash';
type Listener = (e: { data?: SpeakDone; message?: string }) => void;

let mod: typeof import('@src/media/speech/voice');
let workers: FakeWorker[] = [];
let reply: Reply = () => 'silent';
let fetched: string[] = [];

/** Stands in for the voice worker: answers each job with what `reply` gives, a tick later as a real one would. */
class FakeWorker {
  jobs: SpeakJob[] = [];
  ended = false;
  private readonly heard = new Map<string, Set<Listener>>();
  constructor(readonly url: URL, readonly opts: WorkerOptions) { workers.push(this); }
  addEventListener(type: string, fn: Listener): void { this.heard.set(type, (this.heard.get(type) ?? new Set()).add(fn)); }
  removeEventListener(type: string, fn: Listener): void { this.heard.get(type)?.delete(fn); }
  terminate(): void { this.ended = true; }
  listeners(): number { return [...this.heard.values()].reduce((n, s) => n + s.size, 0); }
  postMessage(job: SpeakJob): void {
    this.jobs.push(job);
    const r = reply(job);
    if (r === 'silent') return;
    queueMicrotask(() => {
      if (this.ended) return;
      if (r === 'crash') for (const fn of [...(this.heard.get('error') ?? [])]) fn({ message: 'the worker fell over' });
      else for (const fn of [...(this.heard.get('message') ?? [])]) fn({ data: { ...r, id: job.id } as SpeakDone });
    });
  }
}

const state = (installed: boolean): unknown => ({ installed, bytes: 1, files: 34, licence: 'Apache-2.0', task: { state: 'idle', done: 0, total: 0, error: '' } });

function engine(voiceInstalled: boolean | 'down'): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL): Promise<Response> => {
    fetched.push(String(input));
    if (voiceInstalled === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(JSON.stringify({ sets: { voice: state(voiceInstalled), listen: state(false) } }), { status: 200 }));
  });
}

const samplesFor = (job: SpeakJob): Float32Array => new Float32Array(job.text.length * 1000).fill(0.25);
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(async () => {
  workers = [];
  fetched = [];
  reply = (job) => ({ ok: true, samples: samplesFor(job), unknown: [] });
  vi.stubGlobal('Worker', FakeWorker);
  engine(true);
  vi.resetModules();
  mod = await import('@src/media/speech/voice');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('VOICES', () => {
  it('lists the 28 built-in voices, each once', () => {
    expect(mod.VOICES).toHaveLength(28);
    expect(new Set(mod.VOICES.map((v) => v.id)).size).toBe(28);
  });

  it('reads accent, gender and name from the id', () => {
    expect(mod.VOICES.find((v) => v.id === 'af_heart')).toEqual({ id: 'af_heart', name: 'Heart', accent: 'us', gender: 'f' });
    expect(mod.VOICES.find((v) => v.id === 'am_michael')).toEqual({ id: 'am_michael', name: 'Michael', accent: 'us', gender: 'm' });
    expect(mod.VOICES.find((v) => v.id === 'bf_emma')).toEqual({ id: 'bf_emma', name: 'Emma', accent: 'gb', gender: 'f' });
    expect(mod.VOICES.find((v) => v.id === 'bm_george')).toEqual({ id: 'bm_george', name: 'George', accent: 'gb', gender: 'm' });
  });

  it('has eleven US women, nine US men, four UK women and four UK men', () => {
    const count = (accent: string, gender: string): number => mod.VOICES.filter((v) => v.accent === accent && v.gender === gender).length;
    expect([count('us', 'f'), count('us', 'm'), count('gb', 'f'), count('gb', 'm')]).toEqual([11, 9, 4, 4]);
    expect(mod.VOICES.every((v) => /^[ab][fm]_[a-z]+$/.test(v.id) && /^[A-Z][a-z]+$/.test(v.name))).toBe(true);
  });
});

describe('speak', () => {
  it('speaks sentence by sentence and reports each one', async () => {
    const progress: Array<[number, number]> = [];
    const spoken = await mod.speak('Hello there. How are you?', { voice: 'bf_emma', speed: 1.2, onProgress: (d, n) => progress.push([d, n]) });
    expect(workers).toHaveLength(1);
    expect(workers[0].opts).toEqual({ type: 'module' });
    expect(String(workers[0].url)).toContain('voice-worker.ts');
    expect(workers[0].jobs.map((j) => ({ text: j.text, voice: j.voice, accent: j.accent, speed: j.speed, key: j.key }))).toEqual([
      { text: 'Hello there.', voice: 'bf_emma', accent: 'gb', speed: 1.2, key: '' },
      { text: 'How are you?', voice: 'bf_emma', accent: 'gb', speed: 1.2, key: '' },
    ]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(spoken.sampleRate).toBe(24000);
    expect(spoken.sentences.map((s) => s.text)).toEqual(['Hello there.', 'How are you?']);
    expect(spoken.sentences.map((s) => s.seconds)).toEqual([0.5, 0.5]);
    expect(spoken.sentences[0].samples).toHaveLength(12000);
  });

  it('asks the engine whether the voice is installed before it starts', async () => {
    await mod.speak('Hi.', { voice: 'af_heart', speed: 1 });
    expect(fetched).toEqual(['/api/speech-models']);
  });

  it('gathers the unknown words of every sentence, each once', async () => {
    reply = (job) => ({ ok: true, samples: samplesFor(job), unknown: job.text.startsWith('One') ? ['Zax', 'Quib'] : ['Zax', 'Vrr'] });
    const spoken = await mod.speak('One. Two.', { voice: 'af_heart', speed: 1 });
    expect(spoken.unknown).toEqual(['Zax', 'Quib', 'Vrr']);
  });

  it('keeps one worker across calls', async () => {
    await mod.speak('One.', { voice: 'af_heart', speed: 1 });
    await mod.speak('Two.', { voice: 'am_adam', speed: 1 });
    expect(workers).toHaveLength(1);
    expect(workers[0].jobs.map((j) => j.accent)).toEqual(['us', 'us']);
    expect(workers[0].listeners()).toBe(0);
  });

  it('runs two calls made together one after the other', async () => {
    const [a, b] = await Promise.all([mod.speak('One. Two.', { voice: 'af_heart', speed: 1 }), mod.speak('Three.', { voice: 'af_heart', speed: 1 })]);
    expect(workers[0].jobs.map((j) => j.text)).toEqual(['One.', 'Two.', 'Three.']);
    expect([a.sentences.length, b.sentences.length]).toEqual([2, 1]);
  });

  it('keeps the speed within what the model takes', async () => {
    await mod.speak('One.', { voice: 'af_heart', speed: 9 });
    await mod.speak('Two.', { voice: 'af_heart', speed: 0.01 });
    await mod.speak('Three.', { voice: 'af_heart', speed: Number.NaN });
    expect(workers[0].jobs.map((j) => j.speed)).toEqual([2, 0.5, 1]);
  });

  it('gives nothing for text with no sentence, without asking the engine or starting a worker', async () => {
    const spoken: Spoken = await mod.speak('  \n ', { voice: 'af_heart', speed: 1 });
    expect(spoken).toEqual({ sampleRate: 24000, sentences: [], unknown: [] });
    expect(fetched).toEqual([]);
    expect(workers).toHaveLength(0);
  });

  it('rejects a voice that is not built in', async () => {
    await expect(mod.speak('Hi.', { voice: 'zz_nobody', speed: 1 })).rejects.toThrow(/not one of the built-in voices/);
    expect(fetched).toEqual([]);
  });

  it('rejects readably when the voice set is not installed, and starts no worker', async () => {
    engine(false);
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1 })).rejects.toThrow(/not installed/);
    expect(workers).toHaveLength(0);
  });

  it('rejects readably when the engine does not answer', async () => {
    engine('down');
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1 })).rejects.toThrow(/engine did not answer/);
  });

  it('says not installed when the worker finds a file missing', async () => {
    reply = () => ({ ok: false, missing: true, error: 'voices/af_heart.bin' });
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1 })).rejects.toThrow(/not installed/);
  });

  it('rejects with the reason the worker gave', async () => {
    reply = () => ({ ok: false, missing: false, error: 'The speech model has no list of sounds.' });
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1 })).rejects.toThrow('The speech model has no list of sounds.');
    expect(workers[0].listeners()).toBe(0);
  });

  it('stops by ending the worker and rejects with an AbortError', async () => {
    const stop = new AbortController();
    const progress: number[] = [];
    reply = (job) => (job.text === 'Two.' ? 'silent' : { ok: true, samples: samplesFor(job), unknown: [] });
    const pending = mod.speak('One. Two. Three.', { voice: 'af_heart', speed: 1, signal: stop.signal, onProgress: (d) => progress.push(d) });
    const caught = pending.catch((e: unknown) => e);
    await flush();
    expect(workers[0].jobs.map((j) => j.text)).toEqual(['One.', 'Two.']);
    stop.abort();
    const err = await caught;
    expect((err as Error).name).toBe('AbortError');
    expect(workers[0].ended).toBe(true);
    expect(progress).toEqual([1]);
    await flush();
    expect(workers[0].jobs).toHaveLength(2);
  });

  it('starts a fresh worker for the call after a stop', async () => {
    const stop = new AbortController();
    reply = () => 'silent';
    const caught = mod.speak('One.', { voice: 'af_heart', speed: 1, signal: stop.signal }).catch((e: unknown) => e);
    await flush();
    stop.abort();
    await caught;
    reply = (job) => ({ ok: true, samples: samplesFor(job), unknown: [] });
    const spoken = await mod.speak('Two.', { voice: 'af_heart', speed: 1 });
    expect(workers).toHaveLength(2);
    expect(workers[1].ended).toBe(false);
    expect(spoken.sentences).toHaveLength(1);
  });

  it('rejects at once for a signal that has already stopped', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1, signal: stop.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers).toHaveLength(0);
    expect(fetched).toEqual([]);
  });

  it('ends a worker that fails and rejects', async () => {
    reply = () => 'crash';
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1 })).rejects.toThrow('the worker fell over');
    expect(workers[0].ended).toBe(true);
  });

  it('rejects readably where there are no workers', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(mod.speak('Hi.', { voice: 'af_heart', speed: 1 })).rejects.toThrow(/could not start/);
  });
});

describe('join', () => {
  const spoken = (lengths: number[]): Spoken => ({
    sampleRate: 24000, unknown: [],
    sentences: lengths.map((n, i) => ({ text: `s${i}`, samples: new Float32Array(n).fill(i + 1), seconds: n / 24000 })),
  });

  it('puts the sentences in one buffer and says when each begins', () => {
    const { samples, starts } = mod.join(spoken([24000, 12000, 6000]), 0.5);
    expect(starts).toEqual([0, 1.5, 2.5]);
    expect(samples).toHaveLength(24000 + 12000 + 12000 + 12000 + 6000);
    expect([samples[0], samples[23999], samples[24000], samples[35999], samples[36000], samples[47999], samples[48000], samples[60000], samples[65999]])
      .toEqual([1, 1, 0, 0, 2, 2, 0, 3, 3]);
  });

  it('leaves a short silence between sentences when no gap is given', () => {
    const { samples, starts } = mod.join(spoken([24000, 24000]));
    expect(mod.SENTENCE_GAP_SECONDS).toBe(0.3);
    expect(starts).toEqual([0, 1.3]);
    expect(samples).toHaveLength(48000 + 7200);
  });

  it('joins with no gap when asked, and leaves the sentences as they were', () => {
    const input = spoken([10, 10]);
    const { samples, starts } = mod.join(input, 0);
    expect(samples).toHaveLength(20);
    expect(starts).toEqual([0, 10 / 24000]);
    expect(input.sentences[0].samples).toHaveLength(10);
    expect(samples.buffer).not.toBe(input.sentences[0].samples.buffer);
  });

  it('gives an empty buffer for nothing spoken', () => {
    expect(mod.join(spoken([]))).toEqual({ samples: new Float32Array(0), starts: [] });
  });
});
