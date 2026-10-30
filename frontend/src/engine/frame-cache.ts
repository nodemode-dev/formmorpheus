import type { Renderer } from './render';
import type { Movie } from './types';

type DrawOpts = Parameters<Renderer['drawFrame']>[4];
type View = Parameters<Renderer['drawFrame']>[3];

/** What a cached frame was drawn from: the movie object (every edit makes a new one), the view and the draw options. */
export interface FrameJob {
  movie: Movie;
  view: View;
  opts: DrawOpts;
  /** The view size, background and mode flags as one string: any change drops the cache. */
  sig: string;
  /** First and last frame playback runs between (the look-ahead wraps inside it). */
  lo: number;
  last: number;
}

const DEFAULT_CAP = 384 * 1024 * 1024;
const IDLE_MS = 1500;

/** Last pointer, wheel, key or touch input and whether a button or finger is down; the idle fill reads it. */
const inputState = { last: 0, down: false };
if (typeof window !== 'undefined') {
  const touch = (): void => { inputState.last = performance.now(); };
  for (const t of ['pointermove', 'wheel', 'keydown', 'touchstart', 'touchmove']) window.addEventListener(t, touch, { capture: true, passive: true });
  window.addEventListener('pointerdown', () => { inputState.down = true; touch(); }, { capture: true, passive: true });
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => { inputState.down = false; touch(); }, { capture: true, passive: true });
  window.addEventListener('blur', () => { inputState.down = false; });
}

/**
 * Finished Stage frames as ImageBitmaps, bounded by a byte cap and dropped when the movie object or the view changes.
 * It fills in two ways: frames drawn live are copied in, and idle time renders the frames ahead of the Playhead.
 * Frames that were not complete (a picture still decoding, a video block) are never kept, so a hit always equals a fresh draw.
 * Playback stays clock-driven: this only makes drawing a frame cheap, it never decides which frame shows.
 */
export class FrameStore {
  private owner: Movie | null = null;
  private sig = '';
  private readonly frames = new Map<number, ImageBitmap>();
  /** Frames that came out incomplete, and when; tried again after a while (a picture may have finished decoding). */
  private readonly bad = new Map<number, number>();
  private isBad(f: number): boolean {
    const t = this.bad.get(f);
    if (t === undefined) return false;
    if (performance.now() - t > 1500) { this.bad.delete(f); return false; }
    return true;
  }
  private bytes = 0;
  private off: OffscreenCanvas | null = null;
  private timer = 0;
  private job: FrameJob | null = null;
  private head = 0;
  private playing = false;
  private lastCost = 0;
  private gen = 0;

  /** `surface`: gives a hidden canvas of the given size (the Stage supplies a real canvas element, so look-ahead frames match live ones pixel for pixel). */
  constructor(private readonly renderer: Renderer, private readonly surface?: (w: number, h: number) => { width: number; height: number; getContext(k: '2d'): unknown }, private readonly capBytes = DEFAULT_CAP) {}

  /** Number of frames held and their bytes (diagnostics). */
  get size(): { frames: number; bytes: number } {
    return { frames: this.frames.size, bytes: this.bytes };
  }

  /** Debug switch: localStorage `fm-no-frame-cache` set to 1 turns the cache off. */
  private readonly disabled = (() => { try { return localStorage.getItem('fm-no-frame-cache') === '1'; } catch { return false; } })();

  /** Points the cache at a job; a different movie object or signature empties it. */
  retarget(job: FrameJob): void {
    if (this.disabled) return;
    if (job.movie !== this.owner || job.sig !== this.sig) {
      this.clear();
      this.owner = job.movie;
      this.sig = job.sig;
    }
    this.job = job;
  }

  clear(): void {
    this.gen++;
    for (const b of this.frames.values()) b.close();
    this.frames.clear();
    this.bad.clear();
    this.bytes = 0;
  }

  /** Draws the cached frame onto `ctx` at 1:1; false when it is not held. */
  blit(ctx: CanvasRenderingContext2D, frame: number): boolean {
    const b = this.frames.get(frame);
    if (!b) return false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(b, 0, 0);
    ctx.restore();
    return true;
  }

  /** Keeps a copy of the frame just drawn on `canvas`, when the draw was complete. Call before anything else is drawn over it. */
  capture(canvas: HTMLCanvasElement, frame: number, complete: boolean): void {
    if (!complete) { this.bad.set(frame, performance.now()); return; }
    if (this.frames.has(frame) || this.room(frame) === false) return;
    // paused, a copy of a big canvas per gesture step would cost more than the step; the idle fill takes the frame later
    if (!this.playing && (inputState.down || performance.now() - inputState.last < 400)) return;
    // while playing, a copy that is not nearly free would only delay the next frame
    if (this.playing && this.copyMs > 6) return;
    const t0 = performance.now();
    // copied through our own surface at once: a lazy snapshot of the visible canvas could pick up the Stage outline drawn right after
    const w = canvas.width, h = canvas.height;
    if (!this.off) this.off = new OffscreenCanvas(w, h);
    if (this.off.width !== w || this.off.height !== h) { this.off.width = w; this.off.height = h; }
    const c = this.off.getContext('2d') as OffscreenCanvasRenderingContext2D;
    c.globalCompositeOperation = 'copy';
    c.drawImage(canvas, 0, 0);
    c.globalCompositeOperation = 'source-over';
    this.put(frame, this.off.transferToImageBitmap());
    this.copyMs = this.copyMs * 0.7 + (performance.now() - t0) * 0.3;
  }

