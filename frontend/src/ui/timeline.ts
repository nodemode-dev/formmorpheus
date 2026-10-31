import type { Engine } from '../engine/engine';
import { end, fits, kindName, locate } from '../engine/model';
import * as ops from '../engine/ops';
import * as groupInner from '../engine/group-inner-ops';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import type { VideoPool } from '../media/video';
import { timecode } from '../engine/time';
import type { Content, Highlight, KeyKind, Mode, Movie, Track } from '../engine/types';
import * as keyOps from '../engine/key-ops';
import { kindSpec, laneFrames } from '../engine/keys';
import { contentName, redrawOnLanguage, secondsLabel } from './canvas-words';
import { t } from './i18n';
import { ActionMenu, CLAPPER, LaneMenu, newKeyState } from './action-menu';
import { mods, perform, REC_GLYPH } from './perform-ui';
import { el, q, setClass, setHidden, setHtml, setText, setTitle } from './dom';
import { icon } from './icons';
import { cameraMode } from './camera-view';
import { LANES_GAP, LANE_H, drawLanes, hitLanes, keyBefore, laneSlots, lanesHeight, setGlyphLoadHandler, type LaneGeom, type LaneHit } from './key-lanes';
import { EndBarMenu, KeySelMenu, KeySelection, inPoly, lassoTouches, nearTrail, type Pt } from './timeline-extras';
import type { KeyRef } from '../engine/key-sel-ops';
import { gestureRegion, penHover, touchModifier } from './gestures';
import { loadPrefs } from './prefs';
import { drawSoundOverlay, fadeFramesFor, fadeHandleAt, waveGain } from './timeline-sound';
import { setFade } from '../media/audio-edit';
import { TimelineEd } from './timeline-ed';
import { MasterMeter, drawTrackMeter } from './audio-meter';
import { srcFrame } from '../engine/retime';

const RULER_H = 28;
// Track height scales (Ctrl+Shift+wheel): BLOCK_H and STRIDE are set together by setRowHeight.
let BLOCK_H = 44;
const LANE_GAP = 10;
let STRIDE = BLOCK_H + LANE_GAP;
const MIN_BLOCK_H = 26;
const MAX_BLOCK_H = 110;
const FREE_RED = '#e5484d';
const MINI_H = 14;
const LEFT = 14;
const RIGHT = 24;
const TOP_PAD = 26;
const EDGE = 7;
const MIN_PPF = 0.05;
const MAX_PPF = 64;

export interface TimelineHooks {
  contentMenu(x: number, y: number): void;
  trackMenu(x: number, y: number, trackId: string): void;
  movieSettings(anchor: HTMLElement): void;
  home(): void;
  create(anchor: HTMLElement): void;
  edit(c: Content): void;
  scrubSpeed(): number;
  /** Open the Graph on a lane (the Graph button on an expanded lane). */
  graph?(id: string, kind: KeyKind, channel: string | null): void;
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'zoom'; x0: number; ppf0: number; anchorFrame: number; moved?: boolean }
  | { kind: 'move'; x0: number; y0: number; applied: number; appliedTrack: number; tag: string; moved: boolean }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; x0: number; applied: number; ripple: boolean; tag: string; hold?: number }
  | { kind: 'fade'; id: string; which: 'in' | 'out'; tag: string }
  | { kind: 'inner'; id: string; mode: 'move' | 'start' | 'end'; x0: number; applied: number; moved: boolean; tag: string }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; base: string[] }
  | { kind: 'lasso'; pts: Pt[]; base: string[] }
  | { kind: 'keylasso'; pts: Pt[]; base: Map<string, KeyRef[]> }
  | { kind: 'duration'; x0: number; d0: number; tag: string; moved?: boolean }
  | { kind: 'pan'; x0: number; start0: number; y0: number; scroll0: number }
  | { kind: 'key'; id: string; lk: KeyKind; channel: string | null; from0: number; cur: number; base: Content; x0: number; tag: string };

interface Palette {
  keyBar: string;
  keyRow: string;
  onAccent: string;
  lane: string;
  laneAlt: string;
  block: string;
  blockLine: string;
  text: string;
  muted: string;
  accent: string;
  playhead: string;
  ruler: string;
  tick: string;
  end: string;
  chip: string;
  hl: Record<Highlight, string>;
}

const KIND_ICON: Record<Content['kind'], string> = { drawing: 'drawing', flipbook: 'flipbook', image: 'image', video: 'video', audio: 'audio', text: 'text', group: 'group', shape: 'shape', solid: 'solid', adjust: 'adjust' };

export class TimelineView {
  readonly root = el(`<section class="fm-timeline" aria-label="Timeline">
    <div class="fm-transport">
      <div class="fm-transport-left">
        <button class="fm-pill-btn" type="button" data-act="home">Theater</button>
        <button class="fm-round-btn" type="button" data-act="settings" title="Movie settings" aria-label="Movie settings">${icon('movieSettings', 18)}</button>
        <button class="fm-round-btn" type="button" data-act="multi" title="Multi-select" aria-label="Multi-select" aria-pressed="false">${icon('multiSelect', 18)}</button>
        <button class="fm-round-btn" type="button" data-act="camera" title="Camera mode" aria-label="Camera mode" aria-pressed="false">${kindSpec('camera').icon}</button>
      </div>
      <div class="fm-transport-mid">
        <button class="fm-ghost-btn" type="button" data-act="back" title="Previous frame" aria-label="Previous frame">${icon('stepBack', 16)}</button>
        <button class="fm-play-btn" type="button" data-act="play" title="Play" aria-label="Play"><span class="fm-play-on">${icon('play', 22)}</span><span class="fm-play-off" hidden>${icon('pause', 22)}</span></button>
        <button class="fm-ghost-btn" type="button" data-act="fwd" title="Next frame" aria-label="Next frame">${icon('stepForward', 16)}</button>
      </div>
      <div class="fm-transport-right">
        <canvas class="fm-master-meter" aria-label="Master level"></canvas>
        <span class="fm-frame-readout"></span>
        <button class="fm-round-btn is-strong" type="button" data-act="create" title="Create" aria-label="Create">${icon('plus', 18)}</button>
      </div>
    </div>
    <div class="fm-tl-body">
      <canvas class="fm-tl-ruler" aria-label="Ruler"></canvas>
      <div class="fm-tl-lanes"><canvas class="fm-tl-tracks" aria-label="Tracks"></canvas><div class="fm-freetrim" hidden>Free Trim</div><button class="fm-edit-pill" type="button" hidden></button><button class="fm-key-pill" type="button" hidden aria-label="Action" title="Action"><span class="fm-key-glyph"></span></button></div>
      <div class="fm-tl-empty" hidden><p>Use the plus button to add a drawing, a flipbook, text or a picture, or drop pictures here.</p></div>
      <div class="fm-tl-zoom" role="group" aria-label="Timeline zoom">
        <span class="fm-zoom-grp"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg><button type="button" data-act="zh-out" title="Zoom Timeline out (time)" aria-label="Zoom Timeline out (time)">${icon('minus', 14)}</button><button type="button" data-act="zh-in" title="Zoom Timeline in (time)" aria-label="Zoom Timeline in (time)">${icon('plus', 14)}</button></span>
        <span class="fm-zoom-grp"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg><button type="button" data-act="zv-out" title="Shorter tracks" aria-label="Shorter tracks">${icon('minus', 14)}</button><button type="button" data-act="zv-in" title="Taller tracks" aria-label="Taller tracks">${icon('plus', 14)}</button></span>
      </div>
      <div class="fm-modes" role="tablist" aria-label="Mode">
        <button class="fm-mode" type="button" role="tab" data-mode="compose">${icon('compose', 18)}<span>Compose</span></button>
        <button class="fm-mode" type="button" role="tab" data-mode="perform">${icon('perform', 18)}<span>Perform</span></button>
        <button class="fm-mode" type="button" role="tab" data-mode="keyframe">${icon('keyframe', 18)}<span>Keyframe</span></button>
      </div>
    </div>
  </section>`);

