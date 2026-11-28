// The page's side of the built-in voice. `speak` cuts the text into sentences and has the worker speak them one by
// one, so progress is per sentence and a cancel never waits for more than the sentence in hand.
import { windowKey } from '../../io/window-key';
import { t } from '../../ui/i18n';
import { speechModels } from './models';
import { splitSentences } from './sentences';
import { SAMPLE_RATE, joinSamples } from './tokens';
import type { SpeakDone, SpeakJob } from './voice-worker';

export interface VoiceInfo { id: string; name: string; accent: 'us' | 'gb'; gender: 'f' | 'm' }
export interface SpokenSentence { text: string; samples: Float32Array; seconds: number }
/** `unknown`: words spelled out because no dictionary had them. */
export interface Spoken { sampleRate: 24000; sentences: SpokenSentence[]; unknown: string[] }
export interface SpeakOptions { voice: string; speed: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }

const IDS = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'] as const;

/** af_heart is Heart, a US female voice: the first letter is the accent (a US, b UK), the second the gender. */
function describe(id: string): VoiceInfo {
  const name = id.slice(id.indexOf('_') + 1);
  return { id, name: name.charAt(0).toUpperCase() + name.slice(1), accent: id.startsWith('a') ? 'us' : 'gb', gender: id.charAt(1) === 'f' ? 'f' : 'm' };
}

export const VOICES: readonly VoiceInfo[] = Object.freeze(IDS.map(describe));

/** The silence join() leaves between sentences when none is given. */
export const SENTENCE_GAP_SECONDS = 0.3;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
const NOT_INSTALLED = 'The built-in voice is not installed yet. Download it in the speech settings first.';

const aborted = (): DOMException => new DOMException('Speaking was cancelled', 'AbortError');

let worker: Worker | null = null;
let nextId = 1;
// one speak at a time: a cancel ends the worker, which must not take another call's sentence with it
let line: Promise<unknown> = Promise.resolve();

function drop(): void {
  worker?.terminate();
  worker = null;
}

function ensure(): Worker {
  if (worker) return worker;
  if (typeof Worker === 'undefined') throw new Error(t('The built-in voice could not start on this computer.'));
  try {
    worker = new Worker(new URL('./voice-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    throw new Error(t('The built-in voice could not start on this computer.'));
  }
  return worker;
}

/** One sentence through the worker. A cancel or a failure ends the worker, so nothing half done is left running. */
function sentence(job: Omit<SpeakJob, 'id'>, signal: AbortSignal | undefined): Promise<{ samples: Float32Array; unknown: string[] }> {
  return new Promise((resolve, reject) => {
    const w = ensure();
    const id = nextId++;
    const finish = (): void => {
      signal?.removeEventListener('abort', stop);
      w.removeEventListener('message', heard);
      w.removeEventListener('error', failed);
    };
    const stop = (): void => { finish(); drop(); reject(aborted()); };
    const failed = (e: ErrorEvent): void => { finish(); drop(); reject(new Error(e.message || t('The built-in voice stopped unexpectedly.'))); };
    const heard = (e: MessageEvent<SpeakDone>): void => {
      const m = e.data;
      if (m.id !== id) return;
      finish();
      if (m.ok) resolve({ samples: m.samples, unknown: m.unknown });
      else reject(new Error(m.missing ? t(NOT_INSTALLED) : m.error || t('The built-in voice failed.')));
    };
    signal?.addEventListener('abort', stop, { once: true });
    w.addEventListener('message', heard);
    w.addEventListener('error', failed);
    w.postMessage({ ...job, id } satisfies SpeakJob);
  });
}

async function installed(): Promise<void> {
  let sets: Awaited<ReturnType<typeof speechModels>>;
  try { sets = await speechModels(); } catch {
    throw new Error(t('The FormMorpheus engine did not answer, so the built-in voice cannot start.'));
  }
  if (!sets.voice.installed) throw new Error(t(NOT_INSTALLED));
}

async function run(text: string, info: VoiceInfo, opts: SpeakOptions): Promise<Spoken> {
  const { signal, onProgress } = opts;
  const parts = splitSentences(text);
  if (signal?.aborted) throw aborted();
  if (!parts.length) return { sampleRate: SAMPLE_RATE, sentences: [], unknown: [] };
  await installed();
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(opts.speed) ? opts.speed : 1));
  let sentences: SpokenSentence[] = [];
  let unknown: string[] = [];
  for (const part of parts) {
    if (signal?.aborted) { drop(); throw aborted(); }
    const got = await sentence({ text: part, voice: info.id, accent: info.accent, speed, key: windowKey() }, signal);
    sentences = [...sentences, { text: part, samples: got.samples, seconds: got.samples.length / SAMPLE_RATE }];
    unknown = [...unknown, ...got.unknown.filter((u) => !unknown.includes(u))];
    onProgress?.(sentences.length, parts.length);
  }
  return { sampleRate: SAMPLE_RATE, sentences, unknown };
}

/**
 * `text` spoken by the built-in voice, one buffer a sentence at 24000 Hz. Rejects with an AbortError when `signal`
 * aborts, and with a readable Error when the voice is unknown or its files are not installed.
 */
export function speak(text: string, opts: SpeakOptions): Promise<Spoken> {
  const info = VOICES.find((v) => v.id === opts.voice);
  if (!info) return Promise.reject(new Error(t('That voice is not one of the built-in voices.')));
  const turn = line.then(() => run(text, info, opts));
  line = turn.catch(() => undefined);
  return turn;
}

/** Every sentence in one buffer with a short silence between them; `starts[i]` is the second at which sentence i begins. */
export function join(spoken: Spoken, gapSeconds: number = SENTENCE_GAP_SECONDS): { samples: Float32Array; starts: number[] } {
  return joinSamples(spoken.sentences.map((s) => s.samples), gapSeconds);
}
