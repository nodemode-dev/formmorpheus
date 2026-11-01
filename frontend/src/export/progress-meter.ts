// Turns the exporter's stage by stage progress into one fraction, an elapsed time and an estimate of the time left.
// Pure maths (no DOM, no timers): every export path reports the same ExportProgress, so one meter serves a worker
// export, the main-thread fallback and an engine ffmpeg job alike.
import type { ExportFormat, ExportProgress } from './types';

export type Stage = ExportProgress['stage'];

/** How much of the whole job each stage is worth, in the order the stages run. */
export interface StagePlan { stage: Stage; weight: number }

/** The stages a format passes through. Weights are rough shares of the wall time, not exact: the fraction only has to rise steadily. */
export function planFor(format: ExportFormat, o: { engine: boolean; audio: boolean }): StagePlan[] {
  const plan: StagePlan[] = [];
  if (o.audio) plan.push({ stage: 'audio', weight: 0.04 });
  if (o.engine) {
    // frames are drawn and uploaded, then ffmpeg encodes them
    plan.push({ stage: 'frames', weight: 0.55 }, { stage: 'encoding', weight: 0.38 }, { stage: 'finishing', weight: 0.03 });
  } else if (format === 'gif' || format === 'apng' || format === 'webp-anim') {
    // a first pass draws (or samples) the frames, a second one quantizes and writes them
    plan.push({ stage: 'frames', weight: 0.4 }, { stage: 'encoding', weight: 0.53 }, { stage: 'finishing', weight: 0.03 });
  } else plan.push({ stage: 'frames', weight: 0.93 }, { stage: 'finishing', weight: 0.03 });
  return plan;
}

export interface Reading {
  stage: Stage;
  /** Units done and in all within the current stage (frames, for the frames stage). */
  done: number;
  total: number;
  /** 0 to 1 over the whole job; never goes down. */
  frac: number;
  elapsedMs: number;
  /** Estimated time left; null until there is enough to go on, and while finishing. */
  etaMs: number | null;
}

const WINDOW_MS = 12000;
const MIN_SPAN_MS = 1200;
const MIN_FRAC = 0.05;

export class ProgressMeter {
  private readonly t0: number;
  private frac = 0;
  private last: Reading;
  private samples: { t: number; f: number }[] = [];

  constructor(private readonly plan: StagePlan[], private readonly now: () => number = () => performance.now()) {
    this.t0 = this.now();
    this.last = { stage: plan[0]?.stage ?? 'frames', done: 0, total: 0, frac: 0, elapsedMs: 0, etaMs: null };
  }

  /** Folds one report in and returns the reading. */
  update(p: ExportProgress): Reading {
    const t = this.now();
    let before = 0, weight = 0, found = false;
    for (const s of this.plan) {
      if (s.stage === p.stage) { weight = s.weight; found = true; break; }
      before += s.weight;
    }
    let f = this.frac;
    if (found) {
      const within = p.total > 0 ? Math.max(0, Math.min(1, p.done / p.total)) : 0;
      f = Math.max(f, before + weight * within);
    }
    this.frac = Math.min(1, f);
    const sam = this.samples;
    // one sample per fraction step is enough: a long job reports thousands of times
    if (!sam.length || this.frac > sam[sam.length - 1].f) sam.push({ t, f: this.frac });
    while (sam.length > 2 && t - sam[0].t > WINDOW_MS) sam.shift();
    this.last = { stage: p.stage, done: p.done, total: p.total, frac: this.frac, elapsedMs: t - this.t0, etaMs: this.eta(t, p.stage) };
    return this.last;
  }

  /** The reading as of now: elapsed and the estimate move on while no report arrives (a slow frame). */
  read(): Reading {
    const t = this.now();
    return { ...this.last, elapsedMs: t - this.t0, etaMs: this.eta(t, this.last.stage) };
  }

  private smooth: number | null = null;
  private smoothAt = 0;

  /** No estimate before 5 percent; after it a moving average, so the figure counts down instead of swinging. */
  private eta(t: number, stage: Stage): number | null {
    const raw = this.rawEta(t, stage);
    if (raw === null || this.frac < MIN_FRAC) { this.smooth = null; return null; }
    if (this.smooth === null) this.smooth = raw;
    else {
      const run = Math.max(0, this.smooth - (t - this.smoothAt));   // the time that has passed comes off the last figure
      const a = 1 - Math.exp(-Math.max(0, t - this.smoothAt) / 4000);   // a 4 s time constant whatever the call rate
      this.smooth = run * (1 - a) + raw * a;
    }
    this.smoothAt = t;
    return this.smooth;
  }

  private rawEta(t: number, stage: Stage): number | null {
    if (stage === 'finishing' || this.frac >= 1) return null;
    const sam = this.samples;
    if (sam.length < 2) return null;
    const a = sam[0], b = sam[sam.length - 1];
    const span = b.t - a.t, gain = b.f - a.f;
    if (span < MIN_SPAN_MS || gain <= 0) return null;
    const rate = gain / span;
    // time already spent since the last report counts against the estimate
    return Math.max(0, (1 - b.f) / rate - (t - b.t));
  }
}

/** m:ss, or h:mm:ss from an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
