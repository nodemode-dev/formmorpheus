// Selection masks: shape builders, boolean combine, extraction and outline tracing.
// Pure typed-array code, no DOM.

import { floodCoverage } from './fill';
import type { CombineMode, Mask, Point, Raster, Rect } from './types';

function newMask(w: number, h: number): Mask {
  return { width: w, height: h, data: new Uint8Array(w * h) };
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Rectangle with exact fractional edge coverage; `feather` is a soft edge radius in pixels. */
export function rectMask(w: number, h: number, r: Rect, feather = 0): Mask {
  const m = newMask(w, h);
  const f = Math.max(0, feather);
  const x0 = Math.max(0, Math.floor(r.x - f)), x1 = Math.min(w, Math.ceil(r.x + r.w + f));
  const y0 = Math.max(0, Math.floor(r.y - f)), y1 = Math.min(h, Math.ceil(r.y + r.h + f));
  const rx1 = r.x + r.w, ry1 = r.y + r.h;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let v: number;
      if (f > 0) {
        const sd = Math.min(x + 0.5 - r.x, rx1 - x - 0.5, y + 0.5 - r.y, ry1 - y - 0.5);
        v = smoothstep((sd + f) / (2 * f));
      } else {
        const cx = Math.min(x + 1, rx1) - Math.max(x, r.x);
        const cy = Math.min(y + 1, ry1) - Math.max(y, r.y);
        v = cx > 0 && cy > 0 ? cx * cy : 0;
      }
      m.data[y * w + x] = Math.round(v * 255);
    }
  }
  return m;
}

/** Ellipse inscribed in `r`, anti-aliased through a first-order distance estimate. */
export function ellipseMask(w: number, h: number, r: Rect): Mask {
  const m = newMask(w, h);
  const rx = r.w / 2, ry = r.h / 2;
  if (rx <= 0 || ry <= 0) return m;
  const cx = r.x + rx, cy = r.y + ry;
  const x0 = Math.max(0, Math.floor(r.x - 1)), x1 = Math.min(w, Math.ceil(r.x + r.w + 1));
  const y0 = Math.max(0, Math.floor(r.y - 1)), y1 = Math.min(h, Math.ceil(r.y + r.h + 1));
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const ux = dx / rx, uy = dy / ry;
      const q = Math.sqrt(ux * ux + uy * uy);
      let dist: number; // signed, positive outside, in pixels
      if (q < 1e-6) dist = -Math.min(rx, ry);
      else {
        const gx = dx / (rx * rx), gy = dy / (ry * ry);
        const g = Math.sqrt(gx * gx + gy * gy) / q;
        dist = (q - 1) / g;
      }
      const v = 0.5 - dist;
      m.data[y * w + x] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }
  return m;
}

const SS = 4;

/** Even-odd polygon fill, exact horizontal coverage and 4x vertical supersampling. */
export function polygonMask(w: number, h: number, pts: Point[]): Mask {
  const m = newMask(w, h);
  const n = pts.length;
  if (n < 3) return m;
  // Edges as [ymin, ymax, x at ymin, dx/dy], sorted by ymin.
  const ey0: number[] = [], ey1: number[] = [], ex: number[] = [], eslope: number[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (a.y === b.y) continue;
    const lo = a.y < b.y ? a : b, hi = a.y < b.y ? b : a;
    ey0.push(lo.y); ey1.push(hi.y); ex.push(lo.x); eslope.push((hi.x - lo.x) / (hi.y - lo.y));
    if (lo.y < minY) minY = lo.y;
    if (hi.y > maxY) maxY = hi.y;
  }
  const ne = ey0.length;
  if (ne < 2) return m;
  const order = Array.from({ length: ne }, (_, i) => i).sort((p, q) => ey0[p] - ey0[q]);
  const rowStart = Math.max(0, Math.floor(minY)), rowEnd = Math.min(h - 1, Math.ceil(maxY));
  const acc = new Float32Array(w);
  let next = 0;
  let active: number[] = [];
  const xs: number[] = [];
  // Start the sub-scan at the first sub-row of rowStart.
  for (let py = rowStart; py <= rowEnd; py++) {
    let lo = w, hi = -1;
    for (let s = 0; s < SS; s++) {
      const sy = py + (s + 0.5) / SS;
      while (next < ne && ey0[order[next]] <= sy) active.push(order[next++]);
      xs.length = 0;
      let keep = 0;
      for (let k = 0; k < active.length; k++) {
        const e = active[k];
        if (ey1[e] <= sy) continue;
        active[keep++] = e;
        xs.push(ex[e] + (sy - ey0[e]) * eslope[e]);
      }
      active.length = keep;
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let a = xs[k], b = xs[k + 1];
        if (b <= 0 || a >= w) continue;
        if (a < 0) a = 0;
        if (b > w) b = w;
        if (b <= a) continue;
        const ia = Math.floor(a), ib = Math.min(w - 1, Math.floor(b));
        if (ia < lo) lo = ia;
        if (ib > hi) hi = ib;
        if (ia === ib) acc[ia] += b - a;
        else {
          acc[ia] += ia + 1 - a;
          for (let x = ia + 1; x < ib; x++) acc[x] += 1;
          acc[ib] += b - ib;
        }
      }
    }
    if (hi >= 0) {
      const row = py * w;
      for (let x = lo; x <= hi; x++) {
        const v = acc[x] / SS;
        m.data[row + x] = v >= 1 ? 255 : Math.round(v * 255);
        acc[x] = 0;
      }
    }
  }
  return m;
}

