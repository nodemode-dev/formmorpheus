// The size and opacity bubble's picture: a short S-curve stroke made with the real brush engine at the brush's
// true on-screen size (capped to fit), the current color and the current opacity. Painted into a reused canvas.

import { baseDiameter } from '../paint/dynamics';
import { Stroke } from '../paint/stroke';
import type { Brush, PenSample, Raster, RGB } from '../paint/types';

export const BUBBLE_W = 320;
export const BUBBLE_H = 112;

let raster: Raster | null = null;
let image: ImageData | null = null;

export interface BubbleSpec {
  brush: Brush;
  /** The engine's 0..1 size value (after the slider curve). */
  size: number;
  opacity: number;
  color: RGB;
  /** The movie's long side in pixels and the view scale: together they give the size on screen. */
  canvasLong: number;
  viewScale: number;
}

/** Draws the stroke sample into `cv` (BUBBLE_W by BUBBLE_H); falls back to a plain disc if the engine throws. */
export function drawBubble(cv: HTMLCanvasElement, s: BubbleSpec): void {
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, BUBBLE_W, BUBBLE_H);
  const b = s.brush;
  const screenDia = baseDiameter(b, s.size, s.canvasLong) * Math.min(1, s.viewScale * 2);
  // the preview is drawn at 2x, so the stroke is twice its screen diameter, kept inside the picture
  const target = Math.min(BUBBLE_H * 0.62, Math.max(7, screenDia * 3));
  const range = b.maxSize - b.minSize;
  const size = range > 0 ? Math.min(1, Math.max(0, (target - b.minSize) / range)) : 1;
  try {
    if (!raster) {
      const data = new Uint8ClampedArray(new ArrayBuffer(BUBBLE_W * BUBBLE_H * 4));
      raster = { width: BUBBLE_W, height: BUBBLE_H, data };
      image = new ImageData(data, BUBBLE_W, BUBBLE_H);
    }
    raster.data.fill(0);
    const st = new Stroke(raster, 'bubble', {
      tool: 'paint', brush: b, color: s.color, size, opacity: s.opacity, alphaLock: false, selection: null,
      zoom: 1, dynamicScaling: false, seed: 77, sizeRef: 1920,
    });
    const padX = 28;
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = padX + (BUBBLE_W - padX * 2) * t;
      const y = BUBBLE_H / 2 + Math.sin(t * Math.PI * 2) * BUBBLE_H * 0.2;
      // a firm pressure the whole way so a light-touch pencil still reads as a clear mark
      const pressure = 0.7 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.6;
      const p: PenSample = { x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, time: i * 8, kind: 'pen' };
      st.add(p);
    }
    st.finish();
    if (image) g.putImageData(image, 0, 0);
  } catch {
    g.globalAlpha = s.opacity;
    g.fillStyle = `rgb(${s.color.r}, ${s.color.g}, ${s.color.b})`;
    g.beginPath();
    g.arc(BUBBLE_W / 2, BUBBLE_H / 2, Math.min(BUBBLE_H * 0.4, target / 2), 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
}