  private readonly ruler = q<HTMLCanvasElement>(this.root, '.fm-tl-ruler');
  private readonly modesEl = q(this.root, '.fm-modes');
  private readonly tracksCanvas = q<HTMLCanvasElement>(this.root, '.fm-tl-tracks');
  private readonly lanes = q(this.root, '.fm-tl-lanes');
  private readonly editPill = q<HTMLButtonElement>(this.root, '.fm-edit-pill');
  private readonly keyPill = q<HTMLButtonElement>(this.root, '.fm-key-pill');
  private readonly keyGlyph = q(this.root, '.fm-key-glyph');
  private readonly keyState = newKeyState();
  private readonly actionMenu: ActionMenu;
  private readonly laneMenu: LaneMenu;
  private keyPillAt = '';
  private longPress = 0;
  private pressAt: [number, number] = [0, 0];
  /** Recent Playhead drag samples [ms, x]: a quick leftward flick on release plays. */
  private flick: Array<[number, number]> | null = null;
  private tops: number[] = [];
  private rowH: number[] = [];
  private totalH = 0;
  private layoutFor: Movie | null = null;
  private layoutLanes = false;
  private readonly empty = q(this.root, '.fm-tl-empty');
  private readonly readout = q(this.root, '.fm-frame-readout');
  private readonly multiBtn = q<HTMLButtonElement>(this.root, '[data-act="multi"]');
  private ppf = 4;
  private start = 0;
  private scrollY = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private drag: Drag | null = null;
  private frameReq = 0;
  private fitted = false;
  private multi = false;
  private readonly freeBanner = q(this.root, '.fm-freetrim');
  private altDown = false;
  private readonly keySel = new KeySelection();
  private readonly keyMenu: KeySelMenu;
  private readonly endMenu: EndBarMenu;
  /** The selection before the current one, and the press that brings it back (hold the Multi-select button). */
  private prevSel: string[] = [];
  private lastSel: string[] = [];
  private reloadTimer = 0;
  private reloadHeld = false;
  /** Group blocks opened in place (their tracks show under the block in Compose mode). */
  private readonly opened = new Set<string>();
  /** The content picked inside an opened group (the group itself stays the engine's selection). */
  private innerSel: string | null = null;
  private pal: Palette | null = null;
  private thumbs = new WeakMap<Content, HTMLCanvasElement>();
  private thumbGen = 0;
  private thumbStale = false;
  private lastMovieId = '';
  private video: VideoPool | null = null;
  private audio: AudioEngine | null = null;
  private readonly decoding = new Set<string>();
  private readonly peakNorm = new WeakMap<object, number>();
  /** Snapping, markers and transition handles (ui/timeline-ed.ts). */
  private readonly ed: TimelineEd;

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer, private readonly hooks: TimelineHooks) {
    host.appendChild(this.root);
    this.ed = new TimelineEd(engine, {
      fx: (f) => this.fx(f), xf: (x) => this.xf(x), laneTop: (i) => this.laneTop(i), blockH: () => BLOCK_H, ppf: () => this.ppf,
      ruler: this.ruler, tracks: this.tracksCanvas, schedule: () => this.schedule(),
    });
    new MasterMeter(q<HTMLCanvasElement>(this.root, '.fm-master-meter'), () => this.audio);
    this.actionMenu = new ActionMenu(engine, this.keyState);
    this.laneMenu = new LaneMenu(engine, this.keyState);
    this.keyMenu = new KeySelMenu(engine, this.keySel, () => this.schedule());
    this.endMenu = new EndBarMenu(engine, () => this.fit());
    setGlyphLoadHandler(() => this.schedule());
    // Alt held is Free Trim for the next edge drag: the banner shows while it is down
    const alt = (e: KeyboardEvent): void => { const on = e.altKey; if (on !== this.altDown) { this.altDown = on; this.syncFreeTrim(); } };
    window.addEventListener('keydown', alt);
    window.addEventListener('keyup', alt);
    window.addEventListener('blur', () => { if (this.altDown) { this.altDown = false; this.syncFreeTrim(); } });
    // hold the Multi-select button to bring the previous selection back
    this.multiBtn.addEventListener('pointerdown', () => {
      this.reloadHeld = false;
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => { this.reloadHeld = true; this.reloadSelection(); }, 550);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) this.multiBtn.addEventListener(ev, () => window.clearTimeout(this.reloadTimer));
    this.multiBtn.addEventListener('click', (e) => { if (this.reloadHeld) { this.reloadHeld = false; e.stopImmediatePropagation(); } }, true);
    this.ruler.addEventListener('dblclick', (e) => this.zoomToFrames(e.clientX));
    this.keyPill.addEventListener('click', () => {
      const sel = this.engine.selected;
      const c = sel.length === 1 ? sel[0] : null;
      // the red icon (animated, no key here) with a single lane goes straight to a new key and its card
      if (c && this.engine.mode !== 'perform' && c.keys.length === 1 && !laneFrames(c.keys[0]).includes(this.engine.frame - c.start) && !this.actionMenu.isOpen) this.actionMenu.openFor(this.keyPill, c.keys[0].kind);
      else this.actionMenu.open(this.keyPill);
    });
    perform.onChange(() => this.schedule());
    // the pill sits on the key at the Playhead: a right-click on it opens that key's menu
    this.keyPill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = this.tracksCanvas.getBoundingClientRect(), p = this.keyPill.getBoundingClientRect();
      const y = Math.min(r.bottom - 1, Math.max(r.top, this.keyPill.classList.contains('is-keyed') ? p.top + 49 : p.top + p.height / 2));
      this.contextMenu(new MouseEvent('contextmenu', { clientX: p.left + p.width / 2, clientY: y, bubbles: false, cancelable: true }));
    });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.lanes);
    ro.observe(this.ruler);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.ruler.addEventListener('pointerdown', (e) => this.rulerDown(e));
    // a cue for the ruler's drag: a slide scales time, the Playhead handle or Shift scrubs
    this.ruler.title = 'Drag to scale time. Drag the Playhead, or hold Shift, to scrub.';
    this.ruler.addEventListener('pointermove', (e) => {
      if (this.drag || e.pointerType === 'touch') return;
      const nearHead = Math.abs(e.clientX - this.ruler.getBoundingClientRect().left - this.fx(this.engine.frame)) < 10;
      this.ruler.style.cursor = e.shiftKey || nearHead ? 'grab' : 'ew-resize';
    });
    this.tracksCanvas.addEventListener('pointerdown', (e) => this.tracksDown(e));
    for (const c of [this.ruler, this.tracksCanvas]) {
      c.addEventListener('pointermove', (e) => this.pointerMove(e));
      c.addEventListener('pointerup', (e) => this.pointerUp(e));
      c.addEventListener('pointercancel', (e) => this.pointerUp(e));
    }
    this.tracksCanvas.addEventListener('pointermove', (e) => { if (!this.drag) this.hover(e); });
    this.tracksCanvas.addEventListener('contextmenu', (e) => this.contextMenu(e));
    this.tracksCanvas.addEventListener('dblclick', (e) => this.doubleClick(e));
    this.lanes.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.ruler.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.bindGestures();
    this.editPill.addEventListener('click', () => { const c = this.engine.selected[0]; if (c) this.hooks.edit(c); });
    // While a block is dragged or trimmed only its position changes: the thumbnails are kept and renewed once at the drop.
    engine.on('movie', () => {
      const k = this.drag?.kind;
      if (k === 'move' || k === 'trim' || k === 'inner' || k === 'key') this.thumbStale = true; else this.thumbGen++;
      this.schedule();
    });
    engine.on('selection', () => {
      const now = engine.selection.content;
      if (now.join() !== this.lastSel.join()) {
        if (this.lastSel.length) this.prevSel = this.lastSel;
        this.lastSel = now.slice();
        this.keySel.keepOnly(new Set(now));
      }
      this.schedule();
    });
    engine.on('time', () => this.schedule());
    engine.on('mode', (m) => this.syncMode(m));
    engine.on('playing', (on) => this.syncPlay(on));
    engine.on('projects', () => { const id = engine.movie?.id ?? ''; if (id !== this.lastMovieId) { this.lastMovieId = id; this.fitted = false; this.scrollY = 0; this.schedule(); } });
    redrawOnLanguage(() => this.schedule());
    document.addEventListener('nm:ui-settings-changed', () => { this.pal = null; this.thumbs = new WeakMap(); this.schedule(); });
    cameraMode.onChange(() => {
      const b = q<HTMLButtonElement>(this.root, '[data-act="camera"]');
      setClass(b, 'is-on', cameraMode.on);
      b.setAttribute('aria-pressed', String(cameraMode.on));
    });
    this.syncMode(engine.mode);
    this.syncPlay(false);
  }

  refreshThumbs(): void {
    this.thumbs = new WeakMap();
    this.schedule();
  }

  /** The decoders that feed filmstrips and waveforms; either may be absent. */
  setMedia(media: { video: VideoPool | null; audio: AudioEngine | null }): void {
    this.video = media.video;
    this.audio = media.audio;
    this.decoding.clear();
    this.schedule();
  }

  toggleMulti(on = !this.multi): void {
    this.multi = on;
    setClass(this.multiBtn, 'is-on', on);
    this.multiBtn.setAttribute('aria-pressed', String(on));
  }

  /** Free Trim is on while Alt is held or an edge drag was held long enough to turn red. */
  private freeTrim(): boolean {
    return this.altDown || (this.drag?.kind === 'trim' && this.drag.ripple);
  }

  private syncFreeTrim(): void {
    setHidden(this.freeBanner, !this.freeTrim());
    this.schedule();
  }

  private reloadSelection(): void {
    const m = this.engine.movie;
    if (!m || !this.prevSel.length) return;
    const ids = this.prevSel.filter((id) => !!locate(m, id));
    if (!ids.length) return;
    this.toggleMulti(true);
    this.engine.select(ids);
    setClass(this.multiBtn, 'is-reload', true);
    window.setTimeout(() => setClass(this.multiBtn, 'is-reload', false), 500);
  }

  /** Track height: one rate for the whole Timeline, clamped. */
  setRowHeight(h: number): void {
    const next = Math.round(Math.min(MAX_BLOCK_H, Math.max(MIN_BLOCK_H, h)));
    if (next === BLOCK_H) return;
    BLOCK_H = next;
    STRIDE = BLOCK_H + LANE_GAP;
    this.layoutFor = null;
    this.thumbGen++;
    this.schedule();
  }

  /** Double-click: zoom to frame level around the click (frame numbers show), or back to the whole movie. */
  private zoomToFrames(clientX: number): void {
    const m = this.engine.movie;
    if (!m || this.width <= 0) return;
    if (this.ppf >= 20) { this.fit(); return; }
    const r = this.lanes.getBoundingClientRect();
    const x = clientX - r.left, anchor = this.xf(x);
    this.ppf = Math.min(MAX_PPF, 24);
    this.start = Math.max(0, anchor - (x - LEFT) / this.ppf);
    this.fitted = true;
    this.schedule();
  }

  zoomBy(factor: number): void {
    const m = this.engine.movie;
    if (!m) return;
    const anchor = this.engine.frame;
    const x = this.fx(anchor);
    this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), this.ppf * factor));
    this.start = Math.max(0, anchor - (x - LEFT) / this.ppf);
    this.schedule();
  }

  /** Scroll so the Playhead sits in the middle of the view. */
  centerOnPlayhead(): void {
    if (!this.engine.movie || this.width <= 0) return;
    this.start = Math.max(0, this.engine.frame - (this.width - LEFT - RIGHT) / this.ppf / 2);
    this.fitted = false;
    this.schedule();
  }

  /** First and last frame fully in view (for "loop only the visible region"). */
  visibleRange(): { from: number; to: number } | null {
    if (this.width <= 0) return null;
    const from = Math.ceil(this.start);
    const to = Math.floor(this.start + (this.width - LEFT - RIGHT) / this.ppf) - 1;
    return to > from ? { from, to } : null;
  }

  fit(): void {
    const m = this.engine.movie;
    if (!m || this.width <= 0) return;
    this.ppf = Math.min(MAX_PPF, Math.max(MIN_PPF, (this.width - LEFT - RIGHT) / Math.max(1, m.duration)));
    this.start = 0;
    this.fitted = true;
    this.schedule();
  }

  private minPpf(m: Movie): number {
    return Math.max(MIN_PPF, Math.min(1, (this.width - LEFT - RIGHT) / Math.max(1, m.duration * 4)));
  }

  private fx(frame: number): number { return LEFT + (frame - this.start) * this.ppf; }
  private xf(x: number): number { return this.start + (x - LEFT) / this.ppf; }
  /** Row offsets: track rows grow by the height of their keyframe lanes in Keyframe and Perform modes. */
  private layout(m: Movie): void {
    const lanes = this.engine.mode !== 'compose';
    if (this.layoutFor === m && this.layoutLanes === lanes) return;
    this.layoutFor = m;
    this.layoutLanes = lanes;
    this.tops = [];
    this.rowH = [];
    let y = 0;
    for (const t of m.tracks) {
      let extra = 0;
      if (lanes) for (const c of t.content) extra = Math.max(extra, lanesHeight(c));
      else for (const c of t.content) if (c.kind === 'group' && this.opened.has(c.id)) extra = Math.max(extra, c.tracks.length * (MINI_H + 2) + 6);
      this.tops.push(y);
      this.rowH.push(STRIDE + extra);
      y += STRIDE + extra;
    }
    this.totalH = y;
  }

  private laneTop(i: number): number {
    const m = this.engine.movie;
    if (m) this.layout(m);
    return TOP_PAD + (this.tops[i] ?? i * STRIDE) - this.scrollY;
  }

  private laneAt(y: number): number {
    const m = this.engine.movie;
    const v = y + this.scrollY - TOP_PAD;
    if (!m) return Math.floor(v / STRIDE);
    this.layout(m);
    if (v < 0) return Math.floor(v / STRIDE);
    for (let i = 0; i < this.tops.length; i++) if (v < this.tops[i] + this.rowH[i]) return i;
    return this.tops.length + Math.floor((v - this.totalH) / STRIDE);
  }

  private syncMode(m: Mode): void {
    if (m === 'compose') this.actionMenu.hide();
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('.fm-mode'))) {
      const on = b.dataset.mode === m;
      setClass(b, 'is-active', on);
      b.setAttribute('aria-selected', String(on));
    }
    setClass(this.root, 'is-perform', m === 'perform');
    setClass(this.root, 'is-keyframe', m === 'keyframe');
    this.schedule();
  }

  private syncPlay(on: boolean): void {
    setHidden(q(this.root, '.fm-play-on'), on);
    setHidden(q(this.root, '.fm-play-off'), !on);
    const b = q<HTMLButtonElement>(this.root, '.fm-play-btn');
    setTitle(b, on ? 'Pause' : 'Play');
    b.setAttribute('aria-label', on ? 'Pause' : 'Play');
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const mode = (t.closest('[data-mode]') as HTMLElement | null)?.dataset.mode as Mode | undefined;
    if (mode === 'perform' && this.engine.mode === 'perform') { mods.toggle(t.closest('[data-mode]') as HTMLElement, 'above'); return; }
    if (mode) { this.engine.setMode(mode); return; }
    const act = (t.closest('[data-act]') as HTMLElement | null)?.dataset.act;
    const btn = t.closest('[data-act]') as HTMLElement | null;
    if (!act || !btn) return;
    if (act === 'home') this.hooks.home();
    else if (act === 'settings') this.hooks.movieSettings(btn);
    else if (act === 'multi') this.toggleMulti();
    else if (act === 'play') this.engine.togglePlay();
    else if (act === 'back') this.engine.step(-1);
    else if (act === 'fwd') this.engine.step(1);
    else if (act === 'create') this.hooks.create(btn);
    else if (act === 'camera') cameraMode.toggle();
    else if (act === 'zh-in') this.zoomBy(1.4);
    else if (act === 'zh-out') this.zoomBy(1 / 1.4);
    else if (act === 'zv-in') this.zoomRows(1.25);
    else if (act === 'zv-out') this.zoomRows(0.8);
  }

  /** Track height by a factor (the on-screen buttons and the vertical-only zoom commands). */
  zoomRows(factor: number): void {
    const m = this.engine.movie;
    if (!m) return;
    this.setRowHeight(BLOCK_H * factor);
    this.scrollY = this.clampScroll(this.scrollY, m);
  }

  private resize(): void {
    const r = this.lanes.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    for (const [c, ch] of [[this.ruler, RULER_H], [this.tracksCanvas, h]] as const) {
      const pw = Math.round(w * dpr), ph = Math.round(ch * dpr);
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
    }
    if (!this.fitted) this.fit();
    this.draw();
  }

  schedule(): void {
    if (this.frameReq) return;
    this.frameReq = requestAnimationFrame(() => { this.frameReq = 0; this.draw(); });
  }

  private palette(): Palette {
    if (this.pal) return this.pal;
    const s = getComputedStyle(this.root);
    const v = (n: string, d: string): string => s.getPropertyValue(n).trim() || d;
    this.pal = {
      lane: v('--fm-lane', '#1b1b1f'), laneAlt: v('--fm-lane-alt', '#202026'), block: v('--fm-block', '#2c2c33'), blockLine: v('--fm-block-line', '#3a3a44'),
      text: v('--text-primary', '#f2f2f2'), muted: v('--text-muted', '#8a8a8a'), accent: v('--accent-color', '#f97316'), playhead: v('--fm-playhead', '#f2f2f2'),
      keyBar: v('--fm-key-bar', '#1e1e22'), keyRow: v('--fm-key-row', '#1a1a1e'), onAccent: v('--text-on-accent', '#ffffff'),
      ruler: v('--fm-ruler', '#151518'), tick: v('--fm-tick', '#55555e'), end: v('--fm-end', '#0d0d10'), chip: v('--fm-chip', 'rgba(10,10,12,.72)'),
      hl: {
        none: v('--fm-block', '#2c2c33'), red: v('--fm-hl-red', '#e5484d'), orange: v('--fm-hl-orange', '#f97316'), yellow: v('--fm-hl-yellow', '#e8c547'),
        green: v('--fm-hl-green', '#46a758'), teal: v('--fm-hl-teal', '#12a594'), blue: v('--fm-hl-blue', '#3a7bff'), purple: v('--fm-hl-purple', '#8e4ec6'), pink: v('--fm-hl-pink', '#e93d82'),
      },
    };
    return this.pal;
  }

  private draw(): void {
    const m = this.engine.movie;
    setHidden(this.empty, !m || m.tracks.length > 0);
    if (!m || this.width <= 0) { this.clear(); return; }
    if (!this.fitted) this.fit();
    this.drawRuler(m);
    this.drawTracks(m);
    setText(this.readout, `${timecode(this.engine.frame, m.fps)} · ${this.engine.frame + 1} / ${m.duration}`);
    this.placePill(m);
    this.placeKeyPill(m);
    this.onDrawn?.();
  }

  /** Called after each draw so the Camera lane above the tracks follows the same zoom and scroll. */
  onDrawn: (() => void) | null = null;

  /** Frame to x and x to frame on the tracks canvas, for lanes drawn beside it. */
  axis(): { x(frame: number): number; frame(x: number): number; width: number; left: number } {
    return { x: (f) => this.fx(f), frame: (x) => this.xf(x), width: this.width, left: LEFT };
  }

  /** Where a drop at the pointer lands: the frame under it and the track row (null below the last track), or null off the tracks. */
  dropTarget(clientX: number, clientY: number): { frame: number; index: number; track: Track | null } | null {
    const m = this.engine.movie;
    const r = this.tracksCanvas.getBoundingClientRect();
    if (!m || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const index = Math.max(0, this.laneAt(clientY - r.top));
    return { frame: Math.max(0, Math.floor(this.xf(clientX - r.left))), index: Math.min(index, m.tracks.length), track: m.tracks[index] ?? null };
  }

  private clear(): void {
    setHidden(this.keyPill, true);
    for (const c of [this.ruler, this.tracksCanvas]) (c.getContext('2d') as CanvasRenderingContext2D).clearRect(0, 0, c.width, c.height);
    setHidden(this.editPill, true);
  }

  private tickStep(m: Movie): { major: number; minor: number; seconds: boolean } {
    const fps = m.fps;
    const second = Math.max(1, Math.round(fps));
    const secondsSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300].map((s) => s * second);
    const frameSteps = [1, 2, 5, 10, Math.max(1, Math.round(fps / 2)), second].sort((a, b) => a - b);
    // from about 6 px a frame there is room for frame numbers, so they show without a double-click zoom
    const bySeconds = second * this.ppf >= 40 && this.ppf < 6;
    const major = bySeconds
      ? secondsSteps.find((s) => s * this.ppf >= 56) ?? secondsSteps[secondsSteps.length - 1]
      : frameSteps.find((s) => s * this.ppf >= 56) ?? second;
    const minor = major >= fps ? Math.max(1, Math.round(major / (major >= fps * 5 ? 5 : fps >= 10 ? 4 : 2))) : Math.max(1, Math.round(major / 5));
    return { major, minor, seconds: bySeconds };
  }

  private drawRuler(m: Movie): void {
    const p = this.palette();
    const c = this.ruler.getContext('2d') as CanvasRenderingContext2D;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, RULER_H);
    c.fillStyle = p.ruler;
    c.fillRect(0, 0, this.width, RULER_H);
    if (m.loopFrom !== undefined && m.loopTo !== undefined && m.loopTo >= m.loopFrom) {
      // Loop range: a tinted band with in / out edges (the last frame is inclusive)
      const lx0 = Math.round(this.fx(m.loopFrom));
      const lx1 = Math.round(this.fx(m.loopTo + 1));
      c.fillStyle = p.accent;
      c.globalAlpha = 0.22;
      c.fillRect(lx0, 0, Math.max(2, lx1 - lx0), RULER_H);
      c.globalAlpha = 1;
      c.fillRect(lx0, 0, 2, RULER_H);
      c.fillRect(Math.max(lx0, lx1 - 2), 0, 2, RULER_H);
    }
    const { major, minor, seconds } = this.tickStep(m);
    const first = Math.max(0, Math.floor(this.start / minor) * minor);
    const last = Math.min(m.duration, Math.ceil(this.xf(this.width) / minor) * minor);
    c.font = '600 10px Inter, system-ui, sans-serif';
    c.textBaseline = 'top';
    for (let f = first; f <= last; f += minor) {
      const x = Math.round(this.fx(f)) + 0.5;
      const isMajor = f % major === 0;
      c.strokeStyle = p.tick;
      c.beginPath();
      c.moveTo(x, RULER_H);
      c.lineTo(x, RULER_H - (isMajor ? 10 : 5));
      c.stroke();
      if (isMajor) {
        c.fillStyle = p.muted;
        const label = seconds ? secondsLabel(Math.round(f / m.fps)) : String(f);
        // Left-aligned whatever the page direction; a label that would pass the movie's end (or the right edge) ends at its tick instead.
        const lw = c.measureText(label).width;
        c.textAlign = x + 3 + lw > Math.min(this.width, this.fx(m.duration)) - 2 ? 'right' : 'left';
        c.fillText(label, c.textAlign === 'left' ? x + 3 : x - 3, 5);
      }
    }
    const endX = this.fx(m.duration);
    if (endX < this.width) {
      c.fillStyle = p.end;
      c.fillRect(endX, 0, this.width - endX, RULER_H);
    }
    const px = Math.round(this.fx(this.engine.frame)) + 0.5;
    c.fillStyle = p.accent;
    c.fillRect(px - 1, RULER_H - 12, 2, 12);
    // the Playhead's glyph follows the mode: a line in Compose, a record disc in Perform, a clapperboard in Keyframe
    const mode = this.engine.mode;
    if (mode === 'perform') {
      c.fillStyle = '#e5484d';
      c.beginPath();
      c.arc(px, RULER_H - 14, 4.5, 0, Math.PI * 2);
      c.fill();
      if (perform.recording) {
        c.strokeStyle = '#e5484d';
        c.globalAlpha = 0.45;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(px, RULER_H - 14, 7.5, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
    } else if (mode === 'keyframe') {
      c.fillStyle = p.accent;
      c.fillRect(px - 6, RULER_H - 20, 12, 3);
      c.fillRect(px - 6, RULER_H - 16, 12, 6);
      c.fillStyle = p.ruler;
      for (let i = 0; i < 3; i++) c.fillRect(px - 5 + i * 4, RULER_H - 20, 2, 3);
    }
    this.ed.drawRuler(c, m, p, this.width);
  }

  private visibleRows(m: Movie): number {
    return m.tracks.length;
  }

  private drawTracks(m: Movie): void {
    const p = this.palette();
    const c = this.tracksCanvas.getContext('2d') as CanvasRenderingContext2D;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    const endX = this.fx(m.duration);
    const sel = new Set(this.engine.selection.content);
    const rows = this.visibleRows(m);
    const lanes = this.engine.mode !== 'compose';
    const lp = { bar: p.keyBar, row: p.keyRow, accent: p.accent, text: p.text, onAccent: p.onAccent };
    for (let i = 0; i < rows; i++) {
      const y = this.laneTop(i);
      if (y + this.rowH[i] < 0 || y > this.height) continue;
      const t = m.tracks[i];
      c.fillStyle = t.id === this.engine.selection.track ? p.laneAlt : p.lane;
      this.round(c, LEFT - 6, y - 2, Math.max(0, Math.min(endX, this.width) - LEFT + 12), BLOCK_H + 4, 8);
      c.fill();
      for (const item of t.content) this.drawBlock(c, m, t, item, y, sel.has(item.id), p);
      if (this.audio && this.engine.playing) drawTrackMeter(c, this.audio.meter(t.id), 1, y, 4, BLOCK_H, p.accent);
      if (lanes) for (const item of t.content) if (item.keys.length) drawLanes(c, item, y + BLOCK_H + LANES_GAP, this.geom(item), lp, this.height, Math.max(0, Math.min(item.duration - 1, this.engine.frame - item.start)), this.keySel.size ? (k, f) => this.keySel.has(item.id, k, f) : undefined, (it, lf) => this.laneThumb(m, it, lf));
    }
    this.drawLinks(c, m, p.accent);
    if (endX < this.width) {
      c.fillStyle = p.end;
      c.globalAlpha = 0.55;
      c.fillRect(endX + 6, 0, this.width - endX, this.height);
      c.globalAlpha = 1;
      c.fillStyle = p.tick;
      this.round(c, endX + 2, TOP_PAD - this.scrollY, 5, Math.max(BLOCK_H, this.totalH - LANE_GAP), 3);
      c.fill();
    }
    if (this.drag?.kind === 'box') {
      const d = this.drag;
      c.strokeStyle = p.accent;
      c.setLineDash([4, 4]);
      c.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      c.setLineDash([]);
    }
    if ((this.drag?.kind === 'lasso' || this.drag?.kind === 'keylasso') && this.drag.pts.length > 1) {
      // the glowing trail of the freehand selection, closed back to its start with a faint line
      const pts = this.drag.pts;
      c.save();
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = FREE_RED;
      c.shadowColor = FREE_RED;
      c.shadowBlur = 10;
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
      c.globalAlpha = 0.35;
      c.setLineDash([3, 5]);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      c.lineTo(pts[0][0], pts[0][1]);
      c.stroke();
      c.restore();
    }
    const px = Math.round(this.fx(this.engine.frame)) + 0.5;
    c.strokeStyle = this.engine.mode === 'perform' ? p.accent : p.playhead;
    c.lineWidth = 1.5;
    const spot = this.keySpot(m);
    const solidTo = spot ? Math.max(0, spot.y - 20) : this.height;
    c.beginPath();
    c.moveTo(px, 0);
    c.lineTo(px, solidTo);
    c.stroke();
    if (spot && solidTo < this.height) {
      c.lineWidth = 1;
      c.globalAlpha = 0.4;
      c.beginPath();
      c.moveTo(px, solidTo);
      c.lineTo(px, this.height);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.lineWidth = 1;
    this.ed.drawTracks(c, m, p, this.height);
  }

  /** A dashed link from each block that follows a parent to the parent's block, at the child's first visible frame. */
  private drawLinks(c: CanvasRenderingContext2D, m: Movie, color: string): void {
    for (let i = 0; i < m.tracks.length; i++) {
      for (const item of m.tracks[i].content) {
        if (!item.parent) continue;
        const to = locate(m, item.parent);
        if (!to || to.content.id === item.id) continue;
        const xs = Math.max(this.fx(item.start) + 12, 4);
        const x = Math.min(xs, this.fx(end(item)) - 4);
        if (x < 0 || x > this.width) continue;
        const y0 = this.laneTop(i) + BLOCK_H / 2, y1 = this.laneTop(to.trackIndex) + BLOCK_H / 2;
        if ((y0 < 0 && y1 < 0) || (y0 > this.height && y1 > this.height)) continue;
        c.save();
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineWidth = 1.5;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(x, y0);
        c.lineTo(x, y1);
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.arc(x, y0, 3.5, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(x, y1, 3.5, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
    }
  }

  private geom(item: Content): LaneGeom {
    return { x: (f) => this.fx(item.start + f), x0: this.fx(item.start), x1: this.fx(end(item)), width: this.width };
  }

  /** Centre of the Playhead pill: on the first lane row of the selected content, Keyframe mode only. */
  private keySpot(m: Movie): { c: Content; x: number; y: number } | null {
    if (this.engine.mode === 'compose') return null;
    const sel = this.engine.selected;
    const item = sel.length === 1 ? sel[0] : null;
    const at = item ? locate(m, item.id) : null;
    if (!item || !at || !this.engine.isOver(item)) return null;
    return { c: item, x: Math.round(this.fx(this.engine.frame)) + 0.5, y: this.laneTop(at.trackIndex) + BLOCK_H + LANES_GAP + LANE_H / 2 };
  }

  private placeKeyPill(m: Movie): void {
    const spot = this.keySpot(m);
    if (!spot || spot.x < 0 || spot.x > this.width || spot.y < -20 || spot.y > this.height + 20) {
      setHidden(this.keyPill, true);
      this.actionMenu.hide();
      return;
    }
    const local = this.engine.frame - spot.c.start;
    const keyed = spot.c.keys.find((l) => laneFrames(l).includes(local));
    const key = keyed ? keyed.kind : 'clapper';
    const perf = this.engine.mode === 'perform';
    setHtml(this.keyGlyph, perf ? REC_GLYPH : keyed ? kindSpec(keyed.kind).icon : CLAPPER, perf ? 'rec' : key);
    setClass(this.keyPill, 'is-keyed', !perf && !!keyed);
    // animated but not keyed here: the red icon makes a key at the Playhead when pressed
    setClass(this.keyPill, 'is-pending', !perf && !keyed && spot.c.keys.length > 0);
    this.keyPill.title = !perf && !keyed && spot.c.keys.length > 0 ? 'Make a keyframe here' : 'Action';
    setClass(this.keyPill, 'is-rec', perf && perform.recording);
    // kept whole at frame 0 and at the right edge instead of being cut off by the panel
    const left = Math.max(2, Math.min(spot.x - 32, this.width - 66));
    // on a key the pill rides just above the lane so the key stays visible and tappable
    const top = !perf && keyed ? Math.max(0, spot.y - 49) : spot.y - 20;
    const at = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    if (at !== this.keyPillAt) { this.keyPillAt = at; this.keyPill.style.transform = at; }
    setHidden(this.keyPill, false);
    this.actionMenu.follow();
  }

  private drawBlock(c: CanvasRenderingContext2D, m: Movie, t: Track, item: Content, y: number, selected: boolean, p: Palette): void {
    const x0 = this.fx(item.start), x1 = this.fx(end(item));
    if (x1 < 0 || x0 > this.width) return;
    const w = Math.max(3, x1 - x0);
    c.save();
    this.round(c, x0, y, w, BLOCK_H, 6);
    c.clip();
    c.fillStyle = item.highlight === 'none' ? p.block : p.hl[item.highlight];
    c.fillRect(x0, y, w, BLOCK_H);
    this.drawThumbs(c, m, item, x0, y, w);
    if (item.kind === 'audio') drawSoundOverlay(c, item, x0, y, w, BLOCK_H, this.ppf, selected, 'rgba(0,0,0,.38)', p.accent);
    if (t.hidden) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x0, y, w, BLOCK_H); }
    c.restore();
    // a Multi-select pick is outlined red, as its lasso trail is
    c.strokeStyle = selected ? (this.multi ? '#e5484d' : p.accent) : p.blockLine;
    c.lineWidth = selected ? 2 : 1;
    this.round(c, x0 + (selected ? 1 : 0.5), y + (selected ? 1 : 0.5), w - (selected ? 2 : 1), BLOCK_H - (selected ? 2 : 1), 6);
    c.stroke();
    c.lineWidth = 1;
    if (w > 46) {
      const label = contentName(item.name);
      c.font = '600 10px Inter, system-ui, sans-serif';
      const tw = Math.min(w - 16, c.measureText(label).width + 24);
      c.fillStyle = p.chip;
      this.round(c, x0 + 5, y + 5, tw, 15, 4);
      c.fill();
      c.strokeStyle = p.text;
      c.strokeRect(x0 + 9.5, y + 8.5, 7, 7);
      if (!t.hidden) { c.beginPath(); c.moveTo(x0 + 10.5, y + 12); c.lineTo(x0 + 12.5, y + 14); c.lineTo(x0 + 16, y + 9.5); c.stroke(); }
      c.fillStyle = p.text;
      c.textBaseline = 'middle';
      c.textAlign = 'left';   // not the page direction: the chip sits at the block's left edge
      c.save();
      c.beginPath();
      c.rect(x0 + 19, y + 5, tw - 15, 15);
      c.clip();
      c.fillText(label, x0 + 20, y + 13);
      c.restore();
    }
    if (item.kind === 'video' && w > 24) {
      // film sprocket holes along the top and bottom edges
      c.save();
      c.beginPath();
      c.rect(x0 + 1, y + 1, w - 2, BLOCK_H - 2);
      c.clip();
      c.fillStyle = p.blockLine;
      for (let sx = x0 + 6; sx < x1 - 6; sx += 12) {
        c.fillRect(sx, y + 2, 5, 3);
        c.fillRect(sx, y + BLOCK_H - 5, 5, 3);
      }
      c.restore();
    }
    if (item.kind === 'group' && w > 70) {
      const open = this.opened.has(item.id), ax = x1 - 18, ay = y + 6;
      c.fillStyle = p.chip;
      this.round(c, ax - 3, ay - 2, 18, 16, 4);
      c.fill();
      c.strokeStyle = p.text;
      c.lineWidth = 1.6;
      c.beginPath();
      if (open) { c.moveTo(ax, ay + 3); c.lineTo(ax + 6, ay + 9); c.lineTo(ax + 12, ay + 3); } else { c.moveTo(ax + 3, ay); c.lineTo(ax + 9, ay + 6); c.lineTo(ax + 3, ay + 12); }
      c.stroke();
      c.lineWidth = 1;
    }
    if (selected && w > 16) {
      // Free Trim turns the grabbed edges red and taller
      const free = this.freeTrim(), hh = free ? Math.min(BLOCK_H - 6, 26) : 16;
      c.fillStyle = free ? FREE_RED : p.accent;
      this.round(c, x0 + 2, y + BLOCK_H / 2 - hh / 2, free ? 4 : 3, hh, 1.5);
      c.fill();
      this.round(c, x1 - (free ? 6 : 5), y + BLOCK_H / 2 - hh / 2, free ? 4 : 3, hh, 1.5);
      c.fill();
    }
    if (item.kind === 'group' && this.opened.has(item.id)) this.drawInner(c, item, x0, w, y + BLOCK_H + 4, p);
  }

  /** The tracks inside an opened group, as thin bars in the group's own frames, under its block. */
  private drawInner(c: CanvasRenderingContext2D, g: Content, x0: number, w: number, top: number, p: Palette): void {
    c.save();
    c.beginPath();
    c.rect(x0, top - 4, w, g.tracks.length * (MINI_H + 2) + 8);
    c.clip();
    c.fillStyle = p.laneAlt;
    c.fillRect(x0, top - 4, w, g.tracks.length * (MINI_H + 2) + 8);
    c.font = '600 9px Inter, system-ui, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    g.tracks.forEach((t, i) => {
      const y = top + i * (MINI_H + 2);
      for (const it of t.content) {
        const a = x0 + (it.start - g.offset) * this.ppf, b = x0 + (end(it) - g.offset) * this.ppf;
        if (b < x0 || a > x0 + w) continue;
        this.round(c, a, y, Math.max(3, b - a), MINI_H, 4);
        c.fillStyle = it.highlight === 'none' ? p.block : p.hl[it.highlight];
        c.fill();
        const picked = this.innerSel === it.id;
        c.strokeStyle = picked ? p.accent : p.blockLine;
        c.lineWidth = picked ? 2 : 1;
        c.stroke();
        c.lineWidth = 1;
        if (b - a > 34) { c.fillStyle = p.text; c.fillText(it.name, a + 5, y + MINI_H / 2 + 0.5, b - a - 8); }
      }
    });
    c.restore();
  }

  private drawThumbs(c: CanvasRenderingContext2D, m: Movie, item: Content, x0: number, y: number, w: number): void {
    if (item.kind === 'audio') {
      const p = this.palette();
      c.fillStyle = p.keyBar;
      c.fillRect(x0, y, w, BLOCK_H);
      this.drawWave(c, m, item, x0, w, y + 6, BLOCK_H - 12, p.muted, 0.9);
      return;
    }
    if (item.kind === 'video') {
      this.drawFilmstrip(c, m, item, x0, y, w);
      return;
    }
    const tileW = Math.round(BLOCK_H * (m.width / m.height));
    const thumb = this.thumbFor(m, item, tileW);
    if (!thumb) return;
    const from = Math.max(x0, x0 + Math.floor((0 - x0) / tileW) * tileW);
    for (let x = from; x < Math.min(x0 + w, this.width); x += tileW) c.drawImage(thumb, x, y, tileW, BLOCK_H);
  }

  /** Waveform of the block's asset across its visible span; `top`/`h` is the band it fills, centred. */
  private drawWave(c: CanvasRenderingContext2D, m: Movie, item: Content, x0: number, w: number, top: number, h: number, color: string, alpha: number): void {
    const id = item.asset;
    if (!id || !this.audio) return;
    const pk = this.audio.peaks(id);
    if (!pk) {
      if (!this.decoding.has(id)) {
        this.decoding.add(id);
        void this.audio.decode(id).then(() => this.schedule(), () => undefined);
      }
      return;
    }
    const step = 2;
    const n = pk.max.length;
    let norm = this.peakNorm.get(pk);
    if (norm === undefined) {
      let top0 = 0;
      for (let i = 0; i < n; i++) { const a = Math.max(pk.max[i], -pk.min[i]); if (a > top0) top0 = a; }
      norm = 1 / Math.max(0.3, top0);
      this.peakNorm.set(pk, norm);
    }
    const mid = top + h / 2, half = h / 2;
    c.fillStyle = color;
    c.globalAlpha = alpha;
    for (let x = Math.max(x0, 0); x < Math.min(x0 + w, this.width); x += step) {
      const s0 = srcFrame(item, this.xf(x) - item.start), s1 = srcFrame(item, this.xf(x + step) - item.start);
      const f0 = Math.min(s0, s1), f1 = Math.max(s0, s1);
      // a sound block is drawn as it will be heard: level, level keys and fades scale the wave
      const g = item.kind === 'audio' ? waveGain(item, this.xf(x) - item.start) : 1;
      const a = Math.max(0, Math.floor((f0 / m.fps) * pk.perSecond));
      const b = Math.min(n, Math.max(a + 1, Math.ceil((f1 / m.fps) * pk.perSecond)));
      if (a >= n) break;
      const skip = Math.max(1, Math.floor((b - a) / 12));
      let lo = 0, hi = 0;
      for (let i = a; i < b; i += skip) { if (pk.min[i] < lo) lo = pk.min[i]; if (pk.max[i] > hi) hi = pk.max[i]; }
      const top1 = mid - Math.min(1, hi * norm * g) * half, bot = mid - Math.max(-1, lo * norm * g) * half;
      c.fillRect(x, top1, step - 0.6, Math.max(1, bot - top1));
    }
    c.globalAlpha = 1;
  }

  private drawFilmstrip(c: CanvasRenderingContext2D, m: Movie, item: Content, x0: number, y: number, w: number): void {
    const p = this.palette();
    c.fillStyle = p.end;
    c.fillRect(x0, y, w, BLOCK_H);
    const asset = item.asset ? m.assets[item.asset] : undefined;
    const pool = this.video;
    if (asset && pool) {
      const ratio = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : m.width / m.height;
      const tileW = Math.max(16, Math.round(BLOCK_H * ratio));
      const pw = Math.round(tileW * this.dpr), ph = Math.round(BLOCK_H * this.dpr);
      const last = asset.seconds ? Math.max(0, asset.seconds - 0.001) : Infinity;
      const first = Math.max(0, Math.floor((0 - x0) / tileW));
      for (let k = first; x0 + k * tileW < Math.min(x0 + w, this.width); k++) {
        const x = x0 + k * tileW;
        const sec = Math.min(last, Math.max(0, srcFrame(item, ((k + 0.5) * tileW) / this.ppf) / m.fps));
        const img = pool.thumb(asset.id, sec, pw, ph);
        if (!img) continue;
        c.save();
        c.beginPath();
        c.rect(x, y, Math.min(tileW, x0 + w - x), BLOCK_H);
        c.clip();
        c.drawImage(img, x, y, tileW, BLOCK_H);
        c.restore();
      }
    }
    if (asset?.hasAudio && item.volume > 0) {
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.fillRect(x0, y + BLOCK_H - 14, w, 14);
      this.drawWave(c, m, item, x0, w, y + BLOCK_H - 13, 12, '#ffffff', 0.85);
    }
  }

  /** A small picture of a keyed content with its effects at a local frame, for the lane bars; redrawn when the movie or the frame changes. */
  private laneThumb(m: Movie, item: Content, local: number): HTMLCanvasElement | null {
    const key = `${this.thumbGen}:${local}`;
    let cv = this.laneThumbs.get(item);
    if (cv && (cv.dataset.key === key || this.engine.playing)) return cv;
    if (!cv) { cv = document.createElement('canvas'); cv.width = 64; cv.height = 40; this.laneThumbs.set(item, cv); }
    cv.dataset.key = key;
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!m.transparent) { ctx.fillStyle = m.background; ctx.fillRect(0, 0, cv.width, cv.height); }
    try { this.renderer.thumb(ctx, m, item, local, cv.width, cv.height); } catch { return null; }
    return cv;
  }
  private laneThumbs = new WeakMap<Content, HTMLCanvasElement>();

  private thumbFor(m: Movie, item: Content, tileW: number): HTMLCanvasElement | null {
    const have = this.thumbs.get(item);
    if (have && have.dataset.gen === String(this.thumbGen) && have.width === Math.round(tileW * this.dpr)) return have;
    const cv = have ?? document.createElement('canvas');
    cv.width = Math.max(1, Math.round(tileW * this.dpr));
    cv.height = Math.max(1, Math.round(BLOCK_H * this.dpr));
    cv.dataset.gen = String(this.thumbGen);
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, cv.width, cv.height);
    this.renderer.thumb(ctx, m, item, 0, cv.width, cv.height);
    this.thumbs.set(item, cv);
    return cv;
  }

  private placePill(m: Movie): void {
    const sel = this.engine.selected;
    const c = sel.length === 1 ? sel[0] : null;
    const at = c ? locate(m, c.id) : null;
    const editable = !!c && (c.kind === 'text' || c.kind === 'drawing' || c.kind === 'flipbook');
    if (!c || !at || !editable || this.drag?.kind === 'move') { setHidden(this.editPill, true); return; }
    const y = this.laneTop(at.trackIndex) - 16;
    const x = Math.max(LEFT, Math.min(this.width - 120, this.fx(c.start) + 6));
    setText(this.editPill, t('Edit {kind}').replace('{kind}', t(kindName(c.kind))));
    this.editPill.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    setHidden(this.editPill, y < -20 || y > this.height);
  }

  private round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    c.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, w / 2, h / 2));
  }

  private hit(e: PointerEvent | MouseEvent): { track: Track; index: number; item: Content | null; edge: 'start' | 'end' | null; x: number; y: number } | null {
    const m = this.engine.movie;
    if (!m) return null;
    // a finger needs a wider grip on the edges than a pointer
    const EDGE = (e as PointerEvent).pointerType === 'touch' ? 18 : 7;
    const r = this.tracksCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const index = this.laneAt(y);
    const t = m.tracks[index];
    if (!t) return null;
    const ly = y - this.laneTop(index);
    if (ly < 0 || ly > BLOCK_H) return { track: t, index, item: null, edge: null, x, y };
    for (const item of t.content) {
      const x0 = this.fx(item.start), x1 = this.fx(end(item));
      if (x < x0 - EDGE || x > x1 + EDGE) continue;
      const sel = this.engine.selection.content.includes(item.id);
      const edge = sel && x1 - x0 > EDGE * 3 ? (Math.abs(x - x0) <= EDGE ? 'start' : Math.abs(x - x1) <= EDGE ? 'end' : null) : null;
      if (x >= x0 || edge) return { track: t, index, item, edge, x, y };
    }
    return { track: t, index, item: null, edge: null, x, y };
  }

  /** A bar of an opened group under the pointer (its edges count when the bar is wide enough). */
  private innerHit(e: { clientX: number; clientY: number }): { group: Content; item: Content; edge: 'start' | 'end' | null } | null {
    const m = this.engine.movie;
    if (!m) return null;
    const r = this.tracksCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const t = m.tracks[this.laneAt(y)];
    if (!t) return null;
    const top = this.laneTop(this.laneAt(y)) + BLOCK_H + 4;
    for (const g of t.content) {
      if (g.kind !== 'group' || !this.opened.has(g.id)) continue;
      const gx0 = this.fx(g.start), gx1 = this.fx(end(g));
      if (x < gx0 || x > gx1) continue;
      const row = Math.floor((y - top) / (MINI_H + 2));
      const tr = g.tracks[row];
      if (!tr || y - top - row * (MINI_H + 2) > MINI_H) continue;
      for (const it of tr.content) {
        const a = gx0 + (it.start - g.offset) * this.ppf, b = gx0 + (end(it) - g.offset) * this.ppf;
        if (x < a - 2 || x > b + 2) continue;
        const wide = b - a > 20;
        const edge = wide && x - a <= 5 ? 'start' : wide && b - x <= 5 ? 'end' : null;
        return { group: g, item: it, edge };
      }
    }
    return null;
  }

  private hover(e: PointerEvent): void {
    const h = this.hit(e);
    const m = this.engine.movie;
    const nearEnd = !!m && Math.abs((e.clientX - this.tracksCanvas.getBoundingClientRect().left) - this.fx(m.duration) - 4) < 6;
    this.tracksCanvas.style.cursor = h?.edge || nearEnd ? 'ew-resize' : h?.item ? 'grab' : 'default';
  }

  private rulerDown(e: PointerEvent): void {
    const m = this.engine.movie;
    if (!m || e.button !== 0) return;
    if (this.ed.rulerDown(e)) return;
    this.ruler.setPointerCapture(e.pointerId);
    this.engine.stop();
    const r = this.ruler.getBoundingClientRect();
    const rx = e.clientX - r.left;
    // a plain slide on the Ruler changes the time scale (the frame under the pen stays put); the Playhead
    // handle, or Shift, scrubs; a click without a slide still moves the Playhead there
    // (a finger always scrubs: its pinch and two-finger slide change the scale)
    if (e.pointerType !== 'touch' && (e.altKey || (!e.shiftKey && Math.abs(rx - this.fx(this.engine.frame)) >= 10))) {
      this.drag = { kind: 'zoom', x0: e.clientX, ppf0: this.ppf, anchorFrame: this.xf(rx) };
      if (!e.altKey) this.scrubTo(e);
      return;
    }
    this.drag = { kind: 'scrub' };
    this.flick = e.pointerType === 'touch' || Math.abs(rx - this.fx(this.engine.frame)) < 12 ? [[e.timeStamp, e.clientX]] : null;
    this.scrubTo(e);
  }

  private scrubTo(e: PointerEvent): void {
    const r = this.ruler.getBoundingClientRect();
    this.engine.seek(Math.floor(this.xf(e.clientX - r.left)));
  }

  private tracksDown(e: PointerEvent): void {
    const m = this.engine.movie;
    if (!m) return;
    if (e.button === 1) {
      this.tracksCanvas.setPointerCapture(e.pointerId);
      this.drag = { kind: 'pan', x0: e.clientX, start0: this.start, y0: e.clientY, scroll0: this.scrollY };
      return;
    }
    if (e.button !== 0) return;
    if (this.ed.tracksDown(e)) return;
    this.engine.stop();
    const r = this.tracksCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const h = this.hit(e);
    if (!h?.edge && Math.abs(x - this.fx(m.duration) - 4) < 6) {
      this.tracksCanvas.setPointerCapture(e.pointerId);
      this.drag = { kind: 'duration', x0: e.clientX, d0: m.duration, tag: `dur-${Date.now()}` };
      return;
    }
    const lh = this.laneHit(e);
    if (lh && !this.addsToSelection(e)) { this.keySel.clear(); this.laneDown(e, lh); return; }
    const additive = this.addsToSelection(e);
    if (lh) { this.keyDown(e, lh, x, e.clientY - r.top); return; }
    const inner = this.engine.mode === 'compose' ? this.innerHit(e) : null;
    if (inner) {
      this.tracksCanvas.setPointerCapture(e.pointerId);
      this.innerSel = inner.item.id;
      this.engine.select([inner.group.id]);
      this.engine.seek(Math.max(inner.group.start, Math.min(end(inner.group) - 1, Math.floor(this.xf(x)))));
      this.drag = { kind: 'inner', id: inner.item.id, mode: inner.edge ?? 'move', x0: e.clientX, applied: 0, moved: false, tag: `inner-${Date.now()}` };
      this.schedule();
      return;
    }
    if (this.innerSel) { this.innerSel = null; this.schedule(); }
    if (h?.item) {
      this.tracksCanvas.setPointerCapture(e.pointerId);
      if (h.item.kind === 'group' && this.engine.mode === 'compose' && end(h.item) > h.item.start && h.y - this.laneTop(h.index) < 24) {
        const x1 = this.fx(end(h.item));
        if (x1 - this.fx(h.item.start) > 70 && x >= x1 - 22 && x <= x1 - 1) {
          if (this.opened.has(h.item.id)) this.opened.delete(h.item.id); else this.opened.add(h.item.id);
          this.layoutFor = null;
          this.schedule();
          return;
        }
      }
      if (h.item.kind === 'audio' && this.engine.selection.content.includes(h.item.id)) {
        const bx = this.fx(h.item.start);
        const which = fadeHandleAt(h.item, x - bx, h.y - this.laneTop(h.index), this.fx(end(h.item)) - bx, BLOCK_H, this.ppf, e.pointerType === 'touch' ? 14 : 7);
        if (which) { this.drag = { kind: 'fade', id: h.item.id, which, tag: `fade-${Date.now()}` }; return; }
      }
      if (h.edge) {
        const d: Drag = { kind: 'trim', id: h.item.id, edge: h.edge, x0: e.clientX, applied: 0, ripple: e.altKey || this.altDown, tag: `trim-${Date.now()}` };
        this.drag = d;
        // held still on an edge until it turns red: the drag then pushes and pulls what follows
        if (!d.ripple) d.hold = window.setTimeout(() => { if (this.drag === d && d.applied === 0) { d.ripple = true; this.syncFreeTrim(); } }, 450);
        else this.syncFreeTrim();
        return;
      }
      const onLine = Math.abs(x - this.fx(this.engine.frame)) < 6;
      if (additive) this.engine.toggleSelect(h.item.id);
      else if (!this.engine.selection.content.includes(h.item.id)) this.engine.select([h.item.id], h.track.id);
      if (!additive) this.engine.seek(Math.max(h.item.start, Math.min(end(h.item) - 1, Math.floor(this.xf(x)))));
      this.drag = { kind: 'move', x0: e.clientX, y0: e.clientY, applied: 0, appliedTrack: 0, tag: `move-${Date.now()}`, moved: false };
      if (!additive && (onLine || e.pointerType !== 'touch')) {
        // held still (mouse or pen: anywhere on the block; a finger: on the Playhead line): its options, with Split at the Playhead
        const px = e.clientX, py = e.clientY;
        this.holdFor(this.drag, px, py, () => this.contextMenu(new MouseEvent('contextmenu', { clientX: px, clientY: py, cancelable: true })));
      }
      return;
    }
    this.tracksCanvas.setPointerCapture(e.pointerId);
    if (additive || this.multi) {
      const y = e.clientY - r.top;
      if (this.multi) this.drag = { kind: 'lasso', pts: [[x, y]], base: this.engine.selection.content.slice() };
      else this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, base: this.engine.selection.content.slice() };
      return;
    }
    this.keySel.clear();
    this.engine.select([], h?.track.id ?? this.engine.selection.track);
    const sd: Drag = { kind: 'scrub' };
    this.drag = sd;
    this.engine.seek(Math.floor(this.xf(x)));
    if (e.pointerType !== 'touch') {
      // a mouse or pen held still on empty track area opens the same menu as a right-click
      const px = e.clientX, py = e.clientY;
      this.holdFor(sd, px, py, () => this.contextMenu(new MouseEvent('contextmenu', { clientX: px, clientY: py, cancelable: true })));
    }
  }

  /** Arms the press-and-hold menu. It opens only if the press has not moved: the Playhead is where the press put it
   *  and no drag has begun; the history gesture, if one is open, is closed. */
  private holdFor(d: Drag, x: number, y: number, open: () => void): void {
    this.pressAt = [x, y];
    this.cancelLongPress();
    const f0 = this.engine.frame;
    this.longPress = window.setTimeout(() => {
      this.longPress = 0;
      if (this.drag !== d || this.engine.frame !== f0) return;
      if (d.kind === 'move' && (d.moved || d.applied !== 0 || d.appliedTrack !== 0)) return;
      if (d.kind === 'key' && d.cur !== d.from0) return;
      this.drag = null;
      this.engine.endGesture();
      open();
    }, 500);
  }

  private laneHit(e: { clientX: number; clientY: number }): { c: Content; track: Track; hit: LaneHit } | null {
    const m = this.engine.movie;
    if (!m || this.engine.mode === 'compose') return null;
    const r = this.tracksCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const i = this.laneAt(y);
    const t = m.tracks[i];
    if (!t) return null;
    const top = this.laneTop(i) + BLOCK_H + LANES_GAP;
    if (y < top) return null;
    for (const c of t.content) {
      if (!c.keys.length) continue;
      const hit = hitLanes(c, top, x, y, this.geom(c), (px) => this.xf(px) - c.start);
      if (hit) return { c, track: t, hit };
    }
    return null;
  }

  private laneDown(e: PointerEvent, lh: { c: Content; track: Track; hit: LaneHit }): void {
    const { c, track, hit } = lh;
    if (hit.graph && this.hooks.graph) {
      this.engine.select([c.id], track.id);
      this.hooks.graph(c.id, hit.slot.lane.kind, hit.row.channel);
      return;
    }
    if (hit.toggle) {
      const lane = hit.slot.lane;
      this.engine.select([c.id], track.id);
      this.engine.run(lane.expanded ? 'Collapse Lane' : 'Expand Lane', (mv) => ops.updateContent(mv, c.id, (x) => keyOps.setExpanded(x, lane.kind, !lane.expanded)));
      return;
    }
    this.tracksCanvas.setPointerCapture(e.pointerId);
    if (!this.engine.selection.content.includes(c.id) || this.engine.selection.content.length !== 1) this.engine.select([c.id], track.id);
    const last = c.duration - 1;
    if (hit.key !== null) {
      this.engine.seek(c.start + hit.key);
      this.drag = { kind: 'key', id: c.id, lk: hit.slot.lane.kind, channel: hit.row.channel, from0: hit.key, cur: hit.key, base: c, x0: e.clientX, tag: `key-${Date.now()}` };
    } else {
      this.engine.seek(c.start + Math.max(0, Math.min(last, hit.at)));
      this.drag = { kind: 'scrub' };
    }
    {
      const x = e.clientX, y = e.clientY;
      if (this.drag) this.holdFor(this.drag, x, y, () => this.openLaneMenu(lh, x, y));
    }
  }

  /** Multi-select on the key lanes: a click chooses or drops a key; a drag draws a lasso over keys. */
  private keyDown(e: PointerEvent, lh: { c: Content; track: Track; hit: LaneHit }, x: number, y: number): void {
    this.tracksCanvas.setPointerCapture(e.pointerId);
    const { c, hit } = lh;
    if (hit.key !== null) {
      this.keySel.toggle(c.id, hit.slot.lane.kind, hit.key);
      if (!this.engine.selection.content.includes(c.id)) this.engine.toggleSelect(c.id);
      this.schedule();
      return;
    }
    const base = new Map<string, KeyRef[]>();
    for (const id of this.keySel.ids()) base.set(id, this.keySel.refs(id));
    this.drag = { kind: 'keylasso', pts: [[x, y]], base };
  }

  /** Keys whose glyph the lasso encloses or crosses, per content. */
  private keysUnder(pts: readonly Pt[], m: Movie): Map<string, KeyRef[]> {
    const out = new Map<string, KeyRef[]>();
    if (this.engine.mode === 'compose') return out;
    m.tracks.forEach((t, i) => {
      const top = this.laneTop(i) + BLOCK_H + LANES_GAP;
      if (top > this.height + 200 || top + this.rowH[i] < -200) return;
      for (const c of t.content) {
        if (!c.keys.length) continue;
        const seen = new Set<string>();
        for (const slot of laneSlots(c)) {
          for (const row of slot.rows) {
            const cy = top + slot.y + row.y + row.h / 2;
            for (const f of laneFrames(slot.lane, row.channel ?? undefined)) {
              const k = `${slot.lane.kind}:${f}`;
              if (seen.has(k)) continue;
              const kx = this.fx(c.start + f);
              if (inPoly(pts, kx, cy) || nearTrail(pts, kx, cy, 8)) { seen.add(k); (out.get(c.id) ?? out.set(c.id, []).get(c.id)!).push({ kind: slot.lane.kind, frame: f }); }
            }
          }
        }
      }
    });
    return out;
  }

  /** Multi-select button, a modifier key, or (a finger with the "Multi-select with finger" preference) a plain touch. */
  private addsToSelection(e: PointerEvent): boolean {
    return this.multi || e.shiftKey || e.metaKey || e.ctrlKey || (e.pointerType === 'touch' && loadPrefs().multiFinger);
  }

  private cancelLongPress(): void {
    if (this.longPress) { window.clearTimeout(this.longPress); this.longPress = 0; }
  }

  private openLaneMenu(lh: { c: Content; track: Track; hit: LaneHit }, x: number, y: number): void {
    const { c, track, hit } = lh;
    if (!this.engine.selection.content.includes(c.id) || this.engine.selection.content.length !== 1) this.engine.select([c.id], track.id);
    const lane = hit.slot.lane;
    const channel = hit.row.channel;
    const at = Math.max(0, Math.min(c.duration - 1, hit.key ?? hit.at));
    this.laneMenu.open(x, y, {
      id: c.id, kind: lane.kind, at, onKey: hit.key !== null, channel,
      prev: keyBefore(lane, at, channel ?? undefined), expanded: lane.expanded,
    });
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    const m = this.engine.movie;
    if (!d || !m) return;
    if (this.longPress && Math.hypot(e.clientX - this.pressAt[0], e.clientY - this.pressAt[1]) > 6) this.cancelLongPress();
    // a second finger held on a trim is Free Trim, as Alt is
    if (d.kind === 'trim' && !d.ripple && touchModifier()) { d.ripple = true; this.syncFreeTrim(); }
    const speed = this.hooks.scrubSpeed();
    if (d.kind === 'key') {
      const c = this.engine.selected.find((it) => it.id === d.id);
      if (!c) return;
      const to = Math.max(0, Math.min(c.duration - 1, Math.round(d.from0 + (e.clientX - d.x0) / this.ppf)));
      if (to === d.cur) return;
      this.cancelLongPress();
      const base = d.base, kind = d.lk, from0 = d.from0, channel = d.channel ?? undefined;
      if (this.engine.run('Move Keyframe', (mv) => ops.updateContent(mv, d.id, () => keyOps.moveKey(base, kind, from0, to, channel)), d.tag)) {
        d.cur = to;
        this.engine.seek(c.start + to);
      }
    } else if (d.kind === 'scrub') {
      if (this.flick) { this.flick.push([e.timeStamp, e.clientX]); if (this.flick.length > 12) this.flick.shift(); }
      const r = this.ruler.getBoundingClientRect();
      this.engine.seek(Math.floor(this.xf(e.clientX - r.left)));
    } else if (d.kind === 'zoom') {
      if (Math.abs(e.clientX - d.x0) < 3 && !d.moved) return;
      d.moved = true;
      const factor = Math.exp((e.clientX - d.x0) * 0.01);
      const ax = this.fx(d.anchorFrame);
      this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), d.ppf0 * factor));
      this.start = Math.max(0, d.anchorFrame - (ax - LEFT) / this.ppf);
      this.schedule();
    } else if (d.kind === 'pan') {
      this.start = Math.max(0, d.start0 - (e.clientX - d.x0) / this.ppf);
      this.scrollY = this.clampScroll(d.scroll0 - (e.clientY - d.y0), m);
      this.schedule();
    } else if (d.kind === 'move') {
      let total = Math.round(((e.clientX - d.x0) / this.ppf) * speed);
      const lanes = Math.round((e.clientY - d.y0) / STRIDE);
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
      d.moved = true;
      const ids = this.engine.selection.content;
      total = this.ed.snapMove(m, ids, d.tag, d.applied, total, e);
      const step = total - d.applied, laneStep = lanes - d.appliedTrack;
      if (!step && !laneStep) return;
      if (this.tryRun('Move Content', (mv) => ops.moveContent(mv, ids, step, laneStep), d.tag)) { d.applied = total; d.appliedTrack = lanes; }
    } else if (d.kind === 'inner') {
      const total = Math.round(((e.clientX - d.x0) / this.ppf) * speed);
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
      d.moved = true;
      const step = total - d.applied;
      if (!step) return;
      const ok = d.mode === 'move'
        ? this.tryRun('Move Content', (mv) => groupInner.moveInner(mv, [d.id], step), d.tag)
        : this.tryRun('Trim', (mv) => groupInner.trimInner(mv, d.id, d.mode as 'start' | 'end', step), d.tag);
      if (ok) d.applied = total;
    } else if (d.kind === 'fade') {
      const item = this.engine.selected.find((it) => it.id === d.id);
      if (!item) return;
      const bx = this.fx(item.start), w = this.fx(end(item)) - bx;
      const px = e.clientX - this.tracksCanvas.getBoundingClientRect().left - bx;
      this.engine.run(d.which === 'in' ? 'Fade In' : 'Fade Out', (mv) => setFade(mv, d.id, d.which, fadeFramesFor(d.which, px, w, this.ppf)), d.tag);
    } else if (d.kind === 'trim') {
      const total = this.ed.snapTrim(m, d.id, d.edge, d.tag, d.applied, Math.round(((e.clientX - d.x0) / this.ppf) * speed), e);
      const step = total - d.applied;
      if (!step) return;
      if (this.tryRun(d.ripple ? 'Free Trim' : 'Trim', (mv) => ops.trimContent(mv, d.id, d.edge, step, d.ripple), d.tag)) d.applied = total;
    } else if (d.kind === 'box') {
      const r = this.tracksCanvas.getBoundingClientRect();
      d.x1 = e.clientX - r.left;
      d.y1 = e.clientY - r.top;
      const f0 = this.xf(Math.min(d.x0, d.x1)), f1 = this.xf(Math.max(d.x0, d.x1));
      const l0 = this.laneAt(Math.min(d.y0, d.y1)), l1 = this.laneAt(Math.max(d.y0, d.y1));
      const ids = new Set(d.base);
      m.tracks.forEach((t, i) => { if (i < l0 || i > l1) return; for (const c of t.content) if (end(c) > f0 && c.start < f1) ids.add(c.id); });
      this.engine.select([...ids]);
      this.schedule();
    } else if (d.kind === 'lasso') {
      const r = this.tracksCanvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top, last = d.pts[d.pts.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 2) return;
      d.pts.push([x, y]);
      // crossing what is already chosen drops it; enclosing or crossing anything else adds it
      const next = new Set(d.base), base = new Set(d.base);
      m.tracks.forEach((t, i) => {
        const y0 = this.laneTop(i);
        for (const c of t.content) {
          const a = this.fx(c.start), b = this.fx(end(c));
          if (!lassoTouches(d.pts, a, y0, Math.max(3, b - a), BLOCK_H)) continue;
          if (base.has(c.id)) next.delete(c.id); else next.add(c.id);
        }
      });
      this.engine.select([...next]);
      this.schedule();
    } else if (d.kind === 'keylasso') {
      const r = this.tracksCanvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top, last = d.pts[d.pts.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 2) return;
      d.pts.push([x, y]);
      const touched = this.keysUnder(d.pts, m), result = new Map<string, KeyRef[]>();
      const names = new Set([...d.base.keys(), ...touched.keys()]);
      for (const id of names) {
        const was = new Map((d.base.get(id) ?? []).map((k) => [`${k.kind}:${k.frame}`, k]));
        const hit = new Map((touched.get(id) ?? []).map((k) => [`${k.kind}:${k.frame}`, k]));
        const merged = new Map(was);
        for (const [k, ref] of hit) { if (was.has(k)) merged.delete(k); else merged.set(k, ref); }
        if (merged.size) result.set(id, [...merged.values()]);
      }
      const ids = [...result.keys()];
      const cur = this.engine.selection.content;
      if (ids.length && (ids.length !== cur.length || ids.some((id) => !cur.includes(id)))) this.engine.select(ids);
      this.keySel.set(result);
      this.schedule();
    } else if (d.kind === 'duration') {
      if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
      const next = Math.max(1, Math.round(d.d0 + (e.clientX - d.x0) / this.ppf));
      if (next !== m.duration) this.tryRun('Movie Duration', (mv) => ops.patchMovie(mv, { duration: next }), d.tag);
    }
  }

  private tryRun(label: string, fn: (m: Movie) => Movie, tag: string): boolean {
    const m = this.engine.movie;
    if (!m) return false;
    try { fn(m); } catch (err) { if (err instanceof ops.OpError) return false; throw err; }
    return this.engine.run(label, fn, tag);
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.ed.clear();
    if (this.thumbStale) { this.thumbStale = false; this.thumbGen++; }
    this.cancelLongPress();
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* released */ }
    const fl = this.flick;
    this.flick = null;
    if (!d) return;
    if (d.kind === 'scrub' && fl && fl.length > 2 && e.type === 'pointerup') {
      // a quick leftward flick of the Playhead plays from where it was let go
      const last = fl[fl.length - 1];
      const from = fl.find((s) => last[0] - s[0] <= 120) ?? last;
      const dt = last[0] - from[0];      if (dt > 0 && (last[1] - from[1]) / dt < -0.9 && last[1] - from[1] < -40 && last[0] - e.timeStamp > -80) this.engine.play();
    }
    if (d.kind === 'trim') { window.clearTimeout(d.hold); this.syncFreeTrim(); }
    // a tap on a key (no drag) opens its values
    if (d.kind === 'key' && d.cur === d.from0 && e.type === 'pointerup' && this.engine.mode !== 'perform') this.actionMenu.editKey(this.keyPill, d.lk);
    if (d.kind === 'duration' && !d.moved) this.endMenu.open(e.clientX, e.clientY);
    if (d.kind === 'move' || d.kind === 'trim' || d.kind === 'duration' || d.kind === 'key' || d.kind === 'inner' || d.kind === 'fade') this.engine.endGesture();
    if (d.kind === 'move' && !d.moved && !this.addsToSelection(e)) {
      const h = this.hit(e);
      if (h?.item) this.engine.select([h.item.id], h.track.id);
    }
    this.schedule();
  }

  private contextMenu(e: MouseEvent): void {
    e.preventDefault();
    const m = this.engine.movie;
    if (m && Math.abs(e.clientX - this.tracksCanvas.getBoundingClientRect().left - this.fx(m.duration) - 4) < 8) { this.endMenu.open(e.clientX, e.clientY); return; }
    const lh = this.laneHit(e);
    if (lh && this.keySel.size && (lh.hit.key === null ? this.multi : this.keySel.has(lh.c.id, lh.hit.slot.lane.kind, lh.hit.key))) { this.keyMenu.open(e.clientX, e.clientY); return; }
    if (lh) { this.openLaneMenu(lh, e.clientX, e.clientY); return; }
    const h = this.hit(e);
    if (!h) return;
    if (h.item) {
      if (!this.engine.selection.content.includes(h.item.id)) this.engine.select([h.item.id], h.track.id);
      this.hooks.contentMenu(e.clientX, e.clientY);
    } else {
      this.engine.select([], h.track.id);
      this.hooks.trackMenu(e.clientX, e.clientY, h.track.id);
    }
  }

  private doubleClick(e: MouseEvent): void {
    const h = this.hit(e);
    if (h?.item) this.hooks.edit(h.item);
    else this.zoomToFrames(e.clientX);
  }

  private clampScroll(y: number, m: Movie): number {
    this.layout(m);
    // room for the floating mode switch: its height and the gap under it, so the last lane scrolls clear
    const sw = this.modesEl.offsetHeight;
    const content = TOP_PAD + this.totalH + (sw > 0 ? sw + 12 + 12 : 100);
    return Math.max(0, Math.min(Math.max(0, content - this.height), y));
  }

  /** Fingers: pinch for the time scale, two-finger slide to pan, three fingers slide for time scale (across) and track height (up and down); a pen hovering over the Ruler or Tracks scrubs. */
  private bindGestures(): void {
    let base = { ppf: 0, start: 0, scrollY: 0, row: 0, anchor: 0, x: 0 };
    gestureRegion(this.root, {
      dragging: () => {
        const k = this.drag?.kind;
        return k === 'move' || k === 'trim' || k === 'key' || k === 'duration' || k === 'box' || k === 'lasso' || k === 'keylasso';
      },
      holdOwn: (target, x, y) => target === this.tracksCanvas && !!this.laneHit({ clientX: x, clientY: y }),
      begin: (_n, cx) => {
        const x = cx - this.lanes.getBoundingClientRect().left;
        base = { ppf: this.ppf, start: this.start, scrollY: this.scrollY, row: BLOCK_H, anchor: this.xf(x), x };
      },
      change: (i) => {
        const m = this.engine.movie;
        if (!m) return;
        const r = this.lanes.getBoundingClientRect();
        if (i.fingers === 2) {
          this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), base.ppf * i.k));
          this.start = Math.max(0, base.anchor - (i.cx - r.left - LEFT) / this.ppf);
          this.scrollY = this.clampScroll(base.scrollY - i.dy, m);
        } else {
          this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), base.ppf * Math.exp(i.dx / 180)));
          this.start = Math.max(0, base.anchor - (base.x - LEFT) / this.ppf);
          this.setRowHeight(base.row * Math.exp(-i.dy / 220));
          this.scrollY = this.clampScroll(this.scrollY, m);
        }
        this.fitted = true;
        this.schedule();
      },
    });
    const hover = (e: PointerEvent): void => {
      const m = this.engine.movie;
      if (!m || this.drag) return;
      const r = this.ruler.getBoundingClientRect();
      this.engine.seek(Math.max(0, Math.min(m.duration - 1, Math.floor(this.xf(e.clientX - r.left)))));
    };
    penHover(this.ruler, hover);
    penHover(this.tracksCanvas, hover);
  }

  private wheel(e: WheelEvent): void {
    const m = this.engine.movie;
    if (!m) return;
    e.preventDefault();
    const r = this.lanes.getBoundingClientRect();
    if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
      // track height: up enlarges the tracks, down shrinks them to fit more
      this.setRowHeight(BLOCK_H * Math.exp(-e.deltaY * 0.002));
      this.scrollY = this.clampScroll(this.scrollY, m);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const x = e.clientX - r.left, anchor = this.xf(x);
      this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), this.ppf * Math.exp(-e.deltaY * 0.002)));
      this.start = Math.max(0, anchor - (x - LEFT) / this.ppf);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.start = Math.max(0, this.start + (e.shiftKey ? e.deltaY : e.deltaX) / this.ppf);
    } else {
      this.scrollY = this.clampScroll(this.scrollY + e.deltaY, m);
    }
    this.schedule();
  }

  canPlace(t: Track, start: number, duration: number): boolean {
    return fits(t, start, duration);
  }
}
