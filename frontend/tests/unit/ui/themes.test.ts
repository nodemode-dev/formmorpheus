import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE, DEFAULT_ACCENT, DEFAULT_INTENSITY, DEFAULT_THEME, OLD_DEFAULT_ACCENT, ORANGE_DEFAULT_ACCENT, STORAGE_KEY, THEMES, applyTheme, readChoice, saveChoice } from '@src/ui/themes';

const store = (v: unknown): void => { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); };
const prop = (k: string): string => document.documentElement.style.getPropertyValue(k);

beforeEach(() => { localStorage.clear(); });

describe('readChoice', () => {
  it('gives the default look when nothing is saved', () => {
    expect(readChoice()).toEqual({ theme: DEFAULT_THEME, accentColor: DEFAULT_ACCENT, intensity: DEFAULT_INTENSITY });
  });

  it('keeps a current generation choice as saved', () => {
    store({ appearance: APPEARANCE, theme: 'forest', accentColor: '#123456', intensity: 0.5 });
    expect(readChoice()).toEqual({ theme: 'forest', accentColor: '#123456', intensity: 0.5 });
  });

  it('clamps the saved intensity into 0 to 1.5', () => {
    store({ appearance: APPEARANCE, theme: 'forest', accentColor: '#123456', intensity: 9 });
    expect(readChoice().intensity).toBe(1.5);
    store({ appearance: APPEARANCE, theme: 'forest', accentColor: '#123456', intensity: -3 });
    expect(readChoice().intensity).toBe(0);
  });

  it('uses the default intensity when the saved one is not a finite number', () => {
    store({ appearance: APPEARANCE, theme: 'forest', accentColor: '#123456', intensity: 'loud' });
    expect(readChoice().intensity).toBe(DEFAULT_INTENSITY);
  });

  it('fills an empty theme with the default theme', () => {
    store({ appearance: APPEARANCE, theme: '', accentColor: '#123456' });
    expect(readChoice().theme).toBe(DEFAULT_THEME);
  });

  it('moves a generation 3 orange default accent to the current default', () => {
    store({ appearance: 3, theme: 'ocean', accentColor: ORANGE_DEFAULT_ACCENT });
    expect(readChoice()).toMatchObject({ theme: 'ocean', accentColor: DEFAULT_ACCENT });
  });

  it('keeps a generation 3 accent that was chosen on purpose', () => {
    store({ appearance: 3, theme: 'ocean', accentColor: '#00ff00' });
    expect(readChoice().accentColor).toBe('#00ff00');
  });

  it('moves a generation 2 lavender default accent and resets its intensity', () => {
    store({ appearance: 2, theme: 'rose', accentColor: OLD_DEFAULT_ACCENT, intensity: 0.3 });
    expect(readChoice()).toEqual({ theme: 'rose', accentColor: DEFAULT_ACCENT, intensity: DEFAULT_INTENSITY });
  });

  it('sets aside a choice saved before the redesign', () => {
    store({ theme: 'ember', accentColor: '#ff0000' });
    expect(readChoice()).toEqual({ theme: DEFAULT_THEME, accentColor: DEFAULT_ACCENT, intensity: DEFAULT_INTENSITY });
  });

  it('falls back to the default look when the saved entry is damaged', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem(STORAGE_KEY, '{oops');
    expect(readChoice().theme).toBe(DEFAULT_THEME);
    expect(err).toHaveBeenCalled();
  });
});

describe('saveChoice', () => {
  it('round trips through readChoice', () => {
    saveChoice({ theme: 'slate', accentColor: '#abcdef', intensity: 1.2 });
    expect(readChoice()).toEqual({ theme: 'slate', accentColor: '#abcdef', intensity: 1.2 });
  });

  it('keeps other saved settings and stamps the current generation', () => {
    store({ gridSize: 24, theme: 'mono' });
    saveChoice({ theme: 'violet', accentColor: '#111111' });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(saved.gridSize).toBe(24);
    expect(saved.theme).toBe('violet');
    expect(saved.appearance).toBe(APPEARANCE);
  });
});

describe('applyTheme', () => {
  it('falls back to the default profile for an unknown theme id', () => {
    applyTheme({ theme: 'no-such-theme', accentColor: '#222222' });
    expect(prop('--bg-primary')).toBe(THEMES[DEFAULT_THEME].vars['--bg-primary']);
  });

  it('uses the secondary surface as the node colour when a profile has none', () => {
    applyTheme({ theme: 'nodemode-dark', accentColor: '#222222' });
    expect(prop('--bg-node')).toBe(THEMES['nodemode-dark'].vars['--bg-secondary']);
  });

  it('removes a variable the previous profile set and the next one lacks', () => {
    applyTheme({ theme: 'nodemode-dark', accentColor: '#222222' });
    expect(prop('--node-shadow')).not.toBe('');
    applyTheme({ theme: 'studio', accentColor: '#222222' });
    expect(prop('--node-shadow')).toBe('');
  });

  it('marks the body light only for a light profile', () => {
    applyTheme({ theme: 'light', accentColor: '#222222' });
    expect(document.body.classList.contains('theme-light')).toBe(true);
    applyTheme({ theme: 'mono', accentColor: '#222222' });
    expect(document.body.classList.contains('theme-light')).toBe(false);
  });

  it('flags the black screen profile and clears the flag afterwards', () => {
    applyTheme({ theme: 'amoled', accentColor: '#222222' });
    expect(document.documentElement.hasAttribute('data-oled')).toBe(true);
    applyTheme({ theme: 'studio', accentColor: '#222222' });
    expect(document.documentElement.hasAttribute('data-oled')).toBe(false);
  });

  it('writes the accent, its dim variant and a clamped intensity', () => {
    applyTheme({ theme: 'studio', accentColor: '#336699', intensity: 7 });
    expect(prop('--accent-color')).toBe('#336699');
    expect(prop('--accent-color-dim')).toBe('#33669933');
    expect(prop('--accent-intensity')).toBe('1.5');
  });
});
