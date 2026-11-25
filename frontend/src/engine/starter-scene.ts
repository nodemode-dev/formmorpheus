// Starter scenes: a manifest entry and its layer pictures made into a new movie. Pure, no DOM: the pictures are
// drawn by io/starter-scenes.ts.
import { setCameraKeys } from './camera';
import { content, identity, newMovie, track, uid } from './model';
import type { Asset, Movie, Transform } from './types';
import { MAX_SIDE } from './types';

export interface SceneLayer { name: string; file: string; x: number; y: number; scale: number }

export interface SceneEntry {
  id: string;
  name: string;
  folder: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: string;
  floorY?: number;
  layers: SceneLayer[];
  camera?: { panX: number; panY: number; zoom: number };
}

/** One layer drawn as a picture: `w` x `h` is the SVG's own size, the picture is `k` times that. */
export interface ScenePicture { blob: Blob; w: number; h: number; k: number }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isSceneEntry(v: unknown): v is SceneEntry {
  const e = v as SceneEntry;
  return !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.folder === 'string'
    && fin(e.width) && fin(e.height) && fin(e.fps) && fin(e.duration) && Array.isArray(e.layers)
    && e.layers.every((l) => !!l && typeof l.name === 'string' && typeof l.file === 'string' && fin(l.x) && fin(l.y) && fin(l.scale));
}

/** How much larger than its own size a layer is drawn: twice for crispness when that still fits the movie, else its own size (whole steps keep its shape exact). */
export function rasterScale(w: number, h: number, movieW: number, movieH: number): number {
  return 2 * w <= Math.min(movieW, MAX_SIDE) && 2 * h <= Math.min(movieH, MAX_SIDE) ? 2 : 1;
}

/** The movie a scene opens as: one picture track per layer (the first layer at the bottom), the camera preset as its first key, the floor as a guide. */
export function sceneMovie(entry: SceneEntry, pics: ScenePicture[]): { movie: Movie; assets: Map<string, Blob> } {
  let movie = newMovie({ name: 'Untitled Movie', width: entry.width, height: entry.height, fps: entry.fps });
  movie = { ...movie, duration: Math.max(1, Math.round(entry.duration)) };
  if (typeof entry.background === 'string' && /^#[0-9a-f]{6}$/i.test(entry.background)) movie.background = entry.background.toLowerCase();
  const W = movie.width, H = movie.height;
  const assets = new Map<string, Blob>();
  const table: Record<string, Asset> = {};
  const tracks = entry.layers.map((l, i) => {
    const p = pics[i];
    const aw = Math.max(1, Math.round(p.w * p.k)), ah = Math.max(1, Math.round(p.h * p.k));
    const asset: Asset = { id: uid('a'), kind: 'image', name: l.name, mime: 'image/png', width: aw, height: ah, frames: 0, size: p.blob.size };
    table[asset.id] = asset;
    assets.set(asset.id, p.blob);
    const transform: Transform = { ...identity(), x: l.x - W / 2, y: l.y - H / 2, scale: (l.scale * p.w) / aw };
    return track(l.name, [content('image', 0, movie.duration, { name: l.name, asset: asset.id, transform })]);
  });
  movie = { ...movie, tracks: tracks.reverse(), assets: table };
  if (fin(entry.floorY)) movie.guides = { lines: [{ axis: 'y', at: entry.floorY, role: 'floor' }] };
  const cam = entry.camera;
  if (cam && fin(cam.panX) && fin(cam.panY) && fin(cam.zoom) && cam.zoom > 0) movie = setCameraKeys(movie, 0, { panX: cam.panX, panY: cam.panY, zoom: cam.zoom });
  return { movie, assets };
}
