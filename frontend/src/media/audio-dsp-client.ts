// The page's side of the audio effect Worker. `runFx` hands planar channels to the worker (copied, so the caller's
// arrays stay valid) and resolves with the processed copy; a newer request with the same tag supersedes an older
// one that has not been sent yet (a slider drag asks for many settings, only the last is computed). Without Workers,
// or if the worker fails, the same applyFx runs inline, so the result never differs.
import { applyFx } from './audio-dsp';
import type { AudioFx } from '../engine/audio-fx';
import type { FxDone, FxJob } from './audio-dsp-worker';

const DEBOUNCE_MS = 120;
const IDLE_MS = 15000;

let worker: Worker | null = null;
let broken = false;
let idle = 0;
let nextId = 1;
const waiting = new Map<number, (c: Float32Array[] | null) => void>();
const lastAt = new Map<string, number>();
const queued = new Map<string, { timer: number; resolve: (c: Float32Array[] | null) => void }>();

function ensure(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./audio-dsp-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FxDone>): void => {
      const r = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      r?.(e.data.chs);
      touch();
    };
    w.onerror = (): void => {
      broken = true;
      worker = null;
      w.terminate();
      for (const r of waiting.values()) r(null);
      waiting.clear();
    };
    worker = w;
  } catch { broken = true; }
  return worker;
}

/** The worker is released a while after its last job so an idle page holds no thread. */
function touch(): void {
  if (idle) clearTimeout(idle);
  idle = window.setTimeout(() => {
    idle = 0;
    if (!waiting.size && !queued.size) { worker?.terminate(); worker = null; }
    else touch();
  }, IDLE_MS);
}

function send(chs: Float32Array[], sr: number, fx: AudioFx): Promise<Float32Array[]> {
  const w = ensure();
  if (!w) return Promise.resolve(applyFx(chs, sr, fx));
  const id = nextId++;
  const copy = chs.map((c) => Float32Array.from(c));
  return new Promise((resolve) => {
    waiting.set(id, (out) => resolve(out ?? applyFx(chs, sr, fx)));
    const job: FxJob = { id, chs: copy, sr, fx };
    w.postMessage(job, copy.map((c) => c.buffer as ArrayBuffer));
    touch();
  });
}

/**
 * Runs the effect chain. With a `tag`, the request waits DEBOUNCE_MS and an older waiting request of that tag
 * resolves null (superseded); the caller then drops its result.
 */
export function runFx(chs: Float32Array[], sr: number, fx: AudioFx, tag?: string): Promise<Float32Array[] | null> {
  if (!tag) return send(chs, sr, fx);
  const old = queued.get(tag);
  if (old) { clearTimeout(old.timer); old.resolve(null); }
  // a first request goes at once; a request that follows another of its tag within a second waits for the drag to settle
  const now = performance.now();
  const recent = old !== undefined || now - (lastAt.get(tag) ?? -1e9) < 1000;
  lastAt.set(tag, now);
  if (lastAt.size > 256) lastAt.clear();
  if (!recent) return send(chs, sr, fx);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      queued.delete(tag);
      void send(chs, sr, fx).then(resolve);
    }, DEBOUNCE_MS);
    queued.set(tag, { timer, resolve });
  });
}
