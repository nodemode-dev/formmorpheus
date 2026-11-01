// Shape maths: channel list, defaults, resolved (animated) values and the outline as polylines with trim path.
// Pure, no DOM; the CPU raster (shape-draw.ts) and every other consumer read the same numbers.
import type { BezNode, GradStop, ShapeDef, ShapePaint, ShapeStroke, ShapeType } from './shape-types';

export const MAX_STOPS = 8;

/** Numeric values of one shape at one moment, by channel id. */
export type ShapeVals = Record<string, number>;

export interface ChanInfo { id: string; label: string; short: string; min: number; max: number; step: number; unit: '%' | 'px' | 'deg' | ''; display: number; def: number }

const c = (id: string, label: string, short: string, min: number, max: number, step: number, unit: ChanInfo['unit'], display: number, def: number): ChanInfo => ({ id, label, short, min, max, step, unit, display, def });

/** Every keyable parameter. Colours are 0 to 1 per channel (shown 0 to 255). */
export const SHAPE_CHANNELS: ChanInfo[] = [
  c('w', 'Width', 'W', 0, 20000, 1, 'px', 1, 400),
  c('h', 'Height', 'H', 0, 20000, 1, 'px', 1, 300),
  c('radius', 'Corner radius', 'Rad', 0, 10000, 1, 'px', 1, 0),
  c('sides', 'Sides', 'Sides', 3, 64, 1, '', 1, 5),
  c('points', 'Points', 'Pts', 3, 64, 1, '', 1, 5),
  c('inner', 'Inner radius', 'Inner', 0.02, 1, 0.01, '%', 100, 0.5),
  c('fillR', 'Fill red', 'FR', 0, 1, 1 / 255, '', 255, 0.2),
  c('fillG', 'Fill green', 'FG', 0, 1, 1 / 255, '', 255, 0.5),
  c('fillB', 'Fill blue', 'FB', 0, 1, 1 / 255, '', 255, 1),
  c('fillA', 'Fill opacity', 'FA', 0, 1, 0.01, '%', 100, 1),
  c('strokeW', 'Stroke width', 'SW', 0, 2000, 0.5, 'px', 1, 0),
  c('strokeR', 'Stroke red', 'SR', 0, 1, 1 / 255, '', 255, 0),
  c('strokeG', 'Stroke green', 'SG', 0, 1, 1 / 255, '', 255, 0),
  c('strokeB', 'Stroke blue', 'SB', 0, 1, 1 / 255, '', 255, 0),
  c('strokeA', 'Stroke opacity', 'SA', 0, 1, 0.01, '%', 100, 1),
  c('dash', 'Dash length', 'Dash', 0, 2000, 1, 'px', 1, 0),
  c('gap', 'Dash gap', 'Gap', 0, 2000, 1, 'px', 1, 0),
  c('dashOffset', 'Dash offset', 'DOff', -5000, 5000, 1, 'px', 1, 0),
  c('ga', 'Gradient angle', 'GAng', -3600, 3600, 1, 'deg', 1, 0),
  c('gcx', 'Gradient centre X', 'GX', -1, 1, 0.01, '%', 100, 0),
  c('gcy', 'Gradient centre Y', 'GY', -1, 1, 0.01, '%', 100, 0),
  ...Array.from({ length: MAX_STOPS }, (_, i) => c(`o${i}`, `Gradient stop ${i + 1}`, `G${i + 1}`, 0, 1, 0.01, '%', 100, i / (MAX_STOPS - 1))),
  // gradient stop colors, keyable per stop (0 to 1 per channel)
  ...Array.from({ length: MAX_STOPS }, (_, i) => (['R', 'G', 'B'] as const).map((k) => c(`g${i}${k}`, `Gradient stop ${i + 1} ${k === 'R' ? 'red' : k === 'G' ? 'green' : 'blue'}`, `G${i + 1}${k}`, 0, 1, 1 / 255, '', 255, 0.5))).flat(),
  c('trimStart', 'Trim start', 'TS', 0, 1, 0.01, '%', 100, 0),
  c('trimEnd', 'Trim end', 'TE', 0, 1, 0.01, '%', 100, 1),
  c('trimOffset', 'Trim offset', 'TO', -3600, 3600, 1, 'deg', 1, 0),
  c('feather', 'Feather', 'Feather', 0, 2000, 1, 'px', 1, 0),
];

