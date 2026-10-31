// Touch, pen and gesture parity. A pure multi-touch recognizer (MultiTouch), and one DOM hub (GestureHub) that
//   - turns two or three fingers into pinch / rotate / pan / slide for the region under the first finger (the Stage
//     and the Timeline register one), a two-finger tap into Undo, a three-finger tap into Redo (held: repeating),
//     and a quick pinch in into Fit;
//   - lets a second finger held while the first drags an item stand for the snap modifier (Shift) and Free Trim (Alt);
//   - turns a touch held still into the same context menu a right click opens;
//   - tracks a pen hovering over the Timeline so it can scrub.
// Draw & Paint keeps its own recognizer (paint-view.ts) and is left alone here.

import { isQuickPinchIn } from '../paint/viewmath';
import { anyDialogOpen } from './dialogs';
import { loadPaintPrefs, savePaintPrefs } from './paint-settings';
import { HoldRepeat } from './paint-gestures';
import { loadPrefs } from './prefs';
import { t } from './i18n';
import { toast } from './toast';
import '../styles/gestures.css';

/** A touch that moved less than this has not started a drag yet (CSS pixels). */
export const TOUCH_SLOP = 6;
const TAP_MS = 300;
const HOLD_MS = 550;
const MOVE_DEAD = 12;
const ROT_DEAD = 0.14;

export interface GesturePrefs {
  undoGestures: boolean;
  rotatePinch: boolean;
  secondFinger: boolean;
  touchHold: boolean;
  penHover: boolean;
  fingerPaints: boolean;
}

export function gesturePrefs(): GesturePrefs {
  const p = loadPrefs();
  return { undoGestures: p.undoGestures, rotatePinch: p.rotatePinch, secondFinger: p.secondFinger, touchHold: p.touchHold, penHover: p.penHover, fingerPaints: loadPaintPrefs().fingerPaints };
}

let cache: { at: number; p: GesturePrefs } | null = null;
/** The same preferences, read at most twice a second (safe to call on every pointer move). */
export function gesturePrefsNow(): GesturePrefs {
  const n = performance.now();
  if (!cache || n - cache.at > 500) cache = { at: n, p: gesturePrefs() };
  return cache.p;
}

/** The Preferences row for finger painting lives with the paint settings; this writes it and tells an open paint view. */
export function setFingerPaints(on: boolean): void {
  savePaintPrefs({ ...loadPaintPrefs(), fingerPaints: on });
  document.dispatchEvent(new CustomEvent('fm:gesture-prefs'));
}

// ---------------------------------------------------------------- the recognizer (pure)

export interface PinchInfo {
  fingers: number;
  /** Spread now over spread at the start (or at the last change of finger count). */
  k: number;
  /** Radians turned since the start. */
  rot: number;
  /** The middle of the fingers now. */
  cx: number;
  cy: number;
  /** How far the middle has travelled since the start. */
  dx: number;
  dy: number;
}

export interface EndInfo { fingers: number; moved: boolean; ms: number; quickIn: boolean }

export interface MultiHandlers {
  /** Two or more fingers are down for the first time, or the count changed: remember the view as it is now. */
  begin(fingers: number, cx: number, cy: number): void;
  /** The fingers moved past the dead zone; values are relative to the last `begin`. */
  change(i: PinchInfo): void;
  /** Every finger is up. */
  end(i: EndInfo): void;
}

interface Tp { x: number; y: number }

