// Worker side of the built-in voice: holds the speech model and speaks one sentence a message, so the page stays
// live and can report progress or stop between sentences. The model, dictionaries and voices are read once.
import * as ort from 'onnxruntime-web/wasm';
import ortRuntime from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortBinary from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { fileUrl } from './paths';
import { toPhonemes } from './phonemes';
import type { PhonemeDict } from './phonemes';
import { STYLE_WIDTH, chunkPhonemes, styleFor, tokenIds } from './tokens';
import type { Vocab } from './tokens';

export interface SpeakJob { id: number; text: string; voice: string; accent: 'us' | 'gb'; speed: number; key: string }
export type SpeakDone =
  | { id: number; ok: true; samples: Float32Array; unknown: string[] }
  | { id: number; ok: false; missing: boolean; error: string };

// The engine answers only to the window's key, and a worker's fetch is not the page's patched one.
const KEY_HEADER = 'X-Formmorpheus-Window-Key';

class MissingFile extends Error {}

const ctx = self as unknown as { postMessage(m: SpeakDone, t?: Transferable[]): void; onmessage: ((e: MessageEvent<SpeakJob>) => void) | null };

ort.env.wasm.wasmPaths = { mjs: ortRuntime, wasm: ortBinary };
// more threads need a cross-origin isolated page, which this one is not
ort.env.wasm.numThreads = 1;

let key = '';
let core: Promise<{ session: ort.InferenceSession; vocab: Vocab }> | null = null;
const dicts = new Map<string, Promise<PhonemeDict>>();
const voices = new Map<string, Promise<Float32Array>>();

async function read(path: string): Promise<Response> {
  const res = await fetch(fileUrl('voice', path), key ? { headers: { [KEY_HEADER]: key } } : undefined);
  if (res.status === 404) throw new MissingFile(path);
  if (!res.ok) throw new Error(`The engine could not give ${path} (${res.status}).`);
  return res;
}

/** A failed load is forgotten, so the next sentence tries again instead of failing for good. */
function once<T>(cache: Map<string, Promise<T>>, name: string, load: () => Promise<T>): Promise<T> {
  const kept = cache.get(name);
  if (kept) return kept;
  const made = load();
  cache.set(name, made);
  made.catch(() => { if (cache.get(name) === made) cache.delete(name); });
  return made;
}

function loadCore(): Promise<{ session: ort.InferenceSession; vocab: Vocab }> {
  if (core) return core;
  const made = (async () => {
    const [model, tokenizer] = await Promise.all([read('model.onnx'), read('tokenizer.json')]);
    const vocab = ((await tokenizer.json()) as { model?: { vocab?: Vocab } }).model?.vocab;
    if (!vocab) throw new Error('The speech model has no list of sounds.');
    const session = await ort.InferenceSession.create(new Uint8Array(await model.arrayBuffer()), { executionProviders: ['wasm'] });
    return { session, vocab };
  })();
  core = made;
  made.catch(() => { if (core === made) core = null; });
  return made;
}

const loadDict = (accent: 'us' | 'gb'): Promise<PhonemeDict> => once(dicts, accent, async () => {
  const [gold, silver] = await Promise.all([read(`dict/${accent}_gold.json`), read(`dict/${accent}_silver.json`)]);
  return { gold: (await gold.json()) as Record<string, unknown>, silver: (await silver.json()) as Record<string, unknown> };
});

const loadVoice = (id: string): Promise<Float32Array> => once(voices, id, async () => {
  const bytes = await (await read(`voices/${id}.bin`)).arrayBuffer();
  return new Float32Array(bytes, 0, Math.floor(bytes.byteLength / 4));
});

async function speakOne(job: SpeakJob): Promise<{ samples: Float32Array; unknown: string[] }> {
  key = job.key;
  const [{ session, vocab }, dict, voice] = await Promise.all([loadCore(), loadDict(job.accent), loadVoice(job.voice)]);
  const { phonemes, unknown } = toPhonemes(job.text, dict);
  const parts: Float32Array[] = [];
  for (const chunk of chunkPhonemes(phonemes)) {
    const ids = tokenIds(chunk, vocab);
    if (ids.length <= 2) continue;
    const out = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      style: new ort.Tensor('float32', styleFor(voice, ids.length - 2), [1, STYLE_WIDTH]),
      speed: new ort.Tensor('float32', new Float32Array([job.speed]), [1]),
    });
    parts.push(Float32Array.from(out[session.outputNames[0]].data as Float32Array));
  }
  const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { samples.set(p, at); at += p.length; }
  return { samples, unknown };
}

// one sentence at a time: the model's session is not reentrant
let line: Promise<void> = Promise.resolve();

ctx.onmessage = (e: MessageEvent<SpeakJob>): void => {
  const job = e.data;
  line = line.then(async () => {
    try {
      const { samples, unknown } = await speakOne(job);
      ctx.postMessage({ id: job.id, ok: true, samples, unknown }, [samples.buffer as ArrayBuffer]);
    } catch (err) {
      ctx.postMessage({ id: job.id, ok: false, missing: err instanceof MissingFile, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
