// Update from Source: a character group freshly read from its SVG laid over the character in the movie, part by part
// name. A matched part takes the new art and keeps its animation; a new part is added; a part gone from the file stays. Pure, no DOM.
import { usedAssetIds } from './asset-gc';
import { updateInner } from './group-inner-ops';
import { uid } from './model';
import * as ops from './ops';
import { findContent } from './transform';
import type { Asset, Content, Highlight, Movie, SourceLink, Track } from './types';

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
      if (mine.track.locked) throw new ops.OpError('A part of this character is on a locked track. Unlock it, then update again.');
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
  const nameOf = new Map(Object.entries(oldParts).map(([n, id]) => [id, n]));
  const wasMissing = new Set(g.character.missing ?? []), prevWas = g.character.missingWas ?? {};
  // the red is the merge's mark, not the person's: a part that returns gets back what it had, one going missing has its own highlight kept
  const was: Record<string, Highlight> = {};
  for (const n of missing) if (prevWas[n]) was[n] = prevWas[n];
  const tracks = [...newTracks, ...mapIn(g.tracks, (c) => {
    const f = matched.get(c.id);
    const name = nameOf.get(c.id) ?? '';
    if (f) {
      const art = takeArt(c, f, partIds);
      return wasMissing.has(name) && art.highlight === MISSING_HIGHLIGHT ? { ...art, highlight: prevWas[name] ?? 'none' } : art;
    }
    if (gone.has(c.id)) {
      if (c.highlight !== MISSING_HIGHLIGHT && c.highlight !== 'none') was[name] = c.highlight;
      return { ...c, highlight: MISSING_HIGHLIGHT };
    }
    return c;
  })];

  const taken = [...matched.values(), ...born.map((b) => b.c)];
  const table: Record<string, Asset> = {};
  for (const id of usedAssetIds([], taken)) if (assets[id] && !movie.assets[id]) table[id] = assets[id];
  const { missing: _was, missingWas: _wasHl, ...info } = g.character;
  const kept = Object.keys(was).length ? { missingWas: was } : {};
  const next = (c: Content): Content => ({ ...c, tracks, character: { ...info, parts: { ...oldParts, ...newIds }, ...(missing.length ? { missing, ...kept } : {}) } });
  const withAssets: Movie = Object.keys(table).length ? { ...movie, assets: { ...movie.assets, ...table } } : movie;
  return { movie: editCharacter(withAssets, charId, next), added, missing };
}

function editCharacter(movie: Movie, charId: string, fn: (c: Content) => Content): Movie {
  const top = movie.tracks.some((t) => t.content.some((c) => c.id === charId));
  return top ? ops.updateContent(movie, charId, fn) : updateInner(movie, charId, fn);
}

/** Sets or removes (`null`) the character's source link. */
export function setSourceLink(movie: Movie, charId: string, link: SourceLink | null): Movie {
  const g = findContent(movie, charId);
  if (!g || g.kind !== 'group' || !g.character) throw new ops.OpError('That character no longer exists.');
  const { source: _old, ...info } = g.character;
  return editCharacter(movie, charId, (c) => ({ ...c, character: link ? { ...info, source: link } : info }));
}

/** Every character in the movie, nested ones too, that has a source link. */
export function linkedCharacters(movie: Movie): { id: string; source: SourceLink }[] {
  const out: { id: string; source: SourceLink }[] = [];
  const walk = (tracks: Track[]): void => {
    for (const t of tracks) for (const c of t.content) {
      if (c.kind === 'group' && c.character?.source) out.push({ id: c.id, source: c.character.source });
      if (c.tracks.length) walk(c.tracks);
    }
  };
  walk(movie.tracks);
  return out;
}

/** True when `id` is a part that the character holding it lists as not in its source file. */
export function isMissingPart(movie: Movie, id: string): boolean {
  let hit = false;
  const walk = (tracks: Track[]): void => {
    for (const t of tracks) for (const c of t.content) {
      if (hit) return;
      const ch = c.kind === 'group' ? c.character : undefined;
      if (ch?.missing?.some((n) => ch.parts[n] === id)) { hit = true; return; }
      if (c.tracks.length) walk(c.tracks);
    }
  };
  walk(movie.tracks);
  return hit;
}
