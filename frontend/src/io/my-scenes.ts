// The person's own scenes on the engine (/api/scenes): scenery saved from a movie as a small movie of its picture
// tracks, one .fmo each in the data folder's Scenes folder; and a saved scene laid behind everything in the open movie.
import { usedAssetIds } from '../engine/asset-gc';
import type { Engine } from '../engine/engine';
import { floorOf } from '../engine/guides';
import { content, end, identity, newMovie, relinkCharacter, track as makeTrack, uid } from '../engine/model';
import type { Renderer } from '../engine/render';
import { solidExtra } from '../engine/shape-ops';
import type { Asset, Content, Movie, Track } from '../engine/types';
import { t } from '../ui/i18n';
import { ApiError, serviceReady } from './api';
import { packMovie, unpackMovie } from './fmo';
import { lowFetch } from './thumb-queue';

export interface SceneItem { name: string; file: string; path: string; size: number; modified: number; created?: number }

const NOT_RUNNING = 'The FormMorpheus engine service is not running. Start it with ./formmorpheus.';

const at = (name: string): string => `/api/scenes/${encodeURIComponent(name)}`;

async function call(path: string, init?: RequestInit): Promise<Response> {
  if (!(await serviceReady())) throw new ApiError(NOT_RUNNING, 0);
  let res: Response;
  try { res = await fetch(path, init); } catch { throw new ApiError(NOT_RUNNING, 0); }
  if (!res.ok) {
    let detail = '';
    try { const body = (await res.json()) as { detail?: unknown }; if (typeof body?.detail === 'string') detail = body.detail; } catch { /* not JSON */ }
    throw new ApiError(detail || res.statusText || `Request failed (${res.status})`, res.status);
  }
  return res;
}

