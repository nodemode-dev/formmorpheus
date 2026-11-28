// Stage helpers for parenting and the camera. A content's handles are drawn and dragged in its own local
// space (the space its Move and Scale values live in); the matrix here carries that space to the screen,
// so a drag under a rotated parent still follows the pointer. No DOM.
import { hasWorldFx, invert, levelFrameOf, mul, parentWorld, worldMatrix, type Mat } from '../engine/transform';
import type { Content, Movie } from '../engine/types';
import { canvasOf } from '../engine/canvas';
import { end, flipIndexAt } from '../engine/model';
import { srcFrame } from '../engine/retime';
import { stageBox } from '../engine/shape-ops';
import { layoutText } from '../engine/text-layout';

interface ViewLike { scale: number; ox: number; oy: number }

const stripped = new WeakMap<Movie, Movie>();

/** The movie as the Stage draws it: without its camera while Camera mode shows the world from outside. */
export function stageMovie(m: Movie, noCamera: boolean): Movie {
  if (!noCamera || !m.camera) return m;
  let s = stripped.get(m);
  if (!s) {
    const { camera: _camera, ...rest } = m;
    s = rest as Movie;
    stripped.set(m, s);
  }
  return s;
}

/** Screen pixels as the content's parent space shows them, to real screen pixels; null when nothing is above the content. */
export function screenMat(m: Movie, c: Content, frame: number, v: ViewLike): Mat | null {
  if (!hasWorldFx(m)) return null;
  const pw = parentWorld(m, c, frame);
  const vm: Mat = [v.scale, 0, 0, v.scale, v.ox, v.oy];
  const vi = invert(vm);
  return vi ? mul(vm, mul(pw, vi)) : null;
}

export function mapPt(s: Mat | null, x: number, y: number): [number, number] {
  return s ? [s[0] * x + s[2] * y + s[4], s[1] * x + s[3] * y + s[5]] : [x, y];
}

// ---- the hugged box: what a content draws at a frame, in its own picture space ------------------------------
// A Group (a character) or a Drawing covers the whole movie, but its outline and handles hug what is drawn.

/** Ink bounds of a pixels asset as shares of its size [x0, y0, x1, y1]; null: no ink; undefined: not decoded yet. */
export type InkOf = (asset: string) => [number, number, number, number] | null | undefined;

type R4 = [number, number, number, number];

/** Union of the visible layers' ink, in movie pixels of the canvas `k`; null: no ink; undefined: a layer is not decoded. */
function layersInk(layers: Content['layers'], k: { x: number; y: number; w: number; h: number }, ink: InkOf): R4 | null | undefined {
  let out: R4 | null = null;
  for (const l of layers) {
    if (l.group || !l.visible || l.opacity <= 0 || !l.pixels) continue;
    const f = ink(l.pixels);
    if (f === undefined) return undefined;
    if (!f) continue;
    const r: R4 = [k.x + f[0] * k.w, k.y + f[1] * k.h, k.x + f[2] * k.w, k.y + f[3] * k.h];
    out = out ? [Math.min(out[0], r[0]), Math.min(out[1], r[1]), Math.max(out[2], r[2]), Math.max(out[3], r[3])] : r;
  }
  return out;
}

/** What one non-group content draws at its own local frame `local`, in its picture space; null: nothing; undefined: unknown yet. */
function leafBox(m: Movie, c: Content, local: number, ink: InkOf): R4 | null | undefined {
  const sb = stageBox(c, local + c.start, m);
  if (sb) { const x = m.width / 2 + sb.cx, y = m.height / 2 + sb.cy; return [x - sb.w / 2, y - sb.h / 2, x + sb.w / 2, y + sb.h / 2]; }
  if ((c.kind === 'image' || c.kind === 'video') && c.asset) {
    const a = m.assets[c.asset];
    return a ? [(m.width - a.width) / 2, (m.height - a.height) / 2, (m.width + a.width) / 2, (m.height + a.height) / 2] : null;
  }
  if (c.kind === 'text' && c.text) { const r = layoutText(c.text, m).inner; return [r.x, r.y, r.x + r.w, r.y + r.h]; }
  if (c.kind === 'drawing') return layersInk(c.layers, canvasOf(c, m), ink);
  if (c.kind === 'flipbook') {
    const k = canvasOf(c, m), f = srcFrame(c, local);
    let out: R4 | null = null;
    for (const t of c.flip) {
      if (t.hidden || t.opacity <= 0) continue;
      const i = flipIndexAt(t, f);
      if (i < 0) continue;
      const r = layersInk(t.frames[i].layers, k, ink);
      if (r === undefined) return undefined;
      if (r) out = out ? [Math.min(out[0], r[0]), Math.min(out[1], r[1]), Math.max(out[2], r[2]), Math.max(out[3], r[3])] : r;
    }
    return out;
  }
  return null;
}

/** Longest side a picture is read at to find its ink (a 4K layer is read at 512, so one cell is under 8 movie pixels). */
const INK_SIDE = 512;

