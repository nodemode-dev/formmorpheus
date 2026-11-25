// Update from Source: a character group freshly read from its SVG laid over the character in the movie, part by part
// name. A matched part takes the new art and keeps its animation; a new part is added; a part gone from the file stays. Pure, no DOM.
import { usedAssetIds } from './asset-gc';
import { updateInner } from './group-inner-ops';
import { uid } from './model';
import * as ops from './ops';
import { findContent } from './transform';
import type { Asset, Content, Highlight, Movie, Track } from './types';

export interface SourceMerge {
  movie: Movie;
  /** Part names that were new in the file and were added on top. */
  added: string[];
  /** Part names the file no longer has: kept, and marked with the red highlight. */
  missing: string[];
}

export const MISSING_HIGHLIGHT: Highlight = 'red';

interface Found { c: Content; track: Track }

function index(tracks: Track[], out = new Map<string, Found>()): Map<string, Found> {
  for (const track of tracks) for (const c of track.content) {
    out.set(c.id, { c, track });
    if (c.kind === 'group') index(c.tracks, out);
  }
  return out;
}

function mapIn(tracks: Track[], fn: (c: Content) => Content): Track[] {
  return tracks.map((t) => ({ ...t, content: t.content.map((c) => {
    const n = fn(c);
    return n.kind === 'group' && n.tracks.length ? { ...n, tracks: mapIn(n.tracks, fn) } : n;
  }) }));
}

const holds = (tracks: Track[], ids: Set<string>): boolean => tracks.some((t) => t.content.some((c) => ids.has(c.id) || holds(c.tracks, ids)));

/**
 * The old part with the new picture: kind, shape, picture asset, layers, inner blocks of a part drawn with several
 * shapes, canvas and pivot. A Flipbook made in the app, and a group that holds other parts, are never swapped.
 */
function takeArt(old: Content, fresh: Content, partIds: Set<string>): Content {
  if (old.kind === 'flipbook' && fresh.kind !== 'flipbook') return old;
  if (old.kind === 'group' && holds(old.tracks, partIds)) return old;
  const { shape: _s, canvas: _c, pivot: _p, ...rest } = old;
  const next: Content = { ...rest, kind: fresh.kind, asset: fresh.asset, layers: fresh.layers, tracks: fresh.kind === 'group' ? fresh.tracks : [], flip: fresh.kind === 'flipbook' ? fresh.flip : old.flip };
  if (fresh.shape) next.shape = fresh.shape;
  if (fresh.canvas) next.canvas = fresh.canvas;
  if (fresh.pivot) next.pivot = fresh.pivot;
  return next;
}

/**
 * Lays `fresh` (a character Group just imported from the source file) over the character `charId` as one edit.
 * `assets` is the import's asset table: the records of the pictures the taken parts use are added to the movie
 * (the caller stores their blobs, as an import does).
 */
export function mergeFromSource(movie: Movie, charId: string, fresh: Content, assets: Record<string, Asset> = {}): SourceMerge {
  const g = findContent(movie, charId);
  if (!g || g.kind !== 'group' || !g.character) throw new ops.OpError('That character no longer exists.');
  if (fresh.kind !== 'group' || !fresh.character) throw new ops.OpError('The source file did not read as a character.');
  const oldParts = g.character.parts, freshParts = fresh.character.parts;
  const have = index(g.tracks), got = index(fresh.tracks);
  const nameOfFresh = new Map<string, string>();
  for (const [name, id] of Object.entries(freshParts)) nameOfFresh.set(id, name);

  const matched = new Map<string, Content>();
  const added: string[] = [], missing: string[] = [];
  const newIds: Record<string, string> = {};
  const born: { name: string; c: Content }[] = [];
  for (const [name, fid] of Object.entries(freshParts)) {
    const f = got.get(fid)?.c;
    if (!f) continue;
    const mine = oldParts[name] ? have.get(oldParts[name]) : undefined;
    if (mine) {
      if (mine.track.locked) throw new ops.OpError(`The part ${name} is on a locked track.`);
      matched.set(mine.c.id, f);
      continue;
    }
    const copy = ops.cloneContent(f, f.start);
    newIds[name] = copy.id;
    born.push({ name, c: copy });
    added.push(name);
  }
  for (const [name, id] of Object.entries(oldParts)) if (!(name in freshParts) && have.has(id)) missing.push(name);

  const idFor = (freshId: string | undefined): string | undefined => {
    const name = freshId ? nameOfFresh.get(freshId) : undefined;
    if (!name) return undefined;
    return newIds[name] ?? (have.has(oldParts[name] ?? '') ? oldParts[name] : undefined);
  };
  const direct = g.tracks.flatMap((t) => t.content);
  const from = direct.length ? Math.min(...direct.map((c) => c.start)) : g.offset;
  const to = direct.length ? Math.max(...direct.map((c) => c.start + c.duration)) : g.offset + g.duration;
  const freshOf = new Map(born.map((b) => [b.c.id, got.get(freshParts[b.name])?.c]));
  const newTracks: Track[] = born.map(({ c }) => {
    const parent = idFor(freshOf.get(c.id)?.parent);
    const { parent: _drop, ...rest } = c;
    const placed: Content = { ...rest, start: from, duration: Math.max(1, to - from), ...(parent ? { parent } : {}) };
    return { id: uid('t'), name: c.name, hidden: false, content: [placed] };
  });

  const gone = new Set(missing.map((n) => oldParts[n]).filter((id) => !have.get(id)?.track.locked));
  const partIds = new Set(Object.values(oldParts));
  const tracks = [...newTracks, ...mapIn(g.tracks, (c) => {
    const f = matched.get(c.id);
    if (f) return takeArt(c, f, partIds);
    if (gone.has(c.id)) return { ...c, highlight: MISSING_HIGHLIGHT };
    return c;
  })];

  const taken = [...matched.values(), ...born.map((b) => b.c)];
  const table: Record<string, Asset> = {};
  for (const id of usedAssetIds([], taken)) if (assets[id] && !movie.assets[id]) table[id] = assets[id];
  const info = g.character;
  const next = (c: Content): Content => ({ ...c, tracks, character: { ...info, parts: { ...oldParts, ...newIds } } });
  const withAssets: Movie = Object.keys(table).length ? { ...movie, assets: { ...movie.assets, ...table } } : movie;
  const top = movie.tracks.some((t) => t.content.some((c) => c.id === charId));
  const out = top ? ops.updateContent(withAssets, charId, next) : updateInner(withAssets, charId, next);
  return { movie: out, added, missing };
}
