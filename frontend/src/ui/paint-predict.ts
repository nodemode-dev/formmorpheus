// The predicted tail of a stroke: where the pen is about to be, drawn on screen only. It is
// replaced by the real points as they arrive and is never written to the layer or the undo.

import type { PenSample, Point, Rect, RGB } from '../paint/types';

interface Seg { x: number; y: number; w: number }

export class PredictTail {
  private from: Point | null = null;
  private pts: Seg[] = [];
  private box: Rect | null = null;
  private color: RGB = { r: 0, g: 0, b: 0 };
  private alpha = 1;

  get active(): boolean { return this.pts.length > 0; }

  /** Set the tail; returns the canvas rectangle to repaint (old and new tail together), or null. */
  set(from: Point, samples: PenSample[], width: (s: PenSample) => number, color: RGB, opacity: number): Rect | null {
    const old = this.box;
    this.from = from;
    this.color = color;
    this.alpha = opacity;
    this.pts = samples.map((s) => ({ x: s.x, y: s.y, w: Math.max(1, width(s)) }));
    this.box = this.bounds();
    return union(old, this.box);
  }

  clear(): Rect | null {
    const old = this.box;
    this.pts = [];
    this.from = null;
    this.box = null;
    return old;
  }

  /** In canvas coordinates; call with the canvas transform set. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.from || !this.pts.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = this.alpha * 0.85;
    ctx.strokeStyle = `rgb(${this.color.r}, ${this.color.g}, ${this.color.b})`;
    let px = this.from.x, py = this.from.y;
    for (const p of this.pts) {
      ctx.lineWidth = p.w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      px = p.x;
      py = p.y;
    }
    ctx.restore();
  }

  private bounds(): Rect | null {
    if (!this.from || !this.pts.length) return null;
    let x0 = this.from.x, y0 = this.from.y, x1 = x0, y1 = y0, m = 0;
    for (const p of this.pts) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      if (p.w > m) m = p.w;
    }
    const pad = m / 2 + 2;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}
