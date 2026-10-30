// Resampling of a floating piece: affine, perspective quad and mesh warps.
// Sampling works on premultiplied values so soft edges do not darken. Pure maths.
// Source coordinates are continuous: pixel i covers [i, i + 1] and its centre is i + 0.5.

import type { Interpolation, Point, Raster, Rect } from './types';

type Sampler = (src: Raster, x: number, y: number, out: Uint8ClampedArray, o: number) => void;

function sampleNearest(src: Raster, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) {
    out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
    return;
  }
  const i = (iy * src.width + ix) << 2, d = src.data;
  out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; out[o + 3] = d[i + 3];
}

function sampleBilinear(src: Raster, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const w = src.width, h = src.height, d = src.data;
  const fx = x - 0.5, fy = y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  let A = 0, R = 0, G = 0, B = 0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= h) continue;
    const wy = j ? ty : 1 - ty;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= w) continue;
      const k = (yy * w + xx) << 2;
      const a = d[k + 3];
      if (a === 0) continue;
      const wt = (i ? tx : 1 - tx) * wy * a;
      A += wt; R += wt * d[k]; G += wt * d[k + 1]; B += wt * d[k + 2];
    }
  }
  if (A < 0.5) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  out[o] = R / A; out[o + 1] = G / A; out[o + 2] = B / A; out[o + 3] = A;
}

const WX = new Float64Array(4), WY = new Float64Array(4);

