// Fit / Fill / Original size for pictures and video, centred in the movie.
import { OpError, updateContent } from './ops';
import type { Content, Movie } from './types';

export type SizeMode = 'fit' | 'fill' | 'original';
export const SIZE_MODES: { id: SizeMode; label: string }[] = [
  { id: 'fit', label: 'Fit to Stage' },
  { id: 'fill', label: 'Fill Stage' },
  { id: 'original', label: 'Original size' },
];

/** Scale that puts a picture of `w` x `h` at `mode` inside a `mw` x `mh` movie. */
export function scaleFor(mode: SizeMode, mw: number, mh: number, w: number, h: number): number {
  if (!(w > 0 && h > 0)) return 1;
  const k = mode === 'fit' ? Math.min(mw / w, mh / h) : mode === 'fill' ? Math.max(mw / w, mh / h) : 1;
  return Math.round(k * 10000) / 10000;
}

export function canSize(c: Content): boolean {
  return c.kind === 'image' || c.kind === 'video';
}

/** The transform of a picture at `mode`: centred, upright size kept (rotation and flips stay). */
export function sizedTransform(mode: SizeMode, movie: Movie, c: Content): Content['transform'] {
  const a = c.asset ? movie.assets[c.asset] : undefined;
  const t = { ...c.transform, x: 0, y: 0, scale: scaleFor(mode, movie.width, movie.height, a?.width ?? movie.width, a?.height ?? movie.height) };
  delete t.stretchX;
  delete t.stretchY;
  return t;
}

export function sizeContent(movie: Movie, ids: string[], mode: SizeMode): Movie {
  let m = movie;
  let any = false;
  for (const id of ids) {
    let hit = false;
    for (const t of m.tracks) if (t.content.some((c) => c.id === id && canSize(c))) hit = true;
    if (!hit) continue;
    any = true;
    m = updateContent(m, id, (c) => ({ ...c, transform: sizedTransform(mode, m, c) }));
  }
  if (!any) throw new OpError('Only pictures and video can be sized to the Stage.');
  return m;
}
