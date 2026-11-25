import type { Engine } from '../engine/engine';
import { end, locate } from '../engine/model';
import { canvasCentreOffset, canvasOf } from '../engine/canvas';
import * as ops from '../engine/ops';
import type { Renderer, View } from '../engine/render';
import { FrameStore } from '../engine/frame-cache';
import { StageNav } from './stage-nav';
import { loadPrefs } from './prefs';
import { TOUCH_SLOP, snapMod } from './gestures';
import * as keyOps from '../engine/key-ops';
import { animate, laneOf } from '../engine/keys';
import type { Content, Movie } from '../engine/types';
import { ensureLane, newKeyState } from './action-menu';
import { el, q, setClass, setText } from './dom';
import { PerformBanner, perform } from './perform-ui';
import { followLead, makeFollowers, sampleFollowers, type Follower } from './perform-multi';
import { applyTake, Recorder, roomFor } from '../engine/perform';
import { WarpOverlay, warpMode } from './warp-view';
import { BonesOverlay, bonesMode } from './bones-view';
import { PathView } from './path-view';
import { mapPt, screenMat, stageMovie, unmapPt } from './stage-world';
import { CameraOverlay, cameraMode } from './camera-view';
import { FxStageTools } from './fx-stage-tools';
import type { Mat } from '../engine/transform';
import * as tops from '../engine/transform-ops';
import { icon } from './icons';
import { StageBoxMenu } from './stage-box-menu';
import { anchorMode } from './anchor-mode';
import { boxOf, frameLines, snapAngle, snapBox, type Box } from './stage-snap';
import { fontEpoch, layoutText } from '../engine/text-layout';
import { TextStage } from './text-stage';
import { ShapeStage } from './shape-stage';
import { stageBox } from '../engine/shape-ops';
import type { TextStyle } from '../engine/types';
import { GestureCache } from './stage-gesture-cache';
import { Fringe } from './stage-fringe';
import { FrameRing } from './stage-frame-ring';
import { StageGuides } from './stage-guides';
import { guideLines } from '../engine/guides';
import { DragCache, pictureSig, sameSig } from './stage-drag-cache';
import { fromCentre, toCentre } from './stage-compose';
import { StageHud } from './stage-hud';
import { fitBase } from '../engine/fit-base';
import { toast } from './toast';
import '../styles/stage-box.css';
import '../styles/stage-box2.css';
import { MultiBox } from './stage-multi';
import { CameraPanel } from './camera-panel';
import { Surround } from './stage-surround';
import { updateAny } from '../engine/group-inner-ops';
import { partAt, partBox, pickedPart, stageFind, stageTargets } from './inner-pick';

/** The text block's centre as an offset from the movie centre (it sits off-centre for left or right aligned text). */
function textCentre(s: TextStyle, m: Movie): { x: number; y: number } {
  const r = layoutText(s, m).inner;
  return { x: r.x + r.w / 2 - m.width / 2, y: r.y + r.h / 2 - m.height / 2 };
}

/** Content with a picture to grab on the Stage: not a sound, and not an Adjustment that has no mask outline. */
const boxed = (c: Content): boolean => c.kind !== 'audio' && !(c.kind === 'adjust' && !c.shape);

/** Side node directions in handle order: top, right, bottom, left. */
const SIDES: ReadonlyArray<{ axis: 'x' | 'y'; sign: 1 | -1 }> = [{ axis: 'y', sign: -1 }, { axis: 'x', sign: 1 }, { axis: 'y', sign: 1 }, { axis: 'x', sign: -1 }];

/** Where a content sits on the Stage: its transform, or its animated values in Keyframe and Perform modes. */
interface Pose { x: number; y: number; sx: number; sy: number; rot: number; px?: number; py?: number; kx: number; ky: number; fx: 1 | -1; fy: 1 | -1; /** The content's stored anchor (Compose edits about the centre but keeps it). */ p0x: number; p0y: number }

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
  /** The Playhead frame the take starts recording at (pre-roll rolls in before it). */
  armedAt: number;
  /** The last frame a punch range lets the take reach (null: no punch). */
  punchTo: number | null;
  /** Mouse modifiers: the pointer's last place, the move held back while a modifier is down, and the turn and scale they added. */
  prev: [number, number] | null;
  frozen: [number, number];
  turn: number;
  zoom: number;
  held: { r: boolean; s: boolean };
  /** History depth when the take began, for Retake. */
  before: number;
  /** The other selected blocks that follow the lead, and the lead's pose when the take began. */
  followers?: Follower[];
  leadBase?: Pose;
}

type Grab =
  | { kind: 'move'; x0: number; y0: number; ids: string[]; base: Map<string, Pose>; anchors: Map<string, { s: [number, number]; w: [number, number] }>; tag: string; rec?: Rec; snap?: { box: Box; xs: number[]; ys: number[] } }
  | { kind: 'scale'; id: string; base: Pose; d0: number; tag: string; rec?: Rec; click?: { x: number; y: number; i: number } }
  | { kind: 'stretch'; id: string; base: Pose; axis: 'x' | 'y'; sign: 1 | -1; tag: string; rec?: undefined }
  | { kind: 'rotate'; id: string; base: Pose; a0: number; tag: string; rec?: Rec };

const MOVE_CHANNELS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];

const SNAP_PX = 8;

