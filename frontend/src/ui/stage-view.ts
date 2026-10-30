import type { Engine } from '../engine/engine';
import { end, locate } from '../engine/model';
import * as ops from '../engine/ops';
import { fitView, type Renderer, type View } from '../engine/render';
import * as keyOps from '../engine/key-ops';
import { animate, laneOf } from '../engine/keys';
import type { Content, Movie } from '../engine/types';
import { ensureLane, newKeyState } from './action-menu';
import { el, q, setClass, setText } from './dom';
import { PerformBanner, perform } from './perform-ui';
import { applyTake, Recorder } from '../engine/perform';
import { WarpOverlay, warpMode } from './warp-view';

/** Where a content sits on the Stage: its transform, or its animated values in Keyframe and Perform modes. */
interface Pose { x: number; y: number; sx: number; sy: number; rot: number }

/** A Perform gesture in flight: what is recorded, and the pen twist so far. */
interface Rec {
  id: string;
  rec: Recorder;
  start: number;
  last: Record<string, number> | null;
  twist: number | null;
  twistSum: number;
  /** Rotation channel joins the take once the pen has twisted. */
  twisted: boolean;
}

type Grab =
  | { kind: 'move'; x0: number; y0: number; ids: string[]; base: Map<string, Pose>; tag: string; rec?: Rec }
  | { kind: 'scale'; id: string; base: Pose; d0: number; tag: string; rec?: Rec }
  | { kind: 'rotate'; id: string; base: Pose; a0: number; tag: string; rec?: Rec };

const MOVE_CHANNELS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];

const SNAP_PX = 8;

export class StageView {
  readonly root = el(`<div class="fm-stage" aria-label="Stage">
    <canvas class="fm-stage-canvas"></canvas>
    <svg class="fm-stage-box" hidden><polygon class="fm-box-line"/><line class="fm-box-stem"/><circle class="fm-box-rot" r="6"/><circle class="fm-box-h" data-h="0" r="5"/><circle class="fm-box-h" data-h="1" r="5"/><circle class="fm-box-h" data-h="2" r="5"/><circle class="fm-box-h" data-h="3" r="5"/><line class="fm-snap-v"/><line class="fm-snap-h"/></svg>
    <div class="fm-timecode"></div>
    <div class="fm-stage-empty" hidden></div>
  </div>`);

