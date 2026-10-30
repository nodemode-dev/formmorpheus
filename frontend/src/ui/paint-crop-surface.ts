// Crop and resize in place: the Draw & Paint canvas itself becomes the crop surface. A rectangle with edge and
// corner handles over the picture, the backstage dimmed, wheel / pinch zoom and pan, a top bar (Crop / Resample,
// numeric fields, Hold to see original, Reset, Cancel, Done) and, for a Flipbook, a time bar to scrub every frame.
// The maths (limits, drag, bake) is shared with paint-crop.ts; the result is the same CropResult.
import '../styles/paint-crop-surface.css';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, clampCanvas } from '../engine/canvas';
import type { CanvasRect } from '../engine/types';
import { el, q, setClass, setHidden, setText, setValue } from './dom';
import { t } from './i18n';
import type { CropAsk, CropMode, CropResult, Interp } from './paint-crop';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface CropSurfaceAsk extends CropAsk {
  /** Flipbook: the number of movie frames to scrub, and the one open now. */
  frames?: number;
  at?: number;
  /** A flat picture of the canvas at a time (movie frames from the Flipbook's start). */
  pictureAt?: (time: number) => CanvasImageSource | null;
}

const ICON_LINK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3"/><path d="M7 4.6l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9"/><path d="M9 11.4l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9"/></svg>';
const ICON_EYE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';

const TEMPLATE = `<div class="fm-crop" hidden>
<canvas class="fm-crop-cv"></canvas>
<div class="fm-crop-top">
  <div class="fm-crop-modes" role="group"><button type="button" data-mode="crop"></button><button type="button" data-mode="resample"></button></div>
  <div class="fm-crop-fields" data-for="crop">
    <label><span>X</span><input type="number" step="1" data-f="0" aria-label="X"></label>
    <label><span>Y</span><input type="number" step="1" data-f="1" aria-label="Y"></label>
    <label><span>W</span><input type="number" step="1" min="1" data-f="2" aria-label="Width"></label>
    <label><span>H</span><input type="number" step="1" min="1" data-f="3" aria-label="Height"></label>
    <button type="button" class="fm-crop-icon" data-a="link" aria-pressed="false">${ICON_LINK}</button>
  </div>
  <div class="fm-crop-fields" data-for="resample">
    <label><span data-t="scale"></span><input type="number" min="5" max="800" step="1" value="100" data-s="scale" aria-label="Scale"></label>
    <label><span data-t="interp"></span><select data-s="interp" aria-label="Interpolation"><option value="bilinear"></option><option value="nearest"></option></select></label>
    <span class="fm-crop-quality" data-s="quality"></span>
  </div>
  <span class="fm-crop-grow"></span>
  <button type="button" class="fm-crop-icon fm-crop-hold" data-a="hold">${ICON_EYE}<span></span></button>
  <button type="button" class="fm-crop-btn" data-a="reset"></button>
  <button type="button" class="fm-crop-btn" data-a="cancel"></button>
  <button type="button" class="fm-crop-btn is-primary" data-a="done"></button>
</div>
<div class="fm-crop-info"></div>
<div class="fm-crop-time" hidden>
  <button type="button" class="fm-crop-icon" data-a="prev"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3L5 7l4 4"/></svg></button>
  <input type="range" min="0" max="0" step="1" value="0" data-s="time">
  <button type="button" class="fm-crop-icon" data-a="next"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l4 4-4 4"/></svg></button>
  <span class="fm-crop-timelabel"></span>
</div>
</div>`;

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));

