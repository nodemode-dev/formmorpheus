// Sprite sheet: the movie's frames in a grid on one PNG, with a JSON of each frame's rectangle, and the
// current frame on the clipboard. Frames come from the same renderer as every other export.
import type { Movie } from '../engine/types';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import { openPngFrames } from './worker-host';

type Deps = { movie: Movie; renderer: Renderer; audio: AudioEngine | null };

const MAX_CELLS = 256;
const MAX_SIDE = 8192;

export interface SpriteResult { png: Blob; json: Blob; name: string; cols: number; rows: number; cell: [number, number]; frames: number }

/** The frames [from, to) in a grid (at most 256, evenly sampled), each cell fitted to `cellLong` pixels on its long side. */
export async function exportSpriteSheet(deps: Deps, o: { from: number; to: number; cellLong?: number; alpha: boolean }, onProgress?: (done: number, total: number) => void): Promise<SpriteResult> {
  const { movie } = deps;
  const span = Math.max(1, o.to - o.from);
  const count = Math.min(span, MAX_CELLS);
  const frames = Array.from({ length: count }, (_, i) => o.from + Math.min(span - 1, Math.floor((i * span) / count)));
  const long = Math.max(16, Math.min(o.cellLong ?? 256, 1024));
  const k = Math.min(1, long / Math.max(movie.width, movie.height));
  let cw = Math.max(2, Math.round(movie.width * k)), ch = Math.max(2, Math.round(movie.height * k));
  // a roughly square sheet, shrunk until it fits the canvas limit
  let cols = Math.max(1, Math.round(Math.sqrt((count * ch) / cw)));
  for (;;) {
    cols = Math.min(cols, count);
    const rows = Math.ceil(count / cols);
    if (cols * cw <= MAX_SIDE && rows * ch <= MAX_SIDE) break;
    cw = Math.max(2, Math.floor(cw * 0.8)); ch = Math.max(2, Math.floor(ch * 0.8));
  }
  const rows = Math.ceil(count / cols);
  const src = await openPngFrames(deps, { width: cw, height: ch, frames, keepAlpha: o.alpha });
  const sheet = new OffscreenCanvas(cols * cw, rows * ch);
  const ctx = sheet.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const rects: { frame: number; x: number; y: number; w: number; h: number }[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const bmp = await createImageBitmap(await src.blob(i));
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      ctx.drawImage(bmp, x, y, cw, ch);
      bmp.close();
      rects.push({ frame: frames[i], x, y, w: cw, h: ch });
      onProgress?.(i + 1, count);
    }
  } finally { src.close(); }
  const base = (movie.name || 'movie').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'movie';
  const png = await sheet.convertToBlob({ type: 'image/png' });
  const json = new Blob([JSON.stringify({ image: `${base} sprites.png`, size: { w: cols * cw, h: rows * ch }, cell: { w: cw, h: ch }, cols, rows, fps: movie.fps, frames: rects }, null, 2)], { type: 'application/json' });
  return { png, json, name: base, cols, rows, cell: [cw, ch], frames: count };
}

/** The current frame as a PNG on the system clipboard. Returns false when the browser refuses or has no image clipboard. */
export async function copyFrameToClipboard(deps: Deps, frame: number, alpha: boolean): Promise<boolean> {
  const { movie } = deps;
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
  const src = await openPngFrames(deps, { width: movie.width, height: movie.height, frames: [frame], keepAlpha: alpha });
  try {
    const png = await src.blob(0);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch { return false; } finally { src.close(); }
}