function crWeights(t: number, w: Float64Array): void {
  const t2 = t * t, t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

function sampleBicubic(src: Raster, x: number, y: number, out: Uint8ClampedArray, o: number): void {
  const w = src.width, h = src.height, d = src.data;
  const fx = x - 0.5, fy = y - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  crWeights(fx - x0, WX);
  crWeights(fy - y0, WY);
  let A = 0, R = 0, G = 0, B = 0;
  for (let j = 0; j < 4; j++) {
    const yy = y0 - 1 + j;
    if (yy < 0 || yy >= h) continue;
    const wy = WY[j];
    for (let i = 0; i < 4; i++) {
      const xx = x0 - 1 + i;
      if (xx < 0 || xx >= w) continue;
      const k = (yy * w + xx) << 2;
      const a = d[k + 3];
      if (a === 0) continue;
      const wt = WX[i] * wy * a;
      A += wt; R += wt * d[k]; G += wt * d[k + 1]; B += wt * d[k + 2];
    }
  }
  if (A < 0.5) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
  out[o] = R / A; out[o + 1] = G / A; out[o + 2] = B / A;
  out[o + 3] = A > 255 ? 255 : A;
}

function pick(interp: Interpolation): Sampler {
  return interp === 'nearest' ? sampleNearest : interp === 'bicubic' ? sampleBicubic : sampleBilinear;
}

/** Sample the raster at (x, y) into out[o..o+3] as straight alpha; outside the raster is transparent. */
export function sampleRaster(
  src: Raster, x: number, y: number, interp: Interpolation, out: Uint8ClampedArray, o: number,
): void {
  pick(interp)(src, x, y, out, o);
}

const MARGIN: Record<Interpolation, number> = { nearest: 0, bilinear: 1, bicubic: 2 };

/** Source-over of one straight-alpha sample onto dst at byte offset j. */
function over(dd: Uint8ClampedArray, j: number, s: Uint8ClampedArray): void {
  const sa = s[3];
  if (sa === 0) return;
  const da = dd[j + 3];
  if (sa === 255 || da === 0) {
    dd[j] = s[0]; dd[j + 1] = s[1]; dd[j + 2] = s[2]; dd[j + 3] = sa;
    return;
  }
  const a = sa / 255, b = da / 255;
  const ao = a + b * (1 - a);
  const ws = a / ao, wd = (b * (1 - a)) / ao;
  dd[j] = s[0] * ws + dd[j] * wd;
  dd[j + 1] = s[1] * ws + dd[j + 1] * wd;
  dd[j + 2] = s[2] * ws + dd[j + 2] * wd;
  dd[j + 3] = ao * 255;
}

/** Box-average the source down by an integer factor so heavy shrinks do not alias. */
function shrink(src: Raster, k: number): Raster {
  const nw = Math.ceil(src.width / k), nh = Math.ceil(src.height / k);
  const out = new Uint8ClampedArray(nw * nh * 4);
  const d = src.data, w = src.width, h = src.height;
  for (let y = 0; y < nh; y++) {
    const ys = y * k, ye = Math.min(h, ys + k);
    for (let x = 0; x < nw; x++) {
      const xs = x * k, xe = Math.min(w, xs + k);
      let A = 0, R = 0, G = 0, B = 0;
      for (let yy = ys; yy < ye; yy++) {
        for (let xx = xs; xx < xe; xx++) {
          const i = (yy * w + xx) << 2, a = d[i + 3];
          A += a; R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a;
        }
      }
      const cnt = (ye - ys) * (xe - xs);
      const o = (y * nw + x) << 2;
      if (A > 0) { out[o] = R / A; out[o + 1] = G / A; out[o + 2] = B / A; out[o + 3] = A / cnt; }
    }
  }
  return { width: nw, height: nh, data: out };
}

function clipRect(x0: number, y0: number, x1: number, y1: number, dst: Raster, lim?: Rect): Rect | null {
  let ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
  let bx = Math.min(dst.width, Math.ceil(x1)), by = Math.min(dst.height, Math.ceil(y1));
  if (lim) {
    ax = Math.max(ax, lim.x); ay = Math.max(ay, lim.y);
    bx = Math.min(bx, lim.x + lim.w); by = Math.min(by, lim.y + lim.h);
  }
  return bx > ax && by > ay ? { x: ax, y: ay, w: bx - ax, h: by - ay } : null;
}

/** Range of x where lo <= a * x + b <= hi, as [x0, x1]; null when empty. */
function span(a: number, b: number, lo: number, hi: number): [number, number] | null {
  if (Math.abs(a) < 1e-12) return b >= lo && b <= hi ? [-Infinity, Infinity] : null;
  const p = (lo - b) / a, q = (hi - b) / a;
  return p < q ? [p, q] : [q, p];
}

/**
 * Draw `src` into `dst` through the affine map m = [a, b, c, d, e, f] (x' = a x + c y + e,
 * y' = b x + d y + f), source-over, by inverse mapping. Only the destination bounds of the
 * mapped piece (clipped to dstRect and dst) are visited. Returns the changed rectangle.
 */
export function transformAffine(
  src: Raster, m: [number, number, number, number, number, number], dst: Raster,
  interp: Interpolation, dstRect?: Rect,
): Rect | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12 || src.width === 0 || src.height === 0) return null;
  let ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  let ie = (c * f - d * e) / det, iff = (b * e - a * f) / det;
  // Heavy minification: pre-average the source.
  const minify = Math.max(Math.hypot(ia, ib), Math.hypot(ic, id));
  let s = src;
  if (minify >= 2 && interp !== 'nearest') {
    const k = Math.floor(minify);
    s = shrink(src, k);
    ia /= k; ib /= k; ic /= k; id /= k; ie /= k; iff /= k;
  }
  const W = s.width, H = s.height;
  const mg = MARGIN[interp];
  const xs = [0, src.width, src.width, 0].map((px, i) => a * px + c * (i < 2 ? 0 : src.height) + e);
  const ys = [0, src.width, src.width, 0].map((px, i) => b * px + d * (i < 2 ? 0 : src.height) + f);
  const reach = mg * Math.max(1, 1 / Math.max(1e-6, Math.min(Math.hypot(ia, ib), Math.hypot(ic, id)))) + 1;
  const box = clipRect(
    Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach, dst, dstRect,
  );
  if (!box) return null;
  const sampler = pick(interp);
  const px = new Uint8ClampedArray(4);
  const dd = dst.data, dw = dst.width;
  for (let y = box.y; y < box.y + box.h; y++) {
    const cy = y + 0.5;
    // Source coords are linear in x, so clip the row to the margin-expanded source box.
    const sx0 = ic * cy + ie, sy0 = id * cy + iff;
    const rx = span(ia, sx0 + ia * 0.5, -mg, W + mg);
    const ry = span(ib, sy0 + ib * 0.5, -mg, H + mg);
    if (!rx || !ry) continue;
    const xa = Math.max(box.x, Math.ceil(Math.max(rx[0], ry[0]) - 1));
    const xb = Math.min(box.x + box.w, Math.floor(Math.min(rx[1], ry[1]) + 1) + 1);
    for (let x = xa; x < xb; x++) {
      const cx = x + 0.5;
      sampler(s, ia * cx + sx0, ib * cx + sy0, px, 0);
      if (px[3]) over(dd, (y * dw + x) << 2, px);
    }
  }
  return box;
}

