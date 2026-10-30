import { Renderer } from '../engine/render';
import { content, drawingLayer, flipFrame, flipTrack, newMovie, track, uid } from '../engine/model';
import { setKeys } from '../engine/key-ops';
import type { Asset, Content, Ease, Movie } from '../engine/types';
import { api } from '../io/api';
import { packMovie } from '../io/fmo';
import { previewStrip } from './preview-strip';

/** Three small example movies, built here in code (no files shipped): drawn with the canvas, assembled with the movie
 *  model and key ops, packed as `.fmo` and saved into the library at first run or by Reset Examples. */
export interface Example { name: string; blurb: string }

export const EXAMPLES: readonly Example[] = [
  { name: 'Example Bouncing Ball', blurb: 'A Flipbook of twelve drawings with Onion skins on.' },
  { name: 'Example Title Easing', blurb: 'A title with Keyframes: ease out, ease in and out, and a custom overshoot.' },
  { name: 'Example Performed Path', blurb: 'A Move lane recorded the way a Perform take records it.' },
];

const W = 640;
const H = 360;
const TAU = Math.PI * 2;

type Assets = Map<string, Blob>;

async function png(draw: (g: OffscreenCanvasRenderingContext2D) => void): Promise<Blob> {
  const c = new OffscreenCanvas(W, H);
  draw(c.getContext('2d') as OffscreenCanvasRenderingContext2D);
  return c.convertToBlob({ type: 'image/png' });
}

async function addPixels(movie: Movie, assets: Assets, name: string, draw: (g: OffscreenCanvasRenderingContext2D) => void): Promise<string> {
  const blob = await png(draw);
  const id = uid('p');
  const asset: Asset = { id, kind: 'pixels', name, mime: 'image/png', width: W, height: H, frames: 1, size: blob.size };
  movie.assets[id] = asset;
  assets.set(id, blob);
  return id;
}

// ---------------------------------------------------------------- 1. Bouncing ball (Flipbook)

const BALL_FRAMES = 12;

function drawBall(g: OffscreenCanvasRenderingContext2D, i: number): void {
  const t = i / BALL_FRAMES;
  const lift = 4 * t * (1 - t);
  const ground = 300;
  const r = 38;
  const squash = Math.max(0, (0.1 - lift) / 0.1);
  const sx = 1 + squash * 0.3;
  const sy = 1 - squash * 0.24;
  const cx = W / 2 + Math.sin(t * TAU) * 70;
  const cy = ground - r * sy - lift * 170;
  g.fillStyle = `rgba(40, 30, 20, ${0.26 - lift * 0.14})`;
  g.beginPath();
  g.ellipse(cx, ground + 4, 44 * (1 - lift * 0.4) * sx, 9 * (1 - lift * 0.3), 0, 0, TAU);
  g.fill();
  const fill = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.15);
  fill.addColorStop(0, '#ffb066');
  fill.addColorStop(0.55, '#f97316');
  fill.addColorStop(1, '#c2410c');
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(cx, cy, r * sx, r * sy, 0, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.beginPath();
  g.ellipse(cx - r * 0.38 * sx, cy - r * 0.42 * sy, r * 0.2, r * 0.12, -0.6, 0, TAU);
  g.fill();
}

async function buildBall(assets: Assets): Promise<Movie> {
  const movie = newMovie({ name: EXAMPLES[0].name, width: W, height: H, fps: 12, seconds: 2 });
  movie.background = '#f4eee3';
  const row = flipTrack('Ball', BALL_FRAMES);
  for (let i = 0; i < BALL_FRAMES; i++) {
    const frame = row.frames[i] ?? flipFrame();
    const layer = frame.layers[0] ?? drawingLayer();
    layer.pixels = await addPixels(movie, assets, `Ball ${i + 1}`, (g) => drawBall(g, i));
    layer.name = `Ball ${i + 1}`;
    frame.layers[0] = layer;
    row.frames[i] = frame;
  }
  const fb = content('flipbook', 0, movie.duration, { name: 'Bouncing Ball', flip: [row] });
  movie.tracks = [track('Track 1', [fb])];
  return movie;
}

// ---------------------------------------------------------------- 2. Title easing (Keyframes)

/** Sets the handles of a custom ease on one key of one channel. */
function withHandles(c: Content, kind: 'move', channel: string, frame: number, out: [number, number], inn: [number, number]): Content {
  const keys = c.keys.map((l) => (l.kind !== kind ? l : {
    ...l,
    channels: { ...l.channels, [channel]: (l.channels[channel] ?? []).map((k) => (k.frame === frame ? { ...k, ease: 'custom' as Ease, out, in: inn } : k)) },
  }));
  return { ...c, keys };
}

