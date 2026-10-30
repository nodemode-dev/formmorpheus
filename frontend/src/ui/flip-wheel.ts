// The scrub wheel with Scrub Lock for the docked Flipbook strip: drag left for forward, a tap on the middle notch
// locks the frame you started from, and letting go returns to it. Notch spacing follows the Scrub speed setting.

import { setClass, setStyleVar } from './dom';
import { loadPrefs } from './prefs';
import { toast } from './toast';
import type { Content } from '../engine/types';

const NOTCH = { precise: 28, medium: 18, fast: 10 } as const;

export interface WheelHost {
  content(): Content | null;
  row(): number;
  index(): number;
  select(row: number, index: number): void;
}

export class ScrubWheel {
  readonly root: HTMLElement;
  private readonly mid: HTMLButtonElement;
  private lock: { row: number; index: number } | null = null;
  /** True while the wheel is turning. */
  scrubbing = false;
  onScrub: (() => void) | null = null;

  constructor(private readonly host: WheelHost) {
    const root = document.createElement('div');
    root.className = 'fm-sw';
    root.title = 'Drag to scrub';
    root.innerHTML = '<button class="fm-sw-mid" type="button" title="Scrub Lock" aria-label="Scrub Lock"></button>';
    this.root = root;
    this.mid = root.querySelector('.fm-sw-mid') as HTMLButtonElement;
    this.notchVar();
    this.wire();
  }

  get locked(): boolean { return this.lock !== null; }

  /** Forget the lock (a different Flipbook was opened). */
  reset(): void { this.lock = null; setClass(this.mid, 'is-locked', false); }

  /** Frame the lock holds in the open track, or -1. */
  lockedIndex(): number { return this.lock && this.lock.row === this.host.row() ? this.lock.index : -1; }

  private notch(): number { return NOTCH[loadPrefs().scrubSpeed] ?? NOTCH.medium; }

  private notchVar(): void { setStyleVar(this.root, '--notch', `${this.notch()}px`); }

  private wire(): void {
    this.mid.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.mid.addEventListener('click', () => {
      if (this.lock) { this.lock = null; toast('Scrub Lock off'); }
      else { this.lock = { row: this.host.row(), index: this.host.index() }; toast(`Scrub Lock on at frame ${this.host.index() + 1}`); }
      setClass(this.mid, 'is-locked', !!this.lock);
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === this.mid) return;
      e.stopPropagation();
      this.root.setPointerCapture(e.pointerId);
      this.notchVar();
      const s = this.notch();
      const p0 = e.clientX;
      const base = this.host.index();
      const row = this.host.row();
      let last = base;
      this.scrubbing = true;
      setClass(this.root, 'is-scrub', true);
      this.onScrub?.();
      const move = (m: PointerEvent): void => {
        if (m.pointerId !== e.pointerId) return;
        const d = m.clientX - p0;
        setStyleVar(this.root, '--wo', `${Math.round(d) % s}px`);
        const t = this.host.content()?.flip[row];
        if (!t) return;
        const to = Math.max(0, Math.min(t.frames.length - 1, base + Math.round(-d / s)));
        if (to !== last) { last = to; this.host.select(row, to); }
      };
      const up = (m: PointerEvent): void => {
        if (m.pointerId !== e.pointerId) return;
        this.root.removeEventListener('pointermove', move);
        this.root.removeEventListener('pointerup', up);
        this.root.removeEventListener('pointercancel', up);
        this.scrubbing = false;
        setClass(this.root, 'is-scrub', false);
        setStyleVar(this.root, '--wo', '0px');
        this.onScrub?.();
        if (this.lock && this.lock.row === row) this.host.select(row, this.lock.index);
      };
      this.root.addEventListener('pointermove', move);
      this.root.addEventListener('pointerup', up);
      this.root.addEventListener('pointercancel', up);
    });
  }
}
