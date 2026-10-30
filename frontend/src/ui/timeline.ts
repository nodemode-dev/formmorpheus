import type { Engine } from '../engine/engine';
import { end, fits, kindName, locate } from '../engine/model';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import type { AudioEngine } from '../media/audio';
import type { VideoPool } from '../media/video';
import { timecode } from '../engine/time';
import type { Content, Highlight, KeyKind, Mode, Movie, Track } from '../engine/types';
import * as keyOps from '../engine/key-ops';
import { kindSpec, laneFrames } from '../engine/keys';
import { ActionMenu, CLAPPER, LaneMenu, newKeyState } from './action-menu';
import { mods, perform, REC_GLYPH } from './perform-ui';
import { el, q, setClass, setHidden, setHtml, setText, setTitle } from './dom';
import { icon } from './icons';
import { LANES_GAP, LANE_H, drawLanes, hitLanes, keyBefore, lanesHeight, setGlyphLoadHandler, type LaneGeom, type LaneHit } from './key-lanes';

const RULER_H = 28;
const BLOCK_H = 44;
const LANE_GAP = 10;
const STRIDE = BLOCK_H + LANE_GAP;
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
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'zoom'; x0: number; ppf0: number; anchorFrame: number }
  | { kind: 'move'; x0: number; y0: number; applied: number; appliedTrack: number; tag: string; moved: boolean }
  | { kind: 'trim'; id: string; edge: 'start' | 'end'; x0: number; applied: number; ripple: boolean; tag: string }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; base: string[] }
  | { kind: 'duration'; x0: number; d0: number; tag: string }
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

const KIND_ICON: Record<Content['kind'], string> = { drawing: 'drawing', flipbook: 'flipbook', image: 'image', video: 'video', audio: 'audio', text: 'text', group: 'group' };

export class TimelineView {
  readonly root = el(`<section class="fm-timeline" aria-label="Timeline">
    <div class="fm-transport">
      <div class="fm-transport-left">
        <button class="fm-pill-btn" type="button" data-act="home">Theater</button>
        <button class="fm-round-btn" type="button" data-act="settings" title="Movie settings" aria-label="Movie settings">${icon('movieSettings', 18)}</button>
        <button class="fm-round-btn" type="button" data-act="multi" title="Multi-select" aria-label="Multi-select" aria-pressed="false">${icon('multiSelect', 18)}</button>
      </div>
      <div class="fm-transport-mid">
        <button class="fm-ghost-btn" type="button" data-act="back" title="Previous frame" aria-label="Previous frame">${icon('stepBack', 16)}</button>
        <button class="fm-play-btn" type="button" data-act="play" title="Play" aria-label="Play"><span class="fm-play-on">${icon('play', 22)}</span><span class="fm-play-off" hidden>${icon('pause', 22)}</span></button>
        <button class="fm-ghost-btn" type="button" data-act="fwd" title="Next frame" aria-label="Next frame">${icon('stepForward', 16)}</button>
      </div>
      <div class="fm-transport-right">
        <span class="fm-frame-readout"></span>
        <button class="fm-round-btn is-strong" type="button" data-act="create" title="Create" aria-label="Create">${icon('plus', 18)}</button>
      </div>
    </div>
    <div class="fm-tl-body">
      <canvas class="fm-tl-ruler" aria-label="Ruler"></canvas>
      <div class="fm-tl-lanes"><canvas class="fm-tl-tracks" aria-label="Tracks"></canvas><button class="fm-edit-pill" type="button" hidden></button><button class="fm-key-pill" type="button" hidden aria-label="Action" title="Action"><span class="fm-key-glyph"></span></button></div>
      <div class="fm-tl-empty" hidden><p>Use the plus button to add a drawing, a flipbook, text or a picture, or drop pictures here.</p></div>
      <div class="fm-modes" role="tablist" aria-label="Mode">
        <button class="fm-mode" type="button" role="tab" data-mode="compose">${icon('compose', 18)}<span>Compose</span></button>
        <button class="fm-mode" type="button" role="tab" data-mode="perform">${icon('perform', 18)}<span>Perform</span></button>
        <button class="fm-mode" type="button" role="tab" data-mode="keyframe">${icon('keyframe', 18)}<span>Keyframe</span></button>
      </div>
    </div>
  </section>`);

  private readonly ruler = q<HTMLCanvasElement>(this.root, '.fm-tl-ruler');
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
  private pal: Palette | null = null;
  private thumbs = new WeakMap<Content, HTMLCanvasElement>();
  private thumbGen = 0;
  private lastMovieId = '';
  private video: VideoPool | null = null;
  private audio: AudioEngine | null = null;
  private readonly decoding = new Set<string>();
  private readonly peakNorm = new WeakMap<object, number>();

