import type { Engine } from '../engine/engine';
import { end, fits, kindName, locate } from '../engine/model';
import * as ops from '../engine/ops';
import * as groupInner from '../engine/group-inner-ops';
import { groupCtx } from '../engine/group-ctx';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import type { VideoPool } from '../media/video';
import { timecode } from '../engine/time';
import type { Content, Highlight, KeyKind, Mode, Movie, Track } from '../engine/types';
import * as keyOps from '../engine/key-ops';
import { kindSpec, laneFrames } from '../engine/keys';
import { contentName, redrawOnLanguage, secondsLabel } from './canvas-words';
import { t } from './i18n';
import { t as tr } from './i18n';
import { ActionMenu, CLAPPER, LaneMenu, newKeyState } from './action-menu';
import { keyHome, keyTip, snapKeyFrame } from './key-snap';
import { openKeyField } from './key-inline';
import { KeyGroupDrag } from './key-group';
import { keyChosen } from './key-state';
import { mods, perform, REC_GLYPH } from './perform-ui';
import { el, q, setClass, setHidden, setHtml, setText, setTitle } from './dom';
import { icon } from './icons';
import { cameraMode } from './camera-view';
import { LANES_GAP, LANE_H, drawLanes, hitLanes, keyBefore, laneSlots, lanesHeight, setGlyphLoadHandler, setLaneHover, type LaneGeom, type LaneHit } from './key-lanes';
import { EndBarMenu, KeySelMenu, KeySelection, inPoly, lassoTouches, nearTrail, type Pt } from './timeline-extras';
import type { KeyRef } from '../engine/key-sel-ops';
import { gestureRegion, penHover, touchModifier } from './gestures';
import { loadPrefs } from './prefs';
import { drawSoundOverlay, fadeFramesFor, fadeHandleAt, waveGain } from './timeline-sound';
import { setFade } from '../media/audio-edit';
import { TimelineEd } from './timeline-ed';
import { MasterMeter, drawTrackMeter } from './audio-meter';
import { srcFrame } from '../engine/retime';
import * as lockOps from '../engine/lock-ops';
import * as hideOps from '../engine/hide-ops';
import { drawBrackets, drawChevron, drawLift, drawLockHatch, drawSoundMark } from './timeline-marks';
import { chipFill, drawFlipCells, drawGroupPreview } from './timeline-look';
import { TrackHeads } from './timeline-heads';
import { InnerMenu } from './timeline-inner';
import { laneFocus } from './lane-focus';
import { loadView, saveView, type SavedView } from './timeline-view';
type SavedViewArgs = SavedView & { id: string };
import { rulerDrag, SpacePan } from './timeline-nav';
import { toast } from './toast';

const RULER_H = 28;
// Track height scales (Ctrl+Shift+wheel): BLOCK_H and STRIDE are set together by setRowHeight.
let BLOCK_H = 44;
const LANE_GAP = 10;
let STRIDE = BLOCK_H + LANE_GAP;
const MIN_BLOCK_H = 26;
const MAX_BLOCK_H = 110;
const FREE_RED = '#e5484d';
const LEFT_BASE = 14;
/** Frame zero's x: the base gutter plus the width of the track header column when it shows. */
let LEFT = LEFT_BASE;
const RIGHT = 24;
const TOP_PAD = 26;
const EDGE = 7;
const MIN_PPF = 0.05;
const MAX_PPF = 64;

/** True for a pale #rgb / #rrggbb color (white-ish text); anything it cannot read counts as dark. */
function lightInk(css: string): boolean {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(css.trim())?.[1];
  if (!h) return false;
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 170;
}