export class StageView {
  readonly root = el(`<div class="fm-stage" aria-label="Stage">
    <div class="fm-stage-space">
    <canvas class="fm-stage-canvas"></canvas>
    <svg class="fm-stage-box" hidden><polygon class="fm-box-line"/><line class="fm-box-stem"/><circle class="fm-box-rot" r="6"/><circle class="fm-box-ring" r="17"/><circle class="fm-box-h" data-h="0" r="6"/><circle class="fm-box-h" data-h="1" r="6"/><circle class="fm-box-h" data-h="2" r="6"/><circle class="fm-box-h" data-h="3" r="6"/><rect class="fm-box-s" data-s="0" x="-4" y="-4" width="8" height="8" rx="2"/><rect class="fm-box-s" data-s="1" x="-4" y="-4" width="8" height="8" rx="2"/><rect class="fm-box-s" data-s="2" x="-4" y="-4" width="8" height="8" rx="2"/><rect class="fm-box-s" data-s="3" x="-4" y="-4" width="8" height="8" rx="2"/><g class="fm-box-more"><title>Transform options</title><circle r="11"/><circle class="d" cx="-5" r="1.4"/><circle class="d" r="1.4"/><circle class="d" cx="5" r="1.4"/></g><line class="fm-snap-v"/><line class="fm-snap-h"/></svg>
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
  /** Grid and glow around the frame. */
  private readonly surround: Surround;
  /** The union box of a multi-selection (Compose). */
  private readonly multi: MultiBox;
  private readonly camera: CameraOverlay;
  /** Grid, thirds, safe areas, guide lines and rulers (ui/stage-guides.ts). */
  private readonly guides: StageGuides;
  private readonly fxTools: FxStageTools;
  private view: View | null = null;
  /** The movie frame as it sits in the window (client pixels), or null before the first picture: notices keep clear of it. */
  frameClientRect(): DOMRect | null {
    const v = this.view, m = this.engine.movie;
    if (!v || !m) return null;
    const c = this.canvas.getBoundingClientRect();
    return new DOMRect(c.left + v.ox, c.top + v.oy, m.width * v.scale, m.height * v.scale);
  }
  /** The last picture can stand in during a view gesture; any other change marks it stale. */
  private readonly gesture: GestureCache;
  /** Low-resolution picture around the Stage that covers the edge a pan uncovers. */
  private readonly fringe: Fringe;
  /** The rounded outline over the movie frame (G16). */
  private readonly ring: FrameRing;
  private stale = true;
  /** Set by anything but a movie edit: the picture is drawn again even when the movie's visible content is unchanged. */
  private hard = true;
  /** What the last drawn picture depended on (stage-drag-cache): a movie edit that leaves it equal draws nothing. */
  private lastSig: unknown[] | null = null;
  /** Layers below and above a block under the pointer, kept while it is dragged. */
  private readonly drag: DragCache;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private req = 0;
  private grab: Grab | null = null;
  private grabPointer = -1;
  private slop: [number, number] | null = null;
  private offWrap: (() => void) | null = null;
  private bg = '#0a0a0a';
  private readonly boxMenu: StageBoxMenu;
  private nudgeTimer = 0;
  /** Numeric readout by the pointer and the "Snapping on" chip while a handle is dragged. */
  private readonly hud: StageHud;
  /** The corner node whose rotation ring is showing (Keyframe and Perform), or null. */
  private ringAt: number | null = null;
  private lastClient: [number, number] = [0, 0];
  /** The first Compose edit of a content that has a Move lane says so once. */
  private composeToldFor = '';
  private readonly textStage: TextStage;
  /** The Shape tool, pen and path node editing (ui/shape-stage.ts); the app drives its tool from commands. */
  readonly shapeStage: ShapeStage;
  /** Set by the app: opens the Shape panel near a screen point. */
  onEditShape: ((id: string, x: number, y: number) => void) | null = null;
  /** Set by the app: opens the Text style card for an id near a screen point. */
  onEditTextStyle: ((id: string, x: number, y: number) => void) | null = null;

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer) {
    host.appendChild(this.root);
    this.nav = new StageNav(this.root, engine);
    this.fringe = new Fringe(this.space, this.canvas);
    this.ring = new FrameRing(this.space);
    this.surround = new Surround(this.space, this.box);
    this.gesture = new GestureCache(this.canvas, () => this.schedule(), (v) => this.fringe.follow(v, this.width, this.height));
    this.drag = new DragCache(renderer);
    this.nav.onChange = () => this.scheduleView();
    this.nav.isDragging = () => !!this.grab;
    this.nav.isEmpty = (x, y) => { const m = this.engine.movie; return !!m && !!this.view && !this.pick(m, x, y); };
    this.boxMenu = new StageBoxMenu(engine, () => this.root.focus({ preventScroll: true }));
    this.root.tabIndex = 0;
    this.root.addEventListener('keydown', (e) => this.arrowKey(e));
    new ResizeObserver(() => this.resize()).observe(this.root);
    for (const ev of ['time', 'selection', 'projects'] as const) engine.on(ev, () => this.schedule());
    engine.on('movie', () => this.scheduleSoft());
    this.banner = new PerformBanner(engine);
    this.root.appendChild(this.banner.root);
    this.hud = new StageHud(this.root);
    engine.on('selection', () => { this.ringAt = null; });
    window.addEventListener('keydown', (e) => this.recKey(e, true), true);
    window.addEventListener('keyup', (e) => this.recKey(e, false), true);
    window.addEventListener('blur', () => { this.modsHeld.r = false; this.modsHeld.s = false; });
    this.warp = new WarpOverlay(this.space, engine);
    this.paths = new PathView(this.space, engine);
    this.multi = new MultiBox(this.space, engine, { corners: (c) => this.corners(this.engine.movie as Movie, c), local: (e) => this.nav.local(e) });
    this.paths.sectors = (c) => {
      const m = this.engine.movie;
      if (!m) return null;
      const s = this.extent(m, c);
      const pb = c.kind === 'group' ? this.boxOf(m, c) : null;
      const dc = c.kind === 'text' && c.text ? textCentre(c.text, m) : pb ? { x: pb.cx, y: pb.cy } : canvasCentreOffset(c, m);
      const out: Array<[number, number]> = [];
      for (const j of [-1, 0, 1]) for (const i of [-1, 0, 1]) out.push([dc.x + (i * s.w) / 2, dc.y + (j * s.h) / 2]);
      return out;
    };
    anchorMode.onChange(() => this.schedule());
    this.camera = new CameraOverlay(this.space, engine);
    new CameraPanel(this.root, engine);
    this.guides = new StageGuides(this.space, this.root, engine, { local: (e) => this.nav.local(e), turned: () => this.nav.spaceBox().deg !== 0 });
    this.fxTools = new FxStageTools(this.root, this.space, engine, renderer, this.nav);
    cameraMode.onChange(() => this.schedule());
    warpMode.onChange(() => this.schedule());
    this.textStage = new TextStage(this.space, engine, {
      view: () => this.view,
      corners: (c) => this.corners(this.engine.movie as Movie, c),
      point: (e, id) => this.parentPt(this.engine.movie as Movie, id, ...this.nav.local(e)),
      pose: (c) => this.pose(c),
      editStyle: (id, x, y) => this.onEditTextStyle?.(id, x, y),
      focus: () => this.root.focus({ preventScroll: true }),
    });
    this.shapeStage = new ShapeStage(this.space, this.root, engine, { view: () => this.view, point: (e) => this.nav.local(e), focus: () => this.root.focus({ preventScroll: true }) });
    window.addEventListener('fm:fonts', () => { this.frames.clear(); this.hard = true; this.schedule(); });
    const dbl = (e: MouseEvent): void => {
      const m = this.engine.movie;
      if (!m || !this.view || this.nav.preview || (e.target as Element).closest('.fm-ted, .fm-box-h, .fm-box-s, .fm-box-rot, .fm-box-more, button, input')) return;
      const [lx, ly] = this.nav.local(e);
      const id = this.pick(m, lx, ly);
      const c = id ? locate(m, id)?.content : null;
      // into a group (a character): the part under the pointer is picked; a click then picks another, Escape leaves
      const into = pickedPart(this.engine)?.group ?? (c?.kind === 'group' ? c : null);
      const part = into && this.engine.mode !== 'perform' ? partAt(stageMovie(m, cameraMode.on), into, this.engine.frame, this.view, lx, ly) : null;
      if (part) this.engine.select([part]);
      else if (id && c && c.kind === 'text' && c.text) { this.engine.select([id]); this.textStage.start(id); this.textStage.showMenu(e.clientX, e.clientY); }
      else if (id && c && (c.kind === 'shape' || c.kind === 'solid')) { this.engine.select([id]); this.onEditShape?.(id, e.clientX, e.clientY); }
    };
    this.root.addEventListener('dblclick', dbl);
    this.bones = new BonesOverlay(this.space, engine);
    bonesMode.onChange(() => this.schedule());
    engine.on('mode', () => { this.cancelRecording(); this.ringAt = null; this.schedule(); });
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
    this.checkerGen++;
  }

  private pattern: CanvasPattern | null = null;
  /** Finished frames kept for playback (engine/frame-cache); `checkerGen` counts colour reads so a new checker drops them. */
  private framesOf: FrameStore | null = null;
  private get frames(): FrameStore { return this.framesOf ?? (this.framesOf = new FrameStore(this.renderer, (w, h) => this.aheadSurface(w, h))); }
  private ahead: HTMLCanvasElement | null = null;
  private aheadSurface(w: number, h: number): HTMLCanvasElement {
    const c = this.ahead ?? (this.ahead = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }
  private checkerGen = 0;

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

  /** A view gesture step: the picture may be moved or scaled instead of rendered again. */
  private scheduleView(): void {
    if (this.req) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); });
  }

  /** A movie edit: drawn again only when what the Stage shows changed (a Timeline block moved in time often changes nothing). */
  private scheduleSoft(): void {
    this.stale = true;
    if (this.req) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); });
  }

  /** Teardown: the fringe's window listeners and timers go. */
  dispose(): void { this.fringe.dispose(); }

  schedule(): void {
    this.stale = true;
    this.hard = true;
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
      this.ring.sync(null, 0, 0);
      setText(this.tc, '');
      return;
    }
    const view = this.nav.view(m, this.dpr);
    const preview = this.nav.preview;
    const soft = !this.hard;
    this.hard = false;
    if (this.stale && soft && this.lastSig && sameSig(this.lastSig, pictureSig(m, this.engine.frame))) {
      this.gesture.rebind(m);
      this.stale = false;
    }
    const reuse = !this.stale && this.gesture.reuse(m, this.engine.frame, view, this.canvas.width, this.canvas.height, preview, this.dpr);
    if (!reuse) {
      this.stale = false;
      this.renderPicture(ctx, m, view, preview);
      this.lastSig = pictureSig(m, this.engine.frame);
      this.gesture.store(m, this.engine.frame, view, this.canvas.width, this.canvas.height, preview, this.dpr);
      this.fringe.queue((fc, cw, ch, k) => this.drawFringe(fc, m, this.engine.frame, view, preview, cw, ch, k));
    }
    this.view = { scale: view.scale / this.dpr, ox: view.ox / this.dpr, oy: view.oy / this.dpr, width: this.width, height: this.height };
    this.ring.sync(preview ? null : this.view, m.width, m.height);
    if (reuse) {
      this.camera.sync(preview ? null : this.view);
      this.guides.sync(this.view, preview);
      this.drawBox(m);
      return;
    }
    setText(this.tc, stamp(this.engine.frame, m.fps));
    this.tc.hidden = preview || m.timecode === false;
    this.camera.sync(preview ? null : this.view);
    this.guides.sync(this.view, preview);
    this.drawBox(m);
  }

  /** The fringe picture: one viewport beyond each side of the Stage at scale k, drawn from what the Stage shows now. */
  private drawFringe(fc: CanvasRenderingContext2D, m: Movie, frame: number, view: View, preview: boolean, cw: number, ch: number, k: number): boolean {
    if (this.engine.movie !== m || this.engine.frame !== frame) return false;
    const w = this.canvas.width, h = this.canvas.height;
    const v = { scale: view.scale * k, ox: (view.ox + w) * k, oy: (view.oy + h) * k, width: cw, height: ch };
    this.renderer.drawFrame(fc, m, frame, v, { backstage: !preview, background: this.bg, transparentChecker: null, noCamera: cameraMode.on });
    return this.renderer.takeComplete();
  }

  private renderPicture(ctx: CanvasRenderingContext2D, m: Movie, view: View, preview: boolean): void {
    const frame = this.engine.frame;
    const opts = { backstage: !preview, background: this.bg, transparentChecker: this.pattern, noCamera: cameraMode.on };
    const { lo, last } = this.engine.playSpan();
    this.frames.retarget({ movie: m, view, opts, lo, last, sig: `${this.canvas.width}x${this.canvas.height}:${view.scale.toFixed(5)}:${view.ox.toFixed(2)}:${view.oy.toFixed(2)}:${this.bg}:${preview}:${cameraMode.on}:${this.renderer.gpuActive}:${this.checkerGen}:${fontEpoch()}` });
    const g = this.grab;
    const moved = g && !g.rec && !this.nav.preview ? (g.kind === 'move' ? g.ids : [g.id]) : null;
    if (!moved && this.drag.live) this.drag.drop();
    if (!(moved && this.drag.paint(ctx, m, frame, view, moved, opts, cameraMode.on))) {
      const hit = this.frames.blit(ctx, frame);
      if (!hit) {
        this.renderer.drawFrame(ctx, m, frame, view, opts);
        this.frames.capture(this.canvas, frame, this.renderer.takeComplete());
      }
      this.frames.note(frame, this.engine.playing, hit);
    }
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
  }

  /** Screen pixels as a content's parent space shows them to real screen pixels (parents and group; the camera too unless Camera mode is on). */
  private sm(m: Movie, c: Content): Mat | null {
    return this.view ? screenMat(stageMovie(m, cameraMode.on), c, this.engine.frame, this.view) : null;
  }

  /** A content the Stage edits: a top-level block, or the part picked inside the selected group (ui/inner-pick.ts). */
  private find(m: Movie, id: string): { content: Content; locked: boolean } | null {
    return stageFind(this.engine, m, id);
  }

  /** Compose: the base transform of a top-level block or a picked part. */
  private patchT(mv: Movie, id: string, t: Partial<Content['transform']>): Movie {
    return updateAny(mv, id, (c) => ({ ...c, transform: { ...c.transform, ...t } }));
  }

  private parentPt(m: Movie, id: string, x: number, y: number): [number, number] {
    const at = this.find(m, id);
    return at ? unmapPt(this.sm(m, at.content), x, y) : [x, y];
  }

  /** Movement of a dragged content in its own parent space, in movie pixels: the pointer is held on the spot grabbed even while the parent moves. */
  private moveDelta(g: Extract<Grab, { kind: 'move' }>, m: Movie, id: string, x: number, y: number, v: View): [number, number] {
    const at = this.find(m, id), a = g.anchors.get(id);
    const S = at ? this.sm(m, at.content) : null;
    if (!S || !a) return [(x - g.x0) / v.scale, (y - g.y0) / v.scale];
    const [lx, ly] = unmapPt(S, a.w[0] + (x - g.x0), a.w[1] + (y - g.y0));
    return [(lx - a.s[0]) / v.scale, (ly - a.s[1]) / v.scale];
  }

  /** Starts the inline Text editor on a content (all of its text selected, so typing replaces it). */
  editText(id: string): void {
    this.engine.select([id]);
    this.schedule();
    requestAnimationFrame(() => this.textStage.start(id));
  }

  private keyed(): boolean { return this.engine.mode !== 'compose'; }

  /** Whether `c` is posed by its keys: Keyframe and Perform only. Compose edits the base transform and never writes a key, even on a block with a Move lane. */
  private keyedFor(_c?: Content): boolean {
    return this.keyed();
  }

  private keyedIds(_ids: string[]): boolean {
    return this.keyed();
  }

  private pose(c: Content): Pose {
    if (this.keyedFor(c)) {
      const a = animate(c, this.engine.frame - c.start);
      const kx = c.transform.stretchX ?? 1, ky = c.transform.stretchY ?? 1;
      return { x: a.x, y: a.y, sx: a.scaleX / kx, sy: a.scaleY / ky, rot: a.rotation, px: a.px, py: a.py, kx, ky, fx: a.flipH ? -1 : 1, fy: a.flipV ? -1 : 1, p0x: a.px ?? 0, p0y: a.py ?? 0 };
    }
    // Compose turns and scales about the content centre whatever the anchor: the pose is the same picture seen about the centre
    const t = c.transform, kx = t.stretchX ?? 1, ky = t.stretchY ?? 1, fx = t.flipH ? -1 : 1, fy = t.flipV ? -1 : 1;
    const p0x = c.pivot?.x ?? 0, p0y = c.pivot?.y ?? 0;
    const [x, y] = toCentre(t.x, t.y, t.rotation, t.scale * kx * fx, t.scale * ky * fy, p0x, p0y);
    return { x, y, sx: t.scale, sy: t.scale, rot: t.rotation, kx, ky, fx, fy, p0x, p0y };
  }

  /** Compose: the stored x and y for a transform edited about the content centre (the anchor is kept, the picture lands where the edit put it). */
  private store(b: Pose, x0: number, y0: number, rot: number, mx: number, my: number): { x: number; y: number } {
    const [x, y] = fromCentre(x0, y0, rot, mx, my, b.p0x, b.p0y);
    return { x: Math.round(x), y: Math.round(y) };
  }

  /** The first Compose edit of a content that has a Move lane explains why its picture may not follow the box. */
  private composeNote(ids: string[]): void {
    const m = this.engine.movie;
    const c = m ? this.find(m, ids[0])?.content : null;
    if (!c || !laneOf(c, 'move') || this.composeToldFor === c.id) return;
    this.composeToldFor = c.id;
    toast('Compose edits the base transform. This content has keyframes, which still drive it; change them in Keyframe mode.', 'info', { ms: 6000 });
  }

  /** Write Move keys at the Playhead for each content (creating the lane the first time). */
  private writeKeys(label: string, ids: string[], vals: (id: string) => Record<string, number>, tag: string): void {
    const f = this.engine.frame;
    const ease = newKeyState().lastEase;
    this.engine.run(label, (mv) => {
      let out = mv;
      for (const id of ids) {
        const at = this.find(out, id);
        if (!at) continue;
        const local = f - at.content.start;
        if (local < 0 || local >= at.content.duration) continue;
        out = updateAny(out, id, (c) => keyOps.setKeys(laneOf(c, 'move') ? c : ensureLane(c, 'move', local, mv.addKeyAtStart, ease), 'move', local, vals(id)));
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
    const sb = this.boxOf(m, c);
    const dc = c.kind === 'text' && c.text ? textCentre(c.text, m) : sb ? { x: sb.cx, y: sb.cy } : canvasCentreOffset(c, m);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x0, y0]) => {
      // the box centre is the canvas centre, which sits off the movie centre for a Drawing with its own canvas
      const x = x0 + (dc.x * v.scale - pvx) * t.sx * t.kx * t.fx, y = y0 + (dc.y * v.scale - pvy) * t.sy * t.ky * t.fy;
      return mapPt(S, cx + x * cos - y * sin, cy + x * sin + y * cos);
    });
  }

  /** A Shape's box, or a picked group part's box round what it draws (a top-level group keeps the movie's box). */
  private boxOf(m: Movie, c: Content): { w: number; h: number; cx: number; cy: number } | null {
    return stageBox(c, this.engine.frame, m) ?? (c.kind === 'group' && c.id === pickedPart(this.engine)?.part.id ? partBox(m, c, this.engine.frame) : null);
  }

  private extent(m: Movie, c: Content): { w: number; h: number } {
    const sb = this.boxOf(m, c);
    if (sb) return { w: sb.w, h: sb.h };
    if (c.kind === 'image' && c.asset && m.assets[c.asset]) return { w: m.assets[c.asset].width, h: m.assets[c.asset].height };
    if (c.kind === 'text' && c.text) {
      const r = layoutText(c.text, m).inner;
      return { w: Math.max(r.w, 8), h: Math.max(r.h, 8) };
    }
    const k = canvasOf(c, m);
    return { w: k.w, h: k.h };
  }

  private drawBox(m: Movie): void {
    // a sound has no picture: no transform box
    const sel = this.nav.preview ? [] : stageTargets(this.engine).filter((c) => boxed(c) && this.engine.isOver(c));
    this.surround.sync(this.view, m.width, m.height, !this.nav.preview);
    this.textStage.sync();
    this.shapeStage.sync();
    const warpShown = this.warp.sync(this.view, sel), bonesShown = this.bones.sync(this.view, sel);
    const handles = warpShown || bonesShown;
    this.paths.sync(handles ? null : this.view, sel);
    this.fxTools.sync(handles ? null : this.view, sel);
    const show = sel.length === 1 && !!this.view && !handles;
    hideSvg(this.box, !show);
    this.multi.sync(this.view, sel, !this.keyed() && !handles, [this.width, this.height]);
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
    const rx = top[0] + ((top[0] - cx) / len) * 28, ry = top[1] + ((top[1] - cy) / len) * 28;
    const stem = q(this.box as unknown as HTMLElement, '.fm-box-stem');
    stem.setAttribute('x1', top[0].toFixed(1)); stem.setAttribute('y1', top[1].toFixed(1));
    stem.setAttribute('x2', rx.toFixed(1)); stem.setAttribute('y2', ry.toFixed(1));
    const rot = q(this.box as unknown as HTMLElement, '.fm-box-rot');
    rot.setAttribute('cx', rx.toFixed(1)); rot.setAttribute('cy', ry.toFixed(1));
    // Keyframe and Perform: the rotation ring sits around the corner node that was tapped
    const ring = q(this.box as unknown as HTMLElement, '.fm-box-ring');
    const at = this.keyed() ? this.ringAt : null;
    setClass(ring as unknown as HTMLElement, 'is-on', at !== null);
    if (at !== null && pts[at]) { ring.setAttribute('cx', pts[at][0].toFixed(1)); ring.setAttribute('cy', pts[at][1].toFixed(1)); }
  }

  private local(e: PointerEvent): [number, number] {
    return this.nav.local(e);
  }

  private down(e: PointerEvent): void {
    const m = this.engine.movie;
    const v = this.view;
    // one gesture at a time: a second finger or pen must not orphan the first grab (or its Perform take)
    if (!m || !v || e.button !== 0 || this.grab || this.nav.preview) return;
    const [x, y] = this.local(e);
    const target = e.target as Element;
    // content on a locked track is not grabbed, moved or keyed from the Stage in any mode
    const sel = stageTargets(this.engine).filter((c) => boxed(c) && this.engine.isOver(c) && !this.find(m, c.id)?.locked);
    const tag = `stage-${Date.now()}`;
    this.root.focus({ preventScroll: true });
    if (sel.length === 1 && target.closest('.fm-box-more')) {
      this.boxMenu.open(e.clientX, e.clientY, [sel[0].id]);
      e.preventDefault();
      return;
    }
    // Edit anchor: only the pivot ring drags (path-view takes that press first); any other drag does nothing, so the content never moves or gets a key
    if (anchorMode.on && sel.length === 1 && sel[0].id === anchorMode.id) {
      e.preventDefault();
      return;
    }
    if (sel.length === 1 && target.classList.contains('fm-box-s') && TextStage.wrapSide(sel[0], Number((target as SVGElement).dataset.s), this.keyed())) {
      this.textStage.beginWrap(e, sel[0].id, Number((target as SVGElement).dataset.s), target);
      e.preventDefault();
      return;
    }
    if (sel.length === 1 && target.classList.contains('fm-box-s')) {
      const side = SIDES[Number((target as SVGElement).dataset.s)] ?? SIDES[0];
      this.grab = { kind: 'stretch', id: sel[0].id, base: this.pose(sel[0]), axis: side.axis, sign: side.sign, tag };
    } else if (sel.length === 1 && (target.classList.contains('fm-box-rot') || target.classList.contains('fm-box-ring'))) {
      const c = sel[0], p = this.pose(c), cx = v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, cy = v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale;
      const [qx, qy] = this.parentPt(m, c.id, x, y);
      this.grab = { kind: 'rotate', id: c.id, base: p, a0: Math.atan2(qy - cy, qx - cx), tag };
    } else if (sel.length === 1 && target.classList.contains('fm-box-h')) {
      const c = sel[0], p = this.pose(c), cx = v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, cy = v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale;
      const [qx, qy] = this.parentPt(m, c.id, x, y);
      this.grab = { kind: 'scale', id: c.id, base: p, d0: Math.hypot(qx - cx, qy - cy) || 1, tag, click: { x: e.clientX, y: e.clientY, i: Number((target as SVGElement).dataset.h) } };
    } else {
      const hitId = this.pick(m, x, y);
      if (hitId && !this.engine.selection.content.includes(hitId)) this.engine.select(e.shiftKey ? [...this.engine.selection.content, hitId] : [hitId]);
      // inside a group, a press on it away from every part leaves the part for the whole group
      else if (hitId && pickedPart(this.engine)?.group.id === hitId) this.engine.pick(null);
      // Perform keeps its one content when the pen lands off it: the take is a drag, not a click
      if (!hitId && !e.shiftKey && !(this.engine.mode === 'perform' && sel.length === 1)) {
        // press and hold outside the box, then drag: moves the selected content with the box out of the way (a click or a quick drag still deselects)
        if (sel.length === 1) {
          const pend = { x: e.clientX, y: e.clientY, pointer: e.pointerId, timer: 0 };
          pend.timer = window.setTimeout(() => this.beginOutside(sel[0].id, tag), 420);
          this.pend = pend;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        this.engine.select([]);
        return;
      }
      const ids = stageTargets(this.engine).filter((c) => boxed(c) && this.engine.isOver(c) && !this.find(m, c.id)?.locked).map((c) => c.id);
      if (!ids.length) return;
      this.grab = this.moveGrab(m, v, ids, x, y, tag);
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.grabPointer = e.pointerId;
    this.slop = e.pointerType === 'touch' ? [e.clientX, e.clientY] : null;
    e.preventDefault();
    this.beginRec(e);
  }

  /** A press on empty Stage with one content selected, waiting to become a hold-outside move. */
  private pend: { x: number; y: number; pointer: number; timer: number } | null = null;
  private modsHeld = { r: false, s: false };

  private moveGrab(m: Movie, v: View, ids: string[], x: number, y: number, tag: string): Grab {
    const base = new Map(ids.map((id) => [id, this.pose((this.find(m, id) as NonNullable<ReturnType<StageView['find']>>).content)]));
    const anchors = new Map(ids.map((id) => {
      const p = base.get(id) as Pose, c = (this.find(m, id) as NonNullable<ReturnType<StageView['find']>>).content;
      const s: [number, number] = [v.ox + (m.width / 2 + (p.px ?? 0) + p.x) * v.scale, v.oy + (m.height / 2 + (p.py ?? 0) + p.y) * v.scale];
      return [id, { s, w: mapPt(this.sm(m, c), s[0], s[1]) }] as const;
    }));
    return { kind: 'move', x0: x, y0: y, ids, base, anchors, tag, snap: this.snapTargets(m, v, ids) };
  }

  /** The hold outside the box was long enough: the drag that follows moves the selected content. */
  private beginOutside(id: string, tag: string): void {
    const p = this.pend, m = this.engine.movie, v = this.view;
    this.pend = null;
    if (!p || !m || !v || this.grab || !this.find(m, id)) return;
    this.grabPointer = p.pointer;
    this.slop = null;
    this.grab = this.moveGrab(m, v, [id], ...this.nav.local({ clientX: p.x, clientY: p.y }), tag);
    this.root.style.cursor = 'move';
  }

  /** Perform mode: a drag on one content records. The movie plays from the Playhead while the pen is down. */
  private beginRec(e: PointerEvent): void {
    const g = this.grab, m = this.engine.movie;
    if (!g || !m || this.engine.mode !== 'perform' || g.kind === 'stretch') return;
    // several selected blocks: the first is the lead the pen drives, the rest follow it (ui/perform-multi.ts)
    const id = g.kind === 'move' ? (g.ids[0] ?? null) : g.id;
    const at = id ? locate(m, id) : null;
    if (!id || !at) return;
    let armedAt = this.engine.frame, punchTo: number | null = null;
    // a punch range: the take records only inside the movie's loop range
    if (perform.punch && m.loopFrom !== undefined && m.loopTo !== undefined && m.loopTo >= m.loopFrom) {
      armedAt = Math.max(armedAt, Math.floor(m.loopFrom));
      punchTo = Math.floor(m.loopTo);
    }
    g.rec = { id, rec: new Recorder('move', MOVE_CHANNELS), start: at.content.start, last: null, twist: e.pointerType === 'pen' && loadPrefs().penRoll ? e.twist : null, twistSum: 0, twisted: false, armedAt, punchTo, prev: null, frozen: [0, 0], turn: 0, zoom: 0, held: { r: this.modsHeld.r, s: this.modsHeld.s }, before: this.engine.history.past.length };
    if (g.kind === 'move' && g.ids.length > 1) {
      const others = g.ids.slice(1).map((oid) => locate(m, oid)).filter((x): x is NonNullable<ReturnType<typeof locate>> => !!x).map((x) => ({ c: x.content, pose: this.pose(x.content) }));
      g.rec.followers = makeFollowers(others, MOVE_CHANNELS);
      g.rec.leadBase = this.pose(at.content);
    }
    perform.setRecording(true);
    // a take ends at the movie's end (or the punch-out): playback stops there instead of looping under the pen
    this.offWrap?.();
    this.offWrap = this.engine.on('wrap', () => {
      const last = punchTo ?? (this.engine.movie?.duration ?? 1) - 1;
      this.engine.stop();
      queueMicrotask(() => this.engine.seek(last));
    });
    // pre-roll: the movie rolls in from a few frames earlier, recording starts at the frame the pen came down on
    if (perform.preroll > 0) this.engine.seek(Math.max(0, armedAt - perform.preroll));
    perform.setCountIn(armedAt - this.engine.frame);
    this.engine.play();
  }

  /** R or Ctrl turns and S scales the content during a take; the keys must not reach the app's shortcuts meanwhile. */
  private recKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    // remembered even with no take running: a key held before the pen comes down still counts
    if (k === 'r') this.modsHeld.r = down;
    else if (k === 's') this.modsHeld.s = down;
    const r = this.grab?.rec;
    if (!r || (k !== 'r' && k !== 's')) return;
    r.held.r = this.modsHeld.r;
    r.held.s = this.modsHeld.s;
    if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); }
    perform.setMod(r.held.r || e.ctrlKey ? 'rotating' : r.held.s ? 'scaling' : '');
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
    // mouse modifiers: R or Ctrl turns with the horizontal axis, S scales with the vertical one; the move is held back meanwhile
    const turning = r.held.r || e.ctrlKey, zooming = r.held.s;
    perform.setMod(turning ? 'rotating' : zooming ? 'scaling' : '');
    const [qx, qy] = r.prev ?? [x, y];
    if (turning) r.turn += (x - qx) * perform.rotDegPerPx;
    if (zooming) r.zoom += (qy - y) * 0.004;
    if (turning || zooming) { r.frozen[0] += (x - qx) / v.scale; r.frozen[1] += (y - qy) / v.scale; }
    r.prev = [x, y];
    // linear, so the scale can pass through zero and mirror
    const k = 1 + r.zoom, spin = roll + r.turn;
    const vals: Record<string, number> = {};
    let hud: { x: number; y: number; sx: number; sy: number; rot: number } | null = null;
    if (g.kind === 'move') {
      const b = g.base.get(g.ids[0]) as Pose;
      const [rx, ry] = this.moveDelta(g, m, g.ids[0], x, y, v);
      vals.x = Math.round(b.x + rx - r.frozen[0]);
      vals.y = Math.round(b.y + ry - r.frozen[1]);
      if (spin) vals.rotation = Math.round((b.rot + spin) * 10) / 10;
      if (r.zoom) { vals.scaleX = Math.round(b.sx * k * 1000) / 1000; vals.scaleY = Math.round(b.sy * k * 1000) / 1000; }
      hud = { x: vals.x, y: vals.y, sx: vals.scaleX ?? b.sx, sy: vals.scaleY ?? b.sy, rot: vals.rotation ?? b.rot };
    } else if (g.kind === 'scale') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
      const ratio = Math.hypot(x - cx, y - cy) / g.d0;
      vals.scaleX = Math.round(Math.sign(b.sx || 1) * Math.max(0.01, Math.abs(b.sx) * ratio) * k * 1000) / 1000;
      vals.scaleY = Math.round(Math.sign(b.sy || 1) * Math.max(0.01, Math.abs(b.sy) * ratio) * k * 1000) / 1000;
      if (spin) vals.rotation = Math.round((b.rot + spin) * 10) / 10;
      hud = { x: b.x, y: b.y, sx: vals.scaleX, sy: vals.scaleY, rot: vals.rotation ?? b.rot };
    } else if (g.kind === 'rotate') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
      vals.rotation = Math.round((b.rot + ((Math.atan2(y - cy, x - cx) - g.a0) * 180) / Math.PI + spin) * 10) / 10;
      if (r.zoom) { vals.scaleX = Math.round(b.sx * k * 1000) / 1000; vals.scaleY = Math.round(b.sy * k * 1000) / 1000; }
      hud = { x: b.x, y: b.y, sx: vals.scaleX ?? b.sx, sy: vals.scaleY ?? b.sy, rot: vals.rotation };
    }
    if (hud) this.hud.show(e.clientX, e.clientY, hud);
    r.last = vals;
    if (r.followers && r.leadBase) followLead(r.followers, r.leadBase, vals);
    this.sampleRec(g, r);
  }

  /** Add the latest values at the Playhead and show the take so far (unfiltered) under the pen. */
  private sampleRec(g: Grab, r: Rec): void {
    if (!r.last) return;
    // the take ends where its block can grow no more: playback stops there and nothing is keyed past it
    const mv = this.engine.movie;
    // pre-roll and punch-in: nothing is taken before the frame the take is armed at, nothing after the punch-out
    if (this.engine.frame < r.armedAt) return;
    if (r.punchTo !== null && this.engine.frame > r.punchTo) { if (this.engine.playing) this.engine.stop(); return; }
    if (mv && this.engine.frame - r.start >= roomFor(mv, r.id)) { if (this.engine.playing) this.engine.stop(); return; }
    r.rec.add(this.engine.frame - r.start, r.last);
    if (r.followers) sampleFollowers(r.followers, this.engine.frame);
    this.commitRec(g, r, 0);
  }

  private commitRec(g: Grab, r: Rec, filtering: number): void {
    const take = r.rec.finish(filtering);
    if (!take) return;
    const ease = newKeyState().lastEase;
    const at = Math.max(0, Math.round(take.from));
    this.engine.run('Perform Move and Scale', (mv) => ops.updateContent(mv, r.id, (c) => applyTake(laneOf(c, 'move') ? c : ensureLane(c, 'move', at, mv.addKeyAtStart, ease), take, 'linear', roomFor(mv, r.id))), g.tag);
    for (const f of r.followers ?? []) {
      const t2 = f.rec.finish(filtering);
      if (!t2) continue;
      const at2 = Math.max(0, Math.round(t2.from));
      this.engine.run('Perform Move and Scale', (mv) => ops.updateContent(mv, f.id, (c) => applyTake(laneOf(c, 'move') ? c : ensureLane(c, 'move', at2, mv.addKeyAtStart, ease), t2, 'linear', roomFor(mv, f.id))), g.tag);
    }
  }

  /** A held pen still records: every Playhead step repeats the last position. */
  private sampleHold(): void {
    const g = this.grab;
    if (g?.rec) perform.setCountIn(this.engine.frame >= g.rec.armedAt - perform.preroll ? Math.max(0, g.rec.armedAt - this.engine.frame) : 0);
    if (g?.rec?.last && this.engine.playing) this.sampleRec(g, g.rec);
  }

  private endRec(g: Grab): void {
    const r = g.rec;
    if (!r) return;
    g.rec = undefined;
    this.offWrap?.();
    this.offWrap = null;
    if (r.last && this.engine.frame >= r.armedAt && (r.punchTo === null || this.engine.frame <= r.punchTo)) { r.rec.add(this.engine.frame - r.start, r.last); if (r.followers) sampleFollowers(r.followers, this.engine.frame); }
    this.engine.stop();
    this.commitRec(g, r, perform.filtering);
    perform.setRecording(false);
    perform.markTake(r.before, this.engine.history.past.length, r.armedAt);
  }

  private cancelRecording(): void {
    const g = this.grab;
    if (!g?.rec) return;
    this.endRec(g);
    this.grab = null;
    this.engine.endGesture();
  }

  private pick(m: Movie, x: number, y: number): string | null {
    // inside a group: its parts first, then the picked part's own box
    const p = pickedPart(this.engine);
    if (p && this.view && this.engine.isOver(p.group)) {
      const part = partAt(stageMovie(m, cameraMode.on), p.group, this.engine.frame, this.view, x, y);
      if (part) return part;
      if (inside(this.corners(m, p.view), x, y)) return p.part.id;
    }
    for (const t of m.tracks) {
      if (t.hidden) continue;
      const c = t.content.find((it) => this.engine.frame >= it.start && this.engine.frame < end(it));
      if (!c || !boxed(c)) continue;
      if (inside(this.corners(m, c), x, y)) return c.id;
    }
    return null;
  }

  private move(e: PointerEvent): void {
    const g = this.grab, m = this.engine.movie, v = this.view;
    // moved before the hold was long enough: an ordinary drag on empty Stage, which deselects
    if (this.pend && !g && e.pointerId === this.pend.pointer && Math.hypot(e.clientX - this.pend.x, e.clientY - this.pend.y) > 6) { this.dropPend(true); return; }
    if (!g || !m || !v || e.pointerId !== this.grabPointer) return;
    // a finger has to leave its landing spot before a drag starts, so a pinch beginning on content moves nothing
    if (this.slop) {
      if (Math.hypot(e.clientX - this.slop[0], e.clientY - this.slop[1]) < TOUCH_SLOP) return;
      this.slop = null;
    }
    this.lastClient = [e.clientX, e.clientY];
    const hudId = g.kind === 'move' ? g.ids[0] : g.id, hudAt = hudId ? this.find(m, hudId) : null;
    this.hud.base = hudAt ? fitBase(m, hudAt.content) : 1;
    let [x, y] = this.local(e);
    // scale and rotate read the pointer in the content's parent space, so they hold under a moving parent
    if (g.kind !== 'move') [x, y] = this.parentPt(m, g.id, x, y);
    if (g.rec) { this.recordMove(g, g.rec, m, v, x, y, e); return; }
    if (g.kind === 'move') {
      let [dx, dy] = this.moveDelta(g, m, g.ids[0], x, y, v);
      const first = g.base.get(g.ids[0]) as Pose;
      let snapV: number | null = null, snapH: number | null = null;
      // frame snapping needs the held modifier (Shift, or a second finger); the preference brings back always-on snapping to the frame
      const modifier = snapMod(e);
      this.hud.snapping(modifier && !e.altKey);
      if (!e.altKey) {
        const tol = SNAP_PX / v.scale;
        if (modifier && g.snap) {
          // the snap modifier: the content's edges and centre against the frame and the other contents
          const b = g.snap.box;
          const s = snapBox({ l: b.l + dx, t: b.t + dy, r: b.r + dx, b: b.b + dy }, g.snap.xs, g.snap.ys, tol);
          dx += s.dx; dy += s.dy; snapV = s.gx; snapH = s.gy;
        } else if (loadPrefs().stageSnapAlways) {
          const nx = first.x + dx, ny = first.y + dy;
          for (const target of [0, -m.width / 4, m.width / 4]) if (Math.abs(nx - target) < tol) { dx = target - first.x; snapV = m.width / 2 + target; break; }
          for (const target of [0, -m.height / 4, m.height / 4]) if (Math.abs(ny - target) < tol) { dy = target - first.y; snapH = m.height / 2 + target; break; }
          // guides pull the content's edges and centre (the frame's own centre and quarters win when both are near)
          const gl = guideLines(m.width, m.height, m.guides);
          if (g.snap && (gl.xs.length || gl.ys.length)) {
            const b = g.snap.box;
            const s = snapBox({ l: b.l + dx, t: b.t + dy, r: b.r + dx, b: b.b + dy }, snapV === null ? gl.xs : [], snapH === null ? gl.ys : [], tol);
            if (snapV === null && s.gx !== null) { dx += s.dx; snapV = s.gx; }
            if (snapH === null && s.gy !== null) { dy += s.dy; snapH = s.gy; }
          }
        }
      }
      this.snapLines(m, v, snapV, snapH);
      this.hud.show(e.clientX, e.clientY, { x: first.x + dx, y: first.y + dy, sx: first.sx, sy: first.sy, rot: first.rot });
      if (this.keyedIds(g.ids)) {
        this.writeKeys('Move Keyframe', g.ids, (id) => { const b = g.base.get(id) as Pose; const [ex, ey] = id === g.ids[0] ? [dx, dy] : this.moveDelta(g, m, id, x, y, v); return { x: Math.round(b.x + ex), y: Math.round(b.y + ey), scaleX: b.sx, scaleY: b.sy, rotation: b.rot }; }, g.tag);
        return;
      }
      this.composeNote(g.ids);
      this.engine.run('Move', (mv) => {
        let out = mv;
        for (const id of g.ids) {
          const b = g.base.get(id) as Pose; const [ex, ey] = id === g.ids[0] ? [dx, dy] : this.moveDelta(g, m, id, x, y, v);
          out = this.patchT(out, id, this.store(b, b.x + ex, b.y + ey, b.rot, b.sx * b.kx * b.fx, b.sy * b.ky * b.fy));
        }
        return out;
      }, g.tag);
    } else if (g.kind === 'stretch') {
      this.stretchTo(g, m, v, x, y);
    } else if (g.kind === 'scale') {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
      const ratio = Math.hypot(x - cx, y - cy) / g.d0;
      this.hud.snapping(false);
      if (this.keyedIds([g.id])) {
        // a flipped (negative) scale stays flipped while it is scaled
        const sx = Math.round(Math.sign(b.sx || 1) * Math.max(0.01, Math.abs(b.sx) * ratio) * 1000) / 1000, sy = Math.round(Math.sign(b.sy || 1) * Math.max(0.01, Math.abs(b.sy) * ratio) * 1000) / 1000;
        this.hud.show(e.clientX, e.clientY, { x: b.x, y: b.y, sx, sy, rot: b.rot });
        this.writeKeys('Scale Keyframe', [g.id], () => ({ x: b.x, y: b.y, scaleX: sx, scaleY: sy, rotation: b.rot }), g.tag);
        return;
      }
      const k = Math.round(Math.max(0.01, ratio * b.sx) * 1000) / 1000;
      this.hud.show(e.clientX, e.clientY, { x: b.x, y: b.y, sx: k, sy: k, rot: b.rot });
      this.composeNote([g.id]);
      this.engine.run('Scale', (mv) => this.patchT(mv, g.id, { ...this.store(b, b.x, b.y, b.rot, k * b.kx * b.fx, k * b.ky * b.fy), scale: k }), g.tag);
    } else {
      const b = g.base;
      const cx = v.ox + (m.width / 2 + (b.px ?? 0) + b.x) * v.scale, cy = v.oy + (m.height / 2 + (b.py ?? 0) + b.y) * v.scale;
      let deg = b.rot + ((Math.atan2(y - cy, x - cx) - g.a0) * 180) / Math.PI;
      const snapping = snapMod(e);
      if (snapping) deg = snapAngle(deg, this.keyedIds([g.id]) ? 30 : 15);
      this.hud.snapping(snapping);
      if (this.keyedIds([g.id])) {
        const r = Math.round(deg * 10) / 10;
        this.hud.show(e.clientX, e.clientY, { x: b.x, y: b.y, sx: b.sx, sy: b.sy, rot: r });
        this.writeKeys('Rotate Keyframe', [g.id], () => ({ x: b.x, y: b.y, scaleX: b.sx, scaleY: b.sy, rotation: r }), g.tag);
        return;
      }
      deg = ((deg % 360) + 540) % 360 - 180;
      const rr = Math.round(deg * 10) / 10;
      this.hud.show(e.clientX, e.clientY, { x: b.x, y: b.y, sx: b.sx, sy: b.sy, rot: rr });
      this.composeNote([g.id]);
      this.engine.run('Rotate', (mv) => this.patchT(mv, g.id, { ...this.store(b, b.x, b.y, rr, b.sx * b.kx * b.fx, b.sy * b.ky * b.fy), rotation: rr }), g.tag);
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
    const first = this.find(m, ids[0])?.content;
    if (!first) return undefined;
    const toMovie = (pts: [number, number][]): Box => boxOf(pts.map(([px, py]) => [(px - v.ox) / v.scale, (py - v.oy) / v.scale] as const));
    const { xs, ys } = frameLines(m.width, m.height);
    const gl = guideLines(m.width, m.height, m.guides);
    xs.push(...gl.xs); ys.push(...gl.ys);
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
    const c = this.find(m, g.id)?.content;
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
    // the handles are drawn from the signed key scale, so keyed stretching reads it without the base flip
    const keyedNow = this.keyedFor(c);
    const aOpp = base * k * (keyedNow ? 1 : f) * (opposite - pv);
    let s = (u - aOpp) / (grabbed - opposite);
    const floor = 0.02 * Math.abs(base);
    // the side may cross the opposite one: the content flips (a negative scale in Keyframe and Perform, a flip in Compose); only a sliver is held back
    if (Math.abs(s) < floor) s = (s < 0 ? -1 : 1) * floor;
    const shift = aOpp - s * (opposite - pv);
    const nx = b.x + (g.axis === 'x' ? shift * cs : -shift * sn), ny = b.y + (g.axis === 'x' ? shift * sn : shift * cs);
    const round = (n: number): number => Math.round(n);
    const shown = { x: nx, y: ny, sx: g.axis === 'x' ? s / k : b.sx, sy: g.axis === 'y' ? s / k : b.sy, rot: b.rot };
    this.hud.snapping(false);
    this.hud.show(this.lastClient[0], this.lastClient[1], shown);
    if (keyedNow) {
      const val = Math.round((s / k) * 1000) / 1000;
      this.writeKeys('Stretch Keyframe', [g.id], () => ({ x: round(nx), y: round(ny), scaleX: g.axis === 'x' ? val : b.sx, scaleY: g.axis === 'y' ? val : b.sy, rotation: b.rot }), g.tag);
      return;
    }
    const nk = Math.abs(s) / base;
    this.composeNote([g.id]);
    this.engine.run('Stretch', (mv) => updateAny(mv, g.id, (cc) => {
      const t = cc.transform;
      const sx = g.axis === 'x' ? nk : t.stretchX ?? 1, sy = g.axis === 'y' ? nk : t.stretchY ?? 1;
      const at = this.store(b, nx, ny, b.rot, g.axis === 'x' ? s : b.sx * b.kx * b.fx, g.axis === 'y' ? s : b.sy * b.ky * b.fy);
      const next = tops.withStretch({ ...t, x: at.x, y: at.y }, sx, sy);
      if (g.axis === 'x') next.flipH = s < 0; else next.flipV = s < 0;
      return { ...cc, transform: next };
    }), g.tag);
  }

  /** Arrow keys on the focused Stage move the selected content: 1 px, Shift 10 px, Ctrl or Cmd with Shift 100 px. */
  private arrowKey(e: KeyboardEvent): void {
    if (e.target !== this.root || e.altKey || this.nav.preview) return;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key];
    if (!d || !stageTargets(this.engine).some((c) => this.engine.isOver(c))) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? (mod ? 100 : 10) : 1;
    e.preventDefault();
    this.nudge(d[0] * step, d[1] * step);
  }

  /** Move the selection by movie pixels; a burst of nudges is one undo step. */
  nudge(dx: number, dy: number): void {
    const m = this.engine.movie;
    const sel = m ? stageTargets(this.engine).filter((c) => boxed(c) && this.engine.isOver(c) && !this.find(m, c.id)?.locked) : [];
    if (!m || !sel.length) return;
    const ids = sel.map((c) => c.id), tag = `nudge-${ids.join()}`;
    if (this.keyedIds(ids)) {
      const base = new Map(sel.map((c) => [c.id, this.pose(c)]));
      this.writeKeys('Nudge Keyframe', ids, (id) => { const b = base.get(id) as Pose; return { x: b.x + dx, y: b.y + dy, scaleX: b.sx, scaleY: b.sy, rotation: b.rot }; }, tag);
    } else {
      this.engine.run('Nudge', (mv) => ids.reduce((out, id) => updateAny(out, id, (c) => ({ ...c, transform: { ...c.transform, x: c.transform.x + dx, y: c.transform.y + dy } })), mv), tag);
    }
    window.clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => this.engine.endGesture(), 700);
  }

  /** Ends a press on empty Stage that never became a move; a click or a quick drag deselects. */
  private dropPend(deselect: boolean): void {
    const p = this.pend;
    if (!p) return;
    window.clearTimeout(p.timer);
    this.pend = null;
    for (const t of [this.canvas, this.box] as Element[]) { try { t.releasePointerCapture(p.pointer); } catch { /* not held */ } }
    if (deselect) this.engine.select([]);
  }

  private up(e: PointerEvent): void {
    if (this.pend && !this.grab && e.pointerId === this.pend.pointer) { this.dropPend(e.type === 'pointerup'); return; }
    if (!this.grab || e.pointerId !== this.grabPointer) return;
    this.root.style.removeProperty('cursor');
    const g = this.grab;
    // a click on a corner node (no drag) in Keyframe and Perform shows or hides its rotation ring
    if (g.kind === 'scale' && g.click && this.keyed() && Math.hypot(e.clientX - g.click.x, e.clientY - g.click.y) < 4) {
      this.ringAt = this.ringAt === g.click.i ? null : g.click.i;
      this.hard = true;
    }
    this.hud.release();
    this.endRec(this.grab);
    this.grab = null;
    this.engine.endGesture();
    // the gesture's caches go; one full render follows
    this.drag.drop();
    this.schedule();
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
  // hours:minutes:seconds:frame, the frame as wide as the last frame of a second
  return `${p(h)}:${p(mm)}:${p(ss)}:${p(f, String(Math.max(1, Math.ceil(fps) - 1)).length)}`;
}
