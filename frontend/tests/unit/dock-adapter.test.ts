import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsentRequest } from '@src/dock/adapter';

vi.mock('@src/io/window-key', () => ({ socketUrl: async (p: string) => `ws://engine${p}`, windowKey: () => 'wk' }));
vi.mock('@src/ui/dom', () => ({ isMac: false }));
vi.mock('@src/ui/i18n', () => ({ t: (s: string) => s }));

type Mod = typeof import('@src/dock-adapter');
interface Reply { ok?: boolean; status?: number; body?: unknown }

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];
let replies: Reply[] = [];

const load = async (): Promise<Mod> => { vi.resetModules(); return import('@src/dock-adapter'); };
const req = (id: string, what = 'render the scene'): ConsentRequest => ({ id, agent: 'Bot', what, offers: ['deny', 'once', 'always'], always: 'agent' });

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? {};
    if (r.status === -1) throw new TypeError('offline');
    const status = r.status ?? 200;
    return { ok: r.ok ?? (status >= 200 && status < 300), status, statusText: `S${status}`, json: async () => r.body ?? {} };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  for (const a of ['data-ft-dock', 'data-ft-dock-side', 'data-ft-dock-h', 'data-ft-dock-w']) document.documentElement.removeAttribute(a);
});

describe('outsideAgents', () => {
  it('passes each new request to subscribers once and fills an empty action', async () => {
    const { outsideAgents } = await load();
    const got: ConsentRequest[] = [];
    outsideAgents.subscribe((r) => got.push(r), () => undefined);
    outsideAgents.show(req('a'));
    outsideAgents.show(req('a'));
    outsideAgents.show(req('b', ''));
    expect(got.map((r) => r.id)).toEqual(['a', 'b']);
    expect(got[0].what).toBe('render the scene');
    expect(got[1].what.length).toBeGreaterThan(0);
    expect(got[0].notes?.length).toBeGreaterThan(0);
    expect(outsideAgents.waiting()).toBe(2);
  });

  it('replays waiting requests to a late subscriber', async () => {
    const { outsideAgents } = await load();
    outsideAgents.show(req('a'));
    const got: string[] = [];
    outsideAgents.subscribe((r) => got.push(r.id), () => undefined);
    expect(got).toEqual(['a']);
  });

  it('withdraws only requests that are still waiting', async () => {
    const { outsideAgents } = await load();
    const gone: string[] = [];
    outsideAgents.subscribe(() => undefined, (id) => gone.push(id));
    outsideAgents.show(req('a'));
    outsideAgents.gone('zzz');
    outsideAgents.gone('a');
    outsideAgents.gone('a');
    expect(gone).toEqual(['a']);
    expect(outsideAgents.waiting()).toBe(0);
  });

  it('posts an answer to the engine with the id encoded and ignores unknown ids', async () => {
    const { outsideAgents } = await load();
    outsideAgents.show(req('a/b'));
    await outsideAgents.answer('nope', 'once');
    expect(calls).toHaveLength(0);
    await outsideAgents.answer('a/b', 'once');
    expect(calls[0].url).toBe('/api/agents/consent/a%2Fb');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ choice: 'once' });
    expect(outsideAgents.waiting()).toBe(0);
  });

  it('remembers an always answer even when the engine cannot be reached afterwards', async () => {
    const { outsideAgents } = await load();
    outsideAgents.show(req('a'));
    await outsideAgents.answer('a', 'always');
    replies.push({ status: -1 });
    expect(await outsideAgents.get()).toEqual({ value: 'allowed', changedOutside: false });
  });

  it('reads the stored choice and treats unknown values as ask', async () => {
    const { outsideAgents } = await load();
    replies.push({ body: { choice: 'blocked', changedOutside: true } });
    expect(await outsideAgents.get()).toEqual({ value: 'blocked', changedOutside: true });
    replies.push({ body: { choice: 'whatever', changedOutside: 'yes' } });
    expect(await outsideAgents.get()).toEqual({ value: 'ask', changedOutside: false });
  });

  it('withdraws every waiting request when agents are blocked', async () => {
    const { outsideAgents } = await load();
    const gone: string[] = [];
    outsideAgents.subscribe(() => undefined, (id) => gone.push(id));
    outsideAgents.show(req('a'));
    outsideAgents.show(req('b'));
    await outsideAgents.set('blocked');
    expect(gone.sort()).toEqual(['a', 'b']);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ value: 'blocked' });
  });

  it('rejects with the engine detail when saving the choice fails and keeps requests', async () => {
    const { outsideAgents, DockError } = await load();
    outsideAgents.show(req('a'));
    replies.push({ status: 403, body: { detail: 'no key' } });
    const err = await outsideAgents.set('blocked').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DockError);
    expect((err as InstanceType<typeof DockError>).status).toBe(403);
    expect((err as Error).message).toBe('no key');
    expect(outsideAgents.waiting()).toBe(1);
  });

  it('restores pending requests from the engine and stays quiet when it fails', async () => {
    const { outsideAgents } = await load();
    replies.push({ body: { requests: [req('x'), req('y')] } });
    await outsideAgents.restore();
    expect(outsideAgents.waiting()).toBe(2);
    replies.push({ status: -1 });
    await expect(outsideAgents.restore()).resolves.toBeUndefined();
  });
});

