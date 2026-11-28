// Fonts that travel with the movie: every font asset is loaded into document.fonts so Text can use its family.
import type { Movie } from '../engine/types';
import { bumpFontEpoch } from '../engine/text-layout';
import { libraryFamilies } from '../io/fonts-library';
import { BUNDLED_EXTRA, extraFaces, isExtraFamily, loadExtraFace, scriptFamilies } from './font-bundle';

const loaded = new Map<string, FontFace>();

/** Registers one font file under `family`; safe to call again for the same key. */
export async function registerFont(key: string, family: string, blob: Blob): Promise<void> {
  if (loaded.has(key)) return;
  const data = await blob.arrayBuffer();
  // Regular and Bold of one family must register as different faces of it, not replace each other
  const face = new FontFace(family, data, faceStyle(new Uint8Array(data)));
  await face.load();
  if (loaded.has(key)) return;
  document.fonts.add(face);
  loaded.set(key, face);
}

/** Takes one registered face out of the page (a font removed from the Fonts library). */
export function unregisterFont(key: string): void {
  const face = loaded.get(key);
  if (!face) return;
  try { document.fonts.delete(face); } catch { /* already gone */ }
  loaded.delete(key);
  bumpFontEpoch();
}

/** Drops the faces of fonts that no open movie owns (keys are asset ids), so closed movies do not pile up in document.fonts. */
export function evictFonts(keep: ReadonlySet<string>): void {
  for (const [key, face] of loaded) {
    // the Fonts library belongs to the app, not to a movie
    if (keep.has(key) || key.startsWith('lib:')) continue;
    try { document.fonts.delete(face); } catch { /* already gone */ }
    loaded.delete(key);
  }
  bumpFontEpoch();
}

/** Weight and style from the OpenType OS/2 table (usWeightClass, fsSelection italic bit); defaults for WOFF or no table. */
function faceStyle(b: Uint8Array): FontFaceDescriptors {
  const tag = (o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 12 || !(b[0] === 0 || tag(0) === 'OTTO' || tag(0) === 'true')) return {};
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    const n = dv.getUint16(4);
    for (let i = 0; i < n; i++) {
      const r = 12 + i * 16;
      if (tag(r) !== 'OS/2') continue;
      const off = dv.getUint32(r + 8);
      const weight = dv.getUint16(off + 4);
      const italic = (dv.getUint16(off + 62) & 1) === 1;
      return { weight: String(Math.max(1, Math.min(1000, weight || 400))), style: italic ? 'italic' : 'normal' };
    }
  } catch { /* a short or odd table: defaults */ }
  return {};
}

/** Loads every font asset of the movie (idempotent); a damaged font is skipped, not fatal. */
export async function registerFonts(movie: Movie, blobOf: (assetId: string) => Blob | undefined): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const a of Object.values(movie.assets)) {
    if (a.kind !== 'font' || !a.family) continue;
    const blob = blobOf(a.id);
    if (!blob) continue;
    jobs.push(registerFont(a.id, a.family, blob).catch(() => undefined));
  }
  await Promise.all(jobs);
}

/** Families offered for Text: the built-in two, then the movie's own. */
export function FONT_FAMILIES(movie: Movie): string[] {
  const out = [...BUNDLED_FONTS];
  for (const f of libraryFamilies()) if (!out.includes(f)) out.push(f);
  for (const a of Object.values(movie.assets)) {
    if (a.kind === 'font' && a.family && !out.includes(a.family)) out.push(a.family);
  }
  return out;
}

/** Families that ship with the app (their weights and italics are bundled). */
export const BUNDLED_FONTS = ['Inter', 'JetBrains Mono', ...BUNDLED_EXTRA.map((f) => f.name)];
const BUNDLED_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const SYSTEM_CANDIDATES = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Palatino', 'Garamond', 'Comic Sans MS', 'Noto Sans', 'Noto Serif', 'Noto Sans JP', 'Noto Sans Arabic', 'Noto Sans Thai', 'Noto Sans Devanagari', 'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', 'Segoe UI', 'SF Pro Text', 'Menlo', 'Consolas'];
export const GENERIC_FONTS = ['sans-serif', 'serif', 'monospace', 'cursive'];

export interface FontGroups { bundled: string[]; library: string[]; movie: string[]; system: string[] }

let systemFonts: string[] | null = null;
/** Installed system families from a short list, found by measuring against two fallbacks. */
function installedSystemFonts(): string[] {
  if (systemFonts) return systemFonts;
  const out: string[] = [];
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (c) {
      const probe = 'mmmmmmmmmmlliWWW@@ 日本語العربية';
      const w = (f: string): number => { c.font = `72px ${f}`; return c.measureText(probe).width; };
      const base = ['monospace', 'serif', 'sans-serif'].map((b) => [b, w(b)] as const);
      // A name the system merely aliases to another face (an unknown name resolved to the app's own Inter, say) measures
      // like that face: it is not installed under its own name.
      const alias = ['Inter', 'JetBrains Mono', ...BUNDLED_EXTRA.map((f) => f.name)].map((n) => w(`"${n}", monospace`));
      for (const name of SYSTEM_CANDIDATES) {
        if (granted && !granted.has(name.toLowerCase())) continue;
        const own = w(`"${name}", monospace`);
        if (base.some(([b, bw]) => w(`"${name}", ${b}`) !== bw) && !alias.includes(own)) out.push(name);
      }
    }
  } catch { /* no canvas: only the generic families */ }
  systemFonts = out;
  return out;
}

