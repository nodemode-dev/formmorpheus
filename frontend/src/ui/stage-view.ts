import type { Engine } from '../engine/engine';
import { end, locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { Renderer, View } from '../engine/render';
import { StageNav } from './stage-nav';
import * as keyOps from '../engine/key-ops';
import { animate, laneOf } from '../engine/keys';
import type { Content, Movie } from '../engine/types';
import { ensureLane, newKeyState } from './action-menu';
import { el, q, setClass, setText } from './dom';
import { PerformBanner, perform } from './perform-ui';
import { applyTake, Recorder } from '../engine/perform';
import { WarpOverlay, warpMode } from './warp-view';
import { BonesOverlay, bonesMode } from './bones-view';
import { PathView } from './path-view';
import { mapPt, screenMat, stageMovie, unmapPt } from './stage-world';
import { CameraOverlay, cameraMode } from './camera-view';
import type { Mat } from '../engine/transform';
import * as tops from '../engine/transform-ops';
import { icon } from './icons';
import { StageBoxMenu } from './stage-box-menu';
import { boxOf, frameLines, snapAngle, snapBox, type Box } from './stage-snap';
import '../styles/stage-box.css';

/** Side node directions in handle order: top, right, bottom, left. */
const SIDES: ReadonlyArray<{ axis: 'x' | 'y'; sign: 1 | -1 }> = [{ axis: 'y', sign: -1 }, { axis: 'x', sign: 1 }, { axis: 'y', sign: 1 }, { axis: 'x', sign: -1 }];

/** Where a content sits on the Stage: its transform, or its animated values in Keyframe and Perform modes. */
interface Pose { x: number; y: number; sx: number; sy: number; rot: number; px?: number; py?: number; kx: number; ky: number; fx: 1 | -1; fy: 1 | -1 }

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
  | { kind: 'move'; x0: number; y0: number; ids: string[]; base: Map<string, Pose>; anchors: Map<string, { s: [number, number]; w: [number, number] }>; tag: string; rec?: Rec; snap?: { box: Box; xs: number[]; ys: number[] } }
  | { kind: 'scale'; id: string; base: Pose; d0: number; tag: string; rec?: Rec }
  | { kind: 'stretch'; id: string; base: Pose; axis: 'x' | 'y'; sign: 1 | -1; tag: string; rec?: undefined }
  | { kind: 'rotate'; id: string; base: Pose; a0: number; tag: string; rec?: Rec };

const MOVE_CHANNELS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];

const SNAP_PX = 8;

export class StageView {
  readonly root = el(`<div class="fm-stage" aria-label="Stage">
    <div class="fm-stage-space">
    <canvas class="fm-stage-canvas"></canvas>
    <svg class="fm-stage-box" hidden><polygon class="fm-box-line"/><line class="fm-box-stem"/><circle class="fm-box-rot" r="6"/><circle class="fm-box-h" data-h="0" r="5"/><circle class="fm-box-h" data-h="1" r="5"/><circle class="fm-box-h" data-h="2" r="5"/><circle class="fm-box-h" data-h="3" r="5"/><rect class="fm-box-s" data-s="0" x="-4" y="-4" width="8" height="8" rx="2"/><rect class="fm-box-s" data-s="1" x="-4" y="-4" width="8" height="8" rx="2"/><rect class="fm-box-s" data-s="2" x="-4" y="-4" width="8" height="8" rx="2"/><rect class="fm-box-s" data-s="3" x="-4" y="-4" width="8" height="8" rx="2"/><g class="fm-box-more"><title>Transform options</title><circle r="11"/><circle class="d" cx="-5" r="1.4"/><circle class="d" r="1.4"/><circle class="d" cx="5" r="1.4"/></g><line class="fm-snap-v"/><line class="fm-snap-h"/></svg>
    </div>
    <div class="fm-tc-bar"><div class="fm-timecode"></div><div class="fm-stage-undo"><button class="fm-stage-ubtn" type="button" data-cmd="undo" title="Undo" aria-label="Undo">${icon('undo', 14)}</button><button class="fm-stage-ubtn" type="button" data-cmd="redo" title="Redo" aria-label="Redo">${icon('redo', 14)}</button></div></div>
    <div class="fm-stage-empty" hidden></div>
  </div>`);