  constructor(host: HTMLElement, private readonly engine: Engine, private readonly renderer: Renderer, private readonly hooks: TimelineHooks) {
    host.appendChild(this.root);
    this.actionMenu = new ActionMenu(engine, this.keyState);
    this.laneMenu = new LaneMenu(engine, this.keyState);
    setGlyphLoadHandler(() => this.schedule());
    this.keyPill.addEventListener('click', () => this.actionMenu.open(this.keyPill));
    perform.onChange(() => this.schedule());
    // the pill sits on the key at the Playhead: a right-click on it opens that key's menu
    this.keyPill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const r = this.tracksCanvas.getBoundingClientRect(), p = this.keyPill.getBoundingClientRect();
      const y = Math.min(r.bottom - 1, Math.max(r.top, p.top + p.height / 2));
      this.contextMenu(new MouseEvent('contextmenu', { clientX: p.left + p.width / 2, clientY: y, bubbles: false, cancelable: true }));
    });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.lanes);
    ro.observe(this.ruler);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.ruler.addEventListener('pointerdown', (e) => this.rulerDown(e));
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
    this.editPill.addEventListener('click', () => { const c = this.engine.selected[0]; if (c) this.hooks.edit(c); });
    engine.on('movie', () => { this.thumbGen++; this.schedule(); });
    engine.on('selection', () => this.schedule());
    engine.on('time', () => this.schedule());
    engine.on('mode', (m) => this.syncMode(m));
    engine.on('playing', (on) => this.syncPlay(on));
    engine.on('projects', () => { const id = engine.movie?.id ?? ''; if (id !== this.lastMovieId) { this.lastMovieId = id; this.fitted = false; this.scrollY = 0; this.schedule(); } });
    document.addEventListener('nm:ui-settings-changed', () => { this.pal = null; this.thumbs = new WeakMap(); this.schedule(); });
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

  zoomBy(factor: number): void {
    const m = this.engine.movie;
    if (!m) return;
    const anchor = this.engine.frame;
    const x = this.fx(anchor);
    this.ppf = Math.min(MAX_PPF, Math.max(this.minPpf(m), this.ppf * factor));
    this.start = Math.max(0, anchor - (x - LEFT) / this.ppf);
    this.schedule();
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
    const frameSteps = [1, 2, 5, 10, Math.max(1, Math.round(fps / 2))].sort((a, b) => a - b);
    const major = second * this.ppf >= 40
      ? secondsSteps.find((s) => s * this.ppf >= 56) ?? secondsSteps[secondsSteps.length - 1]
      : frameSteps.find((s) => s * this.ppf >= 56) ?? second;
    const minor = major >= fps ? Math.max(1, Math.round(major / (major >= fps * 5 ? 5 : fps >= 10 ? 4 : 2))) : Math.max(1, Math.round(major / 5));
    return { major, minor, seconds: major % Math.round(fps) === 0 };
  }

  private drawRuler(m: Movie): void {
    const p = this.palette();
    const c = this.ruler.getContext('2d') as CanvasRenderingContext2D;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.width, RULER_H);
    c.fillStyle = p.ruler;
    c.fillRect(0, 0, this.width, RULER_H);
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
        const label = seconds ? `${Math.round(f / m.fps)}s` : String(f);
        c.fillText(label, x + 3, 5);
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
      if (lanes) for (const item of t.content) if (item.keys.length) drawLanes(c, item, y + BLOCK_H + LANES_GAP, this.geom(item), lp, this.height, Math.max(0, Math.min(item.duration - 1, this.engine.frame - item.start)));
    }
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
    setClass(this.keyPill, 'is-rec', perf && perform.recording);
    const at = `translate(${Math.round(spot.x - 32)}px, ${Math.round(spot.y - 20)}px)`;
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
    if (t.hidden) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x0, y, w, BLOCK_H); }
    c.restore();
    c.strokeStyle = selected ? p.accent : p.blockLine;
    c.lineWidth = selected ? 2 : 1;
    this.round(c, x0 + (selected ? 1 : 0.5), y + (selected ? 1 : 0.5), w - (selected ? 2 : 1), BLOCK_H - (selected ? 2 : 1), 6);
    c.stroke();
    c.lineWidth = 1;
    if (w > 46) {
      const label = item.name;
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
      c.save();
      c.beginPath();
      c.rect(x0 + 19, y + 5, tw - 15, 15);
      c.clip();
      c.fillText(label, x0 + 20, y + 13);
      c.restore();
    }
    if (selected && w > 16) {
      c.fillStyle = p.accent;
      this.round(c, x0 + 2, y + BLOCK_H / 2 - 8, 3, 16, 1.5);
      c.fill();
      this.round(c, x1 - 5, y + BLOCK_H / 2 - 8, 3, 16, 1.5);
      c.fill();
    }
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
      const f0 = this.xf(x) - item.start + item.offset, f1 = this.xf(x + step) - item.start + item.offset;
      const a = Math.max(0, Math.floor((f0 / m.fps) * pk.perSecond));
      const b = Math.min(n, Math.max(a + 1, Math.ceil((f1 / m.fps) * pk.perSecond)));
      if (a >= n) break;
      const skip = Math.max(1, Math.floor((b - a) / 12));
      let lo = 0, hi = 0;
      for (let i = a; i < b; i += skip) { if (pk.min[i] < lo) lo = pk.min[i]; if (pk.max[i] > hi) hi = pk.max[i]; }
      const top1 = mid - Math.min(1, hi * norm) * half, bot = mid - Math.max(-1, lo * norm) * half;
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
        const sec = Math.min(last, Math.max(0, (((k + 0.5) * tileW) / this.ppf + item.offset) / m.fps));
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
    setText(this.editPill, `Edit ${kindName(c.kind)}`);
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

  private hover(e: PointerEvent): void {
    const h = this.hit(e);
    const m = this.engine.movie;
    const nearEnd = !!m && Math.abs((e.clientX - this.tracksCanvas.getBoundingClientRect().left) - this.fx(m.duration) - 4) < 6;
    this.tracksCanvas.style.cursor = h?.edge || nearEnd ? 'ew-resize' : h?.item ? 'grab' : 'default';
  }

  private rulerDown(e: PointerEvent): void {
    const m = this.engine.movie;
    if (!m || e.button !== 0) return;
    this.ruler.setPointerCapture(e.pointerId);
    this.engine.stop();
    if (e.altKey) {
      const r = this.ruler.getBoundingClientRect();
      this.drag = { kind: 'zoom', x0: e.clientX, ppf0: this.ppf, anchorFrame: this.xf(e.clientX - r.left) };
      return;
    }
    this.drag = { kind: 'scrub' };
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
    if (lh && !(this.multi || e.shiftKey || e.metaKey || e.ctrlKey)) { this.laneDown(e, lh); return; }
    const additive = this.multi || e.shiftKey || e.metaKey || e.ctrlKey;
    if (h?.item) {
      this.tracksCanvas.setPointerCapture(e.pointerId);
      if (h.edge) {
        this.drag = { kind: 'trim', id: h.item.id, edge: h.edge, x0: e.clientX, applied: 0, ripple: e.altKey, tag: `trim-${Date.now()}` };
        return;
      }
      if (additive) this.engine.toggleSelect(h.item.id);
      else if (!this.engine.selection.content.includes(h.item.id)) this.engine.select([h.item.id], h.track.id);
      if (!additive) this.engine.seek(Math.max(h.item.start, Math.min(end(h.item) - 1, Math.floor(this.xf(x)))));
      this.drag = { kind: 'move', x0: e.clientX, y0: e.clientY, applied: 0, appliedTrack: 0, tag: `move-${Date.now()}`, moved: false };
      return;
    }
    this.tracksCanvas.setPointerCapture(e.pointerId);
    if (additive || this.multi) {
      const y = e.clientY - r.top;
      this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, base: this.engine.selection.content.slice() };
      return;
    }
    this.engine.select([], h?.track.id ?? this.engine.selection.track);
    this.drag = { kind: 'scrub' };
    this.engine.seek(Math.floor(this.xf(x)));
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
    if (e.pointerType !== 'mouse') {
      const x = e.clientX, y = e.clientY;
      this.pressAt = [x, y];
      this.cancelLongPress();
      this.longPress = window.setTimeout(() => {
        this.longPress = 0;
        this.drag = null;
        this.openLaneMenu(lh, x, y);
      }, 500);
    }
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
      const r = this.ruler.getBoundingClientRect();
      this.engine.seek(Math.floor(this.xf(e.clientX - r.left)));
    } else if (d.kind === 'zoom') {
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
      const total = Math.round(((e.clientX - d.x0) / this.ppf) * speed);
      const lanes = Math.round((e.clientY - d.y0) / STRIDE);
      if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
      d.moved = true;
      const step = total - d.applied, laneStep = lanes - d.appliedTrack;
      if (!step && !laneStep) return;
      const ids = this.engine.selection.content;
      if (this.tryRun('Move Content', (mv) => ops.moveContent(mv, ids, step, laneStep), d.tag)) { d.applied = total; d.appliedTrack = lanes; }
    } else if (d.kind === 'trim') {
      const total = Math.round(((e.clientX - d.x0) / this.ppf) * speed);
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
    } else if (d.kind === 'duration') {
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
    this.cancelLongPress();
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* released */ }
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'trim' || d.kind === 'duration' || d.kind === 'key') this.engine.endGesture();
    if (d.kind === 'move' && !d.moved && !(this.multi || e.shiftKey || e.metaKey || e.ctrlKey)) {
      const h = this.hit(e);
      if (h?.item) this.engine.select([h.item.id], h.track.id);
    }
    this.schedule();
  }

  private contextMenu(e: MouseEvent): void {
    e.preventDefault();
    const lh = this.laneHit(e);
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
  }

  private clampScroll(y: number, m: Movie): number {
    this.layout(m);
    const content = TOP_PAD + this.totalH + 80;
    return Math.max(0, Math.min(Math.max(0, content - this.height), y));
  }

  private wheel(e: WheelEvent): void {
    const m = this.engine.movie;
    if (!m) return;
    e.preventDefault();
    const r = this.lanes.getBoundingClientRect();
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
