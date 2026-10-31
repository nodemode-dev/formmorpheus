// Media bin model: what each asset of a movie is, where it is used, and the edits the bin makes (replace, remove unused).
// Pure functions over a Movie; no DOM.
import { usedAssetIds } from './asset-gc';
import type { Asset, Content, Movie, Track } from './types';

export type BinKind = 'image' | 'video' | 'audio' | 'font' | 'drawing';

export interface BinUse { id: string; name: string }

export interface BinEntry {
  /** Stable key: the asset id, or `d:` plus the content id for a Drawing's or Flipbook's own pictures. */
  key: string;
  kind: BinKind;
  name: string;
  /** The asset (the first picture for a drawing entry). */
  asset: Asset;
  /** Bytes: the asset's, or the sum of a drawing's pictures. */
  size: number;
  /** Pictures counted in a drawing entry. */
  count: number;
  uses: BinUse[];
}

function eachContent(tracks: Track[], fn: (c: Content) => void): void {
  for (const t of tracks) for (const c of t.content) { fn(c); if (c.tracks.length) eachContent(c.tracks, fn); }
}

/** Pixel assets a Drawing or Flipbook content owns, in layer order. */
function pixelIds(c: Content): string[] {
  const out: string[] = [];
  const layer = (l: { pixels: string | null; mask?: string | null }): void => { if (l.pixels) out.push(l.pixels); if (l.mask) out.push(l.mask); };
  c.layers.forEach(layer);
  for (const row of c.flip) for (const f of row.frames) f.layers.forEach(layer);
  return out;
}

/** Every font family a Text block uses: its base font and the font of each styled run. */
function fontsOf(c: Content): string[] {
  if (!c.text) return [];
  const out = new Set<string>();
  if (c.text.font) out.add(c.text.font);
  for (const r of c.text.runs ?? []) if (r.font) out.add(r.font);
  return [...out];
}

export function binEntries(movie: Movie): BinEntry[] {
  const uses = new Map<string, BinUse[]>();
  const fontUse = new Map<string, BinUse[]>();
  const drawings: Content[] = [];
  eachContent(movie.tracks, (c) => {
    if (c.asset) { const l = uses.get(c.asset) ?? []; l.push({ id: c.id, name: c.name }); uses.set(c.asset, l); }
    for (const f of fontsOf(c)) { const l = fontUse.get(f) ?? []; l.push({ id: c.id, name: c.name }); fontUse.set(f, l); }
    if (c.kind === 'drawing' || c.kind === 'flipbook') drawings.push(c);
  });
  const out: BinEntry[] = [];
  for (const a of Object.values(movie.assets)) {
    if (a.kind === 'pixels') continue;
    const kind: BinKind = a.kind;
    const list = a.kind === 'font' ? fontUse.get(a.family ?? '') ?? [] : uses.get(a.id) ?? [];
    out.push({ key: a.id, kind, name: a.name, asset: a, size: a.size, count: 1, uses: list });
  }
  for (const c of drawings) {
    const ids = pixelIds(c).map((id) => movie.assets[id]).filter((a): a is Asset => !!a);
    if (!ids.length) continue;
    out.push({ key: `d:${c.id}`, kind: 'drawing', name: c.name, asset: ids[0], size: ids.reduce((s, a) => s + a.size, 0), count: ids.length, uses: [{ id: c.id, name: c.name }] });
  }
  const rank: Record<BinKind, number> = { video: 0, image: 1, audio: 2, font: 3, drawing: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function totalSize(movie: Movie): number {
  let n = 0;
  for (const a of Object.values(movie.assets)) n += a.size;
  return n;
}

/** Ids of files nothing uses (pictures a Drawing owns are left to the paint code). */
export function unusedIds(movie: Movie): string[] {
  const used = usedAssetIds([movie]);
  const fonts = new Set<string>();
  eachContent(movie.tracks, (c) => { for (const f of fontsOf(c)) fonts.add(f); });
  return Object.values(movie.assets)
    .filter((a) => a.kind !== 'pixels' && (a.kind === 'font' ? !fonts.has(a.family ?? '') : !used.has(a.id)))
    .map((a) => a.id);
}

export function removeAssets(movie: Movie, ids: string[]): Movie {
  if (!ids.length) return movie;
  const drop = new Set(ids);
  const assets: Movie['assets'] = {};
  for (const [k, a] of Object.entries(movie.assets)) if (!drop.has(k)) assets[k] = a;
  return { ...movie, assets };
}

function mapTracks(tracks: Track[], fn: (c: Content) => Content): Track[] {
  return tracks.map((t) => ({ ...t, content: t.content.map((c) => { const n = fn(c); return n.tracks.length ? { ...n, tracks: mapTracks(n.tracks, fn) } : n; }) }));
}

/**
 * Points every block that uses `oldId` at `next` (a new asset id, so undo brings the old file back) in one pass.
 * A picture or video keeps its on-Stage size; a video or sound block is cut to the new file's length; Text set in a
 * replaced font follows the new family.
 */
export function replaceAsset(movie: Movie, oldId: string, next: Asset): Movie {
  const old = movie.assets[oldId];
  if (!old) return movie;
  const sized = (old.kind === 'image' || old.kind === 'video') && old.width > 0 && next.width > 0;
  const frames = next.seconds ? Math.max(1, Math.round(next.seconds * movie.fps)) : next.frames;
  const fn = (c: Content): Content => {
    if (old.kind === 'font') {
      if (!c.text || !old.family || !next.family || !fontsOf(c).includes(old.family)) return c;
      const fam = next.family;
      const text = { ...c.text, font: c.text.font === old.family ? fam : c.text.font };
      if (c.text.runs?.some((r) => r.font === old.family)) text.runs = c.text.runs.map((r) => (r.font === old.family ? { ...r, font: fam } : r));
      return { ...c, text };
    }
    if (c.asset !== oldId) return c;
    let n: Content = { ...c, asset: next.id };
    if (sized) n = { ...n, transform: { ...c.transform, scale: c.transform.scale * (old.width / next.width) } };
    if ((c.kind === 'video' || c.kind === 'audio') && frames > 0 && c.speed === undefined && !c.reverse) {
      const offset = c.offset >= frames ? 0 : c.offset;
      n = { ...n, offset, duration: Math.max(1, Math.min(c.duration, frames - offset)) };
    }
    return n;
  };
  const assets: Movie['assets'] = {};
  for (const [k, a] of Object.entries(movie.assets)) if (k !== oldId) assets[k] = a;
  assets[next.id] = next;
  return { ...movie, assets, tracks: mapTracks(movie.tracks, fn) };
}
