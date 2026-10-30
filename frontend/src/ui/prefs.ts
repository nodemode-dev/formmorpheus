import { THEMES, readChoice, setTheme } from './themes';
import { isLang, LANG_CODES, type Lang } from './i18n/langs';

export type DialogValue = string | boolean;
export type UiFontSize = 'small' | 'default' | 'large' | 'larger';
export const UI_FONT_SIZES: ReadonlyArray<readonly [UiFontSize, string]> = [['small', 'Small'], ['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']];
export const UI_FONT_SCALE: Record<UiFontSize, number> = { small: 0.9, default: 1, large: 1.15, larger: 1.3 };
export const UNDO_CHOICES: ReadonlyArray<readonly [string, string]> = [['10', '10'], ['20', '20'], ['50', '50'], ['100', '100'], ['250', '250'], ['1000', '1000'], ['0', 'Unlimited']];
export const SCRUB_SPEEDS: ReadonlyArray<readonly [ScrubSpeed, string]> = [['precise', 'Precise'], ['medium', 'Medium'], ['fast', 'Fast']];
export type ScrubSpeed = 'precise' | 'medium' | 'fast';

export interface Prefs {
  language: Lang;
  autoShowHome: boolean;
  homeOnLastClose: boolean;
  whatsNewAuto: boolean;
  whatsNewSeen: string;
  noticeSeconds: number;
  uiFontSize: UiFontSize;
  animations: boolean;
  themeAuto: boolean;
  themeLight: string;
  themeDark: string;
  favouriteThemes: string[];
  shortcuts: Record<string, string[]>;
  menuHidden: string[];
  menuColors: Record<string, string>;
  dialogValues: Record<string, Record<string, DialogValue>>;
  recent: string[];
  undoDepth: number;
  autosaveSeconds: number;
  stageShare: number;
  scrubSpeed: ScrubSpeed;
  undoGestures: boolean;
  confirmDelete: boolean;
  /** Compose the Stage and exports on the GPU (WebGL2) when it matches the CPU path. */
  gpu: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  language: 'en', autoShowHome: true, homeOnLastClose: true, whatsNewAuto: true, whatsNewSeen: '', noticeSeconds: 0,
  uiFontSize: 'default', animations: true, themeAuto: false, themeLight: 'light', themeDark: 'studio', favouriteThemes: [],
  shortcuts: {}, menuHidden: [], menuColors: {}, dialogValues: {}, recent: [], undoDepth: 50, autosaveSeconds: 30,
  stageShare: 0.56, scrubSpeed: 'medium', undoGestures: true, confirmDelete: false, gpu: true,
};

const KEY = 'formmorpheus.prefs';
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const flag = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown, max: number, len = 400): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= len).slice(0, max) : []);

export function cleanBindings(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!plain(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 3000)) if (Array.isArray(x)) out[k.slice(0, 120)] = x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 40).slice(0, 8);
  return out;
}

function cleanDialogValues(v: unknown): Record<string, Record<string, DialogValue>> {
  const out: Record<string, Record<string, DialogValue>> = {};
  if (!plain(v)) return out;
  for (const [d, vals] of Object.entries(v).slice(0, 200)) {
    if (!plain(vals)) continue;
    const row: Record<string, DialogValue> = {};
    for (const [k, x] of Object.entries(vals).slice(0, 80)) if ((typeof x === 'string' && x.length <= 2000) || typeof x === 'boolean') row[k.slice(0, 120)] = x;
    out[d.slice(0, 120)] = row;
  }
  return out;
}

function cleanMenuColors(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!plain(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 2000)) if (typeof x === 'string' && /^[a-z]{3,10}$/.test(x)) out[k.slice(0, 120)] = x;
  return out;
}

const LANG_ALIASES: Record<string, Lang> = { 'zh-hant': 'zh-TW', 'zh-hk': 'zh-TW', 'zh-mo': 'zh-TW', zh: 'zh-CN', pt: 'pt-BR', no: 'nb', nn: 'nb', sr: 'sr-Latn', 'es-419': 'es-MX', 'es-us': 'es-MX' };
export function systemLang(): Lang {
  try {
    for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language]) {
      const parts = raw.replace(/_/g, '-').toLowerCase().split('-');
      for (let n = parts.length; n > 0; n--) {
        const tag = parts.slice(0, n).join('-');
        const hit = LANG_ALIASES[tag] ?? LANG_CODES.find((c) => c.toLowerCase() === tag);
        if (hit) return hit;
      }
    }
  } catch { /* English */ }
  return 'en';
}