export class CropSurface {
  readonly root: HTMLElement;
  private resolve: ((r: CropResult | null) => void) | null = null;
  private a: CropAsk | null = null;
  private pictureAt: ((time: number) => CanvasImageSource | null) | null = null;
  private pic: CanvasImageSource | null = null;
  private mode: CropMode = 'crop';
  private interp: Interp = 'bilinear';
  private box: CanvasRect = { x: 0, y: 0, w: 1, h: 1 };
  private pct = 100;
  private lock = false;
  private hold = false;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private k = 1;
  private ox = 0;
  private oy = 0;
  private ctr = { x: 0, y: 0, dx: 0, dy: 0 };
  private cssW = 0;
  private cssH = 0;
  private req = 0;
  private drag: { h: Handle; px: number; py: number; from: CanvasRect; pct: number } | null = null;
  private panning: { id: number; x: number; y: number; px: number; py: number } | null = null;
  private readonly fingers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number; mx: number; my: number } | null = null;
  private readonly cv: HTMLCanvasElement;
  private readonly top: HTMLElement;
  private readonly info: HTMLElement;
  private readonly timeBar: HTMLElement;
  private readonly timeIn: HTMLInputElement;
  private readonly timeLabel: HTMLElement;
  private readonly modeBtns: HTMLButtonElement[];
  private readonly cropFields: HTMLElement;
  private readonly resFields: HTMLElement;
  private readonly fields: HTMLInputElement[];
  private readonly scaleIn: HTMLInputElement;
  private readonly interpSel: HTMLSelectElement;
  private readonly quality: HTMLElement;
  private readonly linkBtn: HTMLButtonElement;
  private readonly doneBtn: HTMLButtonElement;
  private readonly keyFn = (e: KeyboardEvent): void => this.key(e);

  constructor(host: HTMLElement) {
    this.root = el<HTMLElement>(TEMPLATE);
    host.appendChild(this.root);
    const r = this.root;
    this.cv = q<HTMLCanvasElement>(r, '.fm-crop-cv');
    this.top = q(r, '.fm-crop-top');
    this.info = q(r, '.fm-crop-info');
    this.timeBar = q(r, '.fm-crop-time');
    this.timeIn = q<HTMLInputElement>(r, '[data-s="time"]');
    this.timeLabel = q(r, '.fm-crop-timelabel');
    this.modeBtns = [...r.querySelectorAll<HTMLButtonElement>('[data-mode]')];
    this.cropFields = q(r, '[data-for="crop"]');
    this.resFields = q(r, '[data-for="resample"]');
    this.fields = [...r.querySelectorAll<HTMLInputElement>('[data-f]')];
    this.scaleIn = q<HTMLInputElement>(r, '[data-s="scale"]');
    this.interpSel = q<HTMLSelectElement>(r, '[data-s="interp"]');
    this.quality = q(r, '[data-s="quality"]');
    this.linkBtn = q<HTMLButtonElement>(r, '[data-a="link"]');
    this.doneBtn = q<HTMLButtonElement>(r, '[data-a="done"]');
    // labels, set once
    this.modeBtns.forEach((b) => setText(b, t(b.dataset.mode === 'crop' ? 'Crop' : 'Resample')));
    setText(q(r, '[data-t="scale"]'), t('Scale %'));
    setText(q(r, '[data-t="interp"]'), t('Interpolation'));
    setText(q(this.interpSel, 'option[value="bilinear"]'), t('Bilinear'));
    setText(q(this.interpSel, 'option[value="nearest"]'), t('Nearest neighbor'));
    setText(q(r, '[data-a="hold"] span'), t('Hold to see original'));
    setText(q(r, '[data-a="reset"]'), t('Reset'));
    setText(q(r, '[data-a="cancel"]'), t('Cancel'));
    setText(this.doneBtn, t('Done'));
    this.linkBtn.title = t('Keep proportions') + ' (Shift)';
    this.linkBtn.setAttribute('aria-label', t('Keep proportions'));
    q(r, '[data-a="prev"]').setAttribute('title', t('Previous frame'));
    q(r, '[data-a="next"]').setAttribute('title', t('Next frame'));
    this.timeIn.title = t('Scrub the Flipbook to check every frame fits');

    this.modeBtns.forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode as CropMode; this.sync(); }));
    this.fields.forEach((f, i) => { for (const ev of ['input', 'change']) f.addEventListener(ev, () => this.fromFields(i)); });
    for (const ev of ['input', 'change']) this.scaleIn.addEventListener(ev, () => { this.pct = this.fitPct(clampInt(Number(this.scaleIn.value) || 100, 5, 800)); this.sync(false); });
    this.interpSel.addEventListener('change', () => { this.interp = this.interpSel.value as Interp; });
    this.linkBtn.addEventListener('click', () => { this.lock = !this.lock; this.sync(false); });
    const hold = q<HTMLButtonElement>(r, '[data-a="hold"]');
    const release = (): void => { if (this.hold) { this.hold = false; this.draw(); } };
    hold.addEventListener('pointerdown', () => { this.hold = true; this.draw(); });
    hold.addEventListener('pointerup', release);
    hold.addEventListener('pointerleave', release);
    hold.addEventListener('blur', release);
    q(r, '[data-a="reset"]').addEventListener('click', () => this.reset());
    q(r, '[data-a="cancel"]').addEventListener('click', () => this.finish(null));
    this.doneBtn.addEventListener('click', () => this.apply());
    this.timeIn.addEventListener('input', () => this.seek(Number(this.timeIn.value)));
    q(r, '[data-a="prev"]').addEventListener('click', () => this.seek(Number(this.timeIn.value) - 1));
    q(r, '[data-a="next"]').addEventListener('click', () => this.seek(Number(this.timeIn.value) + 1));
    this.bindCanvas();
    new ResizeObserver(() => { if (this.isOpen) this.queue(); }).observe(this.root);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  /** Enters the crop mode; resolves with the choice, or null when cancelled. */
  open(a: CropSurfaceAsk): Promise<CropResult | null> {
    this.resolve?.(null);
    this.a = a;
    this.pictureAt = a.pictureAt ?? null;
    this.pic = a.picture;
    this.mode = 'crop';
    this.interp = 'bilinear';
    this.box = { ...a.canvas };
    this.pct = 100;
    this.lock = false;
    this.hold = false;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.interpSel.value = 'bilinear';
    this.scaleIn.value = '100';
    const frames = a.flipbook && a.pictureAt ? Math.max(1, a.frames ?? 1) : 0;
    setHidden(this.timeBar, !frames);
    if (frames) {
      this.timeIn.max = String(frames - 1);
      this.timeIn.value = String(clampInt(a.at ?? 0, 0, frames - 1));
      this.timeLabel.textContent = '';
    }
    this.root.hidden = false;
    window.addEventListener('keydown', this.keyFn, true);
    this.doneBtn.focus({ preventScroll: true });
    const p = new Promise<CropResult | null>((res) => { this.resolve = res; });
    this.sync();
    if (frames) this.seek(Number(this.timeIn.value));
    return p;
  }

  private finish(r: CropResult | null): void {
    const res = this.resolve;
    this.resolve = null;
    this.root.hidden = true;
    this.a = null; this.pic = null; this.pictureAt = null;
    window.removeEventListener('keydown', this.keyFn, true);
    res?.(r);
  }

  private apply(): void {
    if (!this.a) return;
    this.finish({ mode: this.mode, rect: clampCanvas(this.target()), interp: this.interp });
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.finish(null); return; }
    if (e.key === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); this.apply(); return; }
    if (tag === 'INPUT' || tag === 'SELECT') return;
    // keep the paint tools' shortcuts from acting behind the crop surface
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
  }

  private base(): CanvasRect { return (this.a as CropAsk).canvas; }

  private reset(): void {
    this.box = { ...this.base() };
    this.pct = 100;
    this.scaleIn.value = '100';
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.sync();
  }

  private seek(v: number): void {
    const max = Number(this.timeIn.max);
    const n = clampInt(v, 0, max);
    this.timeIn.value = String(n);
    setText(this.timeLabel, `${t('Frame')} ${n + 1} / ${max + 1}`);
    if (this.pictureAt) this.pic = this.pictureAt(n);
    this.queue();
  }

  // ---- the box ----------------------------------------------------------------------------------------------

  private target(): CanvasRect {
    if (this.mode === 'crop') return this.box;
    const b = this.base(), s = this.pct / 100;
    const w = Math.max(1, Math.round(b.w * s)), h = Math.max(1, Math.round(b.h * s));
    return { x: Math.round(b.x + (b.w - w) / 2), y: Math.round(b.y + (b.h - h) / 2), w, h };
  }

  private limit(b: CanvasRect): CanvasRect {
    let { w, h } = b;
    w = Math.min(MAX_CANVAS_SIDE, w); h = Math.min(MAX_CANVAS_SIDE, h);
    if (w * h > MAX_CANVAS_AREA) { const s = Math.sqrt(MAX_CANVAS_AREA / (w * h)); w = Math.floor(w * s); h = Math.floor(h * s); }
    return { x: b.x, y: b.y, w, h };
  }

  /** The largest scale percentage that keeps the resampled canvas inside the limits. */
  private fitPct(p: number): number {
    const b = this.base();
    const max = Math.min(800, (MAX_CANVAS_SIDE / Math.max(b.w, b.h)) * 100, Math.sqrt(MAX_CANVAS_AREA / (b.w * b.h)) * 100);
    return Math.max(5, Math.min(Math.floor(max), p));
  }

  private fromFields(i: number): void {
    const v = this.fields.map((f) => Number(f.value));
    if (v.some((n) => !Number.isFinite(n))) return;
    const b = { ...this.box };
    const ratio = b.w / b.h;
    if (i === 0) b.x = Math.round(v[0]);
    else if (i === 1) b.y = Math.round(v[1]);
    else if (i === 2) { b.w = Math.max(1, Math.round(v[2])); if (this.lock) b.h = Math.max(1, Math.round(b.w / ratio)); }
    else { b.h = Math.max(1, Math.round(v[3])); if (this.lock) b.w = Math.max(1, Math.round(b.h * ratio)); }
    const lim = this.limit(b);
    const clamped = lim.w !== b.w || lim.h !== b.h;
    this.box = lim;
    // a clamped entry shows the value that is really used, and the view refits around it
    if (clamped) { this.zoom = 1; this.panX = 0; this.panY = 0; }
    this.sync(clamped);
  }

  /** Writes the controls from the state; `writeFields` is false while a field is being typed in. */
  private sync(writeFields = true): void {
    const crop = this.mode === 'crop';
    this.modeBtns.forEach((b) => setClass(b, 'is-active', (b.dataset.mode === 'crop') === crop));
    setHidden(this.cropFields, !crop);
    setHidden(this.resFields, crop);
    setClass(this.linkBtn, 'is-on', this.lock);
    this.linkBtn.setAttribute('aria-pressed', String(this.lock));
    const tg = this.target();
    if (crop && writeFields) this.fields.forEach((f, i) => setValue(f, String([tg.x, tg.y, tg.w, tg.h][i])));
    if (!crop && document.activeElement !== this.scaleIn) setValue(this.scaleIn, String(this.pct));
    const b = this.base();
    const mp = Math.round((tg.w * tg.h) / 1e5) / 10;
    // Quality: how much of the original resolution the pictures keep once scaled
    setText(this.quality, `${t('Quality')} ${Math.round(Math.min(tg.w / b.w, tg.h / b.h) * 100)}%`);
    setText(this.info, `${b.w} × ${b.h}  →  ${tg.w} × ${tg.h} px · ${mp} MP`);
    this.queue();
  }

  // ---- view -------------------------------------------------------------------------------------------------

  private extent(): CanvasRect {
    const a = this.a as CropAsk;
    const b = this.base();
    const x0 = Math.min(0, b.x), y0 = Math.min(0, b.y), x1 = Math.max(a.stage.w, b.x + b.w), y1 = Math.max(a.stage.h, b.y + b.h);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.12;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  /** Fits the extent into the area under the top bar (and above the time bar), then applies zoom and pan. */
  private layout(): void {
    const rr = this.root.getBoundingClientRect();
    this.cssW = Math.max(1, rr.width);
    this.cssH = Math.max(1, rr.height);
    const top = this.top.getBoundingClientRect().bottom - rr.top + 28;
    const bottom = this.timeBar.hidden ? 16 : rr.bottom - this.timeBar.getBoundingClientRect().top + 8;
    const aw = this.cssW - 32, ah = Math.max(40, this.cssH - top - bottom);
    const e = this.extent();
    const kb = Math.min(aw / e.w, ah / e.h);
    const cx = this.cssW / 2, cy = top + ah / 2;
    const ox0 = cx - (e.x + e.w / 2) * kb, oy0 = cy - (e.y + e.h / 2) * kb;
    this.k = kb * this.zoom;
    this.ctr = { x: cx, y: cy, dx: ox0 - cx, dy: oy0 - cy };
    this.ox = cx + (ox0 - cx) * this.zoom + this.panX;
    this.oy = cy + (oy0 - cy) * this.zoom + this.panY;
  }

  private zoomAt(px: number, py: number, z: number): void {
    const nz = Math.min(32, Math.max(0.25, z));
    const f = nz / this.zoom;
    // keep the point under (px, py) fixed: solve the pan against the layout's zoom-about-centre
    const c = this.ctr;
    const nx = px - (px - this.ox) * f, ny = py - (py - this.oy) * f;
    this.panX = nx - c.x - c.dx * nz; this.panY = ny - c.y - c.dy * nz;
    this.zoom = nz;
    this.queue();
  }

  private queue(): void {
    if (this.req) return;
    this.req = requestAnimationFrame(() => { this.req = 0; this.draw(); });
  }

  private draw(): void {
    const a = this.a;
    if (!a || !this.isOpen) return;
    this.layout();
    const w = this.cssW, h = this.cssH;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    // a canvas resize clears it: only when the size really changes
    if (this.cv.width !== pw || this.cv.height !== ph) { this.cv.width = pw; this.cv.height = ph; }
    const g = this.cv.getContext('2d') as CanvasRenderingContext2D;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = getComputedStyle(this.root).getPropertyValue('--fm-paint-backdrop') || '#1b1b1d';
    g.fillRect(0, 0, w, h);
    const { k, ox, oy } = this;
    const R = (r: CanvasRect): [number, number, number, number] => [ox + r.x * k, oy + r.y * k, r.w * k, r.h * k];
    const old = this.base();
    const now = this.hold ? old : this.target();
    const stage = R({ x: 0, y: 0, w: a.stage.w, h: a.stage.h });
    g.fillStyle = a.stage.transparent ? '#3a3a3e' : a.stage.background;
    g.fillRect(...stage);
    if (this.pic) {
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.pic, ...R(this.mode === 'resample' && !this.hold ? now : old));
    }
    if (!this.hold) {
      // everything outside the new edges will be cleared: dim it
      g.beginPath();
      g.rect(0, 0, w, h);
      g.rect(...R(now));
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fill('evenodd');
    }
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.strokeRect(...stage);
    g.setLineDash([]);
    g.strokeStyle = '#e8c53a';
    g.strokeRect(...R(old));
    if (this.mode === 'resample' && !this.hold && (this.box.x !== old.x || this.box.y !== old.y || this.box.w !== old.w || this.box.h !== old.h)) {
      // the Crop rectangle set before switching stays visible, and is kept for switching back
      g.setLineDash([6, 4]);
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeRect(...R(this.box));
      g.lineDashOffset = 5;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeRect(...R(this.box));
      g.lineDashOffset = 0;
      g.setLineDash([]);
    }
    const [bx, by, bw, bh] = R(now);
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    g.strokeRect(bx, by, bw, bh);
    if (!this.hold) {
      if (bw > 60 && bh > 60) {
        // thirds, so a crop can be judged
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(255,255,255,0.28)';
        g.beginPath();
        for (let i = 1; i < 3; i++) { g.moveTo(bx + (bw * i) / 3, by); g.lineTo(bx + (bw * i) / 3, by + bh); g.moveTo(bx, by + (bh * i) / 3); g.lineTo(bx + bw, by + (bh * i) / 3); }
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1;
      for (const hd of HANDLES) { const p = this.handlePt(hd, bx, by, bw, bh); g.fillRect(p[0] - 5, p[1] - 5, 10, 10); g.strokeRect(p[0] - 5.5, p[1] - 5.5, 11, 11); }
    }
  }

  private handlePt(h: Handle, x: number, y: number, w: number, hh: number): [number, number] {
    const cx = h.includes('w') ? x : h.includes('e') ? x + w : x + w / 2;
    const cy = h.includes('n') ? y : h.includes('s') ? y + hh : y + hh / 2;
    return [cx, cy];
  }

  private hit(px: number, py: number, touch: boolean): Handle | null {
    const b = this.target();
    const x = this.ox + b.x * this.k, y = this.oy + b.y * this.k, w = b.w * this.k, h = b.h * this.k;
    const tol = touch ? 18 : 10;
    for (const hd of HANDLES) {
      const p = this.handlePt(hd, x, y, w, h);
      if (Math.abs(px - p[0]) <= tol && Math.abs(py - p[1]) <= tol) return hd;
    }
    if (this.mode !== 'crop') return null;
    return px >= x && px <= x + w && py >= y && py <= y + h ? 'move' : null;
  }

  // ---- pointer ----------------------------------------------------------------------------------------------

  private bindCanvas(): void {
    const cv = this.cv;
    const local = (e: PointerEvent | WheelEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = local(e);
      this.zoomAt(px, py, this.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => { if (e.altKey) { this.zoom = 1; this.panX = 0; this.panY = 0; this.queue(); } });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      const [px, py] = local(e);
      cv.setPointerCapture(e.pointerId);
      const touch = e.pointerType === 'touch';
      if (touch) {
        this.fingers.set(e.pointerId, { x: px, y: py });
        if (this.fingers.size === 2) {
          this.drag = null;
          const [p, q2] = [...this.fingers.values()];
          this.pinch = { d: Math.hypot(p.x - q2.x, p.y - q2.y) || 1, zoom: this.zoom, mx: (p.x + q2.x) / 2, my: (p.y + q2.y) / 2 };
          return;
        }
      }
      e.preventDefault();
      const h = e.button === 1 || e.button === 2 || e.altKey ? null : this.hit(px, py, touch);
      if (!h) { this.panning = { id: e.pointerId, x: px, y: py, px: this.panX, py: this.panY }; return; }
      this.drag = { h, px, py, from: { ...this.box }, pct: this.pct };
    });
    cv.addEventListener('pointermove', (e) => {
      const [px, py] = local(e);
      if (this.fingers.has(e.pointerId)) {
        this.fingers.set(e.pointerId, { x: px, y: py });
        if (this.pinch && this.fingers.size >= 2) {
          const [p, q2] = [...this.fingers.values()];
          const d = Math.hypot(p.x - q2.x, p.y - q2.y) || 1;
          const mx = (p.x + q2.x) / 2, my = (p.y + q2.y) / 2;
          this.ox += mx - this.pinch.mx; this.oy += my - this.pinch.my;
          this.pinch.mx = mx; this.pinch.my = my;
          this.zoomAt(mx, my, this.pinch.zoom * (d / this.pinch.d));
          return;
        }
      }
      if (this.panning && this.panning.id === e.pointerId) {
        this.panX = this.panning.px + (px - this.panning.x);
        this.panY = this.panning.py + (py - this.panning.y);
        this.queue();
        return;
      }
      if (!this.drag) {
        const h = this.hit(px, py, false);
        cv.style.cursor = !h ? '' : h === 'move' ? 'move' : `${h === 'n' || h === 's' ? 'ns' : h === 'e' || h === 'w' ? 'ew' : h === 'nw' || h === 'se' ? 'nwse' : 'nesw'}-resize`;
        return;
      }
      const d = this.drag;
      if (this.mode === 'resample') {
        // handles scale the canvas uniformly about its centre
        const b = this.base();
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const wx = (px - this.ox) / this.k, wy = (py - this.oy) / this.k;
        const sx = (Math.abs(wx - cx) * 2) / b.w, sy = (Math.abs(wy - cy) * 2) / b.h;
        const s = d.h.length === 2 ? Math.max(sx, sy) : d.h === 'e' || d.h === 'w' ? sx : sy;
        this.pct = this.fitPct(clampInt(s * 100, 5, 800));
      } else {
        const lock = this.lock || e.shiftKey;
        this.box = this.limit(this.dragged(d.h, d.from, Math.round((px - d.px) / this.k), Math.round((py - d.py) / this.k), lock));
      }
      this.sync();
    });
    const end = (e: PointerEvent): void => {
      this.fingers.delete(e.pointerId);
      if (this.fingers.size < 2) this.pinch = null;
      if (this.panning?.id === e.pointerId) this.panning = null;
      this.drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  private dragged(h: Handle, f: CanvasRect, dx: number, dy: number, lock: boolean): CanvasRect {
    if (h === 'move') return { ...f, x: f.x + dx, y: f.y + dy };
    let l = f.x, r = f.x + f.w, tp = f.y, bt = f.y + f.h;
    if (h.includes('w')) l = Math.min(l + dx, r - 1);
    if (h.includes('e')) r = Math.max(r + dx, l + 1);
    if (h.includes('n')) tp = Math.min(tp + dy, bt - 1);
    if (h.includes('s')) bt = Math.max(bt + dy, tp + 1);
    let w = r - l, hh = bt - tp;
    if (lock) {
      const ratio = f.w / f.h;
      const horiz = h.includes('w') || h.includes('e');
      const vert = h.includes('n') || h.includes('s');
      // a corner follows whichever side moved more; an edge drives the other side
      if (horiz && vert) { if (Math.abs(w - f.w) / f.w >= Math.abs(hh - f.h) / f.h) hh = Math.max(1, Math.round(w / ratio)); else w = Math.max(1, Math.round(hh * ratio)); }
      else if (horiz) hh = Math.max(1, Math.round(w / ratio));
      else w = Math.max(1, Math.round(hh * ratio));
      if (h.includes('w')) l = r - w;
      if (h.includes('n')) tp = bt - hh;
      if (!horiz) l = f.x + Math.round((f.w - w) / 2);
      if (!vert) tp = f.y + Math.round((f.h - hh) / 2);
    }
    return { x: l, y: tp, w, h: hh };
  }
}
