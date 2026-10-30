// Turns PointerEvents into PenSamples in canvas pixels: coalesced and predicted
// points, the pressure curve, and lazy-rope streamline smoothing. Touches only
// the event objects, never the DOM.

import type { PenSample, PointerKind } from './types';
import { applyPressure } from './dynamics';
import { MotionFilter } from './feel';

export interface PenInputOptions {
  /** Client coordinates to canvas pixels. */
  toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  /** 0 to 1 streamline amount. */
  smoothing?: number;
  /** When false, touch is reported as not paintable so the view can pan and zoom with it. */
  fingerPaints?: boolean;
}

/** Rope length in client pixels at full smoothing. */
const MAX_ROPE = 56;

export class PenInput {
  smoothing: number;
  fingerPaints: boolean;
  /** Motion filtering for the next stroke (tremor compensation); expression 0 to 1. */
  motion = false;
  expression = 0.5;
  private readonly filter = new MotionFilter();
  private readonly toCanvas: PenInputOptions['toCanvas'];
  private active = false;
  private rope = 0;
  private bx = 0;
  private by = 0;
  private lastPen: PenSample | null = null;
  private lastOut: PenSample | null = null;

  constructor(opts: PenInputOptions) {
    this.toCanvas = opts.toCanvas;
    this.smoothing = opts.smoothing ?? 0;
    this.fingerPaints = opts.fingerPaints ?? true;
  }

  get isActive(): boolean { return this.active; }

  /** False for touch when fingers are reserved for navigation. */
  paintable(e: PointerEvent): boolean {
    return !(e.pointerType === 'touch' && !this.fingerPaints);
  }

  /** Returns the first sample, or [] when this pointer should not paint. */
  down(e: PointerEvent): PenSample[] {
    if (!this.paintable(e)) return [];
    const a = this.toCanvas(0, 0), b = this.toCanvas(1, 0);
    const scale = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.rope = Math.max(0, Math.min(1, this.smoothing)) * MAX_ROPE * scale;
    this.filter.reset();
    const s = this.sample(e);
    if (this.motion) this.filter.apply(s, this.expression);
    this.active = true;
    this.bx = s.x;
    this.by = s.y;
    this.lastPen = s;
    this.lastOut = s;
    return [s];
  }

  move(e: PointerEvent): PenSample[] {
    if (!this.active) return [];
    const out: PenSample[] = [];
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const evs = list.length ? list : [e];
    for (const ev of evs) {
      const raw = this.sample(ev);
      const s = this.motion ? this.filter.apply(raw, this.expression) : raw;
      this.lastPen = s;
      const o = this.follow(s);
      if (o) { out.push(o); this.lastOut = o; }
    }
    if (typeof e.getPredictedEvents === 'function') {
      // Run the rope on a scratch copy so prediction never moves the real state.
      let px = this.bx, py = this.by;
      for (const ev of e.getPredictedEvents()) {
        const s = this.sample(ev);
        if (this.rope > 0) {
          const d = Math.hypot(s.x - px, s.y - py);
          if (d <= this.rope) continue;
          const k = (d - this.rope) / d;
          px += (s.x - px) * k;
          py += (s.y - py) * k;
          out.push({ ...s, x: px, y: py, predicted: true });
        } else out.push({ ...s, predicted: true });
      }
    }
    return out;
  }

  /** Final catch-up so the stroke ends where the pen ended. */
  up(e: PointerEvent): PenSample[] {
    if (!this.active) return [];
    this.active = false;
    const end = this.sample(e);
    const out: PenSample[] = [];
    const last = this.lastOut ?? end;
    const d = Math.hypot(end.x - this.bx, end.y - this.by);
    if (this.rope > 0 && d > 0.01) {
      const steps = Math.max(1, Math.min(24, Math.ceil(d / 4)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        out.push({
          ...end,
          x: this.bx + (end.x - this.bx) * t,
          y: this.by + (end.y - this.by) * t,
          pressure: last.pressure + (end.pressure - last.pressure) * t,
        });
      }
    } else if (d > 0.01 || !this.lastOut) {
      out.push(end);
    }
    this.bx = end.x;
    this.by = end.y;
    this.lastPen = null;
    this.lastOut = null;
    return out;
  }

  private follow(s: PenSample): PenSample | null {
    if (this.rope <= 0) { this.bx = s.x; this.by = s.y; return s; }
    const d = Math.hypot(s.x - this.bx, s.y - this.by);
    if (d <= this.rope) return null;
    const k = (d - this.rope) / d;
    this.bx += (s.x - this.bx) * k;
    this.by += (s.y - this.by) * k;
    return { ...s, x: this.bx, y: this.by };
  }

  private sample(e: PointerEvent): PenSample {
    const c = this.toCanvas(e.clientX, e.clientY);
    const kind: PointerKind = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
    // a mouse has no pressure: it paints at full strength
    let pressure = 1;
    if (kind === 'pen') pressure = applyPressure(e.pressure > 0 ? e.pressure : this.lastPen?.pressure ?? 0.5);
    else if (kind === 'touch') pressure = applyPressure(e.pressure > 0 ? e.pressure : 0.5);
    return {
      x: c.x,
      y: c.y,
      pressure,
      tiltX: kind === 'pen' ? e.tiltX || 0 : 0,
      tiltY: kind === 'pen' ? e.tiltY || 0 : 0,
      twist: kind === 'pen' ? e.twist || 0 : 0,
      time: e.timeStamp,
      kind,
    };
  }
}
