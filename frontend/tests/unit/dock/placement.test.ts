import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockSizes } from '@src/dock/adapter';
import { placementFor } from '@src/dock/placement';

const sizes: DockSizes = { minHeight: 120, minWidth: 200, defaultHeight: 250, defaultWidth: 260, maxHeightShare: 1, maxWidthShare: 1, maxHeight: () => 300, maxWidth: () => 400 };
const own = (extra: Partial<DockSizes> = {}, right?: () => boolean) => placementFor({ placement: { mode: 'own', storage: { key: 'dock', legacy: ['old'] }, sizes: { ...sizes, ...extra }, canDockRight: right } });
const hooks = () => ({ changed: vi.fn(), resizing: vi.fn(), settled: vi.fn() });
const attr = (name: string): string | null => document.documentElement.getAttribute(name);
const begin = (p: ReturnType<typeof own>): void => p.start(document.createElement('div'), document.createElement('div'), hooks());

afterEach(() => {
  localStorage.clear();
  for (const a of ['data-ft-dock', 'data-ft-dock-side', 'data-ft-dock-h', 'data-ft-dock-w']) document.documentElement.removeAttribute(a);
});

describe('own placement', () => {
  it('moves legacy state to its own key when created', () => {
    localStorage.setItem('old', JSON.stringify({ open: true, side: 'right', h: 200, w: 300, tab: 'shell' }));
    const p = own();
    expect(p.hosted).toBe(false);
    expect(p.savedTab()).toBe('shell');
    expect(p.storedSide()).toBe('right');
    expect(localStorage.getItem('old')).toBeNull();
    expect(JSON.parse(localStorage.getItem('dock') ?? 'null')).toMatchObject({ tab: 'shell', h: 200 });
  });

  it('clamps the stored height and width between the limits when applied', () => {
    localStorage.setItem('dock', JSON.stringify({ open: true, h: 9999, w: 1 }));
    begin(own());
    expect(attr('data-ft-dock')).toBe('open');
    expect(attr('data-ft-dock-h')).toBe('300');
    expect(attr('data-ft-dock-w')).toBe('200');
    expect(document.documentElement.style.getPropertyValue('--ft-dock-size')).toBe('300px');
  });

  it('opens and closes through the document attribute', () => {
    const p = own();
    begin(p);
    expect(p.isOpen()).toBe(false);
    p.setOpen(true);
    expect(attr('data-ft-dock')).toBe('open');
    expect(p.isOpen()).toBe(true);
    p.setOpen(false);
    expect(p.isOpen()).toBe(false);
  });

  it('docks at the bottom when the right side is not allowed but remembers the wish', () => {
    let allowed = false;
    const p = own({}, () => allowed);
    begin(p);
    p.setSide('right');
    expect(p.storedSide()).toBe('right');
    expect(p.side()).toBe('bottom');
    expect(attr('data-ft-dock-side')).toBe('bottom');
    allowed = true;
    expect(p.side()).toBe('right');
  });

  it('refuses the right side when the widest dock is narrower than the minimum', () => {
    expect(own({ maxWidth: () => 150 }).canRight()).toBe(false);
    expect(own({ maxWidth: () => 250 }).canRight()).toBe(true);
  });

  it('keeps the tab and the seen flag across saves', () => {
    const p = own();
    expect(p.seen()).toBe(false);
    p.markSeen();
    expect(p.seen()).toBe(true);
    p.keep('codex');
    p.keep(null);
    expect(p.seen()).toBe(true);
    expect(p.savedTab()).toBe('codex');
    expect(own().savedTab()).toBe('codex');
  });
});

describe('hosted placement', () => {
  it('follows the host for visibility and never docks right or stores anything', () => {
    const p = placementFor({ placement: { mode: 'hosted', request: () => undefined } });
    const root = document.createElement('div');
    p.start(root, document.createElement('div'), hooks());
    expect(p.hosted).toBe(true);
    expect(root.classList.contains('is-hosted')).toBe(true);
    p.setOpen(true);
    expect(p.isOpen()).toBe(false);
    p.shown(true);
    expect(p.isOpen()).toBe(true);
    p.setSide('right');
    expect(p.side()).toBe('bottom');
    expect(p.canRight()).toBe(false);
    p.keep('chat');
    p.keep(null);
    expect(p.savedTab()).toBe('chat');
    expect(localStorage.length).toBe(0);
  });
});
