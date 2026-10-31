// Shape tool on the Stage: a small tool strip, drag-to-draw for every shape kind, the pen (click for corners, drag for
// curve handles, click the first node to close) and node editing for a selected path. The Stage lends its view and
// pointer mapping; everything else lives here.
import type { Engine } from '../engine/engine';
import { locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { View } from '../engine/render';
import { animate } from '../engine/keys';
import { topMatrix, invert, apply } from '../engine/transform';
import { centreNodes, nearestOnPath, refitPath, shapeColorOver, shapeExtra, splitSegment, withShape } from '../engine/shape-ops';
import { outline, shapeBase } from '../engine/shape';
import type { BezNode, ShapeType } from '../engine/shape-types';
import type { Content } from '../engine/types';
import { el, q, setHidden, setClass } from './dom';
import { icon } from './icons';
import '../styles/shape.css';

export type ShapeTool = ShapeType | 'pen';

const KINDS: Array<[ShapeTool, string, string]> = [
  ['rect', 'shRect', 'Rectangle'], ['ellipse', 'shEllipse', 'Ellipse'], ['polygon', 'shPolygon', 'Polygon'], ['star', 'shStar', 'Star'],
  ['line', 'shLine', 'Line'], ['arrow', 'shArrow', 'Arrow'], ['pen', 'shPen', 'Pen'],
];

export interface ShapeStageHooks {
  view(): View | null;
  /** The pointer in Stage space (screen pixels of the Stage). */
  point(e: { clientX: number; clientY: number }): [number, number];
  focus(): void;
}

const NS = 'http://www.w3.org/2000/svg';
const svgEl = <T extends SVGElement>(tag: string, cls: string): T => { const n = document.createElementNS(NS, tag) as T; n.setAttribute('class', cls); return n; };

interface NodeEls { node: SVGRectElement; hi: SVGCircleElement; ho: SVGCircleElement; si: SVGLineElement; so: SVGLineElement }

/** Keeps one pen tool per app: the Stage view and the commands share it. */
export class ShapeStage {
  private tool: ShapeTool | null = null;
  private readonly strip: HTMLElement;
  private readonly buttons = new Map<ShapeTool, HTMLButtonElement>();
  private readonly toggle: HTMLButtonElement;
  private readonly sub: HTMLElement;
  private readonly ov: SVGSVGElement;
  private readonly prev: SVGPathElement;
  private readonly pathLine: SVGPathElement;
  private readonly hit: SVGPathElement;
  private readonly els: NodeEls[] = [];
  private lastKind: ShapeTool = 'rect';
  /** Drag-draw in flight, in movie pixels from the movie centre. */
  private draw: { x0: number; y0: number; x1: number; y1: number; pointer: number; shift: boolean; alt: boolean } | null = null;
  /** Pen in flight: nodes so far (movie pixels from the movie centre) and the node being pulled out. */
  private pen: { nodes: BezNode[]; pull: number; pointer: number; sx: number; sy: number } | null = null;
  private selNode = -1;
  private nodeDrag: { part: 'node' | 'in' | 'out'; i: number; pointer: number; tag: string; tied: boolean } | null = null;
  private sigShown = '';

  constructor(space: HTMLElement, root: HTMLElement, private readonly engine: Engine, private readonly hooks: ShapeStageHooks) {
    this.strip = el<HTMLElement>('<div class="fm-shtool" hidden role="toolbar" aria-label="Shape tool"></div>');
    this.toggle = el<HTMLButtonElement>(`<button class="fm-shtool-btn" type="button" title="Shape tool (U)" aria-label="Shape tool" aria-pressed="false">${icon('shape', 18)}</button>`);
    this.sub = el<HTMLElement>('<div class="fm-shtool-sub" hidden></div>');
    this.strip.append(this.toggle, this.sub);
    for (const [k, ic, label] of KINDS) {
      const b = el<HTMLButtonElement>(`<button class="fm-shtool-btn" type="button" title="${label}" aria-label="${label}" aria-pressed="false">${icon(ic, 18)}</button>`);
      b.addEventListener('click', () => this.set(this.tool === k ? null : k));
      this.buttons.set(k, b);
      this.sub.appendChild(b);
    }
    this.toggle.addEventListener('click', () => this.set(this.tool ? null : this.lastKind));
    root.appendChild(this.strip);

    this.ov = svgEl<SVGSVGElement>('svg', 'fm-shov');
    this.prev = svgEl<SVGPathElement>('path', 'fm-shov-prev');
    this.pathLine = svgEl<SVGPathElement>('path', 'fm-shov-seg');
    this.hit = svgEl<SVGPathElement>('path', 'fm-shov-hit');
    this.ov.append(this.prev, this.pathLine, this.hit);
    this.prev.setAttribute('hidden', '');
    space.appendChild(this.ov);
    this.hit.addEventListener('dblclick', (e) => this.addNodeAt(e));

    const canvas = q<HTMLElement>(space, '.fm-stage-canvas'), box = q<HTMLElement>(space, '.fm-stage-box');
    for (const t of [canvas, box]) {
      t.addEventListener('pointerdown', (e) => this.down(e as PointerEvent));
      t.addEventListener('pointermove', (e) => this.move(e as PointerEvent));
      t.addEventListener('pointerup', (e) => this.up(e as PointerEvent));
      t.addEventListener('pointercancel', () => this.cancelDraw());
      t.addEventListener('dblclick', (e) => { if (this.pen) { e.stopImmediatePropagation(); this.finishPen(false); } }, true);
    }
    window.addEventListener('pointermove', (e) => this.nodeMove(e));
    window.addEventListener('pointerup', (e) => this.nodeUp(e));
    document.addEventListener('keydown', (e) => this.key(e), true);
    for (const ev of ['movie', 'selection', 'mode', 'projects'] as const) engine.on(ev, () => this.paintStrip());
    this.paintStrip();
  }

  get active(): ShapeTool | null { return this.tool; }

  /** Picks (or, with null, drops) the drawing tool. */
  set(t: ShapeTool | null): void {
    if (t === this.tool) return;
    this.cancelDraw();
    this.tool = t;
    if (t) this.lastKind = t;
    this.paintStrip();
    this.hooks.focus();
  }

  /** Shape tool on (with the last kind) or off. */
  toggleTool(kind?: ShapeTool): void {
    if (kind) this.set(this.tool === kind ? null : kind); else this.set(this.tool ? null : this.lastKind);
  }

  private paintStrip(): void {
    const open = !!this.engine.movie;
    setHidden(this.strip, !open);
    setClass(this.toggle, 'is-on', !!this.tool);
    this.toggle.setAttribute('aria-pressed', String(!!this.tool));
    setHidden(this.sub, !this.tool);
    for (const [k, b] of this.buttons) { setClass(b, 'is-on', this.tool === k); b.setAttribute('aria-pressed', String(this.tool === k)); }
    this.ov.style.cursor = this.tool ? 'crosshair' : '';
    // a tool-aware cursor on the Stage itself
    this.strip.parentElement?.classList.toggle('is-shape-tool', !!this.tool);
  }

  // ---- movie <-> stage ------------------------------------------------------

  private toMovie(e: { clientX: number; clientY: number }): [number, number] | null {
    const v = this.hooks.view(), m = this.engine.movie;
    if (!v || !m) return null;
    const [x, y] = this.hooks.point(e);
    return [(x - v.ox) / v.scale - m.width / 2, (y - v.oy) / v.scale - m.height / 2];
  }

  private toScreen(x: number, y: number): [number, number] {
    const v = this.hooks.view() as View, m = this.engine.movie as NonNullable<Engine['movie']>;
    return [v.ox + (x + m.width / 2) * v.scale, v.oy + (y + m.height / 2) * v.scale];
  }

  // ---- drawing --------------------------------------------------------------

  private down(e: PointerEvent): void {
    const t = this.tool;
    if (!t || e.button !== 0 || !this.engine.movie) return;
    const p = this.toMovie(e);
    if (!p) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (t === 'pen') { this.penDown(e, p); return; }
    this.draw = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], pointer: e.pointerId, shift: e.shiftKey, alt: e.altKey };
    this.paintDraw();
  }

  private move(e: PointerEvent): void {
    const d = this.draw, pen = this.pen;
    if (d && e.pointerId === d.pointer) {
      e.stopImmediatePropagation();
      const p = this.toMovie(e);
      if (!p) return;
      d.x1 = p[0]; d.y1 = p[1]; d.shift = e.shiftKey; d.alt = e.altKey;
      this.paintDraw();
    } else if (pen && e.pointerId === pen.pointer && pen.pull >= 0) {
      e.stopImmediatePropagation();
      const p = this.toMovie(e);
      if (!p) return;
      const n = pen.nodes[pen.pull];
      // pulling out of a fresh node sets its out handle and mirrors the in handle
      n.ox = p[0] - n.x; n.oy = p[1] - n.y; n.ix = -n.ox; n.iy = -n.oy;
      this.paintPen();
    }
  }

  private up(e: PointerEvent): void {
    const d = this.draw;
    if (d && e.pointerId === d.pointer) {
      e.stopImmediatePropagation();
      this.draw = null;
      this.finishDraw(d);
      return;
    }
    const pen = this.pen;
    if (pen && e.pointerId === pen.pointer) { e.stopImmediatePropagation(); pen.pull = -1; this.paintPen(); }
  }

  private cancelDraw(): void {
    this.draw = null;
    this.pen = null;
    this.prev.setAttribute('d', '');
    this.prev.setAttribute('hidden', '');
  }

  /** The drag rectangle as centre, size and (for lines) angle, after Shift and Alt. */
  private geometry(d: NonNullable<ShapeStage['draw']>, kind: ShapeTool): { cx: number; cy: number; w: number; h: number; rot: number } {
    let dx = d.x1 - d.x0, dy = d.y1 - d.y0;
    if (kind === 'line' || kind === 'arrow') {
      let rot = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Shift snaps the angle to 15 degrees
      if (d.shift) rot = Math.round(rot / 15) * 15;
      const len = Math.hypot(dx, dy);
      const a = (rot * Math.PI) / 180;
      dx = Math.cos(a) * len; dy = Math.sin(a) * len;
      return d.alt ? { cx: d.x0, cy: d.y0, w: len * 2, h: 60, rot } : { cx: d.x0 + dx / 2, cy: d.y0 + dy / 2, w: len, h: 60, rot };
    }
    if (d.shift) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
    if (d.alt) return { cx: d.x0, cy: d.y0, w: Math.abs(dx) * 2, h: Math.abs(dy) * 2, rot: 0 };
    return { cx: d.x0 + dx / 2, cy: d.y0 + dy / 2, w: Math.abs(dx), h: Math.abs(dy), rot: 0 };
  }

  private paintDraw(): void {
    const d = this.draw, kind = this.tool;
    if (!d || !kind || kind === 'pen') return;
    const g = this.geometry(d, kind);
    const def = shapeExtra(kind, Math.max(1, g.w), Math.max(1, g.h)).shape;
    if (!def) return;
    const subs = outline(def, shapeBase(def));
    const a = (g.rot * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    let s = '';
    for (const sub of subs) {
      for (let i = 0; i < sub.p.length; i += 2) {
        const x = sub.p[i], y = sub.p[i + 1];
        const [px, py] = this.toScreen(g.cx + x * cs - y * sn, g.cy + x * sn + y * cs);
        s += `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`;
      }
      if (sub.closed) s += 'Z';
    }
    this.prev.removeAttribute('hidden');
    this.prev.setAttribute('d', s);
  }

  private finishDraw(d: NonNullable<ShapeStage['draw']>): void {
    const kind = this.tool;
    this.prev.setAttribute('d', '');
    this.prev.setAttribute('hidden', '');
    if (!kind || kind === 'pen') return;
    const v = this.hooks.view();
    const tiny = !v || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * v.scale < 4;
    // a click without a drag drops the default size at the click
    const g = tiny ? { cx: d.x0, cy: d.y0, w: kind === 'line' || kind === 'arrow' ? 400 : kind === 'rect' || kind === 'ellipse' ? 400 : 320, h: kind === 'rect' || kind === 'ellipse' ? 300 : kind === 'arrow' ? 60 : 320, rot: 0 } : this.geometry(d, kind);
    const extra = shapeExtra(kind, g.w, g.h, Math.round(g.cx), Math.round(g.cy), Math.round(g.rot * 10) / 10, undefined, false, shapeColorOver(this.engine.movie, this.engine.frame));
    const id = this.engine.insert('shape', extra);
    if (id) this.engine.select([id]);
    this.set(null);
  }

  // ---- pen ------------------------------------------------------------------

  private penDown(e: PointerEvent, p: [number, number]): void {
    const pen = this.pen ?? (this.pen = { nodes: [], pull: -1, pointer: e.pointerId, sx: 0, sy: 0 });
    pen.pointer = e.pointerId;
    const v = this.hooks.view() as View;
    // clicking the first node closes the outline
    if (pen.nodes.length >= 2) {
      const f = pen.nodes[0];
      if (Math.hypot(p[0] - f.x, p[1] - f.y) * v.scale < 10) { this.finishPen(true); return; }
    }
    pen.nodes.push({ x: p[0], y: p[1], ix: 0, iy: 0, ox: 0, oy: 0 });
    pen.pull = pen.nodes.length - 1;
    this.paintPen();
  }

  private paintPen(): void {
    const pen = this.pen;
    if (!pen) return;
    const pts = pen.nodes;
    let s = '';
    pts.forEach((n, i) => {
      const [x, y] = this.toScreen(n.x, n.y);
      if (!i) { s += `M${x.toFixed(1)} ${y.toFixed(1)}`; return; }
      const a = pts[i - 1], [c1x, c1y] = this.toScreen(a.x + a.ox, a.y + a.oy), [c2x, c2y] = this.toScreen(n.x + n.ix, n.y + n.iy);
      s += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    for (const n of pts) { const [x, y] = this.toScreen(n.x, n.y); s += `M${(x - 3).toFixed(1)} ${(y - 3).toFixed(1)}h6v6h-6z`; }
    this.prev.removeAttribute('hidden');
    this.prev.setAttribute('d', s);
  }

  private finishPen(closed: boolean): void {
    const pen = this.pen;
    this.pen = null;
    this.prev.setAttribute('d', '');
    this.prev.setAttribute('hidden', '');
    if (!pen) return;
    let nodes = pen.nodes;
    // a double-click leaves its second press as a duplicate last node
    if (nodes.length >= 2) {
      const a = nodes[nodes.length - 1], b = nodes[nodes.length - 2];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 2) nodes = nodes.slice(0, -1);
    }
    if (nodes.length < 2) { this.set(null); return; }
    const c = centreNodes(nodes);
    const extra = shapeExtra('path', 1, 1, Math.round(c.cx), Math.round(c.cy), 0, c.nodes, closed, shapeColorOver(this.engine.movie, this.engine.frame));
    const id = this.engine.insert('shape', extra);
    if (id) this.engine.select([id]);
    this.set(null);
  }

  private key(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.closest('input, textarea, select') || target.isContentEditable)) return;
    if (this.pen && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.finishPen(false); return; }
    if ((this.pen || this.draw) && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelDraw(); this.set(null); return; }
    if (this.tool && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.set(null); return; }
    if (this.selNode >= 0 && (e.key === 'Delete' || e.key === 'Backspace') && this.pathContent()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.removeNode(this.selNode);
    }
  }

  // ---- node editing ---------------------------------------------------------

  private pathContent(): Content | null {
    if (this.tool || this.engine.mode === 'perform') return null;
    const sel = this.engine.selected;
    const c = sel.length === 1 ? sel[0] : null;
    return c && c.kind === 'shape' && c.shape?.type === 'path' && this.engine.isOver(c) ? c : null;
  }

  /** Content-local (movie-centre) to Stage space for a content, with the inverse for pointer maths. */
  private matrices(c: Content): { fwd: ReturnType<typeof topMatrix>; inv: ReturnType<typeof invert> } | null {
    const v = this.hooks.view(), m = this.engine.movie;
    if (!v || !m) return null;
    const a = animate(c, this.engine.frame - c.start);
    const fwd = topMatrix(m, c, this.engine.frame, a, v);
    return { fwd, inv: invert(fwd) };
  }

  /** Updates the node overlay for the selection; called whenever the Stage redraws its box. */
  sync(): void {
    const c = this.pathContent();
    const v = this.hooks.view(), m = this.engine.movie;
    if (!c || !c.shape || !v || !m) { this.hideNodes(); return; }
    const mats = this.matrices(c);
    if (!mats) { this.hideNodes(); return; }
    const nodes = c.shape.nodes ?? [];
    const P = (x: number, y: number): [number, number] => apply(mats.fwd, x + m.width / 2, y + m.height / 2);
    // the outline under the nodes, as bezier segments in Stage space
    let s = '';
    const last = c.shape.closed ? nodes.length : nodes.length - 1;
    for (let i = 0; i < last; i++) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      const [ax, ay] = P(a.x, a.y), [c1x, c1y] = P(a.x + a.ox, a.y + a.oy), [c2x, c2y] = P(b.x + b.ix, b.y + b.iy), [bx, by] = P(b.x, b.y);
      s += `${i ? '' : `M${ax.toFixed(1)} ${ay.toFixed(1)}`}C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    }
    this.pathLine.setAttribute('d', s);
    this.hit.setAttribute('d', s);
    while (this.els.length < nodes.length) this.makeNodeEls();
    this.els.forEach((n, i) => {
      const on = i < nodes.length;
      for (const e of [n.node, n.hi, n.ho, n.si, n.so]) { if (on) e.removeAttribute('hidden'); else e.setAttribute('hidden', ''); }
      if (!on) return;
      const nd = nodes[i];
      const [x, y] = P(nd.x, nd.y);
      n.node.setAttribute('x', (x - 4.5).toFixed(1)); n.node.setAttribute('y', (y - 4.5).toFixed(1));
      n.node.classList.toggle('is-sel', i === this.selNode);
      const hin = nd.ix !== 0 || nd.iy !== 0, hout = nd.ox !== 0 || nd.oy !== 0;
      const showH = i === this.selNode || this.selNode < 0 || true;
      const put = (h: SVGCircleElement, stem: SVGLineElement, has: boolean, hx: number, hy: number): void => {
        if (!has || !showH) { h.setAttribute('hidden', ''); stem.setAttribute('hidden', ''); return; }
        const [px, py] = P(nd.x + hx, nd.y + hy);
        h.setAttribute('cx', px.toFixed(1)); h.setAttribute('cy', py.toFixed(1));
        stem.setAttribute('x1', x.toFixed(1)); stem.setAttribute('y1', y.toFixed(1)); stem.setAttribute('x2', px.toFixed(1)); stem.setAttribute('y2', py.toFixed(1));
      };
      put(n.hi, n.si, hin, nd.ix, nd.iy);
      put(n.ho, n.so, hout, nd.ox, nd.oy);
    });
    this.sigShown = c.id;
  }

  private hideNodes(): void {
    if (this.sigShown === '') return;
    this.sigShown = '';
    this.selNode = -1;
    this.pathLine.setAttribute('d', '');
    this.hit.setAttribute('d', '');
    for (const n of this.els) for (const e of [n.node, n.hi, n.ho, n.si, n.so]) e.setAttribute('hidden', '');
  }

  private makeNodeEls(): void {
    const i = this.els.length;
    const n: NodeEls = {
      node: svgEl<SVGRectElement>('rect', 'fm-shov-node'), hi: svgEl<SVGCircleElement>('circle', 'fm-shov-h'), ho: svgEl<SVGCircleElement>('circle', 'fm-shov-h'),
      si: svgEl<SVGLineElement>('line', 'fm-shov-stem'), so: svgEl<SVGLineElement>('line', 'fm-shov-stem'),
    };
    n.node.setAttribute('width', '9'); n.node.setAttribute('height', '9'); n.node.setAttribute('rx', '2');
    n.hi.setAttribute('r', '3.5'); n.ho.setAttribute('r', '3.5');
    this.ov.append(n.si, n.so, n.node, n.hi, n.ho);
    n.node.addEventListener('pointerdown', (e) => this.nodeDown(e, 'node', i));
    n.hi.addEventListener('pointerdown', (e) => this.nodeDown(e, 'in', i));
    n.ho.addEventListener('pointerdown', (e) => this.nodeDown(e, 'out', i));
    this.els.push(n);
  }

  private local(c: Content, e: { clientX: number; clientY: number }): [number, number] | null {
    const mats = this.matrices(c), m = this.engine.movie;
    if (!mats || !mats.inv || !m) return null;
    const [x, y] = this.hooks.point(e);
    const [lx, ly] = apply(mats.inv, x, y);
    return [lx - m.width / 2, ly - m.height / 2];
  }

  private nodeDown(e: PointerEvent, part: 'node' | 'in' | 'out', i: number): void {
    const c = this.pathContent();
    if (!c || !c.shape?.nodes || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    this.hooks.focus();
    this.selNode = i;
    const nd = c.shape.nodes[i];
    if (part === 'node' && e.altKey) { this.toggleCorner(c, i); return; }
    const cross = nd.ix * nd.oy - nd.iy * nd.ox;
    const tied = !e.altKey && Math.abs(cross) < 1e-3 * (Math.hypot(nd.ix, nd.iy) * Math.hypot(nd.ox, nd.oy) + 1);
    this.nodeDrag = { part, i, pointer: e.pointerId, tag: `shp-node-${Date.now()}`, tied };
    (e.target as Element).setPointerCapture(e.pointerId);
    this.sync();
  }

  private nodeMove(e: PointerEvent): void {
    const g = this.nodeDrag;
    if (!g || e.pointerId !== g.pointer) return;
    const c = this.pathContent();
    const p = c ? this.local(c, e) : null;
    if (!c || !p || !c.shape?.nodes) return;
    const nodes = c.shape.nodes.map((n) => ({ ...n }));
    const n = nodes[g.i];
    if (g.part === 'node') { n.x = p[0]; n.y = p[1]; }
    else if (g.part === 'out') {
      n.ox = p[0] - n.x; n.oy = p[1] - n.y;
      if (g.tied) { const lo = Math.hypot(n.ix, n.iy), l = Math.hypot(n.ox, n.oy) || 1; n.ix = (-n.ox / l) * lo; n.iy = (-n.oy / l) * lo; }
    } else {
      n.ix = p[0] - n.x; n.iy = p[1] - n.y;
      if (g.tied) { const lo = Math.hypot(n.ox, n.oy), l = Math.hypot(n.ix, n.iy) || 1; n.ox = (-n.ix / l) * lo; n.oy = (-n.iy / l) * lo; }
    }
    this.commit(c.id, nodes, g.tag, 'Edit path');
  }

  private nodeUp(e: PointerEvent): void {
    const g = this.nodeDrag;
    if (!g || e.pointerId !== g.pointer) return;
    this.nodeDrag = null;
    this.engine.endGesture();
  }

  private commit(id: string, nodes: BezNode[], tag: string | null, label: string): void {
    this.engine.run(label, (mv) => ops.updateContent(mv, id, (c) => withShape(c, (d) => refitPath({ ...d, nodes }))), tag);
  }

  private toggleCorner(c: Content, i: number): void {
    const nodes = (c.shape?.nodes ?? []).map((n) => ({ ...n }));
    const n = nodes[i], prev = nodes[(i + nodes.length - 1) % nodes.length], next = nodes[(i + 1) % nodes.length];
    if (n.ix || n.iy || n.ox || n.oy) { n.ix = n.iy = n.ox = n.oy = 0; }
    else {
      const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
      n.ox = tx; n.oy = ty; n.ix = -tx; n.iy = -ty;
    }
    this.commit(c.id, nodes, null, n.ox || n.oy ? 'Smooth node' : 'Sharpen node');
  }

  private removeNode(i: number): void {
    const c = this.pathContent();
    if (!c?.shape?.nodes || c.shape.nodes.length <= 2) return;
    this.commit(c.id, c.shape.nodes.filter((_, k) => k !== i), null, 'Delete node');
    this.selNode = -1;
  }

  private addNodeAt(e: MouseEvent): void {
    const c = this.pathContent();
    const p = c ? this.local(c, e) : null;
    if (!c?.shape?.nodes || !p) return;
    const hit = nearestOnPath(c.shape.nodes, c.shape.closed === true, p[0], p[1]);
    if (!hit) return;
    e.stopPropagation();
    this.commit(c.id, splitSegment(c.shape.nodes, hit.seg, hit.t), null, 'Add node');
    this.selNode = hit.seg + 1;
  }

  /** Content selected on the Stage the tool should not fight: used by the Stage to skip its own box for a path being edited. */
  editingPath(): boolean { return this.pathContent() !== null; }

  /** The content the node overlay edits, if any (for tests and status). */
  locateEdited(): string | null { const c = this.pathContent(); return c && locate(this.engine.movie as NonNullable<Engine['movie']>, c.id) ? c.id : null; }
}
