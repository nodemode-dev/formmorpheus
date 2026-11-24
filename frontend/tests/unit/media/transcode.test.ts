import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ready: true,
  features: { soundConvert: true, pictureConvert: true },
}));

vi.mock('mediabunny', () => ({ ALL_FORMATS: [], BlobSource: class {}, CanvasSink: class {}, Input: class {} }));
vi.mock('@src/io/api', () => ({ serviceReady: async (): Promise<boolean> => h.ready }));
vi.mock('@src/platform', () => ({ platform: { features: h.features } }));
vi.mock('@src/ui/i18n', () => ({ t: (s: string): string => s }));

import { transcodeViaEngine } from '@src/media/transcode';

interface Fake { ok: boolean; status: number; json: () => Promise<unknown>; blob: () => Promise<Blob> }

const reply = (body: unknown, ok = true, status = 200): Fake => ({
  ok, status,
  json: async () => { if (body === undefined) throw new Error('not json'); return body; },
  blob: async () => new Blob(['converted']),
});

const job = (state: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'j1', state, progress: 0, error: '', mime: 'video/mp4', alpha: false, ...extra });

let calls: Array<{ url: string; init?: RequestInit }>;

function route(handler: (url: string, init?: RequestInit) => Fake | Promise<Fake>): void {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init); }));
}

const file = (): File => new File(['raw bytes'], 'my clip#1.mov');

beforeEach(() => {
  h.ready = true;
  h.features.soundConvert = true;
  h.features.pictureConvert = true;
  vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0; }) as unknown as typeof window.setTimeout);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transcodeViaEngine', () => {
  it('refuses sound when this device cannot convert sound, without calling the engine', async () => {
    h.features.soundConvert = false;
    route(() => reply(job('done')));
    await expect(transcodeViaEngine(file(), 'audio')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('refuses pictures when this device cannot convert pictures, without calling the engine', async () => {
    h.features.pictureConvert = false;
    route(() => reply(job('done')));
    await expect(transcodeViaEngine(file(), 'image')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('reports the engine as down when the service is not ready', async () => {
    h.ready = false;
    route(() => reply(job('done')));
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow(/not running/);
    expect(calls).toHaveLength(0);
  });

  it('reports the engine as down when the upload cannot be sent', async () => {
    route(() => { throw new TypeError('network'); });
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow(/not running/);
  });

  it('uploads the file with its kind and encoded name and returns the converted result', async () => {
    route((url) => (url.endsWith('/result') ? reply(undefined) : reply(job('done', { mime: 'video/webm', alpha: true }))));
    const progress: number[] = [];
    const f = file();
    const out = await transcodeViaEngine(f, 'video', (p) => progress.push(p));
    expect(calls[0].url).toBe(`/api/transcode?kind=video&name=${encodeURIComponent('my clip#1.mov')}`);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe(f);
    expect(calls.some((c) => c.url === '/api/transcode/j1/result')).toBe(true);
    expect(out.mime).toBe('video/webm');
    expect(out.alpha).toBe(true);
    expect(await out.blob.text()).toBe('converted');
    expect(progress).toEqual([1]);
  });

  it('deletes the engine copy after a successful conversion', async () => {
    route(() => reply(job('done')));
    await transcodeViaEngine(file(), 'video');
    expect(calls.some((c) => c.url === '/api/transcode/j1' && c.init?.method === 'DELETE')).toBe(true);
  });

  it('uses the engine detail when the upload is refused', async () => {
    route(() => reply({ detail: 'codec unknown' }, false, 415));
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow('codec unknown');
  });

  it('falls back to the file name and status when the refusal is not JSON', async () => {
    route(() => reply(undefined, false, 500));
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow(/my clip#1\.mov.*500/);
  });

  it('polls a running job and reports its progress until it is done', async () => {
    const states = [job('running', { progress: 0.25 }), job('running', { progress: 0.5 }), job('done')];
    let polls = 0;
    route((url, init) => {
      if (url.startsWith('/api/transcode?')) return reply(states[0]);
      if (url.endsWith('/result')) return reply(undefined);
      if (init?.method === 'DELETE') return reply({});
      polls++;
      return reply(states[polls]);
    });
    const progress: number[] = [];
    await transcodeViaEngine(file(), 'video', (p) => progress.push(p));
    expect(progress).toEqual([0.25, 0.5, 1]);
    expect(polls).toBe(2);
  });

  it('rejects with the job error when the conversion fails and still deletes the engine copy', async () => {
    route(() => reply(job('error', { error: 'ffmpeg gave up' })));
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow('ffmpeg gave up');
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/result'))).toBe(false);
  });

  it('reports the engine as down when a poll fails', async () => {
    route((url) => (url.startsWith('/api/transcode?') ? reply(job('running')) : reply(undefined, false, 502)));
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow(/not running/);
  });

  it('stops polling and cancels the job once the signal is aborted', async () => {
    const ac = new AbortController();
    route((url) => (url.startsWith('/api/transcode?') ? reply(job('running')) : reply({})));
    ac.abort();
    await expect(transcodeViaEngine(file(), 'video', undefined, ac.signal)).rejects.toThrow(/cancelled/);
    expect(calls.some((c) => c.url === '/api/transcode/j1' && c.init?.method === 'DELETE')).toBe(true);
  });

  it('rejects with the engine detail when the result cannot be fetched', async () => {
    route((url) => (url.endsWith('/result') ? reply({ detail: 'result expired' }, false, 410) : reply(job('done'))));
    await expect(transcodeViaEngine(file(), 'video')).rejects.toThrow('result expired');
  });
});