const CHAN = new Map(SHAPE_CHANNELS.map((x) => [x.id, x]));
export const shapeChannel = (id: string): ChanInfo | undefined => CHAN.get(id);

const HEX = /^#?([0-9a-f]{6})$/i;
const rgbCache = new Map<string, [number, number, number]>();

/** #rrggbb as 0 to 1 triple (black for anything else). */
export function rgbOf(color: string): [number, number, number] {
  let v = rgbCache.get(color);
  if (!v) {
    const m = HEX.exec((color || '').trim());
    const n = m ? parseInt(m[1], 16) : 0;
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    if (rgbCache.size > 256) rgbCache.clear();
    rgbCache.set(color, v);
  }
  return v;
}

export function hexOf(r: number, g: number, b: number): string {
  const h = (x: number): string => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function defaultStops(color = '#3a8bff'): GradStop[] {
  return [{ o: 0, color }, { o: 1, color: '#ff4f7a' }];
}

export function defaultShape(type: ShapeType, w = 400, h = 300): ShapeDef {
  const line = type === 'line' || type === 'arrow';
  return {
    type,
    w,
    h: type === 'arrow' ? 60 : h,
    fill: line ? null : { kind: 'solid', color: '#3a8bff' },
    stroke: line ? { color: '#3a8bff', width: 12, cap: 'round', join: 'round' } : null,
    ...(type === 'rect' ? { radius: 0 } : {}),
    ...(type === 'polygon' ? { sides: 5 } : {}),
    ...(type === 'star' ? { points: 5, inner: 0.5 } : {}),
  };
}

/** The saved values of a shape for every channel (the unkeyed state). */
export function shapeBase(d: ShapeDef | undefined): ShapeVals {
  const f = d?.fill, s = d?.stroke;
  const fc = rgbOf(f?.color ?? '#3a8bff'), sc = rgbOf(s?.color ?? '#000000');
  const v: ShapeVals = {
    w: d?.w ?? 400, h: d?.h ?? 300, radius: d?.radius ?? 0, sides: d?.sides ?? 5, points: d?.points ?? 5, inner: d?.inner ?? 0.5,
    fillR: fc[0], fillG: fc[1], fillB: fc[2], fillA: f ? f.alpha ?? 1 : 0,
    strokeW: s?.width ?? 0, strokeR: sc[0], strokeG: sc[1], strokeB: sc[2], strokeA: s?.alpha ?? 1,
    dash: s?.dash ?? 0, gap: s?.gap ?? 0, dashOffset: s?.dashOffset ?? 0,
    ga: f?.angle ?? 0, gcx: f?.cx ?? 0, gcy: f?.cy ?? 0,
    trimStart: d?.trimStart ?? 0, trimEnd: d?.trimEnd ?? 1, trimOffset: d?.trimOffset ?? 0, feather: d?.feather ?? 0,
  };
  const stops = f?.stops ?? [];
  for (let i = 0; i < MAX_STOPS; i++) {
    v[`o${i}`] = stops[i]?.o ?? i / (MAX_STOPS - 1);
    const sc2 = rgbOf(stops[i]?.color ?? (i === 0 ? f?.color ?? '#3a8bff' : '#ff4f7a'));
    v[`g${i}R`] = sc2[0]; v[`g${i}G`] = sc2[1]; v[`g${i}B`] = sc2[2];
  }
  return v;
}

/** Channels worth keying for a shape of this type (a lane starts with these). */
export function relevantChannels(d: ShapeDef | undefined): string[] {
  const t = d?.type ?? 'rect';
  const out = ['w', 'h'];
  if (t === 'rect') out.push('radius');
  if (t === 'polygon') out.push('sides');
  if (t === 'star') out.push('points', 'inner');
  out.push('fillA', 'strokeW', 'trimStart', 'trimEnd', 'trimOffset');
  return out;
}

/** Saved values with the keyed overrides on top. */
export function resolveShape(d: ShapeDef | undefined, over: ShapeVals | null | undefined): ShapeVals {
  const v = shapeBase(d);
  if (over) for (const k in over) v[k] = over[k];
  return v;
}

// ---- outline -------------------------------------------------------------------------------

/** A flat run of x, y pairs; `closed` joins its last point to its first. */
export interface Sub { p: number[]; closed: boolean }

const TAU = Math.PI * 2;

function cubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  const n = Math.max(4, Math.min(240, Math.ceil(Math.sqrt(len) * 1.6)));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push(
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    );
  }
}