describe('formmorpheusDock', () => {
  const host = (layer: boolean) => ({ context: () => '', openSettings: () => undefined, layerOpen: () => layer, firstRun: () => false });

  it('sorts engine errors into kinds', async () => {
    const { formmorpheusDock, DockError } = await load();
    const kind = formmorpheusDock(host(false)).errors.kind;
    expect(kind?.(new TypeError('x'))).toBe('unreachable');
    expect(kind?.(new DockError('x', 403))).toBe('refused');
    expect(kind?.(new DockError('x', 409))).toBe('notInstalled');
    expect(kind?.(new DockError('x', 404))).toBe('oldEngine');
    expect(kind?.(new DockError('x', 405))).toBe('oldEngine');
    expect(kind?.(new DockError('x', 503))).toBe('unreachable');
    expect(kind?.(new DockError('x', 500))).toBeNull();
    expect(kind?.(new Error('x'))).toBeNull();
    expect(formmorpheusDock(host(false)).errors.message(new Error('plain'))).toBeNull();
  });

  it('takes the dock chord unless another layer is open outside the dock', async () => {
    const { formmorpheusDock } = await load();
    const chord = (): KeyboardEvent => new KeyboardEvent('keydown', { code: 'Backquote', ctrlKey: true });
    expect(formmorpheusDock(host(false)).isDockChord?.(chord())).toBe(true);
    expect(formmorpheusDock(host(true)).isDockChord?.(chord())).toBe(false);
    expect(formmorpheusDock(host(false)).isDockChord?.(new KeyboardEvent('keydown', { code: 'Backquote', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(formmorpheusDock(host(false)).passKey?.(new KeyboardEvent('keydown', { code: 'Backquote', ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('lists terminals with unknown kinds as shells and alive unless said otherwise', async () => {
    const { formmorpheusDock } = await load();
    replies.push({ body: { terminals: [{ id: '1', title: 'a', kind: 'mystery' }, { id: '2', title: 'b', kind: 'codex', alive: false }] } });
    const list = await formmorpheusDock(host(false)).terminal.list();
    expect(list[0]).toMatchObject({ id: '1', kind: 'shell', alive: true });
    expect(list[1]).toMatchObject({ id: '2', kind: 'codex', alive: false });
  });
});

describe('reserveDock', () => {
  it('clamps the stored height and keeps the dock closed when asked for none', async () => {
    const { reserveDock, DOCK_KEY, DOCK_SIZES } = await load();
    localStorage.setItem(DOCK_KEY, JSON.stringify({ open: true, h: 3 }));
    reserveDock(true);
    const html = document.documentElement;
    expect(html.getAttribute('data-ft-dock')).toBe('closed');
    expect(html.getAttribute('data-ft-dock-h')).toBe(String(DOCK_SIZES.minHeight));
    reserveDock(false);
    expect(html.getAttribute('data-ft-dock')).toBe('open');
  });

  it('falls back to a closed bottom dock when the stored state is malformed', async () => {
    const { reserveDock, DOCK_KEY } = await load();
    localStorage.setItem(DOCK_KEY, '{oops');
    reserveDock(false);
    expect(document.documentElement.getAttribute('data-ft-dock')).toBe('closed');
    expect(document.documentElement.getAttribute('data-ft-dock-side')).toBe('bottom');
  });
});