  private copyMs = 0;

  private put(frame: number, b: ImageBitmap): void {
    this.frames.set(frame, b);
    this.bytes += b.width * b.height * 4;
  }

  /** Whether one more frame fits; frames furthest ahead of the Playhead in loop order (the ones just behind it) go first. */
  private room(frame: number): boolean {
    const j = this.job;
    if (!j) return false;
    const per = Math.max(1, Math.round(j.view.width) * Math.round(j.view.height) * 4);
    if (this.bytes + per <= this.capBytes) return true;
    const span = Math.max(1, j.last - j.lo + 1);
    const dist = (f: number): number => (((f - this.head) % span) + span) % span;
    const mine = dist(frame);
    let worst = -1, at = -1;
    for (const f of this.frames.keys()) { const d = dist(f); if (d > worst) { worst = d; at = f; } }
    if (at < 0 || worst <= mine) return false;
    const b = this.frames.get(at) as ImageBitmap;
    this.bytes -= b.width * b.height * 4;
    b.close();
    this.frames.delete(at);
    return this.bytes + per <= this.capBytes;
  }

  /**
   * Tells the store where the Playhead is. Paused, it renders the frames ahead one per turn; playing, it does so only
   * while draws are cheap (cache hits), so a heavy frame is never made later by look-ahead work.
   */
  note(head: number, playing: boolean, cheap: boolean): void {
    this.head = head;
    this.playing = playing;
    // a look-ahead frame that costs more than a fraction of a frame time would make the next live frame late
    if (playing && (!cheap || this.lastCost > 14)) return;
    this.wake(playing ? 0 : 40);
  }

  private wake(ms: number): void {
    if (this.timer) return;
    this.timer = window.setTimeout(() => { this.timer = 0; this.turn(); }, ms);
  }

  /** Paused fills wait for 1.5 s without input, then run one frame per idle callback with room left in it. */
  private turn(): void {
    if (this.playing) { if (!inputState.down) this.step(); return; }
    const wait = IDLE_MS - (performance.now() - inputState.last);
    if (inputState.down || wait > 0) { this.wake(inputState.down ? 300 : Math.ceil(wait)); return; }
    const run = (d?: IdleDeadline): void => {
      this.idleId = 0;
      if (inputState.down || performance.now() - inputState.last < IDLE_MS) { this.wake(300); return; }
      if (d && !d.didTimeout && d.timeRemaining() < 6) { this.wake(100); return; }
      this.step();
    };
    if (typeof requestIdleCallback === 'function') { if (!this.idleId) this.idleId = requestIdleCallback(run, { timeout: 1000 }); }
    else run();
  }

  private idleId = 0;

  private step(): void {
    const j = this.job;
    if (!j || (this.playing && this.lastCost > 14)) return;
    const span = j.last - j.lo + 1;
    if (span <= 0) return;
    let f = -1;
    for (let i = this.playing ? 1 : 0; i < span; i++) {
      const c = j.lo + ((((this.head - j.lo + i) % span) + span) % span);
      if (!this.frames.has(c) && !this.isBad(c)) { f = c; break; }
    }
    if (f < 0) return;
    if (!this.room(f)) return;
    const w = Math.max(1, Math.round(j.view.width)), h = Math.max(1, Math.round(j.view.height));
    // drawn on a surface of the Stage canvas's own kind: an OffscreenCanvas anti-aliases clip edges differently
    const s = this.surface ? this.surface(w, h) : null;
    if (!this.off) this.off = new OffscreenCanvas(w, h);
    if (this.off.width !== w || this.off.height !== h) { this.off.width = w; this.off.height = h; }
    const t0 = performance.now();
    const gen = this.gen;
    const sc = (s ? s.getContext('2d') : this.off.getContext('2d')) as CanvasRenderingContext2D;
    this.renderer.drawFrame(sc, j.movie, f, j.view, j.opts);
    const ok = this.renderer.takeComplete();
    if (gen === this.gen) {
      if (!ok) this.bad.set(f, performance.now());
      else {
        if (s) {
          const c = this.off.getContext('2d') as OffscreenCanvasRenderingContext2D;
          c.globalCompositeOperation = 'copy';
          c.drawImage(s as unknown as CanvasImageSource, 0, 0);
          c.globalCompositeOperation = 'source-over';
        }
        this.put(f, this.off.transferToImageBitmap());
      }
    }
    this.lastCost = performance.now() - t0;
    // breathe for about as long as the frame took (up to 120 ms) so input and live draws stay responsive
    if (this.playing && this.lastCost > 14) return;
    this.wake(this.playing ? 0 : Math.min(120, Math.max(8, Math.round(this.lastCost))));
  }
}
