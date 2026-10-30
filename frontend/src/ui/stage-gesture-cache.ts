// Stage gesture cache: while the view zooms, pans or turns, the last rendered picture is moved and scaled with a
// CSS transform on the Stage canvas instead of rendering the movie again. The real render runs when the gesture
// settles, or at once when the cached picture would be too soft or too small. The transform is dropped in the same
// task as the new picture is drawn, so there is no flash at the swap.

import type { View } from '../engine/render';
import type { Movie } from '../engine/types';

const SETTLE_MS = 160;
const MAX_UP = 2;
const MAX_DOWN = 0.5;

interface Shot { movie: Movie; frame: number; view: View; w: number; h: number; preview: boolean; dpr: number }

export class GestureCache {
  private shot: Shot | null = null;
  private timer = 0;
  private applied = '';

  /** `settled` runs once the gestures stop; the Stage then renders at the final view. */
  constructor(private readonly canvas: HTMLCanvasElement, private readonly settled: () => void, private readonly onTransform?: (v: string) => void) {
    canvas.style.transformOrigin = '0 0';
  }

  /** Remember the picture just rendered at `view` (device pixels) and drop any transform. */
  store(movie: Movie, frame: number, view: View, w: number, h: number, preview: boolean, dpr: number): void {
    this.shot = { movie, frame, view: { ...view }, w, h, preview, dpr };
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.setTransform('');
  }

  /** The picture on the canvas is stale for another reason (an edit, a new frame). */
  invalidate(): void {
    this.shot = null;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.setTransform('');
  }

  /** Whether the cached picture can stand in for `view`; when so, the canvas is transformed to match. */
  reuse(movie: Movie, frame: number, view: View, w: number, h: number, preview: boolean, dpr: number): boolean {
    const s = this.shot;
    if (!s || s.movie !== movie || s.frame !== frame || s.w !== w || s.h !== h || s.preview !== preview || s.dpr !== dpr) return false;
    const a = s.view;
    if (Math.abs(view.scale - a.scale) < 1e-9 && Math.abs(view.ox - a.ox) < 1e-6 && Math.abs(view.oy - a.oy) < 1e-6) {
      this.setTransform('');
      return true;
    }
    const k = view.scale / a.scale;
    if (k > MAX_UP || k < MAX_DOWN) return false;
    const tx = (view.ox - a.ox * k) / dpr, ty = (view.oy - a.oy * k) / dpr;
    this.setTransform(`translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${k.toFixed(5)})`);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; this.settled(); }, SETTLE_MS);
    return true;
  }

  private setTransform(v: string): void {
    if (v === this.applied) return;
    this.applied = v;
    this.canvas.style.transform = v;
    this.onTransform?.(v);
  }
}
