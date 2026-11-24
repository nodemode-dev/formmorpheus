import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from '@src/engine/engine';

type Nav = typeof import('@src/ui/timeline-nav');
type Snap = typeof import('@src/engine/snap');

async function fresh(): Promise<{ nav: Nav; snap: Snap }> {
  vi.resetModules();
  const snap = await import('@src/engine/snap');
  const nav = await import('@src/ui/timeline-nav');
  return { nav, snap };
}

const bodies: HTMLElement[] = [];

beforeEach(() => { localStorage.clear(); });

afterEach(() => {
  for (const b of bodies.splice(0)) b.dispatchEvent(new Event('pointerleave'));
  window.dispatchEvent(new Event('blur'));
});

describe('rulerDrag', () => {
  it('scrubs by default', async () => {
    const { nav } = await fresh();
    expect(nav.rulerDrag.mode).toBe('scrub');
  });

  it('remembers the scale mode across a reload', async () => {
    const first = await fresh();
    first.nav.rulerDrag.set('scale');
    expect(first.nav.rulerDrag.mode).toBe('scale');
    const second = await fresh();
    expect(second.nav.rulerDrag.mode).toBe('scale');
  });

  it('ignores an unknown stored mode', async () => {
    localStorage.setItem('fm.tl.rulerDrag', 'zoom');
    const { nav } = await fresh();
    expect(nav.rulerDrag.mode).toBe('scrub');
  });
});

describe('snapSeconds', () => {
  it('is off by default', async () => {
    const { nav, snap } = await fresh();
    expect(nav.snapSeconds.on).toBe(false);
    expect(snap.snapOptions.seconds).toBe(false);
  });

  it('turns whole second snapping on in the shared snap options and keeps it', async () => {
    const first = await fresh();
    first.nav.snapSeconds.set(true);
    expect(first.snap.snapOptions.seconds).toBe(true);
    const second = await fresh();
    expect(second.nav.snapSeconds.on).toBe(true);
  });

  it('stays off after being turned off', async () => {
    const first = await fresh();
    first.nav.snapSeconds.set(true);
    first.nav.snapSeconds.set(false);
    const second = await fresh();
    expect(second.nav.snapSeconds.on).toBe(false);
  });
});

describe('SpacePan', () => {
  async function setup(movie: unknown = {}): Promise<{ pan: InstanceType<Nav['SpacePan']>; play: ReturnType<typeof vi.fn>; body: HTMLElement; root: HTMLElement }> {
    const { nav } = await fresh();
    const play = vi.fn();
    const engine = { movie, togglePlay: play } as unknown as Engine;
    const body = document.createElement('div');
    const root = document.createElement('div');
    bodies.push(body);
    const pan = new nav.SpacePan(engine, body, root);
    return { pan, play, body, root };
  }
  const down = (init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };
  const up = (): void => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true })); };

  it('holds Space over the lanes and plays on release when no drag used it', async () => {
    const { pan, play, body, root } = await setup();
    body.dispatchEvent(new Event('pointerenter'));
    const e = down();
    expect(e.defaultPrevented).toBe(true);
    expect(pan.held).toBe(true);
    expect(root.classList.contains('is-space')).toBe(true);
    up();
    expect(pan.held).toBe(false);
    expect(root.classList.contains('is-space')).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not play on release after a drag took the Space', async () => {
    const { pan, play, body } = await setup();
    body.dispatchEvent(new Event('pointerenter'));
    down();
    pan.take();
    up();
    expect(play).not.toHaveBeenCalled();
  });

  it('plays only once when the key repeats while held', async () => {
    const { play, body } = await setup();
    body.dispatchEvent(new Event('pointerenter'));
    down();
    down();
    down();
    up();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('ignores Space when the pointer is not over the lanes', async () => {
    const { pan, play } = await setup();
    const e = down();
    expect(e.defaultPrevented).toBe(false);
    expect(pan.held).toBe(false);
    up();
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores Space with a modifier held', async () => {
    const { pan, body } = await setup();
    body.dispatchEvent(new Event('pointerenter'));
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) down({ [mod]: true });
    expect(pan.held).toBe(false);
  });

  it('ignores Space while typing in a field', async () => {
    const { pan, body } = await setup();
    body.dispatchEvent(new Event('pointerenter'));
    const input = document.createElement('input');
    document.body.append(input);
    down({}, input);
    input.remove();
    expect(pan.held).toBe(false);
  });

  it('ignores Space when no movie is open', async () => {
    const { pan, body } = await setup(null);
    body.dispatchEvent(new Event('pointerenter'));
    down();
    expect(pan.held).toBe(false);
  });

  it('lets go when the window loses focus, without playing', async () => {
    const { pan, play, body, root } = await setup();
    body.dispatchEvent(new Event('pointerenter'));
    down();
    window.dispatchEvent(new Event('blur'));
    expect(pan.held).toBe(false);
    expect(root.classList.contains('is-space')).toBe(false);
    up();
    expect(play).not.toHaveBeenCalled();
  });
});
