// Stage fringe: a low-resolution picture of the area around the visible Stage (one viewport beyond each side), kept
// under the Stage canvas. While a pan or zoom moves the canvas with a transform (stage-gesture-cache.ts), the strip the
// canvas no longer covers shows this picture instead of a blank edge. It is drawn only while the person is idle, never
// during a gesture, so it costs the gesture nothing; the real render at the settle covers it again.

const SCALE = 0.25;
const IDLE_MS = 350;

export class Fringe {
  private readonly cv = document.createElement('canvas');
  private pending = 0;
  private timer = 0;
  private valid = false;
  private lastInput = 0;
  private down = false;

  private draw: ((ctx: CanvasRenderingContext2D, cw: number, ch: number, k: number) => boolean) | null = null;

  constructor(space: HTMLElement, private readonly main: HTMLCanvasElement) {
    this.cv.className = 'fm-stage-fringe';
    this.cv.setAttribute('aria-hidden', 'true');
    this.cv.style.cssText = 'position:absolute;pointer-events:none;display:none;image-rendering:auto;';
    space.insertBefore(this.cv, main);
    const mark = (): void => { this.lastInput = performance.now(); };
    for (const t of ['pointermove', 'wheel', 'keydown']) window.addEventListener(t, mark, { capture: true, passive: true });
    window.addEventListener('pointerdown', () => { this.down = true; mark(); }, { capture: true, passive: true });
    for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => { this.down = false; mark(); }, { capture: true, passive: true });
  }

  /** The canvas was just drawn afresh: the fringe is stale until it is drawn again (when idle). `draw` renders the area
   *  around the Stage as it is now into the given canvas size at scale k, and returns false when the picture was not complete. */
  queue(draw: (ctx: CanvasRenderingContext2D, cw: number, ch: number, k: number) => boolean): void {
    this.draw = draw;
    this.valid = false;
    this.cv.style.display = 'none';
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; this.turn(); }, IDLE_MS);
  }

  private turn(): void {
    if (this.down || performance.now() - this.lastInput < IDLE_MS) { this.timer = window.setTimeout(() => { this.timer = 0; this.turn(); }, IDLE_MS); return; }
    if (this.pending) return;
    const run = (d?: IdleDeadline): void => {
      this.pending = 0;
      if (this.down || performance.now() - this.lastInput < IDLE_MS) { this.queueAgain(); return; }
      if (d && !d.didTimeout && d.timeRemaining() < 8) { this.queueAgain(); return; }
      this.build();
    };
    this.pending = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 1500 }) : window.setTimeout(run, 50);
  }

  private queueAgain(): void {
    if (!this.timer) this.timer = window.setTimeout(() => { this.timer = 0; this.turn(); }, IDLE_MS);
  }

  private build(): void {
    const w = this.main.width, h = this.main.height;
    const cw = Math.max(1, Math.round(3 * w * SCALE)), ch = Math.max(1, Math.round(3 * h * SCALE));
    if (this.cv.width !== cw) this.cv.width = cw;
    if (this.cv.height !== ch) this.cv.height = ch;
    const ctx = this.cv.getContext('2d');
    if (!ctx) return;
    this.valid = this.draw ? this.draw(ctx, cw, ch, SCALE) : false;
  }

  /** Mirrors the main canvas's transform (same origin: the main canvas's top left) so the fringe moves with it. */
  follow(transform: string, cssW: number, cssH: number): void {
    const s = this.cv.style;
    if (!transform || !this.valid) { if (s.display !== 'none') s.display = 'none'; return; }
    s.left = `${-cssW}px`; s.top = `${-cssH}px`; s.width = `${3 * cssW}px`; s.height = `${3 * cssH}px`;
    s.transformOrigin = `${cssW}px ${cssH}px`;
    s.transform = transform;
    s.display = 'block';
  }
}
