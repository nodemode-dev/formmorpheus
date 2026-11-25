// Starter scenes: a manifest entry and its layer pictures made into a new movie, and a starter character stood on
// the scene's floor. Pure, no DOM: the pictures are drawn by io/starter-scenes.ts.
import { setCameraKeys } from './camera';
import { content, identity, newMovie, track, uid } from './model';
import type { Asset, Content, Movie, Transform } from './types';
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

/** How much larger than its own size a layer is drawn: twice, so a camera zoom stays sharp, while that stays within the largest movie side; else its own size (whole steps keep its shape exact). */
export function rasterScale(w: number, h: number, _movieW: number, _movieH: number): number {
  return 2 * w <= MAX_SIDE && 2 * h <= MAX_SIDE ? 2 : 1;
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

/** A starter character's drawing size, where its feet rest in it, and the scale it takes in a scene. */
export const STARTER_ART = { w: 1080, h: 1080, feet: 1012, scale: 0.5 };

/** Where the n-th character stands across the frame, in steps of STEP (at 1920 wide): mid-frame, then right, left, further right, further left. */
const SPOTS = [0, 1, -1, 2, -2];
const STEP = 280;

/** The x the next character's middle takes across `movie`: one spot along per character already in it, so two never land on each other. */
export function spotX(movie: Movie): number {
  const W = movie.width;
  let n = 0;
  for (const t of movie.tracks) for (const c of t.content) if (c.character) n++;
  const margin = Math.min(W / 2, (STARTER_ART.w * STARTER_ART.scale) / 4);
  return Math.min(W - margin, Math.max(margin, W / 2 + SPOTS[n % SPOTS.length] * STEP * (W / 1920)));
}

/** Stands a starter character (made for `movie` by the SVG importer, so centred on it and fitted) on the floor at y `floorY`, at half its drawn size, at its spot. */
export function standOnFloor(group: Content, movie: Movie, floorY: number): Transform {
  const W = movie.width, H = movie.height;
  const s = STARTER_ART.scale / Math.min(1, W / STARTER_ART.w, H / STARTER_ART.h);
  const px = W / 2 + (group.pivot?.x ?? 0), py = H / 2 + (group.pivot?.y ?? 0);
  const tx = spotX(movie);
  const ty = floorY - (STARTER_ART.feet - STARTER_ART.h / 2) * STARTER_ART.scale;
  return { ...group.transform, rotation: 0, scale: s, x: tx - px - s * (W / 2 - px), y: ty - py - s * (H / 2 - py) };
}
