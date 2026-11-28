// Starter scenes shipped in public/starters/scenes: the manifest, and a scene's layer SVGs drawn into pictures for a
// new movie or laid behind the open one. The starter files are only read.
import type { Engine } from '../engine/engine';
import type { Renderer } from '../engine/render';
import { isSceneEntry, laySceneBehind, rasterScale, sceneLayers, sceneMovie, type SceneEntry, type ScenePicture } from '../engine/starter-scene';
import type { Movie } from '../engine/types';
import { tf } from '../ui/i18n-fill';
import { parseSvgParts } from './svg-import';

export const SCENES = '/starters/scenes/';

const path = (...parts: string[]): string => SCENES + parts.flatMap((p) => p.split('/')).map(encodeURIComponent).join('/');

export function sceneFileUrl(entry: SceneEntry, file: string): string { return path(entry.folder, file); }

/** The scenes the manifest lists; an empty list when it cannot be read. */
export async function readSceneManifest(): Promise<SceneEntry[]> {
  try {
    const res = await fetch(`${SCENES}manifest.json`);
    if (!res.ok) return [];
    const body = (await res.json()) as { scenes?: unknown[] };
    return (body.scenes ?? []).filter(isSceneEntry);
  } catch { return []; }
}

/** Hands an SVG, decoded as an image, to `use` while its address is still alive. */
export async function withSvgImage<T>(text: string, use: (img: HTMLImageElement) => T): Promise<T> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return use(img);
  } finally { URL.revokeObjectURL(url); }
}

async function rasterize(text: string, W: number, H: number): Promise<ScenePicture> {
  const doc = parseSvgParts(text);
  const k = rasterScale(doc.width, doc.height, W, H);
  const cw = Math.max(1, Math.round(doc.width * k)), ch = Math.max(1, Math.round(doc.height * k));
  const cv = new OffscreenCanvas(cw, ch);
  await withSvgImage(text, (img) => (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(img, 0, 0, cw, ch));
  return { blob: await cv.convertToBlob({ type: 'image/png' }), w: doc.width, h: doc.height, k };
}

export type SceneRaster = (text: string, movieW: number, movieH: number) => Promise<ScenePicture>;

/** Every layer of a scene read from the starter folder and drawn as a picture for a movie of `W` x `H`. */
async function scenePictures(entry: SceneEntry, W: number, H: number, raster: SceneRaster): Promise<ScenePicture[]> {
  const pics: ScenePicture[] = [];
  for (const l of entry.layers) {
    const res = await fetch(sceneFileUrl(entry, l.file));
    if (!res.ok) throw new Error(tf('{name} could not be loaded.', { name: entry.name }));
    pics.push(await raster(await res.text(), W, H));
  }
  return pics;
}

/** A scene as a new movie and its pictures, every layer read from the starter folder. */
export async function buildSceneMovie(entry: SceneEntry, raster: SceneRaster = rasterize): Promise<{ movie: Movie; assets: Map<string, Blob> }> {
  return sceneMovie(entry, await scenePictures(entry, entry.width, entry.height, raster));
}

/** Adds a starter scene (an entry, or its id in the manifest) to the open movie behind everything in it, fitted to the
 *  movie's size, as one undo step 'Add Starter Scene'. Answers whether it was added; a layer that cannot be read
 *  throws, and the movie is left as it was. */
export async function addStarterSceneToMovie(engine: Engine, renderer: Renderer, scene: SceneEntry | string, raster: SceneRaster = rasterize): Promise<boolean> {
  const entry = typeof scene === 'string' ? (await readSceneManifest()).find((s) => s.id === scene) : scene;
  const open = engine.movie;
  if (!entry || !open) return false;
  const layers = sceneLayers(open, entry, await scenePictures(entry, open.width, open.height, raster));
  // the blobs go in and are decoded before the step, so its first frame shows the pictures; they come out again if it is refused
  for (const [id, blob] of layers.assets) engine.assets.set(id, blob);
  await renderer.preload(layers.assets);
  // laid against the movie as it is when the step runs, which may have changed while the pictures were drawn
  const ok = engine.run('Add Starter Scene', (m) => laySceneBehind(m, layers));
  if (ok) engine.notice('{name} was added behind everything in this movie.', 'info', { name: entry.name });
  else for (const id of layers.assets.keys()) engine.assets.delete(id);
  return ok;
}
