// Warp mesh and Distort drawing for a content's surface. A content is drawn flat (in its own space, the
// movie's pixels) and then re-projected: a Distort moves the 4 corners (a projective map), a Warp moves a
// grid of control points (a Catmull-Rom surface through them). Both become a triangle list, drawn as
// affine-textured triangles on a 2D canvas; `warpQuads` hands the same list to any other drawer (the GPU path).
// Offsets are in content-space pixels, applied before the content's move / scale / rotation. Pure, no DOM.
import type { Animated } from './keys';
import { canvasOf } from './canvas';
import type { Content, Movie } from './types';
import { layoutText } from './text-layout';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const WARP_MIN = 2;
export const WARP_MAX = 6;
export const WARP_DEFAULT = 4;

/** Channel id of a Warp node's offset ('x' or 'y'); rows and columns count from 0. */
export const warpId = (row: number, col: number, axis: 'x' | 'y'): string => `n${row}${col}${axis}`;
export const DISTORT_IDS = ['tlx', 'tly', 'trx', 'try', 'brx', 'bry', 'blx', 'bly'];

export function warpActive(a: Animated): boolean {
  return !!a.warp || !!a.distort;
}

/** Catmull-Rom weights of the 4 neighbours at fraction t. */
function cr(t: number, w: number[]): void {
  const t2 = t * t, t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

const WU = [0, 0, 0, 0];
const WV = [0, 0, 0, 0];

/** Offset of the Warp mesh at (u, v) in 0..1 across the content. */
export function meshOffset(n: number, dx: number[], dy: number[], u: number, v: number, out: number[], linear = false): void {
  const gu = Math.min(Math.max(u, 0), 1) * (n - 1), gv = Math.min(Math.max(v, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(gu), n - 2), j = Math.min(Math.floor(gv), n - 2);
  if (linear) {
    const fu = gu - i, fv = gv - j, k = j * n + i;
    const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
    out[0] = w00 * dx[k] + w10 * dx[k + 1] + w01 * dx[k + n] + w11 * dx[k + n + 1];
    out[1] = w00 * dy[k] + w10 * dy[k + 1] + w01 * dy[k + n] + w11 * dy[k + n + 1];
    return;
  }
  cr(gu - i, WU);
  cr(gv - j, WV);
  let ox = 0, oy = 0;
  for (let b = 0; b < 4; b++) {
    const r = Math.min(n - 1, Math.max(0, j - 1 + b));
    for (let a = 0; a < 4; a++) {
      const col = Math.min(n - 1, Math.max(0, i - 1 + a));
      const k = r * n + col, wt = WU[a] * WV[b];
      ox += wt * dx[k];
      oy += wt * dy[k];
    }
  }
  out[0] = ox;
  out[1] = oy;
}

/** Projective map of the unit square onto the corner quad tl, tr, br, bl. Returns a function of (u, v). */
function homography(p: number[]): (u: number, v: number, out: number[]) => void {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dy1 * dx2;
  if ((dx3 !== 0 || dy3 !== 0) && Math.abs(den) > 1e-9) {
    g = (dx3 * dy2 - dy3 * dx2) / den;
    h = (dx1 * dy3 - dy1 * dx3) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (u, v, out) => {
    const w = g * u + h * v + 1;
    const k = Math.abs(w) < 1e-9 ? 1e-9 : w;
    out[0] = (a * u + b * v + x0) / k;
    out[1] = (d * u + e * v + y0) / k;
  };
}

/** Content-space point at (u, v) once the Distort or Warp is applied. */
export function warpPoint(a: Animated, r: Rect, u: number, v: number, out: number[]): void {
  if (a.distort) {
    const o = a.distort;
    if (a.bilinear) {
      // straight edges, no perspective: the four corners blended bilinearly
      const x0 = r.x + o[0], y0 = r.y + o[1], x1 = r.x + r.w + o[2], y1 = r.y + o[3], x2 = r.x + r.w + o[4], y2 = r.y + r.h + o[5], x3 = r.x + o[6], y3 = r.y + r.h + o[7];
      out[0] = (1 - v) * ((1 - u) * x0 + u * x1) + v * ((1 - u) * x3 + u * x2);
      out[1] = (1 - v) * ((1 - u) * y0 + u * y1) + v * ((1 - u) * y3 + u * y2);
      return;
    }
    homography([r.x + o[0], r.y + o[1], r.x + r.w + o[2], r.y + o[3], r.x + r.w + o[4], r.y + r.h + o[5], r.x + o[6], r.y + r.h + o[7]])(u, v, out);
    return;
  }
  if (a.warp) {
    meshOffset(a.warp.n, a.warp.dx, a.warp.dy, u, v, out, a.bilinear === true);
    out[0] += r.x + u * r.w;
    out[1] += r.y + v * r.h;
    return;
  }
  out[0] = r.x + u * r.w;
  out[1] = r.y + v * r.h;
}

/** The part of content space a Warp or Distort covers: the picture's own rectangle, else the whole movie frame. */
export interface Rect { x: number; y: number; w: number; h: number }

export function contentRect(c: Content, movie: Movie): Rect {
  const asset = (c.kind === 'image' || c.kind === 'video') && c.asset ? movie.assets[c.asset] : undefined;
  if (asset) return { x: (movie.width - asset.width) / 2, y: (movie.height - asset.height) / 2, w: asset.width, h: asset.height };
  if (c.kind === 'text' && c.text) {
    // the measured box the renderer draws text into (Renderer.textBox: same font, alignment anchors and padding),
    // so the mesh covers every glyph instead of a width guessed from the character count
    return layoutText(c.text, movie).box;
  }
  return canvasOf(c, movie);
}

/** A matrix applied after the content's own transform (its parents and the camera, set by the renderer around a draw, engine/transform.ts). */
let stagePost: [number, number, number, number, number, number] | null = null;
let stagePostInv: [number, number, number, number, number, number] | null = null;

export function setStagePost(m: [number, number, number, number, number, number] | null): void {
  stagePost = m;
  stagePostInv = null;
  if (!m) return;
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  stagePostInv = [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Content space to Stage space (movie pixels): the content's move, scale, flip and rotation around the movie centre. */
export function localToStage(a: Animated, w: number, h: number, x: number, y: number, out: number[]): void {
  const sx = a.scaleX * (a.flipH ? -1 : 1), sy = a.scaleY * (a.flipV ? -1 : 1);
  const r = (a.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const cx = w / 2 + (a.px ?? 0), cy = h / 2 + (a.py ?? 0);
  const px = (x - cx) * sx, py = (y - cy) * sy;
  out[0] = cx + a.x + px * cos - py * sin;
  out[1] = cy + a.y + px * sin + py * cos;
  const m = stagePost;
  if (m) { const ox = out[0], oy = out[1]; out[0] = m[0] * ox + m[2] * oy + m[4]; out[1] = m[1] * ox + m[3] * oy + m[5]; }
}

/** Stage space back to content space (before the Distort or Warp). */
export function stageToLocal(a: Animated, w: number, h: number, x: number, y: number, out: number[]): void {
  const sx = a.scaleX * (a.flipH ? -1 : 1) || 1e-6, sy = a.scaleY * (a.flipV ? -1 : 1) || 1e-6;
  const r = (a.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const cx = w / 2 + (a.px ?? 0), cy = h / 2 + (a.py ?? 0);
  const iv = stagePostInv;
  if (iv) { const ix = x, iy = y; x = iv[0] * ix + iv[2] * iy + iv[4]; y = iv[1] * ix + iv[3] * iy + iv[5]; }
  const qx = x - cx - a.x, qy = y - cy - a.y;
  out[0] = cx + (qx * cos + qy * sin) / sx;
  out[1] = cy + (-qx * sin + qy * cos) / sy;
}

const scratch = new Map<string, Float32Array>();

/** A reused Float32Array of at least `n` numbers, returned as a view of exactly `n` (the list is consumed before the next call). */
export function grab(slot: string, n: number): Float32Array {
  let b = scratch.get(slot);
  if (!b || b.length < n) { b = new Float32Array(Math.max(n, 1024)); scratch.set(slot, b); }
  return b.subarray(0, n);
}

/** Grid steps per side for the triangle list: enough to look smooth, few enough to draw every frame. */
function steps(a: Animated): number {
  if (a.distort) return 12;
  const cells = (a.warp?.n ?? 2) - 1;
  return cells * Math.max(2, Math.round(16 / cells));
}

/**
 * The triangles of the warped content: 12 numbers each, the source corners (x, y) x3 in content space
 * of `rect` (default the whole w x h movie frame; contentRect gives a picture's own) and then the destination
 * corners x3 in Stage space (movie pixels, the content's move / scale / rotation already applied). Empty
 * when the content is neither warped nor distorted.
 */
export function warpQuads(a: Animated, w: number, h: number, rect: Rect = { x: 0, y: 0, w, h }): Float32Array {
  if (!warpActive(a)) return new Float32Array(0);
  const g = steps(a);
  const ptsD = grab('pts', (g + 1) * (g + 1) * 2);
  const o = [0, 0], s = [0, 0];
  for (let j = 0; j <= g; j++) {
    for (let i = 0; i <= g; i++) {
      warpPoint(a, rect, i / g, j / g, o);
      localToStage(a, w, h, o[0], o[1], s);
      const k = (j * (g + 1) + i) * 2;
      ptsD[k] = s[0];
      ptsD[k + 1] = s[1];
    }
  }
  const out = grab('quads', g * g * 2 * 12);
  let p = 0;
  const corner = (i: number, j: number): void => { out[p++] = rect.x + (i / g) * rect.w; out[p++] = rect.y + (j / g) * rect.h; };
  const dest = (i: number, j: number): void => { const k = (j * (g + 1) + i) * 2; out[p++] = ptsD[k]; out[p++] = ptsD[k + 1]; };
  const tri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number): void => {
    corner(i0, j0); corner(i1, j1); corner(i2, j2);
    dest(i0, j0); dest(i1, j1); dest(i2, j2);
  };
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      tri(i, j, i + 1, j, i, j + 1);
      tri(i + 1, j, i + 1, j + 1, i, j + 1);
    }
  }
  return out;
}

/** `srcScale`: pixels per content pixel of the flat source when it was drawn below the view's scale (capped surfaces); default `scale`. */
export interface WarpView { scale: number; ox: number; oy: number; srcScale?: number }

/**
 * Draws `src` (the content rendered flat at `view.scale`, content space (0,0) at the surface's origin) warped
 * onto `ctx`. Each triangle is clipped a half pixel wider than itself so neighbours do not leave hairlines.
 */
export function drawWarped(ctx: Ctx, src: CanvasImageSource, a: Animated, view: WarpView, w: number, h: number, rect?: Rect): void {
  drawTriangles(ctx, src, warpQuads(a, w, h, rect), view);
}

/** Draws a triangle list in warpQuads's layout (source corners in content px, destination corners in Stage px); bones.ts uses it too. */
export function drawTriangles(ctx: Ctx, src: CanvasImageSource, t: Float32Array, view: WarpView): void {
  const k = view.scale, ks = view.srcScale ?? view.scale;
  for (let p = 0; p + 11 < t.length; p += 12) {
    const s0x = t[p] * ks, s0y = t[p + 1] * ks, s1x = t[p + 2] * ks, s1y = t[p + 3] * ks, s2x = t[p + 4] * ks, s2y = t[p + 5] * ks;
    const d0x = view.ox + t[p + 6] * k, d0y = view.oy + t[p + 7] * k;
    const d1x = view.ox + t[p + 8] * k, d1y = view.oy + t[p + 9] * k;
    const d2x = view.ox + t[p + 10] * k, d2y = view.oy + t[p + 11] * k;
    // affine S -> D from the three corner pairs
    const det = (s1x - s0x) * (s2y - s0y) - (s2x - s0x) * (s1y - s0y);
    if (Math.abs(det) < 1e-9) continue;
    const A = ((d1x - d0x) * (s2y - s0y) - (d2x - d0x) * (s1y - s0y)) / det;
    const C = ((d2x - d0x) * (s1x - s0x) - (d1x - d0x) * (s2x - s0x)) / det;
    const B = ((d1y - d0y) * (s2y - s0y) - (d2y - d0y) * (s1y - s0y)) / det;
    const D = ((d2y - d0y) * (s1x - s0x) - (d1y - d0y) * (s2x - s0x)) / det;
    const E = d0x - A * s0x - C * s0y;
    const F = d0y - B * s0x - D * s0y;
    const cx = (d0x + d1x + d2x) / 3, cy = (d0y + d1y + d2y) / 3;
    // each corner pushed half a pixel away from the centre
    const l0 = Math.hypot(d0x - cx, d0y - cy) || 1, l1 = Math.hypot(d1x - cx, d1y - cy) || 1, l2 = Math.hypot(d2x - cx, d2y - cy) || 1;
    const g0x = d0x + ((d0x - cx) / l0) * 0.5, g0y = d0y + ((d0y - cy) / l0) * 0.5;
    const g1x = d1x + ((d1x - cx) / l1) * 0.5, g1y = d1y + ((d1y - cy) / l1) * 0.5;
    const g2x = d2x + ((d2x - cx) / l2) * 0.5, g2y = d2y + ((d2y - cy) / l2) * 0.5;
    const minX = Math.max(0, Math.floor(Math.min(s0x, s1x, s2x) - 1)), minY = Math.max(0, Math.floor(Math.min(s0y, s1y, s2y) - 1));
    const maxX = Math.ceil(Math.max(s0x, s1x, s2x) + 1), maxY = Math.ceil(Math.max(s0y, s1y, s2y) + 1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g0x, g0y);
    ctx.lineTo(g1x, g1y);
    ctx.lineTo(g2x, g2y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(A, B, C, D, E, F);
    ctx.drawImage(src, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY);
    ctx.restore();
  }
}
