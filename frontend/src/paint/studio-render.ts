// Brush Studio drawing pad, the pure half: recorded pen strokes replayed through the real input pipeline
// (streamline rope, motion filter) and the real Stroke engine. No DOM: the pad (ui/brush-studio.ts) and the
// parameter check both call renderPad, so what the person sees is what a stroke in a drawing would do.

import type { Brush, PenSample, PointerKind, Raster, Rect, RGB } from './types';
import { PenInput } from './input';
import { Stroke } from './stroke';
import { stabilizationRope } from './brushes';

/** One recorded input point: x and y as 0..1 shares of the pad, time in ms from the stroke's first point. */
export interface PadEvent { x: number; y: number; p: number; tx: number; ty: number; tw: number; t: number; k: PointerKind }
export interface PadStroke { seed: number; ev: PadEvent[]; tool?: 'smudge' }

export interface PadPaint { color: RGB; color2: RGB; size: number; opacity: number; viewRot?: number }

/** What the person's brush asks of the input pipeline, as paint-view reads it. */
export function padFeel(b: Brush): { smoothing: number; motion: boolean; expression: number; amount: number } {
  return {
    smoothing: Math.min(1, b.smoothing + stabilizationRope(b)),
    motion: !!b.motionFilter,
    expression: b.expression !== undefined ? b.expression / 100 : 0.5,
    amount: b.motionFilter ? b.motionFilter / 100 : 1,
  };
}

/** Runs one stroke event by event; live drawing and replay share it. */
export class PadRunner {
  private readonly input: PenInput;
  private readonly stroke: Stroke;
  private w: number;
  private h: number;

  constructor(raster: Raster, brush: Brush, paint: PadPaint, seed: number, tool: 'paint' | 'smudge' = 'paint') {
    this.w = raster.width; this.h = raster.height;
    const f = padFeel(brush);
    this.input = new PenInput({ toCanvas: (x, y) => ({ x, y }), smoothing: f.smoothing, fingerPaints: true });
    this.input.motion = f.motion;
    this.input.expression = f.expression;
    this.input.motionAmount = f.amount;
    this.stroke = new Stroke(raster, 'pad', {
      tool, brush, color: paint.color, color2: paint.color2, size: paint.size, opacity: paint.opacity,
      alphaLock: false, selection: null, zoom: 1, dynamicScaling: false, seed, viewRot: paint.viewRot, sizeRef: 1920,
    });
  }

  private fake(e: PadEvent): PointerEvent {
    return { clientX: e.x * this.w, clientY: e.y * this.h, pressure: e.p, pointerType: e.k, tiltX: e.tx, tiltY: e.ty, twist: e.tw, timeStamp: e.t } as unknown as PointerEvent;
  }

  private feed(list: PenSample[]): Rect | null {
    let rect: Rect | null = null;
    for (const s of list) {
      if (s.predicted) continue;
      const r = this.stroke.add(s);
      if (r) rect = rect ? union(rect, r) : r;
    }
    return rect;
  }

  down(e: PadEvent): Rect | null { return this.feed(this.input.down(this.fake(e))); }
  move(e: PadEvent): Rect | null { return this.feed(this.input.move(this.fake(e))); }

  /** Lifts the pen; returns the area the end of the stroke touched. */
  up(e: PadEvent): Rect | null {
    const r = this.feed(this.input.up(this.fake(e)));
    const patch = this.stroke.finish();
    const p = patch ? patch.rect : null;
    return r && p ? union(r, p) : r ?? p;
  }
}

function union(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
}

/** Draws the strokes, in order, on a clear raster of the given size. */
export function renderPad(brush: Brush, strokes: PadStroke[], width: number, height: number, paint: PadPaint): Raster {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const raster: Raster = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (const s of strokes) replay(raster, brush, s, paint);
  return raster;
}

export function replay(raster: Raster, brush: Brush, s: PadStroke, paint: PadPaint): void {
  if (s.ev.length < 1) return;
  const run = new PadRunner(raster, brush, paint, s.seed, s.tool ?? 'paint');
  run.down(s.ev[0]);
  for (let i = 1; i < s.ev.length - 1; i++) run.move(s.ev[i]);
  run.up(s.ev[s.ev.length - 1]);
}

/** The strokes the pad starts with: a long swell with the pen leaning, and a short crossing mark. */
export function demoStrokes(): PadStroke[] {
  const a: PadEvent[] = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = 0.1 + 0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75);
    a.push({
      x: 0.1 + 0.8 * t, y: 0.42 + Math.sin(t * Math.PI * 2) * 0.17 * (1 - 0.2 * t), p,
      tx: 12 + 38 * t, ty: -10 + 30 * Math.sin(t * 3), tw: 0, t: i * (6 + 5 * Math.sin(t * 5) ** 2), k: 'pen',
    });
  }
  const b: PadEvent[] = [];
  const m = 40;
  for (let i = 0; i <= m; i++) {
    const t = i / m;
    b.push({ x: 0.3 + 0.12 * t, y: 0.12 + 0.76 * t, p: 0.15 + 0.8 * Math.sin(Math.PI * t) ** 0.6, tx: 30, ty: 35, tw: 0, t: i * 9, k: 'pen' });
  }
  return [{ seed: 4242, ev: a }, { seed: 777, ev: b }];
}
