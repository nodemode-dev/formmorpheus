// Color drop: a fill whose threshold follows a horizontal drag while the pointer is still
// down (shown in a value bubble), and continue-fill, where later taps fill with the same
// color until another tool is chosen. The fill is previewed in the layer and committed as
// one undo step when the pointer lifts.

import { floodFill } from '../paint/fill';
import type { PaintDoc } from '../paint/doc';
import { writeRect } from '../paint/history';
import type { Mask, PixelPatch, Point, RGB } from '../paint/types';
import { thresholdFromDrag } from '../paint/viewmath';
import { el, q, setHidden, setText } from './dom';
import { t } from './i18n';

const KEY = 'formmorpheus.paint.dropThreshold';
/** A full slider is kept at 97.6 percent: the fill never leaks through every outline. */
const MAX_T = 0.976;
const shownPercent = (v: number): number => Math.round(Math.min(1, v / MAX_T) * 100);

export interface DropHost {
  doc: () => PaintDoc | null;
  selection: () => Mask | null;
  toCanvas: (clientX: number, clientY: number) => Point;
  /** The element the bubble is positioned inside. */
  root: HTMLElement;
}

interface Live { patch: PixelPatch | null; layer: string; x: number; y: number; color: RGB; x0: number; t0: number }

export class ColourDrop {
  readonly bubble: HTMLElement;
  /** Last threshold used (0..1); a plain drop and every continue-fill start from it. */
  threshold = 0.3;
  private live: Live | null = null;
  private again: RGB | null = null;
  private req = 0;
  private origin = { left: 0, top: 0 };

  private readonly valEl: HTMLElement;
  private readonly lineEl: HTMLElement;
  private readonly pillEl: HTMLButtonElement;
  private readonly tickEl: HTMLButtonElement;
  private hideTimer = 0;
  /** The color of the drop that just ended: "Continue filling" turns it into a standing fill. */
  private offered: RGB | null = null;
  /** Called when continue-fill starts or stops so the host can update its buttons. */
  onContinue: (() => void) | null = null;

  constructor(private readonly host: DropHost) {
    this.bubble = el<HTMLElement>(
      `<div class="fm-thr" role="status" hidden><div class="fm-thr-row"><span class="fm-thr-title"></span>` +
      `<button type="button" class="fm-thr-pill" hidden></button>` +
      `<button type="button" class="fm-thr-tick" hidden title="Stop filling" aria-label="Stop filling"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>` +
      `<span class="fm-thr-val"></span></div><div class="fm-thr-line"><i></i></div></div>`);
    this.valEl = q(this.bubble, '.fm-thr-val');
    this.lineEl = q(this.bubble, '.fm-thr-line > i');
    this.pillEl = q<HTMLButtonElement>(this.bubble, '.fm-thr-pill');
    this.tickEl = q<HTMLButtonElement>(this.bubble, '.fm-thr-tick');
    setText(q(this.bubble, '.fm-thr-title'), t('ColorDrop'));
    setText(this.pillEl, t('Continue filling'));
    this.pillEl.addEventListener('click', () => { if (this.offered) { this.again = this.offered; this.offered = null; this.show(false); this.onContinue?.(); } });
    this.tickEl.addEventListener('click', () => { this.stopContinue(); this.onContinue?.(); });
    // the threshold is remembered; a full slider is stored a little below 1 so a fill never floods the outline itself
    try { const v = Number(localStorage.getItem(KEY)); if (v > 0 && v <= 1) this.threshold = Math.min(MAX_T, v); } catch { /* this session only */ }
  }

