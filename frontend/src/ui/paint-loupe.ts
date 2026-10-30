// The eyedropper loupe: a round magnifier that follows the pointer, ringed by the colour
// under it (top half) and the colour it would replace (bottom half). Built once, patched in place.

import type { RGB } from '../paint/types';
import { loupePlacement } from '../paint/viewmath';
import { el, q, setHidden, setStyleVar } from './dom';

const SIZE = 132;
const LENS = 96;
/** CSS pixels of the screen shown across the lens. */
const SPAN = 12;

const TEMPLATE = `<div class="fm-loupe" hidden>
  <div class="fm-loupe-ring"></div>
  <canvas class="fm-loupe-lens" width="${LENS}" height="${LENS}"></canvas>
  <div class="fm-loupe-cross"></div>
</div>`;

export interface LoupeHost {
  /** The view the loupe magnifies (what is on screen, rotation included). */
  source: HTMLCanvasElement;
  dpr: () => number;
  /** Colour at a client point, or null when it is empty or off the picture. */
  sample: (clientX: number, clientY: number) => RGB | null;
}

export class Loupe {
  readonly root: HTMLElement;
  private readonly lens: CanvasRenderingContext2D;
  private on = false;
  private pressing = false;
  private cur: RGB | null = null;
  private prev: RGB = { r: 0, g: 0, b: 0 };

  constructor(private readonly host: LoupeHost) {
    this.root = el<HTMLElement>(TEMPLATE);
    this.lens = (q<HTMLCanvasElement>(this.root, '.fm-loupe-lens')).getContext('2d') as CanvasRenderingContext2D;
    this.lens.imageSmoothingEnabled = false;
  }

  get active(): boolean { return this.on; }
  /** True while the pointer is down on it (release will pick). */
  get held(): boolean { return this.pressing; }
  /** The colour under the loupe, null when empty. */
  get colour(): RGB | null { return this.cur; }

  show(clientX: number, clientY: number, previous: RGB, pressing: boolean): void {
    this.prev = previous;
    this.pressing = pressing;
    this.on = true;
    setStyleVar(this.root, '--prev', rgbCss(previous));
    setHidden(this.root, false);
    this.move(clientX, clientY);
  }

  press(): void { this.pressing = true; }

  move(clientX: number, clientY: number): void {
    if (!this.on) return;
    const box = this.host.source.getBoundingClientRect();
    const x = clientX - box.left, y = clientY - box.top;
    const at = loupePlacement(x, y, SIZE, box.width, box.height);
    this.root.style.transform = `translate(${Math.round(at.x - SIZE / 2)}px, ${Math.round(at.y - SIZE / 2)}px)`;
    this.cur = this.host.sample(clientX, clientY);
    setStyleVar(this.root, '--cur', this.cur ? rgbCss(this.cur) : 'transparent');
    const d = this.host.dpr(), s = SPAN * d;
    this.lens.clearRect(0, 0, LENS, LENS);
    this.lens.drawImage(this.host.source, x * d - s / 2, y * d - s / 2, s, s, 0, 0, LENS, LENS);
  }

  hide(): void {
    this.on = false;
    this.pressing = false;
    setHidden(this.root, true);
  }
}

function rgbCss(c: RGB): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}
