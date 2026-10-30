// Motion path and pivot on the Stage. In Keyframe mode the selected block's Move path is drawn (a dot per frame,
// a square per key, Bezier handles on the selected key); dragging a square moves that key, dragging a handle bends
// the curve, Alt-click on a square toggles smooth / corner. In Compose and Keyframe modes a crosshair marks the
// pivot that rotation and scale turn around; drag it (Alt-drag keeps the picture where it is). One undo step per drag.
import type { Engine } from '../engine/engine';
import type { View } from '../engine/render';
import * as keyOps from '../engine/key-ops';
import * as pathOps from '../engine/path-ops';
import * as ops from '../engine/ops';
import { locate } from '../engine/model';
import { animate, evalLane, laneOf } from '../engine/keys';
import { laneSegments, smoothPathOn, type PathNode } from '../engine/path';
import type { Content, Movie } from '../engine/types';
import { apply, invert, mul, postMatrix, viewMat, type Mat } from '../engine/transform';
import { ensureLane, newKeyState } from './action-menu';
import { el, q, setClass, setDisabled } from './dom';
import '../styles/path.css';
import { stageLocal } from './stage-nav';
import { anchorMode } from './anchor-mode';

const NS = 'http://www.w3.org/2000/svg';
const MAX_DOTS = 3000;

function setHiddenAttr(node: Element, hidden: boolean): void {
  if (node.hasAttribute('hidden') !== hidden) node.toggleAttribute('hidden', hidden);
}

function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

type Drag =
  | { kind: 'node'; id: string; frame: number; tag: string; pointer: number }
  | { kind: 'handle'; id: string; frame: number; side: 'in' | 'out'; tag: string; pointer: number }
  | {
      kind: 'pivot'; id: string; tag: string; pointer: number; x0: number; y0: number; alt: boolean; keyed: boolean;
      base: { px: number; py: number; x: number; y: number; sx: number; sy: number; rot: number };
    };

/** Move's pose of a content as the Stage shows it: animated in Keyframe mode, the plain transform in Compose. */
function basis(c: Content, keyed: boolean, local: number): { px: number; py: number; x: number; y: number; sx: number; sy: number; rot: number } {
  if (keyed) {
    const a = animate(c, local);
    return { px: a.px ?? 0, py: a.py ?? 0, x: a.x, y: a.y, sx: a.scaleX * (a.flipH ? -1 : 1), sy: a.scaleY * (a.flipV ? -1 : 1), rot: a.rotation };
  }
  const t = c.transform;
  return { px: c.pivot?.x ?? 0, py: c.pivot?.y ?? 0, x: t.x, y: t.y, sx: t.scale * (t.flipH ? -1 : 1), sy: t.scale * (t.flipV ? -1 : 1), rot: t.rotation };
}

export class PathView {
  readonly root = el(`<svg class="fm-path-ov" hidden aria-label="Motion path">
    <path class="fm-path-curve"/>
    <path class="fm-path-dots"/>
    <g class="fm-path-hs" hidden>
      <line class="fm-path-hl" data-s="in"/><line class="fm-path-hl" data-s="out"/>
      <circle class="fm-path-h" data-s="in" r="5"/><circle class="fm-path-h" data-s="out" r="5"/>
    </g>
    <g class="fm-path-keys"></g>
  </svg>`) as unknown as SVGSVGElement;
  readonly pivotRoot = el(`<svg class="fm-pivot-ov" hidden aria-label="Pivot">
    <g class="fm-pivot-sectors"></g>
    <g class="fm-pivot"><circle class="fm-pivot-ring" r="8"/><path class="fm-pivot-cross" d="M-13 0H13M0 -13V13"/><circle class="fm-pivot-hit" r="14"/></g>
  </svg>`) as unknown as SVGSVGElement;
  readonly bar = el(`<div class="fm-path-bar" hidden>
    <button type="button" class="fm-path-btn" data-a="smooth" title="Curve the whole path through its keys">Smooth path</button>
    <button type="button" class="fm-path-btn" data-a="corner" title="Alt-click a key square">Corner point</button>
    <button type="button" class="fm-path-btn" data-a="linear" title="Straight on both sides of the key">Linear path</button>
  </div>`);

