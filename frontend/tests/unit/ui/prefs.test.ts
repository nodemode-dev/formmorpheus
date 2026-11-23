import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '@src/ui/themes';
import { applyUiFontSize, cleanBindings, DEFAULT_PREFS, loadPrefs, recalled, remembered, setUiScale, systemLang, uiScaleChoice, updatePrefs } from '@src/ui/prefs';

const KEY = 'formmorpheus.prefs';
const store = (v: unknown): void => localStorage.setItem(KEY, JSON.stringify(v));

beforeEach(() => {
  localStorage.clear();
});

describe('loadPrefs', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('clamps numbers into their ranges and rounds whole-number settings', () => {
    store({ noticeSeconds: 999, undoDepth: 5000, recentUndo: 1, autosaveSeconds: -20, stageShare: 2 });
    const p = loadPrefs();
    expect(p.noticeSeconds).toBe(60);
    expect(p.undoDepth).toBe(1000);
    expect(p.recentUndo).toBe(10);
    expect(p.autosaveSeconds).toBe(0);
    expect(p.stageShare).toBe(0.8);
    store({ noticeSeconds: 2.6, stageShare: 0.1, undoDepth: 49.4 });
    const q = loadPrefs();
    expect(q.noticeSeconds).toBe(3);
    expect(q.stageShare).toBe(0.25);
    expect(q.undoDepth).toBe(49);
  });

  it('falls back to defaults for numbers of the wrong type', () => {
    store({ undoDepth: '50', autosaveSeconds: null, stageShare: 'wide' });
    const p = loadPrefs();
    expect(p.undoDepth).toBe(DEFAULT_PREFS.undoDepth);
    expect(p.autosaveSeconds).toBe(DEFAULT_PREFS.autosaveSeconds);
    expect(p.stageShare).toBe(DEFAULT_PREFS.stageShare);
  });

  it('keeps only real booleans for flags', () => {
    store({ animations: false, gpu: 'no', penPlay: true, confirmDelete: 1 });
    const p = loadPrefs();
    expect(p.animations).toBe(false);
    expect(p.gpu).toBe(DEFAULT_PREFS.gpu);
    expect(p.penPlay).toBe(true);
    expect(p.confirmDelete).toBe(DEFAULT_PREFS.confirmDelete);
  });

  it('refuses unknown enum values for font size, scrub speed and language', () => {
    store({ uiFontSize: 'huge', scrubSpeed: 'warp', language: 'xx-YY' });
    const p = loadPrefs();
    expect(p.uiFontSize).toBe('default');
    expect(p.scrubSpeed).toBe('medium');
    expect(p.language).toBe('en');
    store({ uiFontSize: 'larger', scrubSpeed: 'precise' });
    expect(loadPrefs().uiFontSize).toBe('larger');
    expect(loadPrefs().scrubSpeed).toBe('precise');
  });

  it('keeps only known themes and drops duplicate favourites', () => {
    const known = Object.keys(THEMES)[0];
    store({ themeLight: 'not-a-theme', themeDark: known, favouriteThemes: ['not-a-theme', known, known, 7] });
    const p = loadPrefs();
    expect(p.themeLight).toBe(DEFAULT_PREFS.themeLight);
    expect(p.themeDark).toBe(known);
    expect(p.favouriteThemes).toEqual([known]);
  });

  it('filters string lists and caps their length', () => {
    store({ recent: ['a', '', 3, 'b', null, ...Array.from({ length: 40 }, (_, i) => `f${i}`)], tipsSeen: ['x'.repeat(41), 'ok'] });
    const p = loadPrefs();
    expect(p.recent.length).toBe(30);
    expect(p.recent.slice(0, 3)).toEqual(['a', 'b', 'f0']);
    expect(p.tipsSeen).toEqual(['ok']);
  });

  it('cuts the last seen notes marker to forty characters', () => {
    store({ whatsNewSeen: 'v'.repeat(100) });
    expect(loadPrefs().whatsNewSeen).toBe('v'.repeat(40));
  });

  it('keeps only lowercase colour names for menu colours', () => {
    store({ menuColors: { a: 'red', b: 'Red', c: '#ff0000', d: 'ab', e: 'purple' } });
    expect(loadPrefs().menuColors).toEqual({ a: 'red', e: 'purple' });
  });

  it('keeps string and boolean dialog values and drops the rest', () => {
    store({ dialogValues: { exp: { fmt: 'gif', loop: true, n: 4, long: 'x'.repeat(2001) }, bad: 'nope', list: [1] } });
    expect(loadPrefs().dialogValues).toEqual({ exp: { fmt: 'gif', loop: true } });
  });

  it('returns the defaults with the system language when the stored text is not valid', () => {
    localStorage.setItem(KEY, '{broken');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-Hant-HK']);
    const p = loadPrefs();
    expect(p.language).toBe('zh-TW');
    expect({ ...p, language: 'en' }).toEqual(DEFAULT_PREFS);
  });
});