function arc(out: number[], cx: number, cy: number, r: number, a0: number, a1: number): void {
  const n = Math.max(4, Math.ceil(Math.sqrt(Math.max(r, 1)) * 3));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

function pathSub(nodes: BezNode[], closed: boolean): Sub | null {
  if (nodes.length < 2) return null;
  const p: number[] = [nodes[0].x, nodes[0].y];
  const last = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < last; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    cubic(p, a.x, a.y, a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y);
  }
  // a closed outline ends on its first point already
  if (closed) { p.length -= 2; }
  return { p, closed };
}

/** The outline of a shape, centred on (0, 0) in movie pixels. */
export function outline(d: ShapeDef, v: ShapeVals): Sub[] {
  const w = Math.max(0, v.w), h = Math.max(0, v.h), hw = w / 2, hh = h / 2;
  switch (d.type) {
    case 'rect': {
      const r = Math.max(0, Math.min(v.radius, hw, hh));
      if (r <= 0.01) return [{ p: [-hw, -hh, hw, -hh, hw, hh, -hw, hh], closed: true }];
      const p: number[] = [];
      arc(p, hw - r, -hh + r, r, -Math.PI / 2, 0);
      arc(p, hw - r, hh - r, r, 0, Math.PI / 2);
      arc(p, -hw + r, hh - r, r, Math.PI / 2, Math.PI);
      arc(p, -hw + r, -hh + r, r, Math.PI, Math.PI * 1.5);
      return [{ p, closed: true }];
    }
    case 'ellipse': {
      const n = Math.max(24, Math.min(480, Math.round(Math.sqrt(Math.max(hw, hh, 1)) * 9)));
      const p: number[] = [];
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i / n) * TAU; p.push(Math.cos(a) * hw, Math.sin(a) * hh); }
      return [{ p, closed: true }];
    }
    case 'polygon': {
      const n = Math.max(3, Math.min(64, Math.round(v.sides)));
      const p: number[] = [];
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i / n) * TAU; p.push(Math.cos(a) * hw, Math.sin(a) * hh); }
      return [{ p, closed: true }];
    }
    case 'star': {
      const n = Math.max(3, Math.min(64, Math.round(v.points)));
      const k = Math.min(1, Math.max(0.02, v.inner));
      const p: number[] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i / (n * 2)) * TAU, s = i % 2 ? k : 1;
        p.push(Math.cos(a) * hw * s, Math.sin(a) * hh * s);
      }
      return [{ p, closed: true }];
    }
    case 'line': return [{ p: [-hw, 0, hw, 0], closed: false }];
    case 'arrow': {
      const head = Math.max(1, h), a = 0.5; // half angle of the head, radians
      const tipX = hw;
      return [
        { p: [-hw, 0, tipX, 0], closed: false },
        { p: [tipX - Math.cos(a) * head, -Math.sin(a) * head, tipX, 0, tipX - Math.cos(a) * head, Math.sin(a) * head], closed: false },
      ];
    }
    case 'path': {
      const s = pathSub(d.nodes ?? [], d.closed === true);
      return s ? [s] : [];
    }
  }
}

/** Bounding box of an outline (minx, miny, maxx, maxy), or null when empty. */
export function bounds(subs: Sub[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of subs) for (let i = 0; i < s.p.length; i += 2) {
    x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]);
    y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]);
  }
  return x1 < x0 ? null : [x0, y0, x1, y1];
}

