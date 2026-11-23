import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProxy, wantsProxy } from '@src/media/proxy';

type FakeRes = { ok: boolean; json: () => Promise<unknown>; blob: () => Promise<Blob> };

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<FakeRes>): ReturnType<typeof vi.fn> {
  const f = vi.fn(impl);
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('wantsProxy', () => {
  it('wants a proxy for a picture wider than 1280 on its long side', () => {
    expect(wantsProxy({ width: 1920, height: 1080 })).toBe(true);
    expect(wantsProxy({ width: 720, height: 1300 })).toBe(true);
  });

  it('does not want one at 1280 or below', () => {
    expect(wantsProxy({ width: 1280, height: 720 })).toBe(false);
    expect(wantsProxy({ width: 640, height: 480 })).toBe(false);
  });

  it('does not want one when the size is unknown', () => {
    expect(wantsProxy({})).toBe(false);
    expect(wantsProxy({ height: 1281 })).toBe(true);
  });
});

describe('makeProxy', () => {
  it('posts the video to the engine at the default height and returns the reply', async () => {
    const out = new Blob(['small']);
    const f = stubFetch(async () => ({ ok: true, json: async () => ({}), blob: async () => out }));
    const src = new Blob(['big']);
    await expect(makeProxy(src)).resolves.toBe(out);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/proxy/make?height=540');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(src);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
  });

  it('asks for the height it is given and passes the signal on', async () => {
    const f = stubFetch(async () => ({ ok: true, json: async () => ({}), blob: async () => new Blob([]) }));
    const ac = new AbortController();
    await makeProxy(new Blob(['x']), 720, ac.signal);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/proxy/make?height=720');
    expect(init.signal).toBe(ac.signal);
  });

  it('turns a network failure into an engine not running error', async () => {
    stubFetch(async () => { throw new TypeError('Failed to fetch'); });
    const err = await makeProxy(new Blob(['x'])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(/engine/i);
  });

  it('rethrows the abort error itself when the caller aborted', async () => {
    const ac = new AbortController();
    const abortErr = new DOMException('aborted', 'AbortError');
    stubFetch(async () => { ac.abort(); throw abortErr; });
    await expect(makeProxy(new Blob(['x']), 540, ac.signal)).rejects.toBe(abortErr);
  });

  it('uses the engine detail as the error message on a refusal', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({ detail: 'ffmpeg missing' }), blob: async () => new Blob([]) }));
    await expect(makeProxy(new Blob(['x']))).rejects.toThrow('ffmpeg missing');
  });

  it('keeps a default message when the refusal has no readable detail', async () => {
    stubFetch(async () => ({ ok: false, json: async () => { throw new SyntaxError('bad json'); }, blob: async () => new Blob([]) }));
    const a = await makeProxy(new Blob(['x'])).catch((e: unknown) => e as Error);
    stubFetch(async () => ({ ok: false, json: async () => ({ detail: { code: 7 } }), blob: async () => new Blob([]) }));
    const b = await makeProxy(new Blob(['x'])).catch((e: unknown) => e as Error);
    expect(a).toBeInstanceOf(Error);
    expect(a.message.length).toBeGreaterThan(0);
    expect(a.message).not.toMatch(/bad json/);
    expect(b.message).toBe(a.message);
  });
});
