// Cheap live preview of a distort or warp while its handles are dragged: a triangle mesh of a small copy of the piece,
// drawn with one affine map per triangle. The real resample runs when the pointer is released.
import { makeGrid, refineGridBent, type Bend } from '../paint/transform';
import type { Point } from '../paint/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const SMALL = 384;
const smalls = new WeakMap<OffscreenCanvas, OffscreenCanvas>();

/** A copy of the piece no larger than SMALL px a side (the piece itself when it is already small). */
function small(src: OffscreenCanvas): OffscreenCanvas {
  if (Math.max(src.width, src.height) <= SMALL) return src;
  let s = smalls.get(src);
  if (!s) {
    const k = SMALL / Math.max(src.width, src.height);
    s = new OffscreenCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
    const g = s.getContext('2d') as OffscreenCanvasRenderingContext2D;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, s.width, s.height);
    smalls.set(src, s);
  }
  return s;
}

/** Draws `pieces` (all sharing the grid of the first) deformed onto `grid`, a destination grid over the source rect. */
function drawMesh(ctx: Ctx, pieces: OffscreenCanvas[], grid: Point[][]): void {
  const rows = grid.length, cols = grid[0].length;
  const tri = (img: OffscreenCanvas, s0: Point, s1: Point, s2: Point, d0: Point, d1: Point, d2: Point): void => {
    // affine map from the source triangle to the destination triangle
    const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(det) < 1e-9) return;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
    const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
    const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - d * s0.y;
    ctx.save();
    // the clip is grown a little so neighbouring triangles overlap instead of leaving seams
    const cx = (d0.x + d1.x + d2.x) / 3, cy = (d0.y + d1.y + d2.y) / 3;
    const grow = (p: Point): [number, number] => { const l = Math.hypot(p.x - cx, p.y - cy) || 1; return [p.x + ((p.x - cx) / l) * 0.6, p.y + ((p.y - cy) / l) * 0.6]; };
    ctx.beginPath();
    const g0 = grow(d0), g1 = grow(d1), g2 = grow(d2);
    ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]); ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  for (const piece of pieces) {
    const img = small(piece);
    const w = img.width, h = img.height;
    const sp = (i: number, j: number): Point => ({ x: (j / (cols - 1)) * w, y: (i / (rows - 1)) * h });
    for (let i = 0; i + 1 < rows; i++) {
      for (let j = 0; j + 1 < cols; j++) {
        const s00 = sp(i, j), s01 = sp(i, j + 1), s10 = sp(i + 1, j), s11 = sp(i + 1, j + 1);
        tri(img, s00, s01, s11, grid[i][j], grid[i][j + 1], grid[i + 1][j + 1]);
        tri(img, s00, s11, s10, grid[i][j], grid[i + 1][j + 1], grid[i + 1][j]);
      }
    }
  }
}

/** Distort: the piece on the dragged quad (a bilinear mesh; the release resamples in perspective). */
export function drawQuadPreview(ctx: Ctx, pieces: OffscreenCanvas[], quad: Point[]): void {
  drawMesh(ctx, pieces, makeGrid(quad, 9));
}

/** Warp: the piece on the control grid, lightly subdivided so the curve shows. */
export function drawGridPreview(ctx: Ctx, pieces: OffscreenCanvas[], grid: Point[][], bend: Bend[][] | null): void {
  drawMesh(ctx, pieces, refineGridBent(grid, bend, 2));
}
