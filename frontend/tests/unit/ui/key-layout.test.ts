import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type KeyLayoutModule = typeof import('@src/ui/key-layout');

const STORE_KEY = 'formmorpheus.keyLayout';

function setPlatform(value: string): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
}

function setKeyboard(getLayoutMap: (() => Promise<Map<string, string>>) | null): void {
  Object.defineProperty(navigator, 'keyboard', { value: getLayoutMap ? { getLayoutMap } : undefined, configurable: true });
}

async function load(): Promise<KeyLayoutModule> {
  vi.resetModules();
  return import('@src/ui/key-layout');
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  localStorage.clear();
  setPlatform('Linux x86_64');
  setKeyboard(null);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'platform');
  Reflect.deleteProperty(navigator, 'keyboard');
  localStorage.clear();
});

describe('capsOf', () => {
  it('orders the modifiers as command key, then Alt, then Shift, then the key', async () => {
    const m = await load();
    expect(m.capsOf('Alt+Shift+Mod+S')).toEqual(['Ctrl', 'Alt', 'Shift', 'S']);
    expect(m.capsOf('Shift+Alt+K')).toEqual(['Alt', 'Shift', 'K']);
  });

  it('treats Ctrl like the command key in the order', async () => {
    const m = await load();
    expect(m.capsOf('Shift+Ctrl+Z')).toEqual(['Ctrl', 'Shift', 'Z']);
  });

  it('ends a combo written with a double plus on the plus key', async () => {
    const m = await load();
    expect(m.capsOf('Mod++')).toEqual(['Ctrl', '+']);
    expect(m.capsOf('Shift+Mod++')).toEqual(['Ctrl', 'Shift', '+']);
  });

  it('returns a lone key as a single keycap', async () => {
    const m = await load();
    expect(m.capsOf('Space')).toEqual(['Space']);
  });

  it('draws the Mac glyphs for the modifiers on a Mac', async () => {
    setPlatform('MacIntel');
    const m = await load();
    expect(m.capsOf('Alt+Shift+Mod+S')).toEqual(['⌘', '⌥', '⇧', 'S']);
    expect(m.capsOf('Ctrl+A')).toEqual(['⌃', 'A']);
  });

  it('keeps the US letter on the qwerty layout', async () => {
    const m = await load();
    m.setKeyLayout('qwerty');
    expect(m.capsOf('Mod+Q')).toEqual(['Ctrl', 'Q']);
  });

  it('labels the keycaps by the azerty layout', async () => {
    const m = await load();
    m.setKeyLayout('azerty');
    expect(m.capsOf('Mod+Q')).toEqual(['Ctrl', 'A']);
    expect(m.capsOf('A')).toEqual(['Q']);
    expect(m.capsOf('W')).toEqual(['Z']);
    expect(m.capsOf('M')).toEqual([',']);
    expect(m.capsOf('S')).toEqual(['S']);
  });

  it('swaps Y and Z on the qwertz layout', async () => {
    const m = await load();
    m.setKeyLayout('qwertz');
    expect(m.capsOf('Y')).toEqual(['Z']);
    expect(m.capsOf('Z')).toEqual(['Y']);
    expect(m.capsOf('Q')).toEqual(['Q']);
  });

  it('labels the keycaps by the dvorak and colemak layouts', async () => {
    const m = await load();
    m.setKeyLayout('dvorak');
    expect(m.capsOf('Q')).toEqual(["'"]);
    expect(m.capsOf('S')).toEqual(['O']);
    expect(m.capsOf('A')).toEqual(['A']);
    m.setKeyLayout('colemak');
    expect(m.capsOf('E')).toEqual(['F']);
    expect(m.capsOf('K')).toEqual(['E']);
    expect(m.capsOf('Q')).toEqual(['Q']);
  });

  it('passes keys that are not single capital letters through unchanged', async () => {
    const m = await load();
    m.setKeyLayout('azerty');
    expect(m.capsOf('Mod+ArrowLeft')).toEqual(['Ctrl', 'ArrowLeft']);
    expect(m.capsOf('Shift+1')).toEqual(['Shift', '1']);
    expect(m.capsOf('q')).toEqual(['q']);
  });
});

describe('the chosen layout', () => {
  it('starts on auto when nothing is stored', async () => {
    const m = await load();
    expect(m.getKeyLayout()).toBe('auto');
  });

  it('stores the choice and announces it on the document', async () => {
    const m = await load();
    const heard = vi.fn();
    document.addEventListener('fm:key-layout', heard);
    m.setKeyLayout('dvorak');
    document.removeEventListener('fm:key-layout', heard);
    expect(m.getKeyLayout()).toBe('dvorak');
    expect(localStorage.getItem(STORE_KEY)).toBe('dvorak');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('reads a stored layout back when the module loads', async () => {
    localStorage.setItem(STORE_KEY, 'colemak');
    const m = await load();
    expect(m.getKeyLayout()).toBe('colemak');
    expect(m.capsOf('E')).toEqual(['F']);
  });

  it('falls back to auto when the stored value is not a known layout', async () => {
    localStorage.setItem(STORE_KEY, 'not-a-layout');
    const m = await load();
    expect(m.getKeyLayout()).toBe('auto');
  });
});

describe('detectKeyLayout', () => {
  it('shows the US letters on auto before the browser answers', async () => {
    const m = await load();
    expect(m.capsOf('Q')).toEqual(['Q']);
  });

  it('labels the keycaps with the letters the browser reports, in capitals', async () => {
    const getLayoutMap = vi.fn(() => Promise.resolve(new Map([['KeyQ', 'a'], ['KeyA', 'q']])));
    setKeyboard(getLayoutMap);
    const m = await load();
    const heard = vi.fn();
    document.addEventListener('fm:key-layout', heard);
    m.detectKeyLayout();
    await flush();
    document.removeEventListener('fm:key-layout', heard);
    expect(m.capsOf('Mod+Q')).toEqual(['Ctrl', 'A']);
    expect(m.capsOf('A')).toEqual(['Q']);
    expect(m.capsOf('W')).toEqual(['W']);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('asks the browser only once', async () => {
    const getLayoutMap = vi.fn(() => Promise.resolve(new Map<string, string>()));
    setKeyboard(getLayoutMap);
    const m = await load();
    m.detectKeyLayout();
    m.detectKeyLayout();
    await flush();
    expect(getLayoutMap).toHaveBeenCalledTimes(1);
  });

  it('keeps the US letters when the browser refuses to answer', async () => {
    setKeyboard(() => Promise.reject(new Error('denied')));
    const m = await load();
    m.detectKeyLayout();
    await flush();
    expect(m.capsOf('Q')).toEqual(['Q']);
  });

  it('ignores the browser answer once a fixed layout is chosen', async () => {
    setKeyboard(() => Promise.resolve(new Map([['KeyQ', 'x']])));
    const m = await load();
    m.detectKeyLayout();
    await flush();
    m.setKeyLayout('qwertz');
    expect(m.capsOf('Q')).toEqual(['Q']);
  });
});