/**
 * Ink bounds of decoded pictures, read once per asset at a reduced size on one reused surface and kept by asset id
 * (a painted layer gets a new asset on every change). `bitmap` gives the decoded picture, or null while it decodes.
 */
export function inkIndex(bitmap: (id: string) => ImageBitmap | null): InkOf {
  const kept = new Map<string, { bmp: ImageBitmap; out: [number, number, number, number] | null }>();
  let surface: OffscreenCanvas | null = null;
  return (id) => {
    const bmp = bitmap(id);
    if (!bmp || bmp.width < 1 || bmp.height < 1) return undefined;
    // kept while the renderer holds the same decoded picture for the id
    const have = kept.get(id);
    if (have && have.bmp === bmp) return have.out;
    const k = Math.min(1, INK_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = surface ?? (surface = new OffscreenCanvas(w, h));
    if (cv.width < w || cv.height < h) { cv.width = Math.max(cv.width, w); cv.height = Math.max(cv.height, h); }
    const g = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(bmp, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const o = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (px[o + x * 4 + 3] === 0) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; y1 = y;
      }
    }
    // one cell of slack each side: a faint line read small can round away
    const out: [number, number, number, number] | null = x1 < 0 ? null : [Math.max(0, x0 - 1) / w, Math.max(0, y0 - 1) / h, Math.min(w, x1 + 2) / w, Math.min(h, y1 + 2) / h];
    if (kept.size > 400) kept.clear();
    kept.set(id, { bmp, out });
    return out;
  };
}

/** Grows `acc` by the box `b` carried through `s`. */
function addBox(acc: R4, s: Mat, b: R4): void {
  for (const [u, v] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) {
    const x = s[0] * u + s[2] * v + s[4], y = s[1] * u + s[3] * v + s[5];
    if (x < acc[0]) acc[0] = x; if (y < acc[1]) acc[1] = y; if (x > acc[2]) acc[2] = x; if (y > acc[3]) acc[3] = y;
  }
}

/** Every drawn content at or under `c` showing at movie frame `frame`, into `acc` through `inv` (the group's world inverse); false when a picture is not decoded yet. */
function groupInto(m: Movie, c: Content, frame: number, inv: Mat, acc: R4, ink: InkOf): boolean {
  if (c.hidden) return true;
  const lf = levelFrameOf(m, c, frame);
  if (lf < c.start || lf >= end(c)) return true;
  if (c.kind === 'group') {
    for (const t of c.tracks) if (!t.hidden) for (const x of t.content) if (!groupInto(m, x, frame, inv, acc, ink)) return false;
    return true;
  }
  if (c.kind === 'audio') return true;
  const b = leafBox(m, c, lf - c.start, ink);
  if (b === undefined) return false;
  if (b) addBox(acc, mul(inv, worldMatrix(m, c, frame)), b);
  return true;
}

export interface Hug { w: number; h: number; cx: number; cy: number }

const hugMemo = new WeakMap<Content, { frame: number; fonts: number; out: Hug | null }>();

/**
 * The box a Group, Drawing or Flipbook draws at movie frame `frame`, as {w, h} and its centre's offset from the movie
 * centre, in the content's own picture space. A Group is the union of its parts' drawn boxes; a Drawing or Flipbook its
 * ink. Null for any other kind, and for nothing drawn (the caller keeps the full canvas). Kept per content object
 * (a new object on every edit) and frame, so a redraw costs nothing; a picture still decoding is not kept.
 */
export function hugBox(m: Movie, c: Content, frame: number, ink: InkOf, fonts: number): Hug | null {
  if (c.kind !== 'group' && c.kind !== 'drawing' && c.kind !== 'flipbook') return null;
  const memo = hugMemo.get(c);
  if (memo && memo.frame === frame && memo.fonts === fonts) return memo.out;
  let r: R4 | null | undefined;
  if (c.kind === 'group') {
    const inv = invert(worldMatrix(m, c, frame));
    if (!inv) return null;
    const acc: R4 = [Infinity, Infinity, -Infinity, -Infinity];
    let ok = true;
    for (const t of c.tracks) if (ok && !t.hidden) for (const x of t.content) if (!groupInto(m, x, frame, inv, acc, ink)) { ok = false; break; }
    r = !ok ? undefined : acc[2] > acc[0] && acc[3] > acc[1] ? acc : null;
  } else r = leafBox(m, c, frame - c.start, ink);
  if (r === undefined) return null;
  const out = r && r[2] - r[0] >= 1 && r[3] - r[1] >= 1 ? { w: r[2] - r[0], h: r[3] - r[1], cx: (r[0] + r[2]) / 2 - m.width / 2, cy: (r[1] + r[3]) / 2 - m.height / 2 } : null;
  hugMemo.set(c, { frame, fonts, out });
  return out;
}

/** Real screen pixels back into the content's parent space (screen scale). */
export function unmapPt(s: Mat | null, x: number, y: number): [number, number] {
  if (!s) return [x, y];
  const i = invert(s);
  return i ? [i[0] * x + i[2] * y + i[4], i[1] * x + i[3] * y + i[5]] : [x, y];
}
