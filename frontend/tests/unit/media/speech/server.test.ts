import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_DEFAULTS, checkServer, speakOnServer } from '@src/media/speech/server';
import type { ServerSettings } from '@src/media/speech/server';

interface Seen { url: string; method: string; body: unknown; type: string | null; signal: AbortSignal | null }
let seen: Seen[] = [];

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settings: ServerSettings = { url: 'http://127.0.0.1:8080', model: 'voice-1', voice: 'mine', speed: 1.25 };

function engine(answer: (s: Seen) => Response | Error): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const s: Seen = {
      url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      type: new Headers(init?.headers).get('Content-Type'), signal: init?.signal ?? null,
    };
    seen.push(s);
    const r = answer(s);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
}

beforeEach(() => { seen = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('SERVER_DEFAULTS', () => {
  it('points at this computer and names no model or voice', () => {
    expect(SERVER_DEFAULTS).toEqual({ url: 'http://127.0.0.1:8080', model: '', voice: '', speed: 1 });
  });
});

describe('checkServer', () => {
  it('asks the engine to look, sending the address as JSON', async () => {
    engine(() => json({ ok: true, models: ['a', 'b'], error: '' }));
    expect(await checkServer('http://localhost:8080')).toEqual({ ok: true, models: ['a', 'b'], error: '' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: '/api/speech-server/check', method: 'POST', body: { url: 'http://localhost:8080' }, type: 'application/json' });
  });

  it('passes on the reason the server did not answer', async () => {
    engine(() => json({ ok: false, models: [], error: 'Nothing is listening there.' }));
    expect(await checkServer('http://127.0.0.1:9')).toEqual({ ok: false, models: [], error: 'Nothing is listening there.' });
  });

  it('keeps only model names that are text, and reads a loose answer safely', async () => {
    engine(() => json({ ok: 'yes', models: ['a', 3, null, 'b'] }));
    expect(await checkServer('http://127.0.0.1:8080')).toEqual({ ok: false, models: ['a', 'b'], error: '' });
    engine(() => json({ ok: true, models: 'a' }));
    expect(await checkServer('http://127.0.0.1:8080')).toEqual({ ok: true, models: [], error: '' });
  });

  it('turns a refusal into a result with the engine sentence', async () => {
    engine(() => json({ detail: 'The speech server must be on this computer.' }, 400));
    expect(await checkServer('http://example.com')).toEqual({ ok: false, models: [], error: 'The speech server must be on this computer.' });
  });

  it('does not reject when the engine is not running', async () => {
    engine(() => new TypeError('Failed to fetch'));
    expect(await checkServer('http://127.0.0.1:8080')).toEqual({ ok: false, models: [], error: 'The engine is not running.' });
  });
});

describe('speakOnServer', () => {
  it('sends the text and settings and returns the sound with its content type', async () => {
    engine(() => new Response(Uint8Array.from([82, 73, 70, 70, 1, 2]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
    const blob = await speakOnServer('Hello there.', settings);
    expect(seen[0]).toMatchObject({
      url: '/api/speech-server/speak', method: 'POST', type: 'application/json',
      body: { url: 'http://127.0.0.1:8080', model: 'voice-1', voice: 'mine', input: 'Hello there.', speed: 1.25 },
    });
    expect(Object.keys(seen[0].body as object).sort()).toEqual(['input', 'model', 'speed', 'url', 'voice']);
    expect(blob.type).toBe('audio/mpeg');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([82, 73, 70, 70, 1, 2]);
  });

  it('rejects with the message the engine relayed from the server', async () => {
    engine(() => json({ detail: 'The speech server said: model not found' }, 502));
    await expect(speakOnServer('Hi.', settings)).rejects.toMatchObject({ message: 'The speech server said: model not found', status: 502 });
  });

  it('rejects readably on a timeout with no detail', async () => {
    engine(() => new Response('', { status: 504, statusText: 'Gateway Timeout' }));
    await expect(speakOnServer('Hi.', settings)).rejects.toThrow('Gateway Timeout');
  });

  it('hands the signal to the request and lets an abort through as an abort', async () => {
    const stop = new AbortController();
    engine(() => new DOMException('Aborted', 'AbortError'));
    const err = await speakOnServer('Hi.', settings, stop.signal).catch((e: unknown) => e);
    expect(seen[0].signal).toBe(stop.signal);
    expect((err as Error).name).toBe('AbortError');
  });

  it('says the engine is not running when nothing answers', async () => {
    engine(() => new TypeError('Failed to fetch'));
    await expect(speakOnServer('Hi.', settings)).rejects.toThrow('The engine is not running.');
  });
});
