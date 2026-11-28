import { drawEffect, type FxBox } from '../engine/scene-fx';
import { reducedMotion } from './a11y';

const STILL_T = 2.35;
const STEP_MS = 33;

type C2 = CanvasRenderingContext2D;

const backdrops = new Map<string, HTMLCanvasElement>();

function backdrop(w: number, h: number): HTMLCanvasElement {
  const key = `${w}x${h}`;
  const had = backdrops.get(key);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as C2;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, '#7fb2e0');
  sky.addColorStop(1, '#d7e8f2');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#9cc0a4';
  g.beginPath();
  g.moveTo(0, h * 0.62);
  g.quadraticCurveTo(w * 0.22, h * 0.42, w * 0.48, h * 0.6);
  g.quadraticCurveTo(w * 0.72, h * 0.46, w, h * 0.58);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
  g.fillStyle = '#6fa06f';
  g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillStyle = '#5a8a5c';
  g.fillRect(0, h * 0.72, w, h * 0.02);
  g.fillStyle = '#7a5a44';
  g.fillRect(w * 0.12, h * 0.5, w * 0.025, h * 0.23);
  g.fillStyle = '#4f8a58';
  g.beginPath();
  g.arc(w * 0.1325, h * 0.47, h * 0.11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e9dcc4';
  g.fillRect(w * 0.7, h * 0.52, w * 0.16, h * 0.21);
  g.fillStyle = '#b5534a';
  g.beginPath();
  g.moveTo(w * 0.685, h * 0.53);
  g.lineTo(w * 0.78, h * 0.4);
  g.lineTo(w * 0.875, h * 0.53);
  g.fill();
  g.fillStyle = '#5b6b80';
  g.fillRect(w * 0.765, h * 0.62, w * 0.03, h * 0.11);
  g.fillStyle = '#3f4a5c';
  g.beginPath();
  g.arc(w * 0.5, h * 0.5, h * 0.05, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(w * 0.5 - h * 0.06, h * 0.74);
  g.quadraticCurveTo(w * 0.5 - h * 0.06, h * 0.57, w * 0.5, h * 0.57);
  g.quadraticCurveTo(w * 0.5 + h * 0.06, h * 0.57, w * 0.5 + h * 0.06, h * 0.74);
  g.fill();
  backdrops.set(key, c);
  return c;
}

/** One frame of an effect over the little scene, at `t` seconds. */
export function paintPreview(canvas: HTMLCanvasElement, kind: string, seed: number, t: number, amount = 0.75): void {
  const g = canvas.getContext('2d') as C2 | null;
  if (!g) return;
  const w = canvas.width, h = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'copy';
  g.drawImage(backdrop(w, h), 0, 0);
  g.globalCompositeOperation = 'source-over';
  const box: FxBox = { x: 0, y: 0, w, h };
  drawEffect(g, kind, box, t, amount, seed);
}

interface Item { canvas: HTMLCanvasElement; kind: string; seed: number; seen: boolean }

/** The Effects tab's moving tiles: only tiles on screen move, at about 30 frames a second, and only while motion is welcome. */
export class FxPreviews {
  private readonly items: Item[] = [];
  private readonly io: IntersectionObserver;
  private raf = 0;
  private last = 0;
  private readonly t0 = performance.now();
  private still = reducedMotion();

  constructor() {
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const it = this.items.find((x) => x.canvas === e.target);
        if (!it) continue;
        it.seen = e.isIntersecting;
        if (it.seen) this.paint(it, this.now());
      }
      this.kick();
    });
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
        this.still = reducedMotion();
        for (const it of this.items) if (it.seen) this.paint(it, this.now());
        this.kick();
      });
    }
  }

  add(canvas: HTMLCanvasElement, kind: string, seed: number): void {
    const it: Item = { canvas, kind, seed, seen: false };
    this.items.push(it);
    paintPreview(canvas, kind, seed, STILL_T);
    this.io.observe(canvas);
  }

  private now(): number {
    return this.still ? STILL_T : STILL_T + (performance.now() - this.t0) / 1000;
  }

  private paint(it: Item, t: number): void {
    paintPreview(it.canvas, it.kind, it.seed, t);
  }

  private kick(): void {
    const want = !this.still && this.items.some((x) => x.seen);
    if (want && !this.raf) this.raf = requestAnimationFrame((ms) => this.tick(ms));
    else if (!want && this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  private tick(ms: number): void {
    this.raf = 0;
    if (this.still) return;
    if (ms - this.last >= STEP_MS) {
      this.last = ms;
      const t = this.now();
      let any = false;
      for (const it of this.items) if (it.seen) { this.paint(it, t); any = true; }
      if (!any) return;
    }
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }
}
