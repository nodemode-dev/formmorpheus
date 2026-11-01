// Stage readouts while a box handle is dragged: a numeric label by the pointer (X, Y, scale, angle) and a
// "Snapping on" chip at the top of the Stage while the snap modifier is held. Both are built once and patched.
import { el, setHidden, setText } from './dom';
import '../styles/stage-hud.css';

export interface HudValues { x: number; y: number; sx: number; sy: number; rot: number }

export class StageHud {
  private readonly read = el('<div class="fm-hud" hidden></div>');
  private readonly chip = el('<div class="fm-hud-chip" hidden>Snapping on</div>');
  private timer = 0;
  private last = '';
  /** The stored scale that reads 100 percent for the content being dragged (its fit). */
  base = 1;

  constructor(private readonly host: HTMLElement) {
    host.append(this.read, this.chip);
  }

  /** Show the numbers next to the pointer (client coordinates). */
  show(clientX: number, clientY: number, v: HudValues): void {
    window.clearTimeout(this.timer);
    const r = this.host.getBoundingClientRect();
    const sx = Math.round(v.sx / this.base * 1000) / 10, sy = Math.round(v.sy / this.base * 1000) / 10;
    const scale = Math.abs(sx - sy) < 0.05 ? `${sx}%` : `${sx}% x ${sy}%`;
    const text = `X ${Math.round(v.x)}  Y ${Math.round(v.y)}  ·  ${scale}  ·  ${Math.round(v.rot * 10) / 10}°`;
    if (text !== this.last) { this.last = text; setText(this.read, text); }
    setHidden(this.read, false);
    const w = this.read.offsetWidth || 160;
    const x = Math.max(4, Math.min(clientX - r.left + 16, r.width - w - 4));
    const y = Math.max(4, Math.min(clientY - r.top + 20, r.height - 30));
    this.read.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** The "Snapping on" chip follows the modifier. */
  snapping(on: boolean): void {
    setHidden(this.chip, !on);
  }

  /** The label stays a moment after the pointer lets go, then clears. */
  release(): void {
    this.snapping(false);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { setHidden(this.read, true); this.last = ''; }, 600);
  }
}
