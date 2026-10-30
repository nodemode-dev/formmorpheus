// The Stage and export side of layer groups and masks: draws a Drawing's layer list (groups, masks,
// clipping) from decoded pictures through the shared compositor in paint/layer-tree.

import { SurfacePool, drawTree, maskAlphaCanvas } from '../paint/layer-tree';
import type { TreeHooks } from '../paint/layer-tree';
import type { DrawingLayer } from './types';

/** A few pools by size (most recent last), so drawing at two sizes in turn (a thumbnail and the Stage, a flat Warp surface) does not rebuild the scratch surfaces each time. */
const pools: SurfacePool[] = [];
const POOLS_KEPT = 3;

function poolFor(w: number, h: number): SurfacePool {
  const at = pools.findIndex((p) => p.width === w && p.height === h);
  if (at >= 0) {
    const [p] = pools.splice(at, 1);
    pools.push(p);
    return p;
  }
  const p = new SurfacePool(w, h);
  pools.push(p);
  while (pools.length > POOLS_KEPT) pools.shift()?.dispose();
  return p;
}

/** Frees the scratch surfaces (a movie closed or resized). */
export function releaseLayerPool(): void {
  for (const p of pools) p.dispose();
  pools.length = 0;
}

/** Draws the layers onto ctx in movie pixels; ctx's alpha and blend are the base, as for the plain layer loop. */
export function drawLayerTree(
  ctx: OffscreenCanvasRenderingContext2D, layers: readonly DrawingLayer[], w: number, h: number, bitmap: (id: string | null) => ImageBitmap | null,
): void {
  const hooks: TreeHooks<DrawingLayer> = {
    image: (l) => (l.group ? null : bitmap(l.pixels)),
    mask: (l) => {
      if (!l.mask || l.maskOn === false) return null;
      const b = bitmap(l.mask);
      return b ? maskAlphaCanvas(b) : null;
    },
    // a mask still decoding hides the layer rather than flashing it whole
    ready: (l) => !l.mask || l.maskOn === false || !!bitmap(l.mask),
  };
  drawTree(ctx, layers, w, h, hooks, poolFor(w, h));
}