function buildTitle(): Movie {
  const movie = newMovie({ name: EXAMPLES[1].name, width: W, height: H, fps: 24, seconds: 3 });
  movie.background = '#15131c';
  const base = { size: 84, weight: 600, align: 'center' as const, font: 'Inter' };

  let title = content('text', 0, movie.duration, { name: 'Title', text: { ...base, text: 'formmorpheus', color: '#ffffff' }, transform: { x: 0, y: -26, scale: 1, rotation: 0, flipH: false, flipV: false } });
  title = setKeys(title, 'move', 0, { x: 0, y: 46, scaleX: 0.86, scaleY: 0.86 }, 'out');
  title = setKeys(title, 'move', 22, { x: 0, y: -26, scaleX: 1, scaleY: 1 }, 'inout');
  title = setKeys(title, 'opacity', 0, { amount: 0 }, 'inout');
  title = setKeys(title, 'opacity', 16, { amount: 1 }, 'hold');
  title = setKeys(title, 'opacity', 60, { amount: 1 }, 'in');
  title = setKeys(title, 'opacity', 71, { amount: 0 }, 'linear');

  let sub = content('text', 0, movie.duration, { name: 'Subtitle', text: { ...base, size: 30, weight: 500, text: 'ease out · ease in and out · overshoot', color: '#fb923c' }, transform: { x: 0, y: 46, scale: 1, rotation: 0, flipH: false, flipV: false } });
  sub = setKeys(sub, 'move', 14, { x: 0, y: 96 }, 'linear');
  sub = setKeys(sub, 'move', 38, { x: 0, y: 46 }, 'linear');
  sub = withHandles(sub, 'move', 'y', 14, [0.34, 1.5], [0.72, 1]);
  sub = setKeys(sub, 'opacity', 14, { amount: 0 }, 'out');
  sub = setKeys(sub, 'opacity', 26, { amount: 1 }, 'hold');
  sub = setKeys(sub, 'opacity', 60, { amount: 1 }, 'in');
  sub = setKeys(sub, 'opacity', 71, { amount: 0 }, 'linear');

  movie.tracks = [track('Subtitle', [sub]), track('Title', [title])];
  return movie;
}

// ---------------------------------------------------------------- 3. Performed path (Move lane)

const PATH_FRAMES = 72;
/** A figure of eight in px from the movie centre; t is 0 to 1 and the curve closes. */
const pathAt = (t: number): [number, number] => [Math.sin(t * TAU) * 220, Math.sin(t * TAU * 2) * 96];

function drawStar(g: OffscreenCanvasRenderingContext2D): void {
  const cx = W / 2;
  const cy = H / 2;
  const glow = g.createRadialGradient(cx, cy, 2, cx, cy, 44);
  glow.addColorStop(0, 'rgba(255, 190, 110, 0.9)');
  glow.addColorStop(1, 'rgba(249, 115, 22, 0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(cx, cy, 44, 0, TAU);
  g.fill();
  g.fillStyle = '#fff4e0';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rad = i % 2 ? 7 : 19;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}

async function buildPath(assets: Assets): Promise<Movie> {
  const movie = newMovie({ name: EXAMPLES[2].name, width: W, height: H, fps: 24, seconds: 3 });
  movie.background = '#0f1424';
  const trail = await addPixels(movie, assets, 'Path', (g) => {
    g.fillStyle = 'rgba(120, 140, 200, 0.55)';
    for (let i = 0; i < 180; i++) {
      const [x, y] = pathAt(i / 180);
      g.beginPath();
      g.arc(W / 2 + x, H / 2 + y, 2.2, 0, TAU);
      g.fill();
    }
  });
  const star = await addPixels(movie, assets, 'Star', drawStar);
  const pathLayer = { ...drawingLayer('Path'), pixels: trail };
  const starLayer = { ...drawingLayer('Star'), pixels: star };
  let comet = content('drawing', 0, PATH_FRAMES, { name: 'Star', layers: [starLayer] });
  // a Perform take samples the drag every other frame and keeps the ease linear between samples
  for (let f = 0; f <= PATH_FRAMES; f += 2) {
    const [x, y] = pathAt(f / PATH_FRAMES);
    comet = setKeys(comet, 'move', f, { x, y }, 'linear');
  }
  comet = setKeys(comet, 'move', 0, { rotation: 0 }, 'linear');
  comet = setKeys(comet, 'move', PATH_FRAMES, { rotation: 360 }, 'linear');
  const dots = content('drawing', 0, PATH_FRAMES, { name: 'Path', layers: [pathLayer] });
  movie.duration = PATH_FRAMES;
  movie.tracks = [track('Star', [comet]), track('Path', [dots])];
  return movie;
}

// ---------------------------------------------------------------- saving

/** Draws the poster (frame `at`) and the hover strip of a built example through a renderer of its own. */
async function pack(movie: Movie, assets: Assets, at: number): Promise<Blob> {
  const renderer = new Renderer((id) => assets.get(id), () => undefined);
  await renderer.preload(assets);
  const pw = 480;
  const ph = Math.round((pw * movie.height) / movie.width);
  const cv = new OffscreenCanvas(pw, ph);
  renderer.drawFrame(cv.getContext('2d') as unknown as CanvasRenderingContext2D, movie, at, { scale: pw / movie.width, ox: 0, oy: 0, width: pw, height: ph }, { backstage: false, background: movie.background, transparentChecker: null });
  const poster = await cv.convertToBlob({ type: 'image/png' });
  const preview = await previewStrip(renderer, movie);
  return packMovie(movie, [], [], assets, poster, false, preview);
}

async function make(name: string): Promise<Blob> {
  const assets: Assets = new Map();
  if (name === EXAMPLES[0].name) { const m = await buildBall(assets); return pack(m, assets, 3); }
  if (name === EXAMPLES[1].name) return pack(buildTitle(), assets, 36);
  const m = await buildPath(assets);
  return pack(m, assets, 14);
}

/** Writes the examples into the library. Without `reset`, one that is already there is left alone (first run, or a
 *  card clicked after its movie was deleted). With it, every example is rebuilt as it came; `skip` is a name that is
 *  open right now. Returns the names written. */
export async function installExamples(opts: { reset: boolean; only?: string; skip?: string | null }): Promise<string[]> {
  const have = new Set((await api.library().catch(() => [])).map((i) => i.name));
  const done: string[] = [];
  for (const ex of EXAMPLES) {
    if (opts.only && ex.name !== opts.only) continue;
    if (ex.name === opts.skip) continue;
    if (!opts.reset && have.has(ex.name)) continue;
    await api.writeMovie(ex.name, await make(ex.name));
    done.push(ex.name);
  }
  if (done.length) document.dispatchEvent(new CustomEvent('fm:library-changed'));
  return done;
}