interface InnerHit { group: Content; item: Content; edge: 'start' | 'end' | null; lane: number; rowTop: number; x0: number; x1: number; track: Track }

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
  | { kind: 'move'; x0: number; y0: number; applied: number; appliedTrack: number; tag: string; moved: boolean; id: string; lane0: number; s0: number; gx: number; gy: number; px: number; py: number; insert: number | null; blocked: boolean; want: number; wantLane: number }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; x0: number; applied: number; ripple: boolean; tag: string; hold?: number }
  | { kind: 'fade'; id: string; which: 'in' | 'out'; tag: string }
  | { kind: 'inner'; id: string; mode: 'move' | 'start' | 'end'; x0: number; y0: number; applied: number; appliedRow: number; moved: boolean; tag: string; lane0: number; gx: number; itemStart: number; w: number; out: { lane: number; insert: number | null } | null }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; base: string[] }
  | { kind: 'lasso'; pts: Pt[]; base: string[] }
  | { kind: 'keylasso'; pts: Pt[]; base: Map<string, KeyRef[]> }
  | { kind: 'duration'; x0: number; d0: number; tag: string; moved?: boolean }
  | { kind: 'lane'; id: string; tag: string; moved: boolean }
  | { kind: 'pan'; x0: number; start0: number; y0: number; scroll0: number; tap?: number }
  | { kind: 'key'; id: string; lk: KeyKind; channel: string | null; from0: number; cur: number; base: Content; x0: number; tag: string }
  | { kind: 'keygroup'; g: KeyGroupDrag; id: string; lk: KeyKind; key: number };

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
  /** The selected block's outline: the accent unless a theme sets --fm-tl-select. */
  select: string;
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
        <span class="fm-zoom-grp"><button class="fm-heads-btn" type="button" data-act="heads" title="Track headers: show, narrow, hide" aria-label="Track headers"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 9h.01M5.5 13h.01"/></svg></button></span>
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
  private readonly keySel: KeySelection = keyChosen;
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
  /** Inner blocks shifted to the movie's frames, kept so their thumbnails stay cached between draws. */
  private readonly proxies = new WeakMap<Content, Content>();
  private get innerSel(): string | null { return groupCtx.picked; }
  private set innerSel(v: string | null) { groupCtx.picked = v; }
  /** A ghost and insertion line while something is carried toward the lanes: an inner block leaving its group, or files from the desktop. */
  private cue: { x: number; y: number; w: number; insertY: number | null; label: string } | null = null;
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
  /** The track header column (off by default). */
  private readonly heads: TrackHeads;
  /** Any track on solo: other tracks' sound blocks dim. */
  private anySolo = false;
  /** The message of the last refused move (for the toast on a blocked drop). */
  private lastErr = '';
  /** A saved view waiting for the first fit of a reopened movie. */
  private pendingView: ReturnType<typeof loadView> = null;
  private viewKey = '';
  /** The view waiting for its 400 ms write; flushed at once when another movie opens. */
  private viewSnap: SavedViewArgs | null = null;
  private viewTimer = 0;
  /** The track row under the pointer (tinted, so a right-click on it, the track menu, is findable); -1 for none. */
  private hoverLane = -1;
  private headsToast: (() => void) | null = null;
  private headsToastTimer = 0;
  private readonly space: SpacePan;

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer, private readonly hooks: TimelineHooks) {
    host.appendChild(this.root);
    this.space = new SpacePan(engine, q(this.root, '.fm-tl-body'), this.root);
    laneFocus.onChange = () => this.schedule();
    // new tracks and content go inside the open group being worked in: the one holding the picked block, else the selected group
    groupCtx.target = () => {
      const m = engine.movie;
      if (!m || engine.mode !== 'compose' || !this.opened.size) return null;
      const own = groupCtx.picked ? groupInner.ownerGroup(m.tracks, groupCtx.picked) : null;
      if (own && this.opened.has(own.id)) return own.id;
      const g = engine.selected.length === 1 && engine.selected[0].kind === 'group' ? engine.selected[0] : null;
      return g && this.opened.has(g.id) ? g.id : null;
    };
    this.heads = new TrackHeads(this.lanes, engine, {
      laneTop: (i) => this.laneTop(i), blockH: () => BLOCK_H, laneAt: (y) => this.laneAt(y),
      menu: (x, y, id) => { this.engine.select([], id); this.hooks.trackMenu(x, y, id); },
      layout: () => this.headsLayout(),
    });
    LEFT = LEFT_BASE + (this.heads.width ? this.heads.width + 4 : 0);
    setClass(q(this.root, '.fm-heads-btn'), 'is-on', this.heads.mode !== 'off');
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
    this.ruler.addEventListener('dblclick', (e) => this.zoomToFrames(e.clientX, e.ctrlKey || e.metaKey));
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
    this.ruler.title = 'Drag to scrub. Hold Alt and drag to scale time.';
    this.ruler.addEventListener('pointermove', (e) => {
      if (this.drag || e.pointerType === 'touch') return;
      const nearHead = Math.abs(e.clientX - this.ruler.getBoundingClientRect().left - this.fx(this.engine.frame)) < 10;
      const scale = e.altKey || (rulerDrag.mode === 'scale' && !e.shiftKey && !nearHead);
      this.ruler.style.cursor = scale ? 'ew-resize' : 'grab';
      const tip = rulerDrag.mode === 'scale' ? 'Drag to scale time. Drag the Playhead, or hold Shift, to scrub.' : 'Drag to scrub. Hold Alt and drag to scale time.';
      if (this.ruler.title !== tip) this.ruler.title = tip;
    });
    this.tracksCanvas.addEventListener('pointerdown', (e) => this.tracksDown(e));
    for (const c of [this.ruler, this.tracksCanvas]) {
      c.addEventListener('pointermove', (e) => this.pointerMove(e));
      c.addEventListener('pointerup', (e) => this.pointerUp(e));
      c.addEventListener('pointercancel', (e) => this.pointerUp(e));
    }
    this.tracksCanvas.addEventListener('pointermove', (e) => { if (!this.drag) this.hover(e); });
    this.tracksCanvas.addEventListener('pointerleave', () => { if (this.hoverLane !== -1) { this.hoverLane = -1; this.schedule(); } });
    this.tracksCanvas.addEventListener('pointerleave', () => setLaneHover(null));
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
        this.revealSelected();
      }
      this.schedule();
    });
    engine.on('time', () => this.schedule());
    engine.on('mode', (m) => this.syncMode(m));
    engine.on('playing', (on) => this.syncPlay(on));
    engine.on('projects', () => { const id = engine.movie?.id ?? ''; if (id !== this.lastMovieId) { this.flushView(); this.lastMovieId = id; this.fitted = false; this.scrollY = 0; this.pendingView = id ? loadView(id) : null; this.viewKey = ''; this.schedule(); } });
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

  /** A picked block never sits under the mode switch and the zoom buttons: the lanes scroll until its row clears them. */
  private revealSelected(): void {
    const m = this.engine.movie, id = this.engine.selection.content[0];
    const at = m && id ? locate(m, id) : null;
    if (!m || !at || this.height <= 0 || this.drag?.kind === 'move') return;
    const clear = this.height - (this.modesEl.offsetHeight || 56) - 20;
    const bottom = this.laneTop(at.trackIndex) + BLOCK_H;
    if (bottom > clear) { this.scrollY = this.clampScroll(this.scrollY + (bottom - clear), m); }
  }

  refreshThumbs(): void {
    this.thumbs = new WeakMap();
    this.flipTiles = new WeakMap();
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
  private zoomToFrames(clientX: number, back = false): void {
    const m = this.engine.movie;
    if (!m || this.width <= 0) return;
    // each double-click steps in by three, around the click; Ctrl (or Cmd) double-click returns to the whole movie
    if (back) { this.fit(); return; }
    const r = this.lanes.getBoundingClientRect();
    const x = clientX - r.left, anchor = this.xf(x);
    this.ppf = Math.min(MAX_PPF, this.ppf * 3);
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
      else extra = this.rowExtra(t);
      this.tops.push(y);
      this.rowH.push(STRIDE + extra);
      y += STRIDE + extra;
    }
    this.totalH = y;
  }

  /** Height an opened group adds under its block: its tracks as full tracks, nested open groups included. */
  private groupH(g: Content): number {
    let h = 8;
    for (const t of g.tracks) h += STRIDE + this.rowExtra(t);
    return h;
  }

  private rowExtra(t: Track): number {
    let x = 0;
    for (const c of t.content) if (c.kind === 'group' && this.opened.has(c.id)) x = Math.max(x, this.groupH(c));
    return x;
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
    else if (act === 'heads') {
      this.heads.cycle();
      // the last notice goes at once and this one is also taken down by our own timer, so none lingers
      this.headsToast?.();
      window.clearTimeout(this.headsToastTimer);
      const off = toast(this.heads.mode === 'off' ? 'Track headers hidden' : this.heads.mode === 'full' ? 'Track headers shown' : 'Track headers narrow', 'info', { ms: 1100 });
      this.headsToast = off;
      this.headsToastTimer = window.setTimeout(() => { off(); if (this.headsToast === off) this.headsToast = null; }, 1300);
    }
  }

  /** The header column changed width: frame zero moves with it, the zoom and scroll stay. */
  private headsLayout(): void {
    const m = this.engine.movie;
    const wasFit = !!m && this.start === 0 && Math.abs(this.ppf - (this.width - LEFT - RIGHT) / Math.max(1, m.duration)) < 0.002;
    LEFT = LEFT_BASE + (this.heads.width ? this.heads.width + 4 : 0);
    setClass(q(this.root, '.fm-heads-btn'), 'is-on', this.heads.mode !== 'off');
    if (wasFit) this.fit();
    this.schedule();
  }

  /** Header column mode, for the View menu: 'off', 'full' or 'slim'. */
  headersMode(): 'off' | 'full' | 'slim' { return this.heads.mode; }
  setHeaders(mode: 'off' | 'full' | 'slim'): void { this.heads.set(mode); }
  cycleHeaders(): void { this.heads.cycle(); }

  /** Track height to the smallest, or back to the default (the collapsed and expanded views). */
  collapseTracks(): void { this.setRowHeight(MIN_BLOCK_H); this.scrollY = 0; }
  expandTracks(): void { this.setRowHeight(44); }

  /** Zoom so frames `from` to `to` (end exclusive) fill the view. */
  zoomTo(from: number, to: number): void {
    const m = this.engine.movie;
    if (!m || this.width <= 0) return;
    const span = Math.max(2, to - from);
    this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), (this.width - LEFT - RIGHT) / (span * 1.06)));
    this.start = Math.max(0, from - span * 0.03);
    this.fitted = true;
    this.schedule();
  }

  /** Zoom to the selected blocks. */
  zoomToSelection(): void {
    const sel = this.engine.selected;
    if (!sel.length) { toast('Select something to zoom to it.', 'info', { ms: 1400 }); return; }
    this.zoomTo(Math.min(...sel.map((c) => c.start)), Math.max(...sel.map(end)));
  }

  /** Zoom to the loop range. */
  zoomToLoop(): void {
    const m = this.engine.movie;
    if (!m) return;
    if (m.loopFrom === undefined || m.loopTo === undefined) { toast('Set a loop range first (Alt+I and Alt+O).', 'info', { ms: 1600 }); return; }
    this.zoomTo(m.loopFrom, m.loopTo + 1);
  }

  /** First fit of a movie: the saved view when there is one, else the whole movie. */
  private autoFit(): void {
    const v = this.pendingView;
    this.pendingView = null;
    this.fit();
    if (!v || v.fit || this.width <= 0) return;
    const m = this.engine.movie;
    if (!m) return;
    this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), v.ppf));
    this.start = Math.max(0, Math.min(v.start, m.duration));
    this.setRowHeight(v.row);
  }

  private flushView(): void {
    const s = this.viewSnap;
    window.clearTimeout(this.viewTimer);
    this.viewSnap = null;
    if (s) saveView(s.id, { ppf: s.ppf, start: s.start, row: s.row, fit: s.fit });
  }

  /** Writes the view when it changed (after a pause, so a drag does not write on every move). */
  private rememberView(m: Movie): void {
    const k = `${m.id}|${this.ppf.toFixed(3)}|${this.start.toFixed(1)}|${BLOCK_H}`;
    if (k === this.viewKey || this.pendingView) return;
    this.viewKey = k;
    // the values are taken now, not when the timer fires: a movie opened inside the 400 ms must not write its view under this id
    const fitPpf = Math.min(MAX_PPF, Math.max(MIN_PPF, (this.width - LEFT - RIGHT) / Math.max(1, m.duration)));
    const snap: SavedViewArgs = { id: m.id, ppf: this.ppf, start: this.start, row: BLOCK_H, fit: Math.abs(this.ppf - fitPpf) < 0.002 && this.start === 0 && BLOCK_H === 44 };
    window.clearTimeout(this.viewTimer);
    this.viewTimer = window.setTimeout(() => { saveView(snap.id, { ppf: snap.ppf, start: snap.start, row: snap.row, fit: snap.fit }); this.viewSnap = null; }, 400);
    this.viewSnap = snap;
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
    if (!this.fitted) this.autoFit();
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
      text: v('--text-primary', '#f2f2f2'), muted: v('--text-muted', '#8a8a8a'), accent: v('--accent-color', '#f97316'), select: v('--fm-tl-select', v('--accent-color', '#f97316')), playhead: v('--fm-playhead', '#f2f2f2'),
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
    if (!this.fitted) this.autoFit();
    this.anySolo = m.tracks.some((t) => t.solo);
    this.drawRuler(m);
    this.drawTracks(m);
    this.heads.patch(m);
    this.rememberView(m);
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

  /** Files carried over the Timeline from the desktop: a ghost where they would land (the track under the pointer when they fit there), a line where a new track would be made. */
  fileDragOver(clientX: number, clientY: number): void {
    const m = this.engine.movie, tgt = m ? this.dropTarget(clientX, clientY) : null;
    if (!m || !tgt) { this.fileDragEnd(); return; }
    const len = Math.max(1, Math.round(m.fps * 2));
    const row = Math.min(tgt.index, m.tracks.length);
    const room = !!tgt.track && fits(tgt.track, tgt.frame, len) && !tgt.track.locked;
    const y = room ? this.laneTop(row) : this.insertLineY(m, row);
    this.cue = { x: this.fx(tgt.frame), y: (room ? y : (y ?? 0) - BLOCK_H / 2) as number, w: len * this.ppf, insertY: room ? null : y, label: t('New track') };
    this.schedule();
  }

  fileDragEnd(): void {
    if (!this.cue) return;
    this.cue = null;
    this.schedule();
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
    // zoomed out (under 3 px a frame) the ruler counts seconds; zoomed in it counts frames, and from 20 px a frame every tick has its number
    const bySeconds = this.ppf < 3;
    const major = bySeconds
      ? secondsSteps.find((s) => s * this.ppf >= 56) ?? secondsSteps[secondsSteps.length - 1]
      : this.ppf >= 20 ? 1 : frameSteps.find((s) => s * this.ppf >= 56) ?? second;
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
    c.textBaseline = 'top';
    const fpsI = Math.max(1, Math.round(m.fps));
    const edge = Math.min(this.width, this.fx(m.duration)) - 2;
    // Left-aligned whatever the page direction; a label that would pass the movie's end (or the right edge) ends at its tick instead.
    const put = (label: string, x: number, ty: number): void => {
      const lw = c.measureText(label).width;
      c.textAlign = x + 3 + lw > edge ? 'right' : 'left';
      c.fillText(label, c.textAlign === 'left' ? x + 3 : x - 3, ty);
    };
    // frames: short ticks with small dim numbers; zoomed out the ticks count seconds alone
    for (let f = first; f <= last; f += minor) {
      const x = Math.round(this.fx(f)) + 0.5;
      const isMajor = f % major === 0;
      c.strokeStyle = p.tick;
      c.beginPath();
      c.moveTo(x, RULER_H);
      c.lineTo(x, RULER_H - (isMajor ? (seconds ? 10 : 8) : seconds ? 5 : 4));
      c.stroke();
      if (!isMajor) continue;
      if (seconds) {
        c.font = '700 10px Inter, system-ui, sans-serif';
        c.fillStyle = p.text;
        c.globalAlpha = 0.85;
        put(secondsLabel(Math.round(f / m.fps)), x, 5);
        c.globalAlpha = 1;
      } else if (f % fpsI !== 0 || this.ppf * fpsI < 30) {
        // not under or against a second's own label
        const into = f % fpsI;
        if (this.ppf * fpsI >= 30 && into !== 0 && (into * this.ppf < 24 || (fpsI - into) * this.ppf < 20)) continue;
        c.font = '500 9px Inter, system-ui, sans-serif';
        c.fillStyle = p.muted;
        c.globalAlpha = 0.62;
        put(String(f), x, 14);
        c.globalAlpha = 1;
      }
    }
    // seconds: a taller tick and a bold label over the dim frame numbers, whenever frames show
    if (!seconds) {
      c.font = '700 10px Inter, system-ui, sans-serif';
      for (let f = Math.ceil(first / fpsI) * fpsI; f <= last; f += fpsI) {
        const x = Math.round(this.fx(f)) + 0.5;
        c.strokeStyle = p.tick;
        c.beginPath();
        c.moveTo(x, RULER_H);
        c.lineTo(x, RULER_H - 13);
        c.stroke();
        if (this.ppf * fpsI >= 30) {
          c.fillStyle = p.text;
          c.globalAlpha = 0.9;
          put(secondsLabel(Math.round(f / fpsI)), x, 3);
          c.globalAlpha = 1;
        }
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
      if (i === this.hoverLane && !this.drag) { c.fillStyle = 'rgba(255,255,255,.045)'; c.fill(); }
      if (this.drag?.kind === 'lane' && this.drag.id === t.id) { c.fillStyle = p.accent; c.globalAlpha = 0.22; c.fill(); c.globalAlpha = 1; c.strokeStyle = p.accent; c.lineWidth = 1.5; c.stroke(); c.lineWidth = 1; }
      for (const item of t.content) this.drawBlock(c, m, t, item, y, sel.has(item.id), p);
      if (this.audio && this.engine.playing) drawTrackMeter(c, this.audio.meter(t.id), 1, y, 4, BLOCK_H, p.accent);
      if (lanes && laneFocus.id) {
        // the ring on the lane Up and Down have reached
        const f = t.content.find((it) => it.id === laneFocus.id), slot = f ? laneSlots(f).find((s) => s.lane.kind === laneFocus.kind) : undefined;
        if (f && slot) {
          c.strokeStyle = p.accent;
          c.lineWidth = 1.5;
          this.round(c, this.fx(f.start) - 2, y + BLOCK_H + LANES_GAP + slot.y - 1.5, Math.max(8, this.fx(end(f)) - this.fx(f.start)) + 4, slot.h + 3, 5);
          c.stroke();
          c.lineWidth = 1;
        }
      }
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
      // a soft bloom under a 4 px trail
      c.shadowBlur = 18;
      c.lineWidth = 8;
      c.globalAlpha = 0.28;
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
      c.globalAlpha = 1;
      c.shadowBlur = 8;
      c.lineWidth = 4;
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
    if (this.drag?.kind === 'move' && this.drag.moved) this.drawMoveCues(c, m, this.drag, p);
    if (this.cue) drawLift(c, { origin: null, ghost: { x: this.cue.x, y: this.cue.y, w: this.cue.w, h: BLOCK_H }, blocked: null, insertY: this.cue.insertY }, this.width, p.accent, FREE_RED, p.block, this.cue.label);
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

  /** While a block is dragged: a dashed placeholder where it began, a ghost under the pointer, a red outline where a blocked drop was aimed, a line where a new track would be made. */
  private drawMoveCues(c: CanvasRenderingContext2D, m: Movie, d: Extract<Drag, { kind: 'move' }>, p: Palette): void {
    const at = locate(m, d.id);
    if (!at) return;
    const item = at.content;
    const w = this.fx(end(item)) - this.fx(item.start);
    const origin = { x: this.fx(d.s0), y: this.laneTop(d.lane0), w, h: BLOCK_H };
    const ghost = { x: d.px - d.gx, y: d.py - d.gy, w, h: BLOCK_H };
    const blocked = d.blocked ? { x: this.fx(d.s0 + d.want), y: this.laneTop(Math.max(0, Math.min(m.tracks.length - 1, d.wantLane))), w, h: BLOCK_H } : null;
    const insertY = this.insertLineY(m, d.insert);
    drawLift(c, { origin, ghost, blocked, insertY }, this.width, p.accent, FREE_RED, item.highlight === 'none' ? p.block : p.hl[item.highlight], t('New track'));
  }

  /** The y of the line that marks a new track made at lane `insert` (null for no insert). */
  private insertLineY(m: Movie, insert: number | null): number | null {
    if (insert === null) return null;
    const n = m.tracks.length;
    return insert >= n ? this.laneTop(n - 1) + (this.rowH[n - 1] ?? STRIDE) - LANE_GAP + LANE_GAP / 2 + 3 : insert <= 0 ? this.laneTop(0) - LANE_GAP / 2 - 3 : this.laneTop(insert) - LANE_GAP / 2;
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
    // a Flipbook keeps its paper and shows its color on the name chip; other blocks are washed with theirs
    c.fillStyle = item.highlight === 'none' || item.kind === 'flipbook' ? p.block : p.hl[item.highlight];
    c.fillRect(x0, y, w, BLOCK_H);
    this.drawThumbs(c, m, item, x0, y, w);
    // past the movie's end the block is dimmed and hatched: it is clipped when the movie plays or exports
    const endX = this.fx(m.duration);
    if (x1 > endX + 1) {
      const a = Math.max(x0, endX);
      c.fillStyle = 'rgba(13,13,16,.62)';
      c.fillRect(a, y, x1 - a, BLOCK_H);
      c.strokeStyle = p.text;
      c.globalAlpha = 0.22;
      c.beginPath();
      for (let hx = a - BLOCK_H; hx < x1; hx += 7) { c.moveTo(hx, y + BLOCK_H); c.lineTo(hx + BLOCK_H, y); }
      c.stroke();
      c.globalAlpha = 1;
    }
    if (item.kind === 'audio') drawSoundOverlay(c, item, x0, y, w, BLOCK_H, this.ppf, selected, 'rgba(0,0,0,.38)', p.accent);
    if (t.hidden || item.hidden) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x0, y, w, BLOCK_H); }
    const sounds = this.hasSound(m, item);
    // a sound that will not be heard (muted, or another track on solo) is dimmed
    if (sounds && (t.mute || (this.anySolo && !t.solo))) { c.fillStyle = 'rgba(0,0,0,.42)'; c.fillRect(x0, y, w, BLOCK_H); }
    c.restore();
    if (t.locked) drawLockHatch(c, x0, y, w, BLOCK_H, p.text);
    // a Multi-select pick is outlined red, as its lasso trail is
    c.strokeStyle = selected ? (this.multi ? '#e5484d' : p.select) : p.blockLine;
    c.lineWidth = selected ? 2 : 1;
    this.round(c, x0 + (selected ? 1 : 0.5), y + (selected ? 1 : 0.5), w - (selected ? 2 : 1), BLOCK_H - (selected ? 2 : 1), 6);
    c.stroke();
    c.lineWidth = 1;
    if (w > 46) {
      const label = contentName(item.name);
      c.font = '600 10px Inter, system-ui, sans-serif';
      const tw = Math.min(w - 16, c.measureText(label).width + 24 + (item.kind === 'group' || item.kind === 'flipbook' ? 14 : 0));
      const chip = chipFill(item.highlight, p.chip, p.hl);
      const ink = chip.ink ?? p.text;
      c.fillStyle = chip.fill;
      this.round(c, x0 + 5, y + 5, tw, 15, 7.5);
      c.fill();
      c.strokeStyle = ink;
      c.strokeRect(x0 + 9.5, y + 8.5, 7, 7);
      if (!t.hidden && !item.hidden) { c.beginPath(); c.moveTo(x0 + 10.5, y + 12); c.lineTo(x0 + 12.5, y + 14); c.lineTo(x0 + 16, y + 9.5); c.stroke(); }
      c.fillStyle = ink;
      c.textBaseline = 'middle';
      c.textAlign = 'left';   // not the page direction: the chip sits at the block's left edge
      c.save();
      c.beginPath();
      c.rect(x0 + 19, y + 5, tw - 15, 15);
      c.clip();
      c.fillText(label, x0 + 20, y + 13);
      c.restore();
      if (item.kind === 'group' || item.kind === 'flipbook') drawChevron(c, x0 + tw - 8, y + 12.5, item.kind === 'group' && this.opened.has(item.id), ink);
      if (t.locked) {
        c.fillStyle = p.text;
        c.fillRect(x0 + w - 17, y + BLOCK_H - 13, 9, 7);
        c.strokeStyle = p.text;
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(x0 + w - 12.5, y + BLOCK_H - 13, 3, Math.PI, 0); c.stroke();
        c.lineWidth = 1;
      }
    }
    if (item.mask !== 'none' && w > 60) {
      // a masked block says so at its lower right
      const word = tr(item.mask === 'clipping' ? 'Clipping Mask' : item.mask === 'alpha' ? 'Alpha Mask' : 'Luminance Mask');
      c.font = '600 9px Inter, system-ui, sans-serif';
      const lw = Math.min(w - 12, c.measureText(word).width + 10);
      c.fillStyle = p.chip;
      this.round(c, x1 - lw - 5, y + BLOCK_H - 19, lw, 14, 7);
      c.fill();
      c.fillStyle = p.text;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.save();
      c.beginPath();
      c.rect(x1 - lw - 5, y + BLOCK_H - 19, lw, 14);
      c.clip();
      c.fillText(word, x1 - lw, y + BLOCK_H - 11.5);
      c.restore();
    }
    if (sounds && w > 30) {
      const mx = Math.min(x1, this.width - 8);
      if (t.mute) drawSoundMark(c, mx, y, 'mute', p.chip, p.text, p.accent);
      else if (t.solo) drawSoundMark(c, mx, y, 'solo', p.chip, p.text, p.accent);
      else if (this.anySolo) drawSoundMark(c, mx, y, 'quiet', p.chip, p.text, p.accent);
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
      // bracket handles, solid once armed (Free Trim, or an edge held down)
      const armed = this.freeTrim() || (this.drag?.kind === 'trim' && this.drag.id === item.id);
      if (w > 40) drawBrackets(c, x0, x1, y, BLOCK_H, armed, armed ? FREE_RED : p.accent);
      else {
        c.fillStyle = armed ? FREE_RED : p.accent;
        this.round(c, x0 + 2, y + BLOCK_H / 2 - 8, 3, 16, 1.5);
        c.fill();
        this.round(c, x1 - 5, y + BLOCK_H / 2 - 8, 3, 16, 1.5);
        c.fill();
      }
    }
    if (item.kind === 'group' && this.opened.has(item.id) && this.engine.mode === 'compose') this.drawInner(c, m, item, x0, w, y + BLOCK_H + 4, p);
  }

  /** The tracks inside an opened group, as thin bars in the group's own frames, under its block. */
  private drawInner(c: CanvasRenderingContext2D, m: Movie, g: Content, x0: number, w: number, top: number, p: Palette): void {
    const hh = this.groupH(g) - 4;
    c.save();
    c.beginPath();
    c.rect(x0, top - 4, w, hh);
    c.clip();
    c.fillStyle = p.laneAlt;
    c.fillRect(x0, top - 4, w, hh);
    let y = top;
    for (const tr of g.tracks) {
      for (const it of tr.content) {
        const a = x0 + (it.start - g.offset) * this.ppf, b = x0 + (end(it) - g.offset) * this.ppf;
        if (b < x0 || a > x0 + w) continue;
        // the same block drawing as the top level: shifted so its start lands on the group's frames
        const want = g.start + it.start - g.offset;
        let shown = this.proxies.get(it);
        if (!shown || shown.start !== want) { shown = { ...it, start: want }; this.proxies.set(it, shown); }
        this.drawBlock(c, m, tr, shown, y, groupCtx.picked === it.id, p);
      }
      y += STRIDE + this.rowExtra(tr);
    }
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
    if (item.kind === 'flipbook') {
      drawFlipCells(c, item, x0, y, BLOCK_H, this.ppf, this.width, tileW, (local) => this.flipTile(m, item, local, tileW));
      return;
    }
    if (item.kind === 'group') { drawGroupPreview(c, item, x0, y, w, BLOCK_H, this.ppf, this.palette().text); return; }
    // a Drawing, Text or Shape sits on the paper it will be seen on
    if (item.kind === 'drawing' || item.kind === 'text' || item.kind === 'shape') {
      c.fillStyle = m.transparent ? '#d9d9de' : m.background;
      // pale letters on pale paper read as an empty block: a text block takes the dark lane ground instead
      if (item.kind === 'text' && item.text && lightInk(item.text.color) && lightInk(m.transparent ? '#d9d9de' : m.background)) c.fillStyle = '#26262c';
      c.fillRect(x0, y, w, BLOCK_H);
    }
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

  /** One Flipbook cell's picture: the content at a local frame, kept until the movie or the size changes. */
  private flipTiles = new WeakMap<Content, Map<string, HTMLCanvasElement>>();
  private flipTile(m: Movie, item: Content, local: number, tileW: number): HTMLCanvasElement | null {
    let by = this.flipTiles.get(item);
    if (!by) { by = new Map(); this.flipTiles.set(item, by); }
    if (by.size > 320) by.clear();
    const key = `${this.thumbGen}:${tileW}:${BLOCK_H}:${this.dpr}:${local}`;
    const have = by.get(key);
    if (have) return have;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(tileW * this.dpr));
    cv.height = Math.max(1, Math.round(BLOCK_H * this.dpr));
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    try { this.renderer.thumb(ctx, m, item, local, cv.width, cv.height); } catch { return null; }
    by.set(key, cv);
    return cv;
  }

  private thumbFor(m: Movie, item: Content, tileW: number): HTMLCanvasElement | null {
    const have = this.thumbs.get(item);
    if (have && have.dataset.gen === String(this.thumbGen) && have.width === Math.round(tileW * this.dpr)) return have;
    const cv = have ?? document.createElement('canvas');
    cv.width = Math.max(1, Math.round(tileW * this.dpr));
    cv.height = Math.max(1, Math.round(BLOCK_H * this.dpr));
    cv.dataset.gen = String(this.thumbGen);
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (item.kind === 'text' && item.text && item.text.size > 0) {
      // the letters at the tile's own scale, so the words read: render large, keep the band around the text
      const k = Math.max(1, Math.min(14, (0.6 * m.height) / (item.text.size * Math.max(0.05, item.transform.scale))));
      const W = Math.min(4096, Math.round(cv.width * k)), H = Math.round(W * (cv.height / cv.width));
      if (k > 1.2 && H <= 4096) {
        const big = document.createElement('canvas');
        big.width = W;
        big.height = H;
        this.renderer.thumb(big.getContext('2d') as CanvasRenderingContext2D, m, item, 0, W, H);
        const sx = W / 2 + (item.transform.x * W) / m.width - cv.width / 2, sy = H / 2 + (item.transform.y * H) / m.height - cv.height / 2;
        ctx.drawImage(big, Math.round(sx), Math.round(sy), cv.width, cv.height, 0, 0, cv.width, cv.height);
        this.thumbs.set(item, cv);
        return cv;
      }
    }
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
    // to the right of the block's name chip, never over it (the chip's checkbox and chevron stay reachable)
    const bx = this.fx(c.start), cw = this.chipWidth(c, Math.max(3, this.fx(end(c)) - bx));
    const x = Math.max(LEFT, Math.min(this.width - 120, bx + (cw > 0 ? cw + 10 : 6)));
    setText(this.editPill, t('Edit {kind}').replace('{kind}', t(kindName(c.kind))));
    this.editPill.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    setHidden(this.editPill, y < -20 || y > this.height);
  }

  /** A block that makes sound: a sound block, or a video with sound still up. */
  private hasSound(m: Movie, item: Content): boolean {
    return item.kind === 'audio' || (item.kind === 'video' && item.volume > 0 && !!item.asset && !!m.assets[item.asset]?.hasAudio);
  }

  /** The name chip of a block: its width, or 0 when the block is too short to show one. */
  private chipWidth(item: Content, w: number): number {
    if (w <= 46) return 0;
    const c = this.tracksCanvas.getContext('2d') as CanvasRenderingContext2D;
    c.font = '600 10px Inter, system-ui, sans-serif';
    return Math.min(w - 16, c.measureText(contentName(item.name)).width + 24 + (item.kind === 'group' || item.kind === 'flipbook' ? 14 : 0));
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
    // a locked track cannot be picked: its blocks answer as empty lane (the track menu unlocks it)
    if (ly < 0 || ly > BLOCK_H || t.locked) return { track: t, index, item: null, edge: null, x, y };
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
  private innerHit(e: { clientX: number; clientY: number }): InnerHit | null {
    const m = this.engine.movie;
    if (!m) return null;
    const r = this.tracksCanvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const lane = this.laneAt(y);
    const t = m.tracks[lane];
    if (!t) return null;
    for (const g of t.content) {
      if (g.kind !== 'group' || !this.opened.has(g.id)) continue;
      const found = this.innerFind(g, g.start, this.laneTop(lane) + BLOCK_H + 4, x, y);
      if (found) return { ...found, lane };
    }
    return null;
  }

  /** The inner block under (x, y) in group `g` whose first frame sits at movie frame `gStart`; `top` is where its first inner track begins. */
  private innerFind(g: Content, gStart: number, top: number, x: number, y: number): Omit<InnerHit, 'lane'> | null {
    const gx0 = this.fx(gStart), gx1 = this.fx(gStart + g.duration);
    if (x < gx0 || x > gx1) return null;
    for (const tr of g.tracks) {
      const ex = this.rowExtra(tr);
      for (const it of tr.content) {
        const a = this.fx(gStart + it.start - g.offset), b = this.fx(gStart + end(it) - g.offset);
        if (x < a - 2 || x > b + 2) continue;
        if (y >= top && y <= top + BLOCK_H) {
          const wide = b - a > 24;
          const edge = wide && x - a <= 7 ? 'start' : wide && b - x <= 7 ? 'end' : null;
          return { group: g, item: it, edge, rowTop: top, x0: a, x1: b, track: tr };
        }
        if (it.kind === 'group' && this.opened.has(it.id) && y > top + BLOCK_H && y <= top + STRIDE + ex) {
          const deeper = this.innerFind(it, gStart + it.start - g.offset, top + BLOCK_H + 4, x, y);
          if (deeper) return deeper;
        }
      }
      top += STRIDE + ex;
    }
    return null;
  }

  private hover(e: PointerEvent): void {
    const h = this.hit(e);
    const m = this.engine.movie;
    const nearEnd = !!m && Math.abs((e.clientX - this.tracksCanvas.getBoundingClientRect().left) - this.fx(m.duration) - 4) < 6;
    this.tracksCanvas.style.cursor = h?.edge || nearEnd ? 'ew-resize' : h?.item ? 'grab' : 'default';
    const lane = h ? h.index : -1;
    if (lane !== this.hoverLane) { this.hoverLane = lane; this.schedule(); }
    const lh = this.laneHit(e);
    setLaneHover(lh ? { id: lh.c.id, kind: lh.hit.slot.lane.kind } : null);
  }

  private rulerDown(e: PointerEvent): void {
    const m = this.engine.movie;
    if (!m || e.button !== 0) return;
    if (this.space.held) {
      this.space.take();
      this.ruler.setPointerCapture(e.pointerId);
      this.drag = { kind: 'pan', x0: e.clientX, start0: this.start, y0: e.clientY, scroll0: this.scrollY };
      return;
    }
    if (this.ed.rulerDown(e)) return;
    this.ruler.setPointerCapture(e.pointerId);
    this.engine.stop();
    const r = this.ruler.getBoundingClientRect();
    const rx = e.clientX - r.left;
    // a plain slide on the Ruler changes the time scale (the frame under the pen stays put); the Playhead
    // handle, or Shift, scrubs; a click without a slide still moves the Playhead there
    // (a finger always scrubs: its pinch and two-finger slide change the scale)
    // "Ruler drag" (a command in the View menu) chooses what a plain drag does; Alt always scales
    const slides = e.altKey || (rulerDrag.mode === 'scale' && !e.shiftKey && Math.abs(rx - this.fx(this.engine.frame)) >= 10);
    if (e.pointerType !== 'touch' && slides) {
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
    if (e.button === 1 || (e.button === 0 && this.space.held)) {
      // middle button, or Space held: the drag pans
      if (this.space.held) this.space.take();
      this.tracksCanvas.setPointerCapture(e.pointerId);
      this.drag = { kind: 'pan', x0: e.clientX, start0: this.start, y0: e.clientY, scroll0: this.scrollY };
      return;
    }
    // the eraser end of a pen deletes the block under it (one undo step)
    if (e.button === 5 || (e.pointerType === 'pen' && (e.buttons & 32) !== 0)) {
      const eh = this.hit(e);
      if (eh?.item) { const id = eh.item.id; this.engine.run('Delete Content', (mv) => ops.deleteContent(mv, [id])); }
      return;
    }
    if (e.button !== 0) return;
    if (this.ed.tracksDown(e)) return;
    this.engine.stop();
    const r = this.tracksCanvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const h = this.hit(e);
    if (h?.item && !this.addsToSelection(e)) {
      // the name chip: its checkbox hides or shows the track and its chevron opens a group; neither selects or moves the Playhead
      const bx = this.fx(h.item.start), cw = this.chipWidth(h.item, Math.max(3, this.fx(end(h.item)) - bx));
      const lx = x - bx, ly = h.y - this.laneTop(h.index);
      if (cw > 0 && ly >= 2 && ly <= 23 && !h.edge) {
        if (lx >= 3 && lx <= 24) {
          const tr = h.track;
          // Alt: hide or show this block alone, the track stays
          if (e.altKey) {
            const it = h.item;
            this.engine.run(it.hidden ? 'Show Content' : 'Hide Content', (mv) => hideOps.setContentHidden(mv, it.id, !it.hidden));
            return;
          }
          this.engine.run(tr.hidden ? 'Show Track' : 'Hide Track', (mv) => ops.setTrackHidden(mv, tr.id, !tr.hidden));
          return;
        }
        // a Flipbook's chevron opens it in Draw & Paint, where its rows are
        if (h.item.kind === 'flipbook' && lx >= cw - 15 && lx <= cw + 1) { this.engine.select([h.item.id], h.track.id); this.hooks.edit(h.item); return; }
        if (h.item.kind === 'group' && this.engine.mode === 'compose' && lx >= cw - 15 && lx <= cw + 1) {
          if (this.opened.has(h.item.id)) this.opened.delete(h.item.id); else this.opened.add(h.item.id);
          this.layoutFor = null;
          this.schedule();
          return;
        }
      }
    }
    if (!h?.edge && Math.abs(x - this.fx(m.duration) - 4) < 6) {
      this.tracksCanvas.setPointerCapture(e.pointerId);
      this.drag = { kind: 'duration', x0: e.clientX, d0: m.duration, tag: `dur-${Date.now()}` };
      return;
    }
    const lh = this.laneHit(e);
    // a press on one of several chosen keys drags them all (keyDown); any other press drops the choice
    const onChosen = !!lh && lh.hit.key !== null && this.keySel.size > 1 && this.keySel.has(lh.c.id, lh.hit.slot.lane.kind, lh.hit.key);
    if (lh && !this.addsToSelection(e) && !onChosen) { this.keySel.clear(); this.laneDown(e, lh); return; }
    const additive = this.addsToSelection(e);
    if (lh) { this.keyDown(e, lh, x, e.clientY - r.top); return; }
    const inner = this.engine.mode === 'compose' ? this.innerHit(e) : null;
    if (inner) {
      const it = inner.item, ly = e.clientY - r.top - inner.rowTop, lx = x - inner.x0;
      // the chip: its checkbox hides or shows this block alone, a nested group's chevron opens it
      if (ly >= 2 && ly <= 23 && lx >= 3 && lx <= 24 && inner.x1 - inner.x0 > 46) {
        this.engine.run(it.hidden ? 'Show Content' : 'Hide Content', (mv) => groupInner.updateInner(mv, it.id, (c) => { const n: Content = { ...c }; if (c.hidden) delete n.hidden; else n.hidden = true; return n; }));
        return;
      }
      if (it.kind === 'group' && ly <= 24 && inner.x1 - inner.x0 > 70 && x >= inner.x1 - 22 && x <= inner.x1 - 1) {
        if (this.opened.has(it.id)) this.opened.delete(it.id); else this.opened.add(it.id);
        this.layoutFor = null;
        this.schedule();
        return;
      }
      this.tracksCanvas.setPointerCapture(e.pointerId);
      this.innerSel = it.id;
      this.engine.select([inner.group.id]);
      this.engine.seek(Math.max(inner.group.start, Math.min(end(inner.group) - 1, Math.floor(this.xf(x)))));
      const d: Drag = { kind: 'inner', id: it.id, mode: inner.edge ?? 'move', x0: e.clientX, y0: e.clientY, applied: 0, appliedRow: 0, moved: false, tag: `inner-${Date.now()}`, lane0: inner.lane, gx: x - inner.x0, itemStart: it.start, w: inner.x1 - inner.x0, out: null };
      this.drag = d;
      // held still: the block's own options
      const px = e.clientX, py = e.clientY;
      this.holdFor(d, px, py, () => this.innerMenu(px, py, it, inner.group));
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
      this.drag = {
        kind: 'move', x0: e.clientX, y0: e.clientY, applied: 0, appliedTrack: 0, tag: `move-${Date.now()}`, moved: false,
        id: h.item.id, lane0: h.index, s0: h.item.start, gx: x - this.fx(h.item.start), gy: h.y - this.laneTop(h.index),
        px: x, py: h.y, insert: null, blocked: false, want: 0, wantLane: h.index,
      };
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
    // held still on empty track area: the track lifts; letting go in place opens the track's menu (as a right-click), sliding up or down reorders it
    const lane = h?.track.id ?? null;
    const lift = (px: number, py: number): void => {
      if (!lane) { this.contextMenu(new MouseEvent('contextmenu', { clientX: px, clientY: py, cancelable: true })); return; }
      this.laneHold = [px, py];
      this.drag = { kind: 'lane', id: lane, tag: `lane-${Date.now()}`, moved: false };
      this.schedule();
    };
    const px = e.clientX, py = e.clientY;
    if (e.pointerType === 'touch') {
      // a finger on empty lane pans the Timeline; only a tap without a slide moves the Playhead there
      const pd: Drag = { kind: 'pan', x0: e.clientX, start0: this.start, y0: e.clientY, scroll0: this.scrollY, tap: Math.floor(this.xf(x)) };
      this.drag = pd;
      this.holdFor(pd, px, py, () => lift(px, py));
      return;
    }
    const sd: Drag = { kind: 'scrub' };
    this.drag = sd;
    this.engine.seek(Math.floor(this.xf(x)));
    this.holdFor(sd, px, py, () => lift(px, py));
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
      this.engine.view((mv) => ops.updateContent(mv, c.id, (x) => keyOps.setExpanded(x, lane.kind, !lane.expanded))); // view state: no undo step
      return;
    }
    this.tracksCanvas.setPointerCapture(e.pointerId);
    if (!this.engine.selection.content.includes(c.id) || this.engine.selection.content.length !== 1) this.engine.select([c.id], track.id);
    const last = c.duration - 1;
    if (hit.key !== null) {
      keyHome.frame = this.engine.frame;
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
      const lk = hit.slot.lane.kind;
      // a chosen key among several chosen keys drags them all (a tap without a move still drops it)
      if (this.keySel.size > 1 && this.keySel.has(c.id, lk, hit.key)) {
        this.drag = { kind: 'keygroup', g: new KeyGroupDrag(this.engine, this.keySel, { id: c.id, kind: lk, frame: hit.key }, e.clientX), id: c.id, lk, key: hit.key };
        return;
      }
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
      // snaps to the Playhead and to keys of other lanes (Alt: off); a tooltip names the frame
      const near = snapKeyFrame(this.engine, c, d.lk, Math.max(0, Math.min(c.duration - 1, Math.round(d.from0 + (e.clientX - d.x0) / this.ppf))), this.ppf, e.altKey);
      const to = near.frame;
      if (to !== d.from0 || d.cur !== d.from0) keyTip.show(e.clientX, e.clientY, `Frame ${c.start + to}${near.to === 'playhead' ? ' · Playhead' : near.to === 'key' ? ' · key' : ''}`);
      if (to === d.cur) return;
      this.cancelLongPress();
      const base = d.base, kind = d.lk, from0 = d.from0, channel = d.channel ?? undefined;
      if (this.engine.run('Move Keyframe', (mv) => ops.updateContent(mv, d.id, () => keyOps.moveKey(base, kind, from0, to, channel)), d.tag)) {
        d.cur = to;
        this.engine.seek(c.start + to);
      }
    } else if (d.kind === 'keygroup') {
      d.g.move(e.clientX, e.clientY, e.altKey, this.ppf);
    } else if (d.kind === 'lane') {
      const cr = this.tracksCanvas.getBoundingClientRect();
      const to = Math.max(0, Math.min(m.tracks.length - 1, this.laneAt(e.clientY - cr.top)));
      const from = m.tracks.findIndex((x) => x.id === d.id);
      if (Math.hypot(e.clientX - this.laneHold[0], e.clientY - this.laneHold[1]) > 5) d.moved = true;
      if (from >= 0 && to !== from) this.engine.run('Move Track', (mv) => ops.moveTrack(mv, d.id, to), d.tag);
      this.schedule();
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
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
      d.moved = true;
      const cr = this.tracksCanvas.getBoundingClientRect();
      d.px = e.clientX - cr.left;
      d.py = e.clientY - cr.top;
      const ids = this.engine.selection.content;
      total = this.ed.snapMove(m, ids, d.tag, d.applied, total, e);
      d.want = total;
      const tgt = this.moveTarget(m, d.py);
      d.insert = tgt.insert;
      d.wantLane = tgt.insert !== null ? d.lane0 + d.appliedTrack : tgt.lane;
      // between lanes or past the last one the drop makes a new track; the block stays on its last lane until then
      const lanes = tgt.insert !== null ? d.appliedTrack : tgt.lane - d.lane0;
      const step = total - d.applied, laneStep = lanes - d.appliedTrack;
      if (tgt.insert !== null) d.blocked = false;
      if (step || laneStep) {
        if (this.tryRun('Move Content', (mv) => ops.moveContent(mv, ids, step, laneStep), d.tag)) { d.applied = total; d.appliedTrack = lanes; d.blocked = false; } else d.blocked = true;
      }
      this.schedule();
    } else if (d.kind === 'inner') {
      const total = Math.round(((e.clientX - d.x0) / this.ppf) * speed);
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
      d.moved = true;
      if (d.mode === 'move') {
        const cr = this.tracksCanvas.getBoundingClientRect();
        const px = e.clientX - cr.left, py = e.clientY - cr.top;
        // pointer past the top level lane that holds the group: the block is on its way out; a ghost and a line say where it lands
        const laneY = this.laneTop(d.lane0);
        const outside = py < laneY - 6 || py > laneY + (this.rowH[d.lane0] ?? STRIDE) + 2;
        if (outside) {
          const tgt = this.moveTarget(m, py);
          d.out = { lane: tgt.lane, insert: tgt.insert };
          this.cue = { x: px - d.gx, y: py - BLOCK_H / 2, w: d.w, insertY: this.insertLineY(m, tgt.insert), label: t('New track') };
          this.schedule();
          return;
        }
        d.out = null;
        this.cue = null;
        const rows = Math.round((e.clientY - d.y0) / STRIDE);
        const step = total - d.applied, rowStep = rows - d.appliedRow;
        if (!step && !rowStep) { this.schedule(); return; }
        if (this.tryRun('Move Content', (mv) => groupInner.moveInner(mv, [d.id], step, rowStep), d.tag)) { d.applied = total; d.appliedRow = rows; }
        this.schedule();
        return;
      }
      const step = total - d.applied;
      if (!step) return;
      if (this.tryRun('Trim', (mv) => groupInner.trimInner(mv, d.id, d.mode as 'start' | 'end', step), d.tag)) d.applied = total;
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
      m.tracks.forEach((t, i) => { if (i < l0 || i > l1 || t.locked) return; for (const c of t.content) if (end(c) > f0 && c.start < f1) ids.add(c.id); });
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
        if (t.locked) return;
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
    try { fn(m); } catch (err) { if (err instanceof ops.OpError) { this.lastErr = err.message; return false; } throw err; }
    return this.engine.run(label, fn, tag);
  }

  /** Where a dragged block aims at height `py`: the lane under it, or a gap (between lanes, above the first, below the last) where a new track would be made. */
  private moveTarget(m: Movie, py: number): { lane: number; insert: number | null } {
    this.layout(m);
    const n = m.tracks.length;
    const v = py + this.scrollY - TOP_PAD;
    const lane = Math.max(0, Math.min(n - 1, this.laneAt(py)));
    if (v < -6) return { lane: 0, insert: 0 };
    if (v > this.totalH - LANE_GAP + 8) return { lane: n - 1, insert: n };
    for (let i = 0; i < n - 1; i++) {
      const gapTop = this.tops[i] + this.rowH[i] - LANE_GAP;
      if (v >= gapTop + 2 && v <= gapTop + LANE_GAP - 2) return { lane, insert: i + 1 };
    }
    return { lane, insert: null };
  }

  /** The open group (and its inner row) a dragged block is over, in the area under its block. */
  private groupDropAt(m: Movie, px: number, py: number, skip: Set<string>): { gid: string; row: number } | null {
    const lane = this.laneAt(py), t = m.tracks[lane];
    if (!t) return null;
    const top = this.laneTop(lane) + BLOCK_H + 4;
    if (py < top - 2) return null;
    for (const g of t.content) {
      if (g.kind !== 'group' || !this.opened.has(g.id) || skip.has(g.id) || px < this.fx(g.start) || px > this.fx(end(g))) continue;
      let y = top;
      for (let i = 0; i < g.tracks.length; i++) {
        const ex = this.rowExtra(g.tracks[i]);
        if (py < y + STRIDE + ex) return { gid: g.id, row: i };
        y += STRIDE + ex;
      }
      return { gid: g.id, row: g.tracks.length };
    }
    return null;
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.cue = null;
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
    if (d.kind === 'lane') {
      this.engine.endGesture();
      if (!d.moved && e.type === 'pointerup') { this.engine.select([], d.id); this.hooks.trackMenu(e.clientX, e.clientY, d.id); }
    }
    if (d.kind === 'pan' && d.tap !== undefined && e.type === 'pointerup' && Math.abs(e.clientX - d.x0) < 6 && Math.abs(e.clientY - d.y0) < 6) this.engine.seek(d.tap);
    // a tap on a key (no drag) opens its values
    // (a key in an expanded row opens a numeric field right at the key; a collapsed lane opens the card)
    if (d.kind === 'key' && d.cur === d.from0 && e.type === 'pointerup' && this.engine.mode !== 'perform' && !(d.channel && openKeyField(this.engine, d.id, d.lk, d.channel, d.from0, e.clientX, e.clientY))) this.actionMenu.editKey(this.keyPill, d.lk);
    if (d.kind === 'duration' && !d.moved) this.endMenu.open(e.clientX, e.clientY);
    if (d.kind === 'inner' && d.out && e.type === 'pointerup') {
      const o = d.out, mv0 = this.engine.movie;
      const frame = Math.round(this.xf(e.clientX - this.tracksCanvas.getBoundingClientRect().left - d.gx));
      if (mv0 && this.tryRun('Move out of group', (mv) => groupInner.moveOutOfGroup(mv, d.id, o.insert !== null ? o.insert : o.lane, o.insert !== null, frame), d.tag)) this.innerSel = null;
    }
    const into = d.kind === 'move' && d.moved && e.type === 'pointerup' && this.engine.movie ? this.groupDropAt(this.engine.movie, d.px, d.py, new Set(this.engine.selection.content)) : null;
    if (into && d.kind === 'move') {
      const g = locate(this.engine.movie as Movie, into.gid)?.content ?? null;
      const local = g ? g.offset + Math.round(this.xf(d.px - d.gx)) - g.start : 0;
      const id = d.id;
      if (this.tryRun('Move into group', (mv) => groupInner.moveIntoGroup(mv, id, into.gid, into.row, local), d.tag)) { this.engine.select([into.gid]); this.innerSel = id; }
    } else if (d.kind === 'move' && d.moved && e.type === 'pointerup') {
      const ids = this.engine.selection.content, at = d.insert, extra = d.want - d.applied;
      if (at !== null) {
        // dropped between lanes or past the last: the block goes onto a new track made there
        this.engine.run('Move Content', (mv) => lockOps.moveToNewTrack(mv, ids, extra, at), d.tag);
      } else if (d.blocked) {
        toast(this.lastErr === 'Track is locked' ? 'Track is locked' : 'No room on that track', 'info', { ms: 1600 });
      }
    }
    if (d.kind === 'key') keyTip.hide();
    if (d.kind === 'keygroup') {
      d.g.end();
      if (!d.g.moved && e.type === 'pointerup') this.keySel.toggle(d.id, d.lk, d.key);
    }
    if (d.kind === 'move' ||d.kind === 'trim' || d.kind === 'duration' || d.kind === 'key' || d.kind === 'inner' || d.kind === 'fade') this.engine.endGesture();
    if (d.kind === 'move' && !d.moved && !this.addsToSelection(e)) {
      const h = this.hit(e);
      if (h?.item) this.engine.select([h.item.id], h.track.id);
    }
    this.schedule();
  }

  private laneHold: [number, number] = [0, 0];
  private innerMenuUi: InnerMenu | null = null;
  private innerMenu(x: number, y: number, item: Content, group: Content): void {
    if (!this.innerMenuUi) this.innerMenuUi = new InnerMenu(this.engine);
    this.innerMenuUi.open(x, y, item, group);
  }

  private contextMenu(e: MouseEvent): void {
    e.preventDefault();
    const m = this.engine.movie;
    if (m && Math.abs(e.clientX - this.tracksCanvas.getBoundingClientRect().left - this.fx(m.duration) - 4) < 8) { this.endMenu.open(e.clientX, e.clientY); return; }
    const lh = this.laneHit(e);
    if (lh && this.keySel.size && (lh.hit.key === null ? this.multi : this.keySel.has(lh.c.id, lh.hit.slot.lane.kind, lh.hit.key))) { this.keyMenu.open(e.clientX, e.clientY); return; }
    if (lh) { this.openLaneMenu(lh, e.clientX, e.clientY); return; }
    const inner = this.engine.mode === 'compose' ? this.innerHit(e) : null;
    if (inner) { this.engine.select([inner.group.id]); this.innerSel = inner.item.id; this.innerMenu(e.clientX, e.clientY, inner.item, inner.group); return; }
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
    const editable = !!h?.item && (h.item.kind === 'text' || h.item.kind === 'drawing' || h.item.kind === 'flipbook' || h.item.kind === 'shape' || h.item.kind === 'solid' || h.item.kind === 'adjust');
    // a block that cannot be edited (or Alt held) zooms to itself; empty lane steps the zoom in
    if (h?.item && (e.altKey || !editable)) this.zoomTo(h.item.start, end(h.item));
    else if (h?.item) this.hooks.edit(h.item);
    else this.zoomToFrames(e.clientX, e.ctrlKey || e.metaKey);
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
