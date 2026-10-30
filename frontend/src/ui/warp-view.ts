// Warp / Distort on the Stage: which of the two is being edited (set by the Action menu card), and the overlay
// that shows the mesh nodes or the 4 corners of the selected block. Dragging a handle writes a key at the
// Playhead (one undo step per drag); in Perform mode the drag plays the movie and records that handle's tracks.
import type { Engine } from '../engine/engine';
import type { View } from '../engine/render';
import * as keyOps from '../engine/key-ops';
import * as ops from '../engine/ops';
import { animate, evalLane, laneOf, warpSize, type Animated } from '../engine/keys';
import { applyTake, Recorder } from '../engine/perform';
import { DISTORT_IDS, contentRect, localToStage, stageToLocal, warpId, warpPoint, type Rect } from '../engine/warp-draw';
import type { Content } from '../engine/types';
import { el } from './dom';

/** SVG nodes have no `hidden` property, so the attribute is toggled directly. */
function setHidden(node: Element, hidden: boolean): void {
  if (node.hasAttribute('hidden') !== hidden) node.toggleAttribute('hidden', hidden);
}
import { ensureLane, newKeyState } from './action-menu';
import { perform } from './perform-ui';
import '../styles/warp.css';

export type WarpKind = 'warp' | 'distort';

type Listener = () => void;

/** Which of Warp and Distort the Stage is showing handles for; null when neither. */
class WarpMode {
  kind: WarpKind | null = null;
  /** The block it was opened on: choosing another block ends it. */
  id: string | null = null;
  /** Merge tag of the lane the card just added in Perform mode: the first take joins it, so lane and take undo as one. */
  tag: string | null = null;
  private readonly subs = new Set<Listener>();

  set(kind: WarpKind | null, id: string | null = null): void {
    if (kind === this.kind && id === this.id) return;
    this.kind = kind;
    this.id = kind ? id : null;
    for (const fn of this.subs) fn();
  }

  onChange(fn: Listener): void { this.subs.add(fn); }
}

export const warpMode = new WarpMode();

const SAMPLES = 16;
const MAX_NODES = 6;
const CORNER_AT: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

interface Handle { row: number; col: number; ids: [string, string]; base: [number, number] }

/** Handles of a lane: Warp has a node per mesh point, Distort has its 4 corners (top left, top right, bottom right, bottom left). */
function handlesOf(kind: WarpKind, n: number, r0: Rect): Handle[] {
  if (kind === 'distort') {
    return CORNER_AT.map(([u, v], i) => ({ row: v, col: u, ids: [DISTORT_IDS[i * 2], DISTORT_IDS[i * 2 + 1]] as [string, string], base: [r0.x + u * r0.w, r0.y + v * r0.h] as [number, number] }));
  }
  const out: Handle[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push({ row: r, col: c, ids: [warpId(r, c, 'x'), warpId(r, c, 'y')], base: [r0.x + (c / (n - 1)) * r0.w, r0.y + (r / (n - 1)) * r0.h] });
  return out;
}

/** The content's values with the lane's raw offsets (zero offsets included), so handles show even at rest. */
function rawAnimated(c: Content, kind: WarpKind, local: number, vals: Record<string, number>, n: number): Animated {
  const a = animate(c, local);
  if (kind === 'distort') return { ...a, warp: null, distort: DISTORT_IDS.map((id) => vals[id] ?? 0) };
  const dx: number[] = [], dy: number[] = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) { dx.push(vals[warpId(r, k, 'x')] ?? 0); dy.push(vals[warpId(r, k, 'y')] ?? 0); }
  return { ...a, warp: { n, dx, dy }, distort: null };
}

interface Drag {
  id: string;
  kind: WarpKind;
  handle: Handle;
  vals: Record<string, number>;
  tag: string;
  pointer: number;
  rec?: { rec: Recorder; start: number; last: Record<string, number> | null };
}

export class WarpOverlay {
  readonly root: SVGSVGElement;
  private readonly lines: SVGPolylineElement[] = [];
  private readonly dots: SVGCircleElement[] = [];
  private readonly pt = [0, 0];
  private drag: Drag | null = null;
  private view: View | null = null;
  private offWrap: (() => void) | null = null;
  private box = '';

