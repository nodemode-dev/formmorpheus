// Stage navigation: one source of truth for the Stage view transform (zoom, pan, rotation), the pointer and key
// gestures that drive it, the zoom readout cluster and the full-screen Play preview. The Stage and every overlay
// (handles, Warp, bones, paths, camera) read the same view and map the pointer through `stageLocal`.
//
// The Stage is drawn in an unrotated "space" that is centred on the Stage viewport; a rotated view turns that
// space with a CSS transform, so overlays keep their own plain screen maths. Pointer positions go back through
// the inverse turn (`local`).

import type { Engine } from '../engine/engine';
import type { View } from '../engine/render';
import type { Movie } from '../engine/types';
import { MAX_SCALE, MIN_SCALE, rotPt, snapRotation, wrapAngle } from '../paint/viewmath';
import { anyDialogOpen } from './dialogs';
import { el, q, setClass, setHidden, setText, setValue } from './dom';
import { t } from './i18n';
import '../styles/stage-nav.css';

const FIT_MARGIN = 0.05;
const WHEEL_ZOOM = 0.0025;
const ROT_STEP = (15 * Math.PI) / 180;

const svg = (body: string): string => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const NAV_ICONS = {
  out: svg('<path d="M3.5 8h9"/>'),
  in: svg('<path d="M3.5 8h9M8 3.5v9"/>'),
  fit: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  rot: svg('<path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3"/>'),
  full: svg('<path d="M6 2.5H2.5V6M10 2.5h3.5V6M2.5 10v3.5H6M13.5 10v3.5H10"/>'),
  play: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5 3l8 5-8 5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/></svg>',
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The one navigator in the app (the Stage); overlays map the pointer through it. */
let active: StageNav | null = null;

/** Pointer position in Stage space (CSS pixels, unrotated, the space the overlays and handles draw in). */
export function stageLocal(e: { clientX: number; clientY: number }): [number, number] {
  if (active) return active.local(e);
  return [e.clientX, e.clientY];
}

/** Whether the pointer rests over the Stage (keyboard zoom goes there, not to the Timeline). */
export function stageHovered(): boolean {
  return !!active && active.hovered();
}

export class StageNav {
  /** Called after the view changed; the Stage redraws. */
  onChange: () => void = () => undefined;
  /** Right click on the Stage. */
  onContext: ((x: number, y: number) => void) | null = null;
  /** The point is over no content (a double click there fits the view). */
  isEmpty: (x: number, y: number) => boolean = () => true;

  readonly cluster: HTMLElement;
  readonly bar: HTMLElement;
  private readonly host: HTMLElement;
  private readonly zoomBtn: HTMLButtonElement;
  private readonly rotBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly scrubTime: HTMLElement;

  /** Zoom relative to Fit, pan in Stage space pixels from the centred position, rotation in radians. */
  private zoom = 1;
  private px = 0;
  private py = 0;
  private rot = 0;
  private movieId = '';
  private fitScale = 1;
  private mw = 1;
  private mh = 1;
  /** Viewport and Stage space size in CSS pixels. */
  private vw = 1;
  private vh = 1;
  private sw = 1;
  private sh = 1;
  private previewing = false;
  private resume = false;
  private spaceDown = false;
  private panned = false;
  private drag: { kind: 'pan' | 'rot'; id: number; x: number; y: number; px: number; py: number; rot: number; a: number } | null = null;
  private idleTimer = 0;
  private lastReadout = '';

  constructor(private readonly root: HTMLElement, private readonly engine: Engine) {
    active = this;
    this.host = root.parentElement ?? root;
    this.cluster = el(`<div class="fm-nav" role="toolbar" aria-label="${t('Stage view')}">
      <button type="button" class="fm-nav-btn" data-cmd="stage-zoom-out">${NAV_ICONS.out}</button>
      <button type="button" class="fm-nav-zoom" aria-label="${t('Zoom')}" title="${t('Zoom')}"></button>
      <button type="button" class="fm-nav-btn" data-cmd="stage-zoom-in">${NAV_ICONS.in}</button>
      <button type="button" class="fm-nav-btn" data-cmd="stage-fit">${NAV_ICONS.fit}</button>
      <button type="button" class="fm-nav-btn" data-cmd="stage-rotate-reset" hidden>${NAV_ICONS.rot}</button>
      <button type="button" class="fm-nav-btn" data-cmd="stage-fullscreen">${NAV_ICONS.full}</button>
    </div>`);
    this.zoomBtn = q<HTMLButtonElement>(this.cluster, '.fm-nav-zoom');
    this.rotBtn = q<HTMLButtonElement>(this.cluster, '[data-cmd="stage-rotate-reset"]');
    this.bar = el(`<div class="fm-pv" hidden>
      <button type="button" class="fm-nav-btn" data-pv="play" aria-label="${t('Play')}">${NAV_ICONS.play}</button>
      <input type="range" class="fm-pv-scrub" min="0" max="1" step="1" value="0" aria-label="${t('Scrub')}">
      <span class="fm-pv-time"></span>
      <button type="button" class="fm-nav-btn" data-pv="exit" aria-label="${t('Exit Full Screen')}">${NAV_ICONS.close}</button>
    </div>`);
    this.playBtn = q<HTMLButtonElement>(this.bar, '[data-pv="play"]');
    this.scrub = q<HTMLInputElement>(this.bar, '.fm-pv-scrub');
    this.scrubTime = q(this.bar, '.fm-pv-time');
    root.append(this.cluster, this.bar);
    this.wire();
  }

  // ---- state ----
  get preview(): boolean { return this.previewing; }
  get rotated(): boolean { return Math.abs(this.rot) > 1e-4; }
  hovered(): boolean { return this.root.matches(':hover'); }

  /** Viewport size (CSS px) from the Stage; returns the Stage space size, which is wider while the view is turned. */
  layout(vw: number, vh: number): { sw: number; sh: number } {
    this.vw = vw; this.vh = vh;
    const turned = this.rotated && !this.previewing;
    this.sw = turned ? Math.ceil(Math.hypot(vw, vh)) : vw;
    this.sh = turned ? Math.ceil(Math.hypot(vw, vh)) : vh;
    return { sw: this.sw, sh: this.sh };
  }

  /** Where the Stage space box sits and how it is turned, for the Stage to style its wrapper. */
  spaceBox(): { left: number; top: number; deg: number } {
    return { left: (this.vw - this.sw) / 2, top: (this.vh - this.sh) / 2, deg: this.previewing ? 0 : (this.rot * 180) / Math.PI };
  }

  /** The view for this movie in device pixels (`dpr`); also keeps the readout and the Fit scale current. */
  view(m: Movie, dpr: number): View {
    if (m.id !== this.movieId) { this.movieId = m.id; this.zoom = 1; this.px = 0; this.py = 0; this.rot = 0; }
    this.mw = m.width; this.mh = m.height;
    const margin = this.previewing ? 0 : FIT_MARGIN;
    const room = 1 - margin * 2;
    this.fitScale = Math.min((this.vw * room) / m.width, (this.vh * room) / m.height);
    const g = this.geom();
    this.readout(g.scale);
    return { scale: g.scale * dpr, ox: g.ox * dpr, oy: g.oy * dpr, width: Math.round(this.sw * dpr), height: Math.round(this.sh * dpr) };
  }

  private geom(): { scale: number; ox: number; oy: number } {
    if (this.previewing) return { scale: this.fitScale, ox: (this.sw - this.mw * this.fitScale) / 2, oy: (this.sh - this.mh * this.fitScale) / 2 };
    const scale = clamp(this.fitScale * this.zoom, MIN_SCALE, MAX_SCALE);
    return { scale, ox: (this.sw - this.mw * scale) / 2 + this.px, oy: (this.sh - this.mh * scale) / 2 + this.py };
  }

  /** Current view scale (Stage CSS pixels per movie pixel). */
  scale(): number { return this.geom().scale; }

  private readout(scale: number): void {
    const txt = `${Math.round(scale * 100)}%`;
    if (txt !== this.lastReadout) { this.lastReadout = txt; setText(this.zoomBtn, txt); }
    setHidden(this.rotBtn, !this.rotated);
  }

  /** Client position to Stage space. */
  local(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.root.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (this.rotated && !this.previewing) { const p = rotPt(dx, dy, -this.rot); dx = p.x; dy = p.y; }
    return [dx + this.sw / 2, dy + this.sh / 2];
  }

  // ---- operations ----
  private changed(): void { this.onChange(); }

  private clampPan(): void {
    const s = this.geom().scale;
    // keep a quarter of the movie (or of the Stage, when the movie is larger) in view, at least 48 px
    const kx = Math.max(48, Math.min(this.mw * s, this.sw) / 4), ky = Math.max(48, Math.min(this.mh * s, this.sh) / 4);
    const lx = this.sw / 2 + (this.mw * s) / 2 - kx, ly = this.sh / 2 + (this.mh * s) / 2 - ky;
    this.px = clamp(this.px, -lx, lx);
    this.py = clamp(this.py, -ly, ly);
  }

  /** Zoom by `factor`, keeping the movie point under Stage space (sx, sy) where it is. */
  zoomAt(factor: number, sx: number, sy: number): void {
    if (this.previewing) return;
    const g = this.geom();
    const scale = clamp(g.scale * factor, MIN_SCALE, MAX_SCALE);
    if (scale === g.scale) return;
    // the same point of the movie stays under (sx, sy): o' = s - (s - o) * k
    const k = scale / g.scale;
    const ox = sx - (sx - g.ox) * k, oy = sy - (sy - g.oy) * k;
    this.zoom = scale / this.fitScale;
    this.px = ox - (this.sw - this.mw * scale) / 2;
    this.py = oy - (this.sh - this.mh * scale) / 2;
    this.clampPan();
    this.changed();
  }

  zoomBy(factor: number): void { this.zoomAt(factor, this.sw / 2, this.sh / 2); }

  /** Zoom to an absolute scale (1 = one movie pixel per Stage pixel). */
  zoomTo(scale: number): void { this.zoomBy(scale / this.geom().scale); }

  fit(): void {
    if (this.previewing) return;
    this.zoom = 1; this.px = 0; this.py = 0; this.rot = 0;
    this.changed();
  }

  atFit(): boolean { return this.zoom === 1 && this.px === 0 && this.py === 0 && !this.rotated; }

  /** Pan by a screen-space delta. */
  panBy(dx: number, dy: number): void {
    if (this.previewing) return;
    const d = this.rotated ? rotPt(dx, dy, -this.rot) : { x: dx, y: dy };
    this.px += d.x; this.py += d.y;
    this.clampPan();
    this.changed();
  }

  rotateBy(rad: number): void {
    if (this.previewing) return;
    this.rot = snapRotation(wrapAngle(this.rot + rad), 0.01);
    if (Math.abs(this.rot) < 1e-4) this.rot = 0;
    this.changed();
  }

  rotateStep(dir: number): void { this.rotateBy(dir * ROT_STEP); }

  resetRotation(): void {
    if (!this.rotated) return;
    this.rot = 0;
    this.changed();
  }

  // ---- preview ----
  enterPreview(): void {
    if (this.previewing || !this.engine.movie) return;
    this.previewing = true;
    this.resume = this.engine.playing;
    setClass(this.host, 'is-preview', true);
    setHidden(this.bar, false);
    this.syncBar();
    const m = this.engine.movie;
    if (this.engine.frame >= m.duration - 1) this.engine.seek(0);
    this.engine.play();
    void this.host.requestFullscreen?.()?.catch(() => undefined);
    this.wake();
    this.changed();
  }

  exitPreview(): void {
    if (!this.previewing) return;
    this.previewing = false;
    setClass(this.host, 'is-preview', false);
    setHidden(this.bar, true);
    window.clearTimeout(this.idleTimer);
    if (!this.resume) this.engine.stop();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    this.changed();
  }

  togglePreview(): void { if (this.previewing) this.exitPreview(); else this.enterPreview(); }

  /** Controls show while the pointer moves and fade after a short rest. */
  private wake(): void {
    setClass(this.bar, 'is-idle', false);
    setClass(this.host, 'is-idle', false);
    window.clearTimeout(this.idleTimer);
    if (!this.previewing) return;
    this.idleTimer = window.setTimeout(() => { setClass(this.bar, 'is-idle', true); setClass(this.host, 'is-idle', true); }, 2200);
  }

  private syncBar(): void {
    const m = this.engine.movie;
    if (!m) return;
    const max = String(Math.max(0, m.duration - 1));
    if (this.scrub.max !== max) this.scrub.max = max;
    setValue(this.scrub, String(Math.round(this.engine.frame)));
    const pct = m.duration > 1 ? (this.engine.frame / (m.duration - 1)) * 100 : 0;
    this.scrub.style.setProperty('--pct', `${pct.toFixed(2)}%`);
    setText(this.scrubTime, `${Math.round(this.engine.frame)} / ${m.duration - 1}`);
    const playing = this.engine.playing;
    if (this.playBtn.dataset.state !== (playing ? 'pause' : 'play')) {
      this.playBtn.dataset.state = playing ? 'pause' : 'play';
      this.playBtn.replaceChildren(el(playing ? NAV_ICONS.pause : NAV_ICONS.play));
    }
  }

  // ---- input ----
  private wire(): void {
    const root = this.root;
    root.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    root.addEventListener('pointerdown', (e) => this.down(e), true);
    root.addEventListener('pointermove', (e) => { this.moveDrag(e); if (this.previewing) this.wake(); });
    root.addEventListener('pointerup', (e) => this.endDrag(e));
    root.addEventListener('pointercancel', (e) => this.endDrag(e));
    root.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    root.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    root.addEventListener('dblclick', (e) => {
      if (this.previewing || e.button !== 0 || (e.target as Element).closest('.fm-nav, .fm-pv, .fm-box-h, .fm-box-rot')) return;
      const [x, y] = this.local(e);
      if (this.isEmpty(x, y)) this.fit();
    });
    root.addEventListener('click', (e) => {
      if (this.previewing && (e.target as Element).tagName === 'CANVAS') this.engine.togglePlay();
    });
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.previewing || (e.target as Element).closest('.fm-nav, .fm-pv')) return;
      this.onContext?.(e.clientX, e.clientY);
    });
    this.zoomBtn.addEventListener('click', () => { if (Math.abs(this.geom().scale - 1) < 0.005) this.fit(); else this.zoomTo(1); });
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-pv]');
      if (b?.dataset.pv === 'play') this.engine.togglePlay();
      else if (b?.dataset.pv === 'exit') this.exitPreview();
    });
    this.scrub.addEventListener('input', () => { this.engine.seek(this.scrub.valueAsNumber); });
    for (const ev of ['time', 'playing', 'movie'] as const) this.engine.on(ev, () => { if (this.previewing) this.syncBar(); });
    document.addEventListener('fullscreenchange', () => { if (this.previewing && !document.fullscreenElement) this.exitPreview(); });
    window.addEventListener('keydown', (e) => this.key(e), true);
    window.addEventListener('keyup', (e) => this.keyUp(e), true);
    window.addEventListener('blur', () => this.setSpace(false));
  }

  private wheel(e: WheelEvent): void {
    if (this.previewing || !this.engine.movie) return;
    if ((e.target as Element).closest('.fm-nav, .fm-pv, .fm-bones-panel')) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      const [x, y] = this.local(e);
      this.zoomAt(Math.exp(-e.deltaY * unit * WHEEL_ZOOM), x, y);
    } else if (e.shiftKey) this.panBy(-(e.deltaY || e.deltaX) * unit, 0);
    else this.panBy(-e.deltaX * unit, -e.deltaY * unit);
  }

  private down(e: PointerEvent): void {
    if (this.previewing || !this.engine.movie || this.drag) return;
    const hand = e.button === 1 || (this.spaceDown && e.button === 0);
    if (!hand) return;
    // the hand takes the press before the Stage's own handlers see it
    e.stopPropagation();
    e.preventDefault();
    this.panned = true;
    const [x, y] = this.local(e);
    const r = this.root.getBoundingClientRect();
    const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    this.drag = { kind: this.spaceDown && e.shiftKey ? 'rot' : 'pan', id: e.pointerId, x, y, px: this.px, py: this.py, rot: this.rot, a };
    this.root.setPointerCapture(e.pointerId);
    setClass(this.root, 'is-grabbing', true);
  }

  private moveDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (d.kind === 'pan') {
      const [x, y] = this.local(e);
      this.px = d.px + (x - d.x);
      this.py = d.py + (y - d.y);
      this.clampPan();
    } else {
      const r = this.root.getBoundingClientRect();
      const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
      this.rot = snapRotation(wrapAngle(d.rot + (a - d.a)));
    }
    this.changed();
  }

  private endDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    try { this.root.releasePointerCapture(e.pointerId); } catch { /* released */ }
    setClass(this.root, 'is-grabbing', false);
  }

  private setSpace(on: boolean): void {
    if (this.spaceDown === on) return;
    this.spaceDown = on;
    setClass(this.root, 'is-hand', on);
  }

  private key(e: KeyboardEvent): void {
    if (this.previewing) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.exitPreview(); }
      return;
    }
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.spaceDown) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const target = e.target instanceof Element ? e.target : null;
    if (anyDialogOpen() || !this.engine.movie || !this.hovered() || target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    // Space held over the Stage is the hand; a tap with no drag still plays
    e.preventDefault();
    e.stopImmediatePropagation();
    this.panned = false;
    this.setSpace(true);
  }

  private keyUp(e: KeyboardEvent): void {
    if (e.code !== 'Space' || !this.spaceDown) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.setSpace(false);
    if (!this.panned && this.engine.movie) this.engine.togglePlay();
  }
}