export const scenesApi = {
  /** Newest first. */
  async list(): Promise<{ folder: string; items: SceneItem[] }> {
    const body = (await (await call('/api/scenes')).json()) as { folder?: string; items?: SceneItem[] };
    return { folder: body.folder ?? '', items: body.items ?? [] };
  },
  async read(name: string): Promise<Blob> {
    return (await call(at(name))).blob();
  },
  async write(name: string, data: Blob): Promise<SceneItem> {
    return (await (await call(at(name), { method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' } })).json()) as SceneItem;
  },
  /** 409 when `to` is taken. */
  async rename(name: string, to: string): Promise<SceneItem> {
    return (await (await call(`${at(name)}/rename`, { method: 'POST', body: JSON.stringify({ to }), headers: { 'Content-Type': 'application/json' } })).json()) as SceneItem;
  },
  /** To Recently Deleted. */
  async remove(name: string): Promise<void> {
    await call(at(name), { method: 'DELETE' });
  },
  async poster(name: string, v?: number, el?: Element | null): Promise<Blob | null> {
    if (!(await serviceReady())) return null;
    try {
      const res = await lowFetch(`${at(name)}/poster${v ? `?v=${v}` : ''}`, { el });
      const b = res.ok ? await res.blob() : null;
      return b && b.size ? b : null;
    } catch { return null; }
  },
};

const walk = (items: Content[], hit: (c: Content) => boolean): boolean => items.some((c) => hit(c) || c.tracks.some((tr) => walk(tr.content, hit)));

export type TrackSort = 'picture' | 'character' | 'sound' | 'empty';

/** What a track mostly is, for the Save as Scene card: characters and sound are left out unless ticked. */
export function trackSort(tr: Track): TrackSort {
  if (!tr.content.length) return 'empty';
  if (walk(tr.content, (c) => !!c.character)) return 'character';
  if (walk(tr.content, (c) => c.kind === 'audio')) return 'sound';
  return 'picture';
}

export const inByDefault = (tr: Track): boolean => trackSort(tr) === 'picture';

/** The chosen tracks of `movie` as a scene movie of the same size and length: links to content outside them are cut. */
export function sceneOf(movie: Movie, trackIds: ReadonlySet<string>, withBackground: boolean): Movie {
  const picked = movie.tracks.filter((tr) => trackIds.has(tr.id));
  const own = new Set<string>();
  const collect = (c: Content): void => { own.add(c.id); for (const tr of c.tracks) tr.content.forEach(collect); };
  for (const tr of picked) tr.content.forEach(collect);
  const unlink = (c: Content): Content => {
    const { parent, ...rest } = c;
    const out: Content = parent && !own.has(parent) ? rest : c;
    return out.tracks.length ? { ...out, tracks: out.tracks.map((tr) => ({ ...tr, content: tr.content.map(unlink) })) } : out;
  };
  const tracks: Track[] = picked.map((tr) => ({ ...tr, content: tr.content.map(unlink) }));
  if (withBackground) tracks.push(makeTrack('Background', [content('solid', 0, movie.duration, solidExtra(movie.background))]));
  const used = usedAssetIds([], tracks.flatMap((tr) => tr.content));
  const assets: Record<string, Asset> = {};
  for (const id of used) if (movie.assets[id]) assets[id] = movie.assets[id];
  const scene: Movie = { ...newMovie({ name: movie.name, width: movie.width, height: movie.height, fps: movie.fps }), duration: movie.duration, background: movie.background, tracks, assets };
  const floor = floorOf(movie.guides);
  if (floor !== null) scene.guides = { lines: [{ axis: 'y', at: floor, role: 'floor' }] };
  return scene;
}

/** The scene drawn at `frame` as a 320 px wide picture, without the camera. */
async function posterOf(renderer: Renderer, scene: Movie, frame: number): Promise<Blob | null> {
  try {
    const pw = 320, ph = Math.max(1, Math.round((pw * scene.height) / scene.width));
    const f = Math.max(0, Math.min(scene.duration - 1, frame));
    await renderer.prepareFrame(scene, f);
    const cv = new OffscreenCanvas(pw, ph);
    renderer.drawFrame(cv.getContext('2d') as unknown as CanvasRenderingContext2D, scene, f, { scale: pw / scene.width, ox: 0, oy: 0, width: pw, height: ph }, { backstage: false, background: scene.background, transparentChecker: null, noCamera: true, exact: true });
    return await cv.convertToBlob({ type: 'image/png' });
  } catch { return null; }
}

/** The chosen tracks of the open movie packed as a scene file, with its picture at the Playhead. */
export async function packScene(engine: Engine, renderer: Renderer, trackIds: ReadonlySet<string>, withBackground: boolean): Promise<Blob> {
  const movie = engine.movie;
  if (!movie) throw new Error(t('Open or create a movie first.'));
  const scene = sceneOf(movie, trackIds, withBackground);
  const blobs = new Map<string, Blob>();
  for (const id of Object.keys(scene.assets)) { const b = engine.assets.get(id); if (b) blobs.set(id, b); }
  const poster = await posterOf(renderer, scene, engine.frame);
  return packMovie(scene, [], [], blobs, poster, false);
}

/** Every content and track of the scene with fresh ids; links between its contents (a parent, a character's parts) follow. */
function freshTracks(tracks: Track[]): Track[] {
  const ids = new Map<string, string>();
  const fresh = (c: Content): Content => {
    const id = uid('c');
    ids.set(c.id, id);
    return { ...c, id, tracks: c.tracks.map((tr) => ({ ...tr, id: uid('t'), content: tr.content.map(fresh) })) };
  };
  const relink = (c: Content): Content => {
    const inner: Content = c.tracks.length ? { ...c, tracks: c.tracks.map((tr) => ({ ...tr, content: tr.content.map(relink) })) } : c;
    const next = relinkCharacter(inner, ids);
    return next.parent && ids.has(next.parent) ? { ...next, parent: ids.get(next.parent) } : next;
  };
  const copied = (JSON.parse(JSON.stringify(tracks)) as Track[]).map((tr) => ({ ...tr, id: uid('t'), content: tr.content.map(fresh) }));
  return copied.map((tr) => ({ ...tr, content: tr.content.map(relink) }));
}

/** A block that spans the whole scene spans the whole movie it is laid in; the rest keep their times, cut at its end. */
function fitTimes(items: Content[], sceneLen: number, movieLen: number): Content[] {
  const out: Content[] = [];
  for (const c of items) {
    if (c.start <= 0 && end(c) >= sceneLen) { out.push({ ...c, start: 0, duration: movieLen }); continue; }
    if (c.start >= movieLen) continue;
    out.push(end(c) > movieLen ? { ...c, duration: movieLen - c.start } : c);
  }
  return out;
}

export interface LaidScene { tracks: Track[]; table: Record<string, Asset>; floor: number | null }

/** A saved scene made ready for `movie`: fresh ids, its whole-length blocks stretched to the movie's length and, when
 *  the sizes differ, each track's blocks in one group scaled to cover the frame about its centre (proportions kept). */
export function layout(movie: Movie, scene: Movie): LaidScene {
  const W = movie.width, H = movie.height, same = scene.width === W && scene.height === H;
  const s = same ? 1 : Math.max(W / scene.width, H / scene.height);
  const tracks = freshTracks(scene.tracks).map((tr): Track => {
    const items = fitTimes(tr.content, scene.duration, movie.duration);
    if (same || !items.length) return { ...tr, content: items };
    const inner: Track = { ...tr, id: uid('t'), content: items };
    const group = content('group', 0, movie.duration, { name: tr.name, tracks: [inner], transform: { ...identity(), scale: s } });
    return { ...tr, content: [group] };
  }).filter((tr) => tr.content.length > 0);
  const f = floorOf(scene.guides);
  return { tracks, table: { ...scene.assets }, floor: f === null ? null : Math.round(H / 2 + (f - scene.height / 2) * s) };
}

/** The laid scene as new bottom tracks of `movie`; the floor guide is taken only when the movie has none. */
export function layBehind(movie: Movie, laid: LaidScene): Movie {
  let next: Movie = { ...movie, tracks: [...movie.tracks, ...laid.tracks], assets: { ...movie.assets, ...laid.table } };
  if (laid.floor !== null && floorOf(movie.guides) === null) next = { ...next, guides: { ...movie.guides, lines: [...(movie.guides?.lines ?? []), { axis: 'y', at: laid.floor, role: 'floor' }] } };
  return next;
}

/** Reads a saved scene and lays it behind everything in the open movie as one undo step 'Add Scene'. Answers whether it
 *  was added; a scene that cannot be read throws, and the movie is left as it was. */
export async function addMySceneToMovie(engine: Engine, renderer: Renderer, name: string): Promise<boolean> {
  if (!engine.movie) return false;
  const file = await unpackMovie(await scenesApi.read(name));
  const added: string[] = [];
  const pics = new Map<string, Blob>();
  for (const [id, blob] of file.assets) {
    const a = file.movie.assets[id];
    if (!engine.assets.has(id)) { engine.assets.set(id, blob); added.push(id); }
    if (a && (a.kind === 'image' || a.kind === 'pixels')) pics.set(id, blob);
  }
  await renderer.preload(pics);
  const ok = engine.run('Add Scene', (m) => {
    const laid = layout(m, file.movie);
    return laid.tracks.length ? layBehind(m, laid) : m;
  });
  if (ok) engine.notice('{name} was added behind everything in this movie.', 'info', { name });
  else for (const id of added) engine.assets.delete(id);
  return ok;
}

/** The first of `base`, `base 2`, `base 3`... not in `taken`. */
export function freeSceneName(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  const clean = base.trim().replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Scene';
  let n = clean, i = 2;
  while (used.has(n.toLowerCase())) n = `${clean} ${i++}`;
  return n;
}