/** Solve for the 3x3 projective matrix (row major, h33 = 1) that maps `from[i]` to `to[i]` for 4 points. */
export function homography(from: Point[], to: Point[]): number[] | null {
  if (from.length < 4 || to.length < 4) return null;
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], u = to[i].x, v = to[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  h.push(1);
  return h;
}

/**
 * Perspective draw: the source rectangle maps onto `corners` (top-left, top-right,
 * bottom-right, bottom-left in destination space). Returns the changed rectangle.
 */
export function transformQuad(
  src: Raster, corners: [Point, Point, Point, Point], dst: Raster, interp: Interpolation,
): Rect | null {
  if (src.width === 0 || src.height === 0) return null;
  let s = src, k = 1;
  const area = Math.abs(polyArea(corners));
  if (area > 1 && interp !== 'nearest') {
    const scale = Math.sqrt((src.width * src.height) / area);
    if (scale >= 2) { k = Math.floor(scale); s = shrink(src, k); }
  }
  const W = s.width, H = s.height;
  const srcCorners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const hm = homography(corners, srcCorners);
  if (!hm) return null;
  const mg = MARGIN[interp];
  const box = clipRect(
    Math.min(...corners.map(p => p.x)) - 1, Math.min(...corners.map(p => p.y)) - 1,
    Math.max(...corners.map(p => p.x)) + 1, Math.max(...corners.map(p => p.y)) + 1, dst,
  );
  if (!box) return null;
  const sampler = pick(interp);
  const px = new Uint8ClampedArray(4);
  const dd = dst.data, dw = dst.width;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = hm;
  for (let y = box.y; y < box.y + box.h; y++) {
    const cy = y + 0.5;
    for (let x = box.x; x < box.x + box.w; x++) {
      const cx = x + 0.5;
      const wv = h6 * cx + h7 * cy + h8;
      if (wv <= 1e-9) continue;
      const sx = (h0 * cx + h1 * cy + h2) / wv, sy = (h3 * cx + h4 * cy + h5) / wv;
      if (sx < -mg || sy < -mg || sx > W + mg || sy > H + mg) continue;
      sampler(s, sx, sy, px, 0);
      if (px[3]) over(dd, (y * dw + x) << 2, px);
    }
  }
  return box;
}

