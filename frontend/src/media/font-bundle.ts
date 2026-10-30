// Open-licence families that ship with the app. Each face's stylesheet is a dynamic import, so nothing
// but the interface fonts is in the base bundle: a family loads when it is picked, previewed or used by a Text.
// The non-Latin Noto faces load only when a Text holds characters of their script.

type Loader = () => Promise<unknown>;

interface Family {
  name: string;
  /** Faces as `weight` or `weight-italic`. */
  faces: Record<string, Loader>;
  /** Short note for the list: what kind of face it is. */
  kind: string;
}

const fam = (name: string, kind: string, faces: Record<string, Loader>): Family => ({ name, kind, faces });

export const BUNDLED_EXTRA: Family[] = [
  fam('Lora', 'Serif', { '400': () => import('@fontsource/lora/400.css'), '700': () => import('@fontsource/lora/700.css'), '400-italic': () => import('@fontsource/lora/400-italic.css'), '700-italic': () => import('@fontsource/lora/700-italic.css') }),
  fam('Roboto Slab', 'Slab', { '400': () => import('@fontsource/roboto-slab/400.css'), '700': () => import('@fontsource/roboto-slab/700.css') }),
  fam('Nunito', 'Rounded sans', { '400': () => import('@fontsource/nunito/400.css'), '700': () => import('@fontsource/nunito/700.css'), '400-italic': () => import('@fontsource/nunito/400-italic.css'), '700-italic': () => import('@fontsource/nunito/700-italic.css') }),
  fam('Bebas Neue', 'Condensed display', { '400': () => import('@fontsource/bebas-neue/400.css') }),
  fam('Caveat', 'Handwriting', { '400': () => import('@fontsource/caveat/400.css'), '700': () => import('@fontsource/caveat/700.css') }),
  fam('Permanent Marker', 'Marker', { '400': () => import('@fontsource/permanent-marker/400.css') }),
  fam('Press Start 2P', 'Pixel', { '400': () => import('@fontsource/press-start-2p/400.css') }),
  fam('VT323', 'Pixel mono', { '400': () => import('@fontsource/vt323/400.css') }),
  fam('Noto Sans', 'Greek, Cyrillic', {
    '400': async () => { await Promise.all([import('@fontsource/noto-sans/greek-400.css'), import('@fontsource/noto-sans/greek-ext-400.css'), import('@fontsource/noto-sans/cyrillic-400.css'), import('@fontsource/noto-sans/cyrillic-ext-400.css'), import('@fontsource/noto-sans/latin-400.css'), import('@fontsource/noto-sans/latin-ext-400.css')]); },
    '700': async () => { await Promise.all([import('@fontsource/noto-sans/greek-700.css'), import('@fontsource/noto-sans/greek-ext-700.css'), import('@fontsource/noto-sans/cyrillic-700.css'), import('@fontsource/noto-sans/cyrillic-ext-700.css'), import('@fontsource/noto-sans/latin-700.css'), import('@fontsource/noto-sans/latin-ext-700.css')]); },
  }),
  fam('Noto Sans Arabic', 'Arabic', { '400': () => import('@fontsource/noto-sans-arabic/400.css'), '700': () => import('@fontsource/noto-sans-arabic/700.css') }),
  fam('Noto Sans JP', 'Japanese', { '400': () => import('@fontsource/noto-sans-jp/400.css'), '700': () => import('@fontsource/noto-sans-jp/700.css') }),
  fam('Noto Sans SC', 'Simplified Chinese', { '400': () => import('@fontsource/noto-sans-sc/400.css'), '700': () => import('@fontsource/noto-sans-sc/700.css') }),
  fam('Noto Sans KR', 'Korean', { '400': () => import('@fontsource/noto-sans-kr/400.css'), '700': () => import('@fontsource/noto-sans-kr/700.css') }),
  fam('Noto Sans Thai', 'Thai', { '400': () => import('@fontsource/noto-sans-thai/400.css'), '700': () => import('@fontsource/noto-sans-thai/700.css') }),
  fam('Noto Sans Devanagari', 'Devanagari', { '400': () => import('@fontsource/noto-sans-devanagari/400.css'), '700': () => import('@fontsource/noto-sans-devanagari/700.css') }),
];

const byName = new Map(BUNDLED_EXTRA.map((f) => [f.name, f]));
export const isExtraFamily = (name: string): boolean => byName.has(name);

/** Weights and italic availability of a lazily bundled family. */
export function extraFaces(name: string): { weights: number[]; italic: boolean } | null {
  const f = byName.get(name);
  if (!f) return null;
  const ws = new Set<number>();
  let italic = false;
  for (const k of Object.keys(f.faces)) { ws.add(Number.parseInt(k, 10)); if (k.endsWith('italic')) italic = true; }
  return { weights: Array.from(ws).sort((a, b) => a - b), italic };
}

export function extraKind(name: string): string { return byName.get(name)?.kind ?? ''; }

const started = new Map<string, Promise<unknown>>();

/** Imports the stylesheet of the face nearest to the weight asked for (once per face). */
export function loadExtraFace(name: string, weight: number, italic: boolean): Promise<void> {
  const f = byName.get(name);
  if (!f) return Promise.resolve();
  const keys = Object.keys(f.faces);
  const pool = italic && keys.some((k) => k.endsWith('italic')) ? keys.filter((k) => k.endsWith('italic')) : keys.filter((k) => !k.endsWith('italic'));
  const key = pool.reduce((a, b) => (Math.abs(Number.parseInt(b, 10) - weight) < Math.abs(Number.parseInt(a, 10) - weight) ? b : a), pool[0]);
  const id = `${name}|${key}`;
  let p = started.get(id);
  if (!p) { p = f.faces[key]().catch(() => undefined); started.set(id, p); }
  return p.then(() => undefined);
}

// ---- scripts -----------------------------------------------------------------------

interface Script { re: RegExp; families: string[] }

const SCRIPTS: Script[] = [
  { re: /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/, families: ['Noto Sans Arabic'] },
  { re: /[぀-ヿㇰ-ㇿｦ-ﾟ]/, families: ['Noto Sans JP'] },
  { re: /[가-힯ᄀ-ᇿ㄰-㆏]/, families: ['Noto Sans KR'] },
  { re: /[฀-๿]/, families: ['Noto Sans Thai'] },
  { re: /[ऀ-ॿ]/, families: ['Noto Sans Devanagari'] },
  { re: /[Ͱ-Ͽἀ-῿Ѐ-ԯ]/, families: ['Noto Sans'] },
];
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const KANA = /[぀-ヿㇰ-ㇿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;

/** Noto families a piece of text needs for characters the face in use does not carry. */
export function scriptFamilies(text: string): string[] {
  const out: string[] = [];
  for (const s of SCRIPTS) if (s.re.test(text)) out.push(...s.families);
  // Han with no kana or hangul beside it reads as Chinese here
  if (HAN.test(text) && !KANA.test(text) && !HANGUL.test(text)) out.push('Noto Sans SC');
  else if (HAN.test(text)) out.push(KANA.test(text) ? 'Noto Sans JP' : 'Noto Sans KR');
  return Array.from(new Set(out));
}
