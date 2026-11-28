import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@src/io/api';
import { cancelSet, downloadSet, fileUrl, removeSet, speechModels } from '@src/media/speech/models';
import type { SetState } from '@src/media/speech/models';

interface Seen { url: string; method: string; body: unknown }
let seen: Seen[] = [];

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const state = (installed: boolean): SetState => ({ installed, bytes: 1000, files: 34, licence: 'Apache-2.0', task: { state: 'idle', done: 0, total: 0, error: '' } });
const sets = { voice: state(true), listen: state(false) };

function engine(answer: (s: Seen) => Response | Error): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const s: Seen = { url: String(input), method: init?.method ?? 'GET', body: init?.body };
    seen.push(s);
    const r = answer(s);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
}

beforeEach(() => { seen = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('speech model sets', () => {
  it('reads the state of both sets', async () => {
    engine(() => json({ sets }));
    expect(await speechModels()).toEqual(sets);
    expect(seen).toEqual([{ url: '/api/speech-models', method: 'GET', body: undefined }]);
  });

  it('starts a download, cancels it and removes a set with the right method and address', async () => {
    engine(() => json({ sets }));
    expect(await downloadSet('voice')).toEqual(sets);
    expect(await cancelSet('voice')).toEqual(sets);
    expect(await removeSet('listen')).toEqual(sets);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /api/speech-models/voice/download',
      'POST /api/speech-models/voice/cancel',
      'DELETE /api/speech-models/listen',
    ]);
  });

  it('fails with the sentence and status the engine gave', async () => {
    engine(() => json({ detail: 'A download is already running.' }, 409));
    const err = await downloadSet('voice').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('A download is already running.');
    expect((err as ApiError).status).toBe(409);
  });

  it('fails readably when the error is not JSON', async () => {
    engine(() => new Response('<html>', { status: 500, statusText: 'Boom' }));
    await expect(speechModels()).rejects.toMatchObject({ message: 'Boom', status: 500 });
  });

  it('says the engine is not running when nothing answers', async () => {
    engine(() => new TypeError('Failed to fetch'));
    await expect(removeSet('voice')).rejects.toMatchObject({ message: 'The engine is not running.', status: 0 });
  });

  it('refuses an answer without both sets', async () => {
    for (const body of [{}, { sets: { voice: state(true) } }, 'nonsense']) {
      engine(() => json(body));
      await expect(speechModels()).rejects.toBeInstanceOf(ApiError);
    }
  });
});

describe('fileUrl', () => {
  it('is the engine address of one file of a set', () => {
    expect(fileUrl('voice', 'model.onnx')).toBe('/api/speech-models/voice/file/model.onnx');
    expect(fileUrl('voice', 'voices/af_heart.bin')).toBe('/api/speech-models/voice/file/voices/af_heart.bin');
    expect(fileUrl('listen', 'onnx/encoder_model_quantized.onnx')).toBe('/api/speech-models/listen/file/onnx/encoder_model_quantized.onnx');
  });

  it('escapes each part of the path and keeps the slashes', () => {
    expect(fileUrl('voice', 'a b/c#d?e')).toBe('/api/speech-models/voice/file/a%20b/c%23d%3Fe');
  });
});
