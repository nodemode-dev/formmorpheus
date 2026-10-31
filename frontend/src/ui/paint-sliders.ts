// The sidebar sliders of Draw & Paint: size, opacity and (for Smudge) strength. A press jumps the value to the
// pointer; dragging away sideways, or holding Alt, switches to fine control where the same vertical travel moves
// the value a fraction as far. Pure pointer handling: the host owns the values.

import { keyboardSlider } from './a11y';

export type SliderKind = 'size' | 'opacity' | 'strength';

export interface SliderHost {
  /** Sets the value (0 to 1); `fine` is true while fine control is on. */
  apply(kind: SliderKind, value: number, fine: boolean): void;
  /** The pointer lifted (or was cancelled). */
  end(kind: SliderKind): void;
}

/** Sideways travel (px) before fine control starts, and how fast it gets finer beyond that. */
const FINE_AFTER = 34;
const FINE_RAMP = 22;

/** Multiplier on vertical travel: 1 normally, down to 0.04 far to the side, a flat 0.12 with Alt. */
export function fineFactor(dx: number, alt: boolean): number {
  if (alt) return 0.12;
  const over = Math.abs(dx) - FINE_AFTER;
  if (over <= 0) return 1;
  return Math.max(0.04, 0.3 / (1 + over / FINE_RAMP));
}

export function wireSlider(node: HTMLElement, kind: SliderKind, value: () => number, host: SliderHost): void {
  let id = -1;
  let x0 = 0;
  let lastY = 0;
  let v = 0;
  let fine = false;
  const clamp = (n: number): number => Math.max(0, Math.min(1, n));
  keyboardSlider(node, { value, set: (n) => host.apply(kind, n, false), done: () => host.end(kind) });
  node.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    node.setPointerCapture(id);
    x0 = e.clientX;
    lastY = e.clientY;
    fine = false;
    const r = node.getBoundingClientRect();
    v = clamp(1 - (e.clientY - r.top) / r.height);
    host.apply(kind, v, false);
  });
  node.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const r = node.getBoundingClientRect();
    const f = fineFactor(e.clientX - x0, e.altKey);
    if (f >= 1) {
      // normal: the value follows the pointer exactly
      if (fine) { fine = false; node.classList.remove('is-fine'); }
      v = clamp(1 - (e.clientY - r.top) / r.height);
    } else {
      if (!fine) { fine = true; v = value(); node.classList.add('is-fine'); }
      v = clamp(v + ((lastY - e.clientY) / r.height) * f);
    }
    lastY = e.clientY;
    host.apply(kind, v, fine);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = -1;
    fine = false;
    node.classList.remove('is-fine');
    host.end(kind);
  };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}
