import '../styles/stage-frame-ring.css';

/** G16: the movie frame on the Stage reads as a rounded card: a 12 px radius and a 1 px outline drawn on a wrapper that
 *  lies over the frame's rectangle. The picture itself and every export stay square; the four corners are only
 *  covered by the Stage colour. Built once, then patched in place (left, top, size) with the view. */
export class FrameRing {
  readonly el = document.createElement('div');
  private key = '';

  constructor(space: HTMLElement) {
    this.el.className = 'fm-frame-ring';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    space.appendChild(this.el);
  }

  /** `v` is the view in Stage space (CSS pixels); null hides the ring (preview, no movie). */
  sync(v: { ox: number; oy: number; scale: number } | null, w: number, h: number): void {
    if (!v) { if (!this.el.hidden) this.el.hidden = true; return; }
    const x = Math.round(v.ox), y = Math.round(v.oy), pw = Math.round(w * v.scale), ph = Math.round(h * v.scale);
    const key = `${x}|${y}|${pw}|${ph}`;
    if (key === this.key && !this.el.hidden) return;
    this.key = key;
    const s = this.el.style;
    s.transform = `translate(${x}px, ${y}px)`;
    s.width = `${pw}px`;
    s.height = `${ph}px`;
    if (this.el.hidden) this.el.hidden = false;
  }
}
