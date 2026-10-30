import { api } from '../io/api';
import { PREVIEW_CELLS } from './preview-strip';

/** Hover (or keyboard focus) on a movie in the Theater plays its saved strip over the poster: a canvas lays over the
 *  thumbnail, steps through the strip's pictures, and hides again when the pointer leaves. The canvas is made once
 *  per thumbnail the first time it is needed; stepping only draws into it. */
interface Strip { bitmap: ImageBitmap; cw: number; ch: number }

const STEP_MS = 140;

export class TheaterPreview {
  private readonly strips = new Map<string, Strip | null>();
  private readonly loading = new Set<string>();
  private row: HTMLElement | null = null;
  private timer = 0;
  private cell = 0;

  constructor(items: HTMLElement) {
    items.addEventListener('pointerover', (e) => { if ((e as PointerEvent).pointerType !== 'touch') this.enter(rowOf(e.target)); });
    items.addEventListener('pointerout', (e) => {
      const to = (e as PointerEvent).relatedTarget as Node | null;
      if (this.row && !(to && this.row.contains(to))) this.leave();
    });
    items.addEventListener('focusin', (e) => this.enter(rowOf(e.target)));
    items.addEventListener('focusout', () => this.leave());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.leave(); });
  }

  private enter(row: HTMLElement | null): void {
    if (!row || row === this.row || document.body.classList.contains('animations-disabled')) return;
    const key = row.dataset.key ?? '';
    if (!key.startsWith('lib:')) return;
    this.leave();
    this.row = row;
    const name = key.slice(4), ck = `${name}|${row.dataset.thumb ?? ''}`;
    const have = this.strips.get(ck);
    if (have) { this.play(row, have); return; }
    if (have === null || this.loading.has(ck)) return;
    this.loading.add(ck);
    void api.preview(name).then(async (blob) => {
      this.loading.delete(ck);
      let strip: Strip | null = null;
      if (blob) {
        try { const bitmap = await createImageBitmap(blob); strip = { bitmap, cw: Math.round(bitmap.width / PREVIEW_CELLS), ch: bitmap.height }; } catch { strip = null; }
      }
      this.strips.set(ck, strip);
      if (strip && this.row === row) this.play(row, strip);
    });
  }

  private play(row: HTMLElement, s: Strip): void {
    let cv = row.querySelector<HTMLCanvasElement>('.cv-hf-prev');
    if (!cv) {
      const thumb = row.querySelector<HTMLElement>('.cv-hf-thumb');
      if (!thumb) return;
      cv = document.createElement('canvas');
      cv.className = 'cv-hf-prev';
      cv.hidden = true;
      cv.setAttribute('aria-hidden', 'true');
      thumb.appendChild(cv);
    }
    if (cv.width !== s.cw || cv.height !== s.ch) { cv.width = s.cw; cv.height = s.ch; }
    const g = cv.getContext('2d');
    if (!g) return;
    this.cell = 0;
    const draw = (): void => {
      g.drawImage(s.bitmap, this.cell * s.cw, 0, s.cw, s.ch, 0, 0, s.cw, s.ch);
      if (cv.hidden) cv.hidden = false;
      this.cell = (this.cell + 1) % PREVIEW_CELLS;
    };
    draw();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(draw, STEP_MS);
  }

  private leave(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    const cv = this.row?.querySelector<HTMLCanvasElement>('.cv-hf-prev');
    if (cv && !cv.hidden) cv.hidden = true;
    this.row = null;
  }
}

const rowOf = (t: EventTarget | null): HTMLElement | null => (t as HTMLElement | null)?.closest?.<HTMLElement>('.cv-hf-item') ?? null;