  private readonly canvas = q<HTMLCanvasElement>(this.root, '.fm-stage-canvas');
  private readonly box = q(this.root, '.fm-stage-box') as unknown as SVGSVGElement;
  private readonly tc = q(this.root, '.fm-timecode');
  private readonly banner: PerformBanner;
  private readonly warp: WarpOverlay;
  private view: View | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private req = 0;
  private grab: Grab | null = null;
  private grabPointer = -1;
  private offWrap: (() => void) | null = null;
  private bg = '#0a0a0a';

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer) {
    host.appendChild(this.root);
    new ResizeObserver(() => this.resize()).observe(this.root);
    for (const ev of ['movie', 'time', 'selection', 'projects'] as const) engine.on(ev, () => this.schedule());
    this.banner = new PerformBanner(engine);
    this.root.appendChild(this.banner.root);
    this.warp = new WarpOverlay(this.root, engine);
    warpMode.onChange(() => this.schedule());
    engine.on('mode', () => { this.cancelRecording(); this.schedule(); });
    engine.on('time', () => this.sampleHold());
    document.addEventListener('nm:ui-settings-changed', () => { this.readColours(); this.schedule(); });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.box.addEventListener('pointerdown', (e) => this.down(e));
    for (const t of [this.canvas, this.box] as Element[]) {
      t.addEventListener('pointermove', (e) => this.move(e as PointerEvent));
      t.addEventListener('pointerup', (e) => this.up(e as PointerEvent));
      t.addEventListener('pointercancel', (e) => this.up(e as PointerEvent));
    }
    this.readColours();
  }

  private readColours(): void {
    const s = getComputedStyle(this.root);
    this.bg = s.getPropertyValue('--fm-stage-bg').trim() || '#0a0a0a';
    const a = s.getPropertyValue('--fm-checker-a').trim() || '#2a2a2e';
    const b = s.getPropertyValue('--fm-checker-b').trim() || '#1e1e22';
    const tile = new OffscreenCanvas(16, 16);
    const c = tile.getContext('2d') as OffscreenCanvasRenderingContext2D;
    c.fillStyle = a; c.fillRect(0, 0, 16, 16);
    c.fillStyle = b; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8);
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.pattern = ctx.createPattern(tile, 'repeat');
  }

  private pattern: CanvasPattern | null = null;

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w; this.height = h; this.dpr = dpr;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.box.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.draw();
  }

  schedule(): void {
    if (this.req) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); });
  }

  private draw(): void {
    const m = this.engine.movie;
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    if (!m || this.width <= 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      hideSvg(this.box, true);
      setText(this.tc, '');
      return;
    }
    const view = fitView(m, this.canvas.width, this.canvas.height, 0.05);
    this.renderer.drawFrame(ctx, m, this.engine.frame, view, { backstage: true, background: this.bg, transparentChecker: this.pattern });
    this.view = { scale: view.scale / this.dpr, ox: view.ox / this.dpr, oy: view.oy / this.dpr, width: this.width, height: this.height };
    setText(this.tc, stamp(this.engine.frame, m.fps));
    this.drawBox(m);
  }

  private keyed(): boolean { return this.engine.mode !== 'compose'; }

  private pose(c: Content): Pose {
    if (this.keyed()) {
      const a = animate(c, this.engine.frame - c.start);
      return { x: a.x, y: a.y, sx: a.scaleX, sy: a.scaleY, rot: a.rotation };
    }
    const t = c.transform;
    return { x: t.x, y: t.y, sx: t.scale, sy: t.scale, rot: t.rotation };
  }

  /** Write Move keys at the Playhead for each content (creating the lane the first time). */
  private writeKeys(label: string, ids: string[], vals: (id: string) => Record<string, number>, tag: string): void {
    const f = this.engine.frame;
    const ease = newKeyState().lastEase;
    this.engine.run(label, (mv) => {
      let out = mv;
      for (const id of ids) {
        const at = locate(out, id);
        if (!at) continue;
        const local = f - at.content.start;
        if (local < 0 || local >= at.content.duration) continue;
        out = ops.updateContent(out, id, (c) => keyOps.setKeys(laneOf(c, 'move') ? c : ensureLane(c, 'move', local, mv.addKeyAtStart, ease), 'move', local, vals(id)));
      }
      return out;
    }, tag);
  }

  private corners(m: Movie, c: Content): [number, number][] {
    const v = this.view as View;
    const t = this.pose(c);
    const size = this.extent(m, c);
    const cx = v.ox + (m.width / 2 + t.x) * v.scale, cy = v.oy + (m.height / 2 + t.y) * v.scale;
    const hw = (size.w / 2) * t.sx * v.scale, hh = (size.h / 2) * t.sy * v.scale;
    const a = (t.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
  }

  private extent(m: Movie, c: Content): { w: number; h: number } {
    if (c.kind === 'image' && c.asset && m.assets[c.asset]) return { w: m.assets[c.asset].width, h: m.assets[c.asset].height };
    if (c.kind === 'text' && c.text) {
      const lines = c.text.text.split('\n');
      const longest = Math.max(...lines.map((l) => l.length));
      return { w: Math.min(m.width * 0.8, Math.max(c.text.size, longest * c.text.size * 0.56)), h: lines.length * c.text.size * 1.2 };
    }
    return { w: m.width, h: m.height };
  }

  private drawBox(m: Movie): void {
    const sel = this.engine.selected.filter((c) => this.engine.isOver(c));
    const handles = this.warp.sync(this.view, sel);
    const show = sel.length === 1 && !!this.view && !handles;
    hideSvg(this.box, !show);
    setClass(this.box as unknown as HTMLElement, 'is-keyed', this.keyed());
    if (!show) return;
    const pts = this.corners(m, sel[0]);
    q(this.box as unknown as HTMLElement, '.fm-box-line').setAttribute('points', pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '));
    const hs = Array.from(this.box.querySelectorAll('.fm-box-h'));
    pts.forEach((p, i) => { hs[i].setAttribute('cx', p[0].toFixed(1)); hs[i].setAttribute('cy', p[1].toFixed(1)); });
    const top = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
    const len = Math.hypot(top[0] - cx, top[1] - cy) || 1;
    const rx = top[0] + ((top[0] - cx) / len) * 26, ry = top[1] + ((top[1] - cy) / len) * 26;
    const stem = q(this.box as unknown as HTMLElement, '.fm-box-stem');
    stem.setAttribute('x1', top[0].toFixed(1)); stem.setAttribute('y1', top[1].toFixed(1));
    stem.setAttribute('x2', rx.toFixed(1)); stem.setAttribute('y2', ry.toFixed(1));
    const rot = q(this.box as unknown as HTMLElement, '.fm-box-rot');
    rot.setAttribute('cx', rx.toFixed(1)); rot.setAttribute('cy', ry.toFixed(1));
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.root.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent): void {
    const m = this.engine.movie;
    const v = this.view;
    // one gesture at a time: a second finger or pen must not orphan the first grab (or its Perform take)
    if (!m || !v || e.button !== 0 || this.grab) return;
    const [x, y] = this.local(e);
    const target = e.target as Element;
    const sel = this.engine.selected.filter((c) => this.engine.isOver(c));
    const tag = `stage-${Date.now()}`;
    if (sel.length === 1 && target.classList.contains('fm-box-rot')) {
      const c = sel[0], p = this.pose(c), cx = v.ox + (m.width / 2 + p.x) * v.scale, cy = v.oy + (m.height / 2 + p.y) * v.scale;
      this.grab = { kind: 'rotate', id: c.id, base: p, a0: Math.atan2(y - cy, x - cx), tag };
    } else if (sel.length === 1 && target.classList.contains('fm-box-h')) {
      const c = sel[0], p = this.pose(c), cx = v.ox + (m.width / 2 + p.x) * v.scale, cy = v.oy + (m.height / 2 + p.y) * v.scale;
      this.grab = { kind: 'scale', id: c.id, base: p, d0: Math.hypot(x - cx, y - cy) || 1, tag };
    } else {
      const hitId = this.pick(m, x, y);
      if (hitId && !this.engine.selection.content.includes(hitId)) this.engine.select(e.shiftKey ? [...this.engine.selection.content, hitId] : [hitId]);
      // Perform keeps its one content when the pen lands off it: the take is a drag, not a click
      if (!hitId && !e.shiftKey && !(this.engine.mode === 'perform' && sel.length === 1)) { this.engine.select([]); return; }
      const ids = this.engine.selected.filter((c) => this.engine.isOver(c)).map((c) => c.id);
      if (!ids.length) return;
      const base = new Map(ids.map((id) => [id, this.pose((locate(m, id) as NonNullable<ReturnType<typeof locate>>).content)]));
      this.grab = { kind: 'move', x0: x, y0: y, ids, base, tag };
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.grabPointer = e.pointerId;
    e.preventDefault();
    this.beginRec(e);
  }

  /** Perform mode: a drag on one content records. The movie plays from the Playhead while the pen is down. */
  private beginRec(e: PointerEvent): void {
    const g = this.grab, m = this.engine.movie;
    if (!g || !m || this.engine.mode !== 'perform') return;
    const id = g.kind === 'move' ? (g.ids.length === 1 ? g.ids[0] : null) : g.id;
    const at = id ? locate(m, id) : null;
    if (!id || !at) return;
    g.rec = { id, rec: new Recorder('move', MOVE_CHANNELS), start: at.content.start, last: null, twist: e.pointerType === 'pen' ? e.twist : null, twistSum: 0, twisted: false };
    perform.setRecording(true);
    // a take ends at the movie's end: playback stops there instead of looping under the pen
    this.offWrap?.();
    this.offWrap = this.engine.on('wrap', () => {
      const last = (this.engine.movie?.duration ?? 1) - 1;
      this.engine.stop();
      queueMicrotask(() => this.engine.seek(last));
    });
    this.engine.play();
  }

  private recordMove(g: Grab, r: Rec, m: Movie, v: View, x: number, y: number, e: PointerEvent): void {
    if (e.pointerType === 'pen' && r.twist !== null && e.twist !== r.twist) {
      let d = e.twist - r.twist;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      r.twistSum += d;
      r.twisted = true;
    }
    if (e.pointerType === 'pen') r.twist = e.twist;
    const roll = r.twisted && perform.roll > 0 ? r.twistSum * perform.roll : 0;
    const vals: Record<string, number> = {};
    if (g.kind === 'move') {
      const b = g.base.get(g.ids[0]) as Pose;
      vals.x = Math.round(b.x + (x - g.x0) / v.scale);
      vals.y = Math.round(b.y + (y - g.y0) / v.scale);
      if (roll) vals.rotation = Math.round((b.rot + roll) * 10) / 10;
    } else if (g.kind === 'scale') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + b.x) * v.scale, cy = v.oy + (m.height / 2 + b.y) * v.scale;
      const ratio = Math.hypot(x - cx, y - cy) / g.d0;
      vals.scaleX = Math.round(Math.max(0.01, b.sx * ratio) * 1000) / 1000;
      vals.scaleY = Math.round(Math.max(0.01, b.sy * ratio) * 1000) / 1000;
      if (roll) vals.rotation = Math.round((b.rot + roll) * 10) / 10;
    } else {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + b.x) * v.scale, cy = v.oy + (m.height / 2 + b.y) * v.scale;
      vals.rotation = Math.round((b.rot + ((Math.atan2(y - cy, x - cx) - g.a0) * 180) / Math.PI + roll) * 10) / 10;
    }
    r.last = vals;
    this.sampleRec(g, r);
  }

  /** Add the latest values at the Playhead and show the take so far (unfiltered) under the pen. */
  private sampleRec(g: Grab, r: Rec): void {
    if (!r.last) return;
    r.rec.add(this.engine.frame - r.start, r.last);
    this.commitRec(g, r, 0);
  }

  private commitRec(g: Grab, r: Rec, filtering: number): void {
    const take = r.rec.finish(filtering);
    if (!take) return;
    const ease = newKeyState().lastEase;
    const at = Math.max(0, Math.round(take.from));
    this.engine.run('Perform Move and Scale', (mv) => ops.updateContent(mv, r.id, (c) => applyTake(laneOf(c, 'move') ? c : ensureLane(c, 'move', at, mv.addKeyAtStart, ease), take, 'linear')), g.tag);
  }

  /** A held pen still records: every Playhead step repeats the last position. */
  private sampleHold(): void {
    const g = this.grab;
    if (g?.rec?.last && this.engine.playing) this.sampleRec(g, g.rec);
  }

  private endRec(g: Grab): void {
    const r = g.rec;
    if (!r) return;
    g.rec = undefined;
    this.offWrap?.();
    this.offWrap = null;
    if (r.last) r.rec.add(this.engine.frame - r.start, r.last);
    this.engine.stop();
    this.commitRec(g, r, perform.filtering);
    perform.setRecording(false);
  }

  private cancelRecording(): void {
    const g = this.grab;
    if (!g?.rec) return;
    this.endRec(g);
    this.grab = null;
    this.engine.endGesture();
  }

  private pick(m: Movie, x: number, y: number): string | null {
    for (const t of m.tracks) {
      if (t.hidden) continue;
      const c = t.content.find((it) => this.engine.frame >= it.start && this.engine.frame < end(it));
      if (!c || c.kind === 'audio') continue;
      if (inside(this.corners(m, c), x, y)) return c.id;
    }
    return null;
  }

  private move(e: PointerEvent): void {
    const g = this.grab, m = this.engine.movie, v = this.view;
    if (!g || !m || !v || e.pointerId !== this.grabPointer) return;
    const [x, y] = this.local(e);
    if (g.rec) { this.recordMove(g, g.rec, m, v, x, y, e); return; }
    if (g.kind === 'move') {
      let dx = (x - g.x0) / v.scale, dy = (y - g.y0) / v.scale;
      const first = g.base.get(g.ids[0]) as Pose;
      let snapV: number | null = null, snapH: number | null = null;
      if (!e.altKey) {
        const tol = SNAP_PX / v.scale;
        const nx = first.x + dx, ny = first.y + dy;
        for (const target of [0, -m.width / 4, m.width / 4]) if (Math.abs(nx - target) < tol) { dx = target - first.x; snapV = target; break; }
        for (const target of [0, -m.height / 4, m.height / 4]) if (Math.abs(ny - target) < tol) { dy = target - first.y; snapH = target; break; }
      }
      this.snapLines(m, v, snapV, snapH);
      if (this.keyed()) {
        this.writeKeys('Move Keyframe', g.ids, (id) => { const b = g.base.get(id) as Pose; return { x: Math.round(b.x + dx), y: Math.round(b.y + dy), scaleX: b.sx, scaleY: b.sy, rotation: b.rot }; }, g.tag);
        return;
      }
      this.engine.run('Move', (mv) => {
        let out = mv;
        for (const id of g.ids) { const b = g.base.get(id) as Pose; out = ops.patchContent(out, [id], { transform: { x: Math.round(b.x + dx), y: Math.round(b.y + dy) } }); }
        return out;
      }, g.tag);
    } else if (g.kind === 'scale') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + b.x) * v.scale, cy = v.oy + (m.height / 2 + b.y) * v.scale;
      const ratio = Math.hypot(x - cx, y - cy) / g.d0;
      if (this.keyed()) {
        const sx = Math.round(Math.max(0.01, b.sx * ratio) * 1000) / 1000, sy = Math.round(Math.max(0.01, b.sy * ratio) * 1000) / 1000;
        this.writeKeys('Scale Keyframe', [g.id], () => ({ x: b.x, y: b.y, scaleX: sx, scaleY: sy, rotation: b.rot }), g.tag);
        return;
      }
      const k = Math.max(0.01, ratio * b.sx);
      this.engine.run('Scale', (mv) => ops.patchContent(mv, [g.id], { transform: { scale: Math.round(k * 1000) / 1000 } }), g.tag);
    } else {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + b.x) * v.scale, cy = v.oy + (m.height / 2 + b.y) * v.scale;
      let deg = b.rot + ((Math.atan2(y - cy, x - cx) - g.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      if (this.keyed()) {
        const r = Math.round(deg * 10) / 10;
        this.writeKeys('Rotate Keyframe', [g.id], () => ({ x: b.x, y: b.y, scaleX: b.sx, scaleY: b.sy, rotation: r }), g.tag);
        return;
      }
      deg = ((deg % 360) + 540) % 360 - 180;
      this.engine.run('Rotate', (mv) => ops.patchContent(mv, [g.id], { transform: { rotation: Math.round(deg * 10) / 10 } }), g.tag);
    }
  }

  private snapLines(m: Movie, v: View, sx: number | null, sy: number | null): void {
    const lv = q(this.box as unknown as HTMLElement, '.fm-snap-v'), lh = q(this.box as unknown as HTMLElement, '.fm-snap-h');
    setClass(lv as unknown as HTMLElement, 'is-on', sx !== null);
    setClass(lh as unknown as HTMLElement, 'is-on', sy !== null);
    if (sx !== null) { const px = v.ox + (m.width / 2 + sx) * v.scale; lv.setAttribute('x1', String(px)); lv.setAttribute('x2', String(px)); lv.setAttribute('y1', String(v.oy)); lv.setAttribute('y2', String(v.oy + m.height * v.scale)); }
    if (sy !== null) { const py = v.oy + (m.height / 2 + sy) * v.scale; lh.setAttribute('y1', String(py)); lh.setAttribute('y2', String(py)); lh.setAttribute('x1', String(v.ox)); lh.setAttribute('x2', String(v.ox + m.width * v.scale)); }
  }

  private up(e: PointerEvent): void {
    if (!this.grab || e.pointerId !== this.grabPointer) return;
    this.endRec(this.grab);
    this.grab = null;
    this.engine.endGesture();
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* released */ }
    const m = this.engine.movie, v = this.view;
    if (m && v) this.snapLines(m, v, null, null);
  }

  snapshot(width: number): Promise<Blob | null> {
    const m = this.engine.movie;
    if (!m) return Promise.resolve(null);
    const h = Math.max(1, Math.round((width * m.height) / m.width));
    const c = new OffscreenCanvas(width, h);
    const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
    this.renderer.drawFrame(ctx as unknown as CanvasRenderingContext2D, m, Math.min(this.engine.frame, m.duration - 1), { scale: width / m.width, ox: 0, oy: 0, width, height: h }, { backstage: false, background: m.background, transparentChecker: null });
    return c.convertToBlob({ type: 'image/png' }).catch(() => null);
  }
}

function hideSvg(node: SVGElement, hidden: boolean): void {
  if (node.hasAttribute('hidden') !== hidden) node.toggleAttribute('hidden', hidden);
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function stamp(frame: number, fps: number): string {
  const sec = Math.floor(frame / fps);
  const f = Math.round(frame - sec * fps);
  const h = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(h)}:${p(mm)}:${p(ss)}.${p(f, 3)}`;
}
