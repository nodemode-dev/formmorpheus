// The mini flipbook preview (Phase 13): a small floating looping view of the flipbook while drawing.
// Built once; the loop only draws into its canvas. Position and on / off are remembered.
import { el, q, setHidden, setStyleVar } from './dom';
import '../styles/flip-preview.css';

export interface PreviewHost {
  /** Movie size, or null when no flipbook is open. */
  size(): { w: number; h: number } | null;
  /** Movie frames in one loop of the flipbook. */
  length(): number;
  fps(): number;
  /** Draws loop frame `local` into a context already scaled so (w, h) is the whole picture. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, local: number): void;
}

const KEY = 'formmorpheus.flipPreview';
const WIDTH = 200;

interface Saved { on: boolean; fx: number; fy: number }

function load(): Saved {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    const f = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
    return { on: r.on === true, fx: f(r.fx, 0.98), fy: f(r.fy, 0.14) };
  } catch {
    return { on: false, fx: 0.98, fy: 0.14 };
  }
}

export class FlipPreview {
  readonly root: HTMLElement;
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private saved: Saved = load();
  private raf = 0;
  private t0 = 0;
  private lastFrame = -1;
  private lastAt = 0;
  private cw = 0;
  private ch = 0;
  private shown = false;
  private readonly onToggle: Array<(on: boolean) => void> = [];

  constructor(private readonly host: PreviewHost) {
    this.root = el<HTMLElement>(
      `<div class="fm-fp" hidden role="group" aria-label="Flipbook preview"><div class="fm-fp-bar"><span class="fm-fp-title">Preview</span>` +
        `<button class="fm-fp-x" type="button" aria-label="Close preview" title="Close preview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>` +
        `<canvas class="fm-fp-cv"></canvas></div>`);
    this.cv = q<HTMLCanvasElement>(this.root, '.fm-fp-cv');
    this.ctx = this.cv.getContext('2d') as CanvasRenderingContext2D;
    q(this.root, '.fm-fp-x').addEventListener('click', () => this.set(false));
    this.wireDrag();
  }

  isOn(): boolean { return this.saved.on; }

  onChange(fn: (on: boolean) => void): void { this.onToggle.push(fn); }

  toggle(): void { this.set(!this.saved.on); }

  private set(on: boolean): void {
    if (this.saved.on === on) return;
    this.saved = { ...this.saved, on };
    this.persist();
    this.sync(this.shown);
    for (const fn of this.onToggle) fn(on);
  }

  /** `open`: the Draw & Paint view shows a flipbook right now. Starts or stops the loop and shows or hides the card. */
  sync(open: boolean): void {
    this.shown = open;
    const on = open && this.saved.on && !!this.host.size();
    setHidden(this.root, !on);
    if (on) {
      this.fitCanvas();
      this.place();
      if (!this.raf) { this.t0 = performance.now(); this.lastFrame = -1; this.raf = requestAnimationFrame((t) => this.tick(t)); }
    } else if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.root.remove();
  }

  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.saved)); } catch { /* kept for this session only */ }
  }

  private fitCanvas(): void {
    const s = this.host.size();
    if (!s) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(WIDTH * dpr), h = Math.max(1, Math.round((WIDTH * s.h * dpr) / s.w));
    // a canvas size write clears it: only when the shape changes
    if (this.cw === w && this.ch === h) return;
    this.cw = w; this.ch = h;
    this.cv.width = w;
    this.cv.height = h;
    setStyleVar(this.cv, 'aspect-ratio', `${s.w} / ${s.h}`);
    this.lastFrame = -1;
  }

  /** Position from the remembered fractions of the free room inside the parent, clamped so it always shows. */
  private place(): void {
    const par = this.root.parentElement;
    if (!par) return;
    const pw = par.clientWidth, ph = par.clientHeight;
    const rw = this.root.offsetWidth || WIDTH, rh = this.root.offsetHeight || 140;
    const x = Math.round(Math.max(0, pw - rw) * this.saved.fx);
    const y = Math.round(Math.max(0, ph - rh) * this.saved.fy);
    setStyleVar(this.root, '--fp-x', `${x}px`);
    setStyleVar(this.root, '--fp-y', `${y}px`);
  }

  private tick(now: number): void {
    this.raf = requestAnimationFrame((t) => this.tick(t));
    // the Draw & Paint view may be closed under the loop: nothing to draw then
    if (!this.root.offsetParent) return;
    const n = this.host.length();
    const s = this.host.size();
    if (!s || n <= 0) return;
    this.fitCanvas();
    const fps = Math.max(1, this.host.fps());
    const f = Math.floor(((now - this.t0) / 1000) * fps) % n;
    // a single frame still redraws a few times a second so edits show
    if (f === this.lastFrame && (n > 1 || now - this.lastAt < 150)) return;
    this.lastFrame = f;
    this.lastAt = now;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cw, this.ch);
    c.save();
    this.host.draw(c, this.cw, this.ch, f);
    c.restore();
    this.root.dataset.frame = String(f);
  }

  private wireDrag(): void {
    const bar = q(this.root, '.fm-fp-bar');
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const par = this.root.parentElement;
      if (!par) return;
      const pr = par.getBoundingClientRect();
      const r = this.root.getBoundingClientRect();
      const offX = e.clientX - r.left, offY = e.clientY - r.top;
      bar.setPointerCapture(e.pointerId);
      this.root.classList.add('is-dragging');
      const move = (m: PointerEvent): void => {
        const maxX = Math.max(1, pr.width - r.width), maxY = Math.max(1, pr.height - r.height);
        const x = Math.min(maxX, Math.max(0, m.clientX - pr.left - offX));
        const y = Math.min(maxY, Math.max(0, m.clientY - pr.top - offY));
        this.saved = { ...this.saved, fx: x / maxX, fy: y / maxY };
        setStyleVar(this.root, '--fp-x', `${Math.round(x)}px`);
        setStyleVar(this.root, '--fp-y', `${Math.round(y)}px`);
      };
      const up = (): void => {
        this.root.classList.remove('is-dragging');
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        this.persist();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    window.addEventListener('resize', () => { if (!this.root.hidden) this.place(); });
  }
}
