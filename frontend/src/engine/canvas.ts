// Per-Drawing canvas: a Drawing or Flipbook may cover a rectangle other than the movie's (Content.canvas, movie pixels).
// Pure maths, no DOM.
import type { CanvasRect, Content, Movie } from './types';

/** Largest side of a canvas and largest area (pixels): beyond this the browser cannot hold the pictures. */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 64 * 1024 * 1024;

/** The rectangle a Drawing or Flipbook's pictures cover: its own canvas, or the movie rectangle. */
export function canvasOf(c: Content | null | undefined, movie: Pick<Movie, 'width' | 'height'>): CanvasRect {
  const k = c?.canvas;
  if (k && (c?.kind === 'drawing' || c?.kind === 'flipbook') && k.w >= 1 && k.h >= 1) return k;
  return { x: 0, y: 0, w: movie.width, h: movie.height };
}

export function hasCanvas(c: Content | null | undefined): boolean {
  return !!c?.canvas && (c.kind === 'drawing' || c.kind === 'flipbook');
}

export function sameCanvas(a: CanvasRect, b: CanvasRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Whole-pixel, within the limits; the size shrinks (keeping its shape) when too large. */
export function clampCanvas(r: CanvasRect): CanvasRect {
  let w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  const k = Math.min(1, MAX_CANVAS_SIDE / w, MAX_CANVAS_SIDE / h, Math.sqrt(MAX_CANVAS_AREA / (w * h)));
  if (k < 1) { w = Math.max(1, Math.floor(w * k)); h = Math.max(1, Math.floor(h * k)); }
  return { x: Math.round(r.x), y: Math.round(r.y), w, h };
}

/** The canvas offset of its centre from the movie centre: where a Drawing's pivot and handle box sit by default. */
export function canvasCentreOffset(c: Content | null | undefined, movie: Pick<Movie, 'width' | 'height'>): { x: number; y: number } {
  const k = canvasOf(c, movie);
  return { x: k.x + k.w / 2 - movie.width / 2, y: k.y + k.h / 2 - movie.height / 2 };
}

/** Content with its canvas set (an equal-to-movie canvas is stored as absent); the pivot follows when it still sat at the old centre. */
export function withCanvas(c: Content, movie: Pick<Movie, 'width' | 'height'>, next: CanvasRect): Content {
  const was = canvasCentreOffset(c, movie);
  const out: Content = { ...c };
  const full = next.x === 0 && next.y === 0 && next.w === movie.width && next.h === movie.height;
  if (full) delete out.canvas; else out.canvas = { ...next };
  const now = canvasCentreOffset(out, movie);
  const p = c.pivot ?? { x: 0, y: 0 };
  const atCentre = Math.abs(p.x - was.x) < 0.5 && Math.abs(p.y - was.y) < 0.5 && !c.keys.some((l) => l.kind === 'move' && (l.channels.px?.length || l.channels.py?.length));
  if (atCentre) {
    if (Math.abs(now.x) < 0.5 && Math.abs(now.y) < 0.5) delete out.pivot; else out.pivot = { x: Math.round(now.x * 100) / 100, y: Math.round(now.y * 100) / 100 };
  }
  return out;
}
