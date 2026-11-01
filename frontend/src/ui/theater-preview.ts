import { api } from '../io/api';
import { PREVIEW_CELLS } from './preview-strip';

/** Hover (or keyboard focus) on a movie in the Theater plays its saved strip over the poster: a canvas lays over the
 *  thumbnail, steps through the strip's pictures, and hides again when the pointer leaves. The canvas is made once
 *  per thumbnail the first time it is needed; stepping only draws into it. */
interface Strip { bitmap: ImageBitmap; cw: number; ch: number }

const STEP_MS = 140;
const STRIP_CAP = 24;

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
    if (have) { this.strips.delete(ck); this.strips.set(ck, have); this.play(row, have); return; }   // re-insert: most recent
    if (have === null || this.loading.has(ck)) return;
    this.loading.add(ck);
    const when = Number((row.dataset.thumb ?? '').split('|')[1]);
    void api.preview(name, when > 0 ? when : undefined).then(async (blob) => {
      this.loading.delete(ck);
      let strip: Strip | null = null;
      if (blob) {
        try {
          const bitmap = await createImageBitmap(blob);
          // a strip saved before the first content existed is one white picture: the poster stays instead
          strip = isBlank(bitmap) ? (bitmap.close(), null) : { bitmap, cw: Math.round(bitmap.width / PREVIEW_CELLS), ch: bitmap.height };
        } catch { strip = null; }
      }
      this.store(name, ck, strip);
      if (strip && this.row === row) this.play(row, strip);
    });
  }

  /** Keep one entry per movie name (a new thumb key replaces the old) and at most STRIP_CAP in all. */
  private store(name: string, ck: string, strip: Strip | null): void {
    for (const k of [...this.strips.keys()]) {
      if (k !== ck && k.startsWith(`${name}|`)) { this.strips.get(k)?.bitmap.close(); this.strips.delete(k); }
    }
    this.strips.get(ck)?.bitmap.close();
    this.strips.delete(ck);
    this.strips.set(ck, strip);
    while (this.strips.size > STRIP_CAP) {
      const oldest = this.strips.keys().next().value as string;
      this.strips.get(oldest)?.bitmap.close();
      this.strips.delete(oldest);
    }
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
      try { g.drawImage(s.bitmap, this.cell * s.cw, 0, s.cw, s.ch, 0, 0, s.cw, s.ch); } catch { this.leave(); return; }   // bitmap closed by eviction
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

/** True when a sample of the strip is pure white everywhere (or fully clear). */
function isBlank(bm: ImageBitmap): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false;
  const c = new OffscreenCanvas(32, 4), g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return false;
  g.drawImage(bm, 0, 0, 32, 4);
  const d = g.getImageData(0, 0, 32, 4).data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250)) return false;
  return true;
}

const rowOf =(t: EventTarget | null): HTMLElement | null => (t as HTMLElement | null)?.closest?.<HTMLElement>('.cv-hf-item') ?? null;
