// Fonts that travel with the movie: every font asset is loaded into document.fonts so Text can use its family.
import type { Movie } from '../engine/types';

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
  const out = ['Inter', 'JetBrains Mono'];
  for (const a of Object.values(movie.assets)) {
    if (a.kind === 'font' && a.family && !out.includes(a.family)) out.push(a.family);
  }
  return out;
}
