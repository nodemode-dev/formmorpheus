import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListenReply } from '@src/media/speech/listen';
import { LISTEN_RATE, LOAD_SHARE, listenFraction, windowCount } from '@src/media/speech/listen-progress';

type Options = Record<string, unknown> & { streamer?: { put(x: unknown): void; end(): void } };
const heard: Options[] = [];
let answer: (options: Options) => Promise<unknown> = async () => ({ chunks: [] });

vi.mock('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url', () => ({ default: '/ort.mjs' }));
vi.mock('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url', () => ({ default: '/ort.wasm' }));
vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } } },
  pipeline: async () => (_audio: Float32Array, options: Options) => { heard.push(options); return answer(options); },
}));

const said: ListenReply[] = [];

async function run(samples: Float32Array, language?: string): Promise<void> {
  vi.resetModules();
  await import('@src/media/speech/listen-worker');
  const onmessage = (self as unknown as { onmessage: (e: { data: unknown }) => Promise<void> }).onmessage;
  await onmessage({ data: { samples, key: 'k', ...(language ? { language } : {}) } });
}

beforeEach(() => {
  heard.length = 0;
  said.length = 0;
  answer = async () => ({ chunks: [] });
  vi.stubGlobal('postMessage', (m: ListenReply) => { said.push(m); });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('the windows a sound is heard in', () => {
  it('is one for up to thirty seconds, then one more for each twenty seconds begun', () => {
    expect(windowCount(1)).toBe(1);
    expect(windowCount(30 * LISTEN_RATE)).toBe(1);
    expect(windowCount(30 * LISTEN_RATE + 1)).toBe(2);
    expect(windowCount(50 * LISTEN_RATE)).toBe(2);
    expect(windowCount(50 * LISTEN_RATE + 1)).toBe(3);
    expect(windowCount(600 * LISTEN_RATE)).toBe(30);
  });

  it('gives no figure for a sound heard in one step, and a moving one for a long sound', () => {
    expect(listenFraction(0, 1)).toBeNull();
    expect(listenFraction(1, 1)).toBe(1);
    expect(listenFraction(0, 4)).toBe(LOAD_SHARE);
    expect(listenFraction(2, 4)).toBeCloseTo(0.65);
    expect(listenFraction(4, 4)).toBe(1);
  });
});

describe('the speech to text worker', () => {
  it('hears the sound once, asking for phrase timings, and never for word timings', async () => {
    answer = async () => ({ chunks: [{ text: ' Hello there, how are you today?', timestamp: [0, 2] }] });
    await run(new Float32Array(LISTEN_RATE), 'fr');
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ return_timestamps: true, chunk_length_s: 30, language: 'fr' });
    expect(said[said.length - 1]).toEqual({ type: 'done', byWord: false, chunks: [{ text: ' Hello there, how are you today?', timestamp: [0, 2] }] });
  });

  it('hears silence once too', async () => {
    await run(new Float32Array(LISTEN_RATE));
    expect(heard).toHaveLength(1);
    expect(said[said.length - 1]).toEqual({ type: 'done', byWord: false, chunks: [] });
  });

  it('reports no figure while a short sound is heard', async () => {
    await run(new Float32Array(5 * LISTEN_RATE));
    expect(said.filter((m) => m.type === 'progress')).toEqual([{ type: 'progress', fraction: null }]);
  });

  it('moves the figure forward as each window of a long sound is heard', async () => {
    answer = async (options) => { for (let i = 0; i < 3; i++) options.streamer?.end(); return { chunks: [] }; };
    await run(new Float32Array(70 * LISTEN_RATE));
    const fractions = said.filter((m) => m.type === 'progress').map((m) => (m as { fraction: number }).fraction);
    expect(fractions).toHaveLength(3);
    expect(fractions[0]).toBe(LOAD_SHARE);
    expect(fractions[1]).toBeCloseTo(LOAD_SHARE + (1 - LOAD_SHARE) / 3);
    expect(fractions[2]).toBeCloseTo(LOAD_SHARE + ((1 - LOAD_SHARE) * 2) / 3);
  });

  it('passes on what went wrong', async () => {
    answer = async () => { throw new Error('The model file is damaged.'); };
    await run(new Float32Array(LISTEN_RATE));
    expect(said[said.length - 1]).toEqual({ type: 'error', message: 'The model file is damaged.' });
  });
});