const wrap = (a: number): number => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class MultiTouch {
  private readonly pts = new Map<number, Tp>();
  private on = false;
  private moved = false;
  private maxN = 0;
  private t0 = 0;
  private d0 = 1;
  private a0 = 0;
  private cx0 = 0;
  private cy0 = 0;
  private startD = 1;
  private dNow = 1;

  constructor(private readonly h: MultiHandlers) {}

  get count(): number { return this.pts.size; }
  get active(): boolean { return this.on; }

  private metrics(): { d: number; a: number; cx: number; cy: number } {
    const p = [...this.pts.values()];
    const cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length;
    if (p.length === 2) return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), cx, cy };
    const r = p.reduce((s, q) => s + Math.hypot(q.x - cx, q.y - cy), 0) / p.length;
    return { d: Math.max(1, r * 2), a: Math.atan2(p[0].y - cy, p[0].x - cx), cx, cy };
  }

  private rebase(): void {
    const m = this.metrics();
    this.d0 = m.d; this.a0 = m.a; this.cx0 = m.cx; this.cy0 = m.cy;
    this.h.begin(this.pts.size, m.cx, m.cy);
  }

  down(id: number, x: number, y: number, now: number): void {
    this.pts.set(id, { x, y });
    if (this.pts.size < 2) return;
    this.maxN = Math.max(this.maxN, this.pts.size);
    if (!this.on) {
      this.on = true; this.moved = false; this.t0 = now; this.maxN = this.pts.size;
      this.startD = this.metrics().d;
      this.dNow = this.startD;
    }
    this.rebase();
  }

  move(id: number, x: number, y: number): void {
    const p = this.pts.get(id);
    if (!p) return;
    p.x = x; p.y = y;
    if (!this.on || this.pts.size < 2) return;
    const m = this.metrics();
    this.dNow = m.d;
    const k = m.d / this.d0, rot = wrap(m.a - this.a0), dx = m.cx - this.cx0, dy = m.cy - this.cy0;
    if (!this.moved && (Math.abs(m.d - this.d0) > MOVE_DEAD || Math.hypot(dx, dy) > MOVE_DEAD || (this.pts.size === 2 && Math.abs(rot) > ROT_DEAD))) this.moved = true;
    if (this.moved) this.h.change({ fingers: this.pts.size, k, rot: this.pts.size === 2 ? rot : 0, cx: m.cx, cy: m.cy, dx, dy });
  }

  up(id: number, now: number): void {
    if (!this.pts.delete(id)) return;
    if (!this.on) return;
    if (this.pts.size >= 2) { this.rebase(); return; }
    if (this.pts.size === 1) return;
    const ms = now - this.t0;
    this.on = false;
    const info: EndInfo = { fingers: this.maxN, moved: this.moved, ms, quickIn: this.maxN === 2 && this.moved && isQuickPinchIn(this.startD, this.dNow, ms) };
    this.maxN = 0;
    this.h.end(info);
  }

  /** The gesture is over without a result (a dialog opened, the window lost focus). */
  reset(): void {
    this.pts.clear();
    this.on = false;
    this.maxN = 0;
  }
}

// ---------------------------------------------------------------- the hub (DOM)

export interface GestureRegion {
  /** The region handles every multi-finger gesture itself (the hub leaves it alone). */
  own?: boolean;
  /** The first finger is dragging an item: a second finger then acts as a modifier instead of starting a pinch. */
  dragging?(): boolean;
  begin?(fingers: number, cx: number, cy: number): void;
  change?(i: PinchInfo): void;
  end?(i: EndInfo): void;
  /** True when the region opens the menu for a held touch itself, here. */
  holdOwn?(target: Element, x: number, y: number): boolean;
}

type Mode = 'idle' | 'single' | 'multi' | 'modifier' | 'ignore';

const HOLD_EXEMPT = 'input, textarea, select, [contenteditable="true"], .fm-paint-canvas, .fm-fs-cell, .cv-hf-item, .fm-nav, .fm-pv, video, audio';
const NO_MULTI = '.fm-paint, .cv-home, .cv-scrim, .cv-dialog, .cv-popover, .fm-pop';

export class GestureHub {
  /** Actions for the global taps; the app sets them. */
  actions: { undo(): void; redo(): void } | null = null;

  private readonly regions = new WeakMap<Element, GestureRegion>();
  private readonly touches = new Map<number, { x: number; y: number; x0: number; y0: number; target: Element | null }>();
  private readonly multi: MultiTouch;
  private readonly repeat = new HoldRepeat(420, 110);
  private mode: Mode = 'idle';
  private region: GestureRegion | null = null;
  private first: { id: number; target: Element | null } | null = null;
  private prefs: GesturePrefs = gesturePrefs();
  private holdTimer = 0;
  private heldAt = 0;
  private swallowClickUntil = 0;
  private repeated = false;
  private installed = false;

