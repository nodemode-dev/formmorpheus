// Speech to text Worker: one job, then the page ends it. The speech model's files come from the engine only
// (/api/speech-models/listen/file/<path>), never from the internet and never from a browser cache; the wasm
// backend runs the quantized files, the only ones the engine pins.
import { env, pipeline } from '@huggingface/transformers';
import ortRuntime from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortBinary from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { HeardChunk, ListenJob, ListenReply } from './listen';
import { LOAD_SHARE, WINDOW_SECONDS, listenFraction, windowCount } from './listen-progress';

const KEY_HEADER = 'X-Formmorpheus-Window-Key';
/** Host, template and id join to /api/speech-models/listen/file/<path>. */
const MODEL_ID = 'listen';

let key = '';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
// with its cache on, the library imports the runtime from a blob: address, which the page policy refuses; off, the
// runtime is imported from the engine's own address below
env.useWasmCache = false;
env.remoteHost = `${self.location.origin}/api/speech-models/`;
env.remotePathTemplate = '{model}/file/';
// a Worker's fetch is not the page's: the engine's window key has to be put on each request here
env.fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  if (key && new URL(String(input), self.location.href).origin === self.location.origin) headers.set(KEY_HEADER, key);
  return fetch(input, { ...init, headers });
};
const wasmFlags = env.backends.onnx?.wasm;
if (wasmFlags) wasmFlags.wasmPaths = { mjs: ortRuntime, wasm: ortBinary };

type Heard = { text?: string; chunks?: HeardChunk[] };
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<Heard>;

const say = (m: ListenReply): void => self.postMessage(m);

async function load(): Promise<Transcriber> {
  const sizes = new Map<string, [number, number]>();
  let shown = 0;
  return (await pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }): void => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      sizes.set(p.file, [p.loaded ?? 0, p.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of sizes.values()) { loaded += l; total += t; }
      // a file that joins late would pull the share back: the bar only ever moves forward
      shown = Math.max(shown, total ? (loaded / total) * LOAD_SHARE : 0);
      say({ type: 'progress', fraction: shown });
    },
  })) as unknown as Transcriber;
}

async function hear(job: ListenJob): Promise<{ chunks: HeardChunk[]; byWord: boolean }> {
  const transcriber = await load();
  const total = windowCount(job.samples.length);
  let done = 0;
  say({ type: 'progress', fraction: listenFraction(0, total) });
  // The pinned files time phrases, not words (their decoder gives no cross-attention), so phrases are asked for
  // outright. The library says nothing while it hears a window; it ends this streamer once after each one.
  const out = await transcriber(job.samples, {
    chunk_length_s: WINDOW_SECONDS, return_timestamps: true, ...(job.language ? { language: job.language } : {}),
    streamer: { put: (): void => undefined, end: (): void => { done++; if (done < total) say({ type: 'progress', fraction: listenFraction(done, total) }); } },
  });
  return { chunks: out.chunks ?? [], byWord: false };
}

self.onmessage = async (e: MessageEvent<ListenJob>): Promise<void> => {
  key = e.data.key;
  try {
    const { chunks, byWord } = await hear(e.data);
    say({ type: 'done', chunks, byWord });
  } catch (err) {
    say({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