/** Contiguous colour-similar region (the Automatic selection), same measure as the bucket fill. */
export function autoMask(sample: Raster, x: number, y: number, threshold: number): Mask {
  const res = floodCoverage(sample, x, y, threshold, null);
  if (!res) return newMask(sample.width, sample.height);
  return { width: sample.width, height: sample.height, data: res.cov };
}

/** Boolean combine. `base` null means no existing selection. Soft values use screen and multiply. */
export function combine(base: Mask | null, next: Mask, mode: CombineMode): Mask {
  if (!base || base.width !== next.width || base.height !== next.height) {
    return mode === 'remove'
      ? newMask(next.width, next.height)
      : { width: next.width, height: next.height, data: next.data.slice() };
  }
  if (mode === 'replace') return { width: next.width, height: next.height, data: next.data.slice() };
  const out = newMask(base.width, base.height);
  const a = base.data, b = next.data, o = out.data;
  const n = o.length;
  if (mode === 'add') {
    for (let i = 0; i < n; i++) {
      const p = a[i], q = b[i];
      o[i] = q === 0 ? p : p === 0 ? q : p + q - Math.round((p * q) / 255);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const q = b[i];
      o[i] = q === 0 ? a[i] : q === 255 ? 0 : Math.round((a[i] * (255 - q)) / 255);
    }
  }
  return out;
}

export function invertMask(m: Mask): Mask {
  const out = newMask(m.width, m.height);
  const s = m.data, o = out.data;
  for (let i = 0; i < o.length; i++) o[i] = 255 - s[i];
  return out;
}

