// The brush cursor layer: a transparent canvas laid over the paint canvas, so moving the pen only repaints this
// layer (the picture underneath is not redrawn, and the eyedropper loupe never magnifies the outline).
// What it draws is drawBrushCursor: the per-brush outline (App setting, Brush tip, Circle, None) and the hover fill.

import { drawBrushCursor, type CursorShape } from './paint-feel';

export class PaintCursorLayer {
  private readonly cv: HTMLCanvasElement;
  private readonly cx: CanvasRenderingContext2D | null;
  private shown = false;

  constructor(under: HTMLCanvasElement) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'fm-paint-cursor';
    this.cv.setAttribute('aria-hidden', 'true');
    this.cx = this.cv.getContext('2d');
    under.after(this.cv);
  }

  /** Remove the outline; cheap when nothing is shown. */
  clear(): void {
    if (!this.shown || !this.cx) return;
    this.cx.setTransform(1, 0, 0, 1, 0, 0);
    this.cx.clearRect(0, 0, this.cv.width, this.cv.height);
    this.shown = false;
  }

  /** Draw one outline; `base` is the view matrix (device scale and canvas rotation) the shape's x and y are in. */
  draw(under: HTMLCanvasElement, base: DOMMatrix, shape: CursorShape): void {
    const cx = this.cx;
    if (!cx) return;
    if (this.cv.width !== under.width || this.cv.height !== under.height) { this.cv.width = under.width; this.cv.height = under.height; this.shown = false; }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, this.cv.width, this.cv.height);
    cx.setTransform(base);
    drawBrushCursor(cx, shape);
    this.shown = true;
  }
}
