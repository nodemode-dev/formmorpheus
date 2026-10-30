// Convert to Flipbook for any picture-like content (Drawing, Image, Video, Text, Group; sound is left out):
// non-Drawing items are first baked to one still at the playhead, then the existing conversion builds the Flipbook.
import type { Engine } from '../engine/engine';
import { drawingLayer, locate, uid } from '../engine/model';
import * as flipOps from '../engine/flip-ops';
import * as ops from '../engine/ops';
import type { Renderer } from '../engine/render';
import type { Asset, Content } from '../engine/types';
import { toast } from './toast';

/** Kinds Convert to Flipbook accepts. */
export function canConvert(c: Content): boolean {
  return c.kind === 'drawing' || c.kind === 'image' || c.kind === 'video' || c.kind === 'text' || c.kind === 'group';
}

export async function convertToFlipbook(engine: Engine, renderer: Renderer, ids: string[]): Promise<void> {
  const m = engine.movie;
  if (!m) return;
  const items = ids.map((id) => locate(m, id)?.content).filter((c): c is Content => !!c && canConvert(c));
  if (!items.length) { toast('Select pictures, video, text or drawings to make a flipbook.', 'error'); return; }
  const baked = new Map<string, { asset: Asset; blob: Blob }>();
  for (const c of items) {
    if (c.kind === 'drawing') continue;
    const local = Math.max(0, Math.min(c.duration - 1, engine.frame - c.start));
    const cv = new OffscreenCanvas(m.width, m.height);
    const cx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
    renderer.thumb(cx, m, { ...c, opacity: 1 }, local, m.width, m.height);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    const asset: Asset = { id: uid('p'), kind: 'pixels', name: c.name, mime: 'image/png', width: m.width, height: m.height, frames: 1, size: blob.size };
    baked.set(c.id, { asset, blob });
  }
  const blobs = new Map<string, Blob>();
  for (const { asset, blob } of baked.values()) { engine.assets.set(asset.id, blob); blobs.set(asset.id, blob); }
  if (blobs.size) await renderer.preload(blobs);
  const picked = items.map((c) => c.id);
  engine.run('Convert to Flipbook', (mv) => {
    let next = { ...mv, assets: { ...mv.assets } };
    for (const [id, b] of baked) {
      next.assets[b.asset.id] = b.asset;
      next = ops.updateContent(next, id, (c) => ({
        ...c, kind: 'drawing', asset: null, text: null, tracks: [], flip: [], keys: [], offset: 0,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false },
        layers: [{ ...drawingLayer(c.name), pixels: b.asset.id }],
      }));
    }
    const r = flipOps.tracksToFlipbook(next, picked);
    return { movie: r.movie, select: [r.id] };
  });
}
