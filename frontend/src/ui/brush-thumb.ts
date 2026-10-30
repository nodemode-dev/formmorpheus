// QuickLook thumbnails for brush export: a stroke sample drawn with the brush, on white, as a PNG.
// UI layer on purpose: it needs an OffscreenCanvas; the paint core only supplies the raster.

import { renderBrushPreview } from '../paint/preview';
import type { Brush } from '../paint/types';

const W = 256, H = 96;

/** PNG bytes of one brush's stroke, or null where no canvas is available. */
export async function brushThumb(b: Brush): Promise<Uint8Array | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const r = renderBrushPreview(b, W, H, { r: 20, g: 20, b: 24 });
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    const layer = new OffscreenCanvas(W, H);
    const lg = layer.getContext('2d');
    if (!lg) return null;
    lg.putImageData(new ImageData(new Uint8ClampedArray(r.data), W, H), 0, 0);
    g.drawImage(layer, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } catch { return null; }
}

export function brushThumbs(list: Brush[]): Promise<(Uint8Array | null)[]> {
  return Promise.all(list.map(brushThumb));
}
