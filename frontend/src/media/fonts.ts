// Fonts that travel with the movie: every font asset is loaded into document.fonts so Text can use its family.
import type { Movie } from '../engine/types';

const loaded = new Map<string, FontFace>();

/** Registers one font file under `family`; safe to call again for the same key. */
export async function registerFont(key: string, family: string, blob: Blob): Promise<void> {
  if (loaded.has(key)) return;
  const face = new FontFace(family, await blob.arrayBuffer());
  await face.load();
  if (loaded.has(key)) return;
  document.fonts.add(face);
  loaded.set(key, face);
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
  const out = ['Inter', 'JetBrains Mono'];
  for (const a of Object.values(movie.assets)) {
    if (a.kind === 'font' && a.family && !out.includes(a.family)) out.push(a.family);
  }
  return out;
}
