import type { Renderer } from '../engine/render';
import type { Movie } from '../engine/types';

/** A short sprite strip saved inside the `.fmo` (preview.png): PREVIEW_CELLS pictures of the movie side by side.
 *  Theater plays it on hover by stepping the strip, so a thumbnail moves without opening the movie. */
export const PREVIEW_CELLS = 8;
const CELL_W = 240;
/** The strip of a movie is re-drawn at most this often, so autosave stays cheap. */
const REUSE_MS = 60000;

const cache = new Map<string, { at: number; blob: Blob | null }>();

export async function previewStrip(renderer: Renderer, movie: Movie): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const h = Math.max(1, Math.round((CELL_W * movie.height) / movie.width));
  const strip = new OffscreenCanvas(CELL_W * PREVIEW_CELLS, h);
  const ctx = strip.getContext('2d');
  if (!ctx) return null;
  const cell = new OffscreenCanvas(CELL_W, h);
  const cc = cell.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!cc) return null;
  const last = Math.max(0, movie.duration - 1);
  try {
    for (let i = 0; i < PREVIEW_CELLS; i++) {
      const frame = Math.round((last * i) / (PREVIEW_CELLS - 1));
      cc.clearRect(0, 0, CELL_W, h);
      renderer.drawFrame(cc as unknown as CanvasRenderingContext2D, movie, frame, { scale: CELL_W / movie.width, ox: 0, oy: 0, width: CELL_W, height: h }, { backstage: false, background: movie.background, transparentChecker: null });
      ctx.drawImage(cell, i * CELL_W, 0);
    }
    return await strip.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  }
}

/** The strip for a save: drawn now, or the one drawn less than a minute ago for the same movie name. */
export async function previewFor(name: string, renderer: Renderer, movie: Movie): Promise<Blob | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < REUSE_MS) return hit.blob;
  const blob = await previewStrip(renderer, movie);
  cache.set(name, { at: Date.now(), blob });
  return blob;
}
