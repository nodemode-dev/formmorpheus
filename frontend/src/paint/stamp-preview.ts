// The Brush Studio's stamp preview: one dab of the brush at full pressure, upright, painted with the real engine at
// a size that fills a small square, so the tip shape, edge softness and grain read at a glance. Pure typed arrays.

import type { Brush, PenSample, Raster, RGB } from './types';
import { Stroke } from './stroke';

export function renderStampPreview(brush: Brush, side: number, color: RGB): Raster {
  const n = Math.max(8, Math.round(side));
  const raster: Raster = { width: n, height: n, data: new Uint8ClampedArray(n * n * 4) };
  const target = n * 0.8;
  // sizes are canvas pixels on a 1920 reference, so ask for a slider value that gives the wanted diameter
  const size = brush.maxSize > brush.minSize ? Math.min(1, Math.max(0, (target - brush.minSize) / (brush.maxSize - brush.minSize))) : 1;
  const stroke = new Stroke(raster, 'stamp', {
    tool: 'paint', brush, color, size, opacity: 1, alphaLock: false, selection: null,
    zoom: 1, dynamicScaling: false, seed: 4321, sizeRef: 1920,
  });
  const s: PenSample = { x: n / 2, y: n / 2, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, time: 0, kind: 'pen' };
  stroke.add(s);
  stroke.finish();
  return raster;
}
