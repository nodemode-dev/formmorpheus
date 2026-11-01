// The Stage surround (FV-233): a faint 20 px grid on the area outside the frame and a soft glow around the frame,
// so the backstage reads as a place. Two elements built once under the box; each draw patches their position.
import type { View } from '../engine/render';
import { el } from './dom';

export class Surround {
  private readonly grid = el('<div class="fm-surround-grid" aria-hidden="true" hidden></div>');
  private readonly glow = el('<div class="fm-surround-glow" aria-hidden="true" hidden></div>');
  private key = '';

  constructor(space: HTMLElement, before: Element) {
    space.insertBefore(this.grid, before);
    space.insertBefore(this.glow, before);
  }

  /** Place both around the movie frame; `on` is false in the full-screen preview. */
  sync(view: View | null, movieW: number, movieH: number, on: boolean): void {
    const show = on && !!view;
    if (!show) {
      if (!this.grid.hidden) { this.grid.hidden = true; this.glow.hidden = true; this.key = ''; }
      return;
    }
    const v = view as View;
    const x = Math.round(v.ox), y = Math.round(v.oy), w = Math.round(movieW * v.scale), h = Math.round(movieH * v.scale);
    const key = `${x},${y},${w},${h}`;
    if (key === this.key && !this.grid.hidden) return;
    this.key = key;
    this.grid.hidden = false;
    this.glow.hidden = false;
    // the grid covers everything but the frame (even-odd cut-out)
    this.grid.style.clipPath = `polygon(evenodd, -50000px -50000px, 50000px -50000px, 50000px 50000px, -50000px 50000px, -50000px -50000px, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
    this.grid.style.backgroundPosition = `${x % 20}px ${y % 20}px`;
    const s = this.glow.style;
    s.left = `${x}px`; s.top = `${y}px`; s.width = `${w}px`; s.height = `${h}px`;
  }
}
