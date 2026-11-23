import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Call { url: string; init: RequestInit | undefined; resolve: (r: Response) => void; reject: (e: Error) => void }

let calls: Call[] = [];
let shown: (els: Element[], on: boolean) => void = () => undefined;
let unobserved: Element[] = [];
let lowFetch: typeof import('@src/io/thumb-queue').lowFetch;

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const urls = (): string[] => calls.map((c) => c.url);
const cell = (): Element => document.createElement('div');

beforeEach(async () => {
  calls = [];
  unobserved = [];
  vi.resetModules();
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => { calls.push({ url, init, resolve, reject }); }));
  class Watcher {
    constructor(private readonly cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
      shown = (els, on) => this.cb(els.map((target) => ({ isIntersecting: on, target })));
    }
    observe(): void { return; }
    unobserve(el: Element): void { unobserved.push(el); }
    disconnect(): void { return; }
  }
  vi.stubGlobal('IntersectionObserver', Watcher);
  ({ lowFetch } = await import('@src/io/thumb-queue'));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('lowFetch', () => {
  it('asks for the lowest network priority', () => {
    void lowFetch('/api/poster/1');
    expect(calls).toHaveLength(1);
    expect((calls[0].init as { priority?: string }).priority).toBe('low');
  });

  it('runs at most two requests at a time and starts the next when one ends', async () => {
    for (const u of ['/a', '/b', '/c', '/d']) void lowFetch(u);
    expect(urls()).toEqual(['/a', '/b']);
    calls[0].resolve(new Response('x'));
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/c']);
    calls[1].resolve(new Response('x'));
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('resolves each caller with the response of its own request', async () => {
    const a = lowFetch('/a');
    const b = lowFetch('/b');
    calls[1].resolve(new Response('second'));
    calls[0].resolve(new Response('first'));
    expect(await (await a).text()).toBe('first');
    expect(await (await b).text()).toBe('second');
  });

  it('passes a failure to its caller and still frees the slot', async () => {
    const a = lowFetch('/a');
    void lowFetch('/b');
    void lowFetch('/c');
    calls[0].reject(new Error('offline'));
    await expect(a).rejects.toThrow('offline');
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/c']);
  });

  it('lets an urgent request jump ahead of everything waiting', async () => {
    void lowFetch('/a');
    void lowFetch('/b');
    void lowFetch('/c');
    void lowFetch('/urgent', { urgent: true });
    calls[0].resolve(new Response('x'));
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/urgent']);
  });

  it('serves cells on screen before cells off screen, in asking order', async () => {
    const off = cell();
    const on1 = cell();
    const on2 = cell();
    void lowFetch('/a');
    void lowFetch('/b');
    void lowFetch('/off', { el: off });
    void lowFetch('/on1', { el: on1 });
    void lowFetch('/on2', { el: on2 });
    shown([on1, on2], true);
    calls[0].resolve(new Response('x'));
    await flush();
    calls[1].resolve(new Response('x'));
    await flush();
    calls[2].resolve(new Response('x'));
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/on1', '/on2', '/off']);
  });

  it('moves a cell back in the line when it scrolls off screen', async () => {
    const first = cell();
    const second = cell();
    void lowFetch('/a');
    void lowFetch('/b');
    void lowFetch('/first', { el: first });
    void lowFetch('/second', { el: second });
    shown([first, second], true);
    shown([first], false);
    calls[0].resolve(new Response('x'));
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/second']);
  });

  it('stops watching a cell once its request starts', async () => {
    const el = cell();
    void lowFetch('/a', { el });
    expect(urls()).toEqual(['/a']);
    expect(unobserved).toEqual([el]);
  });

  it('treats every cell as on screen when the page cannot watch visibility', async () => {
    vi.resetModules();
    vi.stubGlobal('IntersectionObserver', undefined);
    const fresh = (await import('@src/io/thumb-queue')).lowFetch;
    void fresh('/a');
    void fresh('/b');
    void fresh('/plain');
    void fresh('/cell', { el: cell() });
    calls[0].resolve(new Response('x'));
    await flush();
    calls[1].resolve(new Response('x'));
    await flush();
    expect(urls()).toEqual(['/a', '/b', '/plain', '/cell']);
  });
});