/** Tight bounds of the non-zero pixels, or null when the mask is empty. */
export function maskBounds(m: Mask): Rect | null {
  const { width: w, height: h, data } = m;
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let first = -1;
    for (let x = 0; x < w; x++) if (data[row + x]) { first = x; break; }
    if (first < 0) continue;
    let last = first;
    for (let x = w - 1; x > first; x--) if (data[row + x]) { last = x; break; }
    if (first < minX) minX = first;
    if (last > maxX) maxX = last;
    if (y < minY) minY = y;
    maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function isEmpty(m: Mask): boolean {
  const d = m.data;
  for (let i = 0; i < d.length; i++) if (d[i]) return false;
  return true;
}

/** Copy the selected pixels, with the mask multiplied into alpha, cropped to the mask bounds. */
export function extract(r: Raster, m: Mask): { raster: Raster; rect: Rect } {
  const rect = r.width === m.width && r.height === m.height ? maskBounds(m) : null;
  if (!rect) return { raster: { width: 0, height: 0, data: new Uint8ClampedArray(0) }, rect: { x: 0, y: 0, w: 0, h: 0 } };
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const w = r.width;
  for (let yy = 0; yy < rect.h; yy++) {
    for (let xx = 0; xx < rect.w; xx++) {
      const i = (rect.y + yy) * w + rect.x + xx;
      const mv = m.data[i];
      if (!mv) continue;
      const s = i << 2, o = (yy * rect.w + xx) << 2;
      out[o] = r.data[s]; out[o + 1] = r.data[s + 1]; out[o + 2] = r.data[s + 2];
      out[o + 3] = mv === 255 ? r.data[s + 3] : (r.data[s + 3] * mv) / 255;
    }
  }
  return { raster: { width: rect.w, height: rect.h, data: out }, rect };
}

// Marching squares ---------------------------------------------------------

/** Per cell segments as pairs of edge names: T top, R right, B bottom, L left. */
const CASES: string[][] = [
  [], ['LB'], ['BR'], ['LR'], ['TR'], [], ['TB'], ['TL'],
  ['TL'], ['TB'], [], ['TR'], ['LR'], ['BR'], ['LB'], [],
];

/**
 * Contours of the 50% level as closed polylines (first point repeated at the end).
 * Lightly simplified, so the result is small enough to draw as marching ants.
 */
export function maskOutline(m: Mask): Point[][] {
  const b = maskBounds(m);
  if (!b) return [];
  const w = m.width, h = m.height, d = m.data;
  const val = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  // Edge ids: horizontal edge from pixel (x, y) to (x + 1, y) is 2 * k, vertical (x, y) to (x, y + 1) is 2 * k + 1,
  // where k indexes the padded grid.
  const PW = w + 2;
  const hid = (x: number, y: number) => 2 * ((y + 1) * PW + (x + 1));
  const vid = (x: number, y: number) => 2 * ((y + 1) * PW + (x + 1)) + 1;
  const adj = new Map<number, number[]>();
  const link = (p: number, q: number) => {
    let a = adj.get(p); if (!a) adj.set(p, a = []); a.push(q);
    let c = adj.get(q); if (!c) adj.set(q, c = []); c.push(p);
  };
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  // Cell (cx, cy) has corners pixels (cx-1, cy-1) TL, (cx, cy-1) TR, (cx, cy) BR, (cx-1, cy) BL.
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const a = val(cx - 1, cy - 1) >= 128 ? 1 : 0;
      const bb = val(cx, cy - 1) >= 128 ? 1 : 0;
      const c = val(cx, cy) >= 128 ? 1 : 0;
      const dd = val(cx - 1, cy) >= 128 ? 1 : 0;
      const idx = a * 8 + bb * 4 + c * 2 + dd;
      if (idx === 0 || idx === 15) continue;
      let segs = CASES[idx];
      if (idx === 5 || idx === 10) {
        const center = (val(cx - 1, cy - 1) + val(cx, cy - 1) + val(cx, cy) + val(cx - 1, cy)) / 4 >= 128;
        if (idx === 5) segs = center ? ['TL', 'BR'] : ['TR', 'LB'];
        else segs = center ? ['TR', 'LB'] : ['TL', 'BR'];
      }
      const id = (e: string) =>
        e === 'T' ? hid(cx - 1, cy - 1) : e === 'B' ? hid(cx - 1, cy) : e === 'L' ? vid(cx - 1, cy - 1) : vid(cx, cy - 1);
      for (const s of segs) link(id(s[0]), id(s[1]));
    }
  }
  const pointOf = (id: number): Point => {
    const horizontal = (id & 1) === 0;
    const k = id >> 1;
    const x = (k % PW) - 1, y = Math.floor(k / PW) - 1;
    const v0 = val(x, y);
    const v1 = horizontal ? val(x + 1, y) : val(x, y + 1);
    const t = v1 === v0 ? 0.5 : (127.5 - v0) / (v1 - v0);
    return horizontal ? { x: x + 0.5 + t, y: y + 0.5 } : { x: x + 0.5, y: y + 0.5 + t };
  };
  const seen = new Set<number>();
  const loops: Point[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ids: number[] = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      ids.push(cur);
      const nb = adj.get(cur)!;
      const nxt = nb[0] !== prev && !seen.has(nb[0]) ? nb[0] : nb.length > 1 && !seen.has(nb[1]) ? nb[1] : -1;
      if (nxt < 0) break;
      prev = cur; cur = nxt;
    }
    if (ids.length < 3) continue;
    const pts = ids.map(pointOf);
    pts.push(pts[0]);
    loops.push(simplifyClosed(pts, 0.35));
  }
  return loops;
}

function simplifyClosed(pts: Point[], tol: number): Point[] {
  const n = pts.length - 1; // pts[n] repeats pts[0]
  if (n < 8) return pts;
  // Split at the point farthest from the start so both halves are open runs.
  let far = 1, best = -1;
  for (let i = 1; i < n; i++) {
    const dx = pts[i].x - pts[0].x, dy = pts[i].y - pts[0].y;
    const dd = dx * dx + dy * dy;
    if (dd > best) { best = dd; far = i; }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen(pts.slice(far).concat([pts[n]]), tol);
  return a.concat(b.slice(1));
}

function simplifyOpen(pts: Point[], tol: number): Point[] {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const j = stack.pop()!, i = stack.pop()!;
    const ax = pts[i].x, ay = pts[i].y, bx = pts[j].x, by = pts[j].y;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let k = i + 1; k < j; k++) {
      const dist = Math.abs((pts[k].x - ax) * dy - (pts[k].y - ay) * dx) / len;
      if (dist > md) { md = dist; mi = k; }
    }
    if (md > tol && mi >= 0) {
      keep[mi] = 1;
      stack.push(i, mi, mi, j);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
