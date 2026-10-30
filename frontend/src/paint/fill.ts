// Flood fill, selection fill and clear. Pure typed-array code, no DOM.
// The fill functions edit `target` in place and return the undo patch.

import type { Mask, PixelPatch, Raster, Rect, RGB } from './types';

/** Width of the soft band above the threshold where coverage falls from 1 to 0. */
const SOFT = 0.1;

export interface FloodResult {
  /** Per pixel coverage 0..255 (members are at least 1). */
  cov: Uint8Array;
  /** Bounds of the member pixels. */
  bounds: Rect;
}

/**
 * Contiguous colour-similar region around (x, y) in `sample`. Distance is the larger of
 * the alpha difference and the colour difference weighted by the lower alpha, so empty
 * pixels never differ by colour. Pixels past the threshold get partial coverage.
 */
export function floodCoverage(
  sample: Raster, x: number, y: number, threshold: number, selection: Mask | null,
): FloodResult | null {
  const w = sample.width, h = sample.height;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const sel = selection && selection.width === w && selection.height === h ? selection.data : null;
  if (sel && sel[y * w + x] === 0) return null;
  const d = sample.data;
  const si = (y * w + x) * 4;
  const sr = d[si], sg = d[si + 1], sb = d[si + 2], sa = d[si + 3];
  const t = Math.min(1, Math.max(0, threshold));
  const hi = Math.min(1, t + SOFT);
  const span = hi - t;
  const cov = new Uint8Array(w * h);

  const test = (px: number, py: number): number => {
    const i = py * w + px;
    if (sel && sel[i] === 0) return 0;
    const j = i << 2;
    const a = d[j + 3];
    const da = a > sa ? a - sa : sa - a;
    let dr = d[j] - sr; if (dr < 0) dr = -dr;
    let dg = d[j + 1] - sg; if (dg < 0) dg = -dg;
    let db = d[j + 2] - sb; if (db < 0) db = -db;
    const mx = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
    const dc = (mx * (a < sa ? a : sa)) / 65025;
    const dist = Math.max(da / 255, dc);
    if (dist <= t) return 255;
    if (dist >= hi || span <= 0) return 0;
    const c = Math.round((255 * (hi - dist)) / span);
    return c < 1 ? 1 : c;
  };

  let stack = new Int32Array(8192);
  let sp = 0;
  const push = (px: number, py: number) => {
    if (sp + 2 > stack.length) { const n = new Int32Array(stack.length * 2); n.set(stack); stack = n; }
    stack[sp++] = px; stack[sp++] = py;
  };

  let minX = x, maxX = x, minY = y, maxY = y;
  push(x, y);
  while (sp > 0) {
    // Pairs are pushed as x then y, so y pops first.
    const py = stack[--sp];
    const px = stack[--sp];
    const row = py * w;
    if (cov[row + px] !== 0) continue;
    const c0 = test(px, py);
    if (!c0) continue;
    cov[row + px] = c0;
    let l = px, r = px;
    while (l > 0 && cov[row + l - 1] === 0) {
      const c = test(l - 1, py);
      if (!c) break;
      cov[row + --l] = c;
    }
    while (r < w - 1 && cov[row + r + 1] === 0) {
      const c = test(r + 1, py);
      if (!c) break;
      cov[row + ++r] = c;
    }
    if (l < minX) minX = l;
    if (r > maxX) maxX = r;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    for (let k = 0; k < 2; k++) {
      const ny = k === 0 ? py - 1 : py + 1;
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let xx = l; xx <= r; xx++) {
        if (cov[nrow + xx] === 0 && test(xx, ny) > 0) {
          if (!inRun) { push(xx, ny); inRun = true; }
        } else inRun = false;
      }
    }
  }
  return { cov, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

function copyRect(src: Uint8ClampedArray, w: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  const rowBytes = r.w * 4;
  for (let yy = 0; yy < r.h; yy++) {
    const s = ((r.y + yy) * w + r.x) * 4;
    out.set(src.subarray(s, s + rowBytes), yy * rowBytes);
  }
  return out;
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Composite a fill colour with alpha `k` (0..1) onto pixel j. `under` puts it beneath the pixel. */
function put(td: Uint8ClampedArray, j: number, c: RGB, k: number, under: boolean): void {
  if (k <= 0) return;
  const ea = td[j + 3];
  if (!under) {
    if (k >= 0.999) { td[j] = c.r; td[j + 1] = c.g; td[j + 2] = c.b; td[j + 3] = 255; return; }
    if (ea >= 250) {
      td[j] = td[j] + (c.r - td[j]) * k;
      td[j + 1] = td[j + 1] + (c.g - td[j + 1]) * k;
      td[j + 2] = td[j + 2] + (c.b - td[j + 2]) * k;
      td[j + 3] = ea + (255 - ea) * k;
      return;
    }
  }
  if (ea >= 255 && under) return;
  const e = ea / 255;
  if (under) {
    // Existing pixel over the fill.
    const ao = e + k * (1 - e);
    const wf = (k * (1 - e)) / ao, we = e / ao;
    td[j] = td[j] * we + c.r * wf;
    td[j + 1] = td[j + 1] * we + c.g * wf;
    td[j + 2] = td[j + 2] * we + c.b * wf;
    td[j + 3] = ao * 255;
  } else {
    // Fill over the existing pixel.
    const ao = k + e * (1 - k);
    const wf = k / ao, we = (e * (1 - k)) / ao;
    td[j] = td[j] * we + c.r * wf;
    td[j + 1] = td[j + 1] * we + c.g * wf;
    td[j + 2] = td[j + 2] * we + c.b * wf;
    td[j + 3] = ao * 255;
  }
}

/**
 * Paint-bucket fill. Compares `sample` (the layer, or a flattened copy for all layers)
 * against the pixel under the click and writes `color` into `target`. Partly covered
 * edge pixels blend, and a 1 px ring around the region is filled beneath whatever is
 * there, so soft line art leaves no gap between the line and the fill.
 */
export function floodFill(
  target: Raster, sample: Raster, x: number, y: number, color: RGB,
  threshold: number, selection: Mask | null, layerId: string,
): PixelPatch | null {
  const w = target.width, h = target.height;
  if (sample.width !== w || sample.height !== h) return null;
  const res = floodCoverage(sample, x, y, threshold, selection);
  if (!res) return null;
  const sel = selection && selection.width === w && selection.height === h ? selection.data : null;
  const { cov, bounds } = res;
  const rect = clampRect({ x: bounds.x - 1, y: bounds.y - 1, w: bounds.w + 2, h: bounds.h + 2 }, w, h);
  const before = copyRect(target.data, w, rect);
  const td = target.data;
  const x1 = rect.x + rect.w, y1 = rect.y + rect.h;

  for (let yy = rect.y; yy < y1; yy++) {
    const row = yy * w;
    for (let xx = rect.x; xx < x1; xx++) {
      const i = row + xx;
      const m = sel ? sel[i] / 255 : 1;
      if (m === 0) continue;
      const c = cov[i];
      if (c) {
        put(td, i << 2, color, (c / 255) * m, false);
        continue;
      }
      if (td[(i << 2) + 3] === 255) continue;
      // Ring: any member neighbour in the 8-neighbourhood.
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        const ny = yy + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = xx + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          if (cov[ny * w + nx] > 127) { near = true; break; }
        }
      }
      if (near) put(td, i << 2, color, m, true);
    }
  }
  return { layer: layerId, rect, before, after: copyRect(td, w, rect) };
}

