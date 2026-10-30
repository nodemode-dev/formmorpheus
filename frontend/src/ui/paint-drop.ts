// Color drop: a fill whose threshold follows a horizontal drag while the pointer is still
// down (shown in a value bubble), and continue-fill, where later taps fill with the same
// color until another tool is chosen. The fill is previewed in the layer and committed as
// one undo step when the pointer lifts.

import { floodFill } from '../paint/fill';
import type { PaintDoc } from '../paint/doc';
import { writeRect } from '../paint/history';
import type { Mask, PixelPatch, Point, RGB } from '../paint/types';
import { thresholdFromDrag } from '../paint/viewmath';
import { el, setHidden, setText } from './dom';
import { t } from './i18n';

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

  constructor(private readonly host: DropHost) {
    this.bubble = el<HTMLElement>('<div class="fm-drop-bubble" hidden></div>');
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
    this.threshold = thresholdFromDrag(l.t0, clientX - l.x0);
    this.place(clientX, clientY);
    if (!this.req) this.req = requestAnimationFrame(() => { this.req = 0; this.apply(); });
  }

  /** Pointer lifted: keep the fill as one undo step. */
  end(): boolean {
    const l = this.live;
    if (this.req) { cancelAnimationFrame(this.req); this.req = 0; this.apply(); }
    this.live = null;
    setHidden(this.bubble, true);
    const doc = this.host.doc();
    if (!l || !l.patch || !doc) return false;
    doc.commitPatch(l.patch, 'Fill');
    this.again = l.color;
    return true;
  }

  /** Throw the preview away (Escape, the view closing). */
  cancel(): void {
    if (this.req) { cancelAnimationFrame(this.req); this.req = 0; }
    this.restore();
    this.live = null;
    setHidden(this.bubble, true);
    this.host.doc()?.settle();
  }

  stopContinue(): void { this.again = null; }

  /** The fill tool: taps fill with the current color until the tool is left. */
  startContinue(color: RGB): void { this.again = color; }

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

  private place(clientX: number, clientY: number): void {
    setText(this.bubble, t('Threshold {p}%').replace('{p}', String(Math.round(this.threshold * 100))));
    setHidden(this.bubble, false);
    this.bubble.style.transform = `translate(${Math.round(clientX - this.origin.left + 18)}px, ${Math.round(clientY - this.origin.top - 44)}px)`;
  }
}