  constructor() {
    this.multi = new MultiTouch({
      begin: (n, cx, cy) => {
        this.stopRepeat();
        this.region?.begin?.(n, cx, cy);
        if (n === 2 || n === 3) this.armRepeat(n);
      },
      change: (i) => { this.stopRepeat(); this.region?.change?.(i); },
      end: (i) => this.finish(i),
    });
  }

  /** Register a region: the hub routes gestures whose first finger lands inside `host` to `r`. */
  region_(host: Element, r: GestureRegion): () => void {
    this.regions.set(host, r);
    return () => { this.regions.delete(host); };
  }

  /** A second finger is held while the first one drags something. */
  get modifier(): boolean { return this.mode === 'modifier' && this.prefs.secondFinger; }

  install(): void {
    if (this.installed) return;
    this.installed = true;
    const opt = { capture: true, passive: false } as const;
    window.addEventListener('pointerdown', (e) => this.onDown(e), opt);
    window.addEventListener('pointermove', (e) => this.onMove(e), opt);
    window.addEventListener('pointerup', (e) => this.onUp(e), opt);
    window.addEventListener('pointercancel', (e) => this.onUp(e), opt);
    window.addEventListener('click', (e) => {
      if (performance.now() < this.swallowClickUntil) { e.stopImmediatePropagation(); e.preventDefault(); this.swallowClickUntil = 0; }
    }, true);
    // the system's own long-press menu: let it through when the hold has not fired, drop it when it has (one menu)
    window.addEventListener('contextmenu', (e) => {
      if (!e.isTrusted) return;
      if (performance.now() - this.heldAt < 1500) { e.stopImmediatePropagation(); e.preventDefault(); return; }
      if (this.mode === 'single') this.clearHold();
    }, true);
    window.addEventListener('blur', () => this.abort());
  }

  private regionOf(target: Element | null): GestureRegion | null {
    for (let n: Element | null = target; n; n = n.parentElement) {
      const r = this.regions.get(n);
      if (r) return r;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    const target = e.target instanceof Element ? e.target : null;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, target });
    if (this.touches.size === 1) {
      this.prefs = gesturePrefs();
      this.mode = 'single';
      this.region = this.regionOf(target);
      this.first = { id: e.pointerId, target };
      this.repeated = false;
      this.armHold(e, target);
      return;
    }
    // a second or third finger
    this.clearHold();
    if (this.mode === 'ignore') return;
    if (this.mode === 'modifier') { e.stopPropagation(); return; }
    if (this.mode === 'single') {
      const f = this.first && this.touches.get(this.first.id);
      const reg = this.region;
      const blocked = anyDialogOpen() || !!this.first?.target?.closest(NO_MULTI) || !!reg?.own;
      if (blocked) { this.mode = 'ignore'; return; }
      const drag = !!f && Math.hypot(f.x - f.x0, f.y - f.y0) > TOUCH_SLOP && !!reg?.dragging?.();
      if (drag) {
        e.stopPropagation();
        this.mode = this.prefs.secondFinger ? 'modifier' : 'ignore';
        if (this.mode === 'modifier') document.dispatchEvent(new CustomEvent('fm:touch-modifier'));
        return;
      }
      // a pinch, not a drag: the first finger's grab (if any) is dropped
      this.cancelFirst();
      this.mode = 'multi';
      this.multi.down(this.first?.id ?? -1, f?.x ?? e.clientX, f?.y ?? e.clientY, performance.now());
    }
    if (this.mode === 'multi') {
      e.stopPropagation();
      this.multi.down(e.pointerId, e.clientX, e.clientY, performance.now());
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    const p = this.touches.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (this.mode === 'single' && this.holdTimer && Math.hypot(p.x - p.x0, p.y - p.y0) > TOUCH_SLOP) this.clearHold();
    if (this.mode === 'multi') {
      e.stopPropagation();
      this.multi.move(e.pointerId, e.clientX, e.clientY);
    } else if (this.mode === 'modifier' && e.pointerId !== this.first?.id) e.stopPropagation();
  }

