// The app-wide Fonts library: font files the engine keeps in the data folder, installed once and offered in every movie.
// A movie still embeds the fonts its Text uses (embedLibraryFamily copies a library font into the movie when a Text picks it).
import type { Engine } from '../engine/engine';
import { uid } from '../engine/model';
import type { Asset, Content, Movie } from '../engine/types';

export interface LibFont { file: string; family: string; size: number }

const BASE = '/api/fonts';
let items: LibFont[] = [];
let ready = false;
const watchers = new Set<() => void>();
const blobs = new Map<string, Promise<Blob>>();

export const libraryKey = (file: string): string => `lib:${file}`;
export function onLibraryChange(fn: () => void): () => void { watchers.add(fn); return () => { watchers.delete(fn); }; }
const changed = (): void => { for (const fn of [...watchers]) fn(); window.dispatchEvent(new Event('fm:fonts')); };

export function libraryFonts(): readonly LibFont[] { return items; }
export function libraryFamilies(): string[] { return Array.from(new Set(items.map((f) => f.family))); }
export function inLibrary(family: string): boolean { return items.some((f) => f.family === family); }
export const libraryReady = (): boolean => ready;

function mimeOf(file: string): string {
  const e = file.split('.').pop()?.toLowerCase();
  return e === 'otf' ? 'font/otf' : e === 'woff' ? 'font/woff' : e === 'woff2' ? 'font/woff2' : 'font/ttf';
}

function fetchBlob(file: string): Promise<Blob> {
  let p = blobs.get(file);
  if (!p) {
    p = fetch(`${BASE}/${encodeURIComponent(file)}`).then(async (r) => { if (!r.ok) throw new Error('font'); return r.blob(); });
    p.catch(() => blobs.delete(file));
    blobs.set(file, p);
  }
  return p;
}

type Register = (key: string, family: string, blob: Blob) => Promise<void>;

/** Reads the library from the engine and registers every font with the page; a missing engine leaves the library empty. */
export async function loadLibrary(register: Register): Promise<void> {
  try {
    const res = await fetch(BASE);
    if (!res.ok) return;
    items = ((await res.json()) as { items: LibFont[] }).items;
  } catch { return; }
  ready = true;
  await Promise.all(items.map(async (f) => { try { await register(libraryKey(f.file), f.family, await fetchBlob(f.file)); } catch { /* a damaged file is skipped */ } }));
  changed();
}

/** Keeps a font file in the library (the engine stores it in the data folder); returns false when it could not. */
export async function addToLibrary(blob: Blob, fileName: string, family: string, register: Register): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(fileName)}?family=${encodeURIComponent(family)}`, { method: 'PUT', body: blob });
    if (!res.ok) return false;
    const e = (await res.json()) as LibFont;
    items = [...items.filter((f) => f.file !== e.file), e];
    blobs.set(e.file, Promise.resolve(blob));
    await register(libraryKey(e.file), e.family, blob).catch(() => undefined);
    changed();
    return true;
  } catch { return false; }
}

/** Removes every file of a family from the library. */
export async function removeFamily(family: string, unregister: (key: string) => void): Promise<boolean> {
  const mine = items.filter((f) => f.family === family);
  let ok = true;
  for (const f of mine) {
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(f.file)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) { ok = false; continue; }
      items = items.filter((x) => x.file !== f.file);
      blobs.delete(f.file);
      unregister(libraryKey(f.file));
    } catch { ok = false; }
  }
  changed();
  return ok;
}

function textFonts(m: Movie): Set<string> {
  const out = new Set<string>();
  const walk = (tracks: Movie['tracks']): void => {
    for (const t of tracks) for (const c of t.content as Content[]) {
      if (c.kind === 'text' && c.text) { out.add(c.text.font); for (const r of c.text.runs ?? []) if (r.font) out.add(r.font); }
      if (c.kind === 'group') walk(c.tracks);
    }
  };
  walk(m.tracks);
  return out;
}

/** Which families a movie's Text uses that the movie does not carry yet but the library has. */
export function missingEmbeds(m: Movie): string[] {
  const have = new Set(Object.values(m.assets).filter((a) => a.kind === 'font').map((a) => a.family));
  return Array.from(textFonts(m)).filter((f) => inLibrary(f) && !have.has(f));
}

/** Copies the library files of the families into the movie as font assets, as one undo step. */
export async function embedFamilies(engine: Engine, families: string[]): Promise<void> {
  const m = engine.movie;
  if (!m) return;
  const have = new Set(Object.values(m.assets).filter((a) => a.kind === 'font').map((a) => a.family));
  const todo = items.filter((f) => families.includes(f.family) && !have.has(f.family));
  if (!todo.length) return;
  const made: Asset[] = [];
  for (const f of todo) {
    try {
      const blob = await fetchBlob(f.file);
      const asset: Asset = { id: uid('a'), kind: 'font', name: f.file.replace(/\.[^.]+$/, ''), mime: mimeOf(f.file), width: 0, height: 0, frames: 0, size: f.size, family: f.family };
      engine.assets.set(asset.id, blob);
      made.push(asset);
    } catch { /* the engine is gone: the movie keeps the name only */ }
  }
  if (!made.length || engine.movie?.id !== m.id) return;
  engine.run('Embed fonts', (mv) => ({ ...mv, assets: { ...mv.assets, ...Object.fromEntries(made.map((a) => [a.id, a])) } }));
}

export const embedLibraryFamily = (engine: Engine, family: string): Promise<void> => embedFamilies(engine, [family]);