describe('cleanBindings', () => {
  it('returns an empty map for anything that is not a plain object', () => {
    expect(cleanBindings(null)).toEqual({});
    expect(cleanBindings(['a'])).toEqual({});
    expect(cleanBindings('ctrl+z')).toEqual({});
  });

  it('keeps at most eight short string keys per action', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `K${i}`);
    const out = cleanBindings({ undo: ['Ctrl+Z', '', 5, 'x'.repeat(41), ...keys], bad: 'Ctrl+Y' });
    expect(out.undo).toEqual(['Ctrl+Z', 'K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
    expect(out.bad).toBeUndefined();
  });

  it('cuts action names to 120 characters', () => {
    const out = cleanBindings({ ['a'.repeat(200)]: ['F1'] });
    expect(Object.keys(out)).toEqual(['a'.repeat(120)]);
  });
});

describe('systemLang', () => {
  it('maps regional aliases to supported languages', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh_Hant']);
    expect(systemLang()).toBe('zh-TW');
  });

  it('falls back to English for an unknown language', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['xx-QQ']);
    expect(systemLang()).toBe('en');
  });
});

describe('updatePrefs and dialog memory', () => {
  it('merges a patch, saves it and reads it back', () => {
    const p = updatePrefs({ undoDepth: 50, animations: false });
    expect(p.undoDepth).toBe(50);
    const again = loadPrefs();
    expect(again.undoDepth).toBe(50);
    expect(again.animations).toBe(false);
    expect(again.autosaveSeconds).toBe(DEFAULT_PREFS.autosaveSeconds);
  });

  it('remembers dialog values per dialog and field', () => {
    remembered('export', 'fmt', 'gif');
    remembered('export', 'loop', true);
    remembered('import', 'fmt', 'png');
    expect(recalled('export', 'fmt')).toBe('gif');
    expect(recalled('export', 'loop')).toBe(true);
    expect(recalled('import', 'fmt')).toBe('png');
    expect(recalled('export', 'missing')).toBeUndefined();
    expect(recalled('nothing', 'fmt')).toBeUndefined();
  });

  it('does not write again when the remembered value is unchanged', () => {
    remembered('export', 'fmt', 'gif');
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const marked = JSON.stringify({ ...raw, marker: 1 });
    localStorage.setItem(KEY, marked);
    remembered('export', 'fmt', 'gif');
    expect(localStorage.getItem(KEY)).toBe(marked);
    remembered('export', 'fmt', 'mp4');
    expect(localStorage.getItem(KEY)).not.toContain('marker');
    expect(recalled('export', 'fmt')).toBe('mp4');
  });
});

describe('interface scale', () => {
  it('accepts only the listed scale choices', () => {
    expect(uiScaleChoice()).toBe('1');
    localStorage.setItem('formmorpheus.uiZoom', '1.25');
    expect(uiScaleChoice()).toBe('1.25');
    localStorage.setItem('formmorpheus.uiZoom', '3');
    expect(uiScaleChoice()).toBe('1');
  });

  it('stores a new scale and announces it', () => {
    const seen = vi.fn();
    window.addEventListener('formmorpheus:ui-zoom', seen);
    setUiScale('1.5');
    window.removeEventListener('formmorpheus:ui-zoom', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(uiScaleChoice()).toBe('1.5');
  });
});

describe('applyUiFontSize', () => {
  it('scales the font size tokens and clears them again at the default size', () => {
    const s = document.documentElement.style;
    applyUiFontSize({ ...DEFAULT_PREFS, uiFontSize: 'large' });
    expect(s.getPropertyValue('--fs-12')).toBe('13.8px');
    expect(s.getPropertyValue('--fs-10')).toBe('11.5px');
    applyUiFontSize({ ...DEFAULT_PREFS, uiFontSize: 'default' });
    expect(s.getPropertyValue('--fs-12')).toBe('');
  });
});