  constructor(host: HTMLElement, private readonly engine: Engine) {
    let inner = '';
    for (let i = 0; i < MAX_NODES * 2; i++) inner += '<polyline class="fm-warp-line"/>';
    for (let i = 0; i < MAX_NODES * MAX_NODES; i++) inner += `<circle class="fm-warp-h" r="6" data-i="${i}"/>`;
    this.root = el(`<svg class="fm-warp-ov" hidden aria-label="Warp handles">${inner}</svg>`) as unknown as SVGSVGElement;
    this.lines = Array.from(this.root.querySelectorAll('polyline'));
    this.dots = Array.from(this.root.querySelectorAll('circle'));
    host.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointermove', (e) => this.move(e));
    this.root.addEventListener('pointerup', (e) => this.up(e));
    this.root.addEventListener('pointercancel', (e) => this.up(e));
    // capture lost w/o a pointerup (the window lost focus): end the drag or take like a lift
    this.root.addEventListener('lostpointercapture', (e) => this.up(e));
    engine.on('selection', () => {
      const sel = engine.selected;
      if (warpMode.kind && !(sel.length === 1 && sel[0].id === warpMode.id)) warpMode.set(null);
    });
    engine.on('mode', (m) => { if (m === 'compose') warpMode.set(null); });
    engine.on('time', () => { const d = this.drag; if (d?.rec?.last && engine.playing) this.sample(d); });
  }

  get dragging(): boolean { return !!this.drag; }

