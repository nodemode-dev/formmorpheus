// Draw & Paint (Phase 4) and the Flipbook frame view (Phase 5): a full-area
// canvas over the main screen with floating chrome. The open Drawing (or one
// Flipbook frame) lives in a PaintDoc; strokes, fills and transforms edit its
// rasters and its own undo; Done (or moving to another frame) encodes the
// changed layers to pixel assets and writes them to the movie in one step.

import type { Engine } from '../engine/engine';
import * as flipOps from '../engine/flip-ops';
import { hasRowMask as flipHasRowMask, hasRowMix as flipHasRowMix, RowPreview } from '../engine/flip-draw';
import { blendCanvasOnto, isPixelBlend } from '../engine/blend';
import { flipIndexAt, flipLength, flipStartOf, locate, uid } from '../engine/model';
import * as ops from '../engine/ops';
import { BLEND_OP, type Renderer } from '../engine/render';
import type { Content, DrawingLayer, Movie, OnionSettings } from '../engine/types';
import { BRUSHES, DEFAULT_ERASE, DEFAULT_PAINT, DEFAULT_SMUDGE, brushById } from '../paint/brushes';
import { PaintDoc } from '../paint/doc';
import { historyNotice } from '../paint/history';
import { baseDiameter, setPressureCurve } from '../paint/dynamics';
import { PenInput } from '../paint/input';
import { Stroke } from '../paint/stroke';
import type { Brush, Mask, PaintTool, Point, Rect, RGB } from '../paint/types';
import { BrushPanel } from './brush-panel';
import { ColourPanel } from './colour-panel';
import { el, q, setClass, setDisabled, setHidden, setStyleVar, setText, setTitle } from './dom';
import { t as tr } from './i18n';
import { FlipStrip, type StripHost } from './flip-strip';
import { CropResizeDialog, bakeCanvas } from './paint-crop';
import { canvasOf, hasCanvas } from '../engine/canvas';
import { FlipMini } from './flip-mini';
import { icon } from './icons';
import { LayersPanel } from './layers-panel';
import { PaintSettings, loadPaintPrefs, savePaintPrefs, type PaintPrefs } from './paint-settings';
import { gesturePrefsNow } from './gestures';
import { PaintTools, type Interaction, type ToolHost } from './paint-tools';
import { ColourDrop } from './paint-drop';
import { HoldRepeat, SpinDrag, resetRotation } from './paint-gestures';
import { Loupe } from './paint-loupe';
import { PredictTail } from './paint-predict';
import { anchorOffset, canvasToScreen, isQuickPinchIn, panDelta, pinchView, rotBounds, screenToCanvas, unrotate, wrapAngle } from '../paint/viewmath';
import { toast } from './toast';
import { BrushSlots } from './brush-slots';
import { PaintClip } from './paint-clip';
import { FeelPopover, FeelStore, drawBrushCursor } from './paint-feel';
import { paintCommandDefs, paintCommandFor, type PaintCmdId } from './paint-keys';
import { ROLL_NAME, brushScale, penButton } from '../paint/feel';
import { setPressureGamma } from '../paint/dynamics';
import type { Command, Commands } from './commands';

interface BrushState { size: number; opacity: number }

const STATE_KEY = 'formmorpheus.paint.brushes';
const TOOL_KEY = 'formmorpheus.paint.tools';

function readJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback; } catch { return fallback; }
}
function writeJson(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* this session only */ }
}

const TEMPLATE = `<div class="fm-paint" hidden>
<canvas class="fm-paint-canvas"></canvas>
<div class="fm-paint-bar">
  <button class="fm-paint-mode" type="button" title="Finish (Enter); double-click to finish at once"><span class="fm-paint-mode-icon"></span><span class="fm-paint-mode-name">Drawing</span></button>
  <div class="fm-paint-words">
    <button class="fm-paint-word" type="button" data-w="settings">Settings</button>
    <button class="fm-paint-word" type="button" data-w="filters">Filters</button>
    <button class="fm-paint-word" type="button" data-w="select">Select</button>
    <button class="fm-paint-word" type="button" data-w="transform">Transform</button>
  </div>
  <div class="fm-paint-frame-label"></div>
  <div class="fm-paint-tools">
    <button class="fm-paint-tool" type="button" data-tool="paint" title="Paint (B); click again for brushes">${icon('paintbrush', 20)}</button>
    <button class="fm-paint-tool" type="button" data-tool="smudge" title="Smudge (S); click again for brushes">${icon('smudge', 20)}</button>
    <button class="fm-paint-tool" type="button" data-tool="erase" title="Erase (E); click again for brushes">${icon('eraser', 20)}</button>
    <button class="fm-paint-tool" type="button" data-tool="eyedropper" title="Eyedropper (I, or hold Alt): click the picture to pick a color">${icon('tEyedropper', 20)}</button>
    <button class="fm-paint-tool" type="button" data-tool="fill" title="Fill (G): click an area to fill it, drag sideways for the threshold; click again to stop">${icon('tBucket', 20)}</button>
    <button class="fm-paint-tool" type="button" data-tool="layers" title="Drawing layers (L)">${icon('layers', 20)}</button>
    <button class="fm-paint-colour" type="button" title="Color: click to open, hold for the previous color, drag onto the canvas to fill"><span></span></button>
  </div>
</div>
<div class="fm-paint-side">
  <div class="fm-paint-slider" data-s="size" title="Brush size ([ and ])"><div class="fm-paint-slider-fill"></div><div class="fm-paint-slider-thumb"></div></div>
  <div class="fm-paint-slider" data-s="opacity" title="Brush opacity"><div class="fm-paint-slider-fill"></div><div class="fm-paint-slider-thumb"></div></div>
  <button class="fm-paint-side-btn" type="button" data-a="undo" title="Undo (Ctrl or Cmd+Z, two-finger tap)">${icon('undo', 18)}</button>
  <button class="fm-paint-side-btn" type="button" data-a="redo" title="Redo (Shift+Ctrl or Cmd+Z, three-finger tap)">${icon('redo', 18)}</button>
</div>
<div class="fm-paint-hud" hidden><div class="fm-paint-hud-title"></div><canvas class="fm-paint-hud-dot" width="120" height="120"></canvas></div>
<div class="fm-paint-toast" hidden></div>
<div class="fm-paint-menu fm-pop" hidden>
  <button class="fm-pop-row" type="button" data-m="done">Finish</button>
  <button class="fm-pop-row" type="button" data-m="cancel">Discard changes</button>
</div>
</div>`;

export interface PaintViewDeps {
  engine: Engine;
  renderer: Renderer;
  onOpenChange: (open: boolean) => void;
}

export class PaintView {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly engine: Engine;
  private readonly renderer: Renderer;
  private readonly deps: PaintViewDeps;

  private contentId: string | null = null;
  private row = 0;
  private index = 0;
  private doc: PaintDoc | null = null;
  private busy = false;

  private tool: PaintTool = 'paint';
  private brushIds: Record<PaintTool, string>;
  private brushStates: Record<string, BrushState>;
  private prefs: PaintPrefs;
  private selection: Mask | null = null;
  private outline: Point[][] = [];
  private maskOverlay: OffscreenCanvas | null = null;

