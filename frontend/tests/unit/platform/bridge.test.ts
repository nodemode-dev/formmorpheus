import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bridge, BridgePayload } from '@src/platform/types';

type Receive = (json: unknown, extra?: unknown) => void;
interface Host { __fmNative?: { receive?: Receive }; webkit?: unknown }

const host = window as unknown as Host;

async function freshBridge(listening: boolean): Promise<Bridge> {
  vi.resetModules();
  const mod = await import('@src/platform/bridge');
  return mod.createBridge(listening);
}

function installShell(): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn();
  host.webkit = { messageHandlers: { fm: { postMessage } } };
  return postMessage;
}

const send = (json: unknown, extra?: unknown): void => { host.__fmNative?.receive?.(json, extra); };

beforeEach(() => {
  delete host.__fmNative;
  delete host.webkit;
});

afterEach(() => {
  vi.useRealTimers();
  delete host.__fmNative;
  delete host.webkit;
});

describe('createBridge posting', () => {
  it('posts the type and payload to the shell when listening', async () => {
    const postMessage = installShell();
    const bridge = await freshBridge(true);
    expect(bridge.available).toBe(true);
    expect(bridge.post('haptic', { kind: 'tap' })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'haptic', payload: { kind: 'tap' } });
  });

  it('sends an empty payload when none is given', async () => {
    const postMessage = installShell();
    const bridge = await freshBridge(true);
    bridge.post('ready');
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready', payload: {} });
  });

  it('drops messages when not listening even if a shell exists', async () => {
    const postMessage = installShell();
    const bridge = await freshBridge(false);
    expect(bridge.available).toBe(false);
    expect(bridge.post('ready')).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('reports no shell when the message handler is missing', async () => {
    const bridge = await freshBridge(true);
    expect(bridge.available).toBe(false);
    expect(bridge.post('ready')).toBe(false);
  });

  it('returns false when the shell throws on post', async () => {
    host.webkit = { messageHandlers: { fm: { postMessage: () => { throw new Error('gone'); } } } };
    const bridge = await freshBridge(true);
    expect(bridge.post('ready')).toBe(false);
  });

  it('does not install a receiver when not listening', async () => {
    await freshBridge(false);
    expect(host.__fmNative).toBeUndefined();
  });
});

describe('createBridge receiving', () => {
  it('dispatches a JSON string with a payload to the handlers of its type', async () => {
    const bridge = await freshBridge(true);
    const got: BridgePayload[] = [];
    const other = vi.fn();
    bridge.on('pencil', (p) => got.push(p));
    bridge.on('other', other);
    send('{"type":"pencil","payload":{"action":"tap"}}');
    expect(got).toEqual([{ action: 'tap' }]);
    expect(other).not.toHaveBeenCalled();
  });

  it('treats the fields beside type as the payload when there is no payload object', async () => {
    const bridge = await freshBridge(true);
    const fn = vi.fn();
    bridge.on('memory', fn);
    send({ type: 'memory', level: 2, payload: 'x' });
    expect(fn).toHaveBeenCalledWith({ level: 2 });
  });

  it('accepts the two argument form of type and payload', async () => {
    const bridge = await freshBridge(true);
    const fn = vi.fn();
    bridge.on('squeeze', fn);
    send('squeeze', { strength: 1 });
    send('squeeze', 7);
    expect(fn.mock.calls).toEqual([[{ strength: 1 }], [{}]]);
  });

  it('ignores malformed JSON, non objects and messages without a string type', async () => {
    const bridge = await freshBridge(true);
    const fn = vi.fn();
    bridge.on('x', fn);
    expect(() => {
      send('{"type":"x",');
      send(42);
      send(null);
      send({ type: 5, payload: {} });
      send('"x"');
    }).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps calling other handlers when one throws', async () => {
    const bridge = await freshBridge(true);
    const after = vi.fn();
    bridge.on('x', () => { throw new Error('bad listener'); });
    bridge.on('x', after);
    send({ type: 'x', payload: { n: 1 } });
    expect(after).toHaveBeenCalledWith({ n: 1 });
  });

  it('stops calling a handler after it unsubscribes', async () => {
    const bridge = await freshBridge(true);
    const fn = vi.fn();
    const off = bridge.on('x', fn);
    send({ type: 'x', payload: {} });
    off();
    send({ type: 'x', payload: {} });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing native object and only sets its receiver', async () => {
    const shim: { receive?: Receive; tag: string } = { tag: 'shell' };
    host.__fmNative = shim;
    await freshBridge(true);
    expect(host.__fmNative).toBe(shim);
    expect(typeof shim.receive).toBe('function');
  });
});

describe('createBridge once', () => {
  it('resolves with the first payload the filter accepts', async () => {
    vi.useFakeTimers();
    const bridge = await freshBridge(true);
    const pending = bridge.once('fileSaved', (p) => p.id === 'b', 1000);
    send({ type: 'fileSaved', payload: { id: 'a' } });
    send({ type: 'fileSaved', payload: { id: 'b', ok: true } });
    await expect(pending).resolves.toEqual({ id: 'b', ok: true });
  });

  it('resolves with null when nothing matching arrives in time and then stops listening', async () => {
    vi.useFakeTimers();
    const bridge = await freshBridge(true);
    const accept = vi.fn(() => true);
    const pending = bridge.once('fileSaved', accept, 500);
    vi.advanceTimersByTime(500);
    await expect(pending).resolves.toBeNull();
    send({ type: 'fileSaved', payload: { id: 'late' } });
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('createBridge early replay', () => {
  function shellWithQueue(queued: unknown[]): void {
    const shim = {};
    let current: Receive | undefined;
    Object.defineProperty(shim, 'receive', {
      configurable: true,
      get: () => current,
      set(fn: Receive) { current = fn; for (const q of queued) fn(q); },
    });
    host.__fmNative = shim;
  }

  it('holds messages replayed before any handler and gives them to the first handler of their type', async () => {
    shellWithQueue(['{"type":"opened","payload":{"n":1}}', '{"type":"opened","payload":{"n":2}}', '{"type":"other","payload":{}}']);
    const bridge = await freshBridge(true);
    const first = vi.fn();
    const second = vi.fn();
    bridge.on('opened', first);
    bridge.on('opened', second);
    expect(first.mock.calls).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    expect(second).not.toHaveBeenCalled();
  });

  it('forgets replayed messages nobody listened for after a few seconds', async () => {
    vi.useFakeTimers();
    shellWithQueue([{ type: 'opened', payload: { n: 1 } }]);
    const bridge = await freshBridge(true);
    vi.advanceTimersByTime(8000);
    const fn = vi.fn();
    bridge.on('opened', fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('delivers live messages directly once replay is over', async () => {
    shellWithQueue([]);
    const bridge = await freshBridge(true);
    const fn = vi.fn();
    bridge.on('live', fn);
    send({ type: 'live', payload: { v: 1 } });
    expect(fn).toHaveBeenCalledWith({ v: 1 });
  });
});
