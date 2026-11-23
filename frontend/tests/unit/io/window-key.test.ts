import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HEADER = 'X-Formmorpheus-Window-Key';
const STORE = 'formmorpheus-window-key';

interface Seen { url: string; method: string; key: string | null; headers: Headers }
type Answer = (seen: Seen) => Response | Error;

let seen: Seen[] = [];
let mod: typeof import('@src/io/window-key');

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const holder = (): { __FORMMORPHEUS_WINDOW_KEY?: unknown } => window as unknown as { __FORMMORPHEUS_WINDOW_KEY?: unknown };

function engine(answer: Answer): void {
  const native = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const s: Seen = { url, method: init?.method ?? 'GET', key: headers.get(HEADER), headers };
    seen.push(s);
    const r = answer(s);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  vi.stubGlobal('fetch', native);
  window.fetch = native as typeof window.fetch;
}

beforeEach(async () => {
  seen = [];
  sessionStorage.clear();
  delete holder().__FORMMORPHEUS_WINDOW_KEY;
  vi.resetModules();
  mod = await import('@src/io/window-key');
});

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('loadWindowKey', () => {
  it('takes the key the window was given, removes it from the page and asks the engine for nothing', async () => {
    engine(() => json({}));
    holder().__FORMMORPHEUS_WINDOW_KEY = 'given-key';
    await mod.loadWindowKey();
    expect(mod.windowKey()).toBe('given-key');
    expect('__FORMMORPHEUS_WINDOW_KEY' in window).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('asks the engine for a key when none was given, and remembers it for a reload', async () => {
    engine((s) => (s.url === '/api/window/key' && s.method === 'POST' ? json({ key: 'fresh' }) : json({}, 404)));
    await mod.loadWindowKey();
    expect(mod.windowKey()).toBe('fresh');
    expect(sessionStorage.getItem(STORE)).toBe('fresh');
  });

  it('reuses a remembered key the engine still accepts', async () => {
    sessionStorage.setItem(STORE, 'kept');
    engine((s) => (s.url === '/api/window/ticket' && s.key === 'kept' ? json({ ticket: 't' }) : json({ key: 'other' })));
    await mod.loadWindowKey();
    expect(mod.windowKey()).toBe('kept');
    expect(seen.map((s) => s.url)).toEqual(['/api/window/ticket']);
  });

  it('replaces a remembered key the engine no longer accepts', async () => {
    sessionStorage.setItem(STORE, 'stale');
    engine((s) => (s.url === '/api/window/ticket' ? json({}, 403) : json({ key: 'renewed' })));
    await mod.loadWindowKey();
    expect(mod.windowKey()).toBe('renewed');
    expect(sessionStorage.getItem(STORE)).toBe('renewed');
  });

  it('ignores a given key that is not a non-empty string', async () => {
    for (const bad of ['', 42, null, { key: 'x' }]) {
      vi.resetModules();
      const fresh = await import('@src/io/window-key');
      engine(() => json({}, 500));
      holder().__FORMMORPHEUS_WINDOW_KEY = bad;
      await fresh.loadWindowKey();
      expect(fresh.windowKey()).toBe('');
    }
  });

  it('ends without a key when the engine cannot be reached', async () => {
    engine(() => new Error('refused'));
    await mod.loadWindowKey();
    expect(mod.windowKey()).toBe('');
  });

  it('ignores an answer whose key is not a string', async () => {
    engine(() => json({ key: 12345 }));
    await mod.loadWindowKey();
    expect(mod.windowKey()).toBe('');
    expect(sessionStorage.getItem(STORE)).toBeNull();
  });
});

describe('requests after the key is loaded', () => {
  beforeEach(async () => {
    engine(() => json({ ticket: 'a b&c' }));
    holder().__FORMMORPHEUS_WINDOW_KEY = 'k1';
    await mod.loadWindowKey();
    seen = [];
  });

  it('carry the key to the engine on a relative path', async () => {
    await window.fetch('/api/library');
    expect(seen[0].key).toBe('k1');
  });

  it('carry the key on an absolute address of the same origin and on a Request', async () => {
    await window.fetch(`${location.origin}/api/library`);
    await window.fetch(new Request(`${location.origin}/api/trash`));
    expect(seen.map((s) => s.key)).toEqual(['k1', 'k1']);
  });

  it('never send the key to another origin', async () => {
    await window.fetch('https://elsewhere.example/api/library');
    await window.fetch(new URL('https://elsewhere.example/api/x'));
    expect(seen.map((s) => s.key)).toEqual([null, null]);
  });

  it('never send the key to a path outside the engine', async () => {
    await window.fetch('/assets/logo.png');
    await window.fetch('/apix/library');
    expect(seen.map((s) => s.key)).toEqual([null, null]);
  });

  it('keep the headers and the method the caller set', async () => {
    await window.fetch('/api/save', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } });
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].headers.get('Content-Type')).toBe('application/octet-stream');
    expect(seen[0].key).toBe('k1');
  });

  it('overwrite a key header the caller tried to set', async () => {
    await window.fetch('/api/save', { headers: { [HEADER]: 'forged' } });
    expect(seen[0].key).toBe('k1');
  });

  it('get a stream ticket with the key attached', async () => {
    expect(await mod.streamTicket()).toBe('a b&c');
    expect(seen[0]).toMatchObject({ url: '/api/window/ticket', method: 'POST', key: 'k1' });
  });

  it('build a socket address on this host with the ticket encoded', async () => {
    const url = await mod.socketUrl('/api/recovery/s1/live');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    expect(url).toBe(`${scheme}://${location.host}/api/recovery/s1/live?ticket=a%20b%26c`);
  });

  it('report the key as not taken without asking, since this window holds it', async () => {
    expect(await mod.keyTaken()).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe('a window without a key', () => {
  it('gets an empty ticket without asking the engine', async () => {
    engine(() => json({ ticket: 't' }));
    expect(await mod.streamTicket()).toBe('');
    expect(seen).toHaveLength(0);
  });

  it('builds a socket address with no ticket', async () => {
    engine(() => json({ ticket: 't' }));
    expect(await mod.socketUrl('/api/x')).toBe(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/x`);
  });

  it('learns that another window took the key only from an explicit true', async () => {
    engine(() => json({ claimed: true }));
    expect(await mod.keyTaken()).toBe(true);
    engine(() => json({ claimed: 'yes' }));
    expect(await mod.keyTaken()).toBe(false);
    engine(() => json({ claimed: true }, 500));
    expect(await mod.keyTaken()).toBe(false);
    engine(() => new Error('down'));
    expect(await mod.keyTaken()).toBe(false);
  });
});

describe('a ticket request that fails', () => {
  it('gives an empty ticket on a refusal, a bad body or a lost connection', async () => {
    let mode: 'refuse' | 'odd' | 'down' = 'refuse';
    engine(() => (mode === 'refuse' ? json({ ticket: 't' }, 401) : mode === 'odd' ? json({ ticket: 7 }) : new Error('down')));
    holder().__FORMMORPHEUS_WINDOW_KEY = 'k2';
    await mod.loadWindowKey();
    expect(await mod.streamTicket()).toBe('');
    mode = 'odd';
    expect(await mod.streamTicket()).toBe('');
    mode = 'down';
    expect(await mod.streamTicket()).toBe('');
  });
});
