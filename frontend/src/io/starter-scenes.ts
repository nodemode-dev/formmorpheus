// Starter scenes shipped in public/starters/scenes: the manifest, and a scene's layer SVGs drawn into pictures for a
// new movie. The starter files are only read.
import { isSceneEntry, rasterScale, sceneMovie, type SceneEntry, type ScenePicture } from '../engine/starter-scene';
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

/** A scene as a new movie and its pictures, every layer read from the starter folder. */
export async function buildSceneMovie(entry: SceneEntry, raster: SceneRaster = rasterize): Promise<{ movie: Movie; assets: Map<string, Blob> }> {
  const pics: ScenePicture[] = [];
  for (const l of entry.layers) {
    const res = await fetch(sceneFileUrl(entry, l.file));
    if (!res.ok) throw new Error(tf('{name} could not be loaded.', { name: entry.name }));
    pics.push(await raster(await res.text(), entry.width, entry.height));
  }
  return sceneMovie(entry, pics);
}
