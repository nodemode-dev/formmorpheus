// Desktop navigation of the Timeline: what a drag on the Ruler does, and Space held to pan.
import type { Engine } from '../engine/engine';
import { snapOptions } from '../engine/snap';
import { setClass } from './dom';

const KEY = 'fm.tl.rulerDrag';
type RulerMode = 'scrub' | 'scale';
let mode: RulerMode = 'scrub';
try { if (localStorage.getItem(KEY) === 'scale') mode = 'scale'; } catch { /* storage blocked: scrub */ }

/** What a plain drag on the Ruler does: move the Playhead (scrub, the default) or change the time scale. Alt does the other. */
export const rulerDrag = {
  get mode(): RulerMode { return mode; },
  set(next: RulerMode): void {
    mode = next;
    try { localStorage.setItem(KEY, next); } catch { /* not kept */ }
  },
};

const SEC_KEY = 'fm.snap.seconds';
try { snapOptions.seconds = localStorage.getItem(SEC_KEY) === '1'; } catch { /* storage blocked: off */ }

/** Snap to every whole second as well (off by default). */
export const snapSeconds = {
  get on(): boolean { return snapOptions.seconds; },
  set(next: boolean): void {
    snapOptions.seconds = next;
    try { localStorage.setItem(SEC_KEY, next ? '1' : '0'); } catch { /* not kept */ }
  },
};

/**
 * Space held over the Timeline turns a drag into a pan. Tapping Space alone still plays and pauses: the key is held back
 * until it comes up, and plays only if no drag used it.
 */
export class SpacePan {
  held = false;
  private used = false;
  private over = false;

  constructor(private readonly engine: Engine, body: HTMLElement, root: HTMLElement) {
    body.addEventListener('pointerenter', () => { this.over = true; });
    body.addEventListener('pointerleave', () => { this.over = false; });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !this.over || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !engine.movie) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;   // a focused button does not block the hand (pointer is over the lanes)
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!this.held) { this.held = true; this.used = false; setClass(root, 'is-space', true); }
    }, true);
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || !this.held) return;
      this.held = false;
      setClass(root, 'is-space', false);
      if (!this.used) engine.togglePlay();
    }, true);
    window.addEventListener('blur', () => { this.held = false; setClass(root, 'is-space', false); });
  }

  /** A press took the Space: it will not play on release. */
  take(): void { this.used = true; }
}
