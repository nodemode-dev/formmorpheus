// Turns PointerEvents into PenSamples in canvas pixels: coalesced and predicted
// points, the pressure curve, and lazy-rope streamline smoothing. Touches only
// the event objects, never the DOM.

import { applyPressure } from './dynamics';
import { MotionFilter } from './feel';
import { penRuntime, type PenRuntime } from './pen-device';
import { readPointer, type PenSampleV2 } from './pen-sample';

type PenSample = PenSampleV2;

export interface PenInputOptions {
  /** Pen settings, device tracker and arbiter; the shared one unless a test pad brings its own. */
  runtime?: PenRuntime;
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
  /** 0 to 1: how much of the filtered path replaces the raw one. */
  motionAmount = 1;
  private readonly filter = new MotionFilter();
  private readonly toCanvas: PenInputOptions['toCanvas'];
  private active = false;
  private rope = 0;
  private bx = 0;
  private by = 0;
  private lastPen: PenSample | null = null;
  private lastOut: PenSample | null = null;
  /** A pen touched down saying pressure 0: held until the next sample shows what it meant. */
  private hold: PenSample | null = null;
  private missed = 0;
  readonly runtime: PenRuntime;

  constructor(opts: PenInputOptions) {
    this.toCanvas = opts.toCanvas;
    this.smoothing = opts.smoothing ?? 0;
    this.fingerPaints = opts.fingerPaints ?? true;
    this.runtime = opts.runtime ?? penRuntime;
  }

  get isActive(): boolean { return this.active; }

  /** False for touch when fingers are reserved for navigation, or a pen is near (palm rejection). */
  paintable(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return true;
    return this.fingerPaints && this.runtime.arbiter.touch(e) === 'paint';
  }

  /** True when this touch is a palm or a resting hand and must do nothing at all; decided once, at its pointerdown. */
  rejected(e: PointerEvent): boolean {
    return e.pointerType === 'touch' && this.runtime.arbiter.admit(e) === 'reject';
  }

  /** Every pointer event on the canvas passes here first, so the arbiter and the device tracker see hover too. */
  watch(e: PointerEvent, phase: 'down' | 'move' | 'up'): void {
    const rt = this.runtime;
    rt.arbiter.note(e, phase);
    if (!this.active && e.pointerType === 'pen') rt.tracker.observe(e);
    // a tablet that arrives as a mouse is told apart by its pressure moving; a plain mouse reads 0.5 or 1
    else if (e.pointerType === 'mouse') rt.tracker.observe(e);
  }

  /** Returns the first sample, or [] when this pointer should not paint (or must wait for its first pressure). */
  down(e: PointerEvent): PenSample[] {
    if (!this.paintable(e)) return [];
    const a = this.toCanvas(0, 0), b = this.toCanvas(1, 0);
    const scale = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.rope = Math.max(0, Math.min(1, this.smoothing)) * MAX_ROPE * scale;
    this.filter.reset();
    this.runtime.smoother.reset();
    this.missed = 0;
    this.hold = null;
    const s = this.sample(e);
    this.active = true;
    this.bx = s.x;
    this.by = s.y;
    if (s.pressure < 0) {
      // contact pressure 0 is a missing value, not a light touch: wait for the next sample
      this.hold = s;
      this.lastPen = null;
      this.lastOut = null;
      return [];
    }
    if (this.motion) this.filter.apply(s, this.expression);
    this.lastPen = s;
    this.lastOut = s;
    return [s];
  }

  /** The held first sample, given the pressure that followed it. */
  private release(pressure: number, rawPressure: number): PenSample | null {
    const h = this.hold;
    if (!h) return null;
    this.hold = null;
    const s = { ...h, pressure, rawPressure };
    if (this.motion) this.filter.apply(s, this.expression);
    this.lastPen = s;
    this.lastOut = s;
    return s;
  }

  move(e: PointerEvent): PenSample[] {
    if (!this.active) return [];
    const out: PenSample[] = [];
    // Read only position, pressure, tilt and time from a coalesced event: some engines leave its pointerId and target
    // empty or wrong, so pointerId must never be read from them (use the parent event's).
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const evs = list.length ? list : [e];
    for (const ev of evs) {
      const raw = this.sample(ev);
      if (raw.pressure < 0) continue;
      const first = this.hold ? this.release(raw.pressure, raw.rawPressure) : null;
      if (first) out.push(first);
      const s = (this.motion ? this.filter.apply(raw, this.expression, this.motionAmount) : raw) as PenSample;
      this.lastPen = s;
      const o = this.follow(s);
      if (o) { out.push(o); this.lastOut = o; }
    }
    if (typeof e.getPredictedEvents === 'function') {
      // Run the rope on a scratch copy so prediction never moves the real state.
      let px = this.bx, py = this.by;
      for (const ev of e.getPredictedEvents()) {
        const s = this.sample(ev, false);
        if (s.pressure < 0) s.pressure = this.lastPen?.pressure ?? 0.5;
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
    const end = this.sample(e, false);
    const out: PenSample[] = [];
    // the lift event carries pressure 0: the stroke ends at the pressure it had
    if (this.hold) {
      const half = this.runtime.effective().apply(0.5);
      const first = this.release(applyPressure(half), -1);
      if (first) out.push(first);
    }
    const last = this.lastOut ?? end;
    if (end.kind === 'pen' || end.pressure < 0 || (end.kind === 'mouse' && this.runtime.settings.mousePressure && last.pressure < 1)) { end.pressure = last.pressure; end.hover = false; }
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
    } else if (d > 0.01 || !this.lastOut || end.time - this.lastOut.time > 120) {
      // a pen lifted after a rest still reports the lift: the stroke needs its time to pool the wash where it sat
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

  /** `advance` false reads without moving the pressure smoother (predicted points, the lift). */
  private sample(e: PointerEvent, advance = true): PenSample {
    const c = this.toCanvas(e.clientX, e.clientY);
    const rt = this.runtime;
    const curve = rt.effective();
    if (advance && e.pointerType === 'pen') rt.tracker.observe(e);
    // a pen in contact that says 0 is missing; after a few in a row the device has no pressure and gets 0.5
    const last = rt.smoother.last;
    const fallback = last >= 0 ? last : this.missed >= 6 ? 0.5 : -1;
    const s = readPointer(e, c.x, c.y, {
      tiltAngle: rt.settings.tiltAngle, curve, smoother: rt.smoother, smoothing: rt.smoothing, advance, after: applyPressure, fallback, mousePressure: rt.settings.mousePressure,
    });
    if (advance && s.kind === 'pen' && !s.hover) this.missed = s.rawPressure < 0 ? this.missed + 1 : 0;
    return s;
  }
}
