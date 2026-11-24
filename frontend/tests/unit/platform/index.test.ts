import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform } from '@src/platform/types';

interface Host { __FM_PLATFORM__?: unknown; __fmNative?: unknown; webkit?: unknown }

const host = window as unknown as Host;
let realFetch: typeof window.fetch;

async function load(raw: unknown): Promise<Platform> {
  if (raw === undefined) delete host.__FM_PLATFORM__;
  else host.__FM_PLATFORM__ = raw;
  vi.resetModules();
  return (await import('@src/platform/index')).platform;
}

beforeEach(() => {
  realFetch = window.fetch;
  document.documentElement.classList.remove('is-ipad');
});

afterEach(() => {
  window.fetch = realFetch;
  delete host.__FM_PLATFORM__;
  delete host.__fmNative;
  delete host.webkit;
  document.documentElement.classList.remove('is-ipad');
});

describe('platform detection', () => {
  it('runs as the desktop when the shell set nothing', async () => {
    const p = await load(undefined);
    expect(p.kind).toBe('desktop');
    expect(p.info).toEqual({ kind: 'desktop', appVersion: '', build: '', os: '' });
    expect(document.documentElement.classList.contains('is-ipad')).toBe(false);
    expect(p.features.folderPicker).toBe(true);
  });

  it('runs as the desktop for an unknown kind', async () => {
    const p = await load({ kind: 'android', appVersion: 'x' });
    expect(p.kind).toBe('desktop');
    expect(p.info.kind).toBe('desktop');
    expect(p.info.appVersion).toBe('x');
  });

  it('drops info fields that are not strings', async () => {
    const p = await load({ kind: 'desktop', appVersion: 3, build: null, os: { name: 'x' } });
    expect(p.info).toEqual({ kind: 'desktop', appVersion: '', build: '', os: '' });
  });

  it('runs as the iPad when the shell says so and marks the document', async () => {
    const p = await load({ kind: 'ipad', appVersion: 'a', build: 'b', os: 'iPadOS' });
    expect(p.kind).toBe('ipad');
    expect(p.info).toEqual({ kind: 'ipad', appVersion: 'a', build: 'b', os: 'iPadOS' });
    expect(document.documentElement.classList.contains('is-ipad')).toBe(true);
    expect(p.features.folderPicker).toBe(false);
  });

  it('on the iPad sends blob request bodies to fetch as array buffers', async () => {
    const seen: Array<RequestInit | undefined> = [];
    window.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { seen.push(init); return new Response('ok'); }) as typeof window.fetch;
    await load({ kind: 'ipad' });
    await window.fetch('/api/files/write', { method: 'POST', body: new Blob(['abcd']), headers: { 'x-k': '1' } });
    await window.fetch('/api/ping', { method: 'POST', body: 'text body' });
    await window.fetch('/api/none');
    expect(seen[0]?.body).toBeInstanceOf(ArrayBuffer);
    expect((seen[0]?.body as ArrayBuffer).byteLength).toBe(4);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.headers).toEqual({ 'x-k': '1' });
    expect(seen[1]?.body).toBe('text body');
    expect(seen[2]).toBeUndefined();
  });

  it('leaves fetch alone on the desktop', async () => {
    const mine = vi.fn() as unknown as typeof window.fetch;
    window.fetch = mine;
    await load(undefined);
    expect(window.fetch).toBe(mine);
  });
});
