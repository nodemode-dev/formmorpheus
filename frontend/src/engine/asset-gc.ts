import type { Content, DrawingLayer, Movie, Track } from './types';

/** Asset ids a movie really uses: content assets, layer pixels and layer masks (groups and Flipbook frames included). */
export function usedAssetIds(movies: Movie[], extra: Content[] = []): Set<string> {
  const ids = new Set<string>();
  const layer = (l: DrawingLayer): void => { if (l.pixels) ids.add(l.pixels); if (l.mask) ids.add(l.mask); };
  const walk = (tracks: Track[]): void => {
    for (const t of tracks) for (const c of t.content) one(c);
  };
  const one = (c: Content): void => {
    if (c.asset) ids.add(c.asset);
    c.layers.forEach(layer);
    for (const row of c.flip) for (const f of row.frames) f.layers.forEach(layer);
    if (c.tracks.length) walk(c.tracks);
  };
  for (const m of movies) walk(m.tracks);
  extra.forEach(one);
  return ids;
}

/**
 * Picture assets (kind 'pixels') that no movie in `movies` uses any more: every stroke commit writes new PNGs and the old
 * ones stay behind in the asset records, the blob map and every saved file unless they are let go.
 */
export function strayPixels(live: Movie, movies: Movie[], extra: Content[] = []): string[] {
  const used = usedAssetIds([live, ...movies], extra);
  return Object.values(live.assets).filter((a) => a.kind === 'pixels' && !used.has(a.id)).map((a) => a.id);
}