  readonly anchorBar = el(`<div class="fm-anchor-bar" hidden><span>Edit anchor</span><button type="button" class="fm-path-btn is-on" data-a="done">Done</button></div>`);
  /** Set by the Stage: the nine sector points (pivot units) of a content's box. */
  sectors: ((c: Content) => Array<[number, number]> | null) | null = null;
  private readonly sectorDots = q(this.pivotRoot as unknown as HTMLElement, '.fm-pivot-sectors') as unknown as SVGGElement;
  private readonly curve = q(this.root as unknown as HTMLElement, '.fm-path-curve') as unknown as SVGPathElement;
  private readonly dots = q(this.root as unknown as HTMLElement, '.fm-path-dots') as unknown as SVGPathElement;
  private readonly keys = q(this.root as unknown as HTMLElement, '.fm-path-keys') as unknown as SVGGElement;
  private readonly hs = q(this.root as unknown as HTMLElement, '.fm-path-hs') as unknown as SVGGElement;
  private readonly pv = q(this.pivotRoot as unknown as HTMLElement, '.fm-pivot') as unknown as SVGGElement;
  private readonly squares: SVGRectElement[] = [];
  private view: View | null = null;
  private drag: Drag | null = null;
  private selFrame: number | null = null;
  /** What the drawn curve and dots were built from, so a sync with nothing changed touches nothing. */
  private sig = '';
  private box = '';
  private nodes: PathNode[] = [];

