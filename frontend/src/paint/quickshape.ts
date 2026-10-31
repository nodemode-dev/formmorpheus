// QuickShape: fits a rough hand-drawn stroke to a clean line, arc, ellipse, rectangle, triangle or polygon, and
// rebuilds the clean outline as points. Pure maths on canvas-pixel points; the host re-stamps the points with the
// stroke's own pressure profile. While the pen stays down the shape can be adjusted (`shapePoints` with a pointer)
// and made regular (`regular`: 15 degree lines, circle, square, equal-sided polygon).

export interface Pt { x: number; y: number }

export type ShapeKind = 'line' | 'arc' | 'ellipse' | 'rectangle' | 'triangle' | 'polygon' | 'polyline';

export interface Shape {
  kind: ShapeKind;
  closed: boolean;
  /** Where the adjusting pointer started (the stroke's last point); scale and turn are measured from here. */
  grab: Pt;
  /** Line and arc: the fixed start; polygons: the vertices; ellipse: the centre. */
  v: Pt[];
  /** Arc: signed sweep in radians. */
  sweep: number;
  /** Ellipse radii and turn. */
  rx: number;
  ry: number;
  rot: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(p: Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

/** `n` points evenly spaced along the path (first and last kept). */
export function resample(p: Pt[], n: number): Pt[] {
  const total = pathLength(p);
  if (p.length < 2 || total === 0) return p.slice();
  const out: Pt[] = [{ ...p[0] }];
  const step = total / (n - 1);
  let acc = 0, next = step;
  for (let i = 1; i < p.length && out.length < n; i++) {
    const seg = dist(p[i - 1], p[i]);
    while (acc + seg >= next && out.length < n) {
      const t = seg ? (next - acc) / seg : 0;
      out.push({ x: p[i - 1].x + (p[i].x - p[i - 1].x) * t, y: p[i - 1].y + (p[i].y - p[i - 1].y) * t });
      next += step;
    }
    acc += seg;
  }
  while (out.length < n) out.push({ ...p[p.length - 1] });
  return out;
}

function lineDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  return L ? Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L : dist(p, a);
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Ramer-Douglas-Peucker on an open path; returns the kept points. */
function rdp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p.slice();
  let worst = 0, at = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = lineDist(p[i], p[0], p[p.length - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= eps) return [p[0], p[p.length - 1]];
  const a = rdp(p.slice(0, at + 1), eps), b = rdp(p.slice(at), eps);
  return a.slice(0, -1).concat(b);
}

/** RDP for a closed loop: split at the point farthest from the first so both halves are open paths. */
function rdpClosed(p: Pt[], eps: number): Pt[] {
  let far = 0, fd = 0;
  for (let i = 1; i < p.length; i++) { const d = dist(p[i], p[0]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(p.slice(0, far + 1), eps), b = rdp(p.slice(far).concat([p[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function centroid(p: Pt[]): Pt {
  let x = 0, y = 0;
  for (const q of p) { x += q.x; y += q.y; }
  return { x: x / p.length, y: y / p.length };
}

/** Circle through the points by least squares (Kasa); null when they are on a line. */
function circleFit(p: Pt[]): { c: Pt; r: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  const n = p.length;
  for (const q of p) {
    const z = q.x * q.x + q.y * q.y;
    sx += q.x; sy += q.y; sxx += q.x * q.x; syy += q.y * q.y; sxy += q.x * q.y; sz += z; sxz += q.x * z; syz += q.y * z;
  }
  // normal equations of  x*A + y*B + C = -(x^2 + y^2)
  const m = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
  for (let i = 0; i < 3; i++) {
    let piv = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[piv][i])) piv = j;
    if (Math.abs(m[piv][i]) < 1e-9) return null;
    [m[i], m[piv]] = [m[piv], m[i]];
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const f = m[j][i] / m[i][i];
      for (let k = i; k < 4; k++) m[j][k] -= f * m[i][k];
    }
  }
  const A = m[0][3] / m[0][0], B = m[1][3] / m[1][1], C = m[2][3] / m[2][2];
  const c = { x: -A / 2, y: -B / 2 };
  const r2 = c.x * c.x + c.y * c.y - C;
  return r2 > 0 ? { c, r: Math.sqrt(r2) } : null;
}

/** The smallest-area rectangle around the points, as four corners. */
function minRect(p: Pt[]): Pt[] {
  let best: Pt[] = [], area = Infinity;
  for (let deg = 0; deg < 90; deg += 1.5) {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of p) {
      const u = q.x * ca + q.y * sa, w = -q.x * sa + q.y * ca;
      if (u < x0) x0 = u; if (u > x1) x1 = u; if (w < y0) y0 = w; if (w > y1) y1 = w;
    }
    const ar = (x1 - x0) * (y1 - y0);
    if (ar < area) {
      area = ar;
      const back = (u: number, w: number): Pt => ({ x: u * ca - w * sa, y: u * sa + w * ca });
      best = [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)];
    }
  }
  return best;
}

/** The ordering of loop vertices that starts nearest `start` and runs the way the stroke ran. */
function orderLoop(verts: Pt[], loop: Pt[], start: Pt): Pt[] {
  let i0 = 0, bd = Infinity;
  verts.forEach((v, i) => { const d = dist(v, start); if (d < bd) { bd = d; i0 = i; } });
  const out = verts.slice(i0).concat(verts.slice(0, i0));
  // direction: which neighbour of the first vertex does the stroke reach first
  if (out.length > 2) {
    const q = loop[Math.min(loop.length - 1, Math.floor(loop.length / out.length / 2) + 1)];
    if (dist(q, out[out.length - 1]) < dist(q, out[1])) out.reverse();
    const j = out.findIndex((v) => dist(v, start) === bd);
    if (j > 0) return out.slice(j).concat(out.slice(0, j));
  }
  return out;
}

/** Recognises the stroke as a shape, or null when it is not clearly one (the raw stroke then stays). */
export function fitShape(raw: Pt[]): Shape | null {
  if (raw.length < 4) return null;
  const len = pathLength(raw);
  if (len < 24) return null;
  const grab = raw[raw.length - 1];
  const p = resample(raw, 72);
  const first = p[0], last = p[p.length - 1];
  const gap = dist(first, last);
  const bb = bounds(p);
  const diag = Math.hypot(bb.w, bb.h) || 1;
  const base = { grab, sweep: 0, rx: 0, ry: 0, rot: 0 };

  if (gap > Math.max(0.2 * len, 16)) {
    // open stroke: line, then arc, then a short polyline
    let sum = 0;
    for (const q of p) sum += lineDist(q, first, last) ** 2;
    if (Math.sqrt(sum / p.length) / gap < 0.032) return { ...base, kind: 'line', closed: false, v: [first] };
    const cf = circleFit(p);
    if (cf) {
      let a = Math.atan2(p[0].y - cf.c.y, p[0].x - cf.c.x), total = 0, err = 0;
      for (let i = 1; i < p.length; i++) {
        const b = Math.atan2(p[i].y - cf.c.y, p[i].x - cf.c.x);
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        total += d; a = b;
      }
      for (const q of p) err += (dist(q, cf.c) - cf.r) ** 2;
      if (Math.sqrt(err / p.length) / cf.r < 0.05 && Math.abs(total) > 0.35 && Math.abs(total) < 5.6) return { ...base, kind: 'arc', closed: false, v: [first], sweep: total };
    }
    const keep = rdp(p, 0.07 * diag);
    if (keep.length >= 3 && keep.length <= 6) {
      let e = 0;
      for (const q of p) { let m = Infinity; for (let i = 1; i < keep.length; i++) m = Math.min(m, segDist(q, keep[i - 1], keep[i])); e += m; }
      if (e / p.length / diag < 0.03) return { ...base, kind: 'polyline', closed: false, v: keep };
    }
    return null;
  }

  // closed stroke: ellipse, rectangle, triangle or polygon
  const c = centroid(p);
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of p) { const dx = q.x - c.x, dy = q.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= p.length; syy /= p.length; sxy /= p.length;
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const t = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  const rx = Math.sqrt(Math.max(1e-6, 2 * ((sxx + syy) / 2 + t))), ry = Math.sqrt(Math.max(1e-6, 2 * ((sxx + syy) / 2 - t)));
  const ca = Math.cos(rot), sa = Math.sin(rot);
  let ee = 0;
  for (const q of p) {
    const dx = q.x - c.x, dy = q.y - c.y;
    ee += Math.abs(Math.hypot((dx * ca + dy * sa) / rx, (-dx * sa + dy * ca) / ry) - 1);
  }
  const eScore = ee / p.length;
  const loop = p.slice(0, -1);
  const keep = rdpClosed(loop, 0.06 * diag);
  const meanR = (rx + ry) / 2;
  let pScore = Infinity;
  if (keep.length >= 3 && keep.length <= 8) {
    let e = 0;
    for (const q of loop) { let m = Infinity; for (let i = 0; i < keep.length; i++) m = Math.min(m, segDist(q, keep[i], keep[(i + 1) % keep.length])); e += m; }
    pScore = e / loop.length / meanR;
  }
  if (pScore < eScore * 0.75 && pScore < 0.12) {
    if (keep.length === 4) {
      const rect = minRect(loop);
      let e = 0;
      for (const q of loop) { let m = Infinity; for (let i = 0; i < 4; i++) m = Math.min(m, segDist(q, rect[i], rect[(i + 1) % 4])); e += m; }
      if (e / loop.length / meanR < pScore * 1.6 + 0.02) return { ...base, kind: 'rectangle', closed: true, v: orderLoop(rect, loop, first) };
    }
    return { ...base, kind: keep.length === 3 ? 'triangle' : 'polygon', closed: true, v: orderLoop(keep, loop, first) };
  }
  if (eScore < 0.2) return { ...base, kind: 'ellipse', closed: true, v: [c], rx, ry, rot };
  return null;
}

function bounds(p: Pt[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const SNAP = Math.PI / 12;
const snapAngle = (a: number): number => Math.round(a / SNAP) * SNAP;

function densify(v: Pt[], closed: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  const n = closed ? v.length : v.length - 1;
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const k = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  out.push({ ...v[closed ? 0 : v.length - 1] });
  return out;
}

/**
 * The clean outline as points about `step` pixels apart. With a `pointer` (the pen still down) the shape follows it:
 * a line or arc ends there; a closed shape scales and turns about its centre to reach it. `regular` makes it regular.
 */
export function shapePoints(s: Shape, pointer: Pt | null, regular: boolean, step = 2): Pt[] {
  const at = pointer ?? s.grab;
  if (s.kind === 'line' || s.kind === 'arc') {
    const a = s.v[0];
    let b = at;
    if (s.kind === 'line' && regular) {
      const ang = snapAngle(Math.atan2(b.y - a.y, b.x - a.x)), d = dist(a, b);
      b = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
    }
    if (s.kind === 'line') return densify([a, b], false, step);
    const d = dist(a, b) || 1e-6;
    const u = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
    const k = d / 2 / Math.tan(s.sweep / 2);
    const cx = (a.x + b.x) / 2 - u.y * k, cy = (a.y + b.y) / 2 + u.x * k;
    const r = Math.hypot(a.x - cx, a.y - cy);
    const n = Math.max(2, Math.ceil((Math.abs(s.sweep) * r) / step));
    const out: Pt[] = [];
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    for (let i = 0; i <= n; i++) { const th = a0 + (s.sweep * i) / n; out.push({ x: cx + Math.cos(th) * r, y: cy + Math.sin(th) * r }); }
    return out;
  }
  if (s.kind === 'ellipse') {
    const c = s.v[0];
    const g = s.grab;
    const k = pointer ? Math.max(0.05, dist(pointer, c) / Math.max(1, dist(g, c))) : 1;
    const turn = pointer ? Math.atan2(pointer.y - c.y, pointer.x - c.x) - Math.atan2(g.y - c.y, g.x - c.x) : 0;
    let rx = s.rx * k, ry = s.ry * k, rot = s.rot + turn;
    if (regular) { rx = ry = (rx + ry) / 2; }
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const n = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(rx, ry)) / step));
    const out: Pt[] = [];
    // the ellipse is traced from the point nearest the stroke's start
    const start = Math.atan2(g.y - c.y, g.x - c.x) - rot;
    for (let i = 0; i <= n; i++) {
      const th = start + (Math.PI * 2 * i) / n;
      const ex = Math.cos(th) * rx, ey = Math.sin(th) * ry;
      out.push({ x: c.x + ex * ca - ey * sa, y: c.y + ex * sa + ey * ca });
    }
    return out;
  }
  // polygons, rectangles, triangles and polylines
  const v = s.v;
  const c = centroid(v);
  const g = s.grab;
  const k = pointer ? Math.max(0.05, dist(pointer, c) / Math.max(1, dist(g, c))) : 1;
  const turn = pointer ? Math.atan2(pointer.y - c.y, pointer.x - c.x) - Math.atan2(g.y - c.y, g.x - c.x) : 0;
  const ca = Math.cos(turn), sa = Math.sin(turn);
  let w = v.map((q) => ({ x: c.x + ((q.x - c.x) * ca - (q.y - c.y) * sa) * k, y: c.y + ((q.x - c.x) * sa + (q.y - c.y) * ca) * k }));
  if (regular && s.closed) {
    const r = w.reduce((m, q) => m + dist(q, c), 0) / w.length;
    const a0 = snapAngle(Math.atan2(w[0].y - c.y, w[0].x - c.x));
    w = w.map((_, i) => ({ x: c.x + Math.cos(a0 + (Math.PI * 2 * i) / w.length) * r, y: c.y + Math.sin(a0 + (Math.PI * 2 * i) / w.length) * r }));
  }
  return densify(w, s.closed, step);
}

/** A shape of the asked kind fitted to the stroke's box, for the Edit Shape menu. */
export function forceShape(raw: Pt[], kind: 'line' | 'ellipse' | 'rectangle' | 'triangle'): Shape {
  const b = bounds(raw);
  const first = raw[0], last = raw[raw.length - 1];
  const base = { grab: last, sweep: 0, rx: 0, ry: 0, rot: 0 };
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  if (kind === 'line') return { ...base, kind, closed: false, v: [first] };
  if (kind === 'ellipse') return { ...base, kind, closed: true, v: [c], rx: Math.max(1, b.w / 2), ry: Math.max(1, b.h / 2) };
  if (kind === 'rectangle') return { ...base, kind, closed: true, v: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] };
  return { ...base, kind, closed: true, v: [{ x: c.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] };
}

/** Pressure at fraction `u` (0..1) along the stroke, from the raw samples' own profile. */
export function pressureAt(profile: number[], u: number): number {
  if (!profile.length) return 0.5;
  const f = Math.min(1, Math.max(0, u)) * (profile.length - 1);
  const i = Math.floor(f);
  const a = profile[i], b = profile[Math.min(profile.length - 1, i + 1)];
  return a + (b - a) * (f - i);
}
