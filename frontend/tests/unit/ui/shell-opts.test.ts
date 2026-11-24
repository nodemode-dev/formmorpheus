import { beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('@src/ui/shell-opts');

const load = async (): Promise<Mod> => {
  vi.resetModules();
  return import('@src/ui/shell-opts');
};

beforeEach(() => {
  localStorage.clear();
  document.body.className = '';
  document.documentElement.className = '';
});

describe('theater layout', () => {
  it('defaults to the library layout when nothing is stored', async () => {
    const m = await load();
    expect(m.theaterLayout()).toBe('library');
  });

  it('restores a stored gallery layout', async () => {
    localStorage.setItem('formmorpheus.theaterLayout', 'gallery');
    const m = await load();
    expect(m.theaterLayout()).toBe('gallery');
  });

  it('falls back to library for an unknown stored value', async () => {
    localStorage.setItem('formmorpheus.theaterLayout', 'grid');
    const m = await load();
    expect(m.theaterLayout()).toBe('library');
  });

  it('stores a new layout and announces it once', async () => {
    const m = await load();
    const seen = vi.fn();
    document.addEventListener('fm:theater-layout', seen);
    m.setTheaterLayout('gallery');
    m.setTheaterLayout('gallery');
    document.removeEventListener('fm:theater-layout', seen);
    expect(m.theaterLayout()).toBe('gallery');
    expect(localStorage.getItem('formmorpheus.theaterLayout')).toBe('gallery');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('does not announce a layout that is already current', async () => {
    const m = await load();
    const seen = vi.fn();
    document.addEventListener('fm:theater-layout', seen);
    m.setTheaterLayout('library');
    document.removeEventListener('fm:theater-layout', seen);
    expect(seen).not.toHaveBeenCalled();
    expect(localStorage.getItem('formmorpheus.theaterLayout')).toBeNull();
  });
});

describe('chrome commands', () => {
  const find = (m: Mod, id: string) => {
    const c = m.chromeCommands().find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };

  it('toggles the menu bar and remembers the choice', async () => {
    const m = await load();
    const cmd = find(m, 'chrome-hide-menu');
    cmd.run();
    expect(document.body.classList.contains('fm-hide-menu')).toBe(true);
    expect(localStorage.getItem('formmorpheus.hideMenuBar')).toBe('1');
    expect(cmd.checked?.()).toBe(true);
    cmd.run();
    expect(document.body.classList.contains('fm-hide-menu')).toBe(false);
    expect(localStorage.getItem('formmorpheus.hideMenuBar')).toBe('0');
    expect(cmd.checked?.()).toBe(false);
  });

  it('toggles the status bar and remembers the choice', async () => {
    const m = await load();
    const cmd = find(m, 'chrome-hide-status');
    cmd.run();
    expect(document.body.classList.contains('fm-hide-status')).toBe(true);
    expect(localStorage.getItem('formmorpheus.hideStatusBar')).toBe('1');
    expect(cmd.checked?.()).toBe(true);
    cmd.run();
    expect(document.body.classList.contains('fm-hide-status')).toBe(false);
    expect(cmd.checked?.()).toBe(false);
  });

  it('applies stored hidden bars as soon as the commands are built', async () => {
    localStorage.setItem('formmorpheus.hideMenuBar', '1');
    localStorage.setItem('formmorpheus.hideStatusBar', '1');
    const m = await load();
    m.chromeCommands();
    expect(document.body.classList.contains('fm-hide-menu')).toBe(true);
    expect(document.body.classList.contains('fm-hide-status')).toBe(true);
  });

  it('never hides the menu bar under an overlay title bar', async () => {
    document.documentElement.classList.add('has-overlay-titlebar');
    const m = await load();
    const cmd = find(m, 'chrome-hide-menu');
    expect(cmd.enabled?.()).toBe(false);
    cmd.run();
    expect(document.body.classList.contains('fm-hide-menu')).toBe(false);
    expect(cmd.checked?.()).toBe(false);
  });

  it('asks the shell to lay itself out again after a change', async () => {
    const m = await load();
    const cmd = find(m, 'chrome-hide-status');
    const resized = vi.fn();
    window.addEventListener('resize', resized);
    cmd.run();
    window.removeEventListener('resize', resized);
    expect(resized).toHaveBeenCalled();
  });
});