  /** The readout: title, then either the live threshold or the Continue filling pill and the tick. */
  private show(live: boolean): void {
    clearTimeout(this.hideTimer);
    const continuing = this.again !== null;
    setText(this.valEl, live ? t('Threshold {p}%').replace('{p}', String(shownPercent(this.threshold))) : '');
    this.lineEl.parentElement?.classList.toggle('is-off', !live);
    this.bubble.style.setProperty('--v', String(Math.min(1, this.threshold / MAX_T)));
    setHidden(this.pillEl, live || continuing || !this.offered);
    setHidden(this.tickEl, live || !continuing);
    this.bubble.classList.toggle('is-continue', !live && (continuing || this.offered !== null));
    setHidden(this.bubble, !live && !continuing && !this.offered);
    if (!live && !continuing && this.offered) this.hideTimer = window.setTimeout(() => { this.offered = null; this.show(false); }, 6000);
  }

  get active(): boolean { return this.live !== null; }
  /** The color later taps fill with, null when continue-fill is off. */
  get continuing(): RGB | null { return this.again; }

  /** Start (and show) a fill at a client point. False when the point is off the picture or nothing would change. */
  begin(clientX: number, clientY: number, color: RGB): boolean {
    const doc = this.host.doc();
    if (!doc) return false;
    const p = this.host.toCanvas(clientX, clientY);
    if (p.x < 0 || p.y < 0 || p.x >= doc.width || p.y >= doc.height) return false;
    const layer = doc.activeLayer();
    if (!layer.visible) return false;
    const r = this.host.root.getBoundingClientRect();
    this.origin = { left: r.left, top: r.top };
    this.live = { patch: null, layer: layer.id, x: Math.floor(p.x), y: Math.floor(p.y), color, x0: clientX, t0: this.threshold };
    this.apply();
    this.place(clientX, clientY);
    return this.live.patch !== null;
  }

  /** Horizontal drag after the drop: left is stricter, right is looser. */
  drag(clientX: number, clientY: number): void {
    const l = this.live;
    if (!l) return;
    this.threshold = Math.min(MAX_T, thresholdFromDrag(l.t0, clientX - l.x0));
    this.place(clientX, clientY);
    if (!this.req) this.req = requestAnimationFrame(() => { this.req = 0; this.apply(); });
  }

  /** Pointer lifted: keep the fill as one undo step. */
  end(): boolean {
    const l = this.live;
    if (this.req) { cancelAnimationFrame(this.req); this.req = 0; this.apply(); }
    this.live = null;
    const doc = this.host.doc();
    if (!l || !l.patch || !doc) { this.show(false); return false; }
    doc.commitPatch(l.patch, 'Fill');
    try { localStorage.setItem(KEY, String(this.threshold)); } catch { /* this session only */ }
    // a drop offers "Continue filling"; while already filling, the color follows the chip as before
    if (this.again) this.again = l.color; else this.offered = l.color;
    this.show(false);
    return true;
  }

  /** Throw the preview away (Escape, the view closing). */
  cancel(): void {
    if (this.req) { cancelAnimationFrame(this.req); this.req = 0; }
    this.restore();
    this.live = null;
    this.show(false);
    this.host.doc()?.settle();
  }

  stopContinue(): void { this.again = null; this.offered = null; this.show(false); }

  /** The fill tool: taps fill with the current color until the tool is left. */
  startContinue(color: RGB): void { this.again = color; this.offered = null; this.show(false); }

  private restore(): void {
    const l = this.live, doc = this.host.doc();
    if (!l?.patch || !doc) return;
    const layer = doc.layer(l.layer);
    if (!layer) return;
    writeRect(layer.raster, l.patch.rect, l.patch.before);
    doc.markDirty(layer.id, l.patch.rect);
    l.patch = null;
  }

  private apply(): void {
    const l = this.live, doc = this.host.doc();
    if (!l || !doc) return;
    this.restore();
    const layer = doc.layer(l.layer);
    if (!layer) return;
    const patch = floodFill(layer.raster, layer.raster, l.x, l.y, l.color, this.threshold, this.host.selection(), layer.id);
    if (!patch) return;
    doc.markDirty(layer.id, patch.rect);
    l.patch = patch;
  }

  private place(_clientX: number, _clientY: number): void {
    this.offered = null;
    this.show(true);
  }
}
