// Advanced Export preview: a Preview button (Stop while it renders), a preview bar of thumbnails across the
// exported time, and a preview window that shows the picture at the bar's time with wheel zoom and drag pan.
// It renders a few low-resolution frames of the chosen settings (ping pong order, background, GIF colors and
// dither, picture type) and must be rendered again after a setting changes.
import type { Movie } from '../engine/types';
import type { Renderer } from '../engine/render';
import { GifWriter, quantize } from '../export/gif';
import { drawDelivery, loadWatermark } from '../export/reframe';
import type { ExportOptions } from '../export/types';
import { el, q, setClass, setDisabled, setStyleVar, setText } from './dom';

export interface PreviewSpec {
  opts: ExportOptions;
  /** Anything that changes the output changes this text: the preview is stale when it differs from the last render. */
  key: string;
  keepAlpha: boolean;
  /** Lossy picture type round-tripped for the preview. */
  lossy: 'jpg' | 'webp' | null;
}

export interface PreviewDeps {
  movie: () => Movie | null;
  renderer: Renderer;
  /** Fires when the preview turns stale or fresh, so the dialog can note it. */
  onState?: (state: PreviewState) => void;
  /** A drag on a Fill (crop) preview moved the focus point (fractions of the movie frame). */
  onFocus?: (x: number, y: number) => void;
}

export type PreviewState = 'none' | 'stale' | 'rendering' | 'fresh';

const SAMPLES = 24;
const LONG_SIDE = 540;
const WIN_W = 960, WIN_H = 540;
const BAR_W = 960, BAR_H = 56;

function frameAt(i: number, from: number, to: number): number {
  const n = to - from;
  return i < n ? from + i : to - 2 - (i - n);
}