function maskRect(mask: Mask): Rect | null {
  const { width: w, height: h, data } = mask;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let yy = 0; yy < h; yy++) {
    const row = yy * w;
    let first = -1, last = -1;
    for (let xx = 0; xx < w; xx++) if (data[row + xx]) { first = xx; break; }
    if (first < 0) continue;
    for (let xx = w - 1; xx >= first; xx--) if (data[row + xx]) { last = xx; break; }
    if (first < minX) minX = first;
    if (last > maxX) maxX = last;
    if (yy < minY) minY = yy;
    maxY = yy;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const EMPTY = (layer: string): PixelPatch => ({
  layer, rect: { x: 0, y: 0, w: 0, h: 0 },
  before: new Uint8ClampedArray(0), after: new Uint8ClampedArray(0),
});

/** Color Fill of a selection: the colour is composited over the layer, weighted by the mask. */
export function fillMask(target: Raster, mask: Mask, color: RGB, layerId: string): PixelPatch {
  const w = target.width;
  if (mask.width !== w || mask.height !== target.height) return EMPTY(layerId);
  const rect = maskRect(mask);
  if (!rect) return EMPTY(layerId);
  const before = copyRect(target.data, w, rect);
  const td = target.data, md = mask.data;
  for (let yy = rect.y; yy < rect.y + rect.h; yy++) {
    for (let xx = rect.x; xx < rect.x + rect.w; xx++) {
      const m = md[yy * w + xx];
      if (m) put(td, (yy * w + xx) << 2, color, m / 255, false);
    }
  }
  return { layer: layerId, rect, before, after: copyRect(td, w, rect) };
}

/** Delete the selected pixels (alpha scaled by the inverse of the mask). */
export function clearMask(target: Raster, mask: Mask, layerId: string): PixelPatch {
  const w = target.width;
  if (mask.width !== w || mask.height !== target.height) return EMPTY(layerId);
  const rect = maskRect(mask);
  if (!rect) return EMPTY(layerId);
  const before = copyRect(target.data, w, rect);
  const td = target.data, md = mask.data;
  for (let yy = rect.y; yy < rect.y + rect.h; yy++) {
    for (let xx = rect.x; xx < rect.x + rect.w; xx++) {
      const m = md[yy * w + xx];
      if (!m) continue;
      const j = ((yy * w + xx) << 2) + 3;
      td[j] = m === 255 ? 0 : (td[j] * (255 - m)) / 255;
    }
  }
  return { layer: layerId, rect, before, after: copyRect(td, w, rect) };
}