export function loadPrefs(): Prefs {
  const d = DEFAULT_PREFS;
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Prefs, unknown>>;
    const size = r.uiFontSize;
    const scrub = r.scrubSpeed;
    return {
      language: isLang(r.language) ? r.language : 'en',
      autoShowHome: flag(r.autoShowHome, d.autoShowHome),
      homeOnLastClose: flag(r.homeOnLastClose, d.homeOnLastClose),
      whatsNewAuto: flag(r.whatsNewAuto, d.whatsNewAuto),
      whatsNewSeen: typeof r.whatsNewSeen === 'string' ? r.whatsNewSeen.slice(0, 40) : d.whatsNewSeen,
      noticeSeconds: Math.round(num(r.noticeSeconds, 0, 60, d.noticeSeconds)),
      uiFontSize: size === 'small' || size === 'large' || size === 'larger' ? size : 'default',
      animations: flag(r.animations, d.animations),
      themeAuto: flag(r.themeAuto, d.themeAuto),
      themeLight: typeof r.themeLight === 'string' && THEMES[r.themeLight] ? r.themeLight : d.themeLight,
      themeDark: typeof r.themeDark === 'string' && THEMES[r.themeDark] ? r.themeDark : d.themeDark,
      favouriteThemes: Array.from(new Set(strings(r.favouriteThemes, 30, 80).filter((x) => !!THEMES[x]))),
      shortcuts: cleanBindings(r.shortcuts),
      menuHidden: strings(r.menuHidden, 2000, 120),
      menuColors: cleanMenuColors(r.menuColors),
      dialogValues: cleanDialogValues(r.dialogValues),
      recent: strings(r.recent, 30, 1000),
      undoDepth: Math.round(num(r.undoDepth, 0, 1000, d.undoDepth)),
      autosaveSeconds: Math.round(num(r.autosaveSeconds, 0, 600, d.autosaveSeconds)),
      stageShare: num(r.stageShare, 0.25, 0.8, d.stageShare),
      scrubSpeed: scrub === 'precise' || scrub === 'fast' ? scrub : 'medium',
      undoGestures: flag(r.undoGestures, d.undoGestures),
      confirmDelete: flag(r.confirmDelete, d.confirmDelete),
      gpu: flag(r.gpu, d.gpu),
    };
  } catch {
    return { ...d, language: systemLang() };
  }
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* kept for this session only */ }
}

export function updatePrefs(patch: Partial<Prefs>): Prefs {
  const p = { ...loadPrefs(), ...patch };
  savePrefs(p);
  return p;
}

export const recalled = (dialog: string, name: string): DialogValue | undefined => loadPrefs().dialogValues[dialog]?.[name];

export function remembered(dialog: string, name: string, value: DialogValue): void {
  const cur = loadPrefs().dialogValues;
  if (cur[dialog]?.[name] === value) return;
  updatePrefs({ dialogValues: { ...cur, [dialog]: { ...cur[dialog], [name]: value } } });
}

let sizedK = 0;
let pxFontSheet: HTMLStyleElement | null = null;
let pxFontFactor = 1;

export function applyUiFontSize(p: Prefs): void {
  const k = UI_FONT_SCALE[p.uiFontSize], s = document.documentElement.style;
  for (const n of [9, 10, 11, 12, 13, 14, 16, 18]) { if (k === 1) s.removeProperty(`--fs-${n}`); else s.setProperty(`--fs-${n}`, `${Math.round(n * k * 10) / 10}px`); }
  scalePxFonts(k);
  if (k !== sizedK) { const first = sizedK === 0; sizedK = k; if (!first) document.dispatchEvent(new CustomEvent('nm:ui-settings-changed', { detail: { key: 'fontSize' } })); }
}

function scalePxFonts(k: number): void {
  if (k === pxFontFactor) return;
  pxFontFactor = k;
  if (!pxFontSheet) { if (k === 1) return; pxFontSheet = document.createElement('style'); pxFontSheet.dataset.role = 'ui-font-scale'; document.head.appendChild(pxFontSheet); }
  const walk = (rules: CSSRuleList): string => {
    let out = '';
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(r.style.getPropertyValue('font-size'));
        if (m && r.selectorText) out += `${r.selectorText}{font-size:${Math.round(parseFloat(m[1]) * k * 10) / 10}px}`;
      } else if (r instanceof CSSMediaRule) { const inner = walk(r.cssRules); if (inner) out += `@media ${r.media.mediaText}{${inner}}`; }
    }
    return out;
  };
  let css = '';
  if (k !== 1) for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.ownerNode === pxFontSheet) continue;
    try { css += walk(sheet.cssRules); } catch { /* another origin */ }
  }
  pxFontSheet.textContent = css;
}

export const UI_SCALES: ReadonlyArray<readonly [string, string]> = [['0.8', '80%'], ['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%'], ['1.5', '150%']];
export function uiScaleChoice(): string {
  try { const v = localStorage.getItem('formmorpheus.uiZoom') ?? '1'; return UI_SCALES.some(([k]) => k === v) ? v : '1'; } catch { return '1'; }
}
export function setUiScale(v: string): void {
  try { localStorage.setItem('formmorpheus.uiZoom', v); } catch { /* kept for this session only */ }
  window.dispatchEvent(new Event('formmorpheus:ui-zoom'));
}

let systemScheme: MediaQueryList | null = null;
let systemSchemeOn: (() => void) | null = null;
export function followSystemTheme(p: Prefs): void {
  if (typeof matchMedia !== 'function') return;
  if (!systemScheme) systemScheme = matchMedia('(prefers-color-scheme: dark)');
  if (systemSchemeOn) { systemScheme.removeEventListener('change', systemSchemeOn); systemSchemeOn = null; }
  if (!p.themeAuto) return;
  const pick = (): void => { const id = systemScheme?.matches ? p.themeDark : p.themeLight; if (readChoice().theme !== id) setTheme(id); };
  systemSchemeOn = pick;
  systemScheme.addEventListener('change', pick);
  pick();
}

export function applyShellPrefs(p: Prefs): void {
  applyUiFontSize(p);
  followSystemTheme(p);
  document.body.classList.toggle('animations-disabled', !p.animations);
}