  private onUp(e: PointerEvent): void {
    // (the cancel the hub sends the first finger's own handlers is not a finger lifting)
    if (e.pointerType !== 'touch' || !e.isTrusted) return;
    if (!this.touches.has(e.pointerId)) return;
    const wasMulti = this.mode === 'multi';
    const secondary = this.mode === 'modifier' && e.pointerId !== this.first?.id;
    if (wasMulti || secondary) e.stopPropagation();
    this.touches.delete(e.pointerId);
    if (wasMulti) this.multi.up(e.pointerId, performance.now());
    if (this.mode === 'modifier' && this.touches.size < 2) this.mode = 'single';
    if (!this.touches.size) {
      this.clearHold();
      this.stopRepeat();
      this.mode = 'idle';
      this.region = null;
      this.first = null;
    }
  }

  /** Tell the first finger's own handlers it was cancelled (a drag in progress is ended where it is). */
  private cancelFirst(): void {
    const f = this.first;
    if (!f?.target) return;
    try {
      f.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: f.id, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: false }));
    } catch { /* an old engine without PointerEvent construction */ }
  }

  private finish(i: EndInfo): void {
    const reg = this.region;
    this.stopRepeat();
    reg?.end?.(i);
    if (!i.moved && i.ms < TAP_MS && !this.repeated && this.prefs.undoGestures && !(reg?.own)) {
      const which = i.fingers === 2 ? 'undo' : i.fingers === 3 ? 'redo' : null;
      if (which) this.act(which);   // the undo banner (ui/undo-banner) names the step
    }
    // four fingers tapped: the full-screen preview, in and out
    if (!i.moved && i.fingers === 4 && i.ms < TAP_MS) document.dispatchEvent(new CustomEvent('fm:command', { detail: 'stage-fullscreen' }));
    this.repeated = false;
  }

  private act(which: 'undo' | 'redo'): void {
    if (!this.actions) return;
    this.actions[which]();
  }

  private armRepeat(n: number): void {
    if (!this.prefs.undoGestures || !this.actions) return;
    this.repeated = false;
    const which = n === 2 ? 'undo' : 'redo';
    this.repeat.delay = loadPaintPrefs().undoDelay;
    this.repeat.start(() => {
      this.repeated = true;
      this.act(which);
    }, false);
  }

  private stopRepeat(): void { this.repeat.stop(); }

  // ---- touch and hold

  private armHold(e: PointerEvent, target: Element | null): void {
    this.clearHold();
    if (!this.prefs.touchHold || !target || target.closest(HOLD_EXEMPT) || anyDialogOpen() && !target.closest('.cv-scrim')) return;
    const x = e.clientX, y = e.clientY, id = e.pointerId;
    if (this.region?.holdOwn?.(target, x, y)) return;
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      const p = this.touches.get(id);
      if (!p || this.mode !== 'single') return;
      const at = document.elementFromPoint(p.x, p.y) ?? target;
      this.heldAt = performance.now();
      this.swallowClickUntil = this.heldAt + 4000;
      at.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, button: 2, buttons: 0, view: window }));
    }, HOLD_MS);
  }

  private clearHold(): void {
    if (this.holdTimer) { window.clearTimeout(this.holdTimer); this.holdTimer = 0; }
  }

  private abort(): void {
    this.clearHold();
    this.stopRepeat();
    this.touches.clear();
    this.multi.reset();
    this.mode = 'idle';
    this.region = null;
    this.first = null;
  }
}

export const gestures = new GestureHub();

/** Register a gesture region (the Stage, the Timeline). */
export function gestureRegion(host: Element, r: GestureRegion): () => void {
  return gestures.region_(host, r);
}

/** Whether a finger other than the dragging one is held: the touch stand-in for Shift and Free Trim. */
export function touchModifier(): boolean {
  return gestures.modifier;
}

/** Shift, or a second finger held, for the snap modifier. */
export function snapMod(e: { shiftKey: boolean }): boolean {
  return e.shiftKey || gestures.modifier;
}

/** A pen hovering (not touching) over `host` reports its position; the Timeline scrubs with it. */
export function penHover(host: Element, onMove: (e: PointerEvent) => void): void {
  host.addEventListener('pointermove', (e) => {
    const ev = e as PointerEvent;
    if (ev.pointerType !== 'pen' || ev.buttons !== 0 || ev.pressure > 0) return;
    if (!gesturePrefsNow().penHover) return;
    onMove(ev);
  });
}
