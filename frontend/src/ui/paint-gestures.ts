// Gesture helpers for Draw & Paint: hold to repeat, the one-pointer canvas spin
// (Shift + drag with the space hand) and the rotation reset. Maths in paint/viewmath.

import type { ViewXform } from '../paint/viewmath';
import { anchorOffset, screenToCanvas, snapRotation, wrapAngle } from '../paint/viewmath';

/** Fires at once, then keeps firing while it is held: undo, redo and nudge buttons, the two-finger hold. */
export class HoldRepeat {
  private wait = 0;
  private tick = 0;

  constructor(public delay = 420, private readonly every = 90) {}

  get running(): boolean { return this.wait !== 0 || this.tick !== 0; }

  start(fn: () => void, fireNow = true): void {
    this.stop();
    if (fireNow) fn();
    this.wait = window.setTimeout(() => {
      this.wait = 0;
      this.tick = window.setInterval(fn, this.every);
    }, this.delay);
  }

  stop(): void {
    if (this.wait) clearTimeout(this.wait);
    if (this.tick) clearInterval(this.tick);
    this.wait = 0;
    this.tick = 0;
  }

  /** Wire a button: press fires and repeats; a keyboard activation fires once. */
  bind(btn: HTMLElement, fn: () => void): void {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (btn as HTMLButtonElement).disabled) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      this.start(fn);
    });
    const end = (): void => this.stop();
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    btn.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
  }
}

/** Turn the canvas around its middle with one pointer. */
export class SpinDrag {
  private s: { rot0: number; ang0: number; cx: number; cy: number; ax: number; ay: number; id: number } | null = null;

  get active(): boolean { return this.s !== null; }
  get pointer(): number { return this.s?.id ?? -1; }

  begin(v: ViewXform, id: number, clientX: number, clientY: number, box: DOMRect): void {
    const cx = box.width / 2, cy = box.height / 2;
    const a = screenToCanvas(v, cx, cy);
    this.s = { rot0: v.rot, ang0: Math.atan2(clientY - box.top - cy, clientX - box.left - cx), cx, cy, ax: a.x, ay: a.y, id };
  }

  /** Updates `v` in place. */
  move(v: ViewXform, clientX: number, clientY: number, box: DOMRect): void {
    const s = this.s;
    if (!s) return;
    const ang = Math.atan2(clientY - box.top - s.cy, clientX - box.left - s.cx);
    v.rot = snapRotation(s.rot0 + wrapAngle(ang - s.ang0));
    const o = anchorOffset(v.scale, v.rot, { x: s.ax, y: s.ay }, { x: s.cx, y: s.cy });
    v.ox = o.x;
    v.oy = o.y;
  }

  end(): void { this.s = null; }
}

/** Upright again, keeping what is at the middle of the canvas element where it is. */
export function resetRotation(v: ViewXform, box: { width: number; height: number }): void {
  const cx = box.width / 2, cy = box.height / 2;
  const a = screenToCanvas(v, cx, cy);
  v.rot = 0;
  const o = anchorOffset(v.scale, 0, a, { x: cx, y: cy });
  v.ox = o.x;
  v.oy = o.y;
}