  /** Place the overlay for this draw; true when it is showing (the move box stays hidden then). */
  sync(view: View | null, sel: Content[]): boolean {
    const m = this.engine.movie;
    const kind = warpMode.kind;
    const c = sel.length === 1 ? sel[0] : null;
    const lane = c && kind ? laneOf(c, kind) : null;
    if (!m || !view || !c || !kind || !lane || this.engine.mode === 'compose') {
      setHidden(this.root, true);
      this.view = null;
      return false;
    }
    this.view = view;
    setHidden(this.root, false);
    const box = `0 0 ${view.width} ${view.height}`;
    if (box !== this.box) { this.root.setAttribute('viewBox', box); this.box = box; }
    const local = this.engine.frame - c.start;
    const vals = evalLane(c, lane, local);
    const n = kind === 'warp' ? warpSize(lane) : 2;
    const a = rawAnimated(c, kind, local, vals, n);
    const rect = contentRect(c, m);
    const o = this.pt;
    const place = (u: number, v: number): [number, number] => {
      warpPoint(a, rect, u, v, o);
      localToStage(a, m.width, m.height, o[0], o[1], o);
      return [view.ox + o[0] * view.scale, view.oy + o[1] * view.scale];
    };
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const row = i < MAX_NODES, k = row ? i : i - MAX_NODES;
      if (k >= n) { setHidden(line, true); continue; }
      setHidden(line, false);
      const t = k / (n - 1);
      let pts = '';
      for (let s = 0; s <= SAMPLES; s++) {
        const [x, y] = row ? place(s / SAMPLES, t) : place(t, s / SAMPLES);
        pts += `${x.toFixed(1)},${y.toFixed(1)} `;
      }
      line.setAttribute('points', pts);
    }
    const hs = handlesOf(kind, n, rect);
    for (let i = 0; i < this.dots.length; i++) {
      const dot = this.dots[i];
      if (i >= hs.length) { setHidden(dot, true); continue; }
      setHidden(dot, false);
      const [x, y] = place(hs[i].col / (n > 1 && kind === 'warp' ? n - 1 : 1), hs[i].row / (n > 1 && kind === 'warp' ? n - 1 : 1));
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
    }
    return true;
  }

  private target(): { c: Content; kind: WarpKind } | null {
    const kind = warpMode.kind;
    const sel = this.engine.selected;
    return kind && sel.length === 1 && this.engine.isOver(sel[0]) ? { c: sel[0], kind } : null;
  }

  private down(e: PointerEvent): void {
    const dot = e.target as Element;
    const m = this.engine.movie, t = this.target();
    if (!m || !t || e.button !== 0 || this.drag || !dot.classList.contains('fm-warp-h')) return;
    const lane = laneOf(t.c, t.kind);
    if (!lane) return;
    const n = t.kind === 'warp' ? warpSize(lane) : 2;
    const handle = handlesOf(t.kind, n, contentRect(t.c, m))[Number(dot.getAttribute('data-i'))];
    if (!handle) return;
    const vals = evalLane(t.c, lane, this.engine.frame - t.c.start);
    this.drag = { id: t.c.id, kind: t.kind, handle, vals, tag: `warp-${Date.now()}`, pointer: e.pointerId };
    (dot as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
    if (this.engine.mode === 'perform') this.beginRec(this.drag, t.c);
  }

  /** Perform mode: the drag plays the movie from the Playhead and records this handle's two tracks. */
  private beginRec(d: Drag, c: Content): void {
    d.rec = { rec: new Recorder(d.kind, [...d.handle.ids]), start: c.start, last: null };
    if (warpMode.tag) { d.tag = warpMode.tag; warpMode.tag = null; }
    perform.setRecording(true);
    this.offWrap?.();
    this.offWrap = this.engine.on('wrap', () => {
      const last = (this.engine.movie?.duration ?? 1) - 1;
      this.engine.stop();
      queueMicrotask(() => this.engine.seek(last));
    });
    this.engine.play();
  }

  private move(e: PointerEvent): void {
    const d = this.drag, m = this.engine.movie, v = this.view;
    if (!d || !m || !v || e.pointerId !== d.pointer) return;
    const found = this.engine.selected.find((c) => c.id === d.id);
    if (!found) return;
    const r = this.root.getBoundingClientRect();
    const sx = (e.clientX - r.left - v.ox) / v.scale, sy = (e.clientY - r.top - v.oy) / v.scale;
    const a = animate(found, this.engine.frame - found.start);
    const p = [0, 0];
    stageToLocal(a, m.width, m.height, sx, sy, p);
    const [ix, iy] = d.handle.ids;
    const ox = Math.round((p[0] - d.handle.base[0]) * 10) / 10, oy = Math.round((p[1] - d.handle.base[1]) * 10) / 10;
    if (d.rec) {
      d.rec.last = { [ix]: ox, [iy]: oy };
      this.sample(d);
      return;
    }
    const local = this.engine.frame - found.start;
    if (local < 0 || local >= found.duration) return;
    const ease = newKeyState().lastEase;
    const values = { ...d.vals, [ix]: ox, [iy]: oy };
    this.engine.run(d.kind === 'warp' ? 'Warp Keyframe' : 'Distort Keyframe', (mv) => ops.updateContent(mv, d.id, (c) => keyOps.setKeys(laneOf(c, d.kind) ? c : ensureLane(c, d.kind, local, mv.addKeyAtStart, ease), d.kind, local, values)), d.tag);
  }

  private sample(d: Drag): void {
    const r = d.rec;
    if (!r?.last) return;
    r.rec.add(this.engine.frame - r.start, r.last);
    this.commit(d, 0);
  }

  private commit(d: Drag, filtering: number): void {
    const r = d.rec;
    if (!r) return;
    const take = r.rec.finish(filtering);
    if (!take) return;
    const ease = newKeyState().lastEase;
    const at = Math.max(0, Math.round(take.from));
    this.engine.run(d.kind === 'warp' ? 'Perform Warp' : 'Perform Distort', (mv) => ops.updateContent(mv, d.id, (c) => applyTake(laneOf(c, d.kind) ? c : ensureLane(c, d.kind, at, mv.addKeyAtStart, ease), take, 'linear')), d.tag);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (d.rec) {
      this.offWrap?.();
      this.offWrap = null;
      if (d.rec.last) d.rec.rec.add(this.engine.frame - d.rec.start, d.rec.last);
      this.engine.stop();
      this.commit(d, perform.filtering);
      perform.setRecording(false);
    }
    this.engine.endGesture();
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* released */ }
  }
}
