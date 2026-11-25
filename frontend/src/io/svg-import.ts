// SVG artwork with one group per body part becomes a character: one Group whose inner tracks each hold one part.
// Read with the browser's DOMParser only. Shapes become path Shapes; a part holding anything a Shape cannot carry
// (text, pictures, filters, masks, clipping, patterns, reused elements, cut-out shapes) becomes a picture of that part.
// A mouth chart SVG (one group per mouth shape) becomes one Flipbook with its frames named for the shapes.
import { characterInfoOf } from '../engine/character-ops';
import { content as makeContent, drawingLayer, flipTrack, track as makeTrack, uid } from '../engine/model';
import { setParent } from '../engine/parenting';
import { bounds, MAX_STOPS, outline, shapeBase } from '../engine/shape';
import { refitPath } from '../engine/shape-ops';
import type { BezNode, GradStop, ShapeDef, ShapePaint, ShapeStroke } from '../engine/shape-types';
import { apply, mul, type Mat } from '../engine/transform';
import type { Asset, CanvasRect, Content, FlipbookFrame, Movie, Track } from '../engine/types';
import type { ImportResult } from '../media/import';
import { VISEMES, VISEME_NAMES } from '../media/lipsync';
import { t } from '../ui/i18n';
import { tf } from '../ui/i18n-fill';
import { baseOf } from './layered-import';

const SVG_NS = 'http://www.w3.org/2000/svg';
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

/** One path of a part in the SVG's own pixels (viewBox applied): anchors absolute, handles relative. */
export interface SvgShape { name: string; nodes: BezNode[]; closed: boolean; fill: ShapePaint | null; stroke: ShapeStroke | null }

export interface SvgPart {
  name: string;
  /** Index of the part this one sits in, -1 at the top. */
  parent: number;
  /** Bottom first, as drawn. */
  shapes: SvgShape[];
  /** Why the part must be a picture (an English phrase), or null when its shapes carry it. */
  raster: string | null;
  /** Centre of the part's pivot element in the SVG's pixels; null when it has none. */
  pivot: [number, number] | null;
  opacity: number;
  hidden: boolean;
  /** A standalone SVG of this part alone, used to draw it as a picture. */
  markup: string;
}

export interface SvgDoc { width: number; height: number; parts: SvgPart[] }

type Style = Record<string, string>;
interface Rule { sel: { tag: string | null; id: string | null; cls: string[] }; spec: number; order: number; decl: Style }

const INHERIT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'color', 'visibility'];
const OWN = ['opacity', 'display', 'filter', 'mask', 'clip-path', 'stop-color', 'stop-opacity', 'marker-start', 'marker-mid', 'marker-end'];
const PROPS = [...INHERIT, ...OWN];
const DEFS = new Set(['defs', 'style', 'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter', 'symbol', 'marker', 'script']);
const QUIET = new Set(['title', 'desc', 'metadata']);
const DRAWN = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const WHY: Record<string, string> = { text: 'text', image: 'a picture', use: 'a reused element', foreignObject: 'an embedded page', switch: 'a switch', svg: 'a nested drawing' };

// ---- small parsers ---------------------------------------------------------------------------------------

const kids = (el: Element): Element[] => Array.from(el.children);
const isSvg = (el: Element): boolean => el.namespaceURI === SVG_NS;

function parseDecl(s: string): Style {
  const out: Style = {};
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).replace(/!important/i, '').trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function parseCss(text: string, start: number): Rule[] {
  const out: Rule[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let order = start;
  while ((m = re.exec(clean))) {
    const decl = parseDecl(m[2]);
    for (const raw of m[1].split(',')) {
      const s = raw.trim();
      // simple selectors only: tag, #id, .class and their joins; anything with a space, > or : is left to the picture path
      if (!s || /[\s>+~:[\]*]/.test(s)) continue;
      const tag = /^[a-zA-Z][\w-]*/.exec(s)?.[0] ?? null;
      const id = /#([\w-]+)/.exec(s)?.[1] ?? null;
      const cls = Array.from(s.matchAll(/\.([\w-]+)/g), (x) => x[1]);
      out.push({ sel: { tag, id, cls }, spec: (id ? 100 : 0) + cls.length * 10 + (tag ? 1 : 0), order: order++, decl });
    }
  }
  return out;
}

function num(v: string | null | undefined, d = 0): number {
  if (v === null || v === undefined) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function length(v: string | null, ref: number, d = 0): number {
  if (v === null) return d;
  const s = v.trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return d;
  if (s.endsWith('%')) return (n / 100) * ref;
  const unit = /[a-z]+$/i.exec(s)?.[0]?.toLowerCase();
  const per: Record<string, number> = { pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };
  return n * (unit ? per[unit] ?? 1 : 1);
}

function opacity(v: string | undefined): number {
  if (!v) return 1;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, v.trim().endsWith('%') ? n / 100 : n));
}