  private readonly space = q(this.root, '.fm-stage-space');
  private readonly canvas = q<HTMLCanvasElement>(this.root, '.fm-stage-canvas');
  /** The Stage view transform (zoom, pan, rotation, full-screen preview); everything on the Stage reads it. */
  readonly nav: StageNav;
  private outline = '#888';
  private rootW = 0;
  private rootH = 0;
  private spaceKey = '';
  private readonly box = q(this.root, '.fm-stage-box') as unknown as SVGSVGElement;
  private readonly tc = q(this.root, '.fm-timecode');
  private readonly banner: PerformBanner;
  private readonly warp: WarpOverlay;
  private readonly bones: BonesOverlay;
  private readonly paths: PathView;
  private readonly camera: CameraOverlay;
  private view: View | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private req = 0;
  private grab: Grab | null = null;
  private grabPointer = -1;
  private offWrap: (() => void) | null = null;
  private bg = '#0a0a0a';
  private readonly boxMenu: StageBoxMenu;
  private nudgeTimer = 0;

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer) {
    host.appendChild(this.root);
    this.nav = new StageNav(this.root, engine);
    this.nav.onChange = () => this.schedule();
    this.nav.isEmpty = (x, y) => { const m = this.engine.movie; return !!m && !!this.view && !this.pick(m, x, y); };
    this.boxMenu = new StageBoxMenu(engine, () => this.root.focus({ preventScroll: true }));
    this.root.tabIndex = 0;
    this.root.addEventListener('keydown', (e) => this.arrowKey(e));
    new ResizeObserver(() => this.resize()).observe(this.root);
    for (const ev of ['movie', 'time', 'selection', 'projects'] as const) engine.on(ev, () => this.schedule());
    this.banner = new PerformBanner(engine);
    this.root.appendChild(this.banner.root);
    this.warp = new WarpOverlay(this.space, engine);
    this.paths = new PathView(this.space, engine);
    this.camera = new CameraOverlay(this.space, engine);
    cameraMode.onChange(() => this.schedule());
    warpMode.onChange(() => this.schedule());
    this.bones = new BonesOverlay(this.space, engine);
    bonesMode.onChange(() => this.schedule());
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
    this.outline = s.getPropertyValue('--fm-stage-outline').trim() || '#888';
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
    this.rootW = Math.max(1, Math.round(r.width)); this.rootH = Math.max(1, Math.round(r.height));
    this.syncSize();
    this.draw();
  }

  /** Sizes the Stage space (the viewport, or the wider box a turned view needs) and its turn; the canvas follows in the same task as the next draw. */
  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { sw, sh } = this.nav.layout(this.rootW, this.rootH);
    const b = this.nav.spaceBox();
    const key = `${sw}x${sh}:${b.left}:${b.top}:${b.deg.toFixed(3)}:${dpr}`;
    if (key === this.spaceKey) return;
    this.spaceKey = key;
    this.width = sw; this.height = sh; this.dpr = dpr;
    const st = this.space.style;
    st.width = `${sw}px`; st.height = `${sh}px`; st.left = `${b.left}px`; st.top = `${b.top}px`;
    st.transform = b.deg ? `rotate(${b.deg.toFixed(3)}deg)` : '';
    const pw = Math.round(sw * dpr), ph = Math.round(sh * dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.box.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
  }

  schedule(): void {
    if (this.req) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); });
  }

  private draw(): void {
    const m = this.engine.movie;
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.syncSize();
    if (!m || this.width <= 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      hideSvg(this.box, true);
      setText(this.tc, '');
      return;
    }
    const view = this.nav.view(m, this.dpr);
    const preview = this.nav.preview;
    this.renderer.drawFrame(ctx, m, this.engine.frame, view, { backstage: !preview, background: this.bg, transparentChecker: this.pattern, noCamera: cameraMode.on });
    if (!preview) {
      // a thin outline so the Stage edge shows on any background
      const lw = Math.max(1, Math.round(this.dpr));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = lw;
      ctx.strokeStyle = this.outline;
      ctx.strokeRect(Math.round(view.ox) - lw / 2, Math.round(view.oy) - lw / 2, Math.round(m.width * view.scale) + lw, Math.round(m.height * view.scale) + lw);
      ctx.restore();
    }
    this.view = { scale: view.scale / this.dpr, ox: view.ox / this.dpr, oy: view.oy / this.dpr, width: this.width, height: this.height };
    setText(this.tc, stamp(this.engine.frame, m.fps));
    this.tc.hidden = preview || m.timecode === false;
    this.camera.sync(preview ? null : this.view);
    this.drawBox(m);
  }

  /** Screen pixels as a content's parent space shows them to real screen pixels (parents and group; the camera too unless Camera mode is on). */
  private sm(m: Movie, c: Content): Mat | null {
    return this.view ? screenMat(stageMovie(m, cameraMode.on), c, this.engine.frame, this.view) : null;
  }

  private parentPt(m: Movie, id: string, x: number, y: number): [number, number] {
    const at = locate(m, id);
    return at ? unmapPt(this.sm(m, at.content), x, y) : [x, y];
  }

  /** Movement of a dragged content in its own parent space, in movie pixels: the pointer is held on the spot grabbed even while the parent moves. */
  private moveDelta(g: Extract<Grab, { kind: 'move' }>, m: Movie, id: string, x: number, y: number, v: View): [number, number] {
    const at = locate(m, id), a = g.anchors.get(id);
    const S = at ? this.sm(m, at.content) : null;
    if (!S || !a) return [(x - g.x0) / v.scale, (y - g.y0) / v.scale];
    const [lx, ly] = unmapPt(S, a.w[0] + (x - g.x0), a.w[1] + (y - g.y0));
    return [(lx - a.s[0]) / v.scale, (ly - a.s[1]) / v.scale];
  }

  private keyed(): boolean { return this.engine.mode !== 'compose'; }

  private pose(c: Content): Pose {
    if (this.keyed()) {
      const a = animate(c, this.engine.frame - c.start);
      const kx = c.transform.stretchX ?? 1, ky = c.transform.stretchY ?? 1;
      return { x: a.x, y: a.y, sx: a.scaleX / kx, sy: a.scaleY / ky, rot: a.rotation, px: a.px, py: a.py, kx, ky, fx: a.flipH ? -1 : 1, fy: a.flipV ? -1 : 1 };
    }
    const t = c.transform;
    return { x: t.x, y: t.y, sx: t.scale, sy: t.scale, rot: t.rotation, px: c.pivot?.x, py: c.pivot?.y, kx: t.stretchX ?? 1, ky: t.stretchY ?? 1, fx: t.flipH ? -1 : 1, fy: t.flipV ? -1 : 1 };
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
    // rotation and scale turn around the pivot (an offset from the centre; none: the centre)
    const pvx = (t.px ?? 0) * v.scale, pvy = (t.py ?? 0) * v.scale;
    const cx = v.ox + (m.width / 2 + t.x) * v.scale + pvx, cy = v.oy + (m.height / 2 + t.y) * v.scale + pvy;
    const hw = (size.w / 2) * t.sx * t.kx * v.scale, hh = (size.h / 2) * t.sy * t.ky * v.scale;
    const a = (t.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const S = this.sm(m, c);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x0, y0]) => {
      const x = x0 - pvx * t.sx * t.kx * t.fx, y = y0 - pvy * t.sy * t.ky * t.fy;
      return mapPt(S, cx + x * cos - y * sin, cy + x * sin + y * cos);
    });
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
    const sel = this.nav.preview ? [] : this.engine.selected.filter((c) => this.engine.isOver(c));
    const warpShown = this.warp.sync(this.view, sel), bonesShown = this.bones.sync(this.view, sel);
    const handles = warpShown || bonesShown;
    this.paths.sync(handles ? null : this.view, sel);
    const show = sel.length === 1 && !!this.view && !handles;
    hideSvg(this.box, !show);
    setClass(this.box as unknown as HTMLElement, 'is-keyed', this.keyed());
    if (!show) return;
    const pts = this.corners(m, sel[0]);
    q(this.box as unknown as HTMLElement, '.fm-box-line').setAttribute('points', pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '));
    const hs = Array.from(this.box.querySelectorAll('.fm-box-h'));
    pts.forEach((p, i) => { hs[i].setAttribute('cx', p[0].toFixed(1)); hs[i].setAttribute('cy', p[1].toFixed(1)); });
    const sides = Array.from(this.box.querySelectorAll('.fm-box-s'));
    sides.forEach((s, i) => {
      const a = pts[i], b = pts[(i + 1) % 4];
      s.setAttribute('transform', `translate(${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}) rotate(${((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI).toFixed(1)})`);
    });
    const along = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], upv = [pts[1][0] - pts[2][0], pts[1][1] - pts[2][1]];
    const la = Math.hypot(along[0], along[1]) || 1, lu = Math.hypot(upv[0], upv[1]) || 1;
    q(this.box as unknown as HTMLElement, '.fm-box-more').setAttribute('transform', `translate(${(pts[1][0] + (along[0] / la) * 20 + (upv[0] / lu) * 20).toFixed(1)} ${(pts[1][1] + (along[1] / la) * 20 + (upv[1] / lu) * 20).toFixed(1)})`);
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
    return this.nav.local(e);
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
    this.root.focus({ preventScroll: true });
    if (sel.length === 1 && target.closest('.fm-box-more')) {
      this.boxMenu.open(e.clientX, e.clientY, [sel[0].id]);
      e.preventDefault();
      return;
    }
    if (sel.length === 1 && target.classList.contains('fm-box-s')) {
      const side = SIDES[Number((target as SVGElement).dataset.s)] ?? SIDES[0];
      this.grab = { kind: 'stretch', id: sel[0].id, base: this.pose(sel[0]), axis: side.axis, sign: side.sign, tag };
    } else if (sel.length === 1 && target.classList.contains('fm-box-rot')) {
      const c = sel[0], p = this.pose(c), cx = v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, cy = v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale;
      const [qx, qy] = this.parentPt(m, c.id, x, y);
      this.grab = { kind: 'rotate', id: c.id, base: p, a0: Math.atan2(qy - cy, qx - cx), tag };
    } else if (sel.length === 1 && target.classList.contains('fm-box-h')) {
      const c = sel[0], p = this.pose(c), cx = v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, cy = v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale;
      const [qx, qy] = this.parentPt(m, c.id, x, y);
      this.grab = { kind: 'scale', id: c.id, base: p, d0: Math.hypot(qx - cx, qy - cy) || 1, tag };
    } else {
      const hitId = this.pick(m, x, y);
      if (hitId && !this.engine.selection.content.includes(hitId)) this.engine.select(e.shiftKey ? [...this.engine.selection.content, hitId] : [hitId]);
      // Perform keeps its one content when the pen lands off it: the take is a drag, not a click
      if (!hitId && !e.shiftKey && !(this.engine.mode === 'perform' && sel.length === 1)) { this.engine.select([]); return; }
      const ids = this.engine.selected.filter((c) => this.engine.isOver(c)).map((c) => c.id);
      if (!ids.length) return;
      const base = new Map(ids.map((id) => [id, this.pose((locate(m, id) as NonNullable<ReturnType<typeof locate>>).content)]));
      const anchors = new Map(ids.map((id) => {
        const p = base.get(id) as Pose, c = (locate(m, id) as NonNullable<ReturnType<typeof locate>>).content;
        const s: [number, number] = [v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale];
        return [id, { s, w: mapPt(this.sm(m, c), s[0], s[1]) }] as const;
      }));
      this.grab = { kind: 'move', x0: x, y0: y, ids, base, anchors, tag, snap: this.snapTargets(m, v, ids) };
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.grabPointer = e.pointerId;
    e.preventDefault();
    this.beginRec(e);
  }

  /** Perform mode: a drag on one content records. The movie plays from the Playhead while the pen is down. */
  private beginRec(e: PointerEvent): void {
    const g = this.grab, m = this.engine.movie;
    if (!g || !m || this.engine.mode !== 'perform' || g.kind === 'stretch') return;
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
      const [rx, ry] = this.moveDelta(g, m, g.ids[0], x, y, v);
      vals.x = Math.round(b.x + rx);
      vals.y = Math.round(b.y + ry);
      if (roll) vals.rotation = Math.round((b.rot + roll) * 10) / 10;
    } else if (g.kind === 'scale') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
      const ratio = Math.hypot(x - cx, y - cy) / g.d0;
      vals.scaleX = Math.round(Math.max(0.01, b.sx * ratio) * 1000) / 1000;
      vals.scaleY = Math.round(Math.max(0.01, b.sy * ratio) * 1000) / 1000;
      if (roll) vals.rotation = Math.round((b.rot + roll) * 10) / 10;
    } else if (g.kind === 'rotate') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
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
    let [x, y] = this.local(e);
    // scale and rotate read the pointer in the content's parent space, so they hold under a moving parent
    if (g.kind !== 'move') [x, y] = this.parentPt(m, g.id, x, y);
    if (g.rec) { this.recordMove(g, g.rec, m, v, x, y, e); return; }
    if (g.kind === 'move') {
      let [dx, dy] = this.moveDelta(g, m, g.ids[0], x, y, v);
      const first = g.base.get(g.ids[0]) as Pose;
      let snapV: number | null = null, snapH: number | null = null;
      if (!e.altKey) {
        const tol = SNAP_PX / v.scale;
        if (e.shiftKey && g.snap) {
          // the snap modifier: the content's edges and centre against the frame and the other contents
          const b = g.snap.box;
          const s = snapBox({ l: b.l + dx, t: b.t + dy, r: b.r + dx, b: b.b + dy }, g.snap.xs, g.snap.ys, tol);
          dx += s.dx; dy += s.dy; snapV = s.gx; snapH = s.gy;
        } else {
          const nx = first.x + dx, ny = first.y + dy;
          for (const target of [0, -m.width / 4, m.width / 4]) if (Math.abs(nx - target) < tol) { dx = target - first.x; snapV = m.width / 2 + target; break; }
          for (const target of [0, -m.height / 4, m.height / 4]) if (Math.abs(ny - target) < tol) { dy = target - first.y; snapH = m.height / 2 + target; break; }
        }
      }
      this.snapLines(m, v, snapV, snapH);
      if (this.keyed()) {
        this.writeKeys('Move Keyframe', g.ids, (id) => { const b = g.base.get(id) as Pose; const [ex, ey] = id === g.ids[0] ? [dx, dy] : this.moveDelta(g, m, id, x, y, v); return { x: Math.round(b.x + ex), y: Math.round(b.y + ey), scaleX: b.sx, scaleY: b.sy, rotation: b.rot }; }, g.tag);
        return;
      }
      this.engine.run('Move', (mv) => {
        let out = mv;
        for (const id of g.ids) { const b = g.base.get(id) as Pose; const [ex, ey] = id === g.ids[0] ? [dx, dy] : this.moveDelta(g, m, id, x, y, v); out = ops.patchContent(out, [id], { transform: { x: Math.round(b.x + ex), y: Math.round(b.y + ey) } }); }
        return out;
      }, g.tag);
    } else if (g.kind === 'stretch') {
      this.stretchTo(g, m, v, x, y);
    } else if (g.kind === 'scale') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
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
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
      let deg = b.rot + ((Math.atan2(y - cy, x - cx) - g.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = snapAngle(deg, this.keyed() ? 30 : 15);
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
    // guides are in movie pixels from the frame's top left
    if (sx !== null) { const px = v.ox + sx * v.scale; lv.setAttribute('x1', String(px)); lv.setAttribute('x2', String(px)); lv.setAttribute('y1', String(v.oy)); lv.setAttribute('y2', String(v.oy + m.height * v.scale)); }
    if (sy !== null) { const py = v.oy + sy * v.scale; lh.setAttribute('y1', String(py)); lh.setAttribute('y2', String(py)); lh.setAttribute('x1', String(v.ox)); lh.setAttribute('x2', String(v.ox + m.width * v.scale)); }
  }

  /** What a held snap modifier can land on: the frame's lines and the other visible contents' edges and centres, with the dragged content's box. */
  private snapTargets(m: Movie, v: View, ids: string[]): { box: Box; xs: number[]; ys: number[] } | undefined {
    const first = locate(m, ids[0])?.content;
    if (!first) return undefined;
    const toMovie = (pts: [number, number][]): Box => boxOf(pts.map(([px, py]) => [(px - v.ox) / v.scale, (py - v.oy) / v.scale] as const));
    const { xs, ys } = frameLines(m.width, m.height);
    for (const t of m.tracks) {
      if (t.hidden) continue;
      for (const c of t.content) {
        if (ids.includes(c.id) || c.kind === 'audio' || !this.engine.isOver(c)) continue;
        const b = toMovie(this.corners(m, c));
        xs.push(b.l, (b.l + b.r) / 2, b.r);
        ys.push(b.t, (b.t + b.b) / 2, b.b);
      }
    }
    return { box: toMovie(this.corners(m, first)), xs, ys };
  }

  /** Drag a side node: that axis stretches while the opposite side stays put; past it the content flips. */
  private stretchTo(g: Extract<Grab, { kind: 'stretch' }>, m: Movie, v: View, x: number, y: number): void {
    const c = locate(m, g.id)?.content;
    if (!c) return;
    const b = g.base, ext = this.extent(m, c);
    const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
    const th = (b.rot * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
    const dx = (x - cx) / v.scale, dy = (y - cy) / v.scale;
    const u = g.axis === 'x' ? dx * cs + dy * sn : -dx * sn + dy * cs;
    const half = (g.axis === 'x' ? ext.w : ext.h) / 2;
    const pv = (g.axis === 'x' ? b.px : b.py) ?? 0;
    const base = g.axis === 'x' ? b.sx : b.sy, k = g.axis === 'x' ? b.kx : b.ky, f = g.axis === 'x' ? b.fx : b.fy;
    const grabbed = g.sign * half, opposite = -g.sign * half;
    const aOpp = base * k * f * (opposite - pv);
    let s = (u - aOpp) / (grabbed - opposite);
    const floor = 0.02 * base;
    // Compose lets the side cross the opposite one (a flip); keyed modes stop at a sliver
    if (this.keyed()) s = Math.max(floor, s * f) * f;
    else if (Math.abs(s) < floor) s = (s < 0 ? -1 : 1) * floor;
    const shift = aOpp - s * (opposite - pv);
    const nx = b.x + (g.axis === 'x' ? shift * cs : -shift * sn), ny = b.y + (g.axis === 'x' ? shift * sn : shift * cs);
    const round = (n: number): number => Math.round(n);
    if (this.keyed()) {
      const mag = Math.round((Math.abs(s) / k) * 1000) / 1000;
      this.writeKeys('Stretch Keyframe', [g.id], () => ({ x: round(nx), y: round(ny), scaleX: g.axis === 'x' ? mag : b.sx, scaleY: g.axis === 'y' ? mag : b.sy, rotation: b.rot }), g.tag);
      return;
    }
    const nk = Math.abs(s) / base;
    this.engine.run('Stretch', (mv) => ops.updateContent(mv, g.id, (cc) => {
      const t = cc.transform;
      const sx = g.axis === 'x' ? nk : t.stretchX ?? 1, sy = g.axis === 'y' ? nk : t.stretchY ?? 1;
      const next = tops.withStretch({ ...t, x: round(nx), y: round(ny) }, sx, sy);
      if (g.axis === 'x') next.flipH = s < 0; else next.flipV = s < 0;
      return { ...cc, transform: next };
    }), g.tag);
  }

  /** Arrow keys on the focused Stage move the selected content: 1 px, Shift 10 px, Ctrl or Cmd with Shift 100 px. */
  private arrowKey(e: KeyboardEvent): void {
    if (e.target !== this.root || e.altKey) return;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key];
    if (!d || !this.engine.selected.some((c) => this.engine.isOver(c))) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? (mod ? 100 : 10) : 1;
    e.preventDefault();
    this.nudge(d[0] * step, d[1] * step);
  }

  /** Move the selection by movie pixels; a burst of nudges is one undo step. */
  nudge(dx: number, dy: number): void {
    const m = this.engine.movie;
    const sel = this.engine.selected.filter((c) => this.engine.isOver(c));
    if (!m || !sel.length) return;
    const ids = sel.map((c) => c.id), tag = `nudge-${ids.join()}`;
    if (this.keyed()) {
      const base = new Map(sel.map((c) => [c.id, this.pose(c)]));
      this.writeKeys('Nudge Keyframe', ids, (id) => { const b = base.get(id) as Pose; return { x: b.x + dx, y: b.y + dy, scaleX: b.sx, scaleY: b.sy, rotation: b.rot }; }, tag);
    } else {
      this.engine.run('Nudge', (mv) => tops.nudge(mv, ids, dx, dy), tag);
    }
    window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => this.engine.endGesture(), 700);
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
