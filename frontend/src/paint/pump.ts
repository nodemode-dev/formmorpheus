// Spreads a stroke's stamping over animation frames. Pointer events only queue their samples; `drain`
// stamps them under a time budget, so a big wet brush at 4K (tens of milliseconds a sample) never holds
// one task for hundreds of milliseconds and the pen, the cursor and the rest of the page stay responsive.
// A stroke that keeps up is stamped inside the event that carried it, exactly as before: the output is the
// same samples through the same Stroke, only later when the machine is slow.

import type { PenSample, PixelPatch, Rect, StrokeLike } from './types';

function now(): number {
  return (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();
}

function unite(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export class PumpedStroke implements StrokeLike {
  private queue: PenSample[] = [];
  private head = 0;

  constructor(private readonly inner: StrokeLike) {}

  /** Samples waiting to be stamped. */
  get pending(): number {
    return this.queue.length - this.head;
  }

  /** Queues a sample; nothing is stamped until `drain` (predicted samples are not stamped at all). */
  add(sample: PenSample): Rect | null {
    if (!sample.predicted) this.queue.push(sample);
    return null;
  }

  /** Stamps queued samples until `budgetMs` has passed (at least one when any wait); the rectangle they changed, if any. */
  drain(budgetMs: number): Rect | null {
    const stop = now() + budgetMs;
    let rect: Rect | null = null;
    while (this.head < this.queue.length) {
      const r = this.inner.add(this.queue[this.head++]);
      if (r) rect = rect ? unite(rect, r) : r;
      if (budgetMs !== Infinity && now() >= stop) break;
    }
    if (this.head === this.queue.length) { this.queue.length = 0; this.head = 0; }
    else if (this.head > 256) { this.queue = this.queue.slice(this.head); this.head = 0; }
    return rect;
  }

  /** Everything queued is stamped first: the caller drains and marks the pixels changed before this, as the last samples are needed to end the stroke where the pen ended. */
  finish(): PixelPatch | null {
    this.drain(Infinity);
    return this.inner.finish();
  }

  cancel(): Rect | null {
    this.queue.length = 0;
    this.head = 0;
    return this.inner.cancel();
  }
}