// Where the browser's Local Font Access is already allowed, its list is the truth (family names, lower case).
let granted: Set<string> | null = null;
try {
  const nav = navigator as Navigator & { queryLocalFonts?: () => Promise<Array<{ family: string }>> };
  if (nav.queryLocalFonts && navigator.permissions) {
    void navigator.permissions.query({ name: 'local-fonts' as PermissionName }).then((p) => {
      if (p.state !== 'granted') return;
      return nav.queryLocalFonts?.().then((list) => { granted = new Set(list.map((f) => f.family.toLowerCase())); systemFonts = null; });
    }).catch(() => undefined);
  }
} catch { /* the width probe stands */ }

/** The font browser's families: bundled, the movie's own, then the system's. */
export function fontCatalog(movie: Movie | null): FontGroups {
  const lib = libraryFamilies().filter((f) => !BUNDLED_FONTS.includes(f));
  const own = movie ? FONT_FAMILIES(movie).filter((f) => !BUNDLED_FONTS.includes(f) && !lib.includes(f)) : [];
  return { bundled: BUNDLED_FONTS.slice(), library: lib, movie: own, system: [...installedSystemFonts(), ...GENERIC_FONTS] };
}

/** Weights a family offers, and whether it has an italic; imported families report what their files declare. */
export function familyFaces(family: string): { weights: number[]; italic: boolean } {
  const extra = extraFaces(family);
  if (extra) return extra;
  if (family === 'Inter' || family === 'JetBrains Mono') return { weights: family === 'Inter' ? BUNDLED_WEIGHTS : BUNDLED_WEIGHTS.slice(0, 8), italic: true };
  const own = Array.from(loaded.values()).filter((f) => f.family.replace(/^["']|["']$/g, '') === family);
  if (own.length) {
    const ws = Array.from(new Set(own.map((f) => Number.parseInt(f.weight, 10) || 400))).sort((a, b) => a - b);
    return { weights: ws, italic: own.some((f) => f.style === 'italic') };
  }
  return { weights: [400, 700], italic: true };
}

/** Starts loading the faces a Text needs; resolves when they are ready (a missing font is not an error). */
export async function ensureTextFont(s: { font: string; weight: number; italic?: boolean; size: number; text: string }): Promise<void> {
  try {
    const text = s.text || 'Aa';
    const need = scriptFamilies(text);
    // Own family first, then the Noto faces for the scripts in the text (each fetches only the slices it draws)
    await Promise.all([loadExtraFace(s.font, s.weight, !!s.italic), ...need.map((f) => loadExtraFace(f, s.weight, false))]);
    await Promise.all([
      document.fonts.load(`${s.italic ? 'italic ' : ''}${s.weight} 32px "${s.font}"`, text),
      ...need.map((f) => document.fonts.load(`${s.weight} 32px "${f}"`, text)),
    ]);
  } catch { /* fallback face */ }
}

/** Loads a family's regular face so its name in the list shows in it. */
export function previewFont(family: string): void { if (isExtraFamily(family)) void loadExtraFace(family, 400, false); }

/** Loads the faces of every Text in the movie (used before an export and on open). */
export async function loadTextFonts(movie: Movie): Promise<void> {
  const jobs: Promise<void>[] = [];
  const walk = (tracks: Movie['tracks']): void => {
    for (const t of tracks) for (const c of t.content) {
      if (c.kind === 'text' && c.text) jobs.push(ensureTextFont(c.text));
      if (c.kind === 'group') walk(c.tracks);
    }
  };
  walk(movie.tracks);
  const sub = subtitleFace(movie);
  if (sub) jobs.push(ensureTextFont(sub));
  await Promise.all(jobs);
}

/** The face the subtitles are drawn in with the words they show, or null when the video shows none. */
export function subtitleFace(movie: Movie): { font: string; weight: number; size: number; text: string } | null {
  const s = movie.subtitles;
  if (!s || !s.show || !s.cues.length) return null;
  // enough of the words to find the scripts they use, without building a huge string
  return { font: s.style.font, weight: 600, size: 32, text: s.cues.slice(0, 400).map((c) => c.text).join(' ').slice(0, 8000) };
}

// A face that finishes loading changes the letters' widths: pictures of Text are drawn again.
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', () => { bumpFontEpoch(); window.dispatchEvent(new Event('fm:fonts')); });
}