function yieldTurn(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

export class ExportPreview {
  readonly root = el<HTMLElement>(
    '<div class="fm-ex-prev">' +
    '<div class="fm-ex-pwin"><canvas class="fm-ex-pcanvas" width="' + WIN_W + '" height="' + WIN_H + '"></canvas><span class="fm-ex-pcap"></span></div>' +
    '<div class="fm-ex-pbarbox"><canvas class="fm-ex-pbar" width="' + BAR_W + '" height="' + BAR_H + '"></canvas><i class="fm-ex-phead"></i></div>' +
    '<div class="fm-ex-pfoot"><button class="fm-ex-pplay" type="button" aria-label="Play the preview" title="Play the preview"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path class="fm-pp-play" d="M8 5.5v13l11-6.5z"/><path class="fm-pp-stop" d="M7 7h10v10H7z" hidden/></svg></button><button class="cv-btn fm-ex-pbtn" type="button">Preview</button><span class="fm-ex-pstat cv-note"></span></div>' +
    '</div>');
  private readonly win = q<HTMLCanvasElement>(this.root, '.fm-ex-pcanvas');
  private readonly bar = q<HTMLCanvasElement>(this.root, '.fm-ex-pbar');
  private readonly head = q<HTMLElement>(this.root, '.fm-ex-phead');
  private readonly cap = q<HTMLElement>(this.root, '.fm-ex-pcap');
  private readonly btn = q<HTMLButtonElement>(this.root, '.fm-ex-pbtn');
  private readonly stat = q<HTMLElement>(this.root, '.fm-ex-pstat');
  private readonly wctx = this.win.getContext('2d') as CanvasRenderingContext2D;
  private readonly bctx = this.bar.getContext('2d') as CanvasRenderingContext2D;
  private bitmaps: ImageBitmap[] = [];
  private steps: number[] = [];
  private total = 0;
  private spec: PreviewSpec | null = null;
  private renderedKey = '';
  private token = 0;
  private current = 0;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private state: PreviewState = 'none';
  private size: [number, number] = [WIN_W, WIN_H];

  constructor(private readonly deps: PreviewDeps) {
    this.btn.addEventListener('click', () => { if (this.state === 'rendering') this.stop(); else void this.render(); });
    this.playBtn.addEventListener('click', () => this.togglePlay());
    const scrub = (e: PointerEvent): void => {
      if (!this.bitmaps.length) return;
      const r = this.bar.getBoundingClientRect();
      this.show(Math.min(this.bitmaps.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * this.bitmaps.length))));
    };
    this.bar.addEventListener('pointerdown', (e) => { this.bar.setPointerCapture(e.pointerId); scrub(e); });
    this.bar.addEventListener('pointermove', (e) => { if (this.bar.hasPointerCapture(e.pointerId)) scrub(e); });
    // zoom and pan of the window, as on the Stage
    this.win.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.win.getBoundingClientRect();
      const cx = ((e.clientX - r.left) / r.width) * WIN_W - WIN_W / 2, cy = ((e.clientY - r.top) / r.height) * WIN_H - WIN_H / 2;
      const next = Math.min(16, Math.max(1, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      const k = next / this.zoom;
      this.panX = cx - (cx - this.panX) * k;
      this.panY = cy - (cy - this.panY) * k;
      this.zoom = next;
      this.clampPan();
      this.draw();
    }, { passive: false });
    this.win.addEventListener('pointerdown', (e) => {
      if (this.zoom <= 1) {
        // Fill (crop): dragging the picture moves the crop's focus point
        if (!this.canFocus()) return;
        this.win.setPointerCapture(e.pointerId);
        this.focusing = true;
        setClass(this.win, 'is-pan', true);
        return;
      }
      this.win.setPointerCapture(e.pointerId);
      setClass(this.win, 'is-pan', true);
    });
    this.win.addEventListener('pointermove', (e) => {
      if (!this.win.hasPointerCapture(e.pointerId)) return;
      const r = this.win.getBoundingClientRect();
      if (this.focusing) { this.dragFocus((e.movementX / r.width) * WIN_W, (e.movementY / r.height) * WIN_H); return; }
      this.panX += (e.movementX / r.width) * WIN_W;
      this.panY += (e.movementY / r.height) * WIN_H;
      this.clampPan();
      this.draw();
    });
    this.win.addEventListener('pointerup', () => {
      setClass(this.win, 'is-pan', false);
      if (this.focusing) { this.focusing = false; if (this.needsRender) void this.render(); }
    });
    this.win.addEventListener('dblclick', () => { this.zoom = 1; this.panX = 0; this.panY = 0; this.draw(); });
    this.paintState();
  }

  get status(): PreviewState { return this.state; }

  private focusing = false;

  private canFocus(): boolean {
    return !!this.deps.onFocus && this.spec?.opts.fit === 'cover' && this.bitmaps.length > 0;
  }

  /** Moves the crop focus by a drag of (dx, dy) canvas px on the preview: the picture follows the pointer. */
  private dragFocus(dx: number, dy: number): void {
    const o = this.spec?.opts, m = this.deps.movie(), b = this.bitmaps[this.current];
    if (!o || !m || !b || !this.deps.onFocus) return;
    const fitScale = Math.min(WIN_W / b.width, WIN_H / b.height);
    const outPerCanvas = o.width / (b.width * fitScale);
    const k = Math.max(o.width / m.width, o.height / m.height);
    const f = o.focus ?? { x: 0.5, y: 0.5 };
    const fw = m.width * k, fh = m.height * k;
    const nx = fw > o.width ? f.x - (dx * outPerCanvas) / fw : f.x;
    const ny = fh > o.height ? f.y - (dy * outPerCanvas) / fh : f.y;
    // the old picture follows the pointer until the preview is drawn again
    if (fw > o.width) this.shiftX += dx;
    if (fh > o.height) this.shiftY += dy;
    this.draw();
    this.deps.onFocus(Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)));
  }
  private shiftX = 0;
  private shiftY = 0;

  /** The dialog reports what the settings give now: the preview turns stale when that differs from what it last drew. */
  setSpec(spec: PreviewSpec | null): void {
    this.spec = spec;
    if (this.state === 'rendering') {
      if (spec && spec.key !== this.renderedKey) { this.stop(); this.setState('stale'); }
      return;
    }
    if (!spec) return;
    if (this.state === 'none' || this.state === 'fresh' || this.state === 'stale') this.setState(this.bitmaps.length && spec.key === this.renderedKey ? 'fresh' : this.bitmaps.length ? 'stale' : 'none');
    this.scheduleRefresh();
  }

  private refreshTimer = 0;

  /** A setting changed after a preview was drawn: draw it again once the changes stop for a moment (no need to press Preview). */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    if (this.state !== 'stale' || !this.bitmaps.length) return;
    this.refreshTimer = window.setTimeout(() => {
      if (this.state === 'stale' && this.root.offsetParent !== null) void this.render();
    }, 700);
  }

  get needsRender(): boolean { return this.state === 'none' || this.state === 'stale'; }

  stop(): void {
    this.token++;
    if (this.state === 'rendering') this.setState(this.bitmaps.length && this.spec?.key === this.renderedKey ? 'fresh' : this.bitmaps.length ? 'stale' : 'none');
  }

  /** Jumps the window to a time in 0..1 of the preview. */
  seek(frac: number): void {
    if (this.bitmaps.length) this.show(Math.min(this.bitmaps.length - 1, Math.max(0, Math.round(frac * (this.bitmaps.length - 1)))));
  }

  get count(): number { return this.bitmaps.length; }

  async render(): Promise<void> {
    const spec = this.spec, movie = this.deps.movie();
    if (!spec || !movie) return;
    const my = ++this.token;
    this.setState('rendering');
    const o = spec.opts;
    const n = Math.max(1, o.to - o.from);
    const total = o.pingpong && n >= 3 ? n + (n - 2) : n;
    const count = Math.min(total, SAMPLES);
    const k = Math.min(1, LONG_SIDE / Math.max(o.width, o.height));
    const pw = Math.max(2, Math.round(o.width * k)), ph = Math.max(2, Math.round(o.height * k));
    // the preview places the frame exactly as the export will (bars, crop around the focus, or the blurred fill) and lays the watermark over it
    const dv = { width: pw, height: ph, fit: o.fit, focus: o.focus, watermark: o.watermark };
    const wm = await loadWatermark(o.watermark);
    const canvas = new OffscreenCanvas(pw, ph);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    const steps: number[] = [];
    for (let i = 0; i < count; i++) steps.push(Math.min(total - 1, Math.floor((i * total) / count)));
    const raw: ImageData[] = [];
    const out: ImageBitmap[] = [];
    const fail = (): void => { for (const b of out) b.close(); };
    try {
      for (let i = 0; i < count; i++) {
        if (my !== this.token) { fail(); return; }
        const f = frameAt(steps[i], o.from, o.to);
        await this.deps.renderer.prepareFrame(movie, f);
        drawDelivery(this.deps.renderer, ctx, movie, f, dv, spec.keepAlpha, wm);
        if (o.format === 'gif') raw.push(ctx.getImageData(0, 0, pw, ph));
        else if (spec.lossy) {
          const blob = await canvas.convertToBlob({ type: spec.lossy === 'jpg' ? 'image/jpeg' : 'image/webp', quality: { low: 0.6, medium: 0.8, high: 0.92, 'very-high': 0.98 }[o.quality] });
          out.push(await createImageBitmap(blob));
        } else out.push(await createImageBitmap(canvas));
        this.progress(i + 1, count);
        await yieldTurn();
      }
      if (o.format === 'gif') {
        const pal = quantize(raw.map((d) => d.data), Math.max(2, Math.min(256, Math.round(o.gif.colors))), o.gif.palette, o.gif.alphaThreshold);
        const writer = new GifWriter(pw, ph, true);
        writer.setOrdered(o.gif.smoothness ?? 2, o.gif.intensity ?? 50);
        for (const d of raw) {
          if (my !== this.token) { fail(); return; }
          writer.addFrame(d.data, 10, pal, o.gif.dither, o.gif.alphaThreshold);
          const px = writer.previewRgba();
          if (px) out.push(await createImageBitmap(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, pw, ph)));
          await yieldTurn();
        }
      }
    } catch {
      fail();
      if (my === this.token) this.setState(this.bitmaps.length ? 'stale' : 'none');
      return;
    }
    if (my !== this.token) { fail(); return; }
    for (const b of this.bitmaps) b.close();
    this.bitmaps = out;
    this.steps = steps;
    this.total = total;
    this.size = [pw, ph];
    this.renderedKey = spec.key;
    setClass(this.root, 'has-alpha', spec.keepAlpha);
    this.zoom = 1; this.panX = 0; this.panY = 0; this.shiftX = 0; this.shiftY = 0;
    this.current = Math.min(this.current, out.length - 1);
    this.drawBar();
    this.show(this.current);
    // a setting may have changed while the last frame was drawing
    this.setState(this.spec && this.spec.key !== spec.key ? 'stale' : 'fresh');
  }

  /** Releases the pictures (the dialog closed). */
  release(): void {
    this.token++;
    clearTimeout(this.refreshTimer);
    this.stopPlay();
    for (const b of this.bitmaps) b.close();
    this.bitmaps = [];
    this.renderedKey = '';
    this.state = 'none';
    this.paintState();
  }

  private progress(done: number, of: number): void {
    setText(this.stat, `${done} / ${of}`);
  }

  private setState(s: PreviewState): void {
    if (s === this.state) return;
    this.state = s;
    this.paintState();
    this.deps.onState?.(s);
  }

  private paintState(): void {
    const s = this.state;
    setText(this.btn, s === 'rendering' ? 'Stop' : 'Preview');
    this.btn.dataset.en = s === 'rendering' ? 'Stop' : 'Preview';
    setDisabled(this.btn, s === 'fresh');
    setClass(this.btn, 'is-stop', s === 'rendering');
    setClass(this.root, 'is-stale', s === 'stale');
    setClass(this.root, 'is-rendering', s === 'rendering');
    setClass(this.root, 'is-empty', this.bitmaps.length === 0);
    if (s !== 'rendering') setText(this.stat, s === 'fresh' ? 'Up to date' : s === 'stale' ? 'Settings changed' : 'No preview yet');
  }

  private readonly playBtn = q<HTMLButtonElement>(this.root, '.fm-ex-pplay');
  private playTimer = 0;

  /** Plays the rendered samples in a loop at about 12 a second; the square stops it. */
  private togglePlay(): void {
    if (this.playTimer) { this.stopPlay(); return; }
    if (this.bitmaps.length < 2) return;
    q(this.playBtn, '.fm-pp-play').toggleAttribute('hidden', true);
    q(this.playBtn, '.fm-pp-stop').toggleAttribute('hidden', false);
    this.playTimer = window.setInterval(() => this.show((this.current + 1) % Math.max(1, this.bitmaps.length)), 83);
  }

  private stopPlay(): void {
    clearInterval(this.playTimer);
    this.playTimer = 0;
    q(this.playBtn, '.fm-pp-play').toggleAttribute('hidden', false);
    q(this.playBtn, '.fm-pp-stop').toggleAttribute('hidden', true);
  }

  private show(i: number): void {
    this.current = i;
    const n = Math.max(1, this.bitmaps.length);
    setStyleVar(this.head, '--fm-ph', String((i + 0.5) / n));
    this.draw();
  }

  private clampPan(): void {
    const lim = (this.zoom - 1) / 2;
    this.panX = Math.max(-lim * WIN_W, Math.min(lim * WIN_W, this.panX));
    this.panY = Math.max(-lim * WIN_H, Math.min(lim * WIN_H, this.panY));
  }

  private draw(): void {
    const c = this.wctx;
    c.clearRect(0, 0, WIN_W, WIN_H);
    const b = this.bitmaps[this.current];
    if (!b) { setText(this.cap, ''); return; }
    const fit = Math.min(WIN_W / b.width, WIN_H / b.height) * this.zoom;
    const w = b.width * fit, h = b.height * fit;
    c.imageSmoothingEnabled = this.zoom < 2;
    c.drawImage(b, WIN_W / 2 - w / 2 + this.panX + this.shiftX, WIN_H / 2 - h / 2 + this.panY + this.shiftY, w, h);
    setText(this.cap, `${this.size[0]} x ${this.size[1]} · ${this.steps[this.current] + 1} / ${this.total}`);
  }

  private drawBar(): void {
    const c = this.bctx, n = this.bitmaps.length;
    c.clearRect(0, 0, BAR_W, BAR_H);
    const cw = BAR_W / n;
    for (let i = 0; i < n; i++) {
      const b = this.bitmaps[i];
      const s = Math.max(cw / b.width, BAR_H / b.height);
      c.save();
      c.beginPath();
      c.rect(i * cw, 0, cw, BAR_H);
      c.clip();
      c.drawImage(b, i * cw + (cw - b.width * s) / 2, (BAR_H - b.height * s) / 2, b.width * s, b.height * s);
      c.restore();
    }
  }
}