function transformOf(attr: string | null): Mat {
  if (!attr) return IDENT;
  let m: Mat = IDENT;
  for (const x of attr.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n: Mat = IDENT;
    switch (x[1]) {
      case 'matrix': if (a.length === 6) n = a as Mat; break;
      case 'translate': n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] ?? 0, cy = a[2] ?? 0;
        n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff',
};
let probe: OffscreenCanvasRenderingContext2D | null | undefined;

/** A CSS colour as #rrggbb and alpha; null for none or one that cannot be read. */
function color(v: string, current: string): { hex: string; alpha: number } | null {
  const s = v.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') return color(current || '#000000', '#000000');
  const hex = (h: string): string => `#${h}`;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return { hex: hex(h.slice(0, 3).split('').map((c) => c + c).join('')), alpha: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 };
    if (h.length === 6 || h.length === 8) return { hex: hex(h.slice(0, 6)), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    return null;
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (x: string | undefined): number => { const n = parseFloat(x ?? '0'); return Math.round(Math.min(255, Math.max(0, x?.endsWith('%') ? (n / 100) * 255 : n))); };
    return { hex: `#${[ch(p[0]), ch(p[1]), ch(p[2])].map((n) => n.toString(16).padStart(2, '0')).join('')}`, alpha: p[3] === undefined ? 1 : opacity(p[3]) };
  }
  if (NAMED[s]) return { hex: NAMED[s], alpha: 1 };
  // any other CSS colour (hsl(), the full name list) is read by a canvas when there is one
  if (probe === undefined) { try { probe = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d'); } catch { probe = null; } }
  if (probe) {
    probe.fillStyle = '#000001';
    probe.fillStyle = s;
    const out = String(probe.fillStyle);
    if (out !== '#000001') return color(out, '#000000');
  }
  return null;
}

// ---- path data to cubic runs ----------------------------------------------------------------------------

type Seg = [number, number, number, number, number, number];
interface Run { x0: number; y0: number; segs: Seg[]; closed: boolean }

class Scan {
  i = 0;
  constructor(private readonly s: string) {}
  private skip(): void { while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++; }
  cmd(): string | null { this.skip(); const c = this.s[this.i]; if (c && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) { this.i++; return c; } return null; }
  more(): boolean { this.skip(); const c = this.s[this.i]; return !!c && /[-+.\d]/.test(c); }
  num(): number {
    this.skip();
    const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (!m) throw new Error('path');
    this.i = re.lastIndex;
    return parseFloat(m[0]);
  }
  flag(): boolean { this.skip(); const c = this.s[this.i]; if (c !== '0' && c !== '1') throw new Error('path'); this.i++; return c === '1'; }
}

const line = (x0: number, y0: number, x: number, y: number): Seg => [x0, y0, x, y, x, y];

function arcSegs(x1: number, y1: number, rx0: number, ry0: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): Seg[] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rx0), ry = Math.abs(ry0);
  if (!rx || !ry) return [line(x1, y1, x2, y2)];
  const phi = (phiDeg * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cs * dx + sn * dy, yp = -sn * dx + cs * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num2 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = (coef * rx * yp) / ry, cyp = (-coef * ry * xp) / rx;
  const cx = cs * cxp - sn * cyp + (x1 + x2) / 2, cy = sn * cxp + cs * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry, vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry;
  const th1 = ang(1, 0, ux, uy);
  let dth = ang(ux, uy, vx, vy);
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  if (sweep && dth < 0) dth += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const d = dth / n, k = (4 / 3) * Math.tan(d / 4);
  const pt = (u: number, v: number): [number, number] => [cs * rx * u - sn * ry * v + cx, sn * rx * u + cs * ry * v + cy];
  const out: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = th1 + i * d, a1 = a0 + d;
    const c1 = pt(Math.cos(a0) - k * Math.sin(a0), Math.sin(a0) + k * Math.cos(a0));
    const c2 = pt(Math.cos(a1) + k * Math.sin(a1), Math.sin(a1) - k * Math.cos(a1));
    const p = i === n - 1 ? [x2, y2] : pt(Math.cos(a1), Math.sin(a1));
    out.push([c1[0], c1[1], c2[0], c2[1], p[0], p[1]]);
  }
  return out;
}

/** SVG path data (every command, absolute and relative) as runs of cubic segments in the path's own coordinates. */
export function pathRuns(d: string): Run[] {
  const sc = new Scan(d);
  const runs: Run[] = [];
  let run: Run | null = null;
  let x = 0, y = 0, sx = 0, sy = 0, c2x = 0, c2y = 0, qx = 0, qy = 0;
  let prev = '';
  let cmd: string | null = null;
  const open = (): Run => { if (!run) { run = { x0: x, y0: y, segs: [], closed: false }; runs.push(run); } return run; };
  try {
    for (;;) {
      const c = sc.cmd();
      if (c) cmd = c;
      else if (!cmd || !sc.more()) break;
      else if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
      if (!cmd) break;
      const rel = cmd === cmd.toLowerCase() && cmd !== 'z';
      const ox = rel ? x : 0, oy = rel ? y : 0;
      switch (cmd.toUpperCase()) {
        case 'M': x = ox + sc.num(); y = oy + sc.num(); sx = x; sy = y; run = null; open(); break;
        case 'L': { const nx = ox + sc.num(), ny = oy + sc.num(); open().segs.push(line(x, y, nx, ny)); x = nx; y = ny; break; }
        case 'H': { const nx = (rel ? x : 0) + sc.num(); open().segs.push(line(x, y, nx, y)); x = nx; break; }
        case 'V': { const ny = (rel ? y : 0) + sc.num(); open().segs.push(line(x, y, x, ny)); y = ny; break; }
        case 'C': {
          const a = ox + sc.num(), b = oy + sc.num(), e = ox + sc.num(), f = oy + sc.num(), nx = ox + sc.num(), ny = oy + sc.num();
          open().segs.push([a, b, e, f, nx, ny]); c2x = e; c2y = f; x = nx; y = ny; break;
        }
        case 'S': {
          const smooth = /[CcSs]/.test(prev);
          const a = smooth ? 2 * x - c2x : x, b = smooth ? 2 * y - c2y : y;
          const e = ox + sc.num(), f = oy + sc.num(), nx = ox + sc.num(), ny = oy + sc.num();
          open().segs.push([a, b, e, f, nx, ny]); c2x = e; c2y = f; x = nx; y = ny; break;
        }
        case 'Q': case 'T': {
          let px: number, py: number;
          if (cmd.toUpperCase() === 'Q') { px = ox + sc.num(); py = oy + sc.num(); } else { const smooth = /[QqTt]/.test(prev); px = smooth ? 2 * x - qx : x; py = smooth ? 2 * y - qy : y; }
          const nx = ox + sc.num(), ny = oy + sc.num();
          open().segs.push([x + (2 / 3) * (px - x), y + (2 / 3) * (py - y), nx + (2 / 3) * (px - nx), ny + (2 / 3) * (py - ny), nx, ny]);
          qx = px; qy = py; x = nx; y = ny; break;
        }
        case 'A': {
          const rx = sc.num(), ry = sc.num(), rot = sc.num(), large = sc.flag(), sweep = sc.flag(), nx = ox + sc.num(), ny = oy + sc.num();
          open().segs.push(...arcSegs(x, y, rx, ry, rot, large, sweep, nx, ny)); x = nx; y = ny; break;
        }
        case 'Z': if (run) (run as Run).closed = true; x = sx; y = sy; run = null; break;
      }
      prev = cmd;
      // after Z a drawing command starts a new run at the start point
      if (cmd.toUpperCase() === 'Z') cmd = null;
    }
  } catch { /* a broken tail: what was read stays, as browsers draw it */ }
  return runs.filter((r) => r.segs.length > 0);
}

function shapeData(el: Element, ref: { w: number; h: number }): string | null {
  const g = (k: string, r: number): number => length(el.getAttribute(k), r);
  switch (el.localName) {
    case 'path': return el.getAttribute('d');
    case 'rect': {
      const x = g('x', ref.w), y = g('y', ref.h), w = g('width', ref.w), h = g('height', ref.h);
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? g('rx', ref.w) : NaN, ry = el.hasAttribute('ry') ? g('ry', ref.h) : NaN;
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(Math.max(0, rx), w / 2); ry = Math.min(Math.max(0, ry), h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle': case 'ellipse': {
      const cx = g('cx', ref.w), cy = g('cy', ref.h);
      const rx = el.localName === 'circle' ? g('r', Math.hypot(ref.w, ref.h) / Math.SQRT2) : g('rx', ref.w), ry = el.localName === 'circle' ? rx : g('ry', ref.h);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line': return `M${g('x1', ref.w)} ${g('y1', ref.h)}L${g('x2', ref.w)} ${g('y2', ref.h)}`;
    case 'polyline': case 'polygon': {
      const p = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (p.length < 4) return null;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return el.localName === 'polygon' ? `${d}Z` : d;
    }
  }
  return null;
}

/** A run under matrix `m` as pen nodes (anchors absolute, handles relative); a run that ends on its start folds into it. */
function nodesOf(r: Run, m: Mat): { nodes: BezNode[]; closed: boolean } {
  const p0 = apply(m, r.x0, r.y0);
  const nodes: BezNode[] = [{ x: p0[0], y: p0[1], ix: 0, iy: 0, ox: 0, oy: 0 }];
  for (const s of r.segs) {
    const a = nodes[nodes.length - 1];
    const c1 = apply(m, s[0], s[1]), c2 = apply(m, s[2], s[3]), p = apply(m, s[4], s[5]);
    a.ox = c1[0] - a.x; a.oy = c1[1] - a.y;
    nodes.push({ x: p[0], y: p[1], ix: c2[0] - p[0], iy: c2[1] - p[1], ox: 0, oy: 0 });
  }
  if (r.closed && nodes.length > 2) {
    const f = nodes[0], l = nodes[nodes.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6 * Math.max(1, Math.abs(f.x) + Math.abs(f.y))) { f.ix = l.ix; f.iy = l.iy; nodes.pop(); }
  }
  return { nodes, closed: r.closed };
}

function boxOf(nodes: BezNode[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) for (const [x, y] of [[n.x, n.y], [n.x + n.ix, n.y + n.iy], [n.x + n.ox, n.y + n.oy]]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function area(nodes: BezNode[]): number {
  let a = 0;
  for (let i = 0; i < nodes.length; i++) { const p = nodes[i], q = nodes[(i + 1) % nodes.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

// ---- the document walk -----------------------------------------------------------------------------------

interface Ctx {
  rules: Rule[];
  ids: Map<string, Element>;
  parts: SvgPart[];
  names: Set<string>;
  ref: { w: number; h: number };
  defs: string;
  /** The file's other namespace declarations, so a part's prefixed attributes still read. */
  xmlns: string;
  width: number;
  height: number;
}

interface PartWork { part: SvgPart; el: Element; outer: Mat; outerStyle: Style; cut: Element[] }

function styleOf(cx: Ctx, el: Element, parent: Style): Style {
  const s: Style = {};
  for (const k of INHERIT) if (parent[k] !== undefined) s[k] = parent[k];
  for (const k of PROPS) { const v = el.getAttribute(k); if (v !== null) s[k] = v.trim(); }
  const id = el.getAttribute('id');
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  for (const r of cx.rules) {
    if (r.sel.tag && r.sel.tag !== el.localName) continue;
    if (r.sel.id && r.sel.id !== id) continue;
    if (!r.sel.cls.every((c) => cls.includes(c))) continue;
    Object.assign(s, r.decl);
  }
  Object.assign(s, parseDecl(el.getAttribute('style') ?? ''));
  for (const k of Object.keys(s)) if (s[k] === 'inherit') { if (parent[k] !== undefined) s[k] = parent[k]; else delete s[k]; }
  return s;
}

function labelOf(el: Element): string | null {
  for (const k of ['inkscape:label', 'data-name', 'id']) {
    const v = el.getAttribute(k)?.trim();
    if (v) return v;
  }
  const ns = el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label')?.trim();
  return ns || null;
}

const isPivot = (el: Element): boolean => el.getAttribute('data-role') === 'pivot' || /^pivot(-.*)?$/i.test(el.getAttribute('id') ?? '');

const has = (v: string | undefined): boolean => !!v && v !== 'none';

function uniqueName(cx: Ctx, base: string): string {
  let n = base, i = 2;
  while (cx.names.has(n)) n = `${base} ${i++}`;
  cx.names.add(n);
  return n;
}

/** Stops of a gradient, following its href chain for stops it does not hold itself. */
function stopsOf(cx: Ctx, g: Element, depth = 0): Element[] {
  const own = kids(g).filter((k) => k.localName === 'stop');
  if (own.length || depth > 8) return own;
  const ref = hrefOf(cx, g);
  return ref ? stopsOf(cx, ref, depth + 1) : own;
}

function hrefOf(cx: Ctx, el: Element): Element | null {
  const h = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  return h && h.startsWith('#') ? cx.ids.get(h.slice(1)) ?? null : null;
}

function gradAttr(cx: Ctx, g: Element, k: string, depth = 0): string | null {
  const v = g.getAttribute(k);
  if (v !== null || depth > 8) return v;
  const ref = hrefOf(cx, g);
  return ref ? gradAttr(cx, ref, k, depth + 1) : null;
}

/** A fill or stroke value as a paint; 'pattern' when it needs the picture path. */
function paintOf(cx: Ctx, value: string | undefined, alpha: number, st: Style, box: [number, number, number, number], m: Mat): ShapePaint | null | 'pattern' {
  if (!value || value === 'none') return null;
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(value);
  if (!url) {
    const c = color(value, st.color ?? '');
    return c ? { kind: 'solid', color: c.hex, ...(c.alpha * alpha < 1 ? { alpha: c.alpha * alpha } : {}) } : null;
  }
  const g = cx.ids.get(url[1]);
  if (!g || (g.localName !== 'linearGradient' && g.localName !== 'radialGradient')) {
    if (g) return 'pattern';
    return url[2] ? paintOf(cx, url[2], alpha, st, box, m) : null;
  }
  const raw = stopsOf(cx, g).map((s) => {
    const ss = styleOf(cx, s, {});
    const c = color(ss['stop-color'] ?? '#000000', st.color ?? '') ?? { hex: '#000000', alpha: 0 };
    return { o: Math.min(1, Math.max(0, opacity(s.getAttribute('offset') ?? '0'))), color: c.hex, alpha: c.alpha * opacity(ss['stop-opacity']) };
  });
  if (!raw.length) return null;
  if (raw.length === 1) return { kind: 'solid', color: raw[0].color, ...(raw[0].alpha * alpha < 1 ? { alpha: raw[0].alpha * alpha } : {}) };
  const user = gradAttr(cx, g, 'gradientUnits') === 'userSpaceOnUse';
  const gm = mul(m, transformOf(gradAttr(cx, g, 'gradientTransform')));
  const bw = Math.max(1e-6, box[2] - box[0]), bh = Math.max(1e-6, box[3] - box[1]);
  const at = (x: number, y: number): [number, number] => (user ? apply(gm, x, y) : [box[0] + x * bw, box[1] + y * bh]);
  const len = (k: string, d: string, ref: number): number => { const v = gradAttr(cx, g, k) ?? d; return user ? length(v, ref) : (v.trim().endsWith('%') ? parseFloat(v) / 100 : num(v)); };
  const cw = cx.ref.w, ch = cx.ref.h;
  let stops: GradStop[];
  let paint: ShapePaint;
  if (g.localName === 'linearGradient') {
    const p1 = at(len('x1', '0%', cw), len('y1', '0%', ch)), p2 = at(len('x2', '100%', cw), len('y2', '0%', ch));
    const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    // the renderer runs the gradient across the box along the angle: stop offsets are moved onto that run
    const L = (Math.abs(dx) * bw + Math.abs(dy) * bh) / 2, ccx = (box[0] + box[2]) / 2, ccy = (box[1] + box[3]) / 2;
    const onRun = (x: number, y: number): number => ((x - (ccx - dx * L)) * dx + (y - (ccy - dy * L)) * dy) / Math.max(1e-6, 2 * L);
    stops = raw.map((s) => { const x = p1[0] + (p2[0] - p1[0]) * s.o, y = p1[1] + (p2[1] - p1[1]) * s.o; return { o: Math.min(1, Math.max(0, onRun(x, y))), color: s.color, ...(s.alpha < 1 ? { alpha: s.alpha } : {}) }; });
    paint = { kind: 'linear', color: raw[0].color, angle: (ang * 180) / Math.PI, stops: [] };
  } else {
    const c = at(len('cx', '50%', cw), len('cy', '50%', ch));
    const r0 = len('r', '50%', Math.hypot(cw, ch) / Math.SQRT2);
    const r = user ? r0 * Math.sqrt(Math.abs(gm[0] * gm[3] - gm[1] * gm[2])) : r0 * Math.max(bw, bh);
    const k = r / Math.max(1e-6, Math.max(bw, bh) / 2);
    stops = raw.map((s) => ({ o: Math.min(1, s.o * k), color: s.color, ...(s.alpha < 1 ? { alpha: s.alpha } : {}) }));
    paint = { kind: 'radial', color: raw[0].color, cx: Math.min(1, Math.max(-1, (c[0] - (box[0] + box[2]) / 2) / (bw / 2))), cy: Math.min(1, Math.max(-1, (c[1] - (box[1] + box[3]) / 2) / (bh / 2))), stops: [] };
  }
  if (stops.length > MAX_STOPS) stops = Array.from({ length: MAX_STOPS }, (_, i) => stops[Math.round((i * (stops.length - 1)) / (MAX_STOPS - 1))]);
  for (let i = 1; i < stops.length; i++) if (stops[i].o < stops[i - 1].o) stops[i] = { ...stops[i], o: stops[i - 1].o };
  paint.stops = stops;
  if (alpha < 1) paint.alpha = alpha;
  return paint;
}

const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/** The shapes of one drawn element; null with a reason when the part must become a picture. */
function drawElement(cx: Ctx, el: Element, m: Mat, st: Style): { shapes: SvgShape[] } | { why: string } {
  if (has(st.filter)) return { why: 'a filter' };
  if (has(st.mask)) return { why: 'a mask' };
  if (has(st['clip-path'])) return { why: 'a clipping path' };
  if (has(st['marker-start']) || has(st['marker-mid']) || has(st['marker-end'])) return { why: 'markers' };
  const d = shapeData(el, cx.ref);
  if (!d) return { shapes: [] };
  const runs = pathRuns(d).map((r) => nodesOf(r, m)).filter((r) => r.nodes.length > 1);
  if (!runs.length) return { shapes: [] };
  const op = opacity(st.opacity);
  const all = boxOf(runs.flatMap((r) => r.nodes));
  const fillV = st.fill ?? '#000000';
  const fill = el.localName === 'line' ? null : paintOf(cx, fillV, opacity(st['fill-opacity']) * op, st, all, m);
  const strokeP = paintOf(cx, st.stroke, opacity(st['stroke-opacity']) * op, st, all, m);
  if (fill === 'pattern' || strokeP === 'pattern') return { why: 'a pattern' };
  // more than one run with a fill: a run inside another that cuts a hole needs the picture path
  if (fill && runs.length > 1) {
    const evenodd = st['fill-rule'] === 'evenodd';
    const boxes = runs.map((r) => boxOf(r.nodes)), signs = runs.map((r) => Math.sign(area(r.nodes)));
    for (let i = 0; i < runs.length; i++) for (let j = 0; j < runs.length; j++) {
      if (i === j) continue;
      const a = boxes[i], b = boxes[j];
      if (b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3] && (evenodd || signs[i] !== signs[j])) return { why: 'a cut-out shape' };
    }
  }
  const sw = length(st['stroke-width'] ?? '1', Math.hypot(cx.ref.w, cx.ref.h) / Math.SQRT2, 1) * scaleOf(m);
  let stroke: ShapeStroke | null = null;
  if (strokeP && sw > 0) {
    const sc = (strokeP.stops?.[0]?.color ?? strokeP.color);
    const dash = (st['stroke-dasharray'] ?? '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
    const cap = st['stroke-linecap'], join = st['stroke-linejoin'];
    stroke = {
      color: sc, width: sw,
      ...(strokeP.alpha !== undefined ? { alpha: strokeP.alpha } : {}),
      ...(dash.length && dash.some((n) => n > 0) ? { dash: dash[0] * scaleOf(m), gap: (dash[1] ?? dash[0]) * scaleOf(m) } : {}),
      ...(st['stroke-dashoffset'] ? { dashOffset: num(st['stroke-dashoffset']) * scaleOf(m) } : {}),
      cap: cap === 'round' || cap === 'square' ? cap : 'butt',
      join: join === 'round' || join === 'bevel' ? join : 'miter',
      ...(st['stroke-miterlimit'] ? { miter: num(st['stroke-miterlimit'], 4) } : {}),
    };
  }
  if (!fill && !stroke) return { shapes: [] };
  const name = labelOf(el) ?? el.localName;
  return { shapes: runs.map((r) => ({ name, nodes: r.nodes, closed: r.closed || (!!fill && !stroke), fill, stroke })) };
}

function geometryCentre(cx: Ctx, el: Element, m: Mat): [number, number] | null {
  const d = shapeData(el, cx.ref);
  if (d) {
    const nodes = pathRuns(d).flatMap((r) => nodesOf(r, m).nodes);
    if (nodes.length) { const b = boxOf(nodes); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
  }
  // a group or anything else marked as the pivot: its own place
  const x = num(el.getAttribute('x'), NaN), y = num(el.getAttribute('y'), NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? apply(m, x, y) : null;
}

/** The part's own content (not nested parts): shapes, pivot, and the first reason it must be a picture. */
function own(cx: Ctx, w: PartWork, container: Element, m0: Mat, st0: Style, nested: Array<[Element, Mat, Style, Style]>): void {
  for (const el of kids(container)) {
    if (!isSvg(el) || DEFS.has(el.localName) || QUIET.has(el.localName)) continue;
    const st = styleOf(cx, el, st0);
    if (st.display === 'none') continue;
    const m = mul(m0, transformOf(el.getAttribute('transform')));
    if (isPivot(el)) {
      w.part.pivot = geometryCentre(cx, el, m);
      w.cut.push(el);
      continue;
    }
    if (el.localName === 'g') { nested.push([el, m0, st0, st]); w.cut.push(el); continue; }
    if (el.localName === 'a') { own(cx, w, el, m, st, nested); continue; }
    if (st.visibility === 'hidden' || st.visibility === 'collapse') continue;
    if (DRAWN.has(el.localName)) {
      const r = drawElement(cx, el, m, st);
      if ('why' in r) w.part.raster ??= r.why;
      else w.part.shapes.push(...r.shapes);
      continue;
    }
    w.part.raster ??= WHY[el.localName] ?? 'an element that is not a shape';
  }
}

function makePart(cx: Ctx, el: Element, outer: Mat, outerStyle: Style, st: Style, parent: number, above: number, out: PartWork[]): void {
  const m = mul(outer, transformOf(el.getAttribute('transform')));
  const part: SvgPart = {
    name: uniqueName(cx, labelOf(el) ?? `Part ${cx.parts.length + 1}`),
    parent, shapes: [], raster: null, pivot: null,
    opacity: opacity(st.opacity) * above,
    hidden: st.visibility === 'hidden' || st.visibility === 'collapse',
    markup: '',
  };
  // a hidden part keeps its art: the flag hides it, and only what is hidden inside it stays out
  if (part.hidden) { st = { ...st }; delete st.visibility; }
  if (has(st.filter)) part.raster = 'a filter';
  else if (has(st.mask)) part.raster = 'a mask';
  else if (has(st['clip-path'])) part.raster = 'a clipping path';
  const index = cx.parts.push(part) - 1;
  const w: PartWork = { part, el, outer, outerStyle, cut: [] };
  out.push(w);
  const nested: Array<[Element, Mat, Style, Style]> = [];
  if (el.localName === 'g' || el.localName === 'a') own(cx, w, el, m, st, nested);
  else {
    // a loose element at the top is a part of its own
    const r = DRAWN.has(el.localName) ? drawElement(cx, el, m, st) : { why: WHY[el.localName] ?? 'an element that is not a shape' };
    if ('why' in r) part.raster = r.why; else part.shapes.push(...r.shapes);
  }
  for (const [g, gm, gOuter, gs] of nested) makePart(cx, g, gm, gOuter, part.hidden && gs.visibility === undefined ? { ...gs, visibility: 'hidden' } : gs, index, part.opacity, out);
}

const isLayer = (el: Element): boolean => el.localName === 'g' && (el.getAttribute('inkscape:groupmode') === 'layer' || el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'groupmode') === 'layer');

function top(cx: Ctx, container: Element, m0: Mat, st0: Style, above: number, out: PartWork[]): void {
  for (const el of kids(container)) {
    if (!isSvg(el) || DEFS.has(el.localName) || QUIET.has(el.localName)) continue;
    const st = styleOf(cx, el, st0);
    if (st.display === 'none') continue;
    // an editor's layer holds parts; it is not one
    if (isLayer(el)) { top(cx, el, mul(m0, transformOf(el.getAttribute('transform'))), st, above * opacity(st.opacity), out); continue; }
    makePart(cx, el, m0, st0, st, -1, above, out);
  }
}

function matrixText(m: Mat): string {
  return `matrix(${m.map((n) => +n.toFixed(6)).join(' ')})`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** A standalone SVG of one part's own art, in the document's pixels. */
function markupOf(cx: Ctx, w: PartWork, xml: XMLSerializer): string {
  for (const c of w.cut) c.setAttribute('data-fm-cut', '1');
  const clone = w.el.cloneNode(true) as Element;
  for (const c of w.cut) c.removeAttribute('data-fm-cut');
  for (const c of Array.from(clone.querySelectorAll('[data-fm-cut]'))) c.remove();
  // the part's opacity is the block's own; the picture is drawn whole
  clone.setAttribute('style', `${clone.getAttribute('style') ?? ''};opacity:1${w.part.hidden ? ';visibility:visible' : ''}`);
  const inherit = INHERIT.filter((k) => w.outerStyle[k] !== undefined).map((k) => ` ${k}="${escAttr(w.outerStyle[k])}"`).join('');
  return `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink"${cx.xmlns} width="${cx.width}" height="${cx.height}" viewBox="0 0 ${cx.width} ${cx.height}">${cx.defs}<g transform="${matrixText(w.outer)}"${inherit}>${xml.serializeToString(clone)}</g></svg>`;
}

/** Reads an SVG into parts without touching a movie: names, nesting, shapes in the SVG's pixels, pivots and the picture markup. */
export function parseSvgParts(text: string): SvgDoc {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error(t('This SVG file could not be read.'));
  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  let width = length(root.getAttribute('width'), hasVb ? vb[2] : 1080, 0), height = length(root.getAttribute('height'), hasVb ? vb[3] : 1080, 0);
  if (!(width > 0)) width = hasVb ? (height > 0 ? (height * vb[2]) / vb[3] : vb[2]) : 1080;
  if (!(height > 0)) height = hasVb ? (width * vb[3]) / vb[2] : 1080;
  let vbm: Mat = IDENT;
  if (hasVb) {
    const par = (root.getAttribute('preserveAspectRatio') ?? '').trim();
    if (par.startsWith('none')) vbm = [width / vb[2], 0, 0, height / vb[3], (-vb[0] * width) / vb[2], (-vb[1] * height) / vb[3]];
    else {
      const s = Math.min(width / vb[2], height / vb[3]);
      vbm = [s, 0, 0, s, (width - vb[2] * s) / 2 - vb[0] * s, (height - vb[3] * s) / 2 - vb[1] * s];
    }
  }
  const ids = new Map<string, Element>();
  for (const el of Array.from(doc.querySelectorAll('[id]'))) { const id = el.getAttribute('id'); if (id && !ids.has(id)) ids.set(id, el); }
  let rules: Rule[] = [];
  for (const s of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'style'))) rules = rules.concat(parseCss(s.textContent ?? '', rules.length));
  rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const xml = new XMLSerializer();
  // every definition is carried into each part's picture, wherever the file kept it
  const inDefs = (el: Element): boolean => { for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (DEFS.has(p.localName)) return true; return false; };
  const defs = Array.from(root.querySelectorAll('*')).filter((el) => isSvg(el) && DEFS.has(el.localName) && el.localName !== 'script' && !inDefs(el));
  const cx: Ctx = {
    rules, ids, parts: [], names: new Set(), ref: { w: hasVb ? vb[2] : width, h: hasVb ? vb[3] : height },
    defs: defs.map((d) => xml.serializeToString(d)).join(''), width, height,
    xmlns: Array.from(root.attributes).filter((a) => a.name.startsWith('xmlns:') && a.name !== 'xmlns:xlink').map((a) => ` ${a.name}="${escAttr(a.value)}"`).join(''),
  };
  const rootStyle = styleOf(cx, root, {});
  const work: PartWork[] = [];
  const m0 = mul(vbm, transformOf(root.getAttribute('transform')));
  // one wrapper group holding only groups is the drawing's layer, not a part
  const drawn = kids(root).filter((el) => isSvg(el) && !DEFS.has(el.localName) && !QUIET.has(el.localName));
  const only = drawn.length === 1 && drawn[0].localName === 'g' ? drawn[0] : null;
  if (only && kids(only).filter((el) => isSvg(el) && el.localName === 'g').length >= 2 && kids(only).every((el) => !isSvg(el) || el.localName === 'g' || DEFS.has(el.localName) || QUIET.has(el.localName))) {
    const st = styleOf(cx, only, rootStyle);
    top(cx, only, mul(m0, transformOf(only.getAttribute('transform'))), st, opacity(st.opacity), work);
  } else top(cx, root, m0, rootStyle, 1, work);
  for (const w of work) w.part.markup = markupOf(cx, w, xml);
  return { width, height, parts: cx.parts };
}

// ---- into the movie --------------------------------------------------------------------------------------

/** Where the SVG lands: shrunk to fit the movie when larger, centred, on whole pixels. */
interface Fit { k: number; ox: number; oy: number; W: number; H: number }

function fitOf(doc: SvgDoc, movie: Movie): Fit {
  const W = movie.width, H = movie.height;
  const k = Math.min(1, W / doc.width, H / doc.height);
  return { k, ox: Math.round((W - doc.width * k) / 2), oy: Math.round((H - doc.height * k) / 2), W, H };
}

/** A part drawn as a picture at the movie's scale, cropped to what it covers. */
async function drawPart(markup: string, doc: SvgDoc, f: Fit): Promise<{ cv: OffscreenCanvas; x: number; y: number } | null> {
  const w = Math.max(1, Math.round(doc.width * f.k)), h = Math.max(1, Math.round(doc.height * f.k));
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const full = new OffscreenCanvas(w, h);
    const fc = full.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    fc.drawImage(img, 0, 0, w, h);
    const px = fc.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) if (px[row + x * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const cv = new OffscreenCanvas(cw, ch);
    (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch);
    return { cv, x: f.ox + x0, y: f.oy + y0 };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pixelsAsset(name: string, blob: Blob, w: number, h: number): Asset {
  return { id: uid('a'), kind: 'pixels', name, mime: 'image/png', width: w, height: h, frames: 0, size: blob.size };
}

function shapeContent(s: SvgShape, f: Fit, dur: number): Content {
  const mx = (x: number): number => f.ox + x * f.k - f.W / 2, my = (y: number): number => f.oy + y * f.k - f.H / 2;
  const nodes = s.nodes.map((n) => ({ x: mx(n.x), y: my(n.y), ix: n.ix * f.k, iy: n.iy * f.k, ox: n.ox * f.k, oy: n.oy * f.k }));
  const stroke = s.stroke ? { ...s.stroke, width: s.stroke.width * f.k, ...(s.stroke.dash ? { dash: s.stroke.dash * f.k, gap: (s.stroke.gap ?? 0) * f.k } : {}), ...(s.stroke.dashOffset ? { dashOffset: s.stroke.dashOffset * f.k } : {}) } : null;
  const def: ShapeDef = refitPath({ type: 'path', w: 0, h: 0, fill: s.fill, stroke, nodes, closed: s.closed });
  return makeContent('shape', 0, dur, { name: s.name, shape: def });
}

/** Bounding box of contents in movie pixels from the top-left (shapes by outline, pictures by canvas). */
function boxOfContents(list: Content[], f: Fit): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  const add = (x0: number, y0: number, x1: number, y1: number): void => { b = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]; };
  const walk = (c: Content): void => {
    if (c.kind === 'shape' && c.shape) { const o = bounds(outline(c.shape, shapeBase(c.shape))); if (o) add(o[0] + f.W / 2, o[1] + f.H / 2, o[2] + f.W / 2, o[3] + f.H / 2); }
    if (c.canvas) add(c.canvas.x, c.canvas.y, c.canvas.x + c.canvas.w, c.canvas.y + c.canvas.h);
    for (const t of c.tracks) t.content.forEach(walk);
  };
  list.forEach(walk);
  return b;
}

async function partContent(p: SvgPart, doc: SvgDoc, f: Fit, dur: number, assets: ImportResult['assets']): Promise<Content> {
  let c: Content;
  if (p.raster || !p.shapes.length) {
    const pic = p.raster ? await drawPart(p.markup, doc, f) : null;
    if (pic) {
      const blob = await pic.cv.convertToBlob({ type: 'image/png' });
      const asset = pixelsAsset(p.name, blob, pic.cv.width, pic.cv.height);
      assets.push({ asset, blob });
      const canvas: CanvasRect = { x: pic.x, y: pic.y, w: pic.cv.width, h: pic.cv.height };
      c = makeContent('drawing', 0, dur, { name: p.name, layers: [{ ...drawingLayer(p.name), pixels: asset.id }], canvas });
    } else c = makeContent('drawing', 0, dur, { name: p.name });
  } else if (p.shapes.length === 1) {
    c = { ...shapeContent(p.shapes[0], f, dur), name: p.name };
  } else {
    // top first on the Timeline, as the SVG draws its last element on top
    const tracks: Track[] = p.shapes.map((s) => makeTrack(s.name, [shapeContent(s, f, dur)])).reverse();
    c = makeContent('group', 0, dur, { name: p.name, tracks });
  }
  const b = boxOfContents([c], f);
  const pv = p.pivot ? [f.ox + p.pivot[0] * f.k, f.oy + p.pivot[1] * f.k] : b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
  if (pv) c.pivot = { x: +(pv[0] - f.W / 2).toFixed(2), y: +(pv[1] - f.H / 2).toFixed(2) };
  if (p.opacity < 1) c.opacity = p.opacity;
  if (p.hidden) c.hidden = true;
  return c;
}

/**
 * An SVG with one group per body part as a new character Group at frame `at`: each part on its own inner track,
 * nested groups parented to the part they sit in, pivots from each part's pivot element or its centre.
 */
export async function svgToCharacterGroup(text: string, fileName: string, movie: Movie, at: number): Promise<ImportResult> {
  const doc = parseSvgParts(text);
  if (!doc.parts.length) throw new Error(tf('{name} has no shapes FormMorpheus can read.', { name: fileName }));
  const f = fitOf(doc, movie);
  const dur = Math.max(1, movie.duration - at);
  const assets: ImportResult['assets'] = [];
  const made: Content[] = [];
  for (const p of doc.parts) made.push(await partContent(p, doc, f, dur, assets));
  const name = baseOf(fileName);
  const tracks = made.map((c) => makeTrack(c.name, [c])).reverse();
  let group = makeContent('group', at, dur, { name, tracks });
  const all = boxOfContents(made, f);
  if (all) group.pivot = { x: +((all[0] + all[2]) / 2 - f.W / 2).toFixed(2), y: +((all[1] + all[3]) / 2 - f.H / 2).toFixed(2) };
  // nested parts follow the part they sit in, linked the way the Parent command links them
  let tmp: Movie = { ...movie, tracks: [makeTrack('svg', [group])] };
  doc.parts.forEach((p, i) => { if (p.parent >= 0) tmp = setParent(tmp, made[i].id, made[p.parent].id); });
  group = tmp.tracks[0].content[0];
  group = { ...group, character: characterInfoOf(group, name) };
  const n = doc.parts.length;
  const notes = doc.parts.filter((p) => p.raster).map((p) => tf('{part} is drawn as a picture: it holds {what}.', { part: p.name, what: t(p.raster as string) }));
  const head = tf(n === 1 ? '{name}: 1 part.' : '{name}: {n} parts.', { name: fileName, n });
  return { assets, contents: [group], ownTrack: [true], notice: [head, ...notes].join(' ') };
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The mouth shape a part name stands for (Rest, MBP, AI, E, O, U, FV, L / th, written any way), or null. */
function visemeOf(name: string): string | null {
  const s = squash(name);
  for (const v of VISEMES) if (squash(VISEME_NAMES[v]) === s || squash(v) === s) return VISEME_NAMES[v];
  return null;
}

/** True when an SVG's top-level groups are a mouth chart: most of them named for the eight mouth shapes. */
export function isMouthChart(doc: SvgDoc): boolean {
  const topParts = doc.parts.filter((p) => p.parent < 0);
  const named = new Set(topParts.map((p) => visemeOf(p.name)).filter(Boolean));
  return named.size >= 6 && topParts.length <= VISEMES.length + 2;
}

/**
 * A mouth chart SVG (top-level groups named Rest, MBP, AI, E, O, U, FV and L / th; data-name, label or id) as one
 * Flipbook at frame `at`, its frames named for the shapes in chart order, drawn where the SVG draws them on the movie.
 */
export async function svgToMouthChart(text: string, movie: Movie, at = 0, fileName = 'Mouth chart.svg'): Promise<ImportResult & { content: Content }> {
  const doc = parseSvgParts(text);
  const topParts = doc.parts.filter((p) => p.parent < 0);
  if (!topParts.length) throw new Error(tf('{name} has no shapes FormMorpheus can read.', { name: fileName }));
  const f = fitOf(doc, movie);
  const named = topParts.map((p) => ({ p, v: visemeOf(p.name) }));
  const order = (v: string | null): number => (v ? Object.values(VISEME_NAMES).indexOf(v) : VISEMES.length);
  named.sort((a, b) => order(a.v) - order(b.v));
  const pics: Array<{ name: string; pic: Awaited<ReturnType<typeof drawPart>> }> = [];
  for (const { p, v } of named) pics.push({ name: v ?? p.name, pic: await drawPart(p.markup, doc, f) });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { pic } of pics) if (pic) { x0 = Math.min(x0, pic.x); y0 = Math.min(y0, pic.y); x1 = Math.max(x1, pic.x + pic.cv.width); y1 = Math.max(y1, pic.y + pic.cv.height); }
  if (!(x1 > x0)) throw new Error(tf('{name} has no shapes FormMorpheus can read.', { name: fileName }));
  const rect: CanvasRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const assets: ImportResult['assets'] = [];
  const frames: FlipbookFrame[] = [];
  for (const { name, pic } of pics) {
    const layer = drawingLayer(name);
    if (pic) {
      const cv = new OffscreenCanvas(rect.w, rect.h);
      (cv.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(pic.cv, pic.x - rect.x, pic.y - rect.y);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      const asset = pixelsAsset(name, blob, rect.w, rect.h);
      assets.push({ asset, blob });
      layer.pixels = asset.id;
    }
    frames.push({ id: uid('f'), hold: 1, layers: [layer], name });
  }
  const row = { ...flipTrack('Mouth', 1), frames };
  const content = makeContent('flipbook', at, Math.max(frames.length, movie.duration - at), { name: 'Mouth', flip: [row], canvas: rect });
  return { assets, contents: [content], ownTrack: [true], notice: tf('{name}: a mouth chart of {n} drawings.', { name: fileName, n: frames.length }), content };
}

/** True for a file that is an SVG by its name, type or first bytes. */
export function isSvgFile(file: File, head: Uint8Array): boolean {
  if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') return true;
  const s = new TextDecoder().decode(head).trimStart();
  return s.startsWith('<svg') || (s.startsWith('<?xml') && /\.svg/i.test(file.name));
}

/** An SVG file as a character, or as a mouth chart Flipbook when its groups are named for the mouth shapes. */
export async function importSvg(file: File, movie: Movie, at: number): Promise<ImportResult> {
  const text = await file.text();
  if (isMouthChart(parseSvgParts(text))) return svgToMouthChart(text, movie, at, file.name);
  return svgToCharacterGroup(text, file.name, movie, at);
}