function polyArea(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Warp through a control grid: `grid[row][col]` are destination positions of a regular
 * grid laid over the source. Each cell is a bilinear patch, so use refineGrid first for
 * a smooth result. Outer cells reach one sample past the source so the edge stays
 * anti-aliased. Returns the changed rectangle.
 */
export function transformMesh(src: Raster, grid: Point[][], dst: Raster, interp: Interpolation): Rect | null {
  const rows = grid.length, cols = rows ? grid[0].length : 0;
  if (rows < 2 || cols < 2 || src.width === 0 || src.height === 0) return null;
  let total = 0;
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      total += Math.abs(polyArea([grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]));
    }
  }
  let s = src;
  if (total > 1 && interp !== 'nearest') {
    const scale = Math.sqrt((src.width * src.height) / total);
    if (scale >= 2) s = shrink(src, Math.floor(scale));
  }
  const W = s.width, H = s.height;
  const cw = W / (cols - 1), ch = H / (rows - 1);
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const row of grid) for (const p of row) {
    if (p.x < gx0) gx0 = p.x; if (p.x > gx1) gx1 = p.x;
    if (p.y < gy0) gy0 = p.y; if (p.y > gy1) gy1 = p.y;
  }
  const pad = 2;
  const box = clipRect(gx0 - pad, gy0 - pad, gx1 + pad, gy1 + pad, dst);
  if (!box) return null;
  const claim = new Uint8Array(box.w * box.h);
  const sampler = pick(interp);
  const px = new Uint8ClampedArray(4);
  const dd = dst.data, dw = dst.width;
  const EPS = 1e-4;
  // Outer edges reach this many source pixels past the border (for the soft edge).
  const extU = (MARGIN[interp] + 1) / cw, extV = (MARGIN[interp] + 1) / ch;

  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const P00 = grid[i][j], P10 = grid[i][j + 1], P11 = grid[i + 1][j + 1], P01 = grid[i + 1][j];
      const ulo = j === 0 ? -extU : -EPS, uhi = j === cols - 2 ? 1 + extU : 1 + EPS;
      const vlo = i === 0 ? -extV : -EPS, vhi = i === rows - 2 ? 1 + extV : 1 + EPS;
      // Bounds of this cell, widened on outer sides for the edge reach.
      const ex = P10.x - P00.x, ey = P10.y - P00.y;
      const fx = P01.x - P00.x, fy = P01.y - P00.y;
      const gx = P00.x - P10.x + P11.x - P01.x, gy = P00.y - P10.y + P11.y - P01.y;
      const reach = 2 + (MARGIN[interp] + 1) * 2;
      const cell = clipRect(
        Math.min(P00.x, P10.x, P11.x, P01.x) - (j === 0 || i === 0 || j === cols - 2 || i === rows - 2 ? reach : 1),
        Math.min(P00.y, P10.y, P11.y, P01.y) - (j === 0 || i === 0 || j === cols - 2 || i === rows - 2 ? reach : 1),
        Math.max(P00.x, P10.x, P11.x, P01.x) + (j === 0 || i === 0 || j === cols - 2 || i === rows - 2 ? reach : 1),
        Math.max(P00.y, P10.y, P11.y, P01.y) + (j === 0 || i === 0 || j === cols - 2 || i === rows - 2 ? reach : 1),
        dst,
      );
      if (!cell) continue;
      const k2c = gx * fy - gy * fx; // cross(g, f)
      for (let y = cell.y; y < cell.y + cell.h; y++) {
        const hy = y + 0.5 - P00.y;
        for (let x = cell.x; x < cell.x + cell.w; x++) {
          const ci = (y - box.y) * box.w + (x - box.x);
          if (claim[ci]) continue;
          const hx = x + 0.5 - P00.x;
          const k1 = ex * fy - ey * fx + (hx * gy - hy * gx);
          const k0 = hx * ey - hy * ex;
          let u = 0, v = 0, ok = false;
          const tryV = (vv: number): boolean => {
            if (vv < vlo || vv > vhi) return false;
            const den1 = ex + gx * vv, den2 = ey + gy * vv;
            const uu = Math.abs(den1) > Math.abs(den2) ? (hx - fx * vv) / den1 : (hy - fy * vv) / den2;
            if (!(uu >= ulo && uu <= uhi)) return false;
            u = uu; v = vv;
            return true;
          };
          if (Math.abs(k2c) < 1e-9) {
            if (Math.abs(k1) > 1e-12) ok = tryV(-k0 / k1);
          } else {
            const disc = k1 * k1 - 4 * k0 * k2c;
            if (disc >= 0) {
              const sq = Math.sqrt(disc);
              ok = tryV((-k1 - sq) / (2 * k2c)) || tryV((-k1 + sq) / (2 * k2c));
            }
          }
          if (!ok) continue;
          claim[ci] = 1;
          sampler(s, (j + u) * cw, (i + v) * ch, px, 0);
          if (px[3]) over(dd, (y * dw + x) << 2, px);
        }
      }
    }
  }
  return box;
}

/** Subdivide a control grid with Catmull-Rom splines: each cell becomes n x n, for smooth warps. */
export function refineGrid(grid: Point[][], n: number): Point[][] {
  const rows = grid.length, cols = rows ? grid[0].length : 0;
  if (n <= 1 || rows < 2 || cols < 2) return grid.map(r => r.map(p => ({ ...p })));
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const cl = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  const nr = (rows - 1) * n + 1, nc = (cols - 1) * n + 1;
  // Interpolate along rows first, then down columns.
  const mid: Point[][] = [];
  for (let i = 0; i < rows; i++) {
    const out: Point[] = [];
    for (let c = 0; c < nc; c++) {
      const j = Math.min(cols - 2, Math.floor(c / n)), t = (c - j * n) / n;
      const g = (k: number) => grid[i][cl(k, cols - 1)];
      out.push({
        x: cr(g(j - 1).x, g(j).x, g(j + 1).x, g(j + 2).x, t),
        y: cr(g(j - 1).y, g(j).y, g(j + 1).y, g(j + 2).y, t),
      });
    }
    mid.push(out);
  }
  const res: Point[][] = [];
  for (let r = 0; r < nr; r++) {
    const i = Math.min(rows - 2, Math.floor(r / n)), t = (r - i * n) / n;
    const out: Point[] = [];
    for (let c = 0; c < nc; c++) {
      const g = (k: number) => mid[cl(k, rows - 1)][c];
      out.push({
        x: cr(g(i - 1).x, g(i).x, g(i + 1).x, g(i + 2).x, t),
        y: cr(g(i - 1).y, g(i).y, g(i + 1).y, g(i + 2).y, t),
      });
    }
    res.push(out);
  }
  return res;
}
