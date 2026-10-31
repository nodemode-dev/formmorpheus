import { Renderer } from '../engine/render';
import { api } from '../io/api';
import { unpackMovie } from '../io/fmo';
import { loadTextFonts } from '../media/fonts';

/** G17: a movie saved without a poster (a recovered movie, an old file) gets one when the Theater first shows it:
 *  the movie is read, drawn once on a private renderer (the open movie is never touched) and the picture goes into
 *  the file by the engine's poster call, which leaves every other entry as it was. One at a time, once a name. */
const tried = new Set<string>();
const queue: Array<() => Promise<void>> = [];
let running = false;
const WIDTH = 480;

async function make(name: string): Promise<Blob | null> {
  const file = await unpackMovie(await api.readMovie(name));
  const movie = file.movie;
  const renderer = new Renderer((id) => file.assets.get(id), () => undefined);
  await renderer.preload(file.assets, true);
  await loadTextFonts(movie).catch(() => undefined);
  const h = Math.max(1, Math.round((WIDTH * movie.height) / movie.width));
  const canvas = new OffscreenCanvas(WIDTH, h);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const probe = new OffscreenCanvas(32, 18);
  const pc = probe.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const last = Math.max(0, movie.duration - 1);
  // the first frame that shows something besides the background; the first frame when none does
  const candidates = [0, Math.round(last / 2), Math.round(last / 4), last];
  let pick = 0;
  for (const f of candidates) {
    pc.clearRect(0, 0, 32, 18);
    renderer.drawFrame(pc as unknown as CanvasRenderingContext2D, movie, f, { scale: 32 / movie.width, ox: 0, oy: 0, width: 32, height: 18 }, { backstage: false, background: '#000000', transparentChecker: null });
    const d = pc.getImageData(0, 0, 32, 18).data;
    let busy = false;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) { busy = true; break; }
    if (busy) { pick = f; break; }
  }
  renderer.drawFrame(ctx as unknown as CanvasRenderingContext2D, movie, pick, { scale: WIDTH / movie.width, ox: 0, oy: 0, width: WIDTH, height: h }, { backstage: false, background: movie.background, transparentChecker: null });
  return canvas.convertToBlob({ type: 'image/png' }).catch(() => null);
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try { for (let job = queue.shift(); job; job = queue.shift()) { try { await job(); } catch { /* the glyph stays */ } } } finally { running = false; }
}

/** Queues a poster for `name`; `done` runs once it is written. */
export function ensurePoster(name: string, done: () => void): void {
  if (tried.has(name) || typeof OffscreenCanvas === 'undefined') return;
  tried.add(name);
  queue.push(async () => {
    const blob = await make(name);
    if (!blob) return;
    await api.writePoster(name, blob);
    done();
  });
  void pump();
}
