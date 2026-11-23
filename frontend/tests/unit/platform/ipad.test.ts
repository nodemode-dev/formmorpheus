import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform, PlatformInfo } from '@src/platform/types';

interface Posted { type: string; payload: Record<string, unknown> }
interface Host { __fmNative?: { receive?: (json: unknown) => void }; webkit?: unknown }

const host = window as unknown as Host;
const info: PlatformInfo = { kind: 'ipad', appVersion: 'v-test', build: 'b7', os: 'iPadOS' };

async function freshIpad(): Promise<Platform> {
  vi.resetModules();
  const mod = await import('@src/platform/ipad');
  return mod.createIpad(info);
}

function installShell(): Posted[] {
  const posted: Posted[] = [];
  host.webkit = { messageHandlers: { fm: { postMessage: (m: Posted) => { posted.push(m); } } } };
  return posted;
}

beforeEach(() => {
  delete host.__fmNative;
  delete host.webkit;
});

afterEach(() => {
  delete host.__fmNative;
  delete host.webkit;
});

describe('createIpad', () => {
  it('turns off every desktop only feature and offers the native share sheet', async () => {
    const p = await freshIpad();
    expect(p.kind).toBe('ipad');
    expect(Object.values(p.features).every((v) => v === false)).toBe(true);
    expect(Object.keys(p.features)).toHaveLength(7);
    expect(p.share.native).toBe(true);
    expect(p.penExtras.available).toBe(true);
  });

  it('tells the shell it is ready with its version and build', async () => {
    const posted = installShell();
    const p = await freshIpad();
    p.ready();
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('ready');
    expect(posted[0].payload).toMatchObject({ version: 'v-test', build: 'b7' });
  });

  it('sends shared text with empty defaults', async () => {
    const posted = installShell();
    const p = await freshIpad();
    await expect(p.share.share({ text: 'hi' })).resolves.toBe(true);
    expect(posted).toEqual([{ type: 'share', payload: { text: 'hi', url: '' } }]);
  });

  it('refuses to share when there is no shell', async () => {
    const p = await freshIpad();
    await expect(p.share.share({ url: 'https://example.test' })).resolves.toBe(false);
    await expect(p.share.share({ file: { blob: new Blob(['a']), name: 'a.txt' } })).resolves.toBe(false);
  });

  it('sends a small shared file as one base64 chunk', async () => {
    const posted = installShell();
    const p = await freshIpad();
    await expect(p.share.share({ file: { blob: new Blob(['hello']), name: 'h.txt' }, text: 't' })).resolves.toBe(true);
    expect(posted).toHaveLength(1);
    const msg = posted[0];
    expect(msg.type).toBe('share');
    expect(msg.payload).toMatchObject({ name: 'h.txt', mime: 'application/octet-stream', size: 5, index: 0, count: 1, text: 't', url: '' });
    expect(atob(msg.payload.data as string)).toBe('hello');
    expect(typeof msg.payload.id).toBe('string');
  });

  it('splits a file larger than three megabytes into numbered chunks of one id', async () => {
    const posted = installShell();
    const p = await freshIpad();
    const size = 3 * 1024 * 1024 + 2;
    const bytes = new Uint8Array(size);
    bytes[size - 1] = 65;
    await p.share.share({ file: { blob: new Blob([bytes], { type: 'image/png' }), name: 'big.png' } });
    expect(posted.map((m) => [m.payload.index, m.payload.count])).toEqual([[0, 2], [1, 2]]);
    expect(new Set(posted.map((m) => m.payload.id)).size).toBe(1);
    expect(posted.every((m) => m.payload.mime === 'image/png' && m.payload.size === size)).toBe(true);
    expect(atob(posted[0].payload.data as string)).toHaveLength(3 * 1024 * 1024);
    expect(atob(posted[1].payload.data as string)).toBe('\u0000A');
  });

  it('saves through the shell and finishes when the shell confirms that id', async () => {
    const posted = installShell();
    const p = await freshIpad();
    let finished = false;
    const saving = p.files.save(new Blob(['data'], { type: 'text/plain' }), 'notes.txt').then(() => { finished = true; });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const id = posted[0].payload.id as string;
    expect(posted[0].type).toBe('saveFile');
    host.__fmNative?.receive?.(JSON.stringify({ type: 'fileSaved', payload: { id: `${id}-other` } }));
    await Promise.resolve();
    expect(finished).toBe(false);
    host.__fmNative?.receive?.(JSON.stringify({ type: 'fileSaved', payload: { id } }));
    await saving;
    expect(finished).toBe(true);
  });

  it('falls back to a download when there is no shell to save through', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-2');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const p = await freshIpad();
    await p.files.save(new Blob(['x']), 'x.bin');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('throttles haptic taps that come within 30 milliseconds', async () => {
    const posted = installShell();
    const p = await freshIpad();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1010).mockReturnValueOnce(1040);
    p.haptic.fire('tap');
    p.haptic.fire('tap');
    p.haptic.fire('success');
    expect(posted.map((m) => m.payload.kind)).toEqual(['tap', 'success']);
  });

  it('forwards pen extra messages from the shell to listeners', async () => {
    const p = await freshIpad();
    const fn = vi.fn();
    const off = p.penExtras.on('squeeze', fn);
    host.__fmNative?.receive?.({ type: 'squeeze', payload: { phase: 'ended' } });
    off();
    host.__fmNative?.receive?.({ type: 'squeeze', payload: { phase: 'again' } });
    expect(fn.mock.calls).toEqual([[{ phase: 'ended' }]]);
  });
});
