// Brush panel preview: an S-curve stroke with a pressure ramp, painted with the real engine.

import type { Brush, PenSample, Raster, RGB } from './types';
import { Stroke } from './stroke';

export function renderBrushPreview(brush: Brush, width: number, height: number, color: RGB): Raster {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const raster: Raster = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  // Pick a size slider value that gives a diameter that fits the preview.
  const target = Math.min(h * 0.46 * (brush.previewSize ?? 1), brush.maxSize);
  const size = brush.maxSize > brush.minSize
    ? Math.min(1, Math.max(0, (target - brush.minSize) / (brush.maxSize - brush.minSize)))
    : 1;
  const stroke = new Stroke(raster, 'preview', {
    tool: 'paint', brush, color, size, opacity: brush.presets[2]?.opacity ?? 1, alphaLock: false, selection: null,
    zoom: 1, dynamicScaling: false, seed: 1234, sizeRef: 1920,
  });
  const padX = Math.min(w * 0.12, h * 0.6);
  const n = Math.max(24, Math.round(w / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = padX + (w - padX * 2) * t;
    const y = h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22 * (1 - 0.25 * t);
    // Pressure rises, holds, then eases off.
    const pressure = 0.08 + 0.92 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7;
    const s: PenSample = { x, y, pressure, tiltX: 0, tiltY: 0, twist: 0, time: i * 8, kind: 'pen' };
    stroke.add(s);
  }
  stroke.finish();
  return raster;
}
