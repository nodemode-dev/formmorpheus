// Draw & Paint (Phase 4) and the Flipbook frame view (Phase 5): a full-area
// canvas over the main screen with floating chrome. The open Drawing (or one
// Flipbook frame) lives in a PaintDoc; strokes, fills and transforms edit its
// rasters and its own undo; Done (or moving to another frame) encodes the
// changed layers to pixel assets and writes them to the movie in one step.

import type { Engine } from '../engine/engine';
import * as flipOps from '../engine/flip-ops';
import { flipIndexAt, flipLength, flipStartOf, locate, uid } from '../engine/model';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import type { Content, DrawingLayer, Movie, OnionSettings } from '../engine/types';
import { BRUSHES, DEFAULT_ERASE, DEFAULT_PAINT, DEFAULT_SMUDGE, brushById } from '../paint/brushes';
import { PaintDoc } from '../paint/doc';
import { baseDiameter, setPressureCurve } from '../paint/dynamics';
import { floodFill } from '../paint/fill';
import { PenInput } from '../paint/input';
import { Stroke } from '../paint/stroke';
import type { Brush, Mask, PaintTool, Point, Rect, RGB } from '../paint/types';
import { BrushPanel } from './brush-panel';
import { ColourPanel } from './colour-panel';
import { el, q, setClass, setDisabled, setHidden, setStyleVar, setText, setTitle } from './dom';
import { FlipStrip, type StripHost } from './flip-strip';
import { icon } from './icons';
import { LayersPanel } from './layers-panel';
import { PaintSettings, loadPaintPrefs, savePaintPrefs, type PaintPrefs } from './paint-settings';
import { PaintTools, type Interaction, type ToolHost } from './paint-tools';
import { toast } from './toast';

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
    <button class="fm-paint-tool" type="button" data-tool="layers" title="Drawing layers (L)">${icon('layers', 20)}</button>
    <button class="fm-paint-colour" type="button" title="Color (drag onto the canvas to fill)"><span></span></button>
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

  private view = { scale: 1, ox: 0, oy: 0 };
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private frameReq = 0;
  private dirty: Rect | null = null;
  private full = true;
  private cursor: Point | null = null;

  private readonly input: PenInput;
  private stroke: Stroke | null = null;
  private strokePointer = -1;
  private readonly touches = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
  private gesture: { d: number; cx: number; cy: number; scale: number; ox: number; oy: number; count: number; t: number; moved: boolean } | null = null;
  private pan: { x: number; y: number; ox: number; oy: number; id: number } | null = null;
  private space = false;
  private drop: { id: number; x: number; y: number; dragging: boolean } | null = null;
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
    this.menu = q(this.root, '.fm-paint-menu');

    this.prefs = loadPaintPrefs();
    setPressureCurve(this.prefs.pressure.map(([x, y]) => ({ x, y })));
    this.brushIds = readJson<Record<PaintTool, string>>(TOOL_KEY, { paint: DEFAULT_PAINT, smudge: DEFAULT_SMUDGE, erase: DEFAULT_ERASE });
    this.brushStates = readJson<Record<string, BrushState>>(STATE_KEY, {});

    this.input = new PenInput({ toCanvas: (x, y) => this.toCanvas(x, y), smoothing: 0, fingerPaints: this.prefs.fingerPaints });

    this.colour = new ColourPanel({ onPick: (rgb) => this.setColourChip(rgb) });
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
    });
    this.strip = new FlipStrip(this.stripHost());
    this.tools = new PaintTools(this.toolHost());
    for (const p of [this.colour.root, this.brushPanel.root, this.layersPanel.root, this.settings.root, this.strip.root, this.tools.root]) this.root.appendChild(p);

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
    if (!s || !doc) return;
    const r = s.cancel();
    if (r) doc.markDirty(doc.active, r);
    doc.settle();
  }

  private close(): void {
    this.cancelStroke();
    this.stopPlay();
    for (const p of [this.colour, this.brushPanel, this.layersPanel, this.settings]) p.close();
    this.menu.hidden = true;
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
    const parked = this.parked.get(this.frameKey(c));
    let doc: PaintDoc;
    if (parked) doc = parked;
    else {
      const layers = this.frameLayers(c);
      doc = layers.length ? await PaintDoc.load(m.width, m.height, layers, (id) => this.engine.assets.get(id)) : PaintDoc.blank(m.width, m.height);
    }
    if (old !== doc) this.dropDoc(old);
    doc.onChange = (what, rect) => this.docChanged(what, rect);
    this.doc = doc;
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
    this.engine.run(label, (mv) => {
      const assets = { ...mv.assets };
      for (const { asset } of out.assets) assets[asset.id] = asset;
      return ops.updateContent({ ...mv, assets }, contentId, (x) => (x.kind === 'flipbook' ? flipOps.setFrameLayers(x, row, index, out.layers) : { ...x, layers: out.layers }));
    });
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
    };
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
    const key = liveDoc ? `live:${liveDoc.layers.map((l) => l.version).join('.')}:${w}x${h}` : `${f.layers.map((l) => `${l.pixels}:${l.visible ? 1 : 0}:${l.opacity}`).join('|')}:${w}x${h}`;
    const id = `${row}:${f.id}`;
    const have = this.thumbs.get(id);
    if (have && have.key === key) return have.canvas;
    const cv = have?.canvas.width === w && have.canvas.height === h ? have.canvas : new OffscreenCanvas(w, h);
    const x = cv.getContext('2d') as OffscreenCanvasRenderingContext2D;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, w, h);
    x.fillStyle = m.background;
    x.fillRect(0, 0, w, h);
    const s = Math.min(w / m.width, h / m.height);
    x.setTransform(s, 0, 0, s, (w - m.width * s) / 2, (h - m.height * s) / 2);
    if (live && liveDoc) liveDoc.composite(x);
    else this.renderer.layersInto(x, f.layers, m);
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
    const t = c.flip[this.row];
    if (!t) return;
    const side = (count: number, dir: -1 | 1, colour: string): void => {
      for (let k = count; k >= 1; k--) {
        const i = this.index + dir * k;
        if (i < 0 || i >= t.frames.length) continue;
        const f = t.frames[i];
        const parked = this.parked.get(f.id);
        if (!parked && f.layers.every((l) => !l.pixels || !l.visible)) continue;
        const key = `${parked ? `live:${parked.layers.map((l) => l.version).join('.')}` : f.layers.map((l) => `${l.pixels}:${l.visible ? 1 : 0}:${l.opacity}`).join('|')}:${o.tint ? colour : ''}:${m.width}x${m.height}`;
        const have = this.ghosts.get(f.id);
        if (have && have.key === key) {
          ctx.globalAlpha = o.opacity * (1 - (k - 1) / (count + 1));
          ctx.drawImage(have.canvas, 0, 0);
          continue;
        }
        const canvas = have && have.canvas.width === m.width && have.canvas.height === m.height ? have.canvas : new OffscreenCanvas(m.width, m.height);
        const g = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        let ready = true;
        if (!parked) for (const l of f.layers) if (l.pixels && l.visible && !this.renderer.bitmap(l.pixels)) ready = false;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
        g.clearRect(0, 0, m.width, m.height);
        if (parked) parked.composite(g); else this.renderer.layersInto(g, f.layers, m);
        if (o.tint) {
          g.globalCompositeOperation = 'source-atop';
          g.globalAlpha = 0.8;
          g.fillStyle = colour;
          g.fillRect(0, 0, m.width, m.height);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        if (ready) this.ghosts.set(f.id, { key, canvas });
        if (this.ghosts.size > 24) this.ghosts.delete(this.ghosts.keys().next().value as string);
        ctx.globalAlpha = o.opacity * (1 - (k - 1) / (count + 1));
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
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    if (first && this.contentId) this.fit();
    this.full = true;
    this.redraw();
  }

  private fit(): void {
    const m = this.engine.movie;
    if (!m || !this.cssW) return;
    const padX = 72, padTop = 64, padBottom = this.content()?.kind === 'flipbook' ? 200 : 32;
    const s = Math.min((this.cssW - padX * 2) / m.width, (this.cssH - padTop - padBottom) / m.height);
    this.view.scale = Math.max(0.02, s);
    this.view.ox = (this.cssW - m.width * this.view.scale) / 2;
    this.view.oy = padTop + (this.cssH - padTop - padBottom - m.height * this.view.scale) / 2;
    this.full = true;
    this.redraw();
  }

  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.ox) / this.view.scale, y: (clientY - r.top - this.view.oy) / this.view.scale };
  }

  private redraw(rect?: Rect): void {
    if (rect && !this.full) {
      const v = this.view;
      const pad = 2;
      const sr = { x: Math.floor(v.ox + rect.x * v.scale) - pad, y: Math.floor(v.oy + rect.y * v.scale) - pad, w: Math.ceil(rect.w * v.scale) + pad * 2, h: Math.ceil(rect.h * v.scale) + pad * 2 };
      if (this.dirty) {
        const x0 = Math.min(this.dirty.x, sr.x), y0 = Math.min(this.dirty.y, sr.y);
        const x1 = Math.max(this.dirty.x + this.dirty.w, sr.x + sr.w), y1 = Math.max(this.dirty.y + this.dirty.h, sr.y + sr.h);
        this.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      } else this.dirty = sr;
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
    const w = m.width * v.scale, h = m.height * v.scale;
    ctx.save();
    roundRect(ctx, v.ox, v.oy, w, h, 12);
    ctx.clip();
    if (m.transparent) { ctx.fillStyle = this.checker(ctx); ctx.fillRect(v.ox, v.oy, w, h); }
    else { ctx.fillStyle = m.background; ctx.fillRect(v.ox, v.oy, w, h); }
    ctx.setTransform(d * v.scale, 0, 0, d * v.scale, d * v.ox, d * v.oy);
    ctx.imageSmoothingQuality = 'high';
    if (this.playTimer && c.kind === 'flipbook') {
      this.drawRows(ctx, c, m, 'all');
    } else {
      this.drawOnions(ctx, c, m);
      if (c.kind === 'flipbook') this.drawRows(ctx, c, m, 'below');
      this.doc.composite(ctx, this.live ?? undefined);
      if (c.kind === 'flipbook') this.drawRows(ctx, c, m, 'above');
    }
    if (this.maskOverlay && this.prefs.maskVisibility > 0) {
      ctx.globalAlpha = this.prefs.maskVisibility;
      ctx.drawImage(this.maskOverlay, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.drawOutline(ctx);
    this.tools.drawOverlay(ctx, v);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, v.ox, v.oy, w, h, 12);
    ctx.stroke();
    this.drawCursor(ctx);
    ctx.restore();
    this.full = false;
    this.dirty = null;
  }

  private cursorBox: Rect | null = null;

  private drawCursor(ctx: CanvasRenderingContext2D): void {
    const p = this.cursor;
    this.cursorBox = null;
    if (!p || !this.prefs.cursor || this.interaction || this.tools.mode() !== 'paint') return;
    const b = this.brush();
    const st = this.state(b);
    const rr = this.cursorRadius(b, st.size);
    const sx = this.view.ox + p.x * this.view.scale, sy = this.view.oy + p.y * this.view.scale;
    ctx.beginPath();
    ctx.arc(sx, sy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    this.cursorBox = { x: sx - rr - 3, y: sy - rr - 3, w: rr * 2 + 6, h: rr * 2 + 6 };
  }

  /** Brush outline radius in screen pixels: with dynamic scaling the brush keeps its screen size, else its canvas size. */
  private cursorRadius(b: Brush, size: number): number {
    const dia = baseDiameter(b, size);
    return Math.max(2, (this.prefs.dynamicScaling ? dia : dia * this.view.scale) / 2);
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
      this.renderer.layersInto(g, t.frames[fi].layers, m);
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
      setClass(b, 'is-active', (t === this.tool && this.tools.mode() === 'paint') || (t === 'layers' && this.layersPanel.isOpen()));
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
    setTitle(this.sizeSlider, `Brush size ${Math.round(st.size * 100)}%`);
    setTitle(this.opacitySlider, `Brush opacity ${Math.round(st.opacity * 100)}%`);
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
    this.syncChrome();
    this.full = true;
    this.redraw();
  }

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
      setLive: (fn) => { this.live = fn; this.full = true; this.redraw(); },
      redraw: () => { this.full = true; this.redraw(); },
      setInteraction: (h) => { this.interaction = h; this.cursor = null; this.full = true; this.redraw(); },
      say: (t) => this.say(t),
      modeChanged: () => { this.closePanels(); this.syncChrome(); },
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
        this.setTool(t as PaintTool);
      });
    }
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
      this.drop = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
      this.colourBtn.setPointerCapture(e.pointerId);
    });
    this.colourBtn.addEventListener('pointermove', (e) => {
      const d = this.drop;
      if (!d || d.id !== e.pointerId) return;
      if (!d.dragging && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { d.dragging = true; this.say('Drop on the canvas to fill'); }
    });
    this.colourBtn.addEventListener('pointerup', (e) => {
      const d = this.drop;
      this.drop = null;
      if (!d || d.id !== e.pointerId) return;
      if (d.dragging) { this.colourDrop(e.clientX, e.clientY); return; }
      if (this.colour.isOpen()) this.colour.close();
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
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());

    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    cv.addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('pointercancel', (e) => this.up(e, true));
    cv.addEventListener('pointerleave', () => { if (this.cursor) { this.cursor = null; this.full = true; this.redraw(); } });
    cv.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('dblclick', (e) => { if (this.tools.mode() === 'paint' && e.altKey) this.fit(); });

    window.addEventListener('keydown', (e) => this.key(e), true);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; }, true);
  }

  private colourDrop(clientX: number, clientY: number): void {
    const doc = this.doc;
    if (!doc) return;
    const p = this.toCanvas(clientX, clientY);
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    const layer = doc.activeLayer();
    const patch = floodFill(layer.raster, layer.raster, Math.floor(p.x), Math.floor(p.y), this.colour.get(), 0.3, this.selection, layer.id);
    if (!patch) return;
    doc.markDirty(layer.id, patch.rect);
    doc.commitPatch(patch, 'Fill');
    this.colour.commit(this.colour.get());
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
    const mod = e.metaKey || e.ctrlKey;
    let handled = true;
    if (mod && e.key.toLowerCase() === 'z') { if (e.shiftKey) this.redo(); else this.undo(); }
    else if (mod && e.key.toLowerCase() === 'y') this.redo();
    else if (mod && e.key.toLowerCase() === 'd') this.setSelection(null);
    else if (mod && e.key.toLowerCase() === 's') { void this.done(true); handled = false; }
    else if (mod) handled = false;
    else if (e.code === 'Space') { this.space = true; }
    else if (e.key === 'Escape') {
      const open = [this.colour, this.brushPanel, this.layersPanel, this.settings].some((p) => p.isOpen()) || !this.menu.hidden;
      if (open) { this.closePanels(); this.menu.hidden = true; this.syncChrome(); }
      else if (this.tools.mode() !== 'paint') this.tools.cancel();
      else void this.done();
    }
    else if (e.key === 'Enter') { if (this.tools.mode() !== 'paint') this.tools.finish(); else void this.done(); }
    else if (e.key === 'b' || e.key === 'B') this.setTool('paint');
    else if (e.key === 's' || e.key === 'S') this.setTool('smudge');
    else if (e.key === 'e' || e.key === 'E') this.setTool('erase');
    else if (e.key === 'l' || e.key === 'L') q<HTMLButtonElement>(this.root, '.fm-paint-tool[data-tool="layers"]').click();
    else if (e.key === '[' || e.key === ']') { const st = this.state(this.brush()); this.setState({ size: Math.max(0, Math.min(1, st.size + (e.key === ']' ? 0.05 : -0.05))) }); this.say(`Size ${Math.round(this.state(this.brush()).size * 100)}%`); }
    else if (e.key === '0') this.fit();
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
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * 0.0025);
      this.zoomAt(px, py, this.view.scale * f);
    } else {
      this.view.ox -= e.shiftKey ? e.deltaY : e.deltaX;
      this.view.oy -= e.shiftKey ? 0 : e.deltaY;
    }
    this.full = true;
    this.redraw();
  }

  private zoomAt(px: number, py: number, scale: number): void {
    const s = Math.max(0.02, Math.min(32, scale));
    const cx = (px - this.view.ox) / this.view.scale, cy = (py - this.view.oy) / this.view.scale;
    this.view.scale = s;
    this.view.ox = px - cx * s;
    this.view.oy = py - cy * s;
  }

  private down(e: PointerEvent): void {
    if (!this.doc || this.busy) return;
    this.closePanels();
    const cv = this.canvas;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
      if (this.touches.size >= 2) {
        this.cancelStroke();
        this.startGesture();
        cv.setPointerCapture(e.pointerId);
        return;
      }
      if (!this.input.paintable(e)) { this.pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, id: e.pointerId }; cv.setPointerCapture(e.pointerId); return; }
    }
    if (e.button === 1 || this.space || (e.button === 0 && e.pointerType === 'mouse' && e.buttons === 4)) {
      this.pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, id: e.pointerId };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    if (this.interaction) { this.interaction.down(e); return; }
    if (this.playTimer) this.stopPlay();
    if (e.altKey) { this.pick(e); return; }
    this.startStroke(e);
  }

  private pick(e: PointerEvent): void {
    const p = this.toCanvas(e.clientX, e.clientY);
    const doc = this.doc;
    if (!doc || p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return;
    const c = doc.sampleColor(Math.floor(p.x), Math.floor(p.y), true);
    if (c.a === 0) return;
    const rgb = { r: c.r, g: c.g, b: c.b };
    this.colour.set(rgb);
    this.setColourChip(rgb);
    this.say('Color picked');
  }

  private startStroke(e: PointerEvent): void {
    const doc = this.doc as PaintDoc;
    const layer = doc.activeLayer();
    if (!layer.visible) { this.say('This layer is hidden'); return; }
    const b = this.brush();
    const st = this.state(b);
    this.input.smoothing = Math.min(1, b.smoothing + this.prefs.smoothing);
    this.stroke = new Stroke(layer.raster, layer.id, {
      tool: this.tool, brush: b, color: this.colour.get(), size: st.size, opacity: st.opacity,
      alphaLock: layer.alphaLock, selection: this.selection, zoom: this.view.scale, dynamicScaling: this.prefs.dynamicScaling,
      seed: (Math.random() * 0x7fffffff) | 0,
    });
    this.strokePointer = e.pointerId;
    this.feed(this.input.down(e));
  }

  private feed(samples: { predicted?: boolean }[]): void {
    const s = this.stroke, doc = this.doc;
    if (!s || !doc) return;
    let rect: Rect | null = null;
    for (const p of samples as Parameters<Stroke['add']>[0][]) {
      if (p.predicted) continue;
      const r = s.add(p);
      if (r) rect = rect ? unite(rect, r) : r;
    }
    if (rect) doc.markDirty(doc.active, rect);
  }

  private move(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId)!;
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) t.moved = true;
      t.x = e.clientX; t.y = e.clientY;
      if (this.gesture) { this.updateGesture(); return; }
    }
    if (this.pan && this.pan.id === e.pointerId) {
      this.view.ox = this.pan.ox + e.clientX - this.pan.x;
      this.view.oy = this.pan.oy + e.clientY - this.pan.y;
      this.full = true;
      this.redraw();
      return;
    }
    if (this.interaction) { this.interaction.move(e); return; }
    if (this.stroke && e.pointerId === this.strokePointer) this.feed(this.input.move(e));
    if (e.pointerType !== 'touch') {
      const old = this.cursorBox;
      this.cursor = this.toCanvas(e.clientX, e.clientY);
      if (this.prefs.cursor) {
        if (old) this.dirtyScreen(old);
        const b = this.brush();
        const r = (this.cursorRadius(b, this.state(b).size) + 4) / this.view.scale;
        this.redraw({ x: this.cursor.x - r, y: this.cursor.y - r, w: r * 2, h: r * 2 });
      }
    }
  }

  private dirtyScreen(r: Rect): void {
    const v = this.view;
    this.redraw({ x: (r.x - v.ox) / v.scale, y: (r.y - v.oy) / v.scale, w: r.w / v.scale, h: r.h / v.scale });
  }

  private up(e: PointerEvent, cancelled = false): void {
    if (e.pointerType === 'touch') {
      const info = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      if (this.gesture) {
        const g = this.gesture;
        if (!this.touches.size) {
          const quick = performance.now() - g.t < 300 && !g.moved && !(info?.moved);
          this.gesture = null;
          if (quick && g.count === 2) this.undo();
          if (quick && g.count === 3) this.redo();
        }
        return;
      }
    }
    if (this.pan && this.pan.id === e.pointerId) { this.pan = null; return; }
    if (this.interaction) { this.interaction.up(e); return; }
    if (!this.stroke || e.pointerId !== this.strokePointer) return;
    const s = this.stroke;
    const doc = this.doc as PaintDoc;
    if (cancelled) {
      const r = s.cancel();
      if (r) doc.markDirty(doc.active, r);
      doc.settle();
    } else {
      this.feed(this.input.up(e));
      const patch = s.finish();
      if (patch) {
        doc.commitPatch(patch, this.tool === 'erase' ? 'Erase' : this.tool === 'smudge' ? 'Smudge' : 'Paint');
        if (this.tool === 'paint') this.colour.commit(this.colour.get());
      }
    }
    this.stroke = null;
    this.strokePointer = -1;
  }

  private startGesture(): void {
    const pts = [...this.touches.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
    const prev = this.gesture;
    this.gesture = { d, cx, cy, scale: this.view.scale, ox: this.view.ox, oy: this.view.oy, count: Math.max(prev?.count ?? 0, pts.length), t: prev?.t ?? performance.now(), moved: prev?.moved ?? false };
  }

  private updateGesture(): void {
    const g = this.gesture;
    if (!g) return;
    const pts = [...this.touches.values()];
    if (pts.length < 2) return;
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (Math.abs(d - g.d) > 12 || Math.hypot(cx - g.cx, cy - g.cy) > 12) g.moved = true;
    if (!g.moved) return;
    const r = this.canvas.getBoundingClientRect();
    const s = Math.max(0.02, Math.min(32, g.scale * (d / g.d)));
    const ax = (g.cx - r.left - g.ox) / g.scale, ay = (g.cy - r.top - g.oy) / g.scale;
    this.view.scale = s;
    this.view.ox = cx - r.left - ax * s;
    this.view.oy = cy - r.top - ay * s;
    this.full = true;
    this.redraw();
  }
}

function unite(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