  private view = { scale: 1, ox: 0, oy: 0, rot: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private frameReq = 0;
  private dirty: Rect | null = null;
  private full = true;
  private cursor: Point | null = null;

  private readonly input: PenInput;
  private stroke: Stroke | null = null;
  /** Paint target of the live stroke: a layer id, or `mask:<id>` while a mask is painted. */
  private strokeId = '';
  /** Markers for the four remembered size and opacity values of the brush. */
  private slots: BrushSlots | null = null;
  private strokePointer = -1;
  private readonly touches = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
  private gesture: { d: number; ang: number; cx: number; cy: number; scale: number; rot: number; anchor: Point; d0: number; count: number; t: number; moved: boolean } | null = null;
  private pan: { x: number; y: number; ox: number; oy: number; id: number } | null = null;
  private space = false;
  private drop: { id: number; x: number; y: number; dragging: boolean; wait: number; px: number; py: number; hold: number; held: boolean } | null = null;
  private readonly spin = new SpinDrag();
  private readonly holdUndoBtn = new HoldRepeat(420, 80);
  private readonly holdRedoBtn = new HoldRepeat(420, 80);
  private readonly holdTouch = new HoldRepeat(450, 110);
  private pickHold: { id: number; x: number; y: number; timer: number } | null = null;
  private readonly tail = new PredictTail();
  private tailFrom: Point | null = null;
  private loupe!: Loupe;
  private dropper!: ColourDrop;
  // feel, clipboard and key additions
  private clip!: PaintClip;
  private readonly feel = new FeelStore();
  private feelPop!: FeelPopover;
  private commands: Commands | null = null;
  /** The eyedropper button or key is armed: the next press on the picture picks a color. */
  private pickArmed = false;
  private lastTool: PaintTool = 'paint';
  private lastTilt = { x: 0, y: 0, roll: 0 };
  private prevSel: Mask | null = null;
  private selHold = 0;
  private swatchDrop: { color: RGB; wait: number; px: number; py: number } | null = null;
  /** A pen barrel button or eraser end changed the tool for the stroke that is down. */
  private penTool: PaintTool | null = null;
  private live: ((ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void) | null = null;
  private interaction: Interaction | null = null;

  private playTimer = 0;
  private playAt = 0;
  /** Tinted onion frames, built once per frame and setting (rebuilding them on every repaint stalled strokes). */
  private readonly ghosts = new Map<string, { key: string; canvas: OffscreenCanvas }>();
  private pendingNav: { row: number; index: number } | null = null;
  private readonly parked = new Map<string, PaintDoc>();
  private readonly pending = new Map<string, number>();
  private readonly discarded = new WeakSet<PaintDoc>();
  private saving: Promise<void> = Promise.resolve();
  private readonly thumbs = new Map<string, { key: string; canvas: OffscreenCanvas }>();

  private readonly colour: ColourPanel;
  private readonly brushPanel: BrushPanel;
  private readonly layersPanel: LayersPanel;
  private readonly settings: PaintSettings;
  private readonly strip: FlipStrip;
  private cropDialog: CropResizeDialog | null = null;
  /** The layers the open document was loaded from (or last saved as), to tell an outside change from our own save. */
  private seenLayers: DrawingLayer[] | null = null;
  private ownRun = false;
  private readonly mini: FlipMini;
  private readonly tools: PaintTools;

  private readonly bar: HTMLElement;
  private readonly modeName: HTMLElement;
  private readonly modeIcon: HTMLElement;
  private readonly frameLabel: HTMLElement;
  private readonly colourBtn: HTMLButtonElement;
  private readonly sizeSlider: HTMLElement;
  private readonly opacitySlider: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly hud: HTMLElement;
  private readonly hudTitle: HTMLElement;
  private readonly hudDot: HTMLCanvasElement;
  private readonly toastEl: HTMLElement;
  private readonly menu: HTMLElement;
  private toastTimer = 0;
  private layersRefresh = 0;

  constructor(host: HTMLElement, deps: PaintViewDeps) {
    this.deps = deps;
    this.engine = deps.engine;
    this.renderer = deps.renderer;
    this.root = el<HTMLElement>(TEMPLATE);
    host.appendChild(this.root);
    this.canvas = q<HTMLCanvasElement>(this.root, '.fm-paint-canvas');
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.bar = q(this.root, '.fm-paint-bar');
    this.modeName = q(this.root, '.fm-paint-mode-name');
    this.modeIcon = q(this.root, '.fm-paint-mode-icon');
    this.frameLabel = q(this.root, '.fm-paint-frame-label');
    this.colourBtn = q<HTMLButtonElement>(this.root, '.fm-paint-colour');
    this.sizeSlider = q(this.root, '.fm-paint-slider[data-s="size"]');
    this.opacitySlider = q(this.root, '.fm-paint-slider[data-s="opacity"]');
    this.undoBtn = q<HTMLButtonElement>(this.root, '[data-a="undo"]');
    this.redoBtn = q<HTMLButtonElement>(this.root, '[data-a="redo"]');
    this.hud = q(this.root, '.fm-paint-hud');
    this.hudTitle = q(this.root, '.fm-paint-hud-title');
    this.hudDot = q<HTMLCanvasElement>(this.root, '.fm-paint-hud-dot');
    this.toastEl = q(this.root, '.fm-paint-toast');
    historyNotice.handler = (text) => toast(text);
    this.menu = q(this.root, '.fm-paint-menu');

    this.prefs = loadPaintPrefs();
    this.holdUndoBtn.delay = this.holdRedoBtn.delay = this.prefs.undoDelay;
    setPressureCurve(this.prefs.pressure.map(([x, y]) => ({ x, y })));
    this.brushIds = readJson<Record<PaintTool, string>>(TOOL_KEY, { paint: DEFAULT_PAINT, smudge: DEFAULT_SMUDGE, erase: DEFAULT_ERASE });
    this.brushStates = readJson<Record<string, BrushState>>(STATE_KEY, {});
    this.slots = new BrushSlots({ size: this.sizeSlider, opacity: this.opacitySlider }, {
      key: () => `${this.tool}:${this.brush().id}`,
      defaults: () => this.brush().presets,
      current: () => this.state(this.brush()),
      recall: (kind, v) => this.setState(kind === 'size' ? { size: v } : { opacity: Math.max(0.01, v) }),
      say: (t) => this.say(t),
    });

    this.input = new PenInput({ toCanvas: (x, y) => this.toCanvas(x, y), smoothing: 0, fingerPaints: this.prefs.fingerPaints });
    // Preferences > Gestures can change finger painting while this view exists
    document.addEventListener('fm:gesture-prefs', () => { this.prefs = { ...this.prefs, fingerPaints: loadPaintPrefs().fingerPaints }; this.input.fingerPaints = this.prefs.fingerPaints; });

    this.colour = new ColourPanel({ onPick: (rgb) => this.setColourChip(rgb), onSwatchDrag: (e) => this.swatchDrag(e) });
    this.brushPanel = new BrushPanel({ onPick: (b) => this.pickBrush(b) });
    this.layersPanel = new LayersPanel({ doc: () => this.doc });
    this.settings = new PaintSettings({
      prefs: () => this.prefs,
      setPrefs: (p) => this.setPrefs(p),
      onion: () => this.onion(),
      setOnion: (p, merge) => this.setOnion(p, merge),
      onionScope: () => (this.content()?.kind === 'flipbook' ? (this.content()?.onion ? 'flipbook' : 'movie') : null),
      setOnionScope: (scope) => this.setOnionScope(scope),
      onInsertPhoto: () => this.insertPhoto(),
      onCropResize: () => { void this.cropResize(); },
    });
    this.strip = new FlipStrip(this.stripHost());
    this.strip.onScrub = () => { if (this.onion().showWhileScrubbing === false) { this.full = true; this.redraw(); } };
    this.mini = new FlipMini(this.strip, this.stripHost(), this.root);
    // an Undo or Redo from the status bar changes the frames under the open strip
    this.engine.on('movie', () => {
      if (!this.isOpen() || this.busy || this.ownRun) return;
      const c = this.content();
      if (!c || (c.kind !== 'flipbook' && c.kind !== 'drawing')) return;
      if (c.kind === 'flipbook') {
        this.row = Math.max(0, Math.min(this.row, c.flip.length - 1));
        this.index = Math.max(0, Math.min(this.index, (c.flip[this.row]?.frames.length ?? 1) - 1));
        this.strip.refresh();
      }
      // the open frame's pictures were changed from outside (Undo or Redo): load them again unless there is unsaved paint
      const cur = this.frameLayers(c);
      if (cur !== this.seenLayers && this.doc && !this.doc.isChanged()) {
        this.seenLayers = cur;
        void this.loadDoc().then(() => { this.strip.invalidate(); this.full = true; this.redraw(); this.syncChrome(); });
      }
    });
    this.tools = new PaintTools(this.toolHost());
    for (const p of [this.colour.root, this.brushPanel.root, this.layersPanel.root, this.settings.root, this.strip.root, this.strip.preview.root, this.tools.root]) this.root.appendChild(p);

    this.loupe = new Loupe({
      source: this.canvas,
      dpr: () => this.dpr,
      sample: (x, y) => {
        const doc = this.doc;
        if (!doc) return null;
        const p = this.toCanvas(x, y);
        const c = doc.sampleColor(Math.floor(p.x), Math.floor(p.y), true);
        return c.a === 0 ? null : { r: c.r, g: c.g, b: c.b };
      },
    });
    this.dropper = new ColourDrop({ doc: () => this.doc, selection: () => this.selection, toCanvas: (x, y) => this.toCanvas(x, y), root: this.root });
    this.root.appendChild(this.loupe.root);
    this.root.appendChild(this.dropper.bubble);
    this.clip = new PaintClip({
      doc: () => this.doc,
      selection: () => this.selection,
      setSelection: (m) => this.setSelection(m),
      say: (t) => this.say(t),
      placed: () => this.tools.setMode('transform'),
    });
    this.feelPop = new FeelPopover({
      store: this.feel,
      globals: () => ({ stabilization: this.prefs.smoothing, motion: this.prefs.motionFilter, expression: this.prefs.expression }),
      changed: () => this.applyFeel(),
    });
    // double-click a tool button for the current brush's own Pressure and Smoothing settings
    for (const t of ['paint', 'smudge', 'erase'] as const) {
      q(this.root, `.fm-paint-tool[data-tool="${t}"]`).addEventListener('dblclick', (e) => {
        const b = this.brush(t);
        this.brushPanel.close();
        this.feelPop.open(b.id, b.name, e.clientX, e.clientY + 18);
      });
    }
    window.addEventListener('paste', (e) => {
      if (!this.isOpen() || (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      void this.clip.pasteEvent(e.clipboardData).then((done) => { if (!done) void this.clip.paste(); });
    });
    this.wire();
    this.setColourChip(this.colour.get());
    new ResizeObserver(() => this.resize()).observe(this.root);
  }

  isOpen(): boolean { return this.contentId !== null; }

  // ---------------------------------------------------------------- open / close

  async open(contentId: string, row = 0, index?: number): Promise<void> {
    const m = this.engine.movie;
    const c = m ? locate(m, contentId)?.content : null;
    if (!m || !c || (c.kind !== 'drawing' && c.kind !== 'flipbook') || this.busy) return;
    if (c.kind === 'flipbook' && !c.flip.length) { toast('This flipbook has no tracks.', 'error'); return; }
    this.busy = true;
    this.engine.stop();
    this.contentId = contentId;
    this.row = Math.max(0, Math.min(row, c.flip.length - 1));
    if (c.kind === 'flipbook') {
      const t = c.flip[this.row];
      this.index = index ?? Math.max(0, flipIndexAt(t, this.engine.frame - c.start + c.offset));
    } else this.index = 0;
    await this.loadDoc();
    setText(this.modeName, c.kind === 'flipbook' ? 'Flipbook' : 'Drawing');
    this.modeIcon.innerHTML = icon(c.kind === 'flipbook' ? 'flipbook' : 'drawing', 18);
    this.mini.dock();
    setHidden(this.strip.root, c.kind !== 'flipbook');
    setClass(this.root, 'has-strip', c.kind === 'flipbook');
    this.setSelection(null);
    this.root.hidden = false;
    this.deps.onOpenChange(true);
    this.resize();
    this.fit();
    this.syncChrome();
    this.strip.refresh();
    this.busy = false;
    // paint the canvas now, in the same task that unhides the view, so its first frame is never an empty canvas
    if (this.frameReq) { cancelAnimationFrame(this.frameReq); this.frameReq = 0; }
    this.full = true;
    this.paint();
  }

  /** Encodes the open frame and writes it to the movie; then closes unless `stay`. */
  async done(stay = false): Promise<void> {
    if (!this.contentId || this.busy) return;
    this.busy = true;
    this.cancelStroke();
    this.tools.finish();
    this.stopPlay();
    await this.commitDoc();
    this.busy = false;
    if (!stay) this.close();
  }

  discard(): void {
    if (!this.contentId) return;
    this.cancelStroke();
    this.tools.cancel();
    // a pending background save of this same picture must not write the discarded strokes
    if (this.doc) this.discarded.add(this.doc);
    this.close();
  }

  /** Throws away a stroke in progress (navigation, Finish or Discard while the pen is down). */
  private cancelStroke(): void {
    const s = this.stroke, doc = this.doc;
    this.stroke = null;
    this.strokePointer = -1;
    this.endPenTool();
    this.clearTail();
    if (!s || !doc) return;
    const r = s.cancel();
    if (r) doc.markDirty(this.strokeId || doc.active, r);
    doc.settle();
  }

  private close(): void {
    this.cancelStroke();
    this.stopPlay();
    for (const p of [this.colour, this.brushPanel, this.layersPanel, this.settings]) p.close();
    this.colour.close(true);
    this.clip.hide();
    this.feelPop.hide();
    this.pickArmed = false;
    this.prevSel = null;
    this.menu.hidden = true;
    this.dropper.cancel();
    this.dropper.stopContinue();
    this.loupe.hide();
    this.clearPickHold();
    this.holdTouch.stop();
    this.dropDoc(this.doc);
    this.doc = null;
    this.contentId = null;
    this.thumbs.clear();
    this.ghosts.clear();
    this.pendingNav = null;
    this.root.hidden = true;
    this.deps.onOpenChange(false);
  }

  private content(): Content | null {
    const m = this.engine.movie;
    return m && this.contentId ? locate(m, this.contentId)?.content ?? null : null;
  }

  private frameLayers(c: Content): DrawingLayer[] {
    if (c.kind === 'drawing') return c.layers;
    return c.flip[this.row]?.frames[this.index]?.layers ?? [];
  }

  /** Key of the open picture: the Flipbook frame id, or the Drawing's content id. */
  private frameKey(c: Content | null = this.content()): string {
    if (!c) return '';
    return c.kind === 'flipbook' ? c.flip[this.row]?.frames[this.index]?.id ?? '' : c.id;
  }

  private dropDoc(doc: PaintDoc | null): void {
    if (doc && ![...this.parked.values()].includes(doc)) doc.dispose();
  }

  private async loadDoc(): Promise<void> {
    const m = this.engine.movie as Movie;
    const c = this.content();
    if (!c) return;
    const old = this.doc;
    const k = canvasOf(c, m);
    let parked = this.parked.get(this.frameKey(c));
    // a parked frame from before a Crop and resize (or its Undo) has the old canvas size
    if (parked && (parked.width !== k.w || parked.height !== k.h)) parked = undefined;
    let doc: PaintDoc;
    if (parked) doc = parked;
    else {
      const layers = this.frameLayers(c);
      doc = layers.length ? await PaintDoc.load(k.w, k.h, layers, (id) => this.engine.assets.get(id)) : PaintDoc.blank(k.w, k.h);
    }
    if (old !== doc) this.dropDoc(old);
    doc.onChange = (what, rect) => this.docChanged(what, rect);
    this.doc = doc;
    this.seenLayers = this.frameLayers(c);
    this.layersPanel.refresh();
  }

  /**
   * Writes the open picture to the movie. PNG encoding can take most of a second at 1080p, so a frame
   * switch saves in the background: the doc is parked (and reused if the person comes back to it) until
   * its encode lands; Done waits for every save.
   */
  private async commitDoc(background = false): Promise<void> {
    const doc = this.doc;
    const c = this.content();
    if (!doc || !c || !doc.isChanged()) { if (!background) await this.saving; return; }
    const key = this.frameKey(c);
    const contentId = c.id;
    if (background) this.parked.set(key, doc);
    // a frame can be saved twice before the first save lands (left, reopened, left again): only the last
    // pending save releases it, and a failed save keeps it parked so its pixels are not lost
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    let failed = false;
    const job = this.saving.then(() => this.encodeDoc(doc, contentId, key)).catch(() => { failed = true; toast('A frame could not be saved.', 'error'); });
    this.saving = job.finally(() => {
      const left = (this.pending.get(key) ?? 1) - 1;
      if (left > 0) { this.pending.set(key, left); return; }
      this.pending.delete(key);
      if (!failed && this.parked.get(key) === doc) {
        this.parked.delete(key);
        if (this.doc !== doc) doc.dispose();
      }
    });
    if (!background) await this.saving;
  }

  private async encodeDoc(doc: PaintDoc, contentId: string, key: string): Promise<void> {
    if (!doc.isChanged() || this.discarded.has(doc)) return;
    const out = await doc.encode(() => uid('p'));
    const blobs = new Map<string, Blob>();
    for (const { asset, blob } of out.assets) { this.engine.assets.set(asset.id, blob); blobs.set(asset.id, blob); }
    await this.renderer.preload(blobs);
    const m = this.engine.movie;
    const c = m ? locate(m, contentId)?.content : null;
    if (!c) return;
    let row = -1, index = -1;
    if (c.kind === 'flipbook') c.flip.forEach((t, r) => { const i = t.frames.findIndex((f) => f.id === key); if (i >= 0) { row = r; index = i; } });
    if (c.kind === 'flipbook' && row < 0) return;
    const label = c.kind === 'flipbook' ? `Paint ${c.name} frame ${index + 1}` : `Paint ${c.name}`;
    this.ownRun = true;
    try {
      this.engine.run(label, (mv) => {
        const assets = { ...mv.assets };
        for (const { asset } of out.assets) assets[asset.id] = asset;
        return ops.updateContent({ ...mv, assets }, contentId, (x) => (x.kind === 'flipbook' ? flipOps.setFrameLayers(x, row, index, out.layers) : { ...x, layers: out.layers }));
      });
    } finally { this.ownRun = false; }
    // the saved layers stand for the picture now open when it is the frame just written
    const now = this.content();
    if (now && this.frameKey(now) === key) this.seenLayers = this.frameLayers(now);
    if (this.isOpen()) { this.strip.refresh(); this.full = true; this.redraw(); }
  }

  // ---------------------------------------------------------------- flipbook frames

  private async gotoFrame(row: number, index: number): Promise<void> {
    const c = this.content();
    if (!c || c.kind !== 'flipbook') return;
    if (this.busy) { this.pendingNav = { row, index }; return; }
    if (row === this.row && index === this.index) return;
    this.busy = true;
    this.cancelStroke();
    this.tools.finish();
    await this.commitDoc(true);
    const fresh = this.content();
    if (!fresh) { this.busy = false; return; }
    this.row = Math.max(0, Math.min(row, fresh.flip.length - 1));
    this.index = Math.max(0, Math.min(index, fresh.flip[this.row].frames.length - 1));
    await this.loadDoc();
    this.engine.seek(fresh.start - fresh.offset + flipStartOf(fresh.flip[this.row], this.index));
    this.busy = false;
    this.syncChrome();
    this.strip.refresh();
    this.redraw();
    const next = this.pendingNav;
    this.pendingNav = null;
    if (next) void this.gotoFrame(next.row, next.index);
  }

  /** The frame the next step is relative to: a queued move, else the open frame. */
  private navBase(): { row: number; index: number } {
    return this.pendingNav ?? { row: this.row, index: this.index };
  }

  private stripHost(): StripHost {
    return {
      content: () => { const c = this.content(); return c?.kind === 'flipbook' ? c : null; },
      row: () => this.row,
      index: () => (this.playTimer ? this.playIndex() : this.index),
      select: (row, index) => { this.stopPlay(); void this.gotoFrame(row, index); },
      run: (label, fn, merge) => { void this.runFlip(label, fn, merge); },
      playing: () => this.playTimer !== 0,
      togglePlay: () => { if (this.playTimer) this.stopPlay(); else void this.startPlay(); },
      thumb: (row, index, w, h) => this.frameThumb(row, index, w, h),
      fps: () => this.engine.movie?.fps ?? 24,
      movieSize: () => { const m = this.engine.movie; if (!m) return null; const k = canvasOf(this.content(), m); return { w: k.w, h: k.h }; },
      drawPreview: (ctx, w, h, local) => this.drawPreview(ctx, w, h, local),
    };
  }

  /** One loop frame of the open flipbook for the mini preview; the open frame is drawn live. Rows with masks go through the renderer (saved pixels). */
  private drawPreview(ctx: CanvasRenderingContext2D, w: number, h: number, local: number): void {
    const c = this.content();
    const m = this.engine.movie;
    if (!c || !m || c.kind !== 'flipbook') return;
    ctx.imageSmoothingQuality = 'high';
    if (!m.transparent) { ctx.fillStyle = m.background; ctx.fillRect(0, 0, w, h); }
    if (flipHasRowMask(c)) { this.renderer.thumb(ctx, m, { ...c, offset: 0 }, local + c.offset, w, h, true); return; }
    const g = ctx as unknown as OffscreenCanvasRenderingContext2D;
    const kv = canvasOf(c, m);
    ctx.scale(w / kv.w, h / kv.h);
    for (let i = c.flip.length - 1; i >= 0; i--) {
      const t = c.flip[i];
      if (t.hidden || t.opacity <= 0) continue;
      const fi = flipIndexAt(t, local + c.offset);
      if (fi < 0) continue;
      const f = t.frames[fi];
      ctx.save();
      ctx.globalAlpha = t.opacity;
      const live = i === this.row && fi === this.index && !this.playTimer ? this.doc : this.parked.get(f.id);
      if (live) live.composite(ctx); else this.renderer.layersInto(g, f.layers, m, { w: kv.w, h: kv.h });
      ctx.restore();
    }
  }

  /** A frame edit from the strip: the open frame is saved first so the edit sees its pixels; then the open frame is reloaded if it moved or vanished. */
  private async runFlip(label: string, fn: (c: Content) => Content, merge?: string): Promise<void> {
    if (!this.contentId || this.busy) return;
    this.busy = true;
    this.cancelStroke();
    this.tools.finish();
    await this.commitDoc();
    const before = this.content();
    const openId = before?.flip[this.row]?.frames[this.index]?.id;
    const rowId = before?.flip[this.row]?.id;
    this.engine.run(label, (m) => ops.updateContent(m, this.contentId as string, fn), merge ?? null);
    const after = this.content();
    if (after) {
      const r = Math.max(0, after.flip.findIndex((t) => t.id === rowId));
      const t = after.flip[r];
      const i = t ? t.frames.findIndex((f) => f.id === openId) : -1;
      const nextIndex = i >= 0 ? i : Math.min(this.index, (t?.frames.length ?? 1) - 1);
      const sameLayers = i >= 0 && t.frames[i].layers === before?.flip[this.row]?.frames[this.index]?.layers;
      this.row = r;
      if (!sameLayers || i < 0) { this.index = Math.max(0, nextIndex); await this.loadDoc(); } else this.index = i;
    }
    this.busy = false;
    this.syncChrome();
    this.strip.refresh();
    this.redraw();
    // the strip selects right after an edit (a new frame, a new track): that move waited for this edit
    const next = this.pendingNav;
    this.pendingNav = null;
    if (next) void this.gotoFrame(next.row, next.index);
  }

  private playIndex(): number {
    const c = this.content();
    const t = c?.flip[this.row];
    return t ? Math.max(0, flipIndexAt(t, this.playAt)) : 0;
  }

  private async startPlay(): Promise<void> {
    const c = this.content();
    if (!c || c.kind !== 'flipbook') return;
    await this.done(true);
    const t = this.content()?.flip[this.row];
    if (!t) return;
    this.playAt = flipStartOf(t, this.index);
    const fps = this.engine.movie?.fps ?? 24;
    this.playTimer = window.setInterval(() => {
      this.playAt = (this.playAt + 1) % Math.max(1, flipLength(t));
      this.full = true;
      this.redraw();
      this.strip.refresh();
      this.syncChrome();
    }, 1000 / fps);
    this.strip.refresh();
    this.redraw();
  }

  private stopPlay(): void {
    if (!this.playTimer) return;
    clearInterval(this.playTimer);
    this.playTimer = 0;
    const at = this.playIndex();
    this.strip.refresh();
    if (at !== this.index) void this.gotoFrame(this.row, at);
    else this.redraw();
  }

  private frameThumb(row: number, index: number, w: number, h: number): CanvasImageSource | null {
    const c = this.content();
    const m = this.engine.movie;
    const f = c?.flip[row]?.frames[index];
    if (!c || !m || !f) return null;
    const liveDoc = row === this.row && index === this.index && this.doc && !this.playTimer ? this.doc : this.parked.get(f.id) ?? null;
    const live = !!liveDoc;
    const key = liveDoc ? `live:${liveDoc.layers.map((l) => l.version).join('.')}:${w}x${h}` : `${f.layers.map((l) => `${l.pixels}:${l.visible ? 1 : 0}:${l.opacity}:${l.blend}:${l.parent ?? ''}:${l.mask ?? ''}${l.maskOn === false ? 'off' : ''}`).join('|')}:${w}x${h}`;
    const id = `${row}:${f.id}`;
    const have = this.thumbs.get(id);
    if (have && have.key === key) return have.canvas;
    const cv = have?.canvas.width === w && have.canvas.height === h ? have.canvas : new OffscreenCanvas(w, h);
    const x = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, w, h);
    x.fillStyle = m.background;
    x.fillRect(0, 0, w, h);
    const kv = canvasOf(c, m);
    const s = Math.min(w / kv.w, h / kv.h);
    x.setTransform(s, 0, 0, s, (w - kv.w * s) / 2, (h - kv.h * s) / 2);
    if (live && liveDoc) liveDoc.composite(x);
    else this.renderer.layersInto(x, f.layers, m, { w: kv.w, h: kv.h });
    this.thumbs.set(id, { key, canvas: cv });
    return cv;
  }

  // ---------------------------------------------------------------- onion skins

  private onion(): OnionSettings {
    const c = this.content();
    return c?.onion ?? this.engine.movie?.onion ?? { enabled: false, backFrames: 0, foreFrames: 0, opacity: 0.4, tint: true, backColor: '#ff4f7a', foreColor: '#3a9bff', blendPrimary: false };
  }

  private setOnion(p: Partial<OnionSettings>, merge?: string): void {
    const c = this.content();
    if (!c) return;
    if (c.onion) this.engine.run('Onion skins', (m) => ops.updateContent(m, c.id, (x) => ({ ...x, onion: { ...(x.onion as OnionSettings), ...p } })), merge ?? null);
    else this.engine.run('Onion skins', (m) => ({ ...m, onion: { ...m.onion, ...p } }), merge ?? null);
    this.settings.refresh();
    this.full = true;
    this.redraw();
  }

  private setOnionScope(scope: 'flipbook' | 'movie'): void {
    const c = this.content();
    const m = this.engine.movie;
    if (!c || !m) return;
    this.engine.run('Onion skins', (mv) => ops.updateContent(mv, c.id, (x) => ({ ...x, onion: scope === 'flipbook' ? { ...m.onion } : null })));
    this.settings.refresh();
    this.full = true;
    this.redraw();
  }

  private drawOnions(ctx: CanvasRenderingContext2D, c: Content, m: Movie): void {
    const o = this.onion();
    if (!o.enabled || c.kind !== 'flipbook' || this.playTimer) return;
    if (o.showWhileScrubbing === false && this.strip.scrubbing) return;
    const t = c.flip[this.row];
    if (!t) return;
    const kv = canvasOf(c, m), cw = kv.w, ch = kv.h;
    const side = (count: number, dir: -1 | 1, colour: string): void => {
      const opacity = (dir < 0 ? o.backOpacity : o.foreOpacity) ?? o.opacity;
      const tint = (dir < 0 ? o.backTint : o.foreTint) ?? o.tint;
      for (let k = count; k >= 1; k--) {
        const i = this.index + dir * k;
        if (i < 0 || i >= t.frames.length) continue;
        const f = t.frames[i];
        const parked = this.parked.get(f.id);
        if (!parked && f.layers.every((l) => !l.pixels || !l.visible)) continue;
        const key = `${parked ? `live:${parked.layers.map((l) => l.version).join('.')}` : f.layers.map((l) => `${l.pixels}:${l.visible ? 1 : 0}:${l.opacity}:${l.blend}:${l.parent ?? ''}:${l.mask ?? ''}${l.maskOn === false ? 'off' : ''}`).join('|')}:${tint ? colour : ''}:${cw}x${ch}`;
        const have = this.ghosts.get(f.id);
        if (have && have.key === key) {
          ctx.globalAlpha = opacity * (1 - (k - 1) / (count + 1));
          ctx.drawImage(have.canvas, 0, 0);
          continue;
        }
        const canvas = have && have.canvas.width === cw && have.canvas.height === ch ? have.canvas : new OffscreenCanvas(cw, ch);
        const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        let ready = true;
        if (!parked) for (const l of f.layers) if (l.pixels && l.visible && !this.renderer.bitmap(l.pixels)) ready = false;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.clearRect(0, 0, cw, ch);
        if (parked) parked.composite(g); else this.renderer.layersInto(g, f.layers, m, { w: cw, h: ch });
        if (tint) {
          g.globalCompositeOperation = 'source-atop';
          g.globalAlpha = 0.8;
          g.fillStyle = colour;
          g.fillRect(0, 0, cw, ch);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        if (ready) this.ghosts.set(f.id, { key, canvas });
        if (this.ghosts.size > 24) this.ghosts.delete(this.ghosts.keys().next().value as string);
        ctx.globalAlpha = opacity * (1 - (k - 1) / (count + 1));
        ctx.drawImage(canvas, 0, 0);
      }
      ctx.globalAlpha = 1;
    };
    side(o.backFrames, -1, o.backColor);
    side(o.foreFrames, 1, o.foreColor);
  }

  // ---------------------------------------------------------------- drawing the view

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    const first = this.cssW === 0;
    this.cssW = r.width;
    this.cssH = r.height;
    this.dpr = dpr;
    // setting a canvas size clears it, even to the same value: only touch it when it changes (the
    // ResizeObserver also fires right after the view is shown, and a clear there showed one empty frame)
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (first && this.contentId) this.fit();
    this.full = true;
    this.redraw();
  }

  private fit(): void {
    const m = this.engine.movie;
    if (!m || !this.cssW) return;
    const padX = 72, padTop = 64, padBottom = this.content()?.kind === 'flipbook' ? 200 : 32;
    // fit the canvas and the Stage together (view pixels are canvas pixels; the Stage sits at -canvas.x, -canvas.y)
    const kv = canvasOf(this.content(), m);
    const ux0 = Math.min(0, -kv.x), uy0 = Math.min(0, -kv.y), ux1 = Math.max(kv.w, m.width - kv.x), uy1 = Math.max(kv.h, m.height - kv.y);
    const uw = ux1 - ux0, uh = uy1 - uy0;
    const s = Math.min((this.cssW - padX * 2) / uw, (this.cssH - padTop - padBottom) / uh);
    this.view.scale = Math.max(0.02, s);
    this.view.rot = 0;
    this.view.ox = (this.cssW - uw * this.view.scale) / 2 - ux0 * this.view.scale;
    this.view.oy = padTop + (this.cssH - padTop - padBottom - uh * this.view.scale) / 2 - uy0 * this.view.scale;
    this.full = true;
    this.redraw();
  }

  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return screenToCanvas(this.view, clientX - r.left, clientY - r.top);
  }

  /** Grow the dirty box by a rectangle given in screen pixels. */
  private addDirty(sr: Rect): void {
    if (this.dirty) {
      const x0 = Math.min(this.dirty.x, sr.x), y0 = Math.min(this.dirty.y, sr.y);
      const x1 = Math.max(this.dirty.x + this.dirty.w, sr.x + sr.w), y1 = Math.max(this.dirty.y + this.dirty.h, sr.y + sr.h);
      this.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    } else this.dirty = sr;
  }

  private redraw(rect?: Rect): void {
    if (rect && !this.full) {
      const v = this.view;
      const pad = 2;
      const ur = { x: v.ox + rect.x * v.scale, y: v.oy + rect.y * v.scale, w: rect.w * v.scale, h: rect.h * v.scale };
      const b = rotBounds(ur, v.rot);
      this.addDirty({ x: Math.floor(b.x) - pad, y: Math.floor(b.y) - pad, w: Math.ceil(b.w) + pad * 2 + 1, h: Math.ceil(b.h) + pad * 2 + 1 });
    } else if (!rect) this.full = true;
    if (this.frameReq) return;
    this.frameReq = requestAnimationFrame(() => { this.frameReq = 0; this.paint(); });
  }

  private paint(): void {
    const m = this.engine.movie;
    const c = this.content();
    const ctx = this.ctx;
    if (!m || !c || !this.doc || this.root.hidden) return;
    const v = this.view, d = this.dpr;
    ctx.save();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (!this.full && this.dirty) {
      ctx.beginPath();
      ctx.rect(this.dirty.x, this.dirty.y, this.dirty.w, this.dirty.h);
      if (this.cursorBox) ctx.rect(this.cursorBox.x, this.cursorBox.y, this.cursorBox.w, this.cursorBox.h);
      ctx.clip();
    }
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = getComputedStyle(this.root).getPropertyValue('--fm-paint-backdrop') || '#1b1b1d';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const kv = canvasOf(c, m);
    const own = hasCanvas(c);
    const w = kv.w * v.scale, h = kv.h * v.scale;
    ctx.setTransform(this.rotM());
    ctx.save();
    roundRect(ctx, v.ox, v.oy, w, h, own ? 0 : 12);
    ctx.clip();
    if (m.transparent) { ctx.fillStyle = this.checker(ctx); ctx.fillRect(v.ox, v.oy, w, h); }
    else { ctx.fillStyle = m.background; ctx.fillRect(v.ox, v.oy, w, h); }
    if (own) {
      // the backstage part of the canvas (outside the Stage) reads darker
      ctx.beginPath();
      ctx.rect(v.ox, v.oy, w, h);
      ctx.rect(v.ox - kv.x * v.scale, v.oy - kv.y * v.scale, m.width * v.scale, m.height * v.scale);
      ctx.fillStyle = 'rgba(12,12,16,0.5)';
      ctx.fill('evenodd');
    }
    ctx.setTransform(this.rotM());
    ctx.transform(v.scale, 0, 0, v.scale, v.ox, v.oy);
    ctx.imageSmoothingQuality = 'high';
    // rows with a blend, clipping or mask draw through surfaces, as the Stage does
    const mixed = c.kind === 'flipbook' && flipHasRowMix(c);
    if (this.playTimer && c.kind === 'flipbook') {
      if (mixed) this.drawMixed(ctx, c, m, false); else this.drawRows(ctx, c, m, 'all');
    } else {
      // blend primary frame: the ghosts are drawn over the current frame so they read through it
      const over = this.onion().blendPrimary;
      if (!over) this.drawOnions(ctx, c, m);
      if (c.kind === 'flipbook' && !mixed) this.drawRows(ctx, c, m, 'below');
      if (mixed) this.drawMixed(ctx, c, m, true);
      else this.doc.composite(ctx, this.live ?? undefined, this.canvasRegion(ctx, m));
      if (over) this.drawOnions(ctx, c, m);
      if (c.kind === 'flipbook' && !mixed) this.drawRows(ctx, c, m, 'above');
    }
    this.tail.draw(ctx);
    if (this.maskOverlay && this.prefs.maskVisibility > 0) {
      ctx.globalAlpha = this.prefs.maskVisibility;
      ctx.drawImage(this.maskOverlay, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.setTransform(this.rotM());
    this.drawOutline(ctx);
    this.tools.drawOverlay(ctx, v);
    if (own) {
      // the Stage as a dashed line, the canvas bounds in yellow
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.strokeRect(v.ox - kv.x * v.scale, v.oy - kv.y * v.scale, m.width * v.scale, m.height * v.scale);
      ctx.restore();
      ctx.strokeStyle = '#e8c53a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(v.ox, v.oy, w, h);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, v.ox, v.oy, w, h, 12);
      ctx.stroke();
    }
    this.drawCursor(ctx);
    ctx.restore();
    this.full = false;
    this.dirty = null;
  }

  private cursorBox: Rect | null = null;

  private drawCursor(ctx: CanvasRenderingContext2D): void {
    const p = this.cursor;
    this.cursorBox = null;
    if (!p || !this.cursorShown() || this.interaction || this.tools.mode() !== 'paint' || this.loupe.active || this.dropper.active || this.pickArmed) return;
    const b = this.brush();
    const st = this.state(b);
    const rr = this.cursorRadius(b, st.size);
    const sx = this.view.ox + p.x * this.view.scale, sy = this.view.oy + p.y * this.view.scale;
    drawBrushCursor(ctx, { x: sx, y: sy, r: rr, style: this.prefs.outline, colour: this.colour.get(), brush: b, tiltX: this.lastTilt.x, tiltY: this.lastTilt.y, roll: this.rollOn(b) ? this.lastTilt.roll : 0, stroking: !!this.stroke });
    const at = canvasToScreen(this.view, p.x, p.y);
    const ext = this.cursorExtent(rr);
    this.cursorBox = { x: at.x - ext - 3, y: at.y - ext - 3, w: ext * 2 + 6, h: ext * 2 + 6 };
  }

  /** Cursor visibility: hover shows it only between strokes, painting only during one. */
  private cursorShown(): boolean {
    const m = this.prefs.cursorMode;
    return m === 'both' || (m === 'hover' && !this.stroke) || (m === 'painting' && !!this.stroke);
  }

  /** The outline can grow with tilt for a brush-shaped outline, so its repaint box does too. */
  private cursorExtent(r: number): number { return this.prefs.outline === 'brush' ? r * 2.6 : r; }

  private rollOn(b: Brush): boolean { return this.feel.get(b.id).roll ?? ROLL_NAME.test(b.name); }

  /** Device scale times the canvas rotation: the base matrix every view-space drawing starts from. */
  /** The part of the picture a dirty repaint touches (the clip, mapped back to movie pixels); undefined for a full repaint. */
  private canvasRegion(ctx: CanvasRenderingContext2D, m: Movie): Rect | undefined {
    if (this.full || !this.dirty) return undefined;
    const boxes = this.cursorBox ? [this.dirty, this.cursorBox] : [this.dirty];
    const inv = ctx.getTransform().inverse();
    const d = this.dpr;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
      for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
        const p = inv.transformPoint({ x: px * d, y: py * d });
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    const kv = canvasOf(this.content(), m);
    x1 = Math.min(kv.w, Math.ceil(x1) + 2); y1 = Math.min(kv.h, Math.ceil(y1) + 2);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 };
  }

  private rotM(): DOMMatrix {
    const m = new DOMMatrix().scaleSelf(this.dpr);
    return this.view.rot ? m.rotateSelf((this.view.rot * 180) / Math.PI) : m;
  }

  /** Brush outline radius in screen pixels: with dynamic scaling the brush keeps its screen size, else its canvas size. */
  private cursorRadius(b: Brush, size: number): number {
    const dia = baseDiameter(b, size);
    const m = this.engine.movie;
    const sc = brushScale(this.prefs.scaling, this.view.scale, m?.width ?? 1920, m?.height ?? 1080);
    return Math.max(2, (sc.screenFixed ? dia : dia * sc.k * this.view.scale) / 2);
  }

  private readonly rowPreview = new RowPreview();

  private drawMixed(ctx: CanvasRenderingContext2D, c: Content, m: Movie, editing: boolean): void {
    const local = this.playTimer ? this.playAt : flipStartOf(c.flip[this.row], this.index);
    const live = editing ? { row: this.row, draw: (g: OffscreenCanvasRenderingContext2D) => this.doc?.composite(g, this.live ?? undefined) } : { row: -1, draw: () => undefined };
    this.rowPreview.draw(ctx, c, local, live, (g, l) => { const kv = canvasOf(c, m); this.renderer.layersInto(g, l, m, { w: kv.w, h: kv.h }); }, (b) => BLEND_OP[b],
      (g, s, b, alpha) => { if (!isPixelBlend(b)) return false; blendCanvasOnto(g, s, b, alpha); return true; });
  }

  private drawRows(ctx: CanvasRenderingContext2D, c: Content, m: Movie, which: 'below' | 'above' | 'all'): void {
    const g = ctx as unknown as OffscreenCanvasRenderingContext2D;
    for (let i = c.flip.length - 1; i >= 0; i--) {
      if (which === 'below' && i <= this.row) continue;
      if (which === 'above' && i >= this.row) continue;
      const t = c.flip[i];
      if (t.hidden || t.opacity <= 0) continue;
      const local = this.playTimer ? this.playAt : flipStartOf(c.flip[this.row], this.index);
      const fi = flipIndexAt(t, local);
      if (fi < 0) continue;
      ctx.save();
      ctx.globalAlpha = t.opacity;
      const kv = canvasOf(c, m);
      this.renderer.layersInto(g, t.frames[fi].layers, m, { w: kv.w, h: kv.h });
      ctx.restore();
    }
  }

  private drawOutline(ctx: CanvasRenderingContext2D): void {
    if (!this.outline.length) return;
    const v = this.view;
    ctx.beginPath();
    for (const loop of this.outline) {
      loop.forEach((p, i) => { const x = v.ox + p.x * v.scale, y = v.oy + p.y * v.scale; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private checkerPattern: CanvasPattern | null = null;
  private checker(ctx: CanvasRenderingContext2D): CanvasPattern | string {
    if (this.checkerPattern) return this.checkerPattern;
    const t = new OffscreenCanvas(16, 16);
    const x = t.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#d9d9d9'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    this.checkerPattern = ctx.createPattern(t, 'repeat');
    return this.checkerPattern ?? '#ffffff';
  }

  private docChanged(what: 'pixels' | 'layers' | 'active', rect?: Rect): void {
    if (what === 'pixels' && rect) this.redraw(rect);
    else { this.full = true; this.redraw(); }
    if (what !== 'pixels') this.layersPanel.refresh();
    else if (!this.layersRefresh) this.layersRefresh = window.setTimeout(() => { this.layersRefresh = 0; this.layersPanel.refresh(); if (this.content()?.kind === 'flipbook') this.strip.invalidate(); }, 250);
    this.syncUndo();
  }

  // ---------------------------------------------------------------- chrome

  private syncChrome(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('.fm-paint-tool[data-tool]')) {
      const t = b.dataset.tool;
      const filling = this.dropper.continuing !== null;
      setClass(b, 'is-active', (t === this.tool && this.tools.mode() === 'paint' && !this.pickArmed && !filling) || (t === 'layers' && this.layersPanel.isOpen()) || (t === 'eyedropper' && this.pickArmed) || (t === 'fill' && filling));
      setClass(b, 'is-filling', t === 'fill' && filling);
    }
    for (const b of this.root.querySelectorAll<HTMLElement>('.fm-paint-word')) {
      const w = b.dataset.w;
      setClass(b, 'is-active', (w === 'settings' && this.settings.isOpen()) || (w === this.tools.mode()));
    }
    const c = this.content();
    setText(this.frameLabel, c?.kind === 'flipbook' ? `${c.flip[this.row]?.name ?? ''} · frame ${(this.playTimer ? this.playIndex() : this.index) + 1} of ${c.flip[this.row]?.frames.length ?? 0}` : '');
    const st = this.state(this.brush());
    setStyleVar(this.sizeSlider, '--v', String(st.size));
    setStyleVar(this.opacitySlider, '--v', String(st.opacity));
    setTitle(this.sizeSlider, tr('Brush size {p}%').replace('{p}', String(Math.round(st.size * 100))));
    setTitle(this.opacitySlider, `Brush opacity ${Math.round(st.opacity * 100)}%`);
    this.slots?.sync();
    setClass(this.root, 'is-side-right', this.prefs.sidebarRight);
    this.syncUndo();
  }

  private syncUndo(): void {
    const d = this.doc;
    setDisabled(this.undoBtn, !d?.canUndo());
    setDisabled(this.redoBtn, !d?.canRedo());
    setTitle(this.undoBtn, d?.undoLabel() ? `Undo ${d.undoLabel()}` : 'Nothing to undo');
    setTitle(this.redoBtn, d?.redoLabel() ? `Redo ${d.redoLabel()}` : 'Nothing to redo');
  }

  private setColourChip(rgb: RGB): void {
    setStyleVar(this.colourBtn, '--c', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
  }

  private brush(tool: PaintTool = this.tool): Brush {
    return brushById(this.brushIds[tool]) ?? brushById(tool === 'paint' ? DEFAULT_PAINT : tool === 'smudge' ? DEFAULT_SMUDGE : DEFAULT_ERASE) ?? BRUSHES[0];
  }

  private state(b: Brush): BrushState {
    return this.brushStates[`${this.tool}:${b.id}`] ?? { size: b.presets[0]?.size ?? 0.3, opacity: b.presets[0]?.opacity ?? 1 };
  }

  private setState(p: Partial<BrushState>): void {
    const b = this.brush();
    this.brushStates[`${this.tool}:${b.id}`] = { ...this.state(b), ...p };
    writeJson(STATE_KEY, this.brushStates);
    this.syncChrome();
  }

  private pickBrush(b: Brush): void {
    this.brushIds[this.tool] = b.id;
    writeJson(TOOL_KEY, this.brushIds);
    this.syncChrome();
  }

  private setTool(t: PaintTool): void {
    this.dropper.stopContinue();
    this.pickArmed = false;
    if (this.tool !== t) this.lastTool = this.tool;
    if (this.tools.mode() !== 'paint') this.tools.setMode('paint');
    if (this.tool === t && !this.brushPanel.isOpen()) {
      const b = q<HTMLElement>(this.root, `.fm-paint-tool[data-tool="${t}"]`);
      this.closePanels(this.brushPanel);
      this.brushPanel.open(b, t, this.brush(t).id);
    } else {
      this.tool = t;
      this.brushPanel.close();
    }
    this.syncChrome();
  }

  private closePanels(except?: { close(): void }): void {
    for (const p of [this.colour, this.brushPanel, this.layersPanel, this.settings]) if (p !== except) p.close();
  }

  private setPrefs(p: Partial<PaintPrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    savePaintPrefs(this.prefs);
    if (p.pressure) setPressureCurve(this.prefs.pressure.map(([x, y]) => ({ x, y })));
    this.input.fingerPaints = this.prefs.fingerPaints;
    this.holdUndoBtn.delay = this.holdRedoBtn.delay = this.prefs.undoDelay;
    this.syncChrome();
    this.full = true;
    this.redraw();
  }

  /** A per-brush feel change: the next stroke reads it; the pressure curve may need to switch now. */
  private applyFeel(): void {
    this.gammaOwn = true;
    this.full = true;
    this.redraw();
  }

  private gammaOwn = false;

  private say(text: string): void {
    setText(this.toastEl, text);
    setHidden(this.toastEl, false);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => setHidden(this.toastEl, true), 1400);
  }

  private showHud(kind: 'size' | 'opacity'): void {
    const st = this.state(this.brush());
    setText(this.hudTitle, kind === 'size' ? `Size ${Math.round(st.size * 100)}%` : `Opacity ${Math.round(st.opacity * 100)}%`);
    setHidden(this.hud, false);
    const x = this.hudDot.getContext('2d') as CanvasRenderingContext2D;
    x.clearRect(0, 0, 120, 120);
    const b = this.brush();
    const dia = Math.min(110, Math.max(2, baseDiameter(b, st.size) * Math.min(1, this.view.scale * 2)));
    const rgb = this.colour.get();
    x.globalAlpha = st.opacity;
    x.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    x.beginPath();
    x.arc(60, 60, dia / 2, 0, Math.PI * 2);
    x.fill();
    x.globalAlpha = 1;
  }

  /** Settings > Crop and resize: asks, saves the open frame, re-bakes the pixels as new assets, then reloads the frame. */
  private async cropResize(): Promise<void> {
    const c = this.content();
    const m = this.engine.movie;
    if (!c || !m || this.busy || !this.contentId) return;
    this.cropDialog ??= new CropResizeDialog();
    const k = canvasOf(c, m);
    // a small flat picture of the open frame for the dialog's preview
    let picture: OffscreenCanvas | null = null;
    if (this.doc) {
      const sc = Math.min(1, 1024 / Math.max(k.w, k.h));
      picture = new OffscreenCanvas(Math.max(1, Math.round(k.w * sc)), Math.max(1, Math.round(k.h * sc)));
      const g = picture.getContext('2d') as OffscreenCanvasRenderingContext2D;
      g.scale(sc, sc);
      this.doc.composite(g);
    }
    const p = await this.cropDialog.open2({ stage: { w: m.width, h: m.height, background: m.background, transparent: m.transparent }, canvas: k, picture, flipbook: c.kind === 'flipbook' });
    if (!p || !this.contentId) return;
    if (p.rect.x === k.x && p.rect.y === k.y && p.rect.w === k.w && p.rect.h === k.h) return;
    this.busy = true;
    this.cancelStroke();
    this.tools.finish();
    await this.commitDoc();
    const now = this.content();
    if (!now) { this.busy = false; return; }
    const baked = await bakeCanvas(this.engine, now, p);
    const blobs = new Map<string, Blob>();
    for (const { asset, blob } of baked.assets) { this.engine.assets.set(asset.id, blob); blobs.set(asset.id, blob); }
    await this.renderer.preload(blobs);
    const id = this.contentId;
    this.engine.run('Crop and resize', (mv) => {
      const assets = { ...mv.assets };
      for (const { asset } of baked.assets) assets[asset.id] = asset;
      return ops.updateContent({ ...mv, assets }, id, () => baked.content);
    });
    await this.loadDoc();
    this.busy = false;
    this.fit();
    this.syncChrome();
    this.strip.invalidate();
    this.full = true;
    this.redraw();
  }

  private insertPhoto(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      const doc = this.doc;
      const m = this.engine.movie;
      if (!f || !doc || !m) return;
      void createImageBitmap(f).then((bmp) => {
        const layer = doc.addLayer(undefined, f.name.replace(/\.[^.]+$/, '') || 'Photo');
        const m = doc; // the photo fits the canvas, not the movie
        const cv = new OffscreenCanvas(m.width, m.height);
        const x = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
        const s = Math.min(1, m.width / bmp.width, m.height / bmp.height);
        x.drawImage(bmp, (m.width - bmp.width * s) / 2, (m.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
        bmp.close();
        const before = new Uint8ClampedArray(layer.raster.data);
        layer.raster.data.set(x.getImageData(0, 0, m.width, m.height).data);
        const rect = { x: 0, y: 0, w: m.width, h: m.height };
        doc.markDirty(layer.id, rect);
        doc.commitPatch({ layer: layer.id, rect, before, after: new Uint8ClampedArray(layer.raster.data) }, 'Insert photo');
      });
    });
    input.click();
  }

  // ---------------------------------------------------------------- selection

  private setSelection(m: Mask | null): void {
    if (this.selection && this.selection !== m) this.prevSel = this.selection;
    this.selection = m;
    this.outline = m ? this.tools.outlineOf(m) : [];
    this.maskOverlay = null;
    if (m) {
      const cv = new OffscreenCanvas(m.width, m.height);
      const x = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const img = x.createImageData(m.width, m.height);
      const d = img.data;
      for (let i = 0, p = 0; i < m.data.length; i++, p += 4) {
        const out = 255 - m.data[i];
        if (!out) continue;
        const stripe = ((i % m.width) + Math.floor(i / m.width)) % 12 < 6;
        d[p] = stripe ? 40 : 120; d[p + 1] = stripe ? 40 : 120; d[p + 2] = stripe ? 48 : 128; d[p + 3] = out;
      }
      x.putImageData(img, 0, 0);
      this.maskOverlay = cv;
    }
    this.full = true;
    this.redraw();
  }

  private toolHost(): ToolHost {
    return {
      doc: () => this.doc,
      selection: () => this.selection,
      setSelection: (m) => this.setSelection(m),
      color: () => this.colour.get(),
      toCanvas: (x, y) => this.toCanvas(x, y),
      view: () => this.view,
      unrotate: (x, y) => unrotate(this.view, x, y),
      setLive: (fn) => { this.live = fn; this.full = true; this.redraw(); },
      redraw: () => { this.full = true; this.redraw(); },
      setInteraction: (h) => { this.interaction = h; this.cursor = null; this.full = true; this.redraw(); },
      say: (t) => this.say(t),
      modeChanged: () => { this.dropper.stopContinue(); this.closePanels(); this.syncChrome(); },
      clipMenu: (x, y) => this.clip.openMenu(x, y),
      reloadSelection: () => this.reloadSelection(),
      layerSelection: () => this.layersPanel.selectedLeaves(),
    };
  }

  // ---------------------------------------------------------------- input

  private wire(): void {
    const mode = q<HTMLButtonElement>(this.root, '.fm-paint-mode');
    mode.addEventListener('click', (e) => {
      const r = mode.getBoundingClientRect();
      const host = this.root.getBoundingClientRect();
      this.menu.hidden = !this.menu.hidden;
      this.menu.style.transform = `translate(${Math.round(r.left - host.left)}px, ${Math.round(r.bottom - host.top + 6)}px)`;
      e.stopPropagation();
    });
    mode.addEventListener('dblclick', () => { this.menu.hidden = true; void this.done(); });
    this.menu.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
      this.menu.hidden = true;
      if (m === 'done') void this.done();
      if (m === 'cancel') this.discard();
    });
    this.root.addEventListener('pointerdown', (e) => { if (!this.menu.contains(e.target as Node) && !mode.contains(e.target as Node)) this.menu.hidden = true; }, true);

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.fm-paint-tool')) {
      b.addEventListener('click', () => {
        const t = b.dataset.tool;
        if (t === 'layers') {
          if (this.layersPanel.isOpen()) this.layersPanel.close();
          else { this.closePanels(this.layersPanel); this.layersPanel.open(b); }
          this.syncChrome();
          return;
        }
        if (t === 'eyedropper') { this.toggleEyedropper(); return; }
        if (t === 'fill') { this.toggleFill(); return; }
        this.setTool(t as PaintTool);
      });
    }
    // press and hold Select brings back the previous selection
    const selWord = q<HTMLButtonElement>(this.root, '.fm-paint-word[data-w="select"]');
    let selHeld = false;
    selWord.addEventListener('pointerdown', () => {
      selHeld = false;
      clearTimeout(this.selHold);
      this.selHold = window.setTimeout(() => { selHeld = true; if (this.tools.mode() !== 'select') this.tools.setMode('select'); this.reloadSelection(); this.syncChrome(); }, 550);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) selWord.addEventListener(ev, () => clearTimeout(this.selHold));
    selWord.addEventListener('click', (e) => { if (selHeld) { selHeld = false; e.stopImmediatePropagation(); } }, true);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.fm-paint-word')) {
      b.addEventListener('click', () => {
        const w = b.dataset.w;
        if (w === 'settings') {
          if (this.settings.isOpen()) this.settings.close();
          else { this.closePanels(this.settings); this.settings.open(b); }
        } else if (w === 'filters') {
          this.closePanels();
          this.tools.openFilters(b);
        } else if (w === 'select' || w === 'transform') {
          this.closePanels();
          this.tools.setMode(this.tools.mode() === w ? 'paint' : w);
        }
        this.syncChrome();
      });
    }

    // colour: click opens the panel; dragging the chip onto the canvas fills (color drop)
    this.colourBtn.addEventListener('pointerdown', (e) => {
      const d = this.drop = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, wait: 0, px: e.clientX, py: e.clientY, hold: 0, held: false as boolean };
      this.colourBtn.setPointerCapture(e.pointerId);
      // holding the chip still swaps to the previous color
      d.hold = window.setTimeout(() => {
        if (this.drop !== d || d.dragging) return;
        d.held = true;
        this.previousColour();
      }, 500);
    });
    this.colourBtn.addEventListener('pointermove', (e) => {
      const d = this.drop;
      if (!d || d.id !== e.pointerId) return;
      if (!d.dragging && !d.held && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { d.dragging = true; clearTimeout(d.hold); this.say('Drop on the canvas to fill'); }
      if (!d.dragging) return;
      if (this.dropper.active) { this.dropper.drag(e.clientX, e.clientY); return; }
      // holding still over the picture drops the fill, then a horizontal drag sets its threshold
      d.px = e.clientX; d.py = e.clientY;
      clearTimeout(d.wait);
      if (document.elementFromPoint(e.clientX, e.clientY) === this.canvas) {
        d.wait = window.setTimeout(() => { if (this.drop === d) this.dropper.begin(d.px, d.py, this.colour.get()); }, 380);
      }
    });
    this.colourBtn.addEventListener('pointercancel', () => {
      const d = this.drop;
      this.drop = null;
      if (d) { clearTimeout(d.wait); clearTimeout(d.hold); }
      this.dropper.cancel();
    });
    this.colourBtn.addEventListener('pointerup', (e) => {
      const d = this.drop;
      this.drop = null;
      if (!d || d.id !== e.pointerId) return;
      clearTimeout(d.wait);
      clearTimeout(d.hold);
      if (d.held) return;
      if (this.dropper.active) { this.finishDrop(); return; }
      if (d.dragging) { this.colourDrop(e.clientX, e.clientY); return; }
      if (this.colour.isOpen()) this.colour.close(true);
      else { this.closePanels(this.colour); this.colour.open(this.colourBtn); }
    });

    const slider = (node: HTMLElement, kind: 'size' | 'opacity'): void => {
      let id = -1;
      const set = (e: PointerEvent): void => {
        const r = node.getBoundingClientRect();
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
        this.setState(kind === 'size' ? { size: v } : { opacity: Math.max(0.01, v) });
        this.showHud(kind);
      };
      node.addEventListener('pointerdown', (e) => { id = e.pointerId; node.setPointerCapture(id); set(e); });
      node.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
      const end = (e: PointerEvent): void => { if (e.pointerId !== id) return; id = -1; setHidden(this.hud, true); };
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    };
    slider(this.sizeSlider, 'size');
    slider(this.opacitySlider, 'opacity');
    this.holdUndoBtn.bind(this.undoBtn, () => this.undo());
    this.holdRedoBtn.bind(this.redoBtn, () => this.redo());

    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    cv.addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('pointercancel', (e) => this.up(e, true));
    cv.addEventListener('pointerleave', () => { if (this.cursor) { this.cursor = null; this.full = true; this.redraw(); } });
    cv.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const m = this.tools.mode();
      // a right-click opens the Copy & Paste menu; a pen's barrel button has its own job
      if ((e as PointerEvent).pointerType === 'pen' || this.stroke || (m !== 'paint' && m !== 'select')) return;
      this.clip.openMenu(e.clientX, e.clientY);
    });
    cv.addEventListener('dblclick', (e) => { if (this.tools.mode() === 'paint' && e.altKey) this.fit(); });

    window.addEventListener('keydown', (e) => this.key(e), true);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.space = false;
      if (e.key === 'Alt' && this.loupe.active && !this.loupe.held) this.loupe.hide();
    }, true);
    window.addEventListener('blur', () => { this.space = false; if (this.loupe.active) this.loupe.hide(); });
  }

  private colourDrop(clientX: number, clientY: number): void {
    if (!this.dropper.begin(clientX, clientY, this.colour.get())) { this.dropper.cancel(); return; }
    this.finishDrop();
  }

  // ---------------------------------------------------------------- commands, colour tools

  /** The Draw & Paint commands for the app's command table (remappable, listed in the palette). */
  paintCommands(): Command[] {
    return paintCommandDefs({ isOpen: () => this.isOpen(), run: (id) => this.runCmd(id) });
  }

  /** Hands over the app's command table so rebound keys reach Draw & Paint. */
  useCommands(c: Commands): void { this.commands = c; }

  private nudgeState(kind: 'size' | 'opacity', delta: number): void {
    const st = this.state(this.brush());
    const v = Math.max(kind === 'size' ? 0 : 0.01, Math.min(1, st[kind] + delta));
    this.setState({ [kind]: v } as Partial<BrushState>);
    this.say(`${kind === 'size' ? tr('Size') : tr('Opacity')} ${Math.round(v * 100)}%`);
  }

  private runCmd(id: PaintCmdId): void {
    if (!this.isOpen() || this.busy) return;
    const editing = this.tools.mode() === 'paint' || this.tools.mode() === 'select';
    switch (id) {
      case 'paint-tool-paint': this.setTool('paint'); break;
      case 'paint-tool-smudge': this.setTool('smudge'); break;
      case 'paint-tool-erase':
        // a second press returns to the tool that was active before
        if (this.tool === 'erase' && this.tools.mode() === 'paint' && !this.brushPanel.isOpen()) this.setTool(this.lastTool === 'erase' ? 'paint' : this.lastTool);
        else this.setTool('erase');
        break;
      case 'paint-last-tool': this.setTool(this.lastTool); break;
      case 'paint-colour-panel':
        if (this.colour.isOpen()) this.colour.close(true);
        else { this.closePanels(this.colour); this.colour.open(this.colourBtn); }
        break;
      case 'paint-layers-panel': q<HTMLButtonElement>(this.root, '.fm-paint-tool[data-tool="layers"]').click(); break;
      case 'paint-size-down': this.nudgeState('size', -0.05); break;
      case 'paint-size-up': this.nudgeState('size', 0.05); break;
      case 'paint-opacity-down': this.nudgeState('opacity', -0.05); break;
      case 'paint-opacity-up': this.nudgeState('opacity', 0.05); break;
      case 'paint-size-prev': this.slots?.step('size', -1); break;
      case 'paint-size-next': this.slots?.step('size', 1); break;
      case 'paint-opacity-prev': this.slots?.step('opacity', -1); break;
      case 'paint-opacity-next': this.slots?.step('opacity', 1); break;
      case 'paint-prev-colour': this.previousColour(); break;
      case 'paint-eyedropper': this.toggleEyedropper(); break;
      case 'paint-fill': this.toggleFill(); break;
      case 'paint-play': if (this.content()?.kind === 'flipbook') { if (this.playTimer) this.stopPlay(); else void this.startPlay(); } break;
      case 'paint-cut': if (editing) this.clip.cut(); break;
      case 'paint-copy': if (editing) this.clip.copy(); break;
      case 'paint-paste': if (editing) void this.clip.paste(); break;
      case 'paint-duplicate': if (editing) this.clip.duplicate(); break;
      case 'paint-cut-paste': if (editing) this.clip.cutPaste(); break;
      case 'paint-clear': if (editing) this.clip.clear(); break;
      case 'paint-merge-down': {
        const doc = this.doc;
        if (doc && doc.canMergeDown(doc.active)) doc.mergeDown(doc.active); else this.say(tr('Nothing below to merge with'));
        break;
      }
    }
  }

  private previousColour(): void {
    if (this.colour.togglePrevious()) this.say(tr('Previous color'));
    else this.say(tr('No previous color yet'));
  }

  private toggleEyedropper(): void {
    this.pickArmed = !this.pickArmed;
    if (this.pickArmed) {
      this.dropper.stopContinue();
      if (this.tools.mode() !== 'paint') this.tools.setMode('paint');
      this.closePanels();
      this.say(tr('Click the picture to pick a color'));
    }
    this.full = true;
    this.redraw();
    this.syncChrome();
  }

  private toggleFill(): void {
    if (this.dropper.continuing) this.dropper.stopContinue();
    else {
      this.pickArmed = false;
      if (this.tools.mode() !== 'paint') this.tools.setMode('paint');
      this.closePanels();
      this.dropper.startContinue(this.colour.get());
      this.say(tr('Click an area to fill it, drag sideways for the threshold'));
    }
    this.syncChrome();
  }

  /** SwatchDrop: a swatch carried out of the Color panel fills like the chip does. */
  private swatchDrag(e: { color: RGB; x: number; y: number; phase: 'start' | 'move' | 'end' | 'cancel' }): void {
    if (e.phase === 'start') {
      this.swatchDrop = { color: e.color, wait: 0, px: e.x, py: e.y };
      this.say(tr('Drop on the canvas to fill'));
      return;
    }
    const s = this.swatchDrop;
    if (!s) return;
    if (e.phase === 'move') {
      if (this.dropper.active) { this.dropper.drag(e.x, e.y); return; }
      s.px = e.x; s.py = e.y;
      clearTimeout(s.wait);
      if (document.elementFromPoint(e.x, e.y) === this.canvas) {
        s.wait = window.setTimeout(() => { if (this.swatchDrop === s) this.dropper.begin(s.px, s.py, s.color); }, 380);
      }
      return;
    }
    clearTimeout(s.wait);
    this.swatchDrop = null;
    if (e.phase === 'cancel') { this.dropper.cancel(); return; }
    this.colour.set(s.color);
    this.setColourChip(s.color);
    if (this.dropper.active) this.finishDrop(s.color);
    else if (document.elementFromPoint(e.x, e.y) === this.canvas) {
      if (!this.dropper.begin(e.x, e.y, s.color)) this.dropper.cancel(); else this.finishDrop(s.color);
    }
  }

  /** Keep the selection that was active before the current one so it can be brought back. */
  private reloadSelection(): void {
    const p = this.prevSel;
    if (!p) { this.say(tr('No previous selection')); return; }
    this.setSelection(p);
    this.say(tr('Previous selection'));
  }

  /** The pointer lifted on a color drop: keep the fill and stay in continue-fill. */
  private finishDrop(color?: RGB): void {
    const c = color ?? this.colour.get();
    const was = this.dropper.continuing;
    if (!this.dropper.end()) return;
    this.syncUndo();
    this.colour.commit(c);
    if (!was) this.say('Tap other areas to keep filling');
  }

  /** Undo and redo never run under a live stroke, transform or filter (their patches would be built on stale bytes). */
  private undo(): void {
    if (this.stroke) return;
    if (this.tools.mode() === 'transform' || this.tools.mode() === 'filters') { this.tools.cancel(); return; }
    if (this.doc?.undo()) this.syncUndo();
  }
  private redo(): void {
    if (this.stroke || this.tools.mode() === 'transform' || this.tools.mode() === 'filters') return;
    if (this.doc?.redo()) this.syncUndo();
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Delete, Extend, Contract, Push, Pull, Fill duration and Escape on the focused frame strip
    if (t && !e.metaKey && !e.ctrlKey && !e.altKey && this.strip.root.contains(t) && this.strip.handleKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Alt') {
      if (this.lastMouse && !this.stroke && !this.interaction && this.tools.mode() === 'paint' && !e.repeat) this.showLoupe(this.lastMouse.x, this.lastMouse.y, false);
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    // the remappable Draw & Paint commands (tools, size and opacity, colors, clipboard)
    const cmd = paintCommandFor(e, this.commands);
    if (cmd) {
      if (!e.repeat || cmd.repeat) this.runCmd(cmd.id);
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') { if (e.shiftKey) this.redo(); else this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') this.redo();
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'd') this.reloadSelection();
    else if (mod && e.key.toLowerCase() === 'd') this.setSelection(null);
    else if (mod && e.key.toLowerCase() === 's') { void this.done(true); handled = false; }
    else if (mod) handled = false;
    else if (e.code === 'Space') { this.space = true; }
    else if (e.key === 'Escape') {
      const open = [this.colour, this.brushPanel, this.layersPanel, this.settings].some((p) => p.isOpen() && !(p === this.colour && this.colour.isDetached())) || !this.menu.hidden || this.clip.isOpen();
      if (open) { this.closePanels(); this.clip.hide(); this.menu.hidden = true; this.syncChrome(); }
      else if (this.pickArmed || this.dropper.continuing) { this.pickArmed = false; this.dropper.stopContinue(); this.syncChrome(); }
      else if (this.tools.mode() !== 'paint') this.tools.cancel();
      else void this.done();
    }
    else if (e.key === 'Enter') { if (this.tools.mode() !== 'paint') this.tools.finish(); else void this.done(); }
    else if (e.key === '0') this.fit();
    else if (e.key === 'r' || e.key === 'R') {
      resetRotation(this.view, { width: this.cssW, height: this.cssH });
      this.full = true;
      this.redraw();
      this.say('Rotation reset');
    }
    else if (this.tools.mode() === 'transform' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      this.tools.nudge(dx, dy, e.shiftKey);
    }
    else if (this.content()?.kind === 'flipbook' && (e.key === ',' || e.key === '.' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const t2 = this.content()?.flip[this.row];
      const n = t2?.frames.length ?? 1;
      const dir = e.key === ',' || e.key === 'ArrowLeft' ? -1 : 1;
      const base = this.navBase();
      void this.gotoFrame(base.row, (base.index + dir + n) % n);
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    // a notched mouse wheel zooms; a trackpad's smooth two-finger scroll still pans
    const notched = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY) && e.deltaY % 4 === 0);
    if (e.ctrlKey || e.metaKey || (notched && !e.shiftKey)) {
      const f = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * (e.ctrlKey || e.metaKey ? 0.0025 : 0.0012));
      this.zoomAt(px, py, this.view.scale * f);
    } else {
      const dl = panDelta(this.view, e.shiftKey ? e.deltaY : e.deltaX, e.shiftKey ? 0 : e.deltaY);
      this.view.ox -= dl.x;
      this.view.oy -= dl.y;
    }
    this.full = true;
    this.redraw();
  }

  private zoomAt(px: number, py: number, scale: number): void {
    const s = Math.max(0.02, Math.min(32, scale));
    const a = screenToCanvas(this.view, px, py);
    const o = anchorOffset(s, this.view.rot, a, { x: px, y: py });
    this.view.scale = s;
    this.view.ox = o.x;
    this.view.oy = o.y;
  }

  private down(e: PointerEvent): void {
    if (!this.doc || this.busy) return;
    this.closePanels();
    const cv = this.canvas;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
      if (this.touches.size >= 2) {
        this.clearPickHold();
        this.cancelStroke();
        this.startGesture();
        cv.setPointerCapture(e.pointerId);
        return;
      }
      if (!this.interaction && this.tools.mode() === 'paint') this.armPickHold(e);
      if (!this.input.paintable(e)) { this.pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, id: e.pointerId }; cv.setPointerCapture(e.pointerId); return; }
    }
    if (this.space && e.button === 0 && e.shiftKey) {
      this.spin.begin(this.view, e.pointerId, e.clientX, e.clientY, cv.getBoundingClientRect());
      cv.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 1 || this.space || (e.button === 0 && e.pointerType === 'mouse' && e.buttons === 4)) {
      this.pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, id: e.pointerId };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    const pb = this.interaction || this.tools.mode() !== 'paint' ? null : penButton(e);
    if (pb === 'eraser' && this.prefs.eraserEnd) {
      // the pen's eraser end erases for this stroke only
      cv.setPointerCapture(e.pointerId);
      this.penTool = this.tool;
      this.tool = 'erase';
      this.syncChrome();
      this.startStroke(e);
      return;
    }
    if (pb === 'barrel' && this.prefs.penButton !== 'off') {
      cv.setPointerCapture(e.pointerId);
      if (this.prefs.penButton === 'eyedropper') this.showLoupe(e.clientX, e.clientY, true, e.pointerId);
      else this.cycleTool();
      return;
    }
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    if (this.interaction) { this.interaction.down(e); return; }
    if (this.playTimer) this.stopPlay();
    if (e.altKey || this.pickArmed) { this.showLoupe(e.clientX, e.clientY, true, e.pointerId); return; }
    // continue-fill follows the color as it changes
    const fillWith = this.dropper.continuing ? this.colour.get() : null;
    if (fillWith) {
      if (this.dropper.begin(e.clientX, e.clientY, fillWith)) this.dropPointer = e.pointerId;
      else this.dropper.cancel();
      return;
    }
    this.startStroke(e);
  }

  private startStroke(e: PointerEvent): void {
    const doc = this.doc as PaintDoc;
    const layer = doc.activeLayer();
    const target = doc.paintTarget();
    if (!target) { this.say('Select a layer to paint on'); return; }
    if (!layer.visible && !target.mask) { this.say('This layer is hidden'); return; }
    const b = this.brush();
    const st = this.state(b);
    const fo = this.feel.get(b.id);
    this.input.smoothing = Math.min(1, b.smoothing + (fo.stabilization ?? this.prefs.smoothing));
    this.input.motion = fo.motion ?? this.prefs.motionFilter;
    this.input.expression = fo.expression ?? this.prefs.expression;
    if (fo.gamma !== undefined) { setPressureGamma(fo.gamma); this.gammaOwn = true; }
    else if (this.gammaOwn) { setPressureCurve(this.prefs.pressure.map(([x, y]) => ({ x, y }))); this.gammaOwn = false; }
    if (this.cursorBox) this.dirtyScreen(this.cursorBox);
    const sc = brushScale(this.prefs.scaling, this.view.scale, this.doc?.width ?? 1920, this.doc?.height ?? 1080);
    // a mask takes grey: the color's brightness, and the eraser hides
    let color = this.colour.get();
    let tool = this.tool;
    if (target.mask) {
      const v = Math.round(color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722);
      color = tool === 'erase' ? { r: 0, g: 0, b: 0 } : { r: v, g: v, b: v };
      if (tool === 'erase') tool = 'paint';
    }
    this.strokeId = target.id;
    this.stroke = new Stroke(target.raster, target.id, {
      tool, brush: b, color, size: st.size, opacity: st.opacity,
      alphaLock: target.alphaLock, selection: this.selection, zoom: sc.zoom, dynamicScaling: sc.dynamic,
      seed: (Math.random() * 0x7fffffff) | 0, roll: this.rollOn(b),
    });
    this.strokePointer = e.pointerId;
    this.feed(this.input.down(e));
  }

  private feed(samples: { predicted?: boolean }[]): void {
    const s = this.stroke, doc = this.doc;
    if (!s || !doc) return;
    let rect: Rect | null = null;
    const ahead: Parameters<Stroke['add']>[0][] = [];
    for (const p of samples as Parameters<Stroke['add']>[0][]) {
      if (p.predicted) { ahead.push(p); continue; }
      const r = s.add(p);
      this.tailFrom = { x: p.x, y: p.y };
      if (r) rect = rect ? unite(rect, r) : r;
    }
    if (rect) doc.markDirty(this.strokeId || doc.active, rect);
    this.setTail(ahead);
  }

  /** The predicted points ride on screen as a thin tail until the real points replace them. */
  private setTail(ahead: Parameters<Stroke['add']>[0][]): void {
    if (this.tool !== 'paint' || !this.tailFrom || !ahead.length) { this.clearTail(); return; }
    const b = this.brush(), st = this.state(b);
    const base = baseDiameter(b, st.size);
    const [lo, hi] = b.pressureSize;
    const r = this.tail.set(this.tailFrom, ahead, (s) => base * (lo + (hi - lo) * s.pressure), this.colour.get(), st.opacity);
    if (r) this.redraw(r);
  }

  private clearTail(): void {
    this.tailFrom = null;
    const r = this.tail.clear();
    if (r) this.redraw(r);
  }

  private lastMouse: Point | null = null;

  private move(e: PointerEvent): void {
    if (e.pointerType === 'mouse') this.lastMouse = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId)!;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) t.moved = true;
      t.x = e.clientX; t.y = e.clientY;
      if (this.gesture) { this.updateGesture(); return; }
    }
    if (this.spin.active && this.spin.pointer === e.pointerId) {
      this.spin.move(this.view, e.clientX, e.clientY, this.canvas.getBoundingClientRect());
      this.full = true;
      this.redraw();
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      const dl = panDelta(this.view, e.clientX - this.pan.x, e.clientY - this.pan.y);
      this.view.ox = this.pan.ox + dl.x;
      this.view.oy = this.pan.oy + dl.y;
      this.full = true;
      this.redraw();
      return;
    }
    if (this.pickHold && this.pickHold.id === e.pointerId && Math.hypot(e.clientX - this.pickHold.x, e.clientY - this.pickHold.y) > 7) this.clearPickHold(e.pointerId);
    if (this.loupe.active) {
      // Alt held: the loupe follows the pointer (a press makes release pick)
      if (this.loupe.held && this.pickPointer !== e.pointerId) return;
      if (!this.loupe.held && !e.altKey) this.loupe.hide();
      else { this.loupe.move(e.clientX, e.clientY); return; }
    }
    if (this.dropper.active && this.dropPointer === e.pointerId) { this.dropper.drag(e.clientX, e.clientY); return; }
    if (this.interaction) { this.interaction.move(e); return; }
    if (e.altKey && e.pointerType === 'mouse' && !this.stroke && this.doc && this.tools.mode() === 'paint') {
      this.showLoupe(e.clientX, e.clientY, false);
      return;
    }
    if (this.stroke && e.pointerId === this.strokePointer) this.feed(this.input.move(e));
    if (e.pointerType !== 'touch') {
      const old = this.cursorBox;
      this.cursor = this.toCanvas(e.clientX, e.clientY);
      if (e.pointerType === 'pen') this.lastTilt = { x: e.tiltX || 0, y: e.tiltY || 0, roll: e.twist || 0 };
      if (this.cursorShown() || old) {
        if (old) this.dirtyScreen(old);
        const b = this.brush();
        const r = (this.cursorExtent(this.cursorRadius(b, this.state(b).size)) + 4) / this.view.scale;
        this.redraw({ x: this.cursor.x - r, y: this.cursor.y - r, w: r * 2, h: r * 2 });
      }
    }
  }

  private dirtyScreen(r: Rect): void {
    this.addDirty({ x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w) + 1, h: Math.ceil(r.h) + 1 });
    if (!this.frameReq) this.frameReq = requestAnimationFrame(() => { this.frameReq = 0; this.paint(); });
  }

  // ---------------------------------------------------------------- eyedropper loupe

  private pickPointer = -1;
  private dropPointer = -1;

  /** Show the loupe; the brush outline is painted away first so the lens never magnifies it. */
  private showLoupe(clientX: number, clientY: number, pressing: boolean, id = -1): void {
    if (!this.loupe.active) {
      this.cursor = null;
      this.full = true;
      if (this.frameReq) { cancelAnimationFrame(this.frameReq); this.frameReq = 0; }
      this.paint();
    }
    this.pickPointer = id;
    this.loupe.show(clientX, clientY, this.colour.get(), pressing);
  }

  private endLoupe(e: PointerEvent, cancelled: boolean): void {
    const c = this.loupe.colour;
    this.loupe.hide();
    this.pickPointer = -1;
    this.cursor = this.toCanvas(e.clientX, e.clientY);
    this.full = true;
    this.redraw();
    if (this.pickArmed) { this.pickArmed = false; this.syncChrome(); }
    if (cancelled || !c) return;
    this.colour.set(c);
    this.setColourChip(c);
    this.say('Color picked');
  }

  /** A finger held still on the picture opens the loupe; the stroke it started is thrown away. */
  private armPickHold(e: PointerEvent): void {
    this.clearPickHold();
    const x = e.clientX, y = e.clientY, id = e.pointerId;
    const timer = window.setTimeout(() => {
      this.pickHold = null;
      if (this.interaction || this.gesture || this.loupe.active || !this.touches.has(id) || this.touches.size !== 1) return;
      this.cancelStroke();
      this.pan = null;
      this.showLoupe(x, y, true, id);
    }, 500);
    this.pickHold = { id, x, y, timer };
  }

  private clearPickHold(id?: number): void {
    const h = this.pickHold;
    if (!h || (id !== undefined && h.id !== id)) return;
    clearTimeout(h.timer);
    this.pickHold = null;
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (e.pointerType === 'touch') {
      const info = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      this.clearPickHold(e.pointerId);
      if (this.gesture) {
        const g = this.gesture;
        this.holdTouch.stop();
        if (!this.touches.size) {
          const ms = performance.now() - g.t;
          const quick = ms < 300 && !g.moved && !(info?.moved);
          this.gesture = null;
          if (quick && g.count === 2 && gesturePrefsNow().undoGestures) this.undo();
          if (quick && g.count === 3 && gesturePrefsNow().undoGestures) this.redo();
          if (g.moved && g.count === 2 && this.dLast && isQuickPinchIn(g.d0, this.dLast, ms)) { this.fit(); this.say('Fit'); }
          this.dLast = 0;
        }
        return;
      }
    }
    if (this.spin.active && this.spin.pointer === e.pointerId) { this.spin.end(); return; }
    if (this.loupe.held && this.pickPointer === e.pointerId) { this.endLoupe(e, cancelled); return; }
    if (this.dropper.active && this.dropPointer === e.pointerId) { this.dropPointer = -1; this.finishDrop(); return; }
    if (this.pan && this.pan.id === e.pointerId) { this.pan = null; return; }
    if (this.interaction) { this.interaction.up(e); return; }
    if (!this.stroke || e.pointerId !== this.strokePointer) return;
    const s = this.stroke;
    const doc = this.doc as PaintDoc;
    this.clearTail();
    if (cancelled) {
      const r = s.cancel();
      if (r) doc.markDirty(this.strokeId || doc.active, r);
      doc.settle();
    } else {
      this.feed(this.input.up(e));
      const patch = s.finish();
      if (patch) {
        doc.commitPatch(patch, this.tool === 'erase' ? 'Erase' : this.tool === 'smudge' ? 'Smudge' : 'Paint');
        if (this.tool === 'paint') this.colour.commit(this.colour.get());
        this.syncUndo();
      }
    }
    this.stroke = null;
    this.strokePointer = -1;
    this.endPenTool();
    if (this.cursorBox) this.dirtyScreen(this.cursorBox);
  }

  /** The pen's eraser end lifted: back to the tool that was active. */
  private endPenTool(): void {
    if (!this.penTool) return;
    this.tool = this.penTool;
    this.penTool = null;
    this.syncChrome();
  }

  /** Pen barrel button: Paint, Smudge, Erase in turn. */
  private cycleTool(): void {
    const order: PaintTool[] = ['paint', 'smudge', 'erase'];
    this.setTool(order[(order.indexOf(this.tool) + 1) % order.length]);
    this.say(tr(this.tool === 'paint' ? 'Paint' : this.tool === 'smudge' ? 'Smudge' : 'Erase'));
  }

  private startGesture(): void {
    const pts = [...this.touches.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
    const ang = pts.length >= 2 ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0;
    const prev = this.gesture;
    const r = this.canvas.getBoundingClientRect();
    const anchor = screenToCanvas(this.view, cx - r.left, cy - r.top);
    this.gesture = { d, ang, cx, cy, scale: this.view.scale, rot: this.view.rot, anchor, d0: prev?.d0 ?? d, count: Math.max(prev?.count ?? 0, pts.length), t: prev?.t ?? performance.now(), moved: prev?.moved ?? false };
    // holding still keeps undoing (two fingers) or redoing (three)
    this.holdTouch.stop();
    if (!gesturePrefsNow().undoGestures) return;
    if (pts.length === 2) this.holdTouch.start(() => this.undo(), false);
    else if (pts.length === 3) this.holdTouch.start(() => this.redo(), false);
  }

  private updateGesture(): void {
    const g = this.gesture;
    if (!g) return;
    const pts = [...this.touches.values()];
    if (pts.length < 2) return;
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    if (Math.abs(d - g.d) > 12 || Math.hypot(cx - g.cx, cy - g.cy) > 12 || (pts.length === 2 && Math.abs(wrapAngle(ang - g.ang)) > 0.14)) { g.moved = true; this.holdTouch.stop(); }
    if (!g.moved) return;
    const r = this.canvas.getBoundingClientRect();
    const next = pinchView({ d: g.d, ang: g.ang, scale: g.scale, rot: g.rot, anchor: g.anchor }, { d, ang, cx: cx - r.left, cy: cy - r.top }, pts.length === 2 && gesturePrefsNow().rotatePinch);
    this.view.scale = next.scale;
    this.view.rot = next.rot;
    this.view.ox = next.ox;
    this.view.oy = next.oy;
    this.dLast = d;
    this.full = true;
    this.redraw();
  }

  private dLast = 0;
}

function unite(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