  constructor(host: HTMLElement, private readonly engine: Engine) {
    host.append(this.root, this.pivotRoot);
    // the bar sits on the Stage itself, not in the space that turns with a rotated view
    (host.parentElement ?? host).append(this.bar, this.anchorBar);
    this.anchorBar.addEventListener('click', () => anchorMode.stop());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && anchorMode.on) { anchorMode.stop(); e.stopPropagation(); } }, true);
    for (const r of [this.root, this.pivotRoot]) {
      r.addEventListener('pointerdown', (e) => {
        // the Stage keeps keyboard focus (arrow nudges) when the press lands on the pivot or a path node
        (host.closest('[tabindex="0"]') as HTMLElement | null)?.focus({ preventScroll: true });
        this.down(e);
      });
      r.addEventListener('pointermove', (e) => this.move(e));
      r.addEventListener('pointerup', (e) => this.up(e));
      r.addEventListener('pointercancel', (e) => this.up(e));
      r.addEventListener('lostpointercapture', (e) => this.up(e));
    }
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('button');
      if (b) this.action(b.dataset.a ?? '');
    });
    engine.on('selection', () => { this.selFrame = null; if (anchorMode.on && this.engine.selection.content[0] !== anchorMode.id) anchorMode.stop(); });
  }

  get dragging(): boolean { return !!this.drag; }

  private target(): { c: Content; local: number } | null {
    const sel = this.engine.selected.filter((c) => this.engine.isOver(c));
    if (sel.length !== 1) return null;
    return { c: sel[0], local: this.engine.frame - sel[0].start };
  }

  /** Place both overlays for this draw. */
  sync(view: View | null, sel: Content[]): void {
    const mode = this.engine.mode;
    const c = sel.length === 1 ? sel[0] : null;
    const m = this.engine.movie;
    if (!m || !view || !c || mode === 'perform' || c.kind === 'audio') {
      this.hideAll();
      this.view = null;
      return;
    }
    this.view = view;
    this.placePost(m, c, view);
    const keyed = mode !== 'compose';
    const local = this.engine.frame - c.start;
    const b = basis(c, keyed, local);
    const vb = `0 0 ${view.width} ${view.height}`;
    if (vb !== this.box) { this.root.setAttribute('viewBox', vb); this.pivotRoot.setAttribute('viewBox', vb); this.box = vb; }
    // pivot crosshair: where the pivot point sits on the Stage now
    const sx = view.ox + (m.width / 2 + b.px + b.x) * view.scale, sy = view.oy + (m.height / 2 + b.py + b.y) * view.scale;
    setHiddenAttr(this.pivotRoot, false);
    setAttr(this.pv, 'transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    this.syncAnchor(m, c, view, b.x, b.y);
    const lane = keyed ? laneOf(c, 'move') : null;
    const ls = lane ? laneSegments(lane) : null;
    if (!lane || !ls) {
      setHiddenAttr(this.root, true);
      setHiddenAttr(this.bar, true);
      this.nodes = [];
      return;
    }
    setHiddenAttr(this.root, false);
    setHiddenAttr(this.bar, false);
    this.nodes = ls.nodes;
    const ox = view.ox + (m.width / 2 + b.px) * view.scale, oy = view.oy + (m.height / 2 + b.py) * view.scale;
    const k = view.scale;
    const sig = `${c.id}|${lane.channels.x.length}|${lane.channels.y.length}|${ls.auto}|${view.scale}|${view.ox}|${view.oy}|${b.px}|${b.py}`;
    const same = sig === this.sig && lane.channels.x === this.lastX && lane.channels.y === this.lastY;
    if (!same) {
      this.sig = sig;
      this.lastX = lane.channels.x;
      this.lastY = lane.channels.y;
      let d = '';
      for (let i = 0; i + 1 < ls.nodes.length; i++) {
        const a = ls.nodes[i], n = ls.nodes[i + 1];
        const seg = ls.seg(i);
        d += `M${(ox + a.x * k).toFixed(1)} ${(oy + a.y * k).toFixed(1)}`;
        if (seg) d += `C${(ox + seg.p[1][0] * k).toFixed(1)} ${(oy + seg.p[1][1] * k).toFixed(1)} ${(ox + seg.p[2][0] * k).toFixed(1)} ${(oy + seg.p[2][1] * k).toFixed(1)} ${(ox + n.x * k).toFixed(1)} ${(oy + n.y * k).toFixed(1)}`;
        else d += `L${(ox + n.x * k).toFixed(1)} ${(oy + n.y * k).toFixed(1)}`;
      }
      setAttr(this.curve, 'd', d);
      let dd = '';
      const first = ls.nodes[0].frame, last = ls.nodes[ls.nodes.length - 1].frame;
      const step = Math.max(1, Math.ceil((last - first + 1) / MAX_DOTS));
      for (let f = first; f <= last; f += step) {
        const v = evalLane(c, lane, f);
        dd += `M${(ox + v.x * k).toFixed(1)} ${(oy + v.y * k).toFixed(1)}h0`;
      }
      setAttr(this.dots, 'd', dd);
    }
    // key squares: grown on demand, never rebuilt
    while (this.squares.length < ls.nodes.length) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('class', 'fm-path-key');
      r.setAttribute('width', '9');
      r.setAttribute('height', '9');
      this.keys.appendChild(r);
      this.squares.push(r);
    }
    const cur = this.currentFrame(local);
    for (let i = 0; i < this.squares.length; i++) {
      const r = this.squares[i];
      const n = ls.nodes[i];
      if (!n) { setHiddenAttr(r, true); continue; }
      setHiddenAttr(r, false);
      setAttr(r, 'x', (ox + n.x * k - 4.5).toFixed(1));
      setAttr(r, 'y', (oy + n.y * k - 4.5).toFixed(1));
      setAttr(r, 'data-f', String(n.frame));
      setClass(r as unknown as HTMLElement, 'is-sel', n.frame === cur);
      setClass(r as unknown as HTMLElement, 'is-now', n.frame === local);
    }
    // handles of the selected key
    const si = cur === null ? -1 : ls.nodes.findIndex((n) => n.frame === cur);
    if (si < 0) setHiddenAttr(this.hs, true);
    else {
      const n = ls.nodes[si];
      const h = pathOps.pathView(c)?.handles[si];
      if (!h) setHiddenAttr(this.hs, true);
      else {
        setHiddenAttr(this.hs, false);
        const nx = ox + n.x * k, ny = oy + n.y * k;
        (['in', 'out'] as const).forEach((s) => {
          const hx = nx + h[s][0] * k, hy = ny + h[s][1] * k;
          const line = this.hs.querySelector(`line[data-s="${s}"]`) as Element, dot = this.hs.querySelector(`circle[data-s="${s}"]`) as Element;
          // an end key has no handle on its open side
          const open = (s === 'in' && si === 0) || (s === 'out' && si === ls.nodes.length - 1);
          setHiddenAttr(line, open);
          setHiddenAttr(dot, open);
          setAttr(line, 'x1', nx.toFixed(1)); setAttr(line, 'y1', ny.toFixed(1));
          setAttr(line, 'x2', hx.toFixed(1)); setAttr(line, 'y2', hy.toFixed(1));
          setAttr(dot, 'cx', hx.toFixed(1)); setAttr(dot, 'cy', hy.toFixed(1));
        });
      }
    }
    // toolbar state
    const mode2 = cur === null ? null : pathOps.nodeMode(c, cur);
    const btn = (a: string): HTMLButtonElement => this.bar.querySelector(`[data-a="${a}"]`) as HTMLButtonElement;
    setClass(btn('smooth'), 'is-on', smoothPathOn(lane));
    setClass(btn('corner'), 'is-on', mode2 === 'corner');
    setClass(btn('linear'), 'is-on', mode2 === 'linear');
    setDisabled(btn('corner'), mode2 === null);
    setDisabled(btn('linear'), mode2 === null);
  }

  /** Edit anchor: nine sector dots around the box, the Done bar, a bolder crosshair. Dots are grown once and patched. */
  private syncAnchor(m: Movie, c: Content, view: View, bx: number, by: number): void {
    const on = anchorMode.on && anchorMode.id === c.id;
    setClass(this.pv as unknown as HTMLElement, 'is-editing', on);
    setHiddenAttr(this.anchorBar, !on);
    setHiddenAttr(this.sectorDots, !on);
    if (!on) return;
    const pts = this.sectors?.(c) ?? [];
    while (this.sectorDotEls.length < 9) {
      const d = document.createElementNS(NS, 'circle');
      d.setAttribute('r', '4');
      d.setAttribute('class', 'fm-pivot-sector');
      this.sectorDots.appendChild(d);
      this.sectorDotEls.push(d);
    }
    this.sectorDotEls.forEach((d, i) => {
      const p = pts[i];
      if (!p) { setHiddenAttr(d, true); return; }
      setHiddenAttr(d, false);
      setAttr(d, 'cx', (view.ox + (m.width / 2 + p[0] + bx) * view.scale).toFixed(1));
      setAttr(d, 'cy', (view.oy + (m.height / 2 + p[1] + by) * view.scale).toFixed(1));
    });
  }

  private readonly sectorDotEls: SVGCircleElement[] = [];
  private lastX: unknown = null;
  private lastY: unknown = null;

  /** The key frame whose handles show: the one picked, else the one under the Playhead. */
  private currentFrame(local: number): number | null {
    if (this.selFrame !== null && this.nodes.some((n) => n.frame === this.selFrame)) return this.selFrame;
    return this.nodes.some((n) => n.frame === local) ? local : null;
  }

  private hideAll(): void {
    setHiddenAttr(this.root, true);
    setHiddenAttr(this.pivotRoot, true);
    setHiddenAttr(this.bar, true);
    setHiddenAttr(this.anchorBar, true);
  }

  private local(e: PointerEvent): [number, number] {
    const p = stageLocal(e);
    // the overlays are drawn in the content's own (unparented) space and moved by `post`: map the pointer back into it
    const inv = this.post ? invert(this.post) : null;
    return inv ? apply(inv, p[0], p[1]) : p;
  }

  /** Stage pixels to Stage pixels: the parents' and the camera's transform around this content, or null. */
  private post: Mat | null = null;

  private placePost(m: Movie, c: Content, view: View): void {
    const pm = postMatrix(m, c, this.engine.frame, false, 0);
    const vm = viewMat(view), vi = invert(vm);
    this.post = pm && vi ? mul(mul(vm, pm), vi) : null;
    const css = this.post ? `matrix(${this.post.map((v) => v.toFixed(5)).join(',')})` : '';
    for (const s of [this.root, this.pivotRoot] as unknown as HTMLElement[]) {
      if (s.style.transform !== css) { s.style.transformOrigin = '0 0'; s.style.transform = css; }
    }
  }

  private action(a: string): void {
    const t = this.target();
    if (!t) return;
    const { c, local } = t;
    const cur = this.currentFrame(local);
    if (a === 'smooth') {
      const lane = laneOf(c, 'move');
      if (lane) this.engine.run('Smooth Path', (m) => ops.updateContent(m, c.id, (cc) => keyOps.setLaneOption(cc, 'move', 'path', !smoothPathOn(lane))));
    } else if (cur !== null && a === 'corner') {
      this.engine.run('Corner Point', (m) => ops.updateContent(m, c.id, (cc) => pathOps.toggleCorner(cc, cur)));
    } else if (cur !== null && a === 'linear') {
      const on = pathOps.nodeMode(c, cur) !== 'linear';
      this.engine.run('Linear Path', (m) => ops.updateContent(m, c.id, (cc) => pathOps.setLinear(cc, cur, on)));
    }
  }

  private down(e: PointerEvent): void {
    const m = this.engine.movie, v = this.view, t = this.target();
    if (!m || !v || !t || e.button !== 0 || this.drag) return;
    const tg = e.target as Element;
    const tag = `path-${Date.now()}`;
    if (tg.classList.contains('fm-pivot-hit')) {
      const keyed = this.engine.mode !== 'compose';
      const [x0, y0] = this.local(e);
      this.drag = { kind: 'pivot', id: t.c.id, tag, pointer: e.pointerId, x0, y0, alt: e.altKey, keyed, base: basis(t.c, keyed, t.local) };
    } else if (tg.classList.contains('fm-path-key')) {
      const frame = Number(tg.getAttribute('data-f'));
      this.selFrame = frame;
      if (e.altKey) {
        this.engine.run('Corner Point', (mv) => ops.updateContent(mv, t.c.id, (cc) => pathOps.toggleCorner(cc, frame)));
        e.preventDefault();
        return;
      }
      this.drag = { kind: 'node', id: t.c.id, frame, tag, pointer: e.pointerId };
    } else if (tg.classList.contains('fm-path-h')) {
      const cur = this.currentFrame(t.local);
      if (cur === null) return;
      this.drag = { kind: 'handle', id: t.c.id, frame: cur, side: tg.getAttribute('data-s') === 'in' ? 'in' : 'out', tag, pointer: e.pointerId };
    } else return;
    tg.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  private move(e: PointerEvent): void {
    const d = this.drag, m = this.engine.movie, v = this.view;
    if (!d || !m || !v || e.pointerId !== d.pointer) return;
    const [x, y] = this.local(e);
    const found = locate(m, d.id);
    if (!found) return;
    const c = found.content;
    if (d.kind === 'pivot') {
      const dx = (x - d.x0) / v.scale, dy = (y - d.y0) / v.scale;
      const b = d.base;
      const alt = d.alt || e.altKey;
      let npx = Math.round(b.px + dx), npy = Math.round(b.py + dy);
      if (anchorMode.on && anchorMode.id === d.id && !e.shiftKey) {
        // snap to the nearest of the nine sectors when within reach
        let best: [number, number] | null = null, bd = 18 / v.scale;
        for (const p of this.sectors?.(c) ?? []) { const dd = Math.hypot(p[0] - (b.px + dx), p[1] - (b.py + dy)); if (dd < bd) { bd = dd; best = p; } }
        if (best) { npx = Math.round(best[0]); npy = Math.round(best[1]); }
      }
      let nx = b.x, ny = b.y;
      if (alt) {
        // keep the picture still: pos' = pos + (I - M)(P - P'), M = rotation * scale
        const r = (b.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
        const ex = npx - b.px, ey = npy - b.py;
        const mx = (cos * b.sx) * ex - (sin * b.sy) * ey, my = (sin * b.sx) * ex + (cos * b.sy) * ey;
        nx = Math.round(b.x - ex + mx);
        ny = Math.round(b.y - ey + my);
      }
      if (d.keyed) {
        const local = this.engine.frame - c.start;
        const ease = newKeyState().lastEase;
        const vals: Record<string, number> = { px: npx, py: npy };
        if (alt) { vals.x = nx; vals.y = ny; }
        this.engine.run('Move Pivot', (mv) => ops.updateContent(mv, d.id, (cc) => keyOps.setKeys(laneOf(cc, 'move') ? cc : ensureLane(cc, 'move', local, mv.addKeyAtStart, ease), 'move', local, vals)), d.tag);
      } else {
        this.engine.run('Move Pivot', (mv) => ops.updateContent(mv, d.id, (cc) => ({ ...cc, pivot: { x: npx, y: npy }, transform: alt ? { ...cc.transform, x: nx, y: ny } : cc.transform })), d.tag);
      }
      return;
    }
    const b = basis(c, true, this.engine.frame - c.start);
    const px = (x - v.ox) / v.scale - m.width / 2 - b.px, py = (y - v.oy) / v.scale - m.height / 2 - b.py;
    if (d.kind === 'node') {
      this.engine.run('Move Path Key', (mv) => ops.updateContent(mv, d.id, (cc) => pathOps.moveNode(cc, d.frame, px, py)), d.tag);
    } else {
      const n = this.nodes.find((q2) => q2.frame === d.frame);
      if (!n) return;
      const vec: [number, number] = [px - n.x, py - n.y];
      this.engine.run('Edit Path Curve', (mv) => ops.updateContent(mv, d.id, (cc) => pathOps.setHandle(cc, d.frame, d.side, vec)), d.tag);
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    this.engine.endGesture();
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* released */ }
  }
}