function subLength(s: Sub): number {
  let L = 0;
  const n = s.p.length / 2;
  for (let i = 1; i < n; i++) L += Math.hypot(s.p[i * 2] - s.p[i * 2 - 2], s.p[i * 2 + 1] - s.p[i * 2 - 1]);
  if (s.closed && n > 1) L += Math.hypot(s.p[0] - s.p[n * 2 - 2], s.p[1] - s.p[n * 2 - 1]);
  return L;
}

/** The part of `subs` between the lengths d0 and d1 (along all runs, one after another) as open runs. */
function slice(subs: Sub[], d0: number, d1: number): Sub[] {
  const out: Sub[] = [];
  let at = 0;
  for (const s of subs) {
    const pts = s.closed ? [...s.p, s.p[0], s.p[1]] : s.p;
    const n = pts.length / 2;
    let cur: number[] | null = null;
    for (let i = 1; i < n; i++) {
      const ax = pts[i * 2 - 2], ay = pts[i * 2 - 1], bx = pts[i * 2], by = pts[i * 2 + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const a = at, b = at + L;
      at = b;
      if (b <= d0 || a >= d1 || L <= 0) { if (cur && cur.length >= 4) out.push({ p: cur, closed: false }); if (a >= d1) cur = null; else cur = null; continue; }
      const t0 = Math.max(0, (d0 - a) / L), t1 = Math.min(1, (d1 - a) / L);
      if (!cur) cur = [ax + (bx - ax) * t0, ay + (by - ay) * t0];
      cur.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
      if (t1 < 1) { out.push({ p: cur, closed: false }); cur = null; }
    }
    if (cur && cur.length >= 4) out.push({ p: cur, closed: false });
  }
  return out;
}

/** True when trim path changes the outline. */
export function trimmed(v: ShapeVals): boolean {
  return v.trimStart > 0.0001 || v.trimEnd < 0.9999 || Math.abs(v.trimOffset) > 0.0001;
}

/** The outline with trim path applied (a closed outline that wraps splits in two open runs). */
export function trimOutline(subs: Sub[], v: ShapeVals): Sub[] {
  if (!trimmed(v)) return subs;
  const total = subs.reduce((n, s) => n + subLength(s), 0);
  if (total <= 0) return [];
  const off = v.trimOffset / 360;
  let lo = Math.min(v.trimStart, v.trimEnd) + off, hi = Math.max(v.trimStart, v.trimEnd) + off;
  if (hi - lo >= 0.9999) return subs.every((s) => s.closed) && lo === 0 ? subs : slice(subs, 0, total);
  const closed = subs.every((s) => s.closed);
  if (closed) {
    const shift = Math.floor(lo);
    lo -= shift; hi -= shift;
    if (hi <= 1) return slice(subs, lo * total, hi * total);
    return [...slice(subs, lo * total, total), ...slice(subs, 0, (hi - 1) * total)];
  }
  lo = Math.max(0, Math.min(1, lo)); hi = Math.max(0, Math.min(1, hi));
  return hi > lo ? slice(subs, lo * total, hi * total) : [];
}

/** Axis-aligned extent and centre offset of a shape for the Stage box (movie pixels from the content centre). */
export function shapeExtent(d: ShapeDef, v: ShapeVals): { w: number; h: number; cx: number; cy: number } {
  if (d.type === 'path') {
    const b = bounds(outline(d, v));
    if (b) return { w: Math.max(8, b[2] - b[0]), h: Math.max(8, b[3] - b[1]), cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2 };
  }
  const pad = d.stroke && v.strokeW > 0 ? v.strokeW : 0;
  return { w: Math.max(8, v.w + pad), h: Math.max(8, d.type === 'line' ? Math.max(v.h, pad, 24) : d.type === 'arrow' ? Math.max(v.h * 1.2, 24) : v.h + pad), cx: 0, cy: 0 };
}

/** A copy of the paints with a stop list always present for gradients. */
export function paintStops(p: ShapePaint): GradStop[] {
  const s = p.stops && p.stops.length >= 2 ? p.stops : defaultStops(p.color);
  return s.slice(0, MAX_STOPS);
}

export function normalizeStroke(s: ShapeStroke | null | undefined): ShapeStroke | null {
  return s && typeof s.width === 'number' ? s : null;
}
