// Text on a path: the curve as a polyline with arc length, and where a letter sits on it (position and turn).
// Pure maths, no DOM. The curve is centred on the text block's centre.
import type { TextPath } from './text-rich';

export interface Poly { pts: number[]; cum: number[]; total: number }

const STEP = 4;

function finish(pts: number[]): Poly {
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return { pts, cum, total: cum[cum.length - 1] };
}

/** The path as a polyline for text `len` px long whose block is centred on (cx, cy). */
export function buildPath(p: TextPath, cx: number, cy: number, len: number): Poly {
  const L = Math.max(1, len), pts: number[] = [];
  const n = Math.max(2, Math.ceil(L / STEP));
  if (p.kind === 'wave') {
    const amp = p.amp ?? 40, wl = Math.max(8, p.len ?? 400);
    for (let i = 0; i <= n; i++) { const s = (i / n) * L; pts.push(cx - L / 2 + s, cy + amp * Math.sin((Math.PI * 2 * s) / wl)); }
  } else if (p.kind === 'arc' || p.kind === 'circle') {
    // an arc and a circle are one thing: a circle of radius R with the text centred on its top; a bend sets R from the length
    const b = p.kind === 'arc' ? (p.bend ?? 0.5) : 1;
    const sg = b < 0 ? -1 : 1;
    const R = p.kind === 'circle' ? Math.max(4, p.radius ?? L / (Math.PI * 2)) : L / Math.max(0.001, Math.abs(b) * Math.PI);
    for (let i = 0; i <= n; i++) {
      const phi = ((i / n) * L - L / 2) / R;
      pts.push(cx + R * Math.sin(phi), cy - sg * (R * Math.cos(phi) - R));
    }
  } else {
    const nodes = p.nodes ?? [];
    if (nodes.length < 2) { for (let i = 0; i <= n; i++) pts.push(cx - L / 2 + (i / n) * L, cy); return finish(pts); }
    pts.push(cx + nodes[0].x, cy + nodes[0].y);
    for (let k = 0; k < nodes.length - 1; k++) {
      const a = nodes[k], b = nodes[k + 1];
      const x0 = a.x, y0 = a.y, x1 = a.x + a.ox, y1 = a.y + a.oy, x2 = b.x + b.ix, y2 = b.y + b.iy, x3 = b.x, y3 = b.y;
      const m = Math.max(8, Math.min(240, Math.ceil((Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)) / STEP)));
      for (let i = 1; i <= m; i++) {
        const t = i / m, u = 1 - t;
        pts.push(cx + u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, cy + u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
    }
  }
  return finish(pts);
}

/** Position and tangent angle (radians) at arc length `s`; past either end the curve continues straight. */
export function pathAt(poly: Poly, s: number): { x: number; y: number; ang: number } {
  const { pts, cum, total } = poly;
  const n = cum.length;
  if (n < 2) return { x: pts[0] ?? 0, y: pts[1] ?? 0, ang: 0 };
  let i: number;
  if (s <= 0) i = 1;
  else if (s >= total) i = n - 1;
  else { let lo = 1, hi = n - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] >= s) hi = mid; else lo = mid + 1; } i = lo; }
  const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1], x1 = pts[i * 2], y1 = pts[i * 2 + 1];
  const seg = Math.max(1e-6, cum[i] - cum[i - 1]), t = (s - cum[i - 1]) / seg;
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, ang: Math.atan2(y1 - y0, x1 - x0) };
}

/** Bounds of the polyline, for the layout box. */
export function pathBounds(poly: Poly): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < poly.pts.length; i += 2) { x0 = Math.min(x0, poly.pts[i]); x1 = Math.max(x1, poly.pts[i]); y0 = Math.min(y0, poly.pts[i + 1]); y1 = Math.max(y1, poly.pts[i + 1]); }
  return { x0, y0, x1, y1 };
}
